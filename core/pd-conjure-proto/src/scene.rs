//! Vello scene construction for the Conjure predicted-DAG node-graph —
//! the NEXT-GENERATION render.
//!
//! This is the VELLO GRAPH slice (Rung 1, per `CONJURE-DAG-SURFACE.md`): a
//! wave-column layout (x = `wave_number`), each node a rounded-rect card with
//! Parley-shaped text, feed-forward cubic-bezier edges styled by
//! `commitment_level`. Everything is bespoke GPU vector rendering — hand-built
//! paths fed into the same Vello scene as the glyph runs, no widget tree.
//!
//! Art direction (the "magazine-grade / cinematic / retro-futurist" pass the
//! operator asked for — all GPU vector, offscreen):
//!   1. LIVING-HARBOR BACKDROP — a vertical ebony→warm gradient, a faint radial
//!      horizon glow behind the graph, a quiet dithered dot-shimmer (the harbor
//!      water), and a vignette around the frame.
//!   2. NODE CARDS WITH DEPTH + GLOW — a soft blurred drop shadow, a commitment-
//!      colored outer glow (`draw_blurred_rounded_rect`), a raised→panel gradient
//!      card fill, a gradient header strip, and a crisp 2px commitment border.
//!   3. GRADIENT FLOWING EDGES — bezier edges stroked with a source→target color
//!      gradient, a soft glow underlay for COMMITTED, a brighter tapered leading
//!      segment near the target, and a refined arrowhead.
//!   4. EDITORIAL TYPOGRAPHY — a large headline, a refined sub-line, bold node
//!      titles, lighter role text, and vendor-distinct model-tier CHIPS.
//!   5. WAVE HEADERS as tracked-out labels, refined cost/cascade footers.
//!
//! The Parley glyph-run pipeline (`TextEngine` + `render_glyph_run`) mirrors
//! `pd-timeline-proto/src/scene.rs` — the proven Rung-1 text path.

use std::collections::HashMap;

use kurbo::{Affine, BezPath, Circle, Point, Rect, RoundedRect, RoundedRectRadii, Stroke, Vec2};
use parley::{
    Alignment, FontContext, GlyphRun, Layout, LayoutContext, PositionedLayoutItem, StyleProperty,
};
use peniko::{Brush, Color, Extend, Fill, Gradient};
use vello::Scene;

use crate::dag::{build_edges, Commitment, PredictedDag};

// --- Maritime palette (the harbor scheme the operator specified). ---
const BG: Color = Color::rgb8(0x1e, 0x1b, 0x18); // ebony
const BG_DEEP: Color = Color::rgb8(0x14, 0x12, 0x10); // deeper ebony (bottom of harbor)
const BG_WARM: Color = Color::rgb8(0x2a, 0x24, 0x1d); // warmer ebony near the title
const PANEL: Color = Color::rgb8(0x2b, 0x27, 0x24); // card fill (low tone)
const RAISED: Color = Color::rgb8(0x3a, 0x34, 0x2d); // raised tone (top of a card)
const CANARY: Color = Color::rgb8(0xff, 0xdb, 0x33); // accent / committed
const SUCCESS: Color = Color::rgb8(0x6d, 0xd3, 0xa8); // green
const DANGER: Color = Color::rgb8(0xf2, 0x64, 0x75); // gate / refusal
const COBALT: Color = Color::rgb8(0x7f, 0xc4, 0xff); // tentative
const VIOLET: Color = Color::rgb8(0xb6, 0x9c, 0xff); // codex chip
const AMBER: Color = Color::rgb8(0xf2, 0xa9, 0x4e); // groq chip
const INK: Color = Color::rgb8(0xf5, 0xf5, 0xf0); // primary text
const INK_DIM: Color = Color::rgb8(0xa6, 0xa0, 0x98); // secondary text
const HAIRLINE: Color = Color::rgb8(0x46, 0x40, 0x3a); // faint divider

/// Stroke + glow color for a commitment level (matches windags' own semantics:
/// COMMITTED is the strongest signal, EXPLORATORY the faintest).
fn commitment_color(c: Commitment) -> Color {
    match c {
        Commitment::Committed => CANARY,
        Commitment::Tentative => COBALT,
        Commitment::Exploratory => INK_DIM,
        Commitment::Unknown => HAIRLINE,
    }
}

/// Linear interpolation between two colors in sRGB byte space (good enough for
/// the short edge/card gradients — peniko 0.2's `Color` has no `lerp`).
fn lerp_color(a: Color, b: Color, t: f64) -> Color {
    let t = t.clamp(0.0, 1.0);
    let mix = |x: u8, y: u8| -> u8 {
        (x as f64 + (y as f64 - x as f64) * t).round().clamp(0.0, 255.0) as u8
    };
    Color::rgb8(mix(a.r, b.r), mix(a.g, b.g), mix(a.b, b.b))
}

/// Vendor-distinct accent for a model-tier chip. Tier labels are rendered
/// VERBATIM, but the chip's accent reads the family so the operator can scan
/// vendors at a glance: claude/opus/sonnet/haiku = canary, gemini = cobalt-green,
/// codex = violet, groq = amber, everything else = a quiet ink chip.
///
/// DISPLAY-ONLY (mirrors pd-console's `vendor_accent` in app.rs — no backend
/// or spawn decision reads this). EXACT-token match, not substring
/// `contains()` (ADR-0057 model-abstraction unification — `contains()` is
/// the keyword/substring-NLP pattern the house rule forbids, and it risks a
/// false-positive chip color on any tier label that merely CONTAINS a vendor
/// nickname as a substring of an unrelated word). Unrecognized tokens fall
/// through to the neutral `INK_DIM` — never a vendor default.
fn vendor_accent(tier: &str) -> Color {
    let t = tier.trim().to_ascii_lowercase();
    let tokens: Vec<&str> = t
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|tok| !tok.is_empty())
        .collect();
    let has_any = |names: &[&str]| tokens.iter().any(|tok| names.contains(tok));
    if has_any(&["opus", "sonnet", "haiku", "claude"]) {
        CANARY
    } else if has_any(&["gemini"]) {
        SUCCESS
    } else if has_any(&["codex", "gpt", "o1", "o3"]) {
        VIOLET
    } else if has_any(&["groq", "llama", "mixtral"]) {
        AMBER
    } else {
        INK_DIM
    }
}

