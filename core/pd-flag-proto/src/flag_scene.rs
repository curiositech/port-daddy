//! Waving ICS signal-flag scene, hand-built as Vello vector geometry.
//!
//! A real cloth ripple (not a CSS transform — gpui has none): each flag is drawn
//! as N vertical strips. The hoist edge (u=0) is pinned to the staff; the fly
//! edge (u=1) sways most. Each strip is displaced vertically by
//!   d(u) = amp · u · sin(2π·waves·u − 2π·K·loop_pos + phaseᵢ)
//! and shaded by cos(of the same angle) so crests catch light and troughs fall
//! into shadow — the cue the eye reads as cloth. `loop_pos ∈ [0,1)` with the
//! temporal term an integer multiple K of 2π makes the GIF seamless.

use kurbo::{Affine, BezPath, Point};
use parley::{
    Alignment, FontContext, GlyphRun, Layout, LayoutContext, PositionedLayoutItem, StyleProperty,
};
use peniko::{Brush, Color, Fill};
use std::f64::consts::PI;
use vello::Scene;

/// One flag: its ICS letter, its lifecycle tone, and a label (for context).
pub struct FlagSpec {
    pub letter: char,
    pub color: Color,
    pub lifecycle: &'static str,
}

/// Lifecycle → tone, matching the semantic intent of pd-console's theme
/// (this standalone R&D crate carries its own palette, like pd-timeline-proto).
pub fn tone(lifecycle: &str) -> Color {
    match lifecycle {
        "sailing" => Color::rgb8(0x4f, 0xd1, 0x6b),  // engaged green
        "cooldown" => Color::rgb8(0xff, 0xc1, 0x4f), // gated amber
        "dry-dock" => Color::rgb8(0xe0, 0x5a, 0x4a), // conflicted red
        _ => Color::rgb8(0x8a, 0x97, 0xa6),          // resting slate
    }
}

const BG: Color = Color::rgb8(0x0d, 0x11, 0x17);
const STAFF: Color = Color::rgb8(0x3a, 0x44, 0x50);
const INK: Color = Color::rgb8(0x0d, 0x14, 0x1f); // dark letter, reads on every tone
const LABEL: Color = Color::rgb8(0xc8, 0xd2, 0xdc);

const STRIPS: usize = 28; // per-flag horizontal resolution of the ripple
const WAVES: f64 = 1.35; // wave crests across one flag's width
const CYCLES_PER_LOOP: f64 = 2.0; // integer K → seamless loop
const PHASE_STEP: f64 = 0.7; // radians of phase offset between adjacent flags

fn scale_color(c: Color, f: f64) -> Color {
    let f = f.clamp(0.0, 1.4);
    let r = (c.r as f64 * f).min(255.0) as u8;
    let g = (c.g as f64 * f).min(255.0) as u8;
    let b = (c.b as f64 * f).min(255.0) as u8;
    Color::rgb8(r, g, b)
}

/// The background fill color (passed to Vello's RenderParams.base_color).
pub fn background() -> Color {
    BG
}

/// Hand-built text via Parley → Vello (idiom mirrored from pd-timeline-proto).
pub struct TextEngine {
    font_cx: FontContext,
    layout_cx: LayoutContext<Brush>,
}

impl TextEngine {
    pub fn new() -> Self {
        Self { font_cx: FontContext::new(), layout_cx: LayoutContext::new() }
    }

    fn draw_centered(&mut self, scene: &mut Scene, text: &str, cx: f64, cy: f64, size: f32, color: Color) {
        let mut builder = self.layout_cx.ranged_builder(&mut self.font_cx, text, 1.0);
        builder.push_default(StyleProperty::FontSize(size));
        builder.push_default(StyleProperty::Brush(Brush::Solid(color)));
        let mut layout: Layout<Brush> = builder.build(text);
        layout.break_all_lines(None);
        layout.align(None, Alignment::Start);
        let w = layout.width() as f64;
        let h = layout.height() as f64;
        let transform = Affine::translate((cx - w / 2.0, cy - h / 2.0));
        for line in layout.lines() {
            for item in line.items() {
                if let PositionedLayoutItem::GlyphRun(glyph_run) = item {
                    render_glyph_run(scene, &glyph_run, transform);
                }
            }
        }
    }

