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
//!   - column alignment is DISPLAY-width based (CJK/emoji-safe), never bytes or
//!     char-count — a 漢 occupies two columns, a combining mark zero
//!   - lines reflow to the terminal width on a TTY (ANSI-aware truncation with
//!     an … marker); piped/Plain output is never truncated, so `| grep` is whole
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
    /// LOUD distress red — CRITICAL daemon health (distinct from `Gated`).
    Alarm,
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
            Sem::Alarm => t.alarm,
        }
    }

    /// 16-color fallback — semantic ANSI, readable on light AND dark themes.
    fn ansi16(self) -> &'static str {
        match self {
            Sem::Ink => "39", // default foreground
            Sem::Ink2 => "39",
            Sem::Muted => "90",   // bright black
            Sem::Accent => "34",  // cobalt system accent
            Sem::Engaged => "33", // yellow/chartreuse activity
            Sem::Gated => "31",   // red
            Sem::Resting => "90",
            Sem::Landed => "32", // green
            Sem::Alarm => "91",  // bright red — louder than gated's 31
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
            Tone::Alarm => Sem::Alarm,
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
            Tone::Alarm => "‼",
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
        Self {
            mode: ColorMode::detect(),
            theme,
        }
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

/// Display columns one char occupies: 0 for combining/zero-width, 2 for East
/// Asian Wide / Fullwidth / emoji, 1 otherwise. Dep-free (a pragmatic subset of
/// UAX#11 + emoji ranges) — enough to keep CJK names and emoji from shearing
/// table columns, which a `chars().count()` (or byte) measure never could.
pub fn char_width(c: char) -> usize {
    let u = c as u32;
    // Zero-width: combining marks, ZWSP/ZWJ, variation selectors.
    if u == 0x200B
        || u == 0x200D
        || (0x0300..=0x036F).contains(&u)
        || (0xFE00..=0xFE0F).contains(&u)
    {
        return 0;
    }
    // Wide / fullwidth / emoji.
    let wide = (0x1100..=0x115F).contains(&u)            // Hangul Jamo
        || (0x2E80..=0x303E).contains(&u)                // CJK radicals … punctuation
        || (0x3041..=0x33FF).contains(&u)                // Hiragana/Katakana/CJK symbols
        || (0x3400..=0x4DBF).contains(&u)                // CJK Ext A
        || (0x4E00..=0x9FFF).contains(&u)                // CJK Unified
        || (0xA000..=0xA4CF).contains(&u)                // Yi
        || (0xAC00..=0xD7A3).contains(&u)                // Hangul Syllables
        || (0xF900..=0xFAFF).contains(&u)                // CJK Compat
        || (0xFE30..=0xFE4F).contains(&u)                // CJK Compat Forms
        || (0xFF00..=0xFF60).contains(&u)                // Fullwidth Forms
        || (0xFFE0..=0xFFE6).contains(&u)                // Fullwidth signs
        || (0x1F300..=0x1FAFF).contains(&u)              // emoji & pictographs
        || (0x20000..=0x3FFFD).contains(&u); // CJK Ext B+
    if wide {
        2
    } else {
        1
    }
}

/// Total display width of a string (sum of `char_width`).
pub fn display_width(s: &str) -> usize {
    s.chars().map(char_width).sum()
}

/// Pad to a target DISPLAY width (CJK/emoji-safe; bytes or char-count misalign).
fn pad(text: &str, width: usize) -> String {
    let len = display_width(text);
    if len >= width {
        text.to_string()
    } else {
        format!("{text}{}", " ".repeat(width - len))
    }
}

/// Truncate a (possibly ANSI-colored) line to `max` display columns, ANSI-aware:
/// escape sequences don't count toward width and are preserved, an `…` marks a
/// cut, and a reset is appended so color never bleeds past the cut. Lines that
/// already fit are returned unchanged.
fn truncate_ansi(line: &str, max: usize) -> String {
    if max == 0 {
        return String::new();
    }
    // Fast path: no escapes and already within width.
    if !line.contains('\x1b') && display_width(line) <= max {
        return line.to_string();
    }
    let budget = max.saturating_sub(1); // leave a column for the … marker
    let mut out = String::new();
    let mut width = 0usize;
    let mut had_escape = false;
    let mut truncated = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            had_escape = true;
            out.push(c);
            // Copy through the end of the CSI sequence (terminated by a letter).
            while let Some(&n) = chars.peek() {
                out.push(n);
                chars.next();
                if n.is_ascii_alphabetic() {
                    break;
                }
            }
            continue;
        }
        let w = char_width(c);
        if width + w > budget {
            truncated = true;
            break;
        }
        width += w;
        out.push(c);
    }
    if truncated {
        out.push('…');
    }
    if had_escape {
        out.push_str("\x1b[0m");
    }
    out
}

