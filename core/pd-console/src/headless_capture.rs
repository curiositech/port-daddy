//! Headless offscreen capture — render the pd-console `Block` model to a real PNG
//! with **no window, no display, no Screen-Recording (TCC) permission, and no fork
//! of gpui**. Agent-safe by construction: it never touches the window server.
//!
//! ## Why this exists (the honest provenance)
//!
//! Capturing the *real* GPUI/Metal framebuffer of pd-console offscreen is **not
//! possible against our `gpui = 0.2.2` pin**. The Metal render target lives behind
//! a `CAMetalLayer` drawable that gpui presents internally, and the pieces you would
//! need to drive it offscreen are crate-private:
//!   * `platform::mac` is a **private** module (`mod mac;`), so `MetalRenderer` is
//!     not reachable from a dependent crate;
//!   * `InstanceBufferPool` (required by `MetalRenderer::new`) is `pub(crate)`;
//!   * the headless/test platform (`Application::headless()`, `TestAppContext`) uses
//!     a **stub renderer** that runs layout + paint but rasterizes nothing, and
//!     exposes no hook to read back the `Scene` or any pixels.
//!
//! metacraft-labs/isonim-gpui's "headless GPUI rendering" is exactly that stub path:
//! it drives `TestAppContext` through the real element pipeline and asserts on the
//! *element/layout tree* — it produces **no** image. That technique ports to 0.2.2
//! (see [`gpui_headless_pipeline`]) and is valuable as a no-display pipeline smoke,
//! but it cannot write a PNG.
//!
//! So this module renders the pane contract's render-agnostic [`Block`] primitives —
//! the *same* values the GPUI and ratatui faces paint — into an offscreen RGB
//! surface using the *real* locked OKLCH theme, and encodes a PNG with a tiny
//! built-in encoder (zero new dependencies). It is a faithful **third face** of the
//! one pane model, clearly watermarked so it is never mistaken for a Metal capture.
//! The concrete gpui delta that would unlock true GPU pixels is in
//! `docs/artifacts/gpui/HEADLESS-CAPTURE.md`.

#![allow(dead_code)]

use crate::pane::{Block, CodeBand, CodeLine, SyntaxKind, Tone};
use crate::theme::{Oklch, Theme, DARK};

// ─────────────────────────────────────────────────────────────────────────────
// Canvas — a plain RGB8 surface with clipped rectangle fills.
// ─────────────────────────────────────────────────────────────────────────────

pub struct Canvas {
    pub w: usize,
    pub h: usize,
    /// Row-major RGB8, length = w*h*3.
    px: Vec<u8>,
}

fn to_rgb(c: Oklch) -> (u8, u8, u8) {
    let p = c.to_srgb8();
    (
        ((p >> 16) & 0xff) as u8,
        ((p >> 8) & 0xff) as u8,
        (p & 0xff) as u8,
    )
}

impl Canvas {
    pub fn new(w: usize, h: usize, bg: (u8, u8, u8)) -> Self {
        let mut px = vec![0u8; w * h * 3];
        for i in 0..(w * h) {
            px[i * 3] = bg.0;
            px[i * 3 + 1] = bg.1;
            px[i * 3 + 2] = bg.2;
        }
        Self { w, h, px }
    }

    /// Read a pixel (clamped). Used by the tone→pixel regression tests.
    #[inline]
    pub fn pixel(&self, x: usize, y: usize) -> (u8, u8, u8) {
        let x = x.min(self.w.saturating_sub(1));
        let y = y.min(self.h.saturating_sub(1));
        let o = (y * self.w + x) * 3;
        (self.px[o], self.px[o + 1], self.px[o + 2])
    }

    #[inline]
    pub fn put(&mut self, x: usize, y: usize, c: (u8, u8, u8)) {
        if x >= self.w || y >= self.h {
            return;
        }
        let o = (y * self.w + x) * 3;
        self.px[o] = c.0;
        self.px[o + 1] = c.1;
        self.px[o + 2] = c.2;
    }

    /// Fill a rectangle, clipped to the canvas. `x`/`y` may be negative-ish only
    /// via saturating usize inputs from the caller (we clamp on the high side).
    pub fn fill_rect(&mut self, x: usize, y: usize, w: usize, h: usize, c: (u8, u8, u8)) {
        let x1 = (x + w).min(self.w);
        let y1 = (y + h).min(self.h);
        let mut yy = y;
        while yy < y1 {
            let mut xx = x;
            while xx < x1 {
                let o = (yy * self.w + xx) * 3;
                self.px[o] = c.0;
                self.px[o + 1] = c.1;
                self.px[o + 2] = c.2;
                xx += 1;
            }
            yy += 1;
        }
    }

    /// 1px-thick outline rectangle (for cell separators / focus rings).
    pub fn stroke_rect(&mut self, x: usize, y: usize, w: usize, h: usize, c: (u8, u8, u8)) {
        if w == 0 || h == 0 {
            return;
        }
        self.fill_rect(x, y, w, 1, c);
        self.fill_rect(x, y + h.saturating_sub(1), w, 1, c);
        self.fill_rect(x, y, 1, h, c);
        self.fill_rect(x + w.saturating_sub(1), y, 1, h, c);
    }

