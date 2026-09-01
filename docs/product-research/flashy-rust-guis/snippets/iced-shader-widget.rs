// iced: the `shader` widget drops a RAW wgpu render pass inside the retained UI
// tree. Implement shader::Program (state -> Primitive each frame) and
// shader::Primitive (prepare() uploads GPU buffers, render() issues the draw).
// The flagship `custom_shader` example renders up to 500 lit, rotating,
// reflective/refractive glass cubes over a cubemap sky with volumetric fog.
//
// This prepare()/render() split — build instance buffers from app state, then
// issue one instanced wgpu draw into a composited target — is exactly the seam a
// gpui console needs for a live shader panel. The accompanying WGSL is liftable
// wholesale into gpui's wgpu backend (see iced-cubes.wgsl).
//
// Source:  https://github.com/iced-rs/iced/blob/master/examples/custom_shader/src/scene.rs
//          https://github.com/iced-rs/iced/blob/master/examples/custom_shader/src/main.rs
// License: MIT (iced-rs/iced). Pulled June 2026.

impl<Message> shader::Program<Message> for Scene {
    type State = ();
    type Primitive = Primitive;

    fn draw(&self, _state: &Self::State, _cursor: mouse::Cursor, bounds: Rectangle) -> Self::Primitive {
        Primitive::new(&self.cubes, &self.camera, bounds, self.show_depth_buffer, self.light_color)
    }
}

impl shader::Primitive for Primitive {
    type Pipeline = Pipeline;

    fn prepare(&self, pipeline: &mut Pipeline, device: &wgpu::Device, queue: &wgpu::Queue,
               _bounds: &Rectangle, viewport: &Viewport) {
        pipeline.update(device, queue, viewport.physical_size(), &self.uniforms,
                        self.cubes.len(), &self.cubes);
    }

    fn render(&self, pipeline: &Pipeline, encoder: &mut wgpu::CommandEncoder,
              target: &wgpu::TextureView, clip_bounds: &Rectangle<u32>) {
        pipeline.render(target, encoder, *clip_bounds, self.cubes.len() as u32, self.show_depth_buffer);
    }
}

// Dropping it into the view is one line; drive animation from a frame subscription:
//   use iced::widget::shader;
//   let shader = shader(&self.scene).width(Fill).height(Fill);
//   // subscription(): window::frames().map(Message::Tick)
