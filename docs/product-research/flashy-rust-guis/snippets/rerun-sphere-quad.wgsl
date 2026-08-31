// Rerun's re_renderer: point clouds = instanced billboarded quads expanded in the
// VERTEX shader (not compute, not GL points). Each point becomes a 6-vertex quad;
// the vertex shader spans a camera-facing billboard — a true perspective sphere
// impostor, or a flat circle for orthographic/flagged points. This is why Rerun's
// points look like shaded spheres, and it's the blueprint for a gpui console's
// data-viewport rendering (immediate/retained chrome around GPU-rendered viewports
// stitched in via egui_wgpu-style paint callbacks, with pooled resources + a
// jump-flood (JFA) selection outline pass).
//
// Source:  https://github.com/rerun-io/rerun/blob/main/crates/viewer/re_renderer/shader/utils/sphere_quad.wgsl
// License: MIT OR Apache-2.0 (Rerun Technologies AB). Pulled June 2026.
// ⚠️ Came via WebFetch summarizer; for byte-exactness curl the raw URL above.

fn sphere_quad_index(vertex_idx: u32) -> u32 {
    return vertex_idx / 6u;
}

fn sphere_or_circle_quad_span(vertex_idx: u32, point_pos: vec3f, world_radius: f32, force_circle: bool) -> SphereQuadData {
    let local_idx = vertex_idx % 6u;
    let top_bottom = f32(local_idx <= 1u || local_idx == 5u) * 2.0 - 1.0;
    let left_right = f32(vertex_idx % 2u) * 2.0 - 1.0;

    var pos: vec3f;
    if is_camera_orthographic() || force_circle {
        pos = circle_quad(point_pos, world_radius, top_bottom, left_right);
    } else {
        let to_camera = frame.camera_position - point_pos;
        let camera_distance = length(to_camera);
        pos = sphere_quad(point_pos, world_radius, top_bottom, left_right, to_camera, camera_distance);
    }
    return SphereQuadData(pos, world_radius);
}
