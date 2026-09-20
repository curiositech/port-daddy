struct Uniforms {
    row0 : vec4f, // resolution.xy, time, theme
    row1 : vec4f, // motion, reserved xyz
};
@group(0) @binding(0) var<uniform> U : Uniforms;

const PAPER : vec3f = vec3f(0.949, 0.933, 0.902);
const INK : vec3f = vec3f(0.071, 0.071, 0.071);
const DARK : vec3f = vec3f(0.063, 0.071, 0.086);
const PANEL : vec3f = vec3f(0.094, 0.110, 0.133);
const LINE : vec3f = vec3f(0.231, 0.275, 0.329);
const COBALT : vec3f = vec3f(0.000, 0.247, 0.722);
const COBALT_SOFT : vec3f = vec3f(0.490, 0.706, 1.000);
const KELP : vec3f = vec3f(0.000, 0.420, 0.373);
const HEALTH : vec3f = vec3f(0.122, 0.478, 0.302);
const LIME : vec3f = vec3f(0.792, 0.851, 0.000);
const GOLD : vec3f = vec3f(0.816, 0.604, 0.176);
const CORAL : vec3f = vec3f(0.667, 0.263, 0.180);
const VIOLET : vec3f = vec3f(0.576, 0.247, 0.647);
const FOAM : vec3f = vec3f(0.961, 0.953, 0.929);
const MUTED : vec3f = vec3f(0.647, 0.624, 0.576);

struct VOut { @builtin(position) pos : vec4f, @location(0) uv : vec2f };

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VOut {
    let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
    var out : VOut;
    out.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2f(p.x, 1.0 - p.y);
    return out;
}

fn rect_mask(p : vec2f, a : vec2f, b : vec2f) -> f32 {
    let inside = step(a.x, p.x) * step(a.y, p.y) * step(p.x, b.x) * step(p.y, b.y);
    return inside;
}

fn stroke_rect(p : vec2f, a : vec2f, b : vec2f, px : f32) -> f32 {
    let outer = rect_mask(p, a, b);
    let inner = rect_mask(p, a + vec2f(px, px), b - vec2f(px, px));
    return max(outer - inner, 0.0);
}

fn hline(p : vec2f, x0 : f32, x1 : f32, y : f32, px : f32) -> f32 {
    return rect_mask(p, vec2f(min(x0, x1), y), vec2f(max(x0, x1), y + px));
}

fn vline(p : vec2f, x : f32, y0 : f32, y1 : f32, px : f32) -> f32 {
    return rect_mask(p, vec2f(x, min(y0, y1)), vec2f(x + px, max(y0, y1)));
}

fn corner_frame(p : vec2f, a : vec2f, b : vec2f, arm : f32, px : f32) -> f32 {
    var m = 0.0;
    m = max(m, hline(p, a.x, a.x + arm, a.y, px));
    m = max(m, vline(p, a.x, a.y, a.y + arm, px));
    m = max(m, hline(p, b.x - arm, b.x, a.y, px));
    m = max(m, vline(p, b.x - px, a.y, a.y + arm, px));
    m = max(m, hline(p, a.x, a.x + arm, b.y - px, px));
    m = max(m, vline(p, a.x, b.y - arm, b.y, px));
    m = max(m, hline(p, b.x - arm, b.x, b.y - px, px));
    m = max(m, vline(p, b.x - px, b.y - arm, b.y, px));
    return m;
}

fn hatch(p : vec2f, a : vec2f, b : vec2f, tone : vec3f, base : vec3f, density : f32) -> vec3f {
    let inside = rect_mask(p, a, b);
    let pattern = step(0.78, fract((p.x + p.y) / 12.0));
    return mix(base, tone, inside * pattern * density);
}

fn panel_shell(base : vec3f, p : vec2f, a : vec2f, b : vec2f, fill : vec3f, border : vec3f, corner : vec3f) -> vec3f {
    let body = rect_mask(p, a, b);
    let edge = stroke_rect(p, a, b, 2.0);
    let corners = corner_frame(p, a, b, 16.0, 1.5);
    var c = mix(base, fill, body);
    c = mix(c, border, edge);
    c = mix(c, corner, corners);
    return c;
}

