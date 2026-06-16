//! Vello scene construction for the Voyage Timeline + Parley text pipeline.
//!
//! Everything here is *bespoke GPU vector rendering*: we hand-build paths
//! (lines, dots, blocks, smooth cubic-bezier causal threads) and feed Parley
//! glyph runs straight into the same Vello scene. No widget tree — full control
//! of every pixel, which is exactly the ceiling this prototype exists to prove.

use kurbo::{Affine, BezPath, Circle, Line, Point, Rect, Stroke};
use parley::{
    Alignment, FontContext, GlyphRun, Layout, LayoutContext, PositionedLayoutItem, StyleProperty,
};
use peniko::{Brush, Color, Fill};
use std::collections::HashMap;
use vello::Scene;

use crate::data::{Timeline, Track};

// --- Palette (dark, harbor-ish; not pulled from website tokens — this is a
//     standalone R&D window, so it carries its own minimal scheme). ---
const BG: Color = Color::rgb8(0x0d, 0x11, 0x17);
const TRACK_LINE: Color = Color::rgb8(0x2a, 0x32, 0x3c);
const AXIS: Color = Color::rgb8(0x3a, 0x44, 0x50);
const TEXT: Color = Color::rgb8(0xc8, 0xd2, 0xdc);
const TEXT_DIM: Color = Color::rgb8(0x7a, 0x86, 0x92);
const PLAYHEAD: Color = Color::rgb8(0xff, 0x6b, 0x35);
const THREAD: Color = Color::rgb8(0x4f, 0xd1, 0xc5);

// Per-track marker colors.
fn track_color(t: Track) -> Color {
    match t {
        Track::Dispatches => Color::rgb8(0x5b, 0x9d, 0xff), // blue
        Track::Sorties => Color::rgb8(0xb1, 0x7a, 0xff),    // violet
        Track::Agents => Color::rgb8(0x4f, 0xd1, 0x6b),     // green
        Track::Human => Color::rgb8(0xff, 0xc1, 0x4f),      // amber
    }
}

/// Layout constants in logical pixels.
pub struct Layoutspec {
    pub width: f64,
    pub height: f64,
    pub left_gutter: f64, // room for track labels
    pub top_pad: f64,     // room for title + time axis
    pub bottom_pad: f64,
    pub scale: f64, // hidpi scale factor
}

impl Layoutspec {
    fn track_band(&self) -> f64 {
        (self.height - self.top_pad - self.bottom_pad) / 4.0
    }

    /// Y center for a track row.
    fn track_y(&self, track: Track) -> f64 {
        self.top_pad + self.track_band() * (track.row() as f64 + 0.5)
    }

