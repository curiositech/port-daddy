//! Vello scene construction for the Conjure predicted-DAG node-graph.
//!
//! This is the VELLO GRAPH slice (Rung 1, per `CONJURE-DAG-SURFACE.md`): a
//! wave-column layout (x = `wave_number`), each node a rounded-rect card with
//! Parley-shaped text, feed-forward cubic-bezier edges styled by
//! `commitment_level`. Everything is bespoke GPU vector rendering — hand-built
//! paths fed into the same Vello scene as the glyph runs, no widget tree.
//!
//! The Parley glyph-run pipeline (`TextEngine` + `render_glyph_run`) mirrors
//! `pd-timeline-proto/src/scene.rs` — the proven Rung-1 text path.

use std::collections::HashMap;

use kurbo::{Affine, BezPath, Circle, Point, Rect, RoundedRect, RoundedRectRadii, Stroke, Vec2};
use parley::{
    Alignment, FontContext, GlyphRun, Layout, LayoutContext, PositionedLayoutItem, StyleProperty,
};
use peniko::{Brush, Color, Fill};
use vello::Scene;

use crate::dag::{build_edges, Commitment, PredictedDag};

// --- Maritime palette (the harbor scheme the operator specified). ---
const BG: Color = Color::rgb8(0x1e, 0x1b, 0x18); // ebony
const PANEL: Color = Color::rgb8(0x2b, 0x27, 0x24); // card fill
const PANEL_HI: Color = Color::rgb8(0x35, 0x30, 0x2c); // header strip on a card
const CANARY: Color = Color::rgb8(0xff, 0xdb, 0x33); // accent
const SUCCESS: Color = Color::rgb8(0x6d, 0xd3, 0xa8); // green
const DANGER: Color = Color::rgb8(0xf2, 0x64, 0x75); // gate / refusal
const COBALT: Color = Color::rgb8(0x7f, 0xc4, 0xff); // tentative
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

/// Card geometry, in logical pixels.
const NODE_W: f64 = 280.0;
const NODE_H: f64 = 158.0;
const COL_GAP: f64 = 104.0; // horizontal gap between wave columns
const ROW_GAP: f64 = 56.0; // vertical gap between stacked nodes in a column
const MARGIN_X: f64 = 56.0;
const TOP_PAD: f64 = 128.0; // room for title + meta banner + the WAVE captions
const BOTTOM_PAD: f64 = 48.0;

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
        width: width.max(720.0),
        height: height.max(420.0),
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
        let mut builder = self.layout_cx.ranged_builder(&mut self.font_cx, text, scale);
        builder.push_default(StyleProperty::FontSize(size));
        builder.push_default(StyleProperty::FontWeight(parley::FontWeight::new(weight)));
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

