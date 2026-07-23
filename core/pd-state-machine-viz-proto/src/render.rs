//! P2 — headless self-capture: a single-frame render to PNG.
//!
//! A near-verbatim fork of pd-timeline-proto's `render_offscreen`'s device/
//! texture/readback plumbing (surfaceless `context.device(None)`, the
//! Rgba8Unorm + STORAGE_BINDING|COPY_SRC target, `render_to_texture`,
//! `copy_texture_to_buffer` with 256-aligned `padded_bytes_per_row`, and
//! `map_async` + `device.poll(Wait)` + row-unpad on readback) — see that
//! file for the extended commentary on why each step is shaped the way it
//! is. The only structural change: one frame instead of an N-frame sweep, and
//! a `png::Encoder` sink instead of an ffmpeg pipe (a still image has no use
//! for a video encoder). No window, no winit, no Screen-Recording (TCC)
//! permission — `context.device(None)` opens a wgpu device with no
//! compatible surface at all.

use std::io::BufWriter;

use anyhow::{Context, Result};
use vello::peniko::Color;
use vello::util::RenderContext;
use vello::wgpu;
use vello::{AaConfig, Renderer, RendererOptions, Scene};

use crate::model::StateGraph;
use crate::scene::{build_scene, Layoutspec, TextEngine};

/// Render dimensions + scale for a headless capture. Mirrors
/// pd-timeline-proto's `PD_TIMELINE_RENDER_W/H/SCALE` env-var knobs, exposed
/// here as a plain struct so both the CLI (`main.rs`) and tests
/// (`tests/self_capture.rs`) can set them without going through env vars.
#[derive(Debug, Clone, Copy)]
pub struct RenderSpec {
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

impl Default for RenderSpec {
    fn default() -> Self {
        Self {
            width: 2400,
            height: 1000,
            scale: 2.0,
        }
    }
}

/// Single-frame headless render: build one scene at `playhead_frac`, render
/// it into an offscreen wgpu texture, read it back, and write a PNG at
/// `out_path`. Requires a real GPU device (Metal on macOS) — there is no
/// software fallback, matching pd-timeline-proto.
pub fn render_png(
    graph: &StateGraph,
    playhead_frac: f64,
    spec: RenderSpec,
    out_path: &str,
) -> Result<()> {
    let RenderSpec {
        width,
        height,
        scale,
    } = spec;

    // A device with NO compatible surface — the headless seam. Resolves to
    // Metal under the hood on macOS.
    let mut context = RenderContext::new();
    let dev_id = pollster::block_on(context.device(None))
        .context("no compatible wgpu device for headless render")?;
    let device = &context.devices[dev_id].device;
    let queue = &context.devices[dev_id].queue;
    let info = context.devices[dev_id].adapter().get_info();
    println!(
        "[render] headless via {:?} on '{}' — {width}x{height}@{scale}x -> {out_path}",
        info.backend, info.name
    );

    let mut renderer = Renderer::new(
        device,
        RendererOptions {
            surface_format: None,
            use_cpu: false,
            antialiasing_support: vello::AaSupport::area_only(),
            num_init_threads: None,
        },
    )
    .map_err(|e| anyhow::anyhow!("create headless renderer: {e}"))?;

    // Vello's render_to_texture writes via a compute storage binding, so the
    // target MUST be Rgba8Unorm + STORAGE_BINDING. COPY_SRC lets us read it back.
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("pd-smv offscreen"),
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
    let target_view = target.create_view(&wgpu::TextureViewDescriptor::default());

    // copy_texture_to_buffer requires bytes_per_row aligned to 256; unpad on
    // readback (skipping this is the classic "sheared image" bug).
    let unpadded_bpr = width * 4;
    let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let padded_bpr = unpadded_bpr.div_ceil(align) * align;
    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("pd-smv readback"),
        size: (padded_bpr as u64) * (height as u64),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    let mut scene = Scene::new();
    let mut text = TextEngine::new();
    let layout_spec = Layoutspec {
        width: width as f64 / scale,
        height: height as f64 / scale,
        left_gutter: 32.0,
        top_pad: 100.0,
        bottom_pad: 48.0,
        timeline_h: 64.0,
        scale,
    };
    build_scene(&mut scene, &mut text, graph, &layout_spec, playhead_frac);

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
        .map_err(|e| anyhow::anyhow!("render_to_texture: {e}"))?;

    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("readback"),
    });
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

    let slice = readback.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |r| {
        let _ = tx.send(r);
    });
    device.poll(wgpu::Maintain::Wait);
    rx.recv()
        .context("map channel")?
        .context("map readback buffer")?;

    let mut rgba = vec![0u8; (unpadded_bpr as usize) * (height as usize)];
    {
        let data = slice.get_mapped_range();
        for row in 0..height as usize {
            let src_start = row * padded_bpr as usize;
            let src_end = src_start + unpadded_bpr as usize;
            let dst_start = row * unpadded_bpr as usize;
            let dst_end = dst_start + unpadded_bpr as usize;
            rgba[dst_start..dst_end].copy_from_slice(&data[src_start..src_end]);
        }
    }
    readback.unmap();

    if let Some(parent) = std::path::Path::new(out_path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating output dir {}", parent.display()))?;
        }
    }
    let file = std::fs::File::create(out_path).with_context(|| format!("creating {out_path}"))?;
    let w = BufWriter::new(file);
    let mut png_encoder = png::Encoder::new(w, width, height);
    png_encoder.set_color(png::ColorType::Rgba);
    png_encoder.set_depth(png::BitDepth::Eight);
    let mut writer = png_encoder.write_header().context("writing PNG header")?;
    writer
        .write_image_data(&rgba)
        .context("writing PNG image data")?;

    println!("[render] done -> {out_path}");
    Ok(())
}
