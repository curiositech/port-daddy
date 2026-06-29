//! pd-flag-proto — headless renderer for the pd-console waving signal flags.
//!
//! Method A (per the rust-gpui-motion headless-recording reference): render each
//! frame of the flag-wave to an OFFSCREEN wgpu texture (no window, no compositor,
//! no Screen-Recording/TCC permission), read it back, and write a PNG per frame.
//! `scripts/render-gif.sh` then assembles the PNGs into a seamless GIF with
//! ffmpeg (palettegen/paletteuse). Deterministic: the clock is synthetic
//! (loop_pos = frame / FRAMES), so the output is bit-reproducible.
//!
//! This is the standalone T3 surface that proves + records the flag wave; it is
//! intentionally NOT wired into pd-console yet (that is the render-to-texture
//! embed step). Build/run explicitly:  cd core/pd-flag-proto && cargo run --release

mod flag_scene;

use flag_scene::{tone, FlagSpec, Movement, TextEngine};
use vello::{
    peniko::Color,
    AaConfig, AaSupport, RenderParams, Renderer, RendererOptions, Scene,
};
use wgpu::{
    Extent3d, ImageCopyBuffer, ImageDataLayout, TextureDescriptor, TextureDimension, TextureFormat,
    TextureUsages,
};

const WIDTH: u32 = 1000;
const HEIGHT: u32 = 380;
const FRAMES: u32 = 120; // 4 gestures @ 30fps; starts & ends still → near-seamless

fn main() {
    let out_dir = std::path::Path::new("docs/frames");
    std::fs::create_dir_all(out_dir).expect("create docs/frames");

    // ── Headless wgpu: instance → adapter → device. No surface, no window. ──
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        force_fallback_adapter: false,
    }))
    .expect("no wgpu adapter (Metal) available");
    eprintln!("[flag] adapter: {} ({:?})", adapter.get_info().name, adapter.get_info().backend);

    let (device, queue) = pollster::block_on(adapter.request_device(
        &wgpu::DeviceDescriptor {
            label: Some("pd-flag-proto device"),
            required_features: wgpu::Features::empty(),
            required_limits: adapter.limits(),
            memory_hints: wgpu::MemoryHints::default(),
        },
        None,
    ))
    .expect("request_device");

    let mut renderer = Renderer::new(
        &device,
        RendererOptions {
            surface_format: None, // offscreen — we render to a texture, not a surface
            use_cpu: false,
            antialiasing_support: AaSupport::area_only(),
            num_init_threads: None,
        },
    )
    .expect("create vello renderer");

    // ── Offscreen target: Vello writes via compute → needs STORAGE_BINDING;
    //    COPY_SRC lets us read it back. ──
    let target = device.create_texture(&TextureDescriptor {
        label: Some("flag offscreen target"),
        size: Extent3d { width: WIDTH, height: HEIGHT, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: TextureDimension::D2,
        format: TextureFormat::Rgba8Unorm,
        usage: TextureUsages::STORAGE_BINDING | TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let target_view = target.create_view(&wgpu::TextureViewDescriptor::default());

    // Readback buffer: bytes_per_row MUST be padded to 256 (COPY_BYTES_PER_ROW_ALIGNMENT).
    let unpadded_bpr = WIDTH * 4;
    let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let padded_bpr = unpadded_bpr.div_ceil(align) * align;
    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("flag readback"),
        size: (padded_bpr * HEIGHT) as u64,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });

    let flags = vec![
        FlagSpec { letter: 'H', color: tone("sailing"), lifecycle: "sailing" },
        FlagSpec { letter: 'Y', color: tone("cooldown"), lifecycle: "cooldown" },
        FlagSpec { letter: 'F', color: tone("dry-dock"), lifecycle: "dry-dock" },
        FlagSpec { letter: 'M', color: tone("armed"), lifecycle: "armed" },
    ];

    let mut scene = Scene::new();
    let mut text = TextEngine::new();
    let bg = flag_scene::background();
    let base_color = Color::rgb8(bg.r, bg.g, bg.b);

    // Scripted 4-direction movement profile. Each gesture is a velocity impulse
    // that decays, so the flags react then settle — idle frames have no motion.
    // This IS the deflect(velocity) the live pane will feed real scroll/resize
    // deltas into; here we drive it with a script to record all four directions.
    let mut vx = 0.0f64;
    let mut vy = 0.0f64;
    let mut phase = 0.0f64;
    const DECAY: f64 = 0.87;
    // (frame, Δvx, Δvy): scroll-down, scroll-up, pan-right, pan-left.
    let impulses = [(6u32, 0.0, 1.0), (36, 0.0, -1.0), (66, 1.0, 0.0), (96, -1.0, 0.0)];

    for frame in 0..FRAMES {
        for (f, dvx, dvy) in impulses.iter() {
            if *f == frame {
                vx += *dvx;
                vy += *dvy;
            }
        }
        let speed = (vx * vx + vy * vy).sqrt();
        phase += speed * 0.9;
        let mv = Movement { vx, vy, phase };

        scene.reset();
        flag_scene::build(&mut scene, &mut text, &mv, &flags, WIDTH, HEIGHT);

        renderer
            .render_to_texture(
                &device,
                &queue,
                &scene,
                &target_view,
                &RenderParams { base_color, width: WIDTH, height: HEIGHT, antialiasing_method: AaConfig::Area },
            )
            .expect("render_to_texture");

        // Copy the rendered texture into the readback buffer.
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("flag copy-out"),
        });
        encoder.copy_texture_to_buffer(
            wgpu::ImageCopyTexture {
                texture: &target,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            ImageCopyBuffer {
                buffer: &readback,
                layout: ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bpr),
                    rows_per_image: Some(HEIGHT),
                },
            },
            Extent3d { width: WIDTH, height: HEIGHT, depth_or_array_layers: 1 },
        );
        queue.submit([encoder.finish()]);

        // Map, block, read, un-pad rows.
        let slice = readback.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        device.poll(wgpu::Maintain::Wait);
        rx.recv().expect("map channel").expect("map readback buffer");

        let mapped = slice.get_mapped_range();
        let mut rgba = Vec::with_capacity((WIDTH * HEIGHT * 4) as usize);
        for row in 0..HEIGHT {
            let start = (row * padded_bpr) as usize;
            let end = start + unpadded_bpr as usize;
            rgba.extend_from_slice(&mapped[start..end]);
        }
        drop(mapped);
        readback.unmap();

        let path = out_dir.join(format!("frame_{frame:03}.png"));
        let file = std::fs::File::create(&path).expect("create png");
        let w = std::io::BufWriter::new(file);
        let mut enc = png::Encoder::new(w, WIDTH, HEIGHT);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header().expect("png header").write_image_data(&rgba).expect("png data");

        if frame == 0 || frame == FRAMES / 2 {
            eprintln!("[flag] wrote {}", path.display());
        }

        // Pole velocity bleeds off — the flag swing settles, then idles still.
        vx *= DECAY;
        vy *= DECAY;
    }

    eprintln!(
        "[flag] {FRAMES} frames → {}. Assemble GIF: bash scripts/render-gif.sh",
        out_dir.display()
    );
}
