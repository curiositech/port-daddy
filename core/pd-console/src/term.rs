//! Terminal renderer for the pane `Block` contract — the CLI face of the
//! console, painted in the same locked OKLCH theme as the GPUI shell.
//!
//! Capability ladder (detected once, overridable for tests):
//!   Truecolor — COLORTERM=truecolor|24bit → 24-bit ANSI from theme OKLCH
//!   Ansi16    — any other TTY → semantic 16-color codes (31/32/33/34/90)
//!   Plain     — NO_COLOR set, TERM=dumb, or output piped → no escapes at all
//!
//! Design rules applied (beautiful-cli-design):
//!   - 3 semantic colors + 1 accent; grayscale carries hierarchy
//!   - same symbols everywhere: ✓ landed · ● engaged · ✗ gated · ○ resting
//!   - column alignment is char-count based (multibyte-safe), never bytes
//!   - everything degrades to clean plain text under pipes/NO_COLOR

use crate::pane::{Block, Tone};
use crate::theme::{Oklch, Theme};
use std::io::IsTerminal;

/// What the terminal can render.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorMode {
    Truecolor,
    Ansi16,
    Plain,
}

impl ColorMode {
    /// Detect from the environment + stdout. NO_COLOR always wins
    /// (https://no-color.org), then pipe/dumb checks, then COLORTERM.
    pub fn detect() -> Self {
        if std::env::var_os("NO_COLOR").is_some() {
            return ColorMode::Plain;
        }
        if !std::io::stdout().is_terminal() {
            return ColorMode::Plain;
        }
        if std::env::var("TERM").map(|t| t == "dumb").unwrap_or(false) {
            return ColorMode::Plain;
        }
        match std::env::var("COLORTERM") {
            Ok(ct) if ct == "truecolor" || ct == "24bit" => ColorMode::Truecolor,
            _ => ColorMode::Ansi16,
        }
    }
}

/// Semantic color slots — the only colors the renderer may use.
#[derive(Debug, Clone, Copy)]
pub enum Sem {
    Ink,
    Ink2,
    Muted,
    Accent,
    Engaged,
    Gated,
    Resting,
    Landed,
}

impl Sem {
    fn oklch(self, t: &Theme) -> Oklch {
        match self {
            Sem::Ink => t.ink,
            Sem::Ink2 => t.ink2,
            Sem::Muted => t.muted,
            Sem::Accent => t.accent,
            Sem::Engaged => t.engaged,
            Sem::Gated => t.gated,
            Sem::Resting => t.resting,
            Sem::Landed => t.landed,
        }
    }

    /// 16-color fallback — semantic ANSI, readable on light AND dark themes.
    fn ansi16(self) -> &'static str {
        match self {
            Sem::Ink => "39",     // default foreground
            Sem::Ink2 => "39",
            Sem::Muted => "90",   // bright black
            Sem::Accent => "33",  // yellow (amber)
            Sem::Engaged => "34", // blue
            Sem::Gated => "31",   // red
            Sem::Resting => "90",
            Sem::Landed => "32",  // green
        }
    }
}

impl Tone {
    fn sem(self) -> Sem {
        match self {
            Tone::Default => Sem::Ink2,
            Tone::Accent => Sem::Accent,
            Tone::Engaged => Sem::Engaged,
            Tone::Gated => Sem::Gated,
            Tone::Resting => Sem::Resting,
            Tone::Landed => Sem::Landed,
            Tone::Conflicted => Sem::Gated,
        }
    }

    /// One status symbol per tone — consistent across every pane.
    fn symbol(self) -> &'static str {
        match self {
            Tone::Default => "·",
            Tone::Accent => "◆",
            Tone::Engaged => "●",
            Tone::Gated => "✗",
            Tone::Resting => "○",
            Tone::Landed => "✓",
            Tone::Conflicted => "⚠",
        }
    }
}

/// The styler — owns the mode + theme, paints strings.
pub struct TermStyle {
    pub mode: ColorMode,
    theme: &'static Theme,
}

impl TermStyle {
    pub fn detect(theme: &'static Theme) -> Self {
        Self { mode: ColorMode::detect(), theme }
    }

    pub fn with_mode(mode: ColorMode, theme: &'static Theme) -> Self {
        Self { mode, theme }
    }