/// Build the full Vello scene for the predicted DAG. `scale` is the hidpi factor
/// of the offscreen target (text is shaped at this scale for crisp glyphs).
pub fn build_scene(
    scene: &mut Scene,
    text: &mut TextEngine,
    dag: &PredictedDag,
    canvas: &Canvas,
    scale: f32,
) {
    scene.reset();

    // 1. Background.
    scene.fill(
        Fill::NonZero,
        Affine::IDENTITY,
        BG,
        None,
        &Rect::new(0.0, 0.0, canvas.width, canvas.height),
    );

    // 2. Title + meta banner.
    let title = if dag.title.is_empty() {
        "Conjure \u{2014} predicted DAG"
    } else {
        &dag.title
    };
    text.draw_line(scene, title, MARGIN_X, 28.0, 24.0, 700.0, INK, scale);

    let classification = if dag.problem_classification.is_empty() {
        "unclassified".to_string()
    } else {
        dag.problem_classification.clone()
    };
    let n_nodes: usize = dag.waves.iter().map(|w| w.nodes.len()).sum();
    let meta = format!(
        "{classification}  \u{00b7}  {} waves  \u{00b7}  {} nodes  \u{00b7}  ~{:.0}m  \u{00b7}  ${:.2}  \u{00b7}  {:.0}% confidence",
        dag.waves.len(),
        n_nodes,
        dag.estimated_total_minutes,
        dag.estimated_total_cost_usd,
        dag.confidence * 100.0,
    );
    text.draw_line(scene, &meta, MARGIN_X, 62.0, 14.0, 500.0, CANARY, scale);

    // A halt reason (planner refused) reads in full, in the danger color.
    if let Some(reason) = &dag.halt_reason {
        text.draw_line(
            scene,
            &format!("halt: {reason}"),
            MARGIN_X,
            84.0,
            14.0,
            600.0,
            DANGER,
            scale,
        );
    }

    // 3. Resolve every node's card rect first, so edges can attach to real
    //    geometry (left/right midpoints of the source/target cards).
    //    pos: node id -> (left-mid attach point, right-mid attach point).
    let mut left_mid: HashMap<String, Point> = HashMap::new();
    let mut right_mid: HashMap<String, Point> = HashMap::new();
    let mut cards: Vec<(Point, &crate::dag::PredictedNode)> = Vec::new();
    for (wi, wave) in dag.waves.iter().enumerate() {
        let rows = wave.nodes.len().max(1);
        for (ri, node) in wave.nodes.iter().enumerate() {
            let o = node_origin(canvas, wi, ri, rows);
            left_mid.insert(node.id.clone(), Point::new(o.x, o.y + NODE_H / 2.0));
            right_mid.insert(
                node.id.clone(),
                Point::new(o.x + NODE_W, o.y + NODE_H / 2.0),
            );
            cards.push((o, node));
        }
    }

    // 4. Feed-forward edges FIRST (under the cards), styled by commitment.
    for edge in build_edges(dag) {
        let (Some(&a), Some(&b)) = (right_mid.get(&edge.source), left_mid.get(&edge.target)) else {
            continue;
        };
        draw_edge(scene, a, b, edge.commitment);
    }

    // 5. Wave column captions (above each column) + node cards.
    for (wi, wave) in dag.waves.iter().enumerate() {
        let rows = wave.nodes.len().max(1);
        let o0 = node_origin(canvas, wi, 0, rows);
        let parallel = if wave.parallelizable {
            "  \u{2225}"
        } else {
            ""
        };
        text.draw_line(
            scene,
            &format!("WAVE {}{parallel}", wave.wave_number),
            o0.x,
            (o0.y - 26.0).max(TOP_PAD - 30.0),
            13.0,
            700.0,
            INK_DIM,
            scale,
        );
    }
    for (o, node) in cards {
        draw_card(scene, text, o, node, scale);
    }
}

