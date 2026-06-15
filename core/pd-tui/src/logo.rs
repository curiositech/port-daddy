//! The Port Daddy logo, animated.
//!
//! The same blocky "Port / Daddy" letters the daemon prints at startup
//! (`lib/banner.ts`), brought into the Rust TUI as a living widget. The
//! animation is a single deterministic cycle driven by a tick counter:
//!
//! 1. **Sail** — the logo holds steady while a diagonal glint sweeps it.
//! 2. **Wink** — the "o" in Port closes for a few ticks. Twice per cycle.
//! 3. **Melt** — letters scatter-dissolve into a seascape: rolling waves
//!    at the waterline, a gold sun with its reflection on the water.
//! 4. **Rise** — the letters reassemble out of the sea.
//!
//! Everything routes through [`cell`], a pure function of
//! `(frame, row, col)`, so the whole animation is unit-testable without
//! a terminal. Colors are emitted as symbolic [`Ink`] roles; the widget
//! always resolves them against the *dark* palette (the splash is a fixed
//! "harbor at first light" scene regardless of `PD_THEME`).

use ratatui::{buffer::Buffer, layout::Rect, style::Color, widgets::Widget};

/// Brand tagline — keep in sync with `lib/banner.ts` TAGLINE.
pub const TAGLINE: &str = "Run a tight harbor.";

/// The block letters, verbatim from `lib/banner.ts` BANNER (ANSI stripped).
pub const LOGO: [&str; 19] = [
    " ███████████                      █████",
    "▒▒███▒▒▒▒▒███                    ▒▒███",
    " ▒███    ▒███  ██████  ████████  ███████",
    " ▒██████████  ███▒▒███▒▒███▒▒███▒▒▒███▒",
    " ▒███▒▒▒▒▒▒  ▒███ ▒███ ▒███ ▒▒▒   ▒███",
    " ▒███        ▒███ ▒███ ▒███       ▒███ ███",
    " █████       ▒▒██████  █████      ▒▒█████",
    "▒▒▒▒▒         ▒▒▒▒▒▒  ▒▒▒▒▒        ▒▒▒▒▒",
    " ██████████                 █████     █████",
    "▒▒███▒▒▒▒███               ▒▒███     ▒▒███",
    " ▒███   ▒▒███  ██████    ███████   ███████  █████ ████",
    " ▒███    ▒███ ▒▒▒▒▒███  ███▒▒███  ███▒▒███ ▒▒███ ▒███",
    " ▒███    ▒███  ███████ ▒███ ▒███ ▒███ ▒███  ▒███ ▒███",
    " ▒███    ███  ███▒▒███ ▒███ ▒███ ▒███ ▒███  ▒███ ▒███",
    " ██████████  ▒▒████████▒▒████████▒▒████████ ▒▒███████",
    "▒▒▒▒▒▒▒▒▒▒    ▒▒▒▒▒▒▒▒  ▒▒▒▒▒▒▒▒  ▒▒▒▒▒▒▒▒   ▒▒▒▒▒███",
    "                                             ███ ▒███",
    "                                            ▒▒██████",
    "                                             ▒▒▒▒▒▒",
];

/// Logo grid height in rows.
pub const ROWS: usize = LOGO.len();

/// Logo grid width in columns (longest row). Computed once and cached —
/// `cell`/`seascape` call this on every cell of every frame, so we avoid
/// re-scanning the rows with `chars().count()` each time.
pub fn width() -> usize {
    use std::sync::OnceLock;
    static WIDTH: OnceLock<usize> = OnceLock::new();
    *WIDTH.get_or_init(|| LOGO.iter().map(|r| r.chars().count()).max().unwrap_or(0))
}

/// Total ticks in one animation cycle. At a 100ms tick this is a 24s loop.
pub const CYCLE: u64 = 240;

const MELT_START: u64 = 140;
const SEA_START: u64 = 180;
const RISE_START: u64 = 220;

/// The "o" of Port — the eye that winks. Grid rect in (row, col) space.
const WINK_ROWS: std::ops::RangeInclusive<usize> = 2..=6;
const WINK_COLS: std::ops::RangeInclusive<usize> = 13..=22;
const WINK_LID_ROW: usize = 4;

/// Semantic color roles. The widget maps these onto the active theme;
/// keeping them symbolic keeps `cell` pure and theme-agnostic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ink {
    /// Solid hull of the letters (the █ runs).
    Hull,
    /// The ▒ drop-shadow of the letters.
    Shade,
    /// Glint sweep / foam highlights.
    Glint,
    /// The sun and its reflection on the water.
    Sun,
    /// Rolling waves.
    Wave,
}

