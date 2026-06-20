//! pd-console GPU palette — light + dark, matched to the maritime + neobrutalism
//! token system (design/tokens/*.json → the v12 synthesis mock's :root vars).
//!
//! Distinct from `theme.rs` (the REPL's OKLCH terminal system). This is the GUI
//! render palette: every color the gpui render reads lives here as a *role*, so
//! flipping `ThemeMode` (Ctrl-A g) re-skins the whole window on the next notify.
//!
//! Brand is mustard-amber #FFDB33 (accent). Alert is crimson — #C41E30 in light,
//! #F26475 in dark (gated). NEVER the retired Harbor Heritage trio — cinnabar,
//! brass, patina — which scripts/check-brand-colors.mjs fails CI on.

use crate::pane::Tone;
use gpui::{rgba, Rgba};

/// Which palette is live. Flipped by the leader command `Ctrl-A g`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemeMode {
    Light,
    Dark,
}

impl ThemeMode {
    pub fn toggled(self) -> Self {
        match self {
            ThemeMode::Light => ThemeMode::Dark,
            ThemeMode::Dark => ThemeMode::Light,
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            ThemeMode::Light => "light",
            ThemeMode::Dark => "dark",
        }
    }
}

/// A complete palette. Every field is one render role; values are sRGB 0xRRGGBB.
#[derive(Debug, Clone, Copy)]
pub struct Theme {
    pub mode: ThemeMode,
    pub bg: u32,
    pub panel: u32,
    pub raised: u32,
    pub sunken: u32,
    pub ink: u32,
    pub ink2: u32,
    pub muted: u32,
    pub line: u32,
    pub line2: u32,
    pub accent: u32,
    pub accent_ink: u32,
    pub engaged: u32,
    pub gated: u32,
    pub landed: u32,
    pub resting: u32,
    pub conflict: u32,
    pub mayday: u32,
    pub cobalt: u32,
    pub flag_charlie: u32,
    pub flag_kilo: u32,
    pub flag_uniform: u32,
    pub flag_november: u32,
    pub flag_lima: u32,
}

/// LIGHT — warm paper, mustard brand, crimson alert (#C41E30).
const LIGHT: Theme = Theme {
    mode: ThemeMode::Light,
    bg: 0xf5f5f0,
    panel: 0xffffff,
    raised: 0xfff9e0,
    sunken: 0xf0eddf,
    ink: 0x1e1b18,
    ink2: 0x2b2a26,
    muted: 0x3f3d38,
    line: 0xd4c5a9,
    line2: 0x1e1b18,
    accent: 0xffdb33,
    accent_ink: 0x8a5a00,
    engaged: 0xb8860b,
    gated: 0xc41e30,
    landed: 0x15803d,
    resting: 0x6b6457,
    conflict: 0xc41e30,
    mayday: 0x8b1622,
    cobalt: 0x003f7f,
    flag_charlie: 0x15803d,
    flag_kilo: 0x003f7f,
    flag_uniform: 0xb8860b,
    flag_november: 0xc41e30,
    flag_lima: 0x3f3d38,
};

/// DARK — warm ebony, mustard brand, crimson alert (#F26475).
const DARK: Theme = Theme {
    mode: ThemeMode::Dark,
    bg: 0x1e1b18,
    panel: 0x2b2724,
    raised: 0x3a342d,
    sunken: 0x100e0c,
    ink: 0xf5f5f0,
    ink2: 0xd1d1c7,
    muted: 0xb5b5a8,
    line: 0x504b46,
    line2: 0xf5f5f0,
    accent: 0xffdb33,
    accent_ink: 0xffdb33,
    engaged: 0xf59e0b,
    gated: 0xf26475,
    landed: 0x6dd3a8,
    resting: 0x8a8378,
    conflict: 0xf26475,
    mayday: 0x8b1622,
    cobalt: 0x7fc4ff,
    flag_charlie: 0x6dd3a8,
    flag_kilo: 0x1e3a8a,
    flag_uniform: 0xedc531,
    flag_november: 0xf26475,
    flag_lima: 0xb5b5a8,
};

impl Theme {
    pub fn for_mode(mode: ThemeMode) -> Theme {
        match mode {
            ThemeMode::Light => LIGHT,
            ThemeMode::Dark => DARK,
        }
    }

    /// Status color for a pane `Tone` (replaces the old free `tone_rgb`).
    pub fn tone(&self, tone: &Tone) -> u32 {
        match tone {
            Tone::Default => self.ink2,
            Tone::Accent => self.accent_ink,
            Tone::Engaged => self.engaged,
            Tone::Gated => self.gated,
            Tone::Resting => self.resting,
            Tone::Landed => self.landed,
            Tone::Conflicted => self.conflict,
        }
    }

    /// Faint gated wash (~14% alpha) — destructive control hover.
    pub fn gated_wash(&self) -> Rgba {
        rgba((self.gated << 8) | 0x24)
    }
}