    // ── PNG encoding (zero-dependency): color type 2 (RGB8), stored DEFLATE. ──

    pub fn to_png(&self) -> Vec<u8> {
        // Raw scanlines with a 0 (None) filter byte prefix per row.
        let mut raw = Vec::with_capacity(self.h * (1 + self.w * 3));
        for y in 0..self.h {
            raw.push(0u8);
            let row = &self.px[y * self.w * 3..(y + 1) * self.w * 3];
            raw.extend_from_slice(row);
        }
        let idat = zlib_store(&raw);

        let mut out = Vec::new();
        out.extend_from_slice(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);

        // IHDR
        let mut ihdr = Vec::with_capacity(13);
        ihdr.extend_from_slice(&(self.w as u32).to_be_bytes());
        ihdr.extend_from_slice(&(self.h as u32).to_be_bytes());
        ihdr.push(8); // bit depth
        ihdr.push(2); // color type: truecolor RGB
        ihdr.push(0); // compression
        ihdr.push(0); // filter
        ihdr.push(0); // interlace
        png_chunk(&mut out, b"IHDR", &ihdr);
        png_chunk(&mut out, b"IDAT", &idat);
        png_chunk(&mut out, b"IEND", &[]);
        out
    }
}

fn png_chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let mut crc = Crc32::new();
    crc.update(kind);
    crc.update(data);
    out.extend_from_slice(&crc.finish().to_be_bytes());
}

/// Wrap `raw` in a zlib stream using only uncompressed ("stored") DEFLATE blocks.
/// Valid, universally decodable, and dependency-free — size is not a concern for
/// proof artifacts.
fn zlib_store(raw: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(raw.len() + raw.len() / 65535 * 5 + 16);
    out.push(0x78); // CMF: 32K window, deflate
    out.push(0x01); // FLG: no dict, fastest
    let mut i = 0;
    let n = raw.len();
    if n == 0 {
        out.push(0x01);
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0xffffu16.to_le_bytes());
    }
    while i < n {
        let len = (n - i).min(0xffff);
        let last = if i + len >= n { 1u8 } else { 0u8 };
        out.push(last); // BFINAL + BTYPE=00
        out.extend_from_slice(&(len as u16).to_le_bytes());
        out.extend_from_slice(&(!(len as u16)).to_le_bytes());
        out.extend_from_slice(&raw[i..i + len]);
        i += len;
    }
    out.extend_from_slice(&adler32(raw).to_be_bytes());
    out
}

fn adler32(data: &[u8]) -> u32 {
    const MOD: u32 = 65521;
    let (mut a, mut b) = (1u32, 0u32);
    for &byte in data {
        a = (a + byte as u32) % MOD;
        b = (b + a) % MOD;
    }
    (b << 16) | a
}

