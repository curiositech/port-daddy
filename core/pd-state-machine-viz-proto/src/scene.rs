//! Vello scene construction for the dispatch review state machine.
//!
//! Ported from `pd-timeline-proto/src/scene.rs`: same bespoke GPU vector
//! rendering approach (hand-built paths + Parley glyph runs fed straight into
//! one Vello `Scene`, rebuilt fresh every frame — no widget tree, no retained
//! scene graph). The glyph pipeline (`TextEngine`, `render_glyph_run`, the
//! F2Dot14 `normalized_coords` reinterpret) and the causal-thread bezier +
//! arrowhead helpers are reused near-verbatim; only the subject changed, from
//! a scrubbing timeline of daemon events to a state-machine diagram with a
//! timeline strip underneath it.

use kurbo::{Affine, BezPath, Line, Point, RoundedRect, Stroke};
use parley::{
    Alignment, FontContext, GlyphRun, Layout, LayoutContext, PositionedLayoutItem, StyleProperty,
};
use peniko::{Brush, Color, Fill};
use vello::Scene;

use crate::layout::{layout, NODE_H, NODE_W};
use crate::model::{ReviewState, StateGraph, Tone};

// --- Palette (dark, harbor-ish; standalone R&D window, own minimal scheme —
//     matches pd-timeline-proto's palette so the two prototypes read as a
//     family, not because either pulls from website tokens). ---
const BG: Color = Color::rgb8(0x0d, 0x11, 0x17);
const NODE_STROKE: Color = Color::rgb8(0x3a, 0x44, 0x50);
const NODE_FILL_DEFAULT: Color = Color::rgb8(0x1a, 0x20, 0x29);
const TEXT: Color = Color::rgb8(0xc8, 0xd2, 0xdc);
const TEXT_DIM: Color = Color::rgb8(0x7a, 0x86, 0x92);
const PLAYHEAD: Color = Color::rgb8(0xff, 0x6b, 0x35);
const EDGE: Color = Color::rgb8(0x3a, 0x44, 0x50);
const ACTIVE_RING: Color = Color::rgb8(0xff, 0xc1, 0x4f);

/// Map a model `Tone` to a fill color. Independent tiny palette rather than
/// importing pd-console's theme — this crate has no cross-crate dependency.
fn tone_color(tone: Tone) -> Color {
    match tone {
        Tone::Resting => Color::rgb8(0x5b, 0x66, 0x72),
        Tone::Gated => Color::rgb8(0xff, 0xc1, 0x4f),
        Tone::Engaged => Color::rgb8(0x5b, 0x9d, 0xff),
        Tone::Accent => Color::rgb8(0x4f, 0xd1, 0xc5),
        Tone::Landed => Color::rgb8(0x4f, 0xd1, 0x6b),
        Tone::Conflicted => Color::rgb8(0xff, 0x6b, 0x6b),
    }
}

/// Layout constants in logical pixels, mirroring pd-timeline-proto's
/// `Layoutspec` shape (same field names where the concept matches) so anyone
/// who has read that prototype recognizes this one immediately.
pub struct Layoutspec {
    pub width: f64,
    pub height: f64,
    pub left_gutter: f64,
    pub top_pad: f64,
    pub bottom_pad: f64,
    /// Height reserved for the timeline strip along the bottom.
    pub timeline_h: f64,
    pub scale: f64,
}

impl Layoutspec {
    fn graph_area(&self) -> (f64, f64) {
        (
            self.width - self.left_gutter - 24.0,
            self.height - self.top_pad - self.bottom_pad - self.timeline_h,
        )
    }
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

    fn draw_text(
        &mut self,
        scene: &mut Scene,
        text: &str,
        x: f64,
        y: f64,
        size: f32,
        color: Color,
        scale: f32,
    ) -> f64 {
        let mut builder = self
            .layout_cx
            .ranged_builder(&mut self.font_cx, text, scale);
        builder.push_default(StyleProperty::FontSize(size));
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
        layout.width() as f64
    }
}

impl Default for TextEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Push one Parley glyph run into the Vello scene. Verbatim port of
/// pd-timeline-proto's `render_glyph_run` — see that file's comment for why
/// the F2Dot14 reinterpret is sound (Parley's `&[i16]` normalized coords and
/// Vello/skrifa's `&[NormalizedCoord]` are layout-compatible reprs).
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

