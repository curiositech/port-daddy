// gpui rounded-rect SDF + Oklab gradient interpolation.
//
// quad_sdf is the signed-distance function GPUI uses for EVERY rounded panel,
// button, and pill — fill + antialiasing fall out of the distance for free.
// The Oklab path is the real "OKLCH" story in GPUI: themes are authored in hex,
// but GPUI interpolates gradient stops in perceptual Oklab space on the GPU when
// `ColorSpace::Oklab` is selected (so saturated hue ramps don't gray out mid-mix).
//
// Source:  https://github.com/zed-industries/zed/blob/main/crates/gpui_wgpu/src/shaders.wgsl
// License: Apache-2.0 (gpui crate). Pulled June 2026.

fn quad_sdf(point: vec2<f32>, bounds: Bounds, corner_radii: Corners) -> f32 {
    let half_size = bounds.size / 2.0;
    let center = bounds.origin + half_size;
    let center_to_point = point - center;
    let corner_radius = pick_corner_radius(center_to_point, corner_radii);
    let corner_to_point = abs(center_to_point) - half_size;
    let corner_center_to_point = corner_to_point + corner_radius;
    return quad_sdf_impl(corner_center_to_point, corner_radius);
}

fn quad_sdf_impl(corner_center_to_point: vec2<f32>, corner_radius: f32) -> f32 {
    if (corner_radius == 0.0) {
        // fast path for sharp corners
        return max(corner_center_to_point.x, corner_center_to_point.y);
    } else {
        let signed_distance_to_inset_quad =
            length(max(vec2<f32>(0.0), corner_center_to_point)) +
            min(0.0, max(corner_center_to_point.x, corner_center_to_point.y));
        return signed_distance_to_inset_quad - corner_radius;
    }
}

// --- Oklab perceptual gradient interpolation (abridged) ---
// Reference: https://bottosson.github.io/posts/oklab/
fn linear_srgb_to_oklab(color: vec4<f32>) -> vec4<f32> { /* matrix + cbrt; see source */ }
fn oklab_to_linear_srgb(color: vec4<f32>) -> vec4<f32> { /* inverse matrix; see source */ }

// In the gradient fragment path, GPUI switches on background.color_space:
//   0 = sRGB           -> mix(color0, color1, t)
//   1 = Oklab          -> oklab_to_linear_srgb(mix(oklab0, oklab1, t))
// The `t` is the gradient parameter along the angle.