struct Crc32 {
    crc: u32,
}
impl Crc32 {
    fn new() -> Self {
        Self { crc: 0xffff_ffff }
    }
    fn update(&mut self, data: &[u8]) {
        for &b in data {
            let mut c = (self.crc ^ b as u32) & 0xff;
            for _ in 0..8 {
                c = if c & 1 != 0 {
                    0xedb8_8320 ^ (c >> 1)
                } else {
                    c >> 1
                };
            }
            self.crc = c ^ (self.crc >> 8);
        }
    }
    fn finish(self) -> u32 {
        self.crc ^ 0xffff_ffff
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Block → geometry layout (text is added in the font layer below).
// ─────────────────────────────────────────────────────────────────────────────

const PAD: usize = 24;
const ROW_H: usize = 34;
const HEADER_H: usize = 44;

fn tone_rgb(tone: Tone, t: &Theme) -> (u8, u8, u8) {
    to_rgb(tone.color(t))
}

fn syntax_rgb(kind: SyntaxKind, t: &Theme) -> (u8, u8, u8) {
    match kind {
        SyntaxKind::Plain => to_rgb(t.ink2),
        SyntaxKind::Keyword => to_rgb(t.accent),
        SyntaxKind::Type => to_rgb(t.engaged),
        SyntaxKind::Str => to_rgb(t.landed),
        SyntaxKind::Comment => to_rgb(t.muted),
        SyntaxKind::Number => to_rgb(t.gated),
    }
}

/// Estimate a chip/flag/button width from its label (text is drawn in the font
/// layer; geometry is sized for it either way).
fn label_w(label: &str, scale: usize) -> usize {
    (label.chars().count().max(1) * GLYPH_ADV * scale) + 16
}

/// Render a `Block` list to an offscreen [`Canvas`] using the real locked theme.
/// Pure geometry + color here; text is overlaid by [`draw_text`]. This is the same
/// primitive language the GPUI and ratatui faces consume — a faithful third face.
pub fn render_blocks(blocks: &[Block], t: &Theme, width: usize) -> Canvas {
    let bg = to_rgb(t.bg);
    let panel = to_rgb(t.panel);
    let raised = to_rgb(t.raised);
    let ink = to_rgb(t.ink);
    let ink2 = to_rgb(t.ink2);
    let muted = to_rgb(t.muted);
    let accent = to_rgb(t.accent);

    // First pass: compute height from the running layout so we never clip.
    let inner = width.saturating_sub(PAD * 2);
    let mut h = HEADER_H + PAD;
    for b in blocks {
        h += match b {
            Block::Gap => ROW_H / 2,
            Block::Header(_) => ROW_H + 8,
            Block::Spark(_) => ROW_H + 20,
            Block::WrappedText { .. } | Block::ChatTurn { .. } => ROW_H + 18,
            Block::NodeRow { .. } => ROW_H + 8,
            Block::CodeBuffer { lines, .. } => {
                let visible = lines.len().min(500);
                (visible * ROW_H) + if lines.len() > visible { ROW_H } else { 0 }
            }
            _ => ROW_H,
        };
    }
    h += FOOTER_H + PAD;

    let mut c = Canvas::new(width, h, bg);

    // ── Title bar: raised band + amber accent underline (the header chrome). ──
    c.fill_rect(0, 0, width, HEADER_H, raised);
    c.fill_rect(0, HEADER_H, width, 2, accent);
    draw_text(&mut c, PAD, 14, 2, "PD-CONSOLE / HEADLESS CAPTURE", ink);

    let mut y = HEADER_H + PAD;
    let x0 = PAD;
    for b in blocks {
        match b {
            Block::Gap => {
                y += ROW_H / 2;
            }
            Block::Header(s) => {
                c.fill_rect(x0, y, inner, ROW_H, panel);
                c.fill_rect(x0, y, 5, ROW_H, accent); // accent tick
                draw_text(&mut c, x0 + 14, y + 8, 2, s, ink);
                y += ROW_H + 8;
            }
            Block::KeyVal(k, v) => {
                c.fill_rect(x0, y, inner, ROW_H, panel);
                draw_text(&mut c, x0 + 10, y + 9, 2, k, muted);
                draw_text(&mut c, x0 + inner / 2, y + 9, 2, v, ink);
                y += ROW_H;
            }
            Block::Row(cells) => {
                c.fill_rect(x0, y, inner, ROW_H, panel);
                let n = cells.len().max(1);
                let cw = inner / n;
                for (i, cell) in cells.iter().enumerate() {
                    let cx = x0 + i * cw;
                    if i > 0 {
                        c.fill_rect(cx, y + 4, 1, ROW_H - 8, muted); // separator
                    }
                    // First column is the accent/label column in the GPUI + TUI
                    // renderers; keep it brighter here so emphasis reads the same.
                    let col = if i == 0 { ink } else { ink2 };
                    draw_text(&mut c, cx + 8, y + 9, 2, cell, col);
                }
                y += ROW_H;
            }
            Block::CodeBuffer {
                lines,
                gutter_cols,
                bands,
                ..
            } => {
                let visible = lines.len().min(500);
                let gutter_w = (*gutter_cols as usize * GLYPH_ADV).max(GLYPH_ADV) + 14;
                let author_w = GLYPH_ADV * 2 + 12;
                for line in lines.iter().take(visible) {
                    let band = bands.iter().rev().find(|b| b.covers(line.number));
                    let row_bg = band
                        .map(|b| tone_rgb(b.tone, t))
                        .map(|(r, g, b)| (r / 5, g / 5, b / 5))
                        .unwrap_or(panel);
                    c.fill_rect(x0, y, inner, ROW_H, row_bg);
                    c.fill_rect(
                        x0,
                        y,
                        4,
                        ROW_H,
                        band.map(|b| tone_rgb(b.tone, t)).unwrap_or(muted),
                    );
                    let num = format!("{:>width$}", line.number, width = *gutter_cols as usize);
                    draw_text(&mut c, x0 + 10, y + 10, 1, &num, muted);
                    if let Some(tag) = &line.author_tag {
                        draw_text(
                            &mut c,
                            x0 + gutter_w,
                            y + 10,
                            1,
                            tag,
                            tone_rgb(line.author_tone, t),
                        );
                    }

                    let mut at = 0usize;
                    let mut tx = x0 + gutter_w + author_w;
                    for (len, kind) in &line.runs {
                        let end = (at + *len as usize).min(line.text.len());
                        if at < end {
                            let segment = &line.text[at..end];
                            draw_text(&mut c, tx, y + 10, 1, segment, syntax_rgb(*kind, t));
                            tx += segment.chars().count() * GLYPH_ADV;
                        }
                        at = end;
                    }
                    if at < line.text.len() {
                        let rest = &line.text[at..];
                        draw_text(&mut c, tx, y + 10, 1, rest, ink2);
                    }
                    y += ROW_H;
                }
                if lines.len() > visible {
                    c.fill_rect(x0, y, inner, ROW_H, panel);
                    draw_text(
                        &mut c,
                        x0 + 10,
                        y + 10,
                        1,
                        &format!("... {} more code lines", lines.len() - visible),
                        muted,
                    );
                    y += ROW_H;
                }
            }
            Block::Chip { label, tone } => {
                let col = tone_rgb(*tone, t);
                let w = label_w(label, 2).min(inner);
                c.fill_rect(x0, y + 4, w, ROW_H - 10, col);
                draw_text(&mut c, x0 + 8, y + 9, 2, label, bg);
                y += ROW_H;
            }
            Block::Flag {
                letter,
                label,
                tone,
            } => {
                let col = tone_rgb(*tone, t);
                let sq = ROW_H - 8;
                c.fill_rect(x0, y + 2, sq, sq, col); // the ICS flag square
                c.stroke_rect(x0, y + 2, sq, sq, ink);
                let mut letter_buf = [0u8; 4];
                draw_text(
                    &mut c,
                    x0 + sq / 2 - 4,
                    y + 9,
                    2,
                    letter.encode_utf8(&mut letter_buf),
                    bg,
                );
                draw_text(&mut c, x0 + sq + 12, y + 9, 2, label, ink2);
                y += ROW_H;
            }
            Block::NodeRow {
                selected,
                live,
                flag,
                name,
                badge,
                badge_tone,
                meta,
                age,
                tone,
                ..
            } => {
                let band = if *selected { raised } else { panel };
                c.fill_rect(x0, y, inner, ROW_H + 4, band);
                if *selected {
                    c.stroke_rect(x0, y, inner, ROW_H + 4, accent);
                }
                // flag square in node tone
                let sq = ROW_H - 12;
                c.fill_rect(x0 + 8, y + 6, sq, sq, tone_rgb(*tone, t));
                c.stroke_rect(x0 + 8, y + 6, sq, sq, ink);
                let mut fb = [0u8; 4];
                draw_text(
                    &mut c,
                    x0 + 8 + sq / 2 - 4,
                    y + 10,
                    2,
                    flag.encode_utf8(&mut fb),
                    bg,
                );
                // liveness dot
                let dot = if *live {
                    to_rgb(t.engaged)
                } else {
                    to_rgb(t.resting)
                };
                c.fill_rect(x0 + 8 + sq + 8, y + 6 + sq / 2 - 3, 7, 7, dot);
                draw_text(&mut c, x0 + 8 + sq + 22, y + 8, 2, name, ink);
                draw_text(&mut c, x0 + 8 + sq + 22, y + 22, 1, meta, muted);
                // badge chip on the right
                let bw = label_w(badge, 1);
                c.fill_rect(
                    x0 + inner - bw - 70,
                    y + 8,
                    bw,
                    16,
                    tone_rgb(*badge_tone, t),
                );
                draw_text(&mut c, x0 + inner - bw - 66, y + 10, 1, badge, bg);
                draw_text(&mut c, x0 + inner - 56, y + 12, 1, age, muted);
                y += ROW_H + 8;
            }
            Block::Spark(vals) => {
                c.fill_rect(x0, y, inner, ROW_H + 16, panel);
                let n = vals.len().max(1);
                let bw = (inner - 16) / n;
                let maxv = vals.iter().cloned().fold(0.0f32, f32::max).max(1e-6);
                let base = y + ROW_H + 12;
                for (i, v) in vals.iter().enumerate() {
                    let bh = ((v / maxv) * (ROW_H as f32 + 4.0)) as usize;
                    let bx = x0 + 8 + i * bw;
                    c.fill_rect(
                        bx,
                        base.saturating_sub(bh),
                        bw.saturating_sub(2).max(1),
                        bh.max(1),
                        accent,
                    );
                }
                y += ROW_H + 20;
            }
            Block::ControlButton {
                verb: _,
                label,
                enabled,
                primary,
                ..
            } => {
                let col = if *primary && *enabled {
                    accent
                } else if *enabled {
                    raised
                } else {
                    to_rgb(t.resting)
                };
                let w = label_w(label, 2).min(inner);
                c.fill_rect(x0, y + 4, w, ROW_H - 10, col);
                c.stroke_rect(x0, y + 4, w, ROW_H - 10, if *enabled { ink } else { muted });
                let txt = if *enabled { bg } else { muted };
                draw_text(&mut c, x0 + 10, y + 9, 2, label, txt);
                y += ROW_H;
            }
            Block::ChatTurn {
                speaker,
                text,
                tone,
            } => {
                c.fill_rect(x0, y, inner, ROW_H + 14, panel);
                c.fill_rect(x0, y, 4, ROW_H + 14, tone_rgb(*tone, t));
                draw_text(&mut c, x0 + 12, y + 8, 2, speaker, tone_rgb(*tone, t));
                draw_text(&mut c, x0 + 12, y + 24, 1, text, ink2);
                y += ROW_H + 18;
            }
            Block::WrappedText { text, tone } => {
                c.fill_rect(x0, y, inner, ROW_H + 14, panel);
                c.fill_rect(x0, y, 4, ROW_H + 14, tone_rgb(*tone, t));
                draw_text(&mut c, x0 + 12, y + 10, 1, text, ink2);
                y += ROW_H + 18;
            }
            Block::TranscriptLine { text, tone } => {
                c.fill_rect(x0, y, inner, ROW_H, panel);
                c.fill_rect(x0, y + ROW_H / 2 - 3, 6, 6, tone_rgb(*tone, t));
                draw_text(&mut c, x0 + 14, y + 9, 1, text, ink2);
                y += ROW_H;
            }
            Block::ArtifactRef {
                label, path, tone, ..
            }
            | Block::ImageArtifact {
                label, path, tone, ..
            } => {
                c.fill_rect(x0, y, inner, ROW_H, panel);
                c.fill_rect(x0, y + 4, ROW_H - 8, ROW_H - 8, to_rgb(t.landed)); // thumb
                                                                                // Tone colors the marker border (matching the console/TUI renderers),
                                                                                // so the artifact's semantic state is not lost in the raster.
                c.stroke_rect(x0, y + 4, ROW_H - 8, ROW_H - 8, tone_rgb(*tone, t));
                draw_text(&mut c, x0 + ROW_H + 4, y + 6, 2, label, ink);
                draw_text(&mut c, x0 + ROW_H + 4, y + 20, 1, path, muted);
                y += ROW_H;
            }
        }
    }

    // ── Provenance watermark: a distinct band + explicit text. This raster is the
    //    Block model, NOT the GPUI/Metal framebuffer — encode that in the pixels. ──
    let fy = h - FOOTER_H;
    c.fill_rect(0, fy, width, FOOTER_H, to_rgb(t.gated));
    draw_text(
        &mut c,
        PAD,
        fy + FOOTER_H / 2 - 4,
        1,
        "BLOCK-MODEL RASTER (agent-safe, offscreen) - NOT a GPUI/Metal capture - see HEADLESS-CAPTURE.md",
        to_rgb(t.bg),
    );
    c
}

// ─────────────────────────────────────────────────────────────────────────────
// A compact 5×7 bitmap font. Each glyph is 7 rows of 5 bits (MSB = leftmost
// column); the pattern in the source literal *is* the letter shape. Lowercase
// maps to uppercase (small-caps) — legible for a proof raster; noted honestly.
// ─────────────────────────────────────────────────────────────────────────────

const GLYPH_W: usize = 5;
const GLYPH_ADV: usize = 6; // 5 columns + 1 space
const FOOTER_H: usize = 22;

fn glyph(ch: char) -> [u8; 7] {
    let up = ch.to_ascii_uppercase();
    match up {
        ' ' => [0, 0, 0, 0, 0, 0, 0],
        'A' => [
            0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ],
        'B' => [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110,
        ],
        'C' => [
            0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110,
        ],
        'D' => [
            0b11100, 0b10010, 0b10001, 0b10001, 0b10001, 0b10010, 0b11100,
        ],
        'E' => [
            0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111,
        ],
        'F' => [
            0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000,
        ],
        'G' => [
            0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111,
        ],
        'H' => [
            0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ],
        'I' => [
            0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111,
        ],
        'J' => [
            0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100,
        ],
        'K' => [
            0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001,
        ],
        'L' => [
            0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111,
        ],
        'M' => [
            0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001,
        ],
        'N' => [
            0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001,
        ],
        'O' => [
            0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
        ],
        'P' => [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000,
        ],
        'Q' => [
            0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101,
        ],
        'R' => [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001,
        ],
        'S' => [
            0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110,
        ],
        'T' => [
            0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100,
        ],
        'U' => [
            0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
        ],
        'V' => [
            0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100,
        ],
        'W' => [
            0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001,
        ],
        'X' => [
            0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001,
        ],
        'Y' => [
            0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100,
        ],
        'Z' => [
            0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111,
        ],
        '0' => [
            0b01110, 0b10011, 0b10101, 0b10101, 0b11001, 0b10001, 0b01110,
        ],
        '1' => [
            0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110,
        ],
        '2' => [
            0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111,
        ],
        '3' => [
            0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110,
        ],
        '4' => [
            0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010,
        ],
        '5' => [
            0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110,
        ],
        '6' => [
            0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110,
        ],
        '7' => [
            0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000,
        ],
        '8' => [
            0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110,
        ],
        '9' => [
            0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100,
        ],
        '.' => [0, 0, 0, 0, 0, 0b00110, 0b00110],
        ',' => [0, 0, 0, 0, 0b00110, 0b00100, 0b01000],
        '-' => [0, 0, 0, 0b11111, 0, 0, 0],
        '_' => [0, 0, 0, 0, 0, 0, 0b11111],
        ':' => [0, 0b00110, 0b00110, 0, 0b00110, 0b00110, 0],
        ';' => [0, 0b00110, 0b00110, 0, 0b00110, 0b00100, 0b01000],
        '/' => [
            0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000,
        ],
        '\\' => [
            0b10000, 0b01000, 0b01000, 0b00100, 0b00010, 0b00010, 0b00001,
        ],
        '[' => [
            0b01110, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b01110,
        ],
        ']' => [
            0b01110, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b01110,
        ],
        '(' => [
            0b00110, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b00110,
        ],
        ')' => [
            0b01100, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b01100,
        ],
        '#' => [
            0b01010, 0b11111, 0b01010, 0b01010, 0b11111, 0b01010, 0b00000,
        ],
        '>' => [
            0b10000, 0b01000, 0b00100, 0b00010, 0b00100, 0b01000, 0b10000,
        ],
        '<' => [
            0b00001, 0b00010, 0b00100, 0b01000, 0b00100, 0b00010, 0b00001,
        ],
        '!' => [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0, 0b00100],
        '?' => [0b01110, 0b10001, 0b00001, 0b00110, 0b00100, 0, 0b00100],
        '+' => [0, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0],
        '=' => [0, 0, 0b11111, 0, 0b11111, 0, 0],
        '*' => [0, 0b10101, 0b01110, 0b11111, 0b01110, 0b10101, 0],
        '\'' => [0b00100, 0b00100, 0b01000, 0, 0, 0, 0],
        '|' => [
            0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100,
        ],
        '@' => [
            0b01110, 0b10001, 0b10111, 0b10101, 0b10111, 0b10000, 0b01110,
        ],
        '·' | '•' => [0, 0, 0b01110, 0b01110, 0b01110, 0, 0],
        '%' => [0b11001, 0b11010, 0b00100, 0b01000, 0b01011, 0b10011, 0],
        _ => [
            0b11111, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11111,
        ], // unknown → box
    }
}

/// Draw a string at `(x, y)` in `scale`×-magnified 5×7 cells. Blocky but legible
/// at scale ≥ 2 (respects the no-tiny-fonts rule: scale 2 → 14px cap height).
pub fn draw_text(c: &mut Canvas, x: usize, y: usize, scale: usize, text: &str, col: (u8, u8, u8)) {
    let s = scale.max(1);
    let mut cx = x;
    for ch in text.chars() {
        if ch == '\n' {
            break;
        }
        let g = glyph(ch);
        for (row, bits) in g.iter().enumerate() {
            for bitcol in 0..GLYPH_W {
                if (bits >> (GLYPH_W - 1 - bitcol)) & 1 == 1 {
                    c.fill_rect(cx + bitcol * s, y + row * s, s, s, col);
                }
            }
        }
        cx += GLYPH_ADV * s;
        if cx >= c.w {
            break;
        }
    }
}

/// A representative, offline, deterministic `Block` tree that exercises every
/// variant with real semantic [`Tone`]s. Used by the runtime hook and tests so
/// the offscreen raster is provable with no daemon and no network.
pub fn sample_console_blocks() -> Vec<Block> {
    vec![
        Block::Header("FLEET / HARBOR ROSTER".into()),
        Block::KeyVal("daemon".into(), "up :9886 (3.24.1)".into()),
        Block::KeyVal("armed calls/hr".into(), "12".into()),
        Block::Row(vec![
            "MODEL".into(),
            "TIER".into(),
            "STATE".into(),
            "AGE".into(),
        ]),
        Block::NodeRow {
            index: 0,
            selected: true,
            live: true,
            flag: 'E',
            name: "harbor:headless-capture".into(),
            badge: "controllable".into(),
            badge_tone: Tone::Landed,
            meta: "opus-4.8 · bounded-hard · rendering".into(),
            age: "2m".into(),
            tone: Tone::Engaged,
        },
        Block::NodeRow {
            index: 1,
            selected: false,
            live: false,
            flag: 'R',
            name: "economist:pricing".into(),
            badge: "stale".into(),
            badge_tone: Tone::Gated,
            meta: "sonnet · routine · idle".into(),
            age: "85d".into(),
            tone: Tone::Resting,
        },
        Block::Gap,
        Block::Row(vec![
            "engaged".into(),
            "gated".into(),
            "landed".into(),
            "alarm".into(),
        ]),
        Block::Flag {
            letter: 'A',
            label: "underway".into(),
            tone: Tone::Engaged,
        },
        Block::Chip {
            label: "claimed".into(),
            tone: Tone::Accent,
        },
        Block::Chip {
            label: "conflict".into(),
            tone: Tone::Conflicted,
        },
        Block::Chip {
            label: "CRITICAL".into(),
            tone: Tone::Alarm,
        },
        Block::Spark(vec![3.0, 5.0, 2.0, 8.0, 6.0, 9.0, 4.0, 7.0, 10.0, 5.0]),
        Block::ChatTurn {
            speaker: "harbor".into(),
            text: "rendered the Block model offscreen to a real PNG.".into(),
            tone: Tone::Engaged,
        },
        Block::TranscriptLine {
            text: "wrote docs/artifacts/gpui/headless-capture-sample.png".into(),
            tone: Tone::Landed,
        },
        Block::WrappedText {
            text: "gpui 0.2.2 exposes no offscreen Metal readback - see HEADLESS-CAPTURE.md".into(),
            tone: Tone::Gated,
        },
        Block::CodeBuffer {
            lines: std::sync::Arc::from([
                CodeLine {
                    number: 41,
                    author_tag: Some("op".into()),
                    author_tone: Tone::Resting,
                    text: "pub fn render_code_line(line: &CodeLine) {".into(),
                    runs: vec![
                        (3, SyntaxKind::Keyword),
                        (1, SyntaxKind::Plain),
                        (2, SyntaxKind::Keyword),
                        (1, SyntaxKind::Plain),
                        (16, SyntaxKind::Plain),
                        (8, SyntaxKind::Plain),
                        (8, SyntaxKind::Type),
                        (3, SyntaxKind::Plain),
                    ],
                },
                CodeLine {
                    number: 42,
                    author_tag: Some("a7".into()),
                    author_tone: Tone::Engaged,
                    text: "    let visible = viewport.lines();".into(),
                    runs: vec![
                        (7, SyntaxKind::Plain),
                        (3, SyntaxKind::Keyword),
                        (25, SyntaxKind::Plain),
                    ],
                },
                CodeLine {
                    number: 43,
                    author_tag: Some("a7".into()),
                    author_tone: Tone::Engaged,
                    text: "    draw_runs(visible, line.runs());".into(),
                    runs: vec![(36, SyntaxKind::Plain)],
                },
                CodeLine {
                    number: 44,
                    author_tag: Some("op".into()),
                    author_tone: Tone::Resting,
                    text: "}".into(),
                    runs: vec![(1, SyntaxKind::Plain)],
                },
            ]),
            gutter_cols: 2,
            bands: vec![
                CodeBand {
                    start: 42,
                    end: 43,
                    tone: Tone::Accent,
                },
                CodeBand {
                    start: 43,
                    end: 43,
                    tone: Tone::Conflicted,
                },
            ],
            show_authors: true,
        },
        Block::ArtifactRef {
            label: "manifest".into(),
            path: "docs/artifacts/gpui/HEADLESS-CAPTURE.md".into(),
            preview: None,
            tone: Tone::Landed,
        },
        Block::ControlButton {
            verb: "open".into(),
            label: "OPEN EDITOR".into(),
            enabled: true,
            why_disabled: None,
            primary: true,
        },
        Block::ControlButton {
            verb: "interrupt".into(),
            label: "INTERRUPT".into(),
            enabled: false,
            why_disabled: Some("no live lane".into()),
            primary: false,
        },
    ]
}

/// Deterministic proof of the mission-first default surface. The state flag lets
/// CI and PR evidence show the same mission moving from admission to live work
/// to a reviewable pull request without requiring Screen Recording permission.
pub fn sample_mission_blocks(state: &str) -> Vec<Block> {
    let (stage, stage_tone) = match state {
        "settled" => ("PR ready", Tone::Landed),
        "failed" => ("Needs attention", Tone::Gated),
        "starting" => ("Starting", Tone::Engaged),
        _ => ("Working", Tone::Accent),
    };
    let mut blocks = vec![
        Block::Header("Repair the mission console and open its pull request".into()),
        Block::Chip {
            label: stage.into(),
            tone: stage_tone,
        },
        Block::KeyVal("agent".into(), "spawned-codex-7".into()),
        Block::KeyVal("runtime".into(), "cli:codex · receipt-model-v1".into()),
        Block::KeyVal("branch".into(), "codex/mission-console".into()),
    ];
    if state == "failed" {
        blocks.push(Block::WrappedText {
            text: "The selected runtime could not start. Retry or choose another agent.".into(),
            tone: Tone::Gated,
        });
    }
    blocks.extend([
        Block::Gap,
        Block::Header("Live work".into()),
        Block::ChatTurn {
            speaker: "agent".into(),
            text: "Replaced the global planner dump with one durable mission receipt.".into(),
            tone: Tone::Engaged,
        },
        Block::TranscriptLine {
            text: "running pd-console mission view tests".into(),
            tone: Tone::Accent,
        },
        Block::TranscriptLine {
            text: "4 passed; exact agent and branch remain attached".into(),
            tone: Tone::Landed,
        },
    ]);
    if state == "settled" {
        blocks.extend([
            Block::Gap,
            Block::Header("Delivery".into()),
            Block::ArtifactRef {
                label: "Open pull request".into(),
                path: "https://github.com/curiositech/port-daddy/pull/0000".into(),
                preview: Some("code, checks, review, and merge status".into()),
                tone: Tone::Landed,
            },
            Block::Chip {
                label: "all checks passed".into(),
                tone: Tone::Landed,
            },
        ]);
    }
    blocks
}

/// Runtime entrypoint behind `--headless-capture <path>`: render the sample
/// console Block model to a PNG at `path`. Returns bytes written. No window, no
/// display, no Screen-Recording permission — safe from any shell, incl. an agent's.
pub fn capture_state_to_path(path: &str, state: &str) -> std::io::Result<usize> {
    let png = render_blocks(&sample_mission_blocks(state), &DARK, 960).to_png();
    let p = std::path::Path::new(path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    std::fs::write(p, &png)?;
    Ok(png.len())
}

pub fn capture_to_path(path: &str) -> std::io::Result<usize> {
    capture_state_to_path(path, "in_progress")
}

// ─────────────────────────────────────────────────────────────────────────────
// isonim-gpui technique, ported to our gpui 0.2.2 pin.
//
// metacraft-labs/isonim-gpui runs its UI through GPUI's real element pipeline
// *headlessly* via `TestAppContext` — no window, no display — and asserts on the
// resulting element/layout tree. It produces **no pixels** (gpui's test/headless
// platform uses a stub renderer). This is the faithful port: a `#[gpui::test]`
// that mounts a view and drives layout+paint with no display. It only compiles
// under `--features gpui` (the macOS CI job), and complements the Block raster
// above — it proves the pipeline runs; the raster proves pixels.
// ─────────────────────────────────────────────────────────────────────────────
// NOTE: `cargo test --features gpui` currently aborts crate-wide with a SIGBUS
// inside the `libgpui_macros` proc-macro (derive expansion across the existing
// panes) — a PRE-EXISTING toolchain crash, proven independent of this module
// (disabling this module does not fix it) and off any CI path (the macOS gate runs
// `cargo build --features gpui`, which is green). This test is therefore a faithful,
// API-verified embodiment of isonim's technique that will execute once that crate-
// wide crash is resolved. See docs/artifacts/gpui/HEADLESS-CAPTURE.md.
#[cfg(all(test, feature = "gpui"))]
mod gpui_headless {
    use gpui::{div, IntoElement, ParentElement, Render, Styled, TestAppContext};

    struct Probe;
    impl Render for Probe {
        fn render(
            &mut self,
            _win: &mut gpui::Window,
            _cx: &mut gpui::Context<Self>,
        ) -> impl IntoElement {
            div().w_full().h_full().child("headless")
        }
    }

    /// isonim-gpui's mechanism, ported to a plain `#[test]`: this crate has no
    /// `#[gpui::test]` precedent, so we build the `TestAppContext` by hand
    /// (`::single()`) to stay on the established "plain `#[test]` under
    /// `cfg(gpui)`" pattern. A view is mounted in a headless context and driven
    /// through GPUI's real element pipeline with **no display**; no pixels are read
    /// back — the test platform's renderer is a stub. Proves the pipeline runs.
    #[test]
    fn element_pipeline_runs_with_no_display() {
        let mut cx = TestAppContext::single();
        let window = cx.add_window(|_win, _cx| Probe);
        let ok = window
            .update(&mut cx, |_view, _win, _cx| true)
            .unwrap_or(false);
        assert!(ok, "headless element pipeline did not run");
    }
}

#[cfg(test)]
mod geom_tests {
    use super::*;

    #[test]
    fn png_roundtrips_a_valid_signature_and_ihdr() {
        let c = Canvas::new(8, 4, to_rgb(DARK.bg));
        let png = c.to_png();
        assert_eq!(
            &png[0..8],
            &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]
        );
        // IHDR length (13) + "IHDR" begins at byte 8.
        assert_eq!(&png[8..12], &[0, 0, 0, 13]);
        assert_eq!(&png[12..16], b"IHDR");
        // width/height big-endian
        assert_eq!(&png[16..20], &8u32.to_be_bytes());
        assert_eq!(&png[20..24], &4u32.to_be_bytes());
        assert!(png.len() > 60, "png suspiciously small: {}", png.len());
    }

    /// Regression: each semantic `Tone` must resolve to its real theme color in the
    /// RENDERED PIXELS (Tone → theme OKLCH → sRGB → chip fill). Guards silent theme
    /// or tone-mapping drift — the pixels are the contract, not just the enum.
    #[test]
    fn tone_resolves_to_expected_pixels() {
        for (tone, oklch) in [
            (Tone::Alarm, DARK.alarm),
            (Tone::Accent, DARK.accent),
            (Tone::Landed, DARK.landed),
            (Tone::Engaged, DARK.engaged),
        ] {
            let c = render_blocks(
                &[Block::Chip {
                    label: "x".into(),
                    tone,
                }],
                &DARK,
                200,
            );
            // A point inside the chip fill, left of where the label text starts.
            let px = c.pixel(PAD + 2, HEADER_H + PAD + 10);
            assert_eq!(px, to_rgb(oklch), "chip fill for {tone:?} != theme color");
        }
    }

    /// Regression: the full sample renders every `Block` variant without panic and
    /// paints real, non-background pixels (a blank canvas would mean nothing drew).
    #[test]
    fn sample_renders_every_variant_non_blank() {
        let c = render_blocks(&sample_console_blocks(), &DARK, 960);
        assert!(c.w == 960 && c.h > 400, "canvas {}x{}", c.w, c.h);
        // The amber accent underline under the title bar sits at a stable coordinate.
        assert_eq!(
            c.pixel(10, HEADER_H),
            to_rgb(DARK.accent),
            "accent underline missing"
        );
        let bg = to_rgb(DARK.bg);
        let painted = (0..c.h)
            .step_by(7)
            .flat_map(|y| (0..c.w).step_by(7).map(move |x| (x, y)))
            .filter(|&(x, y)| c.pixel(x, y) != bg)
            .count();
        assert!(painted > 500, "too few painted pixels: {painted}");
    }

    #[test]
    fn mission_capture_states_are_distinct_and_show_delivery_only_when_settled() {
        let running = sample_mission_blocks("in_progress");
        let settled = sample_mission_blocks("settled");
        assert!(running
            .iter()
            .any(|block| matches!(block, Block::Chip { label, .. } if label == "Working")));
        assert!(!running
            .iter()
            .any(|block| matches!(block, Block::ArtifactRef { .. })));
        assert!(settled
            .iter()
            .any(|block| matches!(block, Block::Chip { label, .. } if label == "PR ready")));
        assert!(settled
            .iter()
            .any(|block| matches!(block, Block::ArtifactRef { .. })));
    }

    /// On-demand viewable artifact: `--headless-capture` and the proof script write
    /// a real PNG. This writes to `target/` (git-ignored) so the suite never commits
    /// a binary; encoder validity is asserted, not committed bytes.
    #[test]
    fn capture_writes_a_valid_png_to_target() {
        let out = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../target/headless-capture-sample.png");
        let n = capture_to_path(out.to_str().unwrap()).expect("write png");
        assert!(n > 5_000, "png too small: {n} bytes");
        let bytes = std::fs::read(&out).expect("read back");
        assert_eq!(
            &bytes[0..8],
            &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]
        );
    }
}
