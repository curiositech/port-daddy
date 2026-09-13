//! pd-story-linework-proto — headless GPU gallery for pd-console Story Linework.
//!
//! Raw wgpu fragment pass on a full-screen triangle, rendered to an offscreen
//! texture and written as PNG frames. This proves the dither/color-block shader
//! treatment before any GPUI integration work.

use std::path::PathBuf;

use wgpu::{
    Extent3d, ImageCopyBuffer, ImageDataLayout, TextureDescriptor, TextureDimension, TextureFormat,
    TextureUsages,
};

fn env_u32(key: &str, default: u32) -> u32 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn env_f32(key: &str, default: f32) -> f32 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn theme_value() -> f32 {
    match std::env::var("PD_STORY_THEME").as_deref() {
        Ok("light") => 0.0,
        Ok("dark") => 1.0,
        _ => 1.0,
    }
}

fn write_png(path: PathBuf, width: u32, height: u32, rgba: &[u8]) {
    let file = std::fs::File::create(&path).expect("create png");
    let writer = std::io::BufWriter::new(file);
    let mut encoder = png::Encoder::new(writer, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .expect("png header")
        .write_image_data(rgba)
        .expect("png data");
}

fn main() {
    let width = env_u32("PD_STORY_WIDTH", 1280);
    let height = env_u32("PD_STORY_HEIGHT", 720);
    let frames = env_u32("PD_STORY_FRAMES", 90);
    let fps = env_f32("PD_STORY_FPS", 30.0).max(1.0);
    let theme = theme_value();
    let motion = env_f32("PD_STORY_MOTION", 1.0).clamp(0.0, 1.0);
    let out_dir = std::path::Path::new("docs/frames");
    std::fs::create_dir_all(out_dir).expect("create docs/frames");

    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        force_fallback_adapter: false,
    }))
    .expect("no wgpu adapter available");
    eprintln!(
        "[story-linework] adapter: {} ({:?})",
        adapter.get_info().name,
        adapter.get_info().backend
    );

    let (device, queue) = pollster::block_on(adapter.request_device(
        &wgpu::DeviceDescriptor {
            label: Some("pd-story-linework-proto device"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::downlevel_defaults(),
            memory_hints: wgpu::MemoryHints::default(),
        },
        None,
    ))
    .expect("request device");

    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("story_linework.wgsl"),
        source: wgpu::ShaderSource::Wgsl(include_str!("story_linework.wgsl").into()),
    });

    // Uniforms: resolution.xy, time, theme, motion, reserved xyz = 8 f32.
    let uniform_buf = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("story uniforms"),
        size: 32,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("story uniforms bgl"),
        entries: &[wgpu::BindGroupLayoutEntry {
            binding: 0,
            visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        }],
    });
    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("story uniforms bg"),
        layout: &bgl,
        entries: &[wgpu::BindGroupEntry {
            binding: 0,
            resource: uniform_buf.as_entire_binding(),
        }],
    });
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("story pipeline layout"),
        bind_group_layouts: &[&bgl],
        push_constant_ranges: &[],
    });
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("story pipeline"),
        layout: Some(&pipeline_layout),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: "vs_main",
            buffers: &[],
            compilation_options: Default::default(),
        },
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: "fs_main",
            targets: &[Some(wgpu::ColorTargetState {
                format: TextureFormat::Rgba8Unorm,
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            })],
            compilation_options: Default::default(),
        }),
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        multiview: None,
        cache: None,
    });

    let target = device.create_texture(&TextureDescriptor {
        label: Some("story offscreen target"),
        size: Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: TextureDimension::D2,
        format: TextureFormat::Rgba8Unorm,
        usage: TextureUsages::RENDER_ATTACHMENT | TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let target_view = target.create_view(&wgpu::TextureViewDescriptor::default());

    let unpadded_bpr = width * 4;
    let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let padded_bpr = unpadded_bpr.div_ceil(align) * align;
    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("story readback"),
        size: (padded_bpr * height) as u64,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });

    for frame in 0..frames {
        let time = (frame as f32 / fps) * motion;
        let uniforms: [f32; 8] = [
            width as f32,
            height as f32,
            time,
            theme,
            motion,
            0.0,
            0.0,
            0.0,
        ];
        let mut bytes = Vec::with_capacity(32);
        for value in uniforms {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        queue.write_buffer(&uniform_buf, 0, &bytes);

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("story frame"),
        });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("story pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &target_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
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
                    rows_per_image: Some(height),
                },
            },
            Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        queue.submit([encoder.finish()]);

        let slice = readback.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
        device.poll(wgpu::Maintain::Wait);
        rx.recv().expect("map channel").expect("map readback");

        let mapped = slice.get_mapped_range();
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for row in 0..height {
            let start = (row * padded_bpr) as usize;
            rgba.extend_from_slice(&mapped[start..start + unpadded_bpr as usize]);
        }
        drop(mapped);
        readback.unmap();

        let path = out_dir.join(format!("frame_{frame:03}.png"));
        write_png(path.clone(), width, height, &rgba);
        if frame == 0 || frame == frames / 2 {
            eprintln!("[story-linework] wrote {}", path.display());
        }
    }

    eprintln!(
        "[story-linework] {frames} frames -> {}. Assemble GIF: bash scripts/render-gif.sh",
        out_dir.display()
    );
}