    fn draw_left(&mut self, scene: &mut Scene, text: &str, x: f64, baseline: f64, size: f32, color: Color) {
        let mut builder = self.layout_cx.ranged_builder(&mut self.font_cx, text, 1.0);
        builder.push_default(StyleProperty::FontSize(size));
        builder.push_default(StyleProperty::Brush(Brush::Solid(color)));
        let mut layout: Layout<Brush> = builder.build(text);
        layout.break_all_lines(None);
        layout.align(None, Alignment::Start);
        let transform = Affine::translate((x, baseline));
        for line in layout.lines() {
            for item in line.items() {
                if let PositionedLayoutItem::GlyphRun(glyph_run) = item {
                    render_glyph_run(scene, &glyph_run, transform);
                }
            }
        }
    }
}

/// Build a horizontal row of waving flags for the given loop position (0..1).
pub fn build(scene: &mut Scene, te: &mut TextEngine, loop_pos: f64, flags: &[FlagSpec], width: u32, height: u32) {
    let w = width as f64;
    let h = height as f64;
    let n = flags.len().max(1) as f64;

    // Layout: each flag gets an equal horizontal cell; the flag itself fills the
    // upper portion, with the letter on it and a lifecycle label beneath.
    let cell_w = w / n;
    let flag_w = (cell_w * 0.62).min(220.0);
    let flag_h = flag_w * 0.66;
    let top_y = h * 0.30;
    let amp = flag_h * 0.42; // max sway at the fly edge

    for (i, spec) in flags.iter().enumerate() {
        let cx = cell_w * (i as f64 + 0.5);
        let hoist_x = cx - flag_w / 2.0;
        let phase_i = i as f64 * PHASE_STEP;

        // The staff (flagpole): a thin vertical bar at the hoist.
        let mut staff = BezPath::new();
        let sx = hoist_x - 6.0;
        staff.move_to(Point::new(sx, top_y - 14.0));
        staff.line_to(Point::new(sx + 3.0, top_y - 14.0));
        staff.line_to(Point::new(sx + 3.0, top_y + flag_h + 28.0));
        staff.line_to(Point::new(sx, top_y + flag_h + 28.0));
        staff.close_path();
        scene.fill(Fill::NonZero, Affine::IDENTITY, &Brush::Solid(STAFF), None, &staff);

        let angle = |u: f64| 2.0 * PI * WAVES * u - 2.0 * PI * CYCLES_PER_LOOP * loop_pos + phase_i;
        let disp = |u: f64| amp * u * angle(u).sin();

        // The cloth: N shaded vertical strips. Lighting from cos(angle) so the
        // ripple reads as folds; brightness also rises slightly toward the fly.
        for j in 0..STRIPS {
            let u0 = j as f64 / STRIPS as f64;
            let u1 = (j + 1) as f64 / STRIPS as f64;
            let x0 = hoist_x + u0 * flag_w;
            let x1 = hoist_x + u1 * flag_w;
            let d0 = disp(u0);
            let d1 = disp(u1);

            let mut strip = BezPath::new();
            strip.move_to(Point::new(x0, top_y + d0));
            strip.line_to(Point::new(x1, top_y + d1));
            strip.line_to(Point::new(x1, top_y + flag_h + d1));
            strip.line_to(Point::new(x0, top_y + flag_h + d0));
            strip.close_path();

            let um = 0.5 * (u0 + u1);
            let light = 0.80 + 0.34 * angle(um).cos() + 0.06 * um;
            scene.fill(Fill::NonZero, Affine::IDENTITY, &Brush::Solid(scale_color(spec.color, light)), None, &strip);
        }

        // The ICS letter, riding the cloth at the flag's middle column.
        let mid_d = disp(0.5);
        te.draw_centered(
            scene,
            &spec.letter.to_string(),
            cx,
            top_y + flag_h / 2.0 + mid_d,
            (flag_h * 0.62) as f32,
            INK,
        );

        // Lifecycle label beneath the staff.
        te.draw_left(
            scene,
            spec.lifecycle,
            hoist_x - 6.0,
            top_y + flag_h + 44.0,
            18.0,
            LABEL,
        );
    }
}

/// Push one Parley glyph run into the Vello scene (idiom from pd-timeline-proto).
fn render_glyph_run(scene: &mut Scene, glyph_run: &GlyphRun<Brush>, transform: Affine) {
    let mut x = glyph_run.offset();
    let y = glyph_run.baseline();
    let run = glyph_run.run();
    let font = run.font();
    let font_size = run.font_size();
    let synthesis = run.synthesis();
    let glyph_xform = synthesis.skew().map(|angle| Affine::skew(angle.to_radians().tan() as f64, 0.0));
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
                vello::Glyph { id: g.id as u32, x: gx, y: gy }
            }),
        );
}
