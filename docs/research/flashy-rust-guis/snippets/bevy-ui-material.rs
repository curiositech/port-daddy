// Bevy UI: the cleanest "custom WGSL bound to a UI node" API in the Rust field —
// UiMaterial + AsBindGroup. #[derive(AsBindGroup)] generates the wgpu bind-group
// layout from #[uniform(N)]/#[texture(N)]/#[sampler(N)] -> binding N on @group(1)
// (group 0 = Bevy view data). The fragment shader gets bevy_ui::UiVertexOutput
// (interpolated uv, node size, border_widths, border_radius) for SDF rounded
// corners. The @group(1) convention + the SDF-border math port almost verbatim to
// gpui's wgpu backend as a custom quad/panel-chrome shader.
//
// Source:  https://raw.githubusercontent.com/bevyengine/bevy/main/examples/ui/ui_material.rs
//          shader: assets/shaders/custom_ui_material.wgsl  (see bevy-ui-material.wgsl)
// License: MIT OR Apache-2.0 (Bevy). Pulled June 2026.

#[derive(AsBindGroup, Asset, TypePath, Debug, Clone)]
struct CustomUiMaterial {
    #[uniform(0)] color: Vec4,
    #[uniform(1)] slider: Vec4,         // Vec4: webgl2 needs 16-byte-aligned uniforms
    #[texture(2)] #[sampler(3)] color_texture: Handle<Image>,
    #[uniform(4)] border_color: Vec4,
}
impl UiMaterial for CustomUiMaterial {
    fn fragment_shader() -> ShaderRef { SHADER_ASSET_PATH.into() }
}

// Animate the material every frame -> animated rainbow progress banner with glow.
fn animate(mut materials: ResMut<Assets<CustomUiMaterial>>,
           q: Query<&MaterialNode<CustomUiMaterial>>, time: Res<Time>) {
    let duration = 2.0;
    for handle in &q {
        if let Some(mut material) = materials.get_mut(handle) {
            let new_color = Color::hsl((time.elapsed_secs() * 60.0) % 360.0, 1., 0.5);
            let border_color = Color::hsl((time.elapsed_secs() * 60.0) % 360.0, 0.75, 0.75);
            material.color = new_color.to_linear().to_vec4();
            material.slider.x = ((time.elapsed_secs() % (duration * 2.0)) - duration).abs() / duration;
            material.border_color = border_color.to_linear().to_vec4();
        }
    }
}
// Register with UiMaterialPlugin::<CustomUiMaterial>::default();
// Spawn with MaterialNode(materials.add(...)) on a Node with border + border_radius.
//
// No-shader alternative (Bevy 0.16+): BackgroundGradient(Vec<Gradient>) with
// LinearGradient / RadialGradient / ConicGradient, plus BoxShadow + border-radius.