    pub fn paint(&self, text: &str, sem: Sem) -> String {
        match self.mode {
            ColorMode::Plain => text.to_string(),
            ColorMode::Ansi16 => format!("\x1b[{}m{text}\x1b[0m", sem.ansi16()),
            ColorMode::Truecolor => {
                let rgb = sem.oklch(self.theme).to_srgb8();
                let (r, g, b) = ((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff);
                format!("\x1b[38;2;{r};{g};{b}m{text}\x1b[0m")
            }
        }
    }

    pub fn bold(&self, text: &str) -> String {
        match self.mode {
            ColorMode::Plain => text.to_string(),
            _ => format!("\x1b[1m{text}\x1b[0m"),
        }
    }

    fn bold_paint(&self, text: &str, sem: Sem) -> String {
        match self.mode {
            ColorMode::Plain => text.to_string(),
            _ => format!("\x1b[1m{}\x1b[0m", self.paint(text, sem)),
        }
    }
}

/// Char-count padding (multibyte-safe; bytes would misalign on é/—/CJK).
fn pad(text: &str, width: usize) -> String {
    let len = text.chars().count();
    if len >= width {
        text.to_string()
    } else {
        format!("{text}{}", " ".repeat(width - len))
    }
}

/// Render a `Spark` series as a real unicode ramp, normalized to min..max.
fn spark_line(values: &[f32]) -> String {
    const RAMP: [char; 8] = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    if values.is_empty() {
        return String::new();
    }
    let (mut lo, mut hi) = (f32::INFINITY, f32::NEG_INFINITY);
    for &v in values {
        lo = lo.min(v);
        hi = hi.max(v);
    }
    let span = (hi - lo).max(f32::EPSILON);
    values
        .iter()
        .map(|&v| {
            let idx = (((v - lo) / span) * 7.0).round() as usize;
            RAMP[idx.min(7)]
        })
        .collect()
}

/// Render blocks to a styled string. Consecutive `Row` runs get their columns
/// aligned (widths computed across the run, char-count based).
pub fn render_blocks(blocks: &[Block], style: &TermStyle) -> String {
    let mut out = String::new();
    let mut i = 0;

    while i < blocks.len() {
        match &blocks[i] {
            Block::Header(text) => {
                let rule_len = 46usize.saturating_sub(text.chars().count());
                out.push('\n');
                out.push_str(&format!(
                    "  {} {}\n",
                    style.bold_paint(text, Sem::Accent),
                    style.paint(&"─".repeat(rule_len), Sem::Resting),
                ));
                i += 1;
            }
            Block::KeyVal(key, val) => {
                out.push_str(&format!(
                    "  {} {}\n",
                    style.paint(&pad(key, 18), Sem::Muted),
                    style.paint(val, Sem::Ink),
                ));
                i += 1;
            }
            Block::Row(_) => {
                // Collect the whole run of consecutive rows, compute column widths.
                let run_start = i;
                while i < blocks.len() && matches!(blocks[i], Block::Row(_)) {
                    i += 1;
                }
                let rows: Vec<&Vec<String>> = blocks[run_start..i]
                    .iter()
                    .filter_map(|b| match b {
                        Block::Row(cells) => Some(cells),
                        _ => None,
                    })
                    .collect();
                let ncols = rows.iter().map(|r| r.len()).max().unwrap_or(0);
                let mut widths = vec![0usize; ncols];
                for row in &rows {
                    for (c, cell) in row.iter().enumerate() {
                        widths[c] = widths[c].max(cell.chars().count());
                    }
                }
                let sep = style.paint("│", Sem::Resting);
                for row in rows {
                    let line: Vec<String> = row
                        .iter()
                        .enumerate()
                        .map(|(c, cell)| {
                            let padded = pad(cell, widths[c]);
                            if c == 0 {
                                style.paint(&padded, Sem::Accent)
                            } else {
                                style.paint(&padded, Sem::Ink2)
                            }
                        })
                        .collect();
                    out.push_str(&format!("  {}\n", line.join(&format!(" {sep} "))));
                }
            }
            Block::Chip { label, tone } => {
                let sem = tone.sem();
                out.push_str(&format!(
                    "  {} {}\n",
                    style.paint(tone.symbol(), sem),
                    style.paint(label, sem),
                ));
                i += 1;
            }
            Block::Spark(values) => {
                out.push_str(&format!(
                    "  {}\n",
                    style.paint(&spark_line(values), Sem::Engaged)
                ));
                i += 1;
            }
            Block::Gap => {
                out.push('\n');
                i += 1;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::DARK;

    fn plain() -> TermStyle {
        TermStyle::with_mode(ColorMode::Plain, &DARK)
    }

    #[test]
    fn plain_mode_emits_no_escapes() {
        let s = plain();
        let blocks = vec![
            Block::Header("Fleet".into()),
            Block::KeyVal("total".into(), "3".into()),
            Block::Chip { label: "ok".into(), tone: Tone::Landed },
        ];
        let out = render_blocks(&blocks, &s);
        assert!(!out.contains('\x1b'), "plain mode leaked ANSI: {out:?}");
        assert!(out.contains("Fleet"));
        assert!(out.contains("✓ ok"));
    }

    #[test]
    fn truecolor_uses_24bit_sequences() {
        let s = TermStyle::with_mode(ColorMode::Truecolor, &DARK);
        let out = s.paint("x", Sem::Accent);
        assert!(out.starts_with("\x1b[38;2;"), "not truecolor: {out:?}");
        assert!(out.ends_with("\x1b[0m"));
    }

    #[test]
    fn ansi16_uses_semantic_codes() {
        let s = TermStyle::with_mode(ColorMode::Ansi16, &DARK);
        assert!(s.paint("e", Sem::Gated).starts_with("\x1b[31m"));   // red = error
        assert!(s.paint("ok", Sem::Landed).starts_with("\x1b[32m")); // green = success
    }

    #[test]
    fn rows_align_columns_char_safe() {
        let s = plain();
        let blocks = vec![
            Block::Row(vec!["a".into(), "long-cell".into()]),
            Block::Row(vec!["bbbb".into(), "x".into()]),
        ];
        let out = render_blocks(&blocks, &s);
        let lines: Vec<&str> = out.lines().collect();
        // separators must land in the same column
        let p0 = lines[0].find('│').unwrap();
        let p1 = lines[1].find('│').unwrap();
        assert_eq!(p0, p1, "misaligned:\n{out}");
    }

    #[test]
    fn pad_counts_chars_not_bytes() {
        // "café" is 4 chars / 5 bytes — byte-padding would mis-size it
        assert_eq!(pad("café", 6).chars().count(), 6);
    }

    #[test]
    fn spark_renders_normalized_ramp() {
        let line = spark_line(&[0.0, 0.5, 1.0]);
        assert_eq!(line, "▁▅█");
        assert_eq!(spark_line(&[]), "");
    }

    #[test]
    fn tone_symbols_are_consistent() {
        assert_eq!(Tone::Landed.symbol(), "✓");
        assert_eq!(Tone::Gated.symbol(), "✗");
        assert_eq!(Tone::Engaged.symbol(), "●");
        assert_eq!(Tone::Conflicted.symbol(), "⚠");
    }
}
