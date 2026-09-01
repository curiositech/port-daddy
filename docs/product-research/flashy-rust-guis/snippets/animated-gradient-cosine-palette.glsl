// Animated gradients via Inigo Quilez's cosine palette: a + b*cos(2π*(c*t + d)).
// C-infinity continuous, periodic, banding-free — one quad, no geometry, a `time`
// uniform shifts the whole color field. The living-backdrop primitive for a console
// (telemetry wash, status/heatmap ramps). Best fed through OKLab (see oklab-color.glsl)
// so the wash never muddies between stops.
//
// Source:  https://iquilezles.org/articles/palettes/
// License: MIT (IQ site-wide code policy; no inline header — confirm if provenance
//          must be airtight). Pulled June 2026.

vec3 palette(in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d) {
    return a + b * cos(6.283185 * (c * t + d));
}

// Example coefficient sets (a, b, c, d):
//   a=0.5  b=0.5  c=1.0  d=(0.00, 0.33, 0.67)   // full rainbow
//   a=0.5  b=0.5  c=1.0  d=(0.00, 0.10, 0.20)   // warm sweep
//   a=0.8  b=0.2  c=2.0  d=(0.00, 0.25, 0.25)   // tight two-tone

// Drive `t` by time for motion (standard idiom, not verbatim from the page):
//   vec3 col = palette(uv.x + iTime * 0.1,
//                      vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));
// WGSL port is mechanical: cos(6.283185 * (c*t + d)), return vec3<f32>.
