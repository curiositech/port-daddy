// Bevy custom_ui_material.wgsl — SDF rounded-corner border + textured progress
// fill on a UI node. The @group(1) uniform convention and the rounded-corner SDF
// in fragment space drop straight into a gpui wgpu custom shader for glowing /
// animated panel chrome. (gpui already does its own SDF rounded rects; this is a
// portable reference for borders that respect per-corner radii.)
//
// Source:  https://raw.githubusercontent.com/bevyengine/bevy/main/assets/shaders/custom_ui_material.wgsl
// License: MIT OR Apache-2.0 (Bevy). Pulled June 2026.

#import bevy_ui::ui_vertex_output::UiVertexOutput

@group(1) @binding(0) var<uniform> color: vec4<f32>;
@group(1) @binding(1) var<uniform> slider: vec4<f32>;
@group(1) @binding(2) var material_color_texture: texture_2d<f32>;
@group(1) @binding(3) var material_color_sampler: sampler;
@group(1) @binding(4) var<uniform> border_color: vec4<f32>;

@fragment
fn fragment(in: UiVertexOutput) -> @location(0) vec4<f32> {
    let half_size = 0.5 * in.size;
    let p = in.uv * in.size - half_size;
    let b = vec2(
        select(in.border_widths.x, in.border_widths.z, 0. < p.x),
        select(in.border_widths.y, in.border_widths.w, 0. < p.y));
    let d = half_size - abs(p);
    if d.x < b.x || d.y < b.y {
        let rs = select(in.border_radius.xy, in.border_radius.wz, 0.0 < p.y);
        let radius = select(rs.x, rs.y, 0.0 < p.x);
        let q = radius - d;
        if radius < min(max(q.x, q.y), 0.0) + length(vec2(max(q.x, 0.0), max(q.y, 0.0))) {
            return vec4(0.0);
        } else { return border_color; }
    }
    if in.uv.x < slider.x {
        return textureSample(material_color_texture, material_color_sampler, in.uv) * color;
    } else { return vec4(0.0); }
}