/// Build the full Vello scene for one frame.
///
/// `playhead_frac` is 0..=1 across `graph.time_span()`; the state active at
/// that instant (`graph.state_at`) gets a highlight ring.
pub fn build_scene(
    scene: &mut Scene,
    text: &mut TextEngine,
    graph: &StateGraph,
    spec: &Layoutspec,
    playhead_frac: f64,
) {
    scene.reset();
    let scale = spec.scale as f32;

    // 1. Background.
    scene.fill(
        Fill::NonZero,
        Affine::IDENTITY,
        BG,
        None,
        &kurbo::Rect::new(0.0, 0.0, spec.width, spec.height),
    );

    // 2. Title + source banner.
    text.draw_text(
        scene,
        "Dispatch Review State Machine",
        24.0,
        18.0,
        22.0,
        TEXT,
        scale,
    );
    text.draw_text(scene, &graph.source_note, 24.0, 52.0, 13.0, TEXT_DIM, scale);

    // 3. Compute node positions and fit the raw grid into the available area.
    let positions = layout(graph);
    let (avail_w, avail_h) = spec.graph_area();
    let (grid_w, grid_h) = grid_extent(&positions);
    let fit = fit_scale(grid_w, grid_h, avail_w, avail_h);
    let origin = Point::new(spec.left_gutter, spec.top_pad);

    let to_screen = |p: Point| Point::new(origin.x + p.x * fit, origin.y + p.y * fit);
    let node_rect_screen = |st: ReviewState| -> kurbo::Rect {
        let p = to_screen(positions[&st]);
        kurbo::Rect::new(p.x, p.y, p.x + NODE_W * fit, p.y + NODE_H * fit)
    };

    // 4. Edges first (under the nodes): cubic bezier + arrowhead between rect
    //    edges, reusing the causal-thread curve shape from pd-timeline-proto.
    //    Only the 8 primary-chain edges get a verb label — the 13 privileged
    //    "cancel"/"fail" escape edges fan out from every non-terminal state
    //    and labeling all of them turns the diagram into text soup. The
    //    escape edges still DRAW (the machine really does allow them), just
    //    unlabeled, same idea as pd-timeline-proto's marker-always/
    //    label-decluttered split.
    for &(from, to, verb) in &graph.edges {
        let a = node_rect_screen(from);
        let b = node_rect_screen(to);
        let (start, end) = connector_points(a, b);
        let path = causal_path(start, end);
        let is_escape = matches!(verb, "cancel" | "fail");
        let edge_color = if is_escape {
            EDGE.multiply_alpha(0.45)
        } else {
            EDGE
        };
        scene.stroke(&Stroke::new(1.5), Affine::IDENTITY, edge_color, None, &path);
        draw_arrowhead(scene, start, end, edge_color);
        if !is_escape && fit > 0.4 {
            let mid = Point::new((start.x + end.x) / 2.0, (start.y + end.y) / 2.0 - 4.0);
            text.draw_text(scene, verb, mid.x, mid.y, 10.0, TEXT_DIM, scale);
        }
    }

    // 5. Nodes: rounded rect, tone-colored, Parley label, active-state ring.
    let active = graph_active_at(graph, playhead_frac);
    for &st in &graph.nodes {
        let r = node_rect_screen(st);
        let rr = RoundedRect::from_rect(r, 8.0 * fit.max(0.3));
        let fill = if st == active {
            tone_color(st.tone())
        } else {
            NODE_FILL_DEFAULT
        };
        scene.fill(Fill::NonZero, Affine::IDENTITY, fill, None, &rr);
        let stroke_color = if st == active {
            ACTIVE_RING
        } else {
            NODE_STROKE
        };
        let stroke_w = if st == active { 3.0 } else { 1.0 };
        scene.stroke(
            &Stroke::new(stroke_w),
            Affine::IDENTITY,
            stroke_color,
            None,
            &rr,
        );

        let label_color = if st == active { BG } else { TEXT };
        let font_size = (13.0 * fit.max(0.4)).max(9.0) as f32;
        text.draw_text(
            scene,
            st.label(),
            r.x0 + 10.0,
            r.y0 + r.height() / 2.0 - font_size as f64 / 2.0,
            font_size,
            label_color,
            scale,
        );
    }

    // 6. Timeline strip along the bottom: ticks per event + playhead, ported
    //    from pd-timeline-proto's time-axis + playhead drawing.
    draw_timeline_strip(scene, text, graph, spec, playhead_frac, scale);
}

