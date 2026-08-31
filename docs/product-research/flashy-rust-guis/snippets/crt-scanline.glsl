// CRT / cassette-futurism post effect: barrel curvature + scanlines + edge cutoff.
// For a "retro operator console" identity, run this as a full-screen post pass over
// the composited UI. Honesty note: in a ratatui TUI, retro glow comes from the host
// TERMINAL's shader, not the app. The genuine Rust+wgpu CRT-terminal path is Rio
// (raphamorim/rio) consuming RetroArch .slang presets via librashader.
//
// Source:  https://github.com/wessles/GLSL-CRT/blob/master/shader.frag
// License: MIT (in-file header © 2015 Wesley LaFerriere; ⚠️ no standalone LICENSE
//          file so GitHub's API reports null). Pulled verbatim June 2026.
// Port to WGSL: texture2D -> textureSample, gl_FragColor -> @location(0) return.

uniform float CRT_CURVE_AMNTx;
uniform float CRT_CURVE_AMNTy;
#define SCAN_LINE_MULT 1250.0

varying vec4 v_color;
varying vec2 v_texCoords;
uniform sampler2D u_texture;

void main() {
    vec2 tc = vec2(v_texCoords.x, v_texCoords.y);
    float dx = abs(0.5 - tc.x);
    float dy = abs(0.5 - tc.y);
    dx *= dx;
    dy *= dy;
    tc.x -= 0.5;  tc.x *= 1.0 + (dy * CRT_CURVE_AMNTx);  tc.x += 0.5;   // barrel curve
    tc.y -= 0.5;  tc.y *= 1.0 + (dx * CRT_CURVE_AMNTy);  tc.y += 0.5;

    vec4 cta = texture2D(u_texture, vec2(tc.x, tc.y));
    cta.rgb += sin(tc.y * SCAN_LINE_MULT) * 0.02;                        // scanlines

    if (tc.y > 1.0 || tc.x < 0.0 || tc.x > 1.0 || tc.y < 0.0)
        cta = vec4(0.0);                                                  // off-screen cutoff
    gl_FragColor = cta * v_color;
}
