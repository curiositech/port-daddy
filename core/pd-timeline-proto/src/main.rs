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

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
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

/// Daemon base URL: honor the selected named daemon, otherwise read the stable
/// daemon's atomic port publication. An absent publication is not replaced by a
/// guessed port; the caller renders its clearly-marked fixture instead.
fn daemon_base() -> Result<String, String> {
    if let Ok(explicit) = std::env::var("PORT_DADDY_URL") {
        let explicit = explicit.trim().trim_end_matches('/');
        if !explicit.is_empty() {
            return Ok(explicit.to_string());
        }
    }

    let port_file = std::env::var_os("PORT_DADDY_PORT_FILE")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .filter(|home| !home.is_empty())
                .map(PathBuf::from)
                .map(|home| home.join(".port-daddy/daemon.port"))
        })
        .ok_or_else(|| "no daemon port publication path is available".to_string())?;
    let raw = std::fs::read_to_string(&port_file)
        .map_err(|error| format!("cannot read {}: {error}", port_file.display()))?;
    let port = raw
        .trim()
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
        .ok_or_else(|| format!("invalid daemon port publication in {}", port_file.display()))?;
    let host = std::env::var("PORT_DADDY_HOST")
        .ok()
        .filter(|host| !host.trim().is_empty())
        .unwrap_or_else(|| "127.0.0.1".to_string());
    Ok(format!("http://{}:{}", host.trim(), port))
}

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
    let timeline = match daemon_base() {
        Ok(base) => Timeline::load(&base),
        Err(error) => Timeline::fixture(&format!("no selected daemon ({error}); using fixture")),
    };
    println!(
        "[pd-timeline-proto] {} ({} events, {} causal threads)",
        timeline.source_note,
        timeline.events.len(),
        timeline.threads.len()
    );

    // Headless path (Method A of docs/recording-visual-artifacts.md): when
    // PD_TIMELINE_RENDER_OFFSCREEN=<out.mp4> is set, render the playhead sweep to
    // an offscreen wgpu texture and pipe frames to ffmpeg — no window, no
    // compositor, no Screen-Recording (TCC) permission. Deterministic: the clock
    // is synthetic (frame index), not CADisplayLink. Returns without ever
    // touching winit.
    if let Ok(out) = std::env::var("PD_TIMELINE_RENDER_OFFSCREEN") {
        render_offscreen(&timeline, &out);
        return;
    }

    let event_loop = EventLoop::new().unwrap();
    event_loop.set_control_flow(ControlFlow::Wait);
    let mut app = App::new(timeline);
    event_loop.run_app(&mut app).expect("run app");
}

