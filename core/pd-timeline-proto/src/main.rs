//! pd-timeline-proto — Metalsmith R&D standalone window.
//!
//! Stack: winit (window/event loop) + wgpu (GPU, Metal backend on macOS) +
//! Vello (compute-based GPU vector renderer) + Parley (text shaping/layout).
//!
//! Why this stack and not pure objc2-metal? See the `metal-text-pipeline` skill:
//! Vello *is* the hand-written compute vector renderer we'd otherwise have to
//! build from scratch in MSL. winit+wgpu still lands on Metal under the hood on
//! macOS, so we keep "bespoke GPU vector rendering" while standing on the
//! shoulders of the Linebender stack. Pure objc2-metal is documented as the
//! road not taken (and why) in the skill.
//!
//! Interaction: ←/→ arrows scrub the playhead; left-drag scrubs directly;
//! Space toggles auto-play. Frame time + rolling FPS are logged while scrubbing.

mod data;
mod scene;

use std::sync::Arc;
use std::time::{Duration, Instant};

use vello::util::{RenderContext, RenderSurface};
use vello::{AaConfig, Renderer, RendererOptions, Scene};
use vello::peniko::Color;
use vello::wgpu;
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{ElementState, MouseButton, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{Key, NamedKey};
use winit::window::{Window, WindowId};

use data::Timeline;
use scene::{build_scene, Layoutspec, TextEngine};

const DAEMON_BASE: &str = "http://127.0.0.1:9876";

/// Surface + renderer state that only exists once the window is created.
struct ActiveState<'s> {
    surface: RenderSurface<'s>,
    window: Arc<Window>,
}

struct App<'s> {
    context: RenderContext,
    renderers: Vec<Option<Renderer>>,
    state: Option<ActiveState<'s>>,
    scene: Scene,
    text: TextEngine,
    timeline: Timeline,

    // Scrub state.
    playhead: f64, // 0..=1
    playing: bool,
    dragging: bool,
    last_cursor_x: f64,

    // Frame timing.
    last_frame: Instant,
    fps_window: Vec<f32>,
    last_fps_log: Instant,
}

impl<'s> App<'s> {
    fn new(timeline: Timeline) -> Self {
        Self {
            context: RenderContext::new(),
            renderers: Vec::new(),
            state: None,
            scene: Scene::new(),
            text: TextEngine::new(),
            timeline,
            playhead: 0.0,
            // PD_TIMELINE_AUTOPLAY=1 starts in continuous-redraw mode so the
            // frame-time/FPS benchmark logs without needing manual key input.
            playing: std::env::var("PD_TIMELINE_AUTOPLAY").as_deref() == Ok("1"),
            dragging: false,
            last_cursor_x: 0.0,
            last_frame: Instant::now(),
            fps_window: Vec::with_capacity(120),
            last_fps_log: Instant::now(),
        }
    }

    fn layout_spec(&self, width: u32, height: u32, scale: f64) -> Layoutspec {
        Layoutspec {
            width: width as f64 / scale,
            height: height as f64 / scale,
            left_gutter: 140.0,
            top_pad: 96.0,
            bottom_pad: 56.0,
            scale,
        }
    }

    /// Convert a window-space x (physical px) into a 0..1 playhead fraction.
    fn frac_from_x(&self, x_physical: f64, width: u32, scale: f64) -> f64 {
        let spec = self.layout_spec(width, 1, scale);
        let logical_x = x_physical / scale;
        let usable = spec.width - spec.left_gutter - 24.0;
        ((logical_x - spec.left_gutter) / usable).clamp(0.0, 1.0)
    }
}

impl<'s> ApplicationHandler for App<'s> {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.state.is_some() {
            return;
        }
        let attrs = Window::default_attributes()
            .with_title("pd-timeline-proto — Voyage Timeline (Metalsmith R&D)")
            .with_inner_size(LogicalSize::new(1280.0, 720.0));
        let window = Arc::new(event_loop.create_window(attrs).unwrap());
        let size = window.inner_size();

        let surface = pollster::block_on(self.context.create_surface(
            window.clone(),
            size.width.max(1),
            size.height.max(1),
            wgpu::PresentMode::AutoVsync,
        ))
        .expect("create surface");

        // Create a renderer for this surface's device.
        let dev_id = surface.dev_id;
        self.renderers.resize_with(self.context.devices.len(), || None);
        self.renderers[dev_id].get_or_insert_with(|| {
            Renderer::new(
                &self.context.devices[dev_id].device,
                RendererOptions {
                    surface_format: Some(surface.format),
                    use_cpu: false,
                    antialiasing_support: vello::AaSupport::area_only(),
                    num_init_threads: None,
                },
            )
            .expect("create renderer")
        });

        // Report the chosen GPU backend — this proves Metal on macOS.
        let adapter = &self.context.devices[dev_id].adapter().get_info();
        log::info!(
            "GPU backend: {:?}  adapter: {}  ({:?})",
            adapter.backend,
            adapter.name,
            adapter.device_type
        );
        println!(
            "[pd-timeline-proto] rendering via {:?} on '{}'",
            adapter.backend, adapter.name
        );