/// How many columns to reflow to. Plain mode (pipe/redirect/NO_COLOR) returns
/// None — piped output must stay whole so `| grep`/`| tee` is lossless. On a
/// TTY, honor $COLUMNS, else assume 80.
fn detect_cols(style: &TermStyle) -> Option<usize> {
    if style.mode == ColorMode::Plain {
        return None;
    }
    std::env::var("COLUMNS")
        .ok()
        .and_then(|c| c.parse::<usize>().ok())
        .filter(|&c| c >= 20)
        .or(Some(80))
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

/// The CLI shadow of an International Code of Signals flag: two adjacent
/// blocks, system color first and state/actor color second. It remains a stable
/// two-character token in Plain mode.
fn micro_flag(style: &TermStyle, sem: Sem) -> String {
    format!("{}{}", style.paint("▉", Sem::Accent), style.paint("▉", sem))
}

/// Render blocks to a styled string, reflowed to the detected terminal width.
pub fn render_blocks(blocks: &[Block], style: &TermStyle) -> String {
    render_blocks_width(blocks, style, detect_cols(style))
}

/// Render blocks to a styled string. Consecutive `Row` runs get their columns
/// aligned (widths computed across the run, DISPLAY-width based). When `cols` is
/// `Some(w)`, every emitted line is ANSI-aware-truncated to `w` columns; `None`
/// (pipes/Plain) leaves lines whole.
pub fn render_blocks_width(blocks: &[Block], style: &TermStyle, cols: Option<usize>) -> String {
    let mut out = String::new();
    let mut i = 0;
    let mut section_open = false;

    while i < blocks.len() {
        match &blocks[i] {
            Block::Header(text) => {
                let rule_len = 46usize.saturating_sub(text.chars().count());
                if section_open {
                    out.push_str(&format!("  {}\n", style.paint("└", Sem::Accent)));
                }
                out.push('\n');
                out.push_str(&format!(
                    "  {}{} {} {}\n",
                    style.paint("┌", Sem::Accent),
                    micro_flag(style, Sem::Engaged),
                    style.bold_paint(text, Sem::Accent),
                    style.paint(&"─".repeat(rule_len), Sem::Resting),
                ));
                section_open = true;
                i += 1;
            }
            Block::KeyVal(key, val) => {
                out.push_str(&format!(
                    "  {} {} {}\n",
                    style.paint("▏", Sem::Resting),
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
                        widths[c] = widths[c].max(display_width(cell));
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
                    out.push_str(&format!(
                        "  {} {}\n",
                        style.paint("▏", Sem::Resting),
                        line.join(&format!(" {sep} "))
                    ));
                }
            }
            Block::CodeBuffer {
                lines,
                gutter_cols,
                bands,
                ..
            } => {
                // Tight code face: `<band bar><line number> <author tag> <text
                // runs>`, one terminal line per code line. Bands paint a
                // colored left bar (the TUI shadow of the GPUI background
                // wash); the LAST covering band wins. The author column is
                // ALWAYS visible — operator lines subtle, agent lines Engaged.
                let width = *gutter_cols as usize;
                for line in lines.iter() {
                    let band = bands.iter().rev().find(|b| b.covers(line.number));
                    let bar = match band {
                        Some(b) => style.paint("▏", b.tone.sem()),
                        None => " ".to_string(),
                    };
                    let num = style.paint(&format!("{:>width$}", line.number), Sem::Muted);
                    let tag = match &line.author_tag {
                        Some(t) => format!(" {}", style.paint(t, line.author_tone.sem())),
                        None => "   ".to_string(),
                    };
                    let mut text = String::new();
                    let mut at = 0usize;
                    for (len, kind) in &line.runs {
                        let end = (at + *len as usize).min(line.text.len());
                        let sem = match kind {
                            crate::pane::SyntaxKind::Plain => Sem::Ink,
                            crate::pane::SyntaxKind::Keyword => Sem::Accent,
                            crate::pane::SyntaxKind::Type => Sem::Engaged,
                            crate::pane::SyntaxKind::Str => Sem::Landed,
                            crate::pane::SyntaxKind::Comment => Sem::Muted,
                            crate::pane::SyntaxKind::Number => Sem::Gated,
                        };
                        text.push_str(&style.paint(&line.text[at..end], sem));
                        at = end;
                    }
                    if at < line.text.len() {
                        text.push_str(&style.paint(&line.text[at..], Sem::Ink));
                    }
                    out.push_str(&format!(" {bar}{num}{tag}  {text}\n"));
                }
                i += 1;
            }
            Block::ChatTurn {
                speaker,
                text,
                tone,
            } => {
                let sem = tone.sem();
                let label = if speaker.trim().is_empty() {
                    "agent".to_string()
                } else {
                    speaker.to_string()
                };
                out.push_str(&format!(
                    "  {} {} {}\n",
                    style.paint(tone.symbol(), sem),
                    style.bold_paint(&format!("{label}:"), sem),
                    style.paint(&text, Sem::Ink),
                ));
                i += 1;
            }
            Block::TranscriptLine { text, tone } => {
                let sem = tone.sem();
                out.push_str(&format!(
                    "  {} {}\n",
                    style.paint(tone.symbol(), sem),
                    style.paint(text, Sem::Ink),
                ));
                i += 1;
            }
            Block::ArtifactRef {
                label,
                path,
                preview,
                tone,
            } => {
                let sem = tone.sem();
                let label = if label.trim().is_empty() {
                    "artifact".to_string()
                } else {
                    format!("artifact {label}")
                };
                let hint = preview
                    .as_deref()
                    .filter(|p| !p.trim().is_empty())
                    .map(|p| format!(" — {p}"))
                    .unwrap_or_default();
                out.push_str(&format!(
                    "  {} {} {}{}\n",
                    style.paint("▣", sem),
                    style.paint(&label, sem),
                    style.paint(path, Sem::Ink),
                    style.paint(&hint, Sem::Muted),
                ));
                i += 1;
            }
            Block::ImageArtifact {
                label,
                path,
                preview,
                image_path,
                tone,
            } => {
                let sem = tone.sem();
                let label = if label.trim().is_empty() {
                    "image".to_string()
                } else {
                    format!("image {label}")
                };
                let mut hint = preview
                    .as_deref()
                    .filter(|p| !p.trim().is_empty())
                    .map(|p| format!(" - {p}"))
                    .unwrap_or_default();
                if let Some(cache) = image_path.as_deref().filter(|p| !p.trim().is_empty()) {
                    hint.push_str(&format!(" - cached {cache}"));
                }
                out.push_str(&format!(
                    "  {} {} {}{}\n",
                    style.paint("▣", sem),
                    style.paint(&label, sem),
                    style.paint(path, Sem::Ink),
                    style.paint(&hint, Sem::Muted),
                ));
                i += 1;
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
            Block::Flag {
                letter,
                label,
                tone,
            } => {
                // TUI hoist: the same two-block micro-flag as the GPU face,
                // followed by its signal letter and operator label.
                let sem = tone.sem();
                out.push_str(&format!(
                    "  {} {} {}\n",
                    micro_flag(style, sem),
                    style.bold_paint(&letter.to_string(), sem),
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
            Block::WrappedText { text, tone } => {
                out.push_str(&format!("  {}\n", style.paint(text, tone.sem())));
                i += 1;
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
                // TUI face of the clickable roster row: selection caret, flag
                // letter, live marker (● live vs ○ historical), name, badge,
                // meta, age. Live and historical stay visually distinct.
                let sem = tone.sem();
                out.push_str(&format!(
                    "  {} {}{} {} {} {}  {}  {}\n",
                    micro_flag(style, sem),
                    style.paint(if *selected { "▸" } else { " " }, Sem::Accent),
                    style.bold_paint(&flag.to_string(), sem),
                    style.paint(if *live { "●" } else { "○" }, sem),
                    style.bold_paint(name, if *selected { Sem::Accent } else { Sem::Ink }),
                    style.paint(&format!("[{badge}]"), badge_tone.sem()),
                    style.paint(meta, Sem::Muted),
                    style.paint(age, Sem::Muted),
                ));
                i += 1;
            }
            Block::ControlButton {
                label,
                enabled,
                why_disabled,
                primary,
                ..
            } => {
                // TUI face of a control: an honest disabled state names its
                // exact cause — never a silently dead affordance.
                if *enabled {
                    let sem = if *primary { Sem::Accent } else { Sem::Ink };
                    out.push_str(&format!(
                        "  {}\n",
                        style.bold_paint(&format!("[ {label} ]"), sem)
                    ));
                } else {
                    out.push_str(&format!(
                        "  {} {}\n",
                        style.paint(&format!("( {label} )"), Sem::Resting),
                        style.paint(why_disabled.as_deref().unwrap_or("unavailable"), Sem::Muted),
                    ));
                }
                i += 1;
            }
        }
    }
    if section_open {
        out.push_str(&format!("  {}\n", style.paint("└", Sem::Accent)));
    }
    // Reflow: truncate each emitted line to the terminal width (TTY only; pipes
    // pass None and stay whole). ANSI-aware so color never bleeds past the cut.
    match cols {
        Some(w) => out
            .split('\n')
            .map(|line| truncate_ansi(line, w))
            .collect::<Vec<_>>()
            .join("\n"),
        None => out,
    }
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
            Block::Chip {
                label: "ok".into(),
                tone: Tone::Landed,
            },
        ];
        let out = render_blocks(&blocks, &s);
        assert!(!out.contains('\x1b'), "plain mode leaked ANSI: {out:?}");
        assert!(out.contains("Fleet"));
        assert!(out.contains("✓ ok"));
    }

    #[test]
    fn story_linework_header_uses_ticks_and_two_block_flag() {
        let out = render_blocks_width(&[Block::Header("Fleet".into())], &plain(), None);
        assert!(
            out.contains("┌▉▉ Fleet"),
            "missing corner/flag grammar: {out}"
        );
        assert!(out.trim_end().ends_with('└'), "missing closing tick: {out}");
    }

    #[test]
    fn artifact_refs_render_as_file_artifacts() {
        let s = plain();
        let blocks = vec![Block::ArtifactRef {
            label: "screenshot".into(),
            path: "core/pd-console/docs/artifacts/lane.png".into(),
            preview: Some("open / preview in current worktree".into()),
            tone: Tone::Accent,
        }];
        let out = render_blocks(&blocks, &s);
        assert!(out.contains("▣ artifact screenshot"));
        assert!(out.contains("core/pd-console/docs/artifacts/lane.png"));
        assert!(out.contains("open / preview in current worktree"));
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
        assert!(s.paint("e", Sem::Gated).starts_with("\x1b[31m")); // red = error
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

    #[test]
    fn display_width_handles_cjk_emoji_and_combining() {
        assert_eq!(display_width("abc"), 3);
        assert_eq!(display_width("日本語"), 6); // 3 wide chars × 2
        assert_eq!(display_width("a日b"), 4); // 1 + 2 + 1
        assert_eq!(char_width('🚀'), 2); // emoji is wide
        assert_eq!(char_width('\u{0301}'), 0); // combining acute accent
                                               // "e" + combining acute renders as one column.
        assert_eq!(display_width("e\u{0301}"), 1);
    }

    #[test]
    fn rows_align_with_cjk_content() {
        // A CJK cell occupies 2 columns each; char-count alignment would shear
        // the separator. Display-width alignment keeps it straight.
        let s = plain();
        let blocks = vec![
            Block::Row(vec!["日本".into(), "x".into()]), // 4 display cols
            Block::Row(vec!["ab".into(), "y".into()]),   // 2 display cols
        ];
        let out = render_blocks_width(&blocks, &s, None);
        let lines: Vec<&str> = out.lines().collect();
        // Both separators land at the same DISPLAY column (measure the prefix).
        let col = |l: &str| display_width(&l[..l.find('│').unwrap()]);
        assert_eq!(col(lines[0]), col(lines[1]), "CJK rows misaligned:\n{out}");
    }

    #[test]
    fn truncate_ansi_respects_width_and_preserves_color() {
        // Plain over-long line gets an ellipsis at the budget.
        let t = truncate_ansi("hello world", 6);
        assert_eq!(display_width(&t), 6); // 5 visible + …
        assert!(t.ends_with('…'));
        // A colored line keeps its escapes and never bleeds (reset appended).
        let colored = "\x1b[31mhello world\x1b[0m";
        let tc = truncate_ansi(colored, 6);
        assert!(tc.contains("\x1b[31m"), "lost color: {tc:?}");
        assert!(tc.ends_with("\x1b[0m"), "color bleeds past cut: {tc:?}");
        // CJK truncation counts display columns, not chars.
        let cjk = truncate_ansi("日本語テスト", 5);
        assert!(display_width(&cjk) <= 5, "over budget: {cjk:?}");
    }

    #[test]
    fn render_truncates_on_tty_but_keeps_pipes_whole() {
        let s = plain();
        let long = "x".repeat(200);
        let blocks = vec![Block::KeyVal("k".into(), long.clone())];
        // None (pipe/Plain) → never truncated, full content survives `| grep`.
        let piped = render_blocks_width(&blocks, &s, None);
        assert!(piped.contains(&long), "pipe output must stay whole");
        // Some(w) (TTY) → every line fits the width.
        let reflowed = render_blocks_width(&blocks, &s, Some(40));
        for line in reflowed.lines() {
            assert!(display_width(line) <= 40, "line over 40 cols: {line:?}");
        }
    }
}
