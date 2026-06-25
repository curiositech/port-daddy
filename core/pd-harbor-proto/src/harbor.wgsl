// Living-harbor water — the ambient backdrop behind the fleet pane.
// Scaffold + helpers + composite scene from the gpui-shaders stockpile (c).
// Brand law: mustard + navy maritime palette, pixelated retro-futurism.

struct Uniforms {
    i_resolution : vec2f,   // framebuffer size in physical px
    i_time       : f32,     // seconds
    i_theme      : f32,     // 0.0 = light, 1.0 = dark
    i_mouse      : vec4f,    // xy cursor, zw last click (unused here)
};
@group(0) @binding(0) var<uniform> U : Uniforms;

// Brand palette roles — the ONLY color literals allowed.
const MUSTARD : vec3f = vec3f(1.000, 0.859, 0.200); // 0xffdb33 — accent / sun
const NAVY    : vec3f = vec3f(0.078, 0.106, 0.180); // 0x141b2e — chrome / night
const SEA     : vec3f = vec3f(0.110, 0.227, 0.369); // 0x1c3a5e — deep water
const FOAM    : vec3f = vec3f(0.812, 0.890, 0.941); // 0xcfe3f0 — crests / haze
const HULL    : vec3f = vec3f(0.090, 0.122, 0.200); // dark navy boat silhouettes

// Full-screen triangle: 3 verts, no vertex buffer.
struct VOut { @builtin(position) pos : vec4f, @location(0) uv : vec2f };
@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VOut {
    let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
    var o : VOut;
    o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
    o.uv  = vec2f(p.x, 1.0 - p.y);
    return o;
}

fn hash21(p : vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}
fn vnoise(p : vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i + vec2f(0.0, 0.0)), hash21(i + vec2f(1.0, 0.0)), u.x),
               mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn fbm(p0 : vec2f) -> f32 {
    var p = p0;
    var a = 0.5;
    var s = 0.0;
    for (var k = 0; k < 5; k = k + 1) { s = s + a * vnoise(p); p = p * 2.02; a = a * 0.5; }
    return s;
}
fn bayer4(p : vec2f) -> f32 {
    let x = u32(p.x) & 3u;
    let y = u32(p.y) & 3u;
    var m = array<f32,16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0,
                          3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    return m[y * 4u + x] / 16.0;
}
fn dither_pick(value : f32, frag : vec2f, lo : vec3f, hi : vec3f) -> vec3f {
    return select(lo, hi, value > bayer4(frag));
}
fn dither_quant(c : vec3f, frag : vec2f, levels : f32) -> vec3f {
    let d = (bayer4(frag) - 0.5) / levels;
    return floor((c + d) * (levels - 1.0) + 0.5) / (levels - 1.0);
}
fn pixelate(frag : vec2f, px : f32) -> vec2f { return floor(frag / px) * px; }

fn sd_box(p : vec2f, b : vec2f) -> f32 {
    let d = abs(p) - b;
    return length(max(d, vec2f(0.0, 0.0))) + min(max(d.x, d.y), 0.0);
}

// A shimmering "road" of light from the sun down the water toward the viewer.
fn sun_glint(uv : vec2f, sun : vec2f, t : f32) -> f32 {
    let dx = abs(uv.x - sun.x);
    let road = exp(-dx * dx * 22.0);
    let ripple = 0.5 + 0.5 * sin(uv.y * 60.0 - t * 3.0 + fbm(uv * 8.0) * 6.0);
    return road * ripple * smoothstep(sun.y, 1.0, uv.y);
}
fn moored_boat(uv : vec2f, cx : f32, sea_y : f32, t : f32, scale : f32) -> f32 {
    let bob = 0.004 * sin(t * 1.2 + cx * 9.0);
    var p = (uv - vec2f(cx, sea_y - bob)) / scale;
    p.x = p.x * (U.i_resolution.x / U.i_resolution.y);
    // NOTE: fs_main samples screen-space (y increases DOWNWARD), so the mast
    // must extend in -y to point UP out of the hull (the stockpile's y-up form
    // would bury it in the water).
    let hull = sd_box(p, vec2f(0.5, 0.12));
    let mast = sd_box(p + vec2f(0.0, 0.5), vec2f(0.03, 0.5));
    return min(hull, mast);
}

