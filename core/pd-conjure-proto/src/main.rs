//! pd-conjure-proto — the VELLO GRAPH slice of Conjure.
//!
//! Renders a `PredictedDag` (from `pd-console::conjure`, fed in as JSON) as a
//! beautiful wave-column node-graph with Vello + Parley, captured OFFSCREEN to a
//! PNG via render-to-texture readback (Method-A). NO window, NO Screen-Recording
//! / TCC permission — this is the Rung-1 path (NOT bare Metal), mirroring the
//! headless capture in `pd-timeline-proto` / `pd-flag-proto`.
//!
//! Stack: wgpu (Metal backend on macOS, headless device — no surface) + Vello
//! (compute-based GPU vector renderer) + Parley (text shaping/layout) + the
//! `png` crate for the readback encode.
//!
//! Usage:
//!   pd-conjure-proto [INPUT.json] [OUTPUT.png]
//! Defaults: bundled `fixture.json` (mirrors `conjure::fixture()`) ->
//! `conjure-dag-vello.png` next to the crate.

mod dag;
mod scene;

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use vello::util::RenderContext;
use vello::wgpu;
use vello::{AaConfig, AaSupport, Renderer, RendererOptions, Scene};
use vello::peniko::Color;

use dag::PredictedDag;
use scene::{build_scene, canvas_for, Canvas, TextEngine};

/// Supersample factor: render at 2x then the PNG is crisp on retina-class
/// displays without the offscreen target ballooning.
const SCALE: f64 = 2.0;

fn main() -> Result<()> {
    // Args: [input.json] [output.png] — both optional.
    let mut args = std::env::args().skip(1);
    let input = args.next();
    let output = args.next();

    let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let input_path = input
        .map(PathBuf::from)
        .unwrap_or_else(|| crate_dir.join("fixture.json"));
    let output_path = output
        .map(PathBuf::from)
        .unwrap_or_else(|| crate_dir.join("conjure-dag-vello.png"));

    println!("[pd-conjure-proto] loading DAG from {}", input_path.display());
    let json = std::fs::read_to_string(&input_path)
        .with_context(|| format!("reading DAG JSON at {}", input_path.display()))?;
    let parsed = dag::parse(&json).context("parsing PredictedDag JSON")?;
    println!(
        "[pd-conjure-proto] \"{}\" — {} waves, {} nodes",
        parsed.title,
        parsed.waves.len(),
        parsed.waves.iter().map(|w| w.nodes.len()).sum::<usize>(),
    );

    render_to_png(&parsed, &output_path)?;

    let bytes = std::fs::metadata(&output_path)
        .map(|m| m.len())
        .unwrap_or(0);
    println!(
        "[pd-conjure-proto] wrote {} ({} bytes)",
        output_path.display(),
        bytes
    );
    Ok(())
}