fn flag_pair(p : vec2f, a : vec2f, size : vec2f, left : vec3f, right : vec3f, border : vec3f, col : vec3f) -> vec3f {
    let l = rect_mask(p, a, a + vec2f(size.x * 0.55, size.y));
    let r = rect_mask(p, a + vec2f(size.x * 0.55, 0.0), a + size);
    let frame = stroke_rect(p, a, a + size, 1.0);
    var c = mix(col, left, l);
    c = mix(c, right, r);
    return mix(c, border, frame);
}

@fragment
fn fs_main(in : VOut) -> @location(0) vec4f {
    let frag = in.pos.xy;
    let res = U.row0.xy;
    let t = U.row0.z;
    let dark_mode = U.row0.w > 0.5;
    let live = clamp(U.row1.x, 0.0, 1.0);
    let pulse = 0.5 + 0.5 * sin(t * 1.35);

    var col = select(PAPER, DARK, dark_mode);
    let text_col = select(INK, FOAM, dark_mode);
    let rail_col = LINE;
    let header_left = select(KELP, mix(DARK, KELP, 0.62), dark_mode);
    let header_mid = select(COBALT, mix(DARK, COBALT, 0.80), dark_mode);
    let header_right = select(mix(PAPER, PANEL, 0.12), mix(DARK, PANEL, 0.42), dark_mode);
    let left_fill = select(mix(PAPER, KELP, 0.07), mix(DARK, PANEL, 0.86), dark_mode);
    let right_fill = select(mix(PAPER, FOAM, 0.05), mix(DARK, PANEL, 0.58), dark_mode);
    let tile_fill = select(mix(PAPER, FOAM, 0.03), mix(DARK, PANEL, 0.48), dark_mode);
    let specimen_fill = select(mix(PAPER, FOAM, 0.04), mix(DARK, PANEL, 0.34), dark_mode);

    // Header: broad color blocks with a title plate and a thin provenance band.
    col = mix(col, header_left, rect_mask(frag, vec2f(0.0, 0.0), vec2f(res.x * 0.28, 104.0)));
    col = mix(col, header_mid, rect_mask(frag, vec2f(res.x * 0.28, 0.0), vec2f(res.x * 0.68, 104.0)));
    col = mix(col, header_right, rect_mask(frag, vec2f(res.x * 0.68, 0.0), vec2f(res.x, 104.0)));
    col = mix(col, LIME, hline(frag, 0.0, res.x, 96.0, 3.0));
    col = mix(col, GOLD, hline(frag, 0.0, res.x, 108.0, 2.0));
    col = mix(col, text_col, rect_mask(frag, vec2f(56.0, 22.0), vec2f(356.0, 62.0)));
    col = mix(col, header_mid, rect_mask(frag, vec2f(74.0, 30.0), vec2f(248.0, 46.0)));
    col = mix(col, GOLD, rect_mask(frag, vec2f(258.0, 30.0), vec2f(334.0, 46.0)));
    col = mix(col, rail_col, hline(frag, 74.0, 334.0, 52.0, 1.0));
    col = mix(col, text_col, rect_mask(frag, vec2f(56.0, 66.0), vec2f(170.0, 76.0)));
    col = mix(col, KELP, rect_mask(frag, vec2f(178.0, 66.0), vec2f(284.0, 76.0)));
    col = flag_pair(frag, vec2f(res.x - 176.0, 28.0), vec2f(36.0, 24.0), GOLD, text_col, text_col, col);
    col = flag_pair(frag, vec2f(res.x - 132.0, 28.0), vec2f(36.0, 24.0), VIOLET, text_col, text_col, col);

    // Outer panels.
    let left_a = vec2f(52.0, 132.0);
    let left_b = vec2f(616.0, 518.0);
    let right_a = vec2f(646.0, 132.0);
    let right_b = vec2f(1230.0, 518.0);
    col = panel_shell(col, frag, left_a, left_b, left_fill, rail_col, text_col);
    col = panel_shell(col, frag, right_a, right_b, right_fill, rail_col, text_col);
    col = mix(col, rail_col, vline(frag, 632.0, 132.0, 518.0, 2.0));

    // Left panel: state lanes with explicit structure and a provenance strip.
    col = mix(col, header_mid, rect_mask(frag, vec2f(76.0, 156.0), vec2f(338.0, 194.0)));
    col = mix(col, GOLD, rect_mask(frag, vec2f(350.0, 156.0), vec2f(548.0, 194.0)));
    col = mix(col, rail_col, hline(frag, 76.0, 548.0, 208.0, 1.0));
    col = flag_pair(frag, vec2f(418.0, 158.0), vec2f(42.0, 22.0), COBALT, GOLD, text_col, col);
    col = flag_pair(frag, vec2f(468.0, 158.0), vec2f(42.0, 22.0), KELP, text_col, text_col, col);

    // Pending.
    let r1_y = 230.0;
    col = mix(col, mix(left_fill, GOLD, 0.10), rect_mask(frag, vec2f(76.0, r1_y), vec2f(548.0, r1_y + 40.0)));
    col = mix(col, GOLD, vline(frag, 80.0, r1_y + 6.0, r1_y + 34.0, 3.0));
    col = mix(col, GOLD, rect_mask(frag, vec2f(104.0, r1_y + 13.0), vec2f(116.0, r1_y + 25.0)));
    col = mix(col, text_col, rect_mask(frag, vec2f(132.0, r1_y + 12.0), vec2f(276.0, r1_y + 24.0)));
    col = mix(col, header_mid, rect_mask(frag, vec2f(294.0, r1_y + 12.0), vec2f(408.0, r1_y + 24.0)));
    col = flag_pair(frag, vec2f(418.0, r1_y + 9.0), vec2f(44.0, 18.0), GOLD, text_col, text_col, col);
    col = mix(col, rail_col, hline(frag, 76.0, 548.0, r1_y + 40.0, 1.0));

    // Unknown.
    let r2_y = 278.0;
    col = mix(col, mix(left_fill, VIOLET, 0.08), rect_mask(frag, vec2f(76.0, r2_y), vec2f(548.0, r2_y + 40.0)));
    col = mix(col, VIOLET, vline(frag, 80.0, r2_y + 6.0, r2_y + 34.0, 3.0));
    col = mix(col, VIOLET, stroke_rect(frag, vec2f(104.0, r2_y + 12.0), vec2f(174.0, r2_y + 28.0), 1.5));
    col = mix(col, VIOLET, rect_mask(frag, vec2f(132.0, r2_y + 17.0), vec2f(164.0, r2_y + 23.0)));
    col = hatch(frag, vec2f(338.0, r2_y + 6.0), vec2f(518.0, r2_y + 34.0), VIOLET, col, 0.60);
    col = flag_pair(frag, vec2f(418.0, r2_y + 9.0), vec2f(44.0, 18.0), VIOLET, text_col, text_col, col);
    col = mix(col, rail_col, hline(frag, 76.0, 548.0, r2_y + 40.0, 1.0));

    // Recovering.
    let r3_y = 326.0;
    let sweep = 128.0 + 22.0 * pulse * live;
    col = mix(col, mix(left_fill, COBALT, 0.08), rect_mask(frag, vec2f(76.0, r3_y), vec2f(548.0, r3_y + 40.0)));
    col = mix(col, COBALT_SOFT, vline(frag, 80.0, r3_y + 6.0, r3_y + 34.0, 3.0));
    col = mix(col, COBALT, rect_mask(frag, vec2f(104.0, r3_y + 14.0), vec2f(104.0 + 82.0, r3_y + 22.0)));
    col = mix(col, COBALT_SOFT, rect_mask(frag, vec2f(104.0, r3_y + 22.0), vec2f(104.0 + 118.0, r3_y + 30.0)));
    col = mix(col, FOAM, rect_mask(frag, vec2f(104.0, r3_y + 30.0), vec2f(104.0 + sweep, r3_y + 36.0)));
    col = flag_pair(frag, vec2f(418.0, r3_y + 9.0), vec2f(44.0, 18.0), COBALT_SOFT, COBALT, text_col, col);
    col = mix(col, rail_col, hline(frag, 76.0, 548.0, r3_y + 40.0, 1.0));

    // Confirmed.
    let r4_y = 374.0;
    col = mix(col, mix(left_fill, HEALTH, 0.09), rect_mask(frag, vec2f(76.0, r4_y), vec2f(548.0, r4_y + 40.0)));
    col = mix(col, HEALTH, vline(frag, 80.0, r4_y + 6.0, r4_y + 34.0, 3.0));
    col = mix(col, HEALTH, rect_mask(frag, vec2f(104.0, r4_y + 13.0), vec2f(262.0, r4_y + 27.0)));
    col = mix(col, LIME, rect_mask(frag, vec2f(270.0, r4_y + 13.0), vec2f(286.0, r4_y + 27.0)));
    col = mix(col, text_col, rect_mask(frag, vec2f(298.0, r4_y + 14.0), vec2f(378.0, r4_y + 24.0)));
    col = flag_pair(frag, vec2f(418.0, r4_y + 9.0), vec2f(44.0, 18.0), HEALTH, LIME, text_col, col);
    col = mix(col, rail_col, hline(frag, 76.0, 548.0, r4_y + 40.0, 1.0));

    // Dead-lettered.
    let r5_y = 422.0;
    col = mix(col, mix(left_fill, CORAL, 0.10), rect_mask(frag, vec2f(76.0, r5_y), vec2f(548.0, r5_y + 40.0)));
    col = mix(col, CORAL, vline(frag, 80.0, r5_y + 6.0, r5_y + 34.0, 3.0));
    col = hatch(frag, vec2f(104.0, r5_y + 8.0), vec2f(274.0, r5_y + 34.0), CORAL, col, 0.72);
    col = mix(col, CORAL, stroke_rect(frag, vec2f(290.0, r5_y + 10.0), vec2f(386.0, r5_y + 28.0), 1.5));
    col = mix(col, text_col, rect_mask(frag, vec2f(302.0, r5_y + 15.0), vec2f(366.0, r5_y + 23.0)));
    col = hatch(frag, vec2f(408.0, r5_y + 8.0), vec2f(520.0, r5_y + 34.0), CORAL, col, 0.82);
    col = flag_pair(frag, vec2f(418.0, r5_y + 9.0), vec2f(44.0, 18.0), CORAL, text_col, text_col, col);
    col = mix(col, rail_col, hline(frag, 76.0, 548.0, r5_y + 40.0, 1.0));

    // Provenance strip.
    col = mix(col, rail_col, hline(frag, 76.0, 548.0, 484.0, 1.0));
    col = flag_pair(frag, vec2f(92.0, 492.0), vec2f(42.0, 18.0), COBALT, GOLD, text_col, col);
    col = flag_pair(frag, vec2f(144.0, 492.0), vec2f(42.0, 18.0), KELP, text_col, text_col, col);
    col = flag_pair(frag, vec2f(196.0, 492.0), vec2f(42.0, 18.0), VIOLET, text_col, text_col, col);
    col = mix(col, text_col, rect_mask(frag, vec2f(256.0, 492.0), vec2f(432.0, 510.0)));
    col = mix(col, rail_col, hline(frag, 76.0, 548.0, 516.0, 1.0));

    // Right panel: a specimen/provenance board with a mounted artifact and evidence cards.
    col = mix(col, header_mid, rect_mask(frag, vec2f(672.0, 156.0), vec2f(962.0, 194.0)));
    col = mix(col, GOLD, rect_mask(frag, vec2f(976.0, 156.0), vec2f(1138.0, 194.0)));
    col = mix(col, rail_col, hline(frag, 672.0, 1138.0, 208.0, 1.0));
    col = flag_pair(frag, vec2f(1160.0, 158.0), vec2f(42.0, 22.0), GOLD, text_col, text_col, col);
    col = flag_pair(frag, vec2f(1110.0, 158.0), vec2f(42.0, 22.0), VIOLET, text_col, text_col, col);

    let mount_a = vec2f(672.0, 224.0);
    let mount_b = vec2f(1140.0, 382.0);
    col = mix(col, specimen_fill, rect_mask(frag, mount_a, mount_b));
    col = mix(col, rail_col, stroke_rect(frag, mount_a, mount_b, 2.0));
    col = mix(col, text_col, corner_frame(frag, mount_a, mount_b, 16.0, 1.5));
    col = mix(col, COBALT, rect_mask(frag, vec2f(690.0, 244.0), vec2f(834.0, 354.0)));
    col = mix(col, mix(specimen_fill, PANEL, 0.50), rect_mask(frag, vec2f(844.0, 244.0), vec2f(982.0, 354.0)));
    col = mix(col, GOLD, rect_mask(frag, vec2f(994.0, 244.0), vec2f(1118.0, 270.0)));
    col = mix(col, CORAL, rect_mask(frag, vec2f(994.0, 276.0), vec2f(1118.0, 292.0)));
    col = mix(col, rail_col, vline(frag, 966.0, 244.0, 354.0, 2.0));
    col = hatch(frag, vec2f(992.0, 296.0), vec2f(1118.0, 354.0), VIOLET, col, 0.46);
    col = flag_pair(frag, vec2f(694.0, 336.0), vec2f(44.0, 18.0), COBALT, GOLD, text_col, col);
    col = flag_pair(frag, vec2f(748.0, 336.0), vec2f(44.0, 18.0), HEALTH, COBALT, text_col, col);
    col = flag_pair(frag, vec2f(1100.0, 336.0), vec2f(30.0, 18.0), GOLD, text_col, text_col, col);
    col = mix(col, rail_col, hline(frag, 672.0, 1138.0, 398.0, 1.0));

    // Evidence cards along the bottom of the specimen board.
    col = panel_shell(col, frag, vec2f(672.0, 414.0), vec2f(790.0, 474.0), tile_fill, rail_col, text_col);
    col = mix(col, GOLD, vline(frag, 682.0, 424.0, 464.0, 3.0));
    col = mix(col, text_col, rect_mask(frag, vec2f(704.0, 438.0), vec2f(762.0, 450.0)));
    col = flag_pair(frag, vec2f(744.0, 424.0), vec2f(32.0, 18.0), GOLD, text_col, text_col, col);

    col = panel_shell(col, frag, vec2f(800.0, 414.0), vec2f(918.0, 474.0), tile_fill, rail_col, text_col);
    col = mix(col, VIOLET, stroke_rect(frag, vec2f(822.0, 428.0), vec2f(876.0, 458.0), 1.5));
    col = hatch(frag, vec2f(822.0, 428.0), vec2f(876.0, 458.0), VIOLET, col, 0.62);
    col = flag_pair(frag, vec2f(878.0, 424.0), vec2f(32.0, 18.0), VIOLET, text_col, text_col, col);

    col = panel_shell(col, frag, vec2f(928.0, 414.0), vec2f(1046.0, 474.0), tile_fill, rail_col, text_col);
    col = mix(col, COBALT_SOFT, vline(frag, 938.0, 424.0, 464.0, 3.0));
    col = mix(col, COBALT, rect_mask(frag, vec2f(960.0, 436.0), vec2f(1018.0, 450.0)));
    col = mix(col, LIME, rect_mask(frag, vec2f(1026.0, 436.0), vec2f(1038.0, 450.0)));
    col = flag_pair(frag, vec2f(986.0, 424.0), vec2f(32.0, 18.0), COBALT, LIME, text_col, col);

    col = panel_shell(col, frag, vec2f(1056.0, 414.0), vec2f(1178.0, 474.0), tile_fill, rail_col, text_col);
    col = hatch(frag, vec2f(1072.0, 428.0), vec2f(1158.0, 458.0), CORAL, col, 0.76);
    col = mix(col, CORAL, stroke_rect(frag, vec2f(1072.0, 428.0), vec2f(1158.0, 458.0), 1.5));
    col = flag_pair(frag, vec2f(1150.0, 424.0), vec2f(18.0, 18.0), CORAL, text_col, text_col, col);

    // Bottom specimen legend: five explicit state tiles with distinct shape language.
    col = mix(col, rail_col, hline(frag, 120.0, 1160.0, 560.0, 1.0));

    // Pending tile.
    col = panel_shell(col, frag, vec2f(120.0, 572.0), vec2f(320.0, 666.0), tile_fill, rail_col, text_col);
    col = mix(col, GOLD, vline(frag, 128.0, 582.0, 656.0, 3.0));
    col = mix(col, GOLD, rect_mask(frag, vec2f(152.0, 600.0), vec2f(238.0, 618.0)));
    col = mix(col, text_col, rect_mask(frag, vec2f(248.0, 600.0), vec2f(292.0, 618.0)));
    col = mix(col, GOLD, rect_mask(frag, vec2f(152.0, 628.0), vec2f(210.0, 638.0)));
    col = flag_pair(frag, vec2f(244.0, 584.0), vec2f(34.0, 18.0), GOLD, text_col, text_col, col);

    // Unknown tile.
    col = panel_shell(col, frag, vec2f(330.0, 572.0), vec2f(530.0, 666.0), tile_fill, rail_col, text_col);
    col = mix(col, VIOLET, vline(frag, 338.0, 582.0, 656.0, 3.0));
    col = mix(col, VIOLET, stroke_rect(frag, vec2f(362.0, 598.0), vec2f(422.0, 634.0), 1.5));
    col = hatch(frag, vec2f(362.0, 598.0), vec2f(422.0, 634.0), VIOLET, col, 0.54);
    col = mix(col, VIOLET, stroke_rect(frag, vec2f(436.0, 592.0), vec2f(496.0, 648.0), 1.0));
    col = flag_pair(frag, vec2f(452.0, 584.0), vec2f(34.0, 18.0), VIOLET, text_col, text_col, col);

    // Recovering tile.
    col = panel_shell(col, frag, vec2f(540.0, 572.0), vec2f(740.0, 666.0), tile_fill, rail_col, text_col);
    col = mix(col, COBALT_SOFT, vline(frag, 548.0, 582.0, 656.0, 3.0));
    col = mix(col, COBALT, rect_mask(frag, vec2f(568.0, 600.0), vec2f(650.0, 610.0)));
    col = mix(col, COBALT_SOFT, rect_mask(frag, vec2f(568.0, 614.0), vec2f(688.0, 624.0)));
    col = mix(col, FOAM, rect_mask(frag, vec2f(568.0, 628.0), vec2f(568.0 + 128.0 + 20.0 * pulse * live, 636.0)));
    col = flag_pair(frag, vec2f(666.0, 584.0), vec2f(34.0, 18.0), COBALT_SOFT, COBALT, text_col, col);

    // Confirmed tile.
    col = panel_shell(col, frag, vec2f(750.0, 572.0), vec2f(950.0, 666.0), tile_fill, rail_col, text_col);
    col = mix(col, HEALTH, vline(frag, 758.0, 582.0, 656.0, 3.0));
    col = mix(col, HEALTH, rect_mask(frag, vec2f(782.0, 600.0), vec2f(898.0, 618.0)));
    col = mix(col, LIME, rect_mask(frag, vec2f(906.0, 600.0), vec2f(922.0, 618.0)));
    col = mix(col, text_col, rect_mask(frag, vec2f(782.0, 628.0), vec2f(862.0, 638.0)));
    col = flag_pair(frag, vec2f(870.0, 584.0), vec2f(34.0, 18.0), HEALTH, LIME, text_col, col);

    // Dead-lettered tile.
    col = panel_shell(col, frag, vec2f(960.0, 572.0), vec2f(1160.0, 666.0), tile_fill, rail_col, text_col);
    col = mix(col, CORAL, vline(frag, 968.0, 582.0, 656.0, 3.0));
    col = hatch(frag, vec2f(988.0, 598.0), vec2f(1068.0, 636.0), CORAL, col, 0.78);
    col = mix(col, CORAL, stroke_rect(frag, vec2f(988.0, 598.0), vec2f(1068.0, 636.0), 1.5));
    col = mix(col, text_col, stroke_rect(frag, vec2f(1082.0, 600.0), vec2f(1146.0, 648.0), 1.0));
    col = flag_pair(frag, vec2f(1084.0, 584.0), vec2f(34.0, 18.0), CORAL, text_col, text_col, col);

    // Gentle receipt grain on the proof boards only, not across the whole frame.
    let receipt_band = rect_mask(frag, vec2f(672.0, 224.0), vec2f(1140.0, 474.0));
    let grain = step(0.92, fract((frag.x * 0.13 + frag.y * 0.21) * 0.5));
    col = mix(col, mix(select(PAPER, DARK, dark_mode), rail_col, 0.12), receipt_band * grain * 0.18);

    return vec4f(col, 1.0);
}