/// Card geometry, in logical pixels.
const NODE_W: f64 = 288.0;
const NODE_H: f64 = 168.0;
const COL_GAP: f64 = 116.0; // horizontal gap between wave columns
const ROW_GAP: f64 = 60.0; // vertical gap between stacked nodes in a column
const MARGIN_X: f64 = 64.0;
const TOP_PAD: f64 = 150.0; // room for headline + meta sub-line + the WAVE captions
const BOTTOM_PAD: f64 = 64.0;

/// The fully-resolved canvas size for a DAG, so the offscreen target is sized to
/// exactly contain the graph (no clipping, no wasted pixels).
pub struct Canvas {
    pub width: f64,
    pub height: f64,
}

/// Compute the canvas size that contains all wave columns + the tallest column.
pub fn canvas_for(dag: &PredictedDag) -> Canvas {
    let n_waves = dag.waves.len().max(1);
    let width = MARGIN_X * 2.0 + n_waves as f64 * NODE_W + (n_waves - 1) as f64 * COL_GAP;
    let tallest = dag
        .waves
        .iter()
        .map(|w| w.nodes.len().max(1))
        .max()
        .unwrap_or(1);
    let col_h = tallest as f64 * NODE_H + (tallest - 1) as f64 * ROW_GAP;
    let height = TOP_PAD + col_h + BOTTOM_PAD;
    Canvas {
        // A comfortable minimum so a tiny DAG still produces a substantial PNG.
        width: width.max(760.0),
        height: height.max(460.0),
    }
}

/// Top-left corner of a node card, given its wave index and row within the wave.
/// x is driven by `wave_idx` (the wave column); rows are centered vertically so
/// every column shares a common mid-line.
fn node_origin(canvas: &Canvas, wave_idx: usize, row: usize, rows_in_wave: usize) -> Point {
    let x = MARGIN_X + wave_idx as f64 * (NODE_W + COL_GAP);
    let col_h = rows_in_wave as f64 * NODE_H + (rows_in_wave.saturating_sub(1)) as f64 * ROW_GAP;
    let usable = canvas.height - TOP_PAD - BOTTOM_PAD;
    let top = TOP_PAD + (usable - col_h).max(0.0) / 2.0;
    let y = top + row as f64 * (NODE_H + ROW_GAP);
    Point::new(x, y)
}

/// Holds the Parley contexts so we don't rebuild font collections every frame.
pub struct TextEngine {
    font_cx: FontContext,
    layout_cx: LayoutContext<Brush>,
}

impl TextEngine {
    pub fn new() -> Self {
        Self {
            font_cx: FontContext::new(),
            layout_cx: LayoutContext::new(),
        }
    }

    /// Shape + lay out a single line wrapped to `max_w`, paint its glyph runs at
    /// (x, y) (y = top of the line box). Returns the laid-out height so callers
    /// can stack lines. `scale` is the hidpi factor baked into the target.
    #[allow(clippy::too_many_arguments)]
    fn draw_wrapped(
        &mut self,
        scene: &mut Scene,
        text: &str,
        x: f64,
        y: f64,
        max_w: f64,
        size: f32,
        weight: f32,
        color: Color,
        scale: f32,
    ) -> f64 {
        let mut builder = self.layout_cx.ranged_builder(&mut self.font_cx, text, scale);
        builder.push_default(StyleProperty::FontSize(size));
        builder.push_default(StyleProperty::FontWeight(parley::FontWeight::new(weight)));
        builder.push_default(StyleProperty::Brush(Brush::Solid(color)));
        let mut layout: Layout<Brush> = builder.build(text);
        layout.break_all_lines(Some((max_w * scale as f64) as f32));
        layout.align(None, Alignment::Start);

        let transform = Affine::translate((x, y));
        for line in layout.lines() {
            for item in line.items() {
                if let PositionedLayoutItem::GlyphRun(glyph_run) = item {
                    render_glyph_run(scene, &glyph_run, transform);
                }
            }
        }
        layout.height() as f64 / scale as f64
    }

    /// A single un-wrapped line (eyebrow / meta). Returns laid-out width.
    #[allow(clippy::too_many_arguments)]
    fn draw_line(
        &mut self,
        scene: &mut Scene,
        text: &str,
        x: f64,
        y: f64,
        size: f32,
        weight: f32,
        color: Color,
        scale: f32,
    ) -> f64 {
        self.draw_line_tracked(scene, text, x, y, size, weight, color, scale, 0.0)
    }

    /// A single un-wrapped line with optional letter-spacing (tracking, in
    /// logical px) for the editorial tracked-out caps labels. Returns width.
    #[allow(clippy::too_many_arguments)]
    fn draw_line_tracked(
        &mut self,
        scene: &mut Scene,
        text: &str,
        x: f64,
        y: f64,
        size: f32,
        weight: f32,
        color: Color,
        scale: f32,
        tracking: f32,
    ) -> f64 {
        let mut builder = self.layout_cx.ranged_builder(&mut self.font_cx, text, scale);
        builder.push_default(StyleProperty::FontSize(size));
        builder.push_default(StyleProperty::FontWeight(parley::FontWeight::new(weight)));
        if tracking != 0.0 {
            builder.push_default(StyleProperty::LetterSpacing(tracking));
        }
        builder.push_default(StyleProperty::Brush(Brush::Solid(color)));
        let mut layout: Layout<Brush> = builder.build(text);
        layout.break_all_lines(None);
        layout.align(None, Alignment::Start);
        let transform = Affine::translate((x, y));
        for line in layout.lines() {
            for item in line.items() {
                if let PositionedLayoutItem::GlyphRun(glyph_run) = item {
                    render_glyph_run(scene, &glyph_run, transform);
                }
            }
        }
        layout.width() as f64 / scale as f64
    }

    /// Measure a line's width without painting (used to size chips/pills).
    fn measure(&mut self, text: &str, size: f32, weight: f32, tracking: f32, scale: f32) -> f64 {
        let mut builder = self.layout_cx.ranged_builder(&mut self.font_cx, text, scale);
        builder.push_default(StyleProperty::FontSize(size));
        builder.push_default(StyleProperty::FontWeight(parley::FontWeight::new(weight)));
        if tracking != 0.0 {
            builder.push_default(StyleProperty::LetterSpacing(tracking));
        }
        let mut layout: Layout<Brush> = builder.build(text);
        layout.break_all_lines(None);
        layout.width() as f64 / scale as f64
    }
}