/// Draw a single node card: rounded-rect panel with a commitment-colored stroke
/// + left accent rail, a header strip, and the stacked Parley text rows
/// (skill_id eyebrow, role_description, model/cost line). A gate marker rides the
/// top-right when `ask_user_before_proceeding`.
fn draw_card(
    scene: &mut Scene,
    text: &mut TextEngine,
    origin: Point,
    node: &crate::dag::PredictedNode,
    scale: f32,
) {
    let commitment = Commitment::of(&node.commitment_level);
    let accent = commitment_color(commitment);
    let rect = Rect::new(
        origin.x,
        origin.y,
        origin.x + NODE_W,
        origin.y + NODE_H,
    );
    let rrect = RoundedRect::from_rect(rect, 12.0);

    // Soft glow for committed nodes: a faint, larger rounded-rect underlay.
    if commitment == Commitment::Committed {
        let glow = RoundedRect::from_rect(rect.inflate(4.0, 4.0), 14.0);
        scene.fill(
            Fill::NonZero,
            Affine::IDENTITY,
            accent.multiply_alpha(0.16),
            None,
            &glow,
        );
    }

    // Panel fill.
    scene.fill(Fill::NonZero, Affine::IDENTITY, PANEL, None, &rrect);

    // Header strip (top ~32px) in a slightly lighter panel tone.
    let header = Rect::new(origin.x, origin.y, origin.x + NODE_W, origin.y + 34.0);
    scene.fill(
        Fill::NonZero,
        Affine::IDENTITY,
        PANEL_HI,
        None,
        &RoundedRect::new(
            header.x0,
            header.y0,
            header.x1,
            header.y1,
            // Rounded top corners, square bottom (the strip meets the card body).
            RoundedRectRadii::new(12.0, 12.0, 0.0, 0.0),
        ),
    );
    // Header underline hairline.
    scene.fill(
        Fill::NonZero,
        Affine::IDENTITY,
        HAIRLINE,
        None,
        &Rect::new(origin.x, origin.y + 33.0, origin.x + NODE_W, origin.y + 34.0),
    );

    // Card border, commitment-styled: solid (committed), dashed (tentative),
    // dotted/faint (exploratory). Matches the edge styling.
    let mut stroke = Stroke::new(if commitment == Commitment::Committed {
        2.0
    } else {
        1.5
    });
    match commitment {
        Commitment::Tentative => stroke = stroke.with_dashes(0.0, [6.0, 4.0]),
        Commitment::Exploratory => stroke = stroke.with_dashes(0.0, [2.0, 4.0]),
        _ => {}
    }
    let border_color = if commitment == Commitment::Exploratory {
        accent.multiply_alpha(0.7)
    } else {
        accent
    };
    scene.stroke(&stroke, Affine::IDENTITY, border_color, None, &rrect);

    // Left accent rail (a 3px bar in the commitment color, full height).
    scene.fill(
        Fill::NonZero,
        Affine::IDENTITY,
        accent,
        None,
        &Rect::new(origin.x, origin.y + 1.0, origin.x + 3.0, origin.y + NODE_H - 1.0),
    );

    let pad_x = origin.x + 14.0;
    // Reserve room on the right for the gate dot so the eyebrow never collides.
    let gate_pad = if node.ask_user_before_proceeding { 26.0 } else { 0.0 };
    let inner_w = NODE_W - 28.0;

    // Eyebrow: skill_id (accent color + heavy weight, in the header strip).
    text.draw_line(
        scene,
        &truncate(&node.skill_id, 28),
        pad_x,
        origin.y + 9.0,
        13.0,
        700.0,
        accent,
        scale,
    );
    let _ = gate_pad;

    // role_description: wrapped body, the primary line, clamped to the band
    // between the header strip and the footer divider (truncated so it never
    // bleeds into the cost line).
    let role_y = origin.y + 44.0;
    text.draw_wrapped(
        scene,
        &truncate(&node.role_description, 96),
        pad_x,
        role_y,
        inner_w,
        14.0,
        500.0,
        INK,
        scale,
    );

    // model / cost / time line — model_tier rendered VERBATIM (vendor-agnostic).
    let model = if node.model_tier.is_empty() {
        "—".to_string()
    } else {
        node.model_tier.clone()
    };
    let cascade = if node.cascade_depth > 0 {
        format!("  \u{00b7}  \u{21af}{}", node.cascade_depth)
    } else {
        String::new()
    };
    let model_line = format!(
        "{model}  \u{00b7}  ${:.2}  \u{00b7}  {:.0}m{cascade}",
        node.estimated_cost_usd, node.estimated_minutes
    );
    // Pin the model line near the card bottom for a consistent footer baseline.
    let footer_y = origin.y + NODE_H - 24.0;
    // A thin divider above the footer.
    scene.fill(
        Fill::NonZero,
        Affine::IDENTITY,
        HAIRLINE,
        None,
        &Rect::new(pad_x, footer_y - 8.0, pad_x + inner_w, footer_y - 7.5),
    );
    // Model tier chip color: success-tinted text so the cost line reads as "live".
    text.draw_line(
        scene,
        &model_line,
        pad_x,
        footer_y,
        13.0,
        600.0,
        SUCCESS,
        scale,
    );

    // The HITL gate marker: a filled danger dot + an open ring, top-right.
    if node.ask_user_before_proceeding {
        let c = Point::new(origin.x + NODE_W - 16.0, origin.y + 17.0);
        scene.fill(
            Fill::NonZero,
            Affine::IDENTITY,
            DANGER,
            None,
            &Circle::new(c, 5.0),
        );
        scene.stroke(
            &Stroke::new(1.5),
            Affine::IDENTITY,
            DANGER.multiply_alpha(0.7),
            None,
            &Circle::new(c, 9.0),
        );
        // A "gate" label just below the ring, hugging the right edge.
        let gw = text.draw_line(scene, "gate", 0.0, -100.0, 11.0, 700.0, DANGER, scale);
        text.draw_line(
            scene,
            "gate",
            origin.x + NODE_W - 14.0 - gw,
            origin.y + 24.0,
            11.0,
            700.0,
            DANGER,
            scale,
        );
    }
}