    /// Map an epoch-ms timestamp to an x coordinate.
    fn x_for(&self, t_ms: i64, t_min: i64, t_max: i64) -> f64 {
        let span = (t_max - t_min).max(1) as f64;
        let frac = (t_ms - t_min) as f64 / span;
        self.left_gutter + frac * (self.width - self.left_gutter - 24.0)
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

    /// Shape + lay out a single line, then paint its glyph runs into `scene`
    /// at (x, y) (y = baseline-ish top). Returns the laid-out width.
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
        let mut builder = self.layout_cx.ranged_builder(&mut self.font_cx, text, scale);
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

/// Push one Parley glyph run into the Vello scene.
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
    // Parley yields normalized coords as `&[i16]`; Vello/skrifa wants
    // `&[NormalizedCoord]` (a #[repr(transparent)] wrapper over the same i16
    // bits — F2Dot14). The two are layout-compatible, so we reinterpret.
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
/// `playhead_frac` is 0..=1 across the time span.
pub fn build_scene(
    scene: &mut Scene,
    text: &mut TextEngine,
    tl: &Timeline,
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
        &Rect::new(0.0, 0.0, spec.width, spec.height),
    );

    // 2. Title + data-source banner.
    text.draw_text(scene, "Voyage Timeline", 24.0, 18.0, 22.0, TEXT, scale);
    let banner_color = if tl.is_fixture { Color::rgb8(0xff, 0xc1, 0x4f) } else { THREAD };
    text.draw_text(scene, &tl.source_note, 24.0, 46.0, 13.0, banner_color, scale);

    // 3. Track lanes: a baseline + a label in the left gutter.
    for track in Track::ALL {
        let y = spec.track_y(track);
        scene.stroke(
            &Stroke::new(1.0),
            Affine::IDENTITY,
            TRACK_LINE,
            None,
            &Line::new(
                Point::new(spec.left_gutter, y),
                Point::new(spec.width - 24.0, y),
            ),
        );
        text.draw_text(
            scene,
            track.label(),
            16.0,
            y - 9.0,
            14.0,
            track_color(track),
            scale,
        );
    }

    // 4. Time axis ticks + labels along the top.
    let span_ms = (tl.t_max - tl.t_min).max(1);
    let n_ticks = 6;
    for i in 0..=n_ticks {
        let frac = i as f64 / n_ticks as f64;
        let t = tl.t_min + (span_ms as f64 * frac) as i64;
        let x = spec.x_for(t, tl.t_min, tl.t_max);
        scene.stroke(
            &Stroke::new(1.0),
            Affine::IDENTITY,
            AXIS,
            None,
            &Line::new(
                Point::new(x, spec.top_pad - 10.0),
                Point::new(x, spec.height - spec.bottom_pad + 6.0),
            ),
        );
        let rel_s = (t - tl.t_min) as f64 / 1000.0;
        text.draw_text(
            scene,
            &format!("+{rel_s:.0}s"),
            x + 3.0,
            spec.top_pad - 24.0,
            12.0,
            TEXT_DIM,
            scale,
        );
    }

    // 5. Causal threads FIRST (under the markers), as smooth cubic beziers.
    let pos: HashMap<&str, Point> = tl
        .events
        .iter()
        .map(|e| {
            (
                e.id.as_str(),
                Point::new(
                    spec.x_for(e.t_ms, tl.t_min, tl.t_max),
                    spec.track_y(e.track),
                ),
            )
        })
        .collect();

    for thread in &tl.threads {
        let (Some(&a), Some(&b)) = (
            pos.get(thread.cause_id.as_str()),
            pos.get(thread.effect_id.as_str()),
        ) else {
            continue;
        };
        let path = causal_path(a, b);
        scene.stroke(
            &Stroke::new(2.0),
            Affine::IDENTITY,
            THREAD,
            None,
            &path,
        );
        // Arrowhead at the effect end.
        draw_arrowhead(scene, a, b, THREAD);
        // Tiny note at the curve midpoint, naming the causal relation.
        let mid = Point::new((a.x + b.x) / 2.0, (a.y + b.y) / 2.0 - 6.0);
        text.draw_text(scene, thread.note, mid.x, mid.y, 11.0, THREAD, scale);
    }

    // 6. Event markers: a dot + a small block, with a clipped label.
    //    To stay legible when the live feed clusters many events (e.g. 32
    //    service.claim rows in a burst), we only draw a label when it clears
    //    the previously-labeled x on that track by a minimum gap. Markers
    //    always draw; labels are decluttered.
    let mut last_label_x: [f64; 4] = [f64::NEG_INFINITY; 4];
    const LABEL_GAP: f64 = 130.0;
    for ev in &tl.events {
        let x = spec.x_for(ev.t_ms, tl.t_min, tl.t_max);
        let y = spec.track_y(ev.track);
        let c = track_color(ev.track);
        // Block under the dot for visual weight.
        scene.fill(
            Fill::NonZero,
            Affine::IDENTITY,
            c.multiply_alpha(0.18),
            None,
            &Rect::new(x - 2.0, y - 10.0, x + 2.0, y + 10.0),
        );
        scene.fill(
            Fill::NonZero,
            Affine::IDENTITY,
            c,
            None,
            &Circle::new(Point::new(x, y), 5.0),
        );
        // Label above the marker (>= 12px logical), decluttered per track.
        let row = ev.track.row();
        if x - last_label_x[row] >= LABEL_GAP {
            text.draw_text(scene, &ev.label, x + 8.0, y - 20.0, 12.0, TEXT_DIM, scale);
            last_label_x[row] = x;
        }
    }

    // 7. Playhead: a bright vertical line + a time readout.
    let px = spec.left_gutter
        + playhead_frac.clamp(0.0, 1.0) * (spec.width - spec.left_gutter - 24.0);
    scene.stroke(
        &Stroke::new(2.0),
        Affine::IDENTITY,
        PLAYHEAD,
        None,
        &Line::new(
            Point::new(px, spec.top_pad - 12.0),
            Point::new(px, spec.height - spec.bottom_pad + 8.0),
        ),
    );
    // Playhead handle (triangle) at top.
    let mut handle = BezPath::new();
    handle.move_to((px - 6.0, spec.top_pad - 18.0));
    handle.line_to((px + 6.0, spec.top_pad - 18.0));
    handle.line_to((px, spec.top_pad - 8.0));
    handle.close_path();
    scene.fill(Fill::NonZero, Affine::IDENTITY, PLAYHEAD, None, &handle);

    let cur_s = (playhead_frac.clamp(0.0, 1.0)) * (span_ms as f64) / 1000.0;
    text.draw_text(
        scene,
        &format!("t = +{cur_s:.1}s   (left/right arrows or drag to scrub, space = play)"),
        24.0,
        spec.height - spec.bottom_pad + 16.0,
        13.0,
        PLAYHEAD,
        scale,
    );
}

/// A smooth S-curve cubic bezier from cause `a` to effect `b`.
fn causal_path(a: Point, b: Point) -> BezPath {
    let mut p = BezPath::new();
    p.move_to(a);
    let dx = (b.x - a.x).abs().max(40.0);
    // Control points pull horizontally for a flowing river feel.
    let c1 = Point::new(a.x + dx * 0.5, a.y);
    let c2 = Point::new(b.x - dx * 0.5, b.y);
    p.curve_to(c1, c2, b);
    p
}

/// Small filled triangle pointing along the a→b direction, placed at b.
fn draw_arrowhead(scene: &mut Scene, a: Point, b: Point, color: Color) {
    let dir = (b - a).normalize();
    let perp = kurbo::Vec2::new(-dir.y, dir.x);
    let tip = b;
    let base = b - dir * 10.0;
    let left = base + perp * 5.0;
    let right = base - perp * 5.0;
    let mut head = BezPath::new();
    head.move_to(tip);
    head.line_to(left);
    head.line_to(right);
    head.close_path();
    scene.fill(Fill::NonZero, Affine::IDENTITY, color, None, &head);
}