/// The state to highlight: `graph.state_at()` scrubbed by `playhead_frac`
/// over `graph.time_span()`.
fn graph_active_at(graph: &StateGraph, playhead_frac: f64) -> ReviewState {
    let (t_min, t_max) = graph.time_span();
    let cur_ms = t_min + ((t_max - t_min) as f64 * playhead_frac.clamp(0.0, 1.0)) as i64;
    graph.state_at(cur_ms)
}

/// The pixel extent `(width, height)` of the raw (unscaled) node grid: the
/// max of each rect's bottom-right corner over all positions.
fn grid_extent(positions: &std::collections::HashMap<ReviewState, Point>) -> (f64, f64) {
    let mut w = 0.0_f64;
    let mut h = 0.0_f64;
    for p in positions.values() {
        w = w.max(p.x + NODE_W);
        h = h.max(p.y + NODE_H);
    }
    (w.max(1.0), h.max(1.0))
}

/// Uniform scale factor that fits a `grid_w`x`grid_h` box into `avail_w`x
/// `avail_h`, never upscaling past 1.0 (a small graph should not be blown up
/// to fill the window — it should just sit at native size).
fn fit_scale(grid_w: f64, grid_h: f64, avail_w: f64, avail_h: f64) -> f64 {
    let sx = avail_w / grid_w;
    let sy = avail_h / grid_h;
    sx.min(sy).min(1.0).max(0.05)
}

/// Pick the two anchor points for an edge between rect `a` and rect `b`:
/// right-center of `a` to left-center of `b` when `b` is to the right/level,
/// else the nearer vertical edge — good enough for this mostly-left-to-right
/// DAG (matches the primary chain's flow direction).
fn connector_points(a: kurbo::Rect, b: kurbo::Rect) -> (Point, Point) {
    let a_c = a.center();
    let b_c = b.center();
    if b_c.x >= a_c.x {
        (Point::new(a.x1, a_c.y), Point::new(b.x0, b_c.y))
    } else {
        // A backward-pointing edge (shouldn't occur on the primary chain, but
        // the escape jumps to failed/salvage can originate from a node placed
        // after Failed's out-of-band column in pathological future layouts) —
        // connect top/bottom so the arrow never runs through unrelated nodes.
        (Point::new(a_c.x, a.y1), Point::new(b_c.x, b.y0))
    }
}

/// A smooth S-curve cubic bezier from `a` to `b` — verbatim shape from
/// pd-timeline-proto's `causal_path`.
fn causal_path(a: Point, b: Point) -> BezPath {
    let mut p = BezPath::new();
    p.move_to(a);
    let dx = (b.x - a.x).abs().max(24.0);
    let c1 = Point::new(a.x + dx * 0.5, a.y);
    let c2 = Point::new(b.x - dx * 0.5, b.y);
    p.curve_to(c1, c2, b);
    p
}

/// Small filled triangle pointing along the a→b direction, placed at b —
/// verbatim port of pd-timeline-proto's `draw_arrowhead`.
fn draw_arrowhead(scene: &mut Scene, a: Point, b: Point, color: Color) {
    let dir = (b - a).normalize();
    let perp = kurbo::Vec2::new(-dir.y, dir.x);
    let tip = b;
    let base = b - dir * 8.0;
    let left = base + perp * 4.0;
    let right = base - perp * 4.0;
    let mut head = BezPath::new();
    head.move_to(tip);
    head.line_to(left);
    head.line_to(right);
    head.close_path();
    scene.fill(Fill::NonZero, Affine::IDENTITY, color, None, &head);
}

