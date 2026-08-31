// Signed Distance Fields: the single highest-leverage technique for a console.
// One SDF gives crisp edges at any zoom, plus AA + outline + glow nearly free by
// thresholding distance. sdRoundedBox draws every panel/button/pill; SDF/MSDF text
// gives razor labels at any DPI with cheap alert glow. GPUI already renders rounded
// rects and glyphs this way — these are the portable reference implementations.
//
// Sources:
//   shapes: https://iquilezles.org/articles/distfunctions2d/   (MIT, IQ site-wide; no inline header)
//   text:   https://libgdx.com/wiki/graphics/2d/fonts/distance-field-fonts  (Apache-2.0, libGDX)
//   theory: Chris Green (Valve), SIGGRAPH 2007, DOI 10.1145/1281500.1281665
//   MSDF:   https://github.com/Chlumsky/msdfgen  (MIT)
// Pulled June 2026.

// ---- Rounded-box SDF (per-corner radii in r) ----
float sdBox(in vec2 p, in vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdRoundedBox(in vec2 p, in vec2 b, in vec4 r) {
    r.xy = (p.x > 0.0) ? r.xy : r.zw;
    r.x  = (p.y > 0.0) ? r.x  : r.y;
    vec2 q = abs(p) - b + r.x;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r.x;
}
// Resolve fill + AA from distance:  alpha = 1.0 - smoothstep(-aa, aa, d);
// Outline:  ring = smoothstep(w+aa, w, abs(d));   Glow:  glow = exp(-k * max(d, 0.0));

// ---- SDF text: AA body / outline / drop-shadow variants ----
// const float smoothing = 0.25 / (spread * scale);   // crisp-font rule of thumb
// AA body:
//   float distance = texture2D(u_texture, v_texCoord).a;
//   float alpha = smoothstep(0.5 - smoothing, 0.5 + smoothing, distance);
//   gl_FragColor = vec4(v_color.rgb, v_color.a * alpha);
// Drop-shadow / glow (sample the field a 2nd time at an offset, composite under):
//   float sd = texture2D(u_texture, v_texCoord - shadowOffset).a;
//   float sAlpha = smoothstep(0.5 - shadowSmoothing, 0.5 + shadowSmoothing, sd);
//   vec4 shadow = vec4(shadowColor.rgb, shadowColor.a * sAlpha);
//   gl_FragColor = mix(shadow, text, text.a);
//
// For zoom-invariant sharp corners, use MSDF (median of 3 channels + screenPxRange()
// with fwidth) from msdfgen instead of a single-channel SDF.