/// Per-cell scatter delay (0..40) for the melt and rise phases.
/// Cheap integer hash, deterministic, decorrelated from row/col stripes.
fn scatter(row: usize, col: usize) -> u64 {
    let x = (row as u64)
        .wrapping_mul(2654435761)
        .wrapping_add((col as u64).wrapping_mul(40503))
        .wrapping_add(97);
    (x ^ (x >> 13)) % 40
}

/// The seascape that the logo melts into: waves on the lower rows, a
/// chunky pixel sun upper-right, its reflection laid on the water.
fn seascape(frame: u64, row: usize, col: usize) -> Option<(char, Ink)> {
    let w = width();
    let sun_col = w.saturating_sub(10) as i64;
    let sun_row = 4i64;
    let dx = col as i64 - sun_col;
    let dy = row as i64 - sun_row;

    // Sun disc, aspect-corrected for tall terminal cells (dx counts half).
    // Radius breathes by one cell every few ticks — the glimmer.
    let pulse = ((frame / 6) % 2) as i64;
    if (dx * dx) / 4 + dy * dy <= 8 + pulse {
        return Some(('█', Ink::Sun));
    }
    // Rays — short horizontal flares off the disc.
    if dy == 0 && dx.abs() > 6 && dx.abs() <= 8 + pulse {
        return Some(('═', Ink::Sun));
    }

    // Waterline and below.
    if row >= ROWS - 6 {
        let k = (col as u64 + frame / 2 + (row as u64) * 5) % 8;
        let ch = match k {
            0 | 1 => '≋',
            2 | 3 => '≈',
            4 => '~',
            _ => ' ',
        };
        if ch == ' ' {
            return None;
        }
        // Sun reflection: the column under the sun glows gold.
        if (col as i64 - sun_col).abs() <= 2 {
            return Some((ch, Ink::Sun));
        }
        // Occasional foam fleck.
        if (col as u64 * 7 + frame / 3).is_multiple_of(19) {
            return Some(('·', Ink::Glint));
        }
        return Some((ch, Ink::Wave));
    }

    None
}

/// The pure heart of the animation: what character and ink does grid cell
/// `(row, col)` show at tick `frame`? `None` means transparent (sky).
pub fn cell(frame: u64, row: usize, col: usize) -> Option<(char, Ink)> {
    let frame = frame % CYCLE;
    let glyph = LOGO
        .get(row)
        .and_then(|r| r.chars().nth(col))
        .unwrap_or(' ');

    // How present is the logo right now? (vs. the seascape behind it)
    let logo_visible = match frame {
        f if f < MELT_START => true,
        f if f < SEA_START => scatter(row, col) > f - MELT_START,
        f if f < RISE_START => false,
        f => scatter(row, col) < (f - RISE_START) * 2,
    };

    if !logo_visible || glyph == ' ' {
        return seascape(frame, row, col);
    }

    // Wink: the "o" of Port closes — lid drawn, rest of the eye blanked.
    let winking = (60..66).contains(&frame) || (100..106).contains(&frame);
    if winking && WINK_ROWS.contains(&row) && WINK_COLS.contains(&col) {
        if row == WINK_LID_ROW {
            return Some(('─', Ink::Glint));
        }
        return None;
    }

    // Glint: a diagonal highlight band sweeps the letters while sailing.
    let span = (width() + ROWS) as u64;
    let band = (frame * 2) % span;
    let diag = (row + col) as u64;
    let glinting = frame < MELT_START && diag.abs_diff(band) <= 2;

    match glyph {
        '█' if glinting => Some(('█', Ink::Glint)),
        '█' => Some(('█', Ink::Hull)),
        '▒' if glinting => Some(('▒', Ink::Glint)),
        '▒' => Some(('▒', Ink::Shade)),
        other => Some((other, Ink::Hull)),
    }
}

/// Ratatui widget: renders the animated logo centered in `area`, with the
/// tagline beneath it. Drive it by bumping `frame` on your tick loop
/// (one frame per ~100ms reads well).
pub struct AnimatedLogo {
    pub frame: u64,
}

impl AnimatedLogo {
    pub fn new(frame: u64) -> Self {
        Self { frame }
    }

    fn ink_color(ink: Ink, theme: &dyn crate::tokens::Theme) -> Color {
        match ink {
            // The logo is the brand: bright gold letter-face, amber bevel.
            Ink::Hull => theme.bg_brand(),
            Ink::Shade => theme.bg_warning(),
            // Cream highlight — the glint sweep and the foam flecks.
            Ink::Glint => theme.text_heading(),
            // The sun shares the brand gold: one warm light source.
            Ink::Sun => theme.bg_brand(),
            // Sea-blue water. tokens.rs is generated from design/tokens/*.json
            // and has no dedicated "water" role, so we reuse its sky-blue
            // info value, which is exactly the shimmer we want.
            Ink::Wave => theme.term_info(),
        }
    }
}