/// The bottom timeline strip: one tick per observed transition event plus a
/// scrubbable playhead line + handle + time readout — ported from
/// pd-timeline-proto's time-axis-ticks + playhead-line/handle drawing.
fn draw_timeline_strip(
    scene: &mut Scene,
    text: &mut TextEngine,
    graph: &StateGraph,
    spec: &Layoutspec,
    playhead_frac: f64,
    scale: f32,
) {
    let strip_top = spec.height - spec.bottom_pad - spec.timeline_h;
    let strip_bottom = spec.height - spec.bottom_pad;
    let x0 = spec.left_gutter;
    let x1 = spec.width - 24.0;
    let (t_min, t_max) = graph.time_span();
    let span = (t_max - t_min).max(1) as f64;

    scene.stroke(
        &Stroke::new(1.0),
        Affine::IDENTITY,
        NODE_STROKE,
        None,
        &Line::new(Point::new(x0, strip_top), Point::new(x1, strip_top)),
    );

    // Ticks always draw; labels are decluttered with a 2-row stagger (same
    // idea as pd-timeline-proto's event-label declutter): a label only draws
    // once it clears the previously-labeled x on its stagger row, so two
    // close-together transitions (e.g. `claimed` at t=1.2s right after
    // `proposed` at t=0) never smear into each other.
    const LABEL_PAD: f64 = 10.0;
    let mut next_free_x: [f64; 2] = [f64::NEG_INFINITY; 2];
    let mut next_row = 0usize;
    for ev in &graph.timeline {
        let frac = (ev.t_ms - t_min) as f64 / span;
        let x = x0 + frac.clamp(0.0, 1.0) * (x1 - x0);
        scene.stroke(
            &Stroke::new(2.0),
            Affine::IDENTITY,
            tone_color(ev.to.tone()),
            None,
            &Line::new(Point::new(x, strip_top), Point::new(x, strip_top + 10.0)),
        );
        let lx = x + 3.0;
        for s in 0..2 {
            let row = (next_row + s) % 2;
            if lx >= next_free_x[row] {
                let ly = strip_top + 12.0 + (row as f64) * 13.0;
                let w = text.draw_text(scene, ev.to.wire_name(), lx, ly, 10.0, TEXT_DIM, scale);
                next_free_x[row] = lx + w + LABEL_PAD;
                next_row = (row + 1) % 2;
                break;
            }
        }
    }

    let px = x0 + playhead_frac.clamp(0.0, 1.0) * (x1 - x0);
    scene.stroke(
        &Stroke::new(2.0),
        Affine::IDENTITY,
        PLAYHEAD,
        None,
        &Line::new(
            Point::new(px, strip_top - 6.0),
            Point::new(px, strip_bottom),
        ),
    );
    let mut handle = BezPath::new();
    handle.move_to((px - 5.0, strip_top - 12.0));
    handle.line_to((px + 5.0, strip_top - 12.0));
    handle.line_to((px, strip_top - 4.0));
    handle.close_path();
    scene.fill(Fill::NonZero, Affine::IDENTITY, PLAYHEAD, None, &handle);

    let cur_ms = t_min + (span * playhead_frac.clamp(0.0, 1.0)) as i64;
    text.draw_text(
        scene,
        &format!(
            "t = +{:.1}s   active: {}",
            (cur_ms - t_min) as f64 / 1000.0,
            graph_active_at(graph, playhead_frac).wire_name()
        ),
        x0,
        strip_bottom + 16.0,
        13.0,
        PLAYHEAD,
        scale,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_scale_never_upscales() {
        assert_eq!(fit_scale(100.0, 100.0, 1000.0, 1000.0), 1.0);
    }

    #[test]
    fn fit_scale_shrinks_to_fit_the_tighter_dimension() {
        // Grid is wide (2000) relative to a 1000-wide area -> scale ~0.5.
        let s = fit_scale(2000.0, 100.0, 1000.0, 1000.0);
        assert!((s - 0.5).abs() < 1e-9);
    }

    #[test]
    fn fit_scale_has_a_floor() {
        let s = fit_scale(1_000_000.0, 1_000_000.0, 10.0, 10.0);
        assert!(s >= 0.05);
    }

    #[test]
    fn graph_active_at_matches_state_at() {
        let g = StateGraph::structural();
        assert_eq!(graph_active_at(&g, 0.0), ReviewState::Proposed);
    }
}
