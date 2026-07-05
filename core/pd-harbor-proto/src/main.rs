//! pd-harbor-proto — headless renderer for the pd-console "living harbor" water.
//!
//! A raw wgpu fragment pass (the WGSL in harbor.wgsl) on a full-screen triangle,
//! rendered to an OFFSCREEN texture (no window, no Screen-Recording/TCC), read
//! back per frame, and written as PNGs. scripts/render-gif.sh assembles the GIF.
//! Deterministic: i_time is a synthetic clock (frame / fps).
//!
//! This is the standalone shader surface that proves + records the living-harbor
//! backdrop before it embeds behind the fleet pane (ADR-0086 path 2 render-to-
//! texture). Build/run:  cd core/pd-harbor-proto && cargo run --release

use wgpu::{
    Extent3d, ImageCopyBuffer, ImageDataLayout, TextureDescriptor, TextureDimension, TextureFormat,
    TextureUsages,
};

const WIDTH: u32 = 1000;
const HEIGHT: u32 = 500;
const FRAMES: u32 = 150; // 5s @ 30fps
const THEME: f32 = 1.0; // 1.0 = night harbor (matches pd-console dark maritime)

fn main() {
    let out_dir = std::path::Path::new("docs/frames");
    std::fs::create_dir_all(out_dir).expect("create docs/frames");

    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        force_fallback_adapter: false,
    }))
    .expect("no wgpu adapter (Metal) available");
    eprintln!("[harbor] adapter: {} ({:?})", adapter.get_info().name, adapter.get_info().backend);

    let (device, queue) = pollster::block_on(adapter.request_device(
        &wgpu::DeviceDescriptor {
            label: Some("pd-harbor-proto device"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::downlevel_defaults(),
            memory_hints: wgpu::MemoryHints::default(),
        },
        None,
    ))
    .expect("request_device");

    // ── Shader + uniform buffer + pipeline. ──
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("harbor.wgsl"),
        source: wgpu::ShaderSource::Wgsl(include_str!("harbor.wgsl").into()),
    });

    // Uniforms: [res.x, res.y, time, theme, mouse.xyzw] = 8 f32 = 32 bytes, with
    // the vec4f at offset 16 (std140-compatible for this layout).
    let uniform_buf = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("uniforms"),
        size: 32,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("uniforms-bgl"),
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
        label: Some("uniforms-bg"),
        layout: &bgl,
        entries: &[wgpu::BindGroupEntry { binding: 0, resource: uniform_buf.as_entire_binding() }],
    });
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("harbor-layout"),
        bind_group_layouts: &[&bgl],
        push_constant_ranges: &[],
    });
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("harbor-pipeline"),
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

    // ── Offscreen target + readback buffer. ──
    let target = device.create_texture(&TextureDescriptor {
        label: Some("harbor offscreen target"),
        size: Extent3d { width: WIDTH, height: HEIGHT, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: TextureDimension::D2,
        format: TextureFormat::Rgba8Unorm,
        usage: TextureUsages::RENDER_ATTACHMENT | TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let target_view = target.create_view(&wgpu::TextureViewDescriptor::default());

    let unpadded_bpr = WIDTH * 4;
    let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let padded_bpr = unpadded_bpr.div_ceil(align) * align;
    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("harbor readback"),
        size: (padded_bpr * HEIGHT) as u64,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });

    for frame in 0..FRAMES {
        let time = frame as f32 / 30.0;
        let u: [f32; 8] = [WIDTH as f32, HEIGHT as f32, time, THEME, 0.0, 0.0, 0.0, 0.0];
        let mut bytes = Vec::with_capacity(32);
        for v in u {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        queue.write_buffer(&uniform_buf, 0, &bytes);

        let mut encoder =
            device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("harbor frame") });
        {
            let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("harbor pass"),
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
            rpass.set_pipeline(&pipeline);
            rpass.set_bind_group(0, &bind_group, &[]);
            rpass.draw(0..3, 0..1);
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
                    rows_per_image: Some(HEIGHT),
                },
            },
            Extent3d { width: WIDTH, height: HEIGHT, depth_or_array_layers: 1 },
        );
        queue.submit([encoder.finish()]);

        let slice = readback.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        device.poll(wgpu::Maintain::Wait);
        rx.recv().expect("map channel").expect("map readback");

        let mapped = slice.get_mapped_range();
        let mut rgba = Vec::with_capacity((WIDTH * HEIGHT * 4) as usize);
        for row in 0..HEIGHT {
            let start = (row * padded_bpr) as usize;
            rgba.extend_from_slice(&mapped[start..start + unpadded_bpr as usize]);
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
            eprintln!("[harbor] wrote {}", path.display());
        }
    }

    eprintln!("[harbor] {FRAMES} frames → {}. Assemble GIF: bash scripts/render-gif.sh", out_dir.display());
}