/// Push one Parley glyph run into the Vello scene (verbatim from the timeline
/// proto's proven path: reinterpret Parley's `&[i16]` normalized coords as
/// skrifa's `F2Dot14`, which is `#[repr(transparent)]` over the same bits).
fn render_glyph_run(scene: &mut Scene, glyph_run: &GlyphRun<Brush>, transform: Affine) {
    let mut x = glyph_run.offset();
    let y = glyph_run.baseline();
    let run = glyph_run.run();
    let font = run.font();
    let font_size = run.font_size();
    let synthesis = run.synthesis();
    let glyph_xform = synthesis
        .skew()
        .map(|angle| Affine::skew(angle.to_radians().tan() as f64, 0.0));
    let raw_coords = run.normalized_coords();
    let coords: &[vello::skrifa::raw::types::F2Dot14] =
        unsafe { std::slice::from_raw_parts(raw_coords.as_ptr().cast(), raw_coords.len()) };
    let brush = glyph_run.style().brush.clone();

    scene
        .draw_glyphs(font)
        .brush(&brush)
        .transform(transform)
        .glyph_transform(glyph_xform)
        .font_size(font_size)
        .normalized_coords(coords)
        .draw(
            Fill::NonZero,
            glyph_run.glyphs().map(|g| {
                let gx = x + g.x;
                let gy = y - g.y;
                x += g.advance;
                vello::Glyph {
                    id: g.id as u32,
                    x: gx,
                    y: gy,
                }
            }),
        );
}

/// Truncate a label to `max` chars with an ellipsis, on a char boundary.
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let kept: String = s.chars().take(max.saturating_sub(1)).collect();
        format!("{kept}\u{2026}")
    }
}

/// A vertical linear gradient brush between two colors over [y0, y1].
fn vgrad(top: Color, bottom: Color, y0: f64, y1: f64) -> Brush {
    Brush::Gradient(
        Gradient::new_linear((0.0, y0), (0.0, y1)).with_stops([
            (0.0_f32, top),
            (1.0_f32, bottom),
        ]),
    )
}

/// Animation timing constants (all in normalized clip-time `t` ∈ [0,1]).
///
/// `BLOOM_WINDOW` — the fraction of the clip over which the wave-by-wave
/// bloom-in completes; after this, all cards are fully present. Each wave's
/// bloom is staggered within this window, and each individual card's bloom takes
/// `BLOOM_DURATION` of clip-time (so a card eases in rather than popping).
const BLOOM_WINDOW: f32 = 0.45;
const BLOOM_DURATION: f32 = 0.20;

