// harbor.wgsl — the living-harbor backdrop (ADR-0086 path 3 companion now,
// path 2 render-to-texture embed later). Pixelated + dithered retro-futurism on
// the maritime palette. Ship target: a companion winit+wgpu window (kept OUT of
// the Linux CI workspace, like pd-timeline-proto, so the rust-console gate never
// compiles wgpu). A faithful WebGL preview of this exact effect is in
// ~/coding/tmp/console-mock/harbor-preview.html.
//
// Rules honored (gpui-shaders skill):
//   • Earns the pass — domain-warped fbm water + glint + per-pixel dither.
//   • Color from u.accent (the gpui theme token), never hardcoded brand hex.
//   • time is the ONLY animation input → reduced-motion freezes it to a still.
//   • Pixelate first (fat pixels) → fewer fragments; fbm capped at 5 octaves.
//   • Dither LUMINANCE (Bayer 4x4), not per-RGB — clean retro dissolve.

struct Uniforms {
    time:   f32,
    _pad0:  f32,
    res:    vec2<f32>,
    mouse:  vec2<f32>,
    accent: vec4<f32>,   // theme token (xyz = rgb, w unused) — push from current_theme().accent
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn hash(p_in: vec2<f32>) -> f32 {
    var p = fract(p_in * vec2<f32>(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}
fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p); var f = fract(p); f = f * f * (3.0 - 2.0 * f);
    let a = hash(i); let b = hash(i + vec2<f32>(1.0, 0.0));
    let c = hash(i + vec2<f32>(0.0, 1.0)); let d = hash(i + vec2<f32>(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
fn fbm(p_in: vec2<f32>) -> f32 {
    var v = 0.0; var a = 0.5; var p = p_in;
    for (var i = 0; i < 5; i = i + 1) { v += a * noise(p); p *= 2.02; a *= 0.5; }
    return v;
}
// 4x4 Bayer threshold (ordered dither on luminance).
fn bayer(p: vec2<f32>) -> f32 {
    let m = array<f32,16>(0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
    let x = i32(p.x) % 4; let y = i32(p.y) % 4;
    return m[y * 4 + x] / 16.0;
}

@fragment
fn fs_main(@builtin(position) frag_in: vec4<f32>) -> @location(0) vec4<f32> {
    let PX = 4.0;                                   // pixelate: fat pixels
    let frag = floor(frag_in.xy / PX) * PX;
    let p = (frag - 0.5 * u.res) / u.res.y;
    let accent = u.accent.xyz;
    let horizon = 0.18;

    // water: domain-warped fbm swells
    let q = vec2<f32>(fbm(p * 3.0 + u.time * 0.05), fbm(p * 3.0 - u.time * 0.04));
    let w = fbm(p * 4.0 + 4.0 * q + vec2<f32>(0.0, u.time * 0.12));
    let deep = vec3<f32>(0.06, 0.09, 0.16);
    let shallow = vec3<f32>(0.10, 0.16, 0.28);
    let depth = smoothstep(-0.5, horizon, p.y);
    var col = mix(deep, shallow, depth) + w * 0.10 * shallow;

    // sun disc + glittering path (accent token)
    let sun = vec2<f32>(0.0, horizon + 0.02);
    col = mix(col, accent, smoothstep(0.10, 0.0, length(p - sun)));
    let glint = pow(max(0.0, 1.0 - abs(p.y - horizon) * 6.0), 2.0) * (0.5 + 0.5 * w);
    col += accent * glint * 0.35 * smoothstep(0.6, 0.0, abs(p.x));

    // sky + faint stars above the horizon
    if (p.y > horizon) {
        col = mix(vec3<f32>(0.05,0.05,0.07), vec3<f32>(0.09,0.09,0.12), smoothstep(horizon,0.6,p.y));
        if (hash(frag) > 0.997) { col += vec3<f32>(0.6); }
    }

    // biofield: the fleet as drifting bioluminescent lights.
    // (In the real build, push per-agent positions/colors from daemon state;
    //  i==0 = blocked-on-you → pink. Here a procedural stand-in.)
    for (var i = 0; i < 5; i = i + 1) {
        let fi = f32(i);
        let lp = vec2<f32>(sin(u.time * 0.2 + fi * 1.7) * 0.6,
                           -0.1 - fi * 0.06 + sin(u.time * 0.3 + fi) * 0.02);
        let ld = length(p - lp);
        var lc = mix(accent, vec3<f32>(0.43, 0.83, 0.66), fi / 4.0);
        if (i == 0) { lc = vec3<f32>(0.95, 0.39, 0.46); }   // blocked → pink
        col += lc * smoothstep(0.045, 0.0, ld) * 0.9;
        col += lc * smoothstep(0.14, 0.0, ld) * 0.10;
    }

    // dither luminance to ~5 bands → clean retro dissolve
    let lum = dot(col, vec3<f32>(0.299, 0.587, 0.114));
    let bands = 5.0;
    let dithered = floor(lum * bands + bayer(frag / PX)) / bands;
    if (lum > 0.001) { col *= dithered / lum; }

    return vec4<f32>(col, 1.0);
}
