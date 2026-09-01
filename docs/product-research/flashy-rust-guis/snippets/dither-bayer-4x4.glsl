// Ordered (Bayer) dithering: kills 8-bit banding in dark console gradients/gauges
// and adds a deliberate retro texture. Compares each pixel against a tiled 4x4
// threshold matrix indexed by fragCoord mod 4 — zero extra memory, branch-light,
// embarrassingly parallel. Run it as the FINAL fragment step over gradient
// backgrounds / gauges / glass tints.
//
// Higher quality: sample a precomputed BLUE-NOISE texture instead of the Bayer
// tile — energy only in high spatial frequencies, so no periodic cross-hatch and
// it animates cleanly (temporal blue noise) without strobing. Cost: 1 texture fetch.
//
// Source:  https://github.com/hughsk/glsl-dither/blob/master/4x4.glsl  (MIT, verified)
// Theory:  https://alex-charlton.com/posts/Dithering_on_the_GPU/
// Pulled verbatim June 2026.

float dither4x4(vec2 position, float brightness) {
    int x = int(mod(position.x, 4.0));
    int y = int(mod(position.y, 4.0));
    int index = x + y * 4;
    float limit = 0.0;
    if (x < 8) {
        if (index == 0)  limit = 0.0625;
        if (index == 1)  limit = 0.5625;
        if (index == 2)  limit = 0.1875;
        if (index == 3)  limit = 0.6875;
        if (index == 4)  limit = 0.8125;
        if (index == 5)  limit = 0.3125;
        if (index == 6)  limit = 0.9375;
        if (index == 7)  limit = 0.4375;
        if (index == 8)  limit = 0.25;
        if (index == 9)  limit = 0.75;
        if (index == 10) limit = 0.125;
        if (index == 11) limit = 0.625;
        if (index == 12) limit = 1.0;
        if (index == 13) limit = 0.5;
        if (index == 14) limit = 0.875;
        if (index == 15) limit = 0.375;
    }
    return brightness < limit ? 0.0 : 1.0;
}

vec4 dither4x4(vec2 position, vec4 color) {
    return vec4(color.rgb * dither4x4(position, luma(color)), 1.0);
}