        let win = window.clone();
        self.state = Some(ActiveState { surface, window });
        win.request_redraw();
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _id: WindowId,
        event: WindowEvent,
    ) {
        // Pull a window handle + dims out without holding a long-lived borrow
        // on `self.state`, so we can still call `&self` helpers below.
        let (window, scale, width) = {
            let Some(state) = self.state.as_ref() else {
                return;
            };
            (
                state.window.clone(),
                state.window.scale_factor(),
                state.surface.config.width,
            )
        };

        match event {
            WindowEvent::CloseRequested => event_loop.exit(),

            WindowEvent::Resized(size) => {
                if let Some(state) = self.state.as_mut() {
                    self.context.resize_surface(
                        &mut state.surface,
                        size.width.max(1),
                        size.height.max(1),
                    );
                }
                window.request_redraw();
            }

            WindowEvent::KeyboardInput { event, .. } if event.state == ElementState::Pressed => {
                match event.logical_key {
                    Key::Named(NamedKey::ArrowRight) => {
                        self.playhead = (self.playhead + 0.02).min(1.0);
                        window.request_redraw();
                    }
                    Key::Named(NamedKey::ArrowLeft) => {
                        self.playhead = (self.playhead - 0.02).max(0.0);
                        window.request_redraw();
                    }
                    Key::Named(NamedKey::Space) => {
                        self.playing = !self.playing;
                        window.request_redraw();
                    }
                    Key::Named(NamedKey::Escape) => event_loop.exit(),
                    _ => {}
                }
            }

            WindowEvent::MouseInput { state: btn_state, button, .. }
                if button == MouseButton::Left =>
            {
                self.dragging = btn_state == ElementState::Pressed;
                if self.dragging {
                    self.playhead = self.frac_from_x(self.last_cursor_x, width, scale);
                    window.request_redraw();
                }
            }

            WindowEvent::CursorMoved { position, .. } => {
                self.last_cursor_x = position.x;
                if self.dragging {
                    self.playhead = self.frac_from_x(position.x, width, scale);
                    window.request_redraw();
                }
            }

            WindowEvent::RedrawRequested => {
                let now = Instant::now();
                let dt = now.duration_since(self.last_frame).as_secs_f32();
                self.last_frame = now;

                // Auto-play advances the playhead.
                if self.playing {
                    self.playhead = (self.playhead + dt as f64 * 0.15) % 1.0;
                }

                // Build the scene with `&self` helpers (no `state` borrow held).
                let (sw, sh) = {
                    let state = self.state.as_ref().unwrap();
                    (state.surface.config.width, state.surface.config.height)
                };
                let s = self.layout_spec(sw, sh, scale);
                build_scene(&mut self.scene, &mut self.text, &self.timeline, &s, self.playhead);

                // Now render. Access disjoint fields directly so the borrow
                // checker can split the `&mut self` into surface / context /
                // renderers / scene without aliasing.
                let dev_id = self.state.as_ref().unwrap().surface.dev_id;
                let surface_texture = match self
                    .state
                    .as_ref()
                    .unwrap()
                    .surface
                    .surface
                    .get_current_texture()
                {
                    Ok(t) => t,
                    Err(_) => {
                        window.request_redraw();
                        return;
                    }
                };
                let render_start = Instant::now();
                let device = &self.context.devices[dev_id].device;
                let queue = &self.context.devices[dev_id].queue;
                self.renderers[dev_id]
                    .as_mut()
                    .unwrap()
                    .render_to_surface(
                        device,
                        queue,
                        &self.scene,
                        &surface_texture,
                        &vello::RenderParams {
                            base_color: Color::rgb8(0x0d, 0x11, 0x17),
                            width: sw,
                            height: sh,
                            antialiasing_method: AaConfig::Area,
                        },
                    )
                    .expect("render_to_surface");
                surface_texture.present();
                device.poll(wgpu::Maintain::Poll);

                // Frame timing / FPS while interacting.
                let frame_ms = render_start.elapsed().as_secs_f32() * 1000.0;
                let fps = if dt > 0.0 { 1.0 / dt } else { 0.0 };
                self.fps_window.push(fps);
                if self.fps_window.len() > 120 {
                    self.fps_window.remove(0);
                }
                if self.last_fps_log.elapsed() > Duration::from_millis(500)
                    && (self.dragging || self.playing)
                {
                    let avg: f32 =
                        self.fps_window.iter().sum::<f32>() / self.fps_window.len().max(1) as f32;
                    println!(
                        "[frame] gpu_build+submit={frame_ms:.2}ms  fps≈{avg:.0}  playhead={:.2}",
                        self.playhead
                    );
                    self.last_fps_log = Instant::now();
                }

                // Keep redrawing while auto-playing for a continuous benchmark.
                if self.playing {
                    window.request_redraw();
                }
            }
            _ => {}
        }
    }
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    println!("[pd-timeline-proto] loading timeline data…");
    let timeline = Timeline::load(DAEMON_BASE);
    println!(
        "[pd-timeline-proto] {} ({} events, {} causal threads)",
        timeline.source_note,
        timeline.events.len(),
        timeline.threads.len()
    );

    let event_loop = EventLoop::new().unwrap();
    event_loop.set_control_flow(ControlFlow::Wait);
    let mut app = App::new(timeline);
    event_loop.run_app(&mut app).expect("run app");
}
