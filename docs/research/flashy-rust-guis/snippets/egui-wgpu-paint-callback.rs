// egui: the canonical "embed a custom wgpu shader in a UI rect" pattern, via
// egui_wgpu::CallbackTrait. This is the same architecture Rerun uses to composite
// its 3D viewports into an egui UI. Three stages: prepare (upload uniforms / build
// command buffers) -> finish_prepare (once) -> paint (issue draws into egui's own
// `wgpu::RenderPass`, scissored to the widget rect). GPU resources (pipeline, bind
// group, uniform buffer) live in a render-lifetime type-map, NOT in app state.
//
// gpui mirrors this contract on the same wgpu/Metal stack — wrap each custom
// element's shader draws in a prepare/paint pair against the shared device/queue.
//
// Source:  https://github.com/emilk/egui/blob/main/crates/egui_demo_app/src/apps/custom3d_wgpu.rs
//          shader: .../custom3d_wgpu_shader.wgsl
// License: MIT OR Apache-2.0 (egui). Pulled June 2026.
// PATH NOTE: default branch is `main`; the wgpu example lives in egui_demo_app,
//            NOT eframe/examples (the eframe one is the glow/OpenGL sibling).

impl egui_wgpu::CallbackTrait for CustomTriangleCallback {
    fn prepare(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        _screen_descriptor: &egui_wgpu::ScreenDescriptor,
        _egui_encoder: &mut wgpu::CommandEncoder,
        resources: &mut egui_wgpu::CallbackResources,
    ) -> Vec<wgpu::CommandBuffer> {
        let resources: &TriangleRenderResources = resources.get().unwrap();
        resources.prepare(device, queue, self.angle);
        Vec::new()
    }

    fn paint(
        &self,
        _info: egui::PaintCallbackInfo,
        render_pass: &mut wgpu::RenderPass<'static>,
        resources: &egui_wgpu::CallbackResources,
    ) {
        let resources: &TriangleRenderResources = resources.get().unwrap();
        resources.paint(render_pass);
    }
}

impl Custom3d {
    fn custom_painting(&mut self, ui: &mut egui::Ui) {
        let (rect, response) = ui.allocate_exact_size(egui::Vec2::splat(300.0), egui::Sense::drag());
        self.angle += response.drag_motion().x * 0.01;
        ui.painter().add(egui_wgpu::Callback::new_paint_callback(
            rect, CustomTriangleCallback { angle: self.angle }));
    }
}

impl TriangleRenderResources {
    fn prepare(&self, _device: &wgpu::Device, queue: &wgpu::Queue, angle: f32) {
        queue.write_buffer(&self.uniform_buffer, 0, bytemuck::cast_slice(&[angle, 0.0, 0.0, 0.0]));
    }
    fn paint(&self, render_pass: &mut wgpu::RenderPass<'_>) {
        render_pass.set_pipeline(&self.pipeline);
        render_pass.set_bind_group(0, &self.bind_group, &[]);
        render_pass.draw(0..3, 0..1);
    }
}