/// A feed-forward cubic-bezier edge from `a` (source right-mid) to `b` (target
/// left-mid). Styled by commitment: COMMITTED = solid + accent glow underlay,
/// TENTATIVE = dashed cobalt, EXPLORATORY = dotted + faint.
fn draw_edge(scene: &mut Scene, a: Point, b: Point, commitment: Commitment) {
    let color = commitment_color(commitment);
    let mut path = BezPath::new();
    path.move_to(a);
    let dx = (b.x - a.x).abs().max(60.0);
    let c1 = Point::new(a.x + dx * 0.5, a.y);
    let c2 = Point::new(b.x - dx * 0.5, b.y);
    path.curve_to(c1, c2, b);

    match commitment {
        Commitment::Committed => {
            // Glow underlay, then a solid bright stroke.
            scene.stroke(
                &Stroke::new(6.0),
                Affine::IDENTITY,
                color.multiply_alpha(0.20),
                None,
                &path,
            );
            scene.stroke(&Stroke::new(2.0), Affine::IDENTITY, color, None, &path);
        }
        Commitment::Tentative => {
            let s = Stroke::new(1.75).with_dashes(0.0, [7.0, 5.0]);
            scene.stroke(&s, Affine::IDENTITY, color, None, &path);
        }
        Commitment::Exploratory => {
            let s = Stroke::new(1.5).with_dashes(0.0, [1.5, 5.0]);
            scene.stroke(
                &s,
                Affine::IDENTITY,
                color.multiply_alpha(0.7),
                None,
                &path,
            );
        }
        Commitment::Unknown => {
            scene.stroke(
                &Stroke::new(1.25),
                Affine::IDENTITY,
                color,
                None,
                &path,
            );
        }
    }

    // Arrowhead at the target end (along the incoming tangent c2 -> b).
    let dir = (b - c2_dir(a, b)).normalize();
    draw_arrowhead(scene, b, dir, color);
}

/// Approximate the incoming tangent direction at the target: from the second
/// control point toward `b`. We recompute c2 here to avoid threading it out.
fn c2_dir(a: Point, b: Point) -> Point {
    let dx = (b.x - a.x).abs().max(60.0);
    Point::new(b.x - dx * 0.5, b.y)
}

/// Small filled triangle at `tip`, pointing along unit `dir`.
fn draw_arrowhead(scene: &mut Scene, tip: Point, dir: Vec2, color: Color) {
    let perp = Vec2::new(-dir.y, dir.x);
    let base = tip - dir * 9.0;
    let left = base + perp * 4.5;
    let right = base - perp * 4.5;
    let mut head = BezPath::new();
    head.move_to(tip);
    head.line_to(left);
    head.line_to(right);
    head.close_path();
    scene.fill(Fill::NonZero, Affine::IDENTITY, color, None, &head);
}