/// Read a `u32` from an env var, falling back to `default` if unset/unparseable.
fn env_u32(key: &str, default: u32) -> u32 {
    std::env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

/// Read an `f64` from an env var, falling back to `default` if unset/unparseable.
fn env_f64(key: &str, default: f64) -> f64 {
    std::env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

/// Headless render: sweep the playhead 0→1 over `secs` at `fps`, rendering each
/// frame to an offscreen Vello texture and streaming raw RGBA to ffmpeg. No
/// window is created. See `docs/recording-visual-artifacts.md` (Method A).
///
/// Sizing mirrors the windowed default (1280×720 logical) at a 2× retina scale,
/// so the artifact matches what you'd see on screen. Override with
/// `PD_TIMELINE_RENDER_W` / `_H` (physical px), `PD_TIMELINE_RENDER_SCALE`,
/// `PD_TIMELINE_RENDER_FPS`, `PD_TIMELINE_RENDER_SECS`.
fn render_offscreen(timeline: &Timeline, out_path: &str) {
    let width = env_u32("PD_TIMELINE_RENDER_W", 2560);
    let height = env_u32("PD_TIMELINE_RENDER_H", 1440);
    let scale = env_f64("PD_TIMELINE_RENDER_SCALE", 2.0);
    let fps = env_u32("PD_TIMELINE_RENDER_FPS", 60).max(1);
    let secs = env_f64("PD_TIMELINE_RENDER_SECS", 6.0).max(0.0);
    let total_frames = ((secs * fps as f64).round() as u32).max(1);

    // A device with NO compatible surface — this is the headless seam. On macOS
    // this still resolves to Metal under the hood.
    let mut context = RenderContext::new();
    let dev_id = pollster::block_on(context.device(None))
        .expect("no compatible wgpu device for headless render");
    let device = &context.devices[dev_id].device;
    let queue = &context.devices[dev_id].queue;
    let info = context.devices[dev_id].adapter().get_info();
    println!(
        "[render] headless via {:?} on '{}' — {width}x{height}@{scale}x, {total_frames} frames @ {fps}fps -> {out_path}",
        info.backend, info.name
    );

    let mut renderer = Renderer::new(
        device,
        RendererOptions {
            // No surface to present to; we read the texture back instead.
            surface_format: None,
            use_cpu: false,
            antialiasing_support: vello::AaSupport::area_only(),
            num_init_threads: None,
        },
    )
    .expect("create headless renderer");

    // Vello's `render_to_texture` writes via a compute storage binding, so the
    // target MUST be Rgba8Unorm + STORAGE_BINDING. COPY_SRC lets us read it back.
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("pd-timeline offscreen"),
        size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let target_view = target.create_view(&wgpu::TextureViewDescriptor::default());

    // copy_texture_to_buffer requires bytes_per_row aligned to 256; we un-pad on
    // readback. Skipping this is the classic "sheared video" bug.
    let unpadded_bpr = width * 4;
    let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let padded_bpr = unpadded_bpr.div_ceil(align) * align;
    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("pd-timeline readback"),
        size: (padded_bpr as u64) * (height as u64),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    // Stream raw RGBA into ffmpeg; it owns the H.264 encode. yuv420p for players
    // that choke on rgb. -crf 16 is visually lossless for this flat-color UI.
    // A missing ffmpeg is the single most likely failure on a fresh machine, so
    // fail with a clear actionable line instead of a panic backtrace. (Bad output
    // paths / unwritable dirs surface later via ffmpeg's own nonzero exit, which
    // we check after the stream closes.)
    let mut child = match Command::new("ffmpeg")
        .args([
            "-y",
            "-f", "rawvideo",
            "-pix_fmt", "rgba",
            "-s", &format!("{width}x{height}"),
            "-r", &fps.to_string(),
            "-i", "-",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-crf", "16",
            out_path,
        ])
        .stdin(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[render] could not start ffmpeg ({e}). Install it: brew install ffmpeg");
            std::process::exit(1);
        }
    };
    let mut ffmpeg_stdin = child.stdin.take().expect("ffmpeg stdin");

    let mut scene = Scene::new();
    let mut text = TextEngine::new();
    let spec = Layoutspec {
        width: width as f64 / scale,
        height: height as f64 / scale,
        left_gutter: 140.0,
        top_pad: 96.0,
        bottom_pad: 56.0,
        scale,
    };

    for frame in 0..total_frames {
        // Synthetic clock: a single deterministic sweep across the whole clip.
        let playhead = if total_frames <= 1 {
            0.0
        } else {
            frame as f64 / (total_frames - 1) as f64
        };
        build_scene(&mut scene, &mut text, timeline, &spec, playhead);

        renderer
            .render_to_texture(
                device,
                queue,
                &scene,
                &target_view,
                &vello::RenderParams {
                    base_color: Color::rgb8(0x0d, 0x11, 0x17),
                    width,
                    height,
                    antialiasing_method: AaConfig::Area,
                },
            )
            .expect("render_to_texture");

        let mut encoder =
            device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("readback") });
        encoder.copy_texture_to_buffer(
            wgpu::ImageCopyTexture {
                texture: &target,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::ImageCopyBuffer {
                buffer: &readback,
                layout: wgpu::ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bpr),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );
        queue.submit([encoder.finish()]);

        // Block until the GPU finishes and the buffer is mapped — without the
        // Wait poll you read stale/garbage pixels.
        let slice = readback.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        device.poll(wgpu::Maintain::Wait);
        rx.recv().expect("map channel").expect("map readback buffer");
        {
            let data = slice.get_mapped_range();
            // Un-pad each row back to width*4 before handing it to ffmpeg.
            for row in 0..height as usize {
                let start = row * padded_bpr as usize;
                let end = start + unpadded_bpr as usize;
                ffmpeg_stdin
                    .write_all(&data[start..end])
                    .expect("write frame to ffmpeg");
            }
        }
        readback.unmap();

        if frame % fps == 0 || frame + 1 == total_frames {
            println!("[render] {}/{total_frames}  playhead {playhead:.2}", frame + 1);
        }
    }

    // Close stdin so ffmpeg flushes and exits, then wait for it.
    drop(ffmpeg_stdin);
    let status = child.wait().expect("wait for ffmpeg");
    if status.success() {
        println!("[render] done -> {out_path}");
    } else {
        eprintln!("[render] ffmpeg exited with {status}");
        std::process::exit(1);
    }
}