/// The Method-A offscreen pipeline: headless wgpu device -> Vello
/// `render_to_texture` into an Rgba8Unorm storage texture -> copy to a buffer ->
/// map + read back -> PNG. No surface, no window, so no TCC prompt.
fn render_to_png(parsed: &PredictedDag, output_path: &Path) -> Result<()> {
    // Logical canvas, then the physical (supersampled) target dimensions.
    let canvas: Canvas = canvas_for(parsed);
    let width = (canvas.width * SCALE).ceil() as u32;
    let height = (canvas.height * SCALE).ceil() as u32;
    println!(
        "[pd-conjure-proto] canvas {:.0}x{:.0} logical -> {}x{} px target (scale {SCALE})",
        canvas.width, canvas.height, width, height
    );

    // 1. Headless device: RenderContext::device(None) requests an adapter with
    //    NO compatible surface — the offscreen path. This lands on Metal on
    //    macOS just like the windowed proto, but never opens a window.
    let mut context = RenderContext::new();
    let device_id = pollster::block_on(context.device(None))
        .ok_or_else(|| anyhow::anyhow!("no compatible wgpu adapter for a headless device"))?;
    let device_handle = &context.devices[device_id];
    let device = &device_handle.device;
    let queue = &device_handle.queue;
    {
        let info = device_handle.adapter().get_info();
        println!(
            "[pd-conjure-proto] GPU backend: {:?}  adapter: {}  ({:?})",
            info.backend, info.name, info.device_type
        );
    }

    // 2. A renderer with NO surface_format (surface_format = None ⇒ offscreen
    //    only; render_to_texture needs no blit pipeline).
    eprintln!("[stage] creating renderer (shader compile)…");
    let mut renderer = Renderer::new(
        device,
        RendererOptions {
            surface_format: None,
            use_cpu: false,
            antialiasing_support: AaSupport::area_only(),
            num_init_threads: std::num::NonZeroUsize::new(1), // macOS: single-thread shader init.
        },
    )
    .map_err(|e| anyhow::anyhow!("create vello renderer: {e}"))?;

    // 3. Build the scene in LOGICAL coordinates (text shaped at scale 1.0), then
    //    append it into the physical-size root scene under an `Affine::scale`.
    //    Vello applies that transform before rasterization, so the supersample is
    //    crisp (geometry + glyphs are scaled, then rasterized at the higher
    //    resolution). Drawing logical geometry straight into the physical target
    //    would only fill the top-left 1/SCALE corner — hence this scale wrap.
    eprintln!("[stage] building scene (parley font scan + glyph runs)…");
    let mut logical_scene = Scene::new();
    let mut text = TextEngine::new();
    eprintln!("[stage] text engine ready; laying out scene…");
    build_scene(&mut logical_scene, &mut text, parsed, &canvas, 1.0);
    let mut scene = Scene::new();
    scene.append(
        &logical_scene,
        Some(vello::kurbo::Affine::scale(SCALE)),
    );
    eprintln!("[stage] scene built.");

    // 4. The render target: an Rgba8Unorm texture with STORAGE_BINDING (Vello
    //    writes via a storage image) + COPY_SRC (so we can read it back).
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("conjure-dag-target"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = target.create_view(&wgpu::TextureViewDescriptor::default());

    eprintln!("[stage] render_to_texture…");
    renderer
        .render_to_texture(
            device,
            queue,
            &scene,
            &view,
            &vello::RenderParams {
                base_color: Color::rgb8(0x1e, 0x1b, 0x18), // ebony — match the scene bg.
                width,
                height,
                antialiasing_method: AaConfig::Area,
            },
        )
        .map_err(|e| anyhow::anyhow!("render_to_texture: {e}"))?;
    eprintln!("[stage] render_to_texture returned OK; reading back…");

    // 5. Copy the texture into a readback buffer. wgpu requires the bytes-per-row
    //    to be a multiple of 256, so we pad the row and crop on encode.
    let bytes_per_pixel = 4u32;
    let unpadded_bpr = width * bytes_per_pixel;
    let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT; // 256
    let padded_bpr = ((unpadded_bpr + align - 1) / align) * align;
    let buffer_size = (padded_bpr * height) as u64;

    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("conjure-dag-readback"),
        size: buffer_size,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });

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
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
    queue.submit([encoder.finish()]);

    // 6. Map the buffer, then drive the GPU to completion with a BLOCKING poll.
    //    `device.poll(Maintain::Wait)` synchronously flushes the submitted work
    //    AND fires pending map callbacks — so after it returns the buffer is
    //    mapped. (The earlier `block_on_wgpu(async { rx.recv() })` form
    //    deadlocked: the blocking `recv()` never yields, so the poll loop inside
    //    `block_on_wgpu` never runs, so the map callback never fires.)
    let slice = readback.slice(..);
    let mapped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let map_err = std::sync::Arc::new(std::sync::Mutex::new(None::<wgpu::BufferAsyncError>));
    {
        let mapped = mapped.clone();
        let map_err = map_err.clone();
        slice.map_async(wgpu::MapMode::Read, move |res| {
            if let Err(e) = res {
                *map_err.lock().unwrap() = Some(e);
            }
            mapped.store(true, std::sync::atomic::Ordering::SeqCst);
        });
    }
    // Block until the GPU is idle and the map callback has fired.
    device.poll(wgpu::Maintain::Wait);
    if !mapped.load(std::sync::atomic::Ordering::SeqCst) {
        // One extra wait poll in case the callback is queued for the next tick.
        device.poll(wgpu::Maintain::Wait);
    }
    if let Some(e) = map_err.lock().unwrap().take() {
        return Err(anyhow::anyhow!("map readback buffer: {e}"));
    }

    // 7. Crop the padded rows back to the tight image and write the PNG.
    let data = slice.get_mapped_range();
    let mut rgba = Vec::with_capacity((unpadded_bpr * height) as usize);
    for row in 0..height {
        let start = (row * padded_bpr) as usize;
        let end = start + unpadded_bpr as usize;
        rgba.extend_from_slice(&data[start..end]);
    }
    drop(data);
    readback.unmap();

    write_png(output_path, width, height, &rgba)
        .with_context(|| format!("writing PNG to {}", output_path.display()))?;
    Ok(())
}

/// Encode RGBA8 pixels to a PNG file.
fn write_png(path: &Path, width: u32, height: u32, rgba: &[u8]) -> Result<()> {
    let file = std::fs::File::create(path)?;
    let writer = std::io::BufWriter::new(file);
    let mut encoder = png::Encoder::new(writer, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut w = encoder.write_header()?;
    w.write_image_data(rgba)?;
    Ok(())
}
