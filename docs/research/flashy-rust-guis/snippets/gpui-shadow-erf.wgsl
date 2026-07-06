// gpui closed-form drop shadow (Gaussian-of-a-box via the error function).
// This is how Zed/GPUI gets soft, antialiased, rounded drop shadows with NO
// multi-tap blur kernel — only 4 samples along one axis. It also handles inset
// shadows. NOTE: this is a *shadow* blur (analytic blur of a known box shape),
// NOT a backdrop/content blur. True glassmorphism over live content is a GPUI gap.
//
// Source:  https://github.com/zed-industries/zed/blob/main/crates/gpui_wgpu/src/shaders.wgsl
//          (raw: https://raw.githubusercontent.com/zed-industries/zed/main/crates/gpui_wgpu/src/shaders.wgsl)
//          The macOS Metal twin lives at crates/gpui_macos/src/shaders.metal
// License: Apache-2.0 (the `gpui` crate; verified in crates/gpui/Cargo.toml)
// Pulled:  June 2026. Backends moved to gpui_wgpu / gpui_macos crates; the old
//          crates/gpui/src/platform/blade/shaders.wgsl path from the 2023 blog 404s.

// A standard gaussian function, used for weighting samples
fn gaussian(x: f32, sigma: f32) -> f32 {
    return exp(-(x * x) / (2.0 * sigma * sigma)) / (sqrt(2.0 * M_PI_F) * sigma);
}

// This approximates the error function, needed for the gaussian integral
fn erf(v: vec2<f32>) -> vec2<f32> {
    let s = sign(v);
    let a = abs(v);
    let r1 = 1.0 + (0.278393 + (0.230389 + (0.000972 + 0.078108 * a) * a) * a) * a;
    let r2 = r1 * r1;
    return s - s / (r2 * r2);
}

fn blur_along_x(x: f32, y: f32, sigma: f32, corner: f32, half_size: vec2<f32>) -> f32 {
    let delta = min(half_size.y - corner - abs(y), 0.0);
    let curved = half_size.x - corner + sqrt(max(0.0, corner * corner - delta * delta));
    let integral = 0.5 + 0.5 * erf((x + vec2<f32>(-curved, curved)) * (sqrt(0.5) / sigma));
    return integral.y - integral.x;
}

@fragment
fn fs_shadow(input: ShadowVarying) -> @location(0) vec4<f32> {
    if (any(input.clip_distances < vec4<f32>(0.0))) { return vec4<f32>(0.0); }

    let shadow = b_shadows[input.shadow_id];
    let half_size = shadow.bounds.size / 2.0;
    let center = shadow.bounds.origin + half_size;
    let center_to_point = input.position.xy - center;
    let corner_radius = pick_corner_radius(center_to_point, shadow.corner_radii);

    var alpha: f32;
    if (shadow.blur_radius == 0.0) {
        let distance = quad_sdf(input.position.xy, shadow.bounds, shadow.corner_radii);
        alpha = saturate(0.5 - distance);
    } else {
        let low  = center_to_point.y - half_size.y;
        let high = center_to_point.y + half_size.y;
        let start = clamp(-3.0 * shadow.blur_radius, low, high);
        let end   = clamp( 3.0 * shadow.blur_radius, low, high);
        let step = (end - start) / 4.0;
        var y = start + step * 0.5;
        alpha = 0.0;
        for (var i = 0; i < 4; i += 1) {           // only 4 samples needed
            let blur = blur_along_x(center_to_point.x, center_to_point.y - y,
                shadow.blur_radius, corner_radius, half_size);
            alpha += blur * gaussian(y, shadow.blur_radius) * step;
            y += step;
        }
    }

    if (shadow.inset != 0u) {
        alpha = 1.0 - alpha;
        let element_distance = quad_sdf(input.position.xy, shadow.element_bounds,
                                        shadow.element_corner_radii);
        alpha *= saturate(0.5 - element_distance);
    }
    return blend_color(input.color, alpha);
}
