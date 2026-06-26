// Glassmorphism / backdrop blur via DUAL-FILTER KAWASE (Bjørge, SIGGRAPH 2015).
// A full-kernel Gaussian over the framebuffer is bandwidth-bound; Kawase does it in
// multi-pass 4-tap bilinear steps, and the dual-filter variant adds a downsample
// chain + symmetric upsample chain so cost scales LOGARITHMICALLY with radius.
// Pipeline per glass panel: copy scene behind panel -> downsample/blur chain ->
// upsample/blur chain -> tint + alpha-composite. Near-constant cost vs panel size.
//
// ⚠️ pd-console relevance is HIGH: true frosted-glass-over-content is a GPUI GAP
//    (its only "blur" is the closed-form drop shadow). To ship real glassmorphism
//    you run this on a clipped copy of the scene framebuffer, then tint.
//
// Source:  https://github.com/alex47/Dual-Kawase-Blur (shaders/dual_kawase_{down,up}.frag)
// License: ⚠️ GPL-3.0 (COPYLEFT). Do NOT paste verbatim into a non-GPL console —
//          REIMPLEMENT the math (5-tap ÷8 down, 8-tap ÷12 up). For a license-clean
//          verbatim WGSL Gaussian, use Ruffle's blur.wgsl (MIT/Apache) instead.
// Reproduced here for the math only. Pulled June 2026.
// halfpixel = 0.5 / textureSize;  offset ≈ 3.0 tunes strength; chains must be symmetric.

// downsample (5 taps, ÷8)
void down() {
    vec2 uv = gl_FragCoord.xy / iResolution;
    vec4 sum = texture2D(tex, uv) * 4.0;
    sum += texture2D(tex, uv - halfpixel.xy * offset);
    sum += texture2D(tex, uv + halfpixel.xy * offset);
    sum += texture2D(tex, uv + vec2(halfpixel.x, -halfpixel.y) * offset);
    sum += texture2D(tex, uv - vec2(halfpixel.x, -halfpixel.y) * offset);
    fColor = sum / 8.0;
}

// upsample (8 taps, ÷12)
void up() {
    vec2 uv = gl_FragCoord.xy / iResolution;
    vec4 sum = texture2D(tex, uv + vec2(-halfpixel.x * 2.0, 0.0) * offset);
    sum += texture2D(tex, uv + vec2(-halfpixel.x, halfpixel.y) * offset) * 2.0;
    sum += texture2D(tex, uv + vec2(0.0, halfpixel.y * 2.0) * offset);
    sum += texture2D(tex, uv + vec2(halfpixel.x, halfpixel.y) * offset) * 2.0;
    sum += texture2D(tex, uv + vec2(halfpixel.x * 2.0, 0.0) * offset);
    sum += texture2D(tex, uv + vec2(halfpixel.x, -halfpixel.y) * offset) * 2.0;
    sum += texture2D(tex, uv + vec2(0.0, -halfpixel.y * 2.0) * offset);
    sum += texture2D(tex, uv + vec2(-halfpixel.x, -halfpixel.y) * offset) * 2.0;
    fColor = sum / 12.0;
}