// Gerstner-style swell as a screen-space height field: a sum of crossing
// directional sine trains (+ a sharpening harmonic each) → coherent moving
// crests that read at pixel scale, where plain FBM goes to static mud.
// (Reimplemented from first principles — the technique, not anyone's code.)
fn sea_h(p : vec2f, t : f32) -> f32 {
    var dirs = array<vec2f,4>(vec2f(1.0, 0.2), vec2f(0.6, -0.5), vec2f(-0.4, 0.8), vec2f(0.9, 0.5));
    var len  = array<f32,4>(1.0, 0.6, 1.8, 0.4);
    var amp  = array<f32,4>(0.32, 0.18, 0.10, 0.06);
    var spd  = array<f32,4>(0.5, 0.9, 0.3, 1.4);
    var h = 0.0;
    for (var i = 0u; i < 4u; i = i + 1u) {
        let d = normalize(dirs[i]);
        let k = 6.2831853 / len[i];
        let ph = dot(d, p) * k + t * spd[i];
        h = h + amp[i] * sin(ph);
        h = h + amp[i] * 0.3 * sin(ph * 2.1 + 1.1);
    }
    return h;
}

@fragment
fn fs_main(in : VOut) -> @location(0) vec4f {
    let CHUNK = 4.0;
    let frag = pixelate(in.pos.xy, CHUNK);
    let res  = U.i_resolution;
    let uv   = frag / res;
    let t    = U.i_time;
    let night = U.i_theme > 0.5;

    let sea_y = 0.62;
    let sun   = vec2f(0.5 + 0.12 * sin(t * 0.05), 0.30);

    var col : vec3f;
    if (uv.y < sea_y) {
        let g = uv.y / sea_y; // 0 at zenith .. 1 at the sea line
        // Night: a dark navy gradient (no dawn mustard — that muddied the horizon).
        // Day: the dawn wash from foam sky to a mustard horizon.
        var sky : vec3f;
        if (night) {
            sky = mix(NAVY * 0.55, NAVY * 1.2, g);
        } else {
            sky = mix(FOAM, MUSTARD, smoothstep(0.55, 1.0, g) * 0.7);
        }
        col = dither_quant(sky, frag, 4.0);
        let d = length((uv - sun) * vec2f(res.x / res.y, 1.0));
        col = mix(col, MUSTARD, smoothstep(0.075, 0.055, d)); // disk
        col = mix(col, MUSTARD, smoothstep(0.20, 0.0, d) * 0.25); // halo
        if (night) {
            let s = step(0.985, hash21(frag)) * step(0.5, hash21(frag + 7.0));
            col = mix(col, FOAM, s); // sparse dithered stars
        }
    } else {
        // ── Richer water (ShaderToy-inspired techniques, reimplemented):
        //    Gerstner height field + slope shading + fresnel horizon + foam from
        //    wave curvature + a sharp specular sun-spark on crests. ──
        // Bigger, gentler swells so the surface stays a calm dark backdrop.
        let sp = vec2f(uv.x * 4.0, (uv.y - sea_y) * 6.0);
        let h  = sea_h(sp, t);
        let e  = 0.07;
        let hl = sea_h(sp - vec2f(e, 0.0), t);
        let hr = sea_h(sp + vec2f(e, 0.0), t);
        let hd = sea_h(sp - vec2f(0.0, e), t);
        let hu = sea_h(sp + vec2f(0.0, e), t);
        let slope = (hr - hl) + (hu - hd);
        let lap = hl + hr + hd + hu - 4.0 * h; // curvature → breaking foam

        // Slope-shaded dark water: troughs sink to deep navy, faces lift only a
        // little toward SEA (dimmed) so crests don't blow out.
        let shade = clamp(0.5 - slope * 0.9, 0.0, 1.0);
        var base = mix(NAVY * 0.5, mix(SEA, NAVY, 0.35), shade);

        // Fresnel-ish horizon glow: grazing angles near the sea line warm toward
        // the sun's mustard — the ocean "breathes" without extra geometry.
        let depth = clamp((uv.y - sea_y) / (1.0 - sea_y), 0.0, 1.0);
        let fres = pow(1.0 - depth, 3.0);
        base = mix(base, mix(base, MUSTARD, 0.5), fres * 0.28);

        // Foam only on the SHARPEST breaking crests, sparsely dithered.
        let foam = smoothstep(0.16, 0.30, lap) * step(bayer4(frag), 0.38);
        var water = mix(base, FOAM, foam);

        // Sun-glint road + a sharp specular spark where the glint rides a crest.
        let glint = sun_glint(uv, sun, t);
        water = mix(water, MUSTARD, smoothstep(0.45, 0.9, glint) * 0.55);
        let crest = smoothstep(0.26, 0.52, h);
        let spark = pow(glint, 6.0) * crest;
        water = mix(water, MUSTARD, clamp(spark * 2.0, 0.0, 0.85));

        col = dither_quant(water, frag, 5.0);
    }

    let b0 = moored_boat(uv, 0.22, sea_y, t, 0.10);
    let b1 = moored_boat(uv, 0.74, sea_y, t, 0.135);
    let b2 = moored_boat(uv, 0.50, sea_y, t, 0.085);
    col = select(col, HULL, min(min(b0, b1), b2) < 0.0);
    return vec4f(col, 1.0);
}