/// Smoothstep ease (3t²−2t³) over [0,1], clamped — the canonical S-curve so the
/// bloom-in eases rather than ramps linearly.
fn smoothstep(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// The bloom-in progress for wave `wi` (0 = not yet arrived, 1 = fully present)
/// at clip-time `t`. Waves are staggered across `BLOOM_WINDOW`: wave 0 starts at
/// t=0, the last wave starts so its bloom finishes right at `BLOOM_WINDOW`.
fn wave_bloom(t: f32, wi: usize, n_waves: usize) -> f32 {
    if n_waves <= 1 {
        return smoothstep(t / BLOOM_DURATION.max(1e-3));
    }
    // Last wave should *finish* by BLOOM_WINDOW, so its start is
    // BLOOM_WINDOW - BLOOM_DURATION. Distribute starts linearly across waves.
    let last_start = (BLOOM_WINDOW - BLOOM_DURATION).max(0.0);
    let start = last_start * (wi as f32 / (n_waves - 1) as f32);
    smoothstep((t - start) / BLOOM_DURATION)
}

/// Build the full Vello scene for the predicted DAG. `scale` is the hidpi factor
/// of the offscreen target (text is shaped at this scale for crisp glyphs).
///
/// `t` ∈ [0,1] is the ANIMATION clock for the headless multi-frame render
/// (Method-A). At `t = 1.0` the scene is the final static look (so the
/// single-frame PNG path, which always passes `1.0`, is byte-for-byte the look
/// it was). As `t` sweeps 0→1: waves bloom in staggered (fade + scale + rise),
/// COMMITTED node glows breathe with a sine, and a bright pulse travels along
/// each edge source→target. The glow's sine is phased so `t = 1` ≈ `t = 0`,
/// letting an exported gif loop without a visible seam.
pub fn build_scene(
    scene: &mut Scene,
    text: &mut TextEngine,
    dag: &PredictedDag,
    canvas: &Canvas,
    scale: f32,
    t: f32,
) {
    scene.reset();
    let n_waves = dag.waves.len().max(1);
    // BREATHING phase, anchored so the STATIC look is reproduced at the seam.
    // `breathe` ∈ [0,1] is a "departure from rest". We run TWO full breathing
    // cycles across the clip — (1 - cos(2·2πt))/2 — which has three properties we
    // want: it is 0 at t=0, t=0.5, and t=1 (so the static PNG at t=1 renders the
    // unmodulated look), and because it returns to rest at t=0.5 the SETTLED
    // SECOND HALF (t∈[0.5,1]) is itself a complete, seamless loop — that's the
    // window the looping gif is cut from (the cards have finished blooming by
    // then). `CYCLES` ties the traveling-edge pulse to the same beat.
    const CYCLES: f32 = 2.0;
    let breathe =
        ((1.0 - (t * CYCLES * std::f32::consts::TAU).cos()) * 0.5) as f64; // 0 at t∈{0,0.5,1}

    paint_backdrop(scene, canvas);

    // --- Headline + meta sub-line (editorial type hierarchy). ---
    let title = if dag.title.is_empty() {
        "Conjure \u{2014} predicted DAG"
    } else {
        &dag.title
    };
    // A thin canary tick before the eyebrow, then a tracked-out eyebrow.
    scene.fill(
        Fill::NonZero,
        Affine::IDENTITY,
        CANARY,
        None,
        &Rect::new(MARGIN_X, 26.0, MARGIN_X + 22.0, 29.0),
    );
    text.draw_line_tracked(
        scene,
        "CONJURE \u{00b7} PREDICTED EXECUTION DAG",
        MARGIN_X + 32.0,
        20.0,
        12.0,
        700.0,
        CANARY,
        scale,
        2.4,
    );
    // The big editorial headline.
    text.draw_line(
        scene,
        &truncate(title, 72),
        MARGIN_X,
        40.0,
        34.0,
        800.0,
        INK,
        scale,
    );

    // Refined sub-line: classification + a dot-separated metric strip.
    let classification = if dag.problem_classification.is_empty() {
        "unclassified".to_string()
    } else {
        dag.problem_classification.clone()
    };
    let n_nodes: usize = dag.waves.iter().map(|w| w.nodes.len()).sum();
    let sub = format!(
        "{classification}   \u{2022}   {} waves   \u{2022}   {} nodes   \u{2022}   ~{:.0} min   \u{2022}   ${:.2}   \u{2022}   {:.0}% confidence",
        dag.waves.len(),
        n_nodes,
        dag.estimated_total_minutes,
        dag.estimated_total_cost_usd,
        dag.confidence * 100.0,
    );
    text.draw_line(scene, &sub, MARGIN_X, 86.0, 14.5, 500.0, INK_DIM, scale);

    // A halt reason (planner refused) reads in full, in the danger color.
    if let Some(reason) = &dag.halt_reason {
        text.draw_line(
            scene,
            &format!("HALT \u{00b7} {reason}"),
            MARGIN_X,
            110.0,
            14.0,
            600.0,
            DANGER,
            scale,
        );
    }

    // --- Resolve every node's card rect first so edges attach to real geometry. ---
    // Edges attach to the cards' *settled* (final) mid-points so the graph's
    // skeleton stays stable while cards bloom into place on top.
    let mut left_mid: HashMap<String, Point> = HashMap::new();
    let mut right_mid: HashMap<String, Point> = HashMap::new();
    let mut card_commit: HashMap<String, Commitment> = HashMap::new();
    // Per-card: (settled origin, node, wave index, this wave's bloom progress).
    let mut cards: Vec<(Point, &crate::dag::PredictedNode, usize, f32)> = Vec::new();
    // Per-target-node bloom, so an edge only flows once its target has begun to
    // arrive (the pulse "wakes up" the node it points at).
    let mut node_bloom: HashMap<String, f32> = HashMap::new();
    for (wi, wave) in dag.waves.iter().enumerate() {
        let rows = wave.nodes.len().max(1);
        let bloom = wave_bloom(t, wi, n_waves);
        for (ri, node) in wave.nodes.iter().enumerate() {
            let o = node_origin(canvas, wi, ri, rows);
            left_mid.insert(node.id.clone(), Point::new(o.x, o.y + NODE_H / 2.0));
            right_mid.insert(node.id.clone(), Point::new(o.x + NODE_W, o.y + NODE_H / 2.0));
            card_commit.insert(node.id.clone(), Commitment::of(&node.commitment_level));
            node_bloom.insert(node.id.clone(), bloom);
            cards.push((o, node, wi, bloom));
        }
    }

    // --- Feed-forward edges FIRST (under the cards), as gradient flowing strokes. ---
    for edge in build_edges(dag) {
        let (Some(&a), Some(&b)) = (right_mid.get(&edge.source), left_mid.get(&edge.target)) else {
            continue;
        };
        let src_commit = card_commit
            .get(&edge.source)
            .copied()
            .unwrap_or(Commitment::Unknown);
        // The edge fades in with its target's bloom; the traveling pulse position
        // is driven by clip-time `t` (a continuous source→target sweep).
        let edge_in = node_bloom.get(&edge.target).copied().unwrap_or(1.0);
        draw_edge(scene, a, b, src_commit, edge.commitment, t, edge_in, breathe);
    }

    // --- Wave column captions (tracked-out caps labels above each column). ---
    for (wi, wave) in dag.waves.iter().enumerate() {
        let rows = wave.nodes.len().max(1);
        let o0 = node_origin(canvas, wi, 0, rows);
        let label_y = (o0.y - 30.0).max(TOP_PAD - 34.0);
        // A small canary tick before the wave label.
        scene.fill(
            Fill::NonZero,
            Affine::IDENTITY,
            CANARY.multiply_alpha(0.85),
            None,
            &Rect::new(o0.x, label_y + 4.0, o0.x + 14.0, label_y + 6.5),
        );
        let parallel = if wave.parallelizable {
            "  //  PARALLEL"
        } else {
            "  \u{00b7}  SERIAL"
        };
        text.draw_line_tracked(
            scene,
            &format!("WAVE {}{parallel}", wave.wave_number),
            o0.x + 22.0,
            label_y,
            12.0,
            700.0,
            INK_DIM,
            scale,
            1.6,
        );
    }

    for (o, node, _wi, bloom) in cards {
        draw_card(scene, text, o, node, scale, bloom, breathe);
    }

    // A final vignette overlay, painted last so it darkens the very edges.
    paint_vignette(scene, canvas);
}

/// LIVING-HARBOR BACKDROP: a vertical ebony gradient (warm near the title,
/// deep at the keel), a faint radial horizon glow behind the graph, and a quiet
/// dithered dot-shimmer suggesting harbor water.
fn paint_backdrop(scene: &mut Scene, canvas: &Canvas) {
    let full = Rect::new(0.0, 0.0, canvas.width, canvas.height);

    // 1. Base vertical gradient: warm at the very top (behind the headline),
    //    settling to ebony through the graph, deepening toward the bottom.
    let bg = Brush::Gradient(
        Gradient::new_linear((0.0, 0.0), (0.0, canvas.height)).with_stops([
            (0.0_f32, BG_WARM),
            (0.16_f32, BG),
            (0.78_f32, BG),
            (1.0_f32, BG_DEEP),
        ]),
    );
    scene.fill(Fill::NonZero, Affine::IDENTITY, &bg, None, &full);

    // 2. Faint radial horizon glow behind the graph body — a warm canary-tinted
    //    bloom low-and-center, evoking light off the harbor water. Very quiet.
    let glow_center = Point::new(canvas.width * 0.5, canvas.height * 0.62);
    let glow_r = (canvas.width.max(canvas.height)) * 0.62;
    let horizon = Brush::Gradient(
        Gradient::new_radial(glow_center, glow_r as f32)
            .with_extend(Extend::Pad)
            .with_stops([
                (0.0_f32, Color::rgb8(0x46, 0x3c, 0x29).multiply_alpha(0.62)),
                (0.40_f32, Color::rgb8(0x30, 0x2b, 0x22).multiply_alpha(0.34)),
                (1.0_f32, BG.multiply_alpha(0.0)),
            ]),
    );
    scene.fill(Fill::NonZero, Affine::IDENTITY, &horizon, None, &full);

    // 3. Dithered dot-shimmer: a faint staggered grid of tiny dots (a hand-built
    //    Bayer-ish pixel texture) over the lower harbor band. Alpha falls off
    //    toward the top so it never competes with the graph. Quiet by design.
    let spacing = 26.0_f64;
    let band_top = TOP_PAD - 10.0;
    let mut y = band_top;
    let mut row = 0usize;
    while y < canvas.height - 8.0 {
        // Staggered (brick) offset every other row → the dither lattice.
        let x_off = if row % 2 == 0 { 0.0 } else { spacing / 2.0 };
        let mut x = 10.0 + x_off;
        // Depth fade: stronger toward the bottom (the water), fading up.
        let depth = ((y - band_top) / (canvas.height - band_top)).clamp(0.0, 1.0);
        let base_a = 0.018 + 0.030 * depth;
        while x < canvas.width - 6.0 {
            // A 2x2 Bayer threshold gives the dots a subtle ordered twinkle.
            let bayer = [[0.0, 0.5], [0.75, 0.25]][row % 2][((x / spacing) as usize) % 2];
            let a = (base_a * (0.6 + 0.8 * bayer)) as f32;
            if a > 0.004 {
                scene.fill(
                    Fill::NonZero,
                    Affine::IDENTITY,
                    COBALT.multiply_alpha(a),
                    None,
                    &Circle::new(Point::new(x, y), 1.1),
                );
            }
            x += spacing;
        }
        y += spacing;
        row += 1;
    }

    // 4. A faint top hairline glow under the headline band — separates the
    //    editorial masthead from the graph water.
    let band = Brush::Gradient(
        Gradient::new_linear((MARGIN_X, 0.0), (canvas.width - MARGIN_X, 0.0)).with_stops([
            (0.0_f32, CANARY.multiply_alpha(0.0)),
            (0.12_f32, CANARY.multiply_alpha(0.28)),
            (0.5_f32, CANARY.multiply_alpha(0.10)),
            (1.0_f32, CANARY.multiply_alpha(0.0)),
        ]),
    );
    scene.fill(
        Fill::NonZero,
        Affine::IDENTITY,
        &band,
        None,
        &Rect::new(MARGIN_X, TOP_PAD - 44.0, canvas.width - MARGIN_X, TOP_PAD - 43.0),
    );
}

/// A subtle vignette: four soft dark blurred bars hugging the frame edges, so
/// the corners fall into shadow and the eye is drawn to the graph center.
fn paint_vignette(scene: &mut Scene, canvas: &Canvas) {
    let w = canvas.width;
    let h = canvas.height;
    let shade = Color::rgb8(0x0a, 0x09, 0x08);
    let depth = 0.72_f32;
    let std = 58.0;
    // Top, bottom, left, right dark blurred rects placed just outside the frame
    // so only their inner falloff darkens the edge.
    scene.draw_blurred_rounded_rect(
        Affine::IDENTITY,
        Rect::new(-80.0, -90.0, w + 80.0, 4.0),
        shade.multiply_alpha(depth),
        0.0,
        std,
    );
    scene.draw_blurred_rounded_rect(
        Affine::IDENTITY,
        Rect::new(-80.0, h - 4.0, w + 80.0, h + 90.0),
        shade.multiply_alpha(depth),
        0.0,
        std,
    );
    scene.draw_blurred_rounded_rect(
        Affine::IDENTITY,
        Rect::new(-90.0, -80.0, 4.0, h + 80.0),
        shade.multiply_alpha(depth),
        0.0,
        std,
    );
    scene.draw_blurred_rounded_rect(
        Affine::IDENTITY,
        Rect::new(w - 4.0, -80.0, w + 90.0, h + 80.0),
        shade.multiply_alpha(depth),
        0.0,
        std,
    );
}

/// Draw a single node card with DEPTH + GLOW: a soft blurred drop shadow, a
/// commitment-colored outer glow, a raised→panel gradient fill, a gradient
/// header strip, a crisp 2px commitment border + left accent rail, and the
/// stacked Parley text rows. A gate marker rides the top-right when
/// `ask_user_before_proceeding`.
fn draw_card(
    scene: &mut Scene,
    text: &mut TextEngine,
    origin: Point,
    node: &crate::dag::PredictedNode,
    scale: f32,
    bloom: f32,
    breathe: f64,
) {
    let commitment = Commitment::of(&node.commitment_level);
    let accent = commitment_color(commitment);
    let rect = Rect::new(origin.x, origin.y, origin.x + NODE_W, origin.y + NODE_H);
    let radius = 14.0;
    let rrect = RoundedRect::from_rect(rect, radius);

    // --- BLOOM-IN transform + fade. As `bloom` 0→1 the card eases up from a few
    //     px below its settled spot and from 96%→100% scale, anchored on its own
    //     center so the layout doesn't shift. `a` is the fade alpha applied to
    //     the card's paints; text fades by being skipped until the card is
    //     mostly present (Parley has no per-run alpha here, so we gate it). ---
    let b = bloom as f64;
    let a = bloom as f64; // fade alpha 0..1
    let center = Point::new(origin.x + NODE_W / 2.0, origin.y + NODE_H / 2.0);
    let card_scale = 0.96 + 0.04 * b;
    let rise = (1.0 - b) * 14.0; // px below settled, eased to 0
    // Scale about the card center, then translate up by `rise`.
    let xf = Affine::translate((0.0, rise))
        * Affine::translate((center.x, center.y))
        * Affine::scale(card_scale)
        * Affine::translate((-center.x, -center.y));
    // A card that has not begun to bloom contributes nothing.
    if a <= 0.001 {
        return;
    }

    // Wrap the ENTIRE card in a single Vello layer carrying (a) the bloom
    // transform `xf` and (b) the fade alpha `a` as a group opacity. Every inner
    // paint then draws in `Affine::IDENTITY` (it inherits the layer transform)
    // and the whole card — body, border, glow, shadow, AND glyph runs — fades
    // uniformly as one unit. The clip is the card rect inflated generously so
    // the blurred shadow/glow that spill outside the card aren't clipped.
    let bloom_complete = a >= 0.999;
    if !bloom_complete {
        let clip = rect.inflate(48.0, 56.0);
        scene.push_layer(
            peniko::Mix::Normal,
            a as f32,
            xf,
            &clip,
        );
    }

    // 1. Soft DROP SHADOW: a blurred dark rounded-rect offset down-right.
    let shadow = rect.with_origin((origin.x + 0.0, origin.y + 10.0)).inflate(2.0, 2.0);
    scene.draw_blurred_rounded_rect(
        Affine::IDENTITY,
        shadow,
        Color::rgb8(0x00, 0x00, 0x00).multiply_alpha(0.55),
        radius,
        16.0,
    );

    // 2. Commitment-colored OUTER GLOW: stronger for COMMITTED (canary), medium
    //    for TENTATIVE (cobalt), dim for EXPLORATORY/unknown. COMMITTED cards'
    //    glow BREATHES — the alpha pulses with `breathe` (the presence beacon).
    let (glow_alpha, glow_std) = match commitment {
        Commitment::Committed => (0.42, 20.0),
        Commitment::Tentative => (0.26, 16.0),
        Commitment::Exploratory => (0.12, 12.0),
        Commitment::Unknown => (0.08, 10.0),
    };
    // For COMMITTED, the glow BREATHES: `breathe` is 0 at the seam (so the static
    // look is exactly the base glow) and swells to 1 at mid-clip, brightening the
    // alpha up to +55% and the blur radius by up to +7px — a slow presence beacon
    // that returns to rest at the loop point.
    let (glow_alpha, glow_std) = if commitment == Commitment::Committed {
        let pulse = 1.0 + 0.55 * breathe; // 1.0 at seam → 1.55 at mid
        (glow_alpha * pulse, glow_std + 7.0 * breathe)
    } else {
        (glow_alpha, glow_std)
    };
    scene.draw_blurred_rounded_rect(
        Affine::IDENTITY,
        rect.inflate(1.5, 1.5),
        accent.multiply_alpha(glow_alpha as f32),
        radius + 2.0,
        glow_std,
    );

    // 3. Card BODY: a raised→panel vertical gradient (top catches the light).
    let body = vgrad(RAISED, PANEL, origin.y, origin.y + NODE_H);
    scene.fill(Fill::NonZero, Affine::IDENTITY, &body, None, &rrect);

    // 3b. Premium TOP SHEEN: a thin glassy highlight along the top inner edge
    //     that fades down — the card reads as a lit, raised surface.
    let sheen = Brush::Gradient(
        Gradient::new_linear((0.0, origin.y), (0.0, origin.y + 26.0)).with_stops([
            (0.0_f32, INK.multiply_alpha(0.10)),
            (1.0_f32, INK.multiply_alpha(0.0)),
        ]),
    );
    let sheen_rr = RoundedRect::new(
        origin.x + 1.5,
        origin.y + 1.5,
        origin.x + NODE_W - 1.5,
        origin.y + 26.0,
        RoundedRectRadii::new(radius - 1.0, radius - 1.0, 0.0, 0.0),
    );
    scene.fill(Fill::NonZero, Affine::IDENTITY, &sheen, None, &sheen_rr);

    // 4. HEADER STRIP (top ~36px): a brighter raised→panel gradient + an accent
    //    wash so the eyebrow sits on a tinted shelf.
    let header_h = 38.0;
    let header_rr = RoundedRect::new(
        origin.x,
        origin.y,
        origin.x + NODE_W,
        origin.y + header_h,
        RoundedRectRadii::new(radius, radius, 0.0, 0.0),
    );
    let header_grad = vgrad(
        lerp_color(RAISED, accent, 0.10),
        RAISED,
        origin.y,
        origin.y + header_h,
    );
    scene.fill(Fill::NonZero, Affine::IDENTITY, &header_grad, None, &header_rr);
    // Header underline: a gradient hairline that fades out to the right.
    let underline = Brush::Gradient(
        Gradient::new_linear((origin.x, 0.0), (origin.x + NODE_W, 0.0)).with_stops([
            (0.0_f32, accent.multiply_alpha(0.7)),
            (1.0_f32, accent.multiply_alpha(0.05)),
        ]),
    );
    scene.fill(
        Fill::NonZero,
        Affine::IDENTITY,
        &underline,
        None,
        &Rect::new(origin.x, origin.y + header_h - 1.0, origin.x + NODE_W, origin.y + header_h),
    );

    // 5. Crisp commitment BORDER: solid 2px (committed), dashed (tentative),
    //    dotted/faint (exploratory).
    let mut stroke = Stroke::new(if commitment == Commitment::Committed { 2.0 } else { 1.6 });
    match commitment {
        Commitment::Tentative => stroke = stroke.with_dashes(0.0, [7.0, 4.0]),
        Commitment::Exploratory => stroke = stroke.with_dashes(0.0, [2.0, 4.0]),
        _ => {}
    }
    let border_color = if commitment == Commitment::Exploratory {
        accent.multiply_alpha(0.7)
    } else {
        accent
    };
    scene.stroke(&stroke, Affine::IDENTITY, border_color, None, &rrect);

    // 6. Left accent rail (a 4px bar in the commitment color, full height).
    scene.fill(
        Fill::NonZero,
        Affine::IDENTITY,
        accent,
        None,
        &RoundedRect::new(
            origin.x + 1.0,
            origin.y + 1.0,
            origin.x + 5.0,
            origin.y + NODE_H - 1.0,
            RoundedRectRadii::new(2.0, 0.0, 0.0, 2.0),
        ),
    );

    let pad_x = origin.x + 16.0;
    let inner_w = NODE_W - 32.0;

    // 7. EYEBROW: skill_id (bold, accent color, in the header strip).
    text.draw_line(
        scene,
        &truncate(&node.skill_id, 28),
        pad_x,
        origin.y + 11.0,
        14.0,
        700.0,
        accent,
        scale,
    );

    // 8. ROLE: wrapped body, the primary line (bold ink, clamped to the band).
    let role_y = origin.y + 50.0;
    text.draw_wrapped(
        scene,
        &truncate(&node.role_description, 96),
        pad_x,
        role_y,
        inner_w,
        15.0,
        600.0,
        INK,
        scale,
    );

    // 9. FOOTER: a vendor chip + a refined cost/time/cascade line.
    let footer_y = origin.y + NODE_H - 30.0;
    // A gradient divider above the footer (fades out to the right).
    let div = Brush::Gradient(
        Gradient::new_linear((pad_x, 0.0), (pad_x + inner_w, 0.0)).with_stops([
            (0.0_f32, HAIRLINE.multiply_alpha(0.9)),
            (1.0_f32, HAIRLINE.multiply_alpha(0.0)),
        ]),
    );
    scene.fill(
        Fill::NonZero,
        Affine::IDENTITY,
        &div,
        None,
        &Rect::new(pad_x, footer_y - 10.0, pad_x + inner_w, footer_y - 9.0),
    );

    // Vendor model-tier CHIP: a small pill, accent-tinted by vendor family.
    let model = if node.model_tier.is_empty() {
        "\u{2014}".to_string()
    } else {
        node.model_tier.clone()
    };
    let chip_accent = vendor_accent(&model);
    let chip_label = truncate(&model, 12);
    let chip_text_w = text.measure(&chip_label, 12.0, 700.0, 0.6, scale);
    let chip_pad = 9.0;
    let chip_h = 19.0;
    let chip_x0 = pad_x;
    let chip_y0 = footer_y;
    let chip_x1 = chip_x0 + chip_text_w + chip_pad * 2.0;
    let chip_rr = RoundedRect::new(
        chip_x0,
        chip_y0,
        chip_x1,
        chip_y0 + chip_h,
        RoundedRectRadii::from(chip_h / 2.0),
    );
    // Pill background: a tinted fill + a 1px accent ring.
    scene.fill(
        Fill::NonZero,
        Affine::IDENTITY,
        chip_accent.multiply_alpha(0.16),
        None,
        &chip_rr,
    );
    scene.stroke(
        &Stroke::new(1.0),
        Affine::IDENTITY,
        chip_accent.multiply_alpha(0.85),
        None,
        &chip_rr,
    );
    text.draw_line_tracked(
        scene,
        &chip_label,
        chip_x0 + chip_pad,
        chip_y0 + 3.0,
        12.0,
        700.0,
        chip_accent,
        scale,
        0.6,
    );

    // Cost / time / cascade, to the right of the chip (success-tinted "live").
    let cascade = if node.cascade_depth > 0 {
        format!("  \u{00b7}  casc {}", node.cascade_depth)
    } else {
        String::new()
    };
    let metrics = format!(
        "${:.2}  \u{00b7}  {:.0}m{cascade}",
        node.estimated_cost_usd, node.estimated_minutes
    );
    text.draw_line(
        scene,
        &metrics,
        chip_x1 + 10.0,
        chip_y0 + 3.0,
        12.5,
        600.0,
        SUCCESS,
        scale,
    );

    // 10. HITL gate marker: a filled danger dot + an open ring + a glow, top-right.
    if node.ask_user_before_proceeding {
        let c = Point::new(origin.x + NODE_W - 20.0, origin.y + 19.0);
        scene.draw_blurred_rounded_rect(
            Affine::IDENTITY,
            Rect::new(c.x - 6.0, c.y - 6.0, c.x + 6.0, c.y + 6.0),
            DANGER.multiply_alpha(0.5),
            6.0,
            8.0,
        );
        scene.fill(Fill::NonZero, Affine::IDENTITY, DANGER, None, &Circle::new(c, 5.0));
        scene.stroke(
            &Stroke::new(1.5),
            Affine::IDENTITY,
            DANGER.multiply_alpha(0.7),
            None,
            &Circle::new(c, 9.0),
        );
        // A "GATE" tracked label under the ring, hugging the right edge.
        let gw = text.measure("GATE", 10.0, 800.0, 1.2, scale);
        text.draw_line_tracked(
            scene,
            "GATE",
            origin.x + NODE_W - 14.0 - gw,
            origin.y + 28.0,
            10.0,
            800.0,
            DANGER,
            scale,
            1.2,
        );
    }

    // Close the bloom layer (balances the push above).
    if !bloom_complete {
        scene.pop_layer();
    }
}

/// A feed-forward cubic-bezier edge from `a` (source right-mid) to `b` (target
/// left-mid). Drawn as a GRADIENT FLOWING stroke (source color → target color),
/// styled by the *target's* commitment: COMMITTED = thick + soft glow underlay +
/// a bright tapered leading segment near the target, TENTATIVE = dashed cobalt,
/// EXPLORATORY = dotted + faint. A refined arrowhead caps the target.
#[allow(clippy::too_many_arguments)]
fn draw_edge(
    scene: &mut Scene,
    a: Point,
    b: Point,
    src_commit: Commitment,
    commitment: Commitment,
    t: f32,
    edge_in: f32,
    breathe: f64,
) {
    // The edge stays invisible until its target node has begun to bloom, then
    // eases in with that node — so the graph "wires up" wave-by-wave.
    let appear = smoothstep((edge_in - 0.15) / 0.55) as f64;
    if appear <= 0.001 {
        return;
    }
    let src_color = commitment_color(src_commit);
    let tgt_color = commitment_color(commitment);

    // The full S-curve.
    let dx = (b.x - a.x).abs().max(60.0);
    let c1 = Point::new(a.x + dx * 0.5, a.y);
    let c2 = Point::new(b.x - dx * 0.5, b.y);
    let mut path = BezPath::new();
    path.move_to(a);
    path.curve_to(c1, c2, b);

    // Fade the whole edge in with `appear` by wrapping it in an alpha layer
    // (clip = its bounding box, generously inflated for the glow/arrowhead).
    let edge_full = appear >= 0.999;
    if !edge_full {
        let bbox = Rect::new(
            a.x.min(b.x) - 16.0,
            a.y.min(b.y) - 16.0,
            a.x.max(b.x) + 16.0,
            a.y.max(b.y) + 16.0,
        );
        scene.push_layer(peniko::Mix::Normal, appear as f32, Affine::IDENTITY, &bbox);
    }

    // A horizontal gradient brush from the source color to the target color,
    // spanning the edge's x-extent → the stroke reads as flow/direction.
    let flow = Brush::Gradient(
        Gradient::new_linear((a.x, 0.0), (b.x, 0.0)).with_stops([
            (0.0_f32, src_color.multiply_alpha(0.85)),
            (0.5_f32, lerp_color(src_color, tgt_color, 0.5)),
            (1.0_f32, tgt_color),
        ]),
    );

    match commitment {
        Commitment::Committed => {
            // Soft glow underlay (target-tinted), then the gradient flow stroke.
            scene.stroke(
                &Stroke::new(7.0),
                Affine::IDENTITY,
                tgt_color.multiply_alpha(0.16),
                None,
                &path,
            );
            scene.stroke(&Stroke::new(2.4), Affine::IDENTITY, &flow, None, &path);
            // A bright tapered LEADING SEGMENT near the target (the "head" of
            // the flow): re-stroke just the last third, brighter + thicker.
            let lead = leading_segment(a, c1, c2, b, 0.62);
            scene.stroke(
                &Stroke::new(3.0),
                Affine::IDENTITY,
                tgt_color,
                None,
                &lead,
            );
        }
        Commitment::Tentative => {
            let s = Stroke::new(1.9).with_dashes(0.0, [8.0, 5.0]);
            scene.stroke(&s, Affine::IDENTITY, &flow, None, &path);
        }
        Commitment::Exploratory => {
            let s = Stroke::new(1.5).with_dashes(0.0, [1.5, 5.0]);
            scene.stroke(
                &s,
                Affine::IDENTITY,
                tgt_color.multiply_alpha(0.65),
                None,
                &path,
            );
        }
        Commitment::Unknown => {
            scene.stroke(&Stroke::new(1.25), Affine::IDENTITY, &flow, None, &path);
        }
    }

    // --- TRAVELING PULSE: a short bright segment sweeping source→target.
    // The pulse center `p` ∈ [0,1) cycles with clip-time `t`; at t=0 and t=1 it
    // sits at the same place, so an exported gif loops seamlessly. The pulse is
    // brightest for COMMITTED edges (the live "flow"), quieter otherwise, and is
    // suppressed entirely on the faintest EXPLORATORY edges to keep them calm. ---
    // Skip entirely at the seam (breathe≈0) so the static PNG draws no pulse
    // geometry at all — byte-identical static look — and the loop has no snap.
    if commitment != Commitment::Exploratory && breathe > 0.001 {
        // Two sweeps across the clip (matches the breathing CYCLES), so the pulse
        // returns to the edge start at t=0.5 and t=1 — the settled-half loop seam.
        let p = ((t * 2.0) as f64).fract(); // 0..1, loops at t∈{0,0.5,1}
        let half = 0.10; // pulse covers ~20% of the curve
        let t0 = (p - half).clamp(0.0, 1.0);
        let t1 = (p + half).clamp(0.0, 1.0);
        if t1 - t0 > 0.01 {
            let pulse = sample_segment(a, c1, c2, b, t0, t1);
            // Brightness eases up at the wave seam (so the loop has a tiny breath)
            // and is stronger for committed flow. A soft underlay + a hot core.
            let (under_w, core_w, core_a) = match commitment {
                Commitment::Committed => (6.5, 2.6, 1.0),
                Commitment::Tentative => (4.5, 1.8, 0.85),
                _ => (3.5, 1.4, 0.7),
            };
            // The pulse rides on `breathe`, so it FADES TO NOTHING at the seam
            // (t∈{0,1}) — the static PNG (t=1) shows no pulse, and the gif loops
            // without a visible "snap". It's brightest mid-clip.
            let beacon = breathe;
            scene.stroke(
                &Stroke::new(under_w),
                Affine::IDENTITY,
                tgt_color.multiply_alpha((0.22 * beacon) as f32),
                None,
                &pulse,
            );
            // A near-white hot core so the pulse reads as a moving light.
            let hot = lerp_color(tgt_color, INK, 0.55);
            scene.stroke(
                &Stroke::new(core_w),
                Affine::IDENTITY,
                hot.multiply_alpha((core_a * beacon) as f32),
                None,
                &pulse,
            );
        }
    }

    // Arrowhead at the target end (along the incoming tangent c2 -> b).
    let dir = (b - c2).normalize();
    draw_arrowhead(scene, b, dir, tgt_color);

    // Close the edge fade-in layer (balances the push above).
    if !edge_full {
        scene.pop_layer();
    }
}

/// Sample the cubic over t ∈ [t0, t1] into a fresh polyline BezPath — used for
/// the traveling pulse (a short bright window of the edge).
fn sample_segment(p0: Point, p1: Point, p2: Point, p3: Point, t0: f64, t1: f64) -> BezPath {
    let bez = |t: f64| -> Point {
        let u = 1.0 - t;
        let w0 = u * u * u;
        let w1 = 3.0 * u * u * t;
        let w2 = 3.0 * u * t * t;
        let w3 = t * t * t;
        Point::new(
            w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
            w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
        )
    };
    let mut path = BezPath::new();
    let steps = 12;
    for i in 0..=steps {
        let t = t0 + (t1 - t0) * (i as f64 / steps as f64);
        let pt = bez(t);
        if i == 0 {
            path.move_to(pt);
        } else {
            path.line_to(pt);
        }
    }
    path
}

/// Re-evaluate the cubic to produce a sub-path covering t ∈ [t0, 1] — the
/// "leading" tail near the target — as a fresh BezPath built from sampled points.
fn leading_segment(p0: Point, p1: Point, p2: Point, p3: Point, t0: f64) -> BezPath {
    let bez = |t: f64| -> Point {
        let u = 1.0 - t;
        let w0 = u * u * u;
        let w1 = 3.0 * u * u * t;
        let w2 = 3.0 * u * t * t;
        let w3 = t * t * t;
        Point::new(
            w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
            w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
        )
    };
    let mut path = BezPath::new();
    let steps = 14;
    for i in 0..=steps {
        let t = t0 + (1.0 - t0) * (i as f64 / steps as f64);
        let p = bez(t);
        if i == 0 {
            path.move_to(p);
        } else {
            path.line_to(p);
        }
    }
    path
}

/// Small filled triangle at `tip`, pointing along unit `dir`.
fn draw_arrowhead(scene: &mut Scene, tip: Point, dir: Vec2, color: Color) {
    let perp = Vec2::new(-dir.y, dir.x);
    let base = tip - dir * 10.0;
    let left = base + perp * 5.0;
    let right = base - perp * 5.0;
    let mut head = BezPath::new();
    head.move_to(tip);
    head.line_to(left);
    head.line_to(right);
    head.close_path();
    scene.fill(Fill::NonZero, Affine::IDENTITY, color, None, &head);
}