impl Widget for AnimatedLogo {
    fn render(self, area: Rect, buf: &mut Buffer) {
        // The splash is always the dramatic "harbor at first light" scene — a
        // dark backdrop regardless of PD_THEME, so the gold logo, sky-blue
        // water, and cream glints always read at full contrast. Light-mode
        // users still get the dark splash, then dock into their light UI.
        let theme: &dyn crate::tokens::Theme = &crate::tokens::dark::THEME;
        let backdrop = theme.bg_page();
        for y in area.top()..area.bottom() {
            for x in area.left()..area.right() {
                if let Some(c) = buf.cell_mut((x, y)) {
                    c.set_char(' ');
                    c.set_bg(backdrop);
                }
            }
        }

        let w = width() as u16;
        let h = ROWS as u16;
        // Center the logo block; +2 leaves room for the tagline.
        let x0 = area.x + area.width.saturating_sub(w) / 2;
        let y0 = area.y + area.height.saturating_sub(h + 2) / 2;

        for row in 0..ROWS {
            let y = y0 + row as u16;
            if y >= area.y + area.height {
                break;
            }
            for col in 0..width() {
                let x = x0 + col as u16;
                if x >= area.x + area.width {
                    break;
                }
                if let Some((ch, ink)) = cell(self.frame, row, col) {
                    if let Some(c) = buf.cell_mut((x, y)) {
                        c.set_char(ch);
                        c.set_fg(Self::ink_color(ink, theme));
                    }
                }
            }
        }

        // Tagline, centered under the logo.
        let ty = y0 + h + 1;
        if ty < area.y + area.height {
            let tw = TAGLINE.chars().count() as u16;
            let tx = area.x + area.width.saturating_sub(tw) / 2;
            for (i, ch) in TAGLINE.chars().enumerate() {
                let x = tx + i as u16;
                if x >= area.x + area.width {
                    break;
                }
                if let Some(c) = buf.cell_mut((x, ty)) {
                    c.set_char(ch);
                    c.set_fg(theme.text_body_subtle());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logo_grid_is_consistent() {
        assert_eq!(ROWS, 19);
        let w = width();
        assert!(w >= 50, "logo unexpectedly narrow: {w}");
        for row in LOGO {
            assert!(row.chars().count() <= w);
        }
    }

    #[test]
    fn frame_zero_shows_the_letters() {
        // Top-left run of P: row 0 col 1 is a hull block.
        let (ch, ink) = cell(0, 0, 1).expect("P should be present at frame 0");
        assert_eq!(ch, '█');
        assert!(matches!(ink, Ink::Hull | Ink::Glint));
        // Shadow cell keeps its ▒.
        let (ch, _) = cell(0, 1, 0).expect("shadow present at frame 0");
        assert_eq!(ch, '▒');
    }

    #[test]
    fn the_o_winks() {
        let mid_wink = 62;
        // Lid row renders the closed-eye dash where the o has substance.
        let lid = cell(mid_wink, WINK_LID_ROW, 16);
        assert_eq!(lid, Some(('─', Ink::Glint)));
        // Above the lid the eye is blanked (sky shows through).
        assert_eq!(cell(mid_wink, 3, 16), None);
        // Outside the wink window the o is solid again.
        assert!(cell(70, 3, 16).is_some());
    }

    #[test]
    fn sea_phase_has_waves_and_sun() {
        let f = SEA_START + 10;
        // Sun disc center.
        let sun = cell(f, 4, width() - 10).expect("sun should shine");
        assert_eq!(sun, ('█', Ink::Sun));
        // At least one wave glyph on the waterline rows.
        let wave_found = (0..width()).any(|c| {
            matches!(cell(f, ROWS - 3, c), Some((ch, Ink::Wave | Ink::Sun)) if "≋≈~".contains(ch))
        });
        assert!(wave_found, "no waves during sea phase");
        // The letters are gone — whatever shows at the old P cell, it is
        // not hull ink.
        assert!(!matches!(cell(f, 0, 1), Some((_, Ink::Hull | Ink::Shade))));
    }

    #[test]
    fn cycle_wraps_back_to_the_logo() {
        for (row, col) in [(0usize, 1usize), (5, 2), (10, 15), (14, 30)] {
            assert_eq!(cell(0, row, col), cell(CYCLE, row, col));
        }
    }
}
