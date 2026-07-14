//! pd-console GPU palette — light + dark, matched to the website semantic tokens.
//!
//! Distinct from `theme.rs` (the REPL's OKLCH terminal system). This is the GUI
//! render palette: every color the gpui render reads lives here as a *role*, so
//! flipping `ThemeMode` (Ctrl-A g) re-skins the whole window on the next notify.
//!
//! The website owns the role vocabulary: cobalt primary, kelp accent, coral heat,
//! amber warning, paper/ink surfaces. The native console keeps those same meanings
//! so screenshots read as the app version of portdaddy.dev, not a separate product.

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
    // Code syntax roles (the Harbor editor's CodeBuffer face). Same contract
    // as every other role: meaning lives in `SyntaxKind`, the hex lives HERE
    // once per mode — panes never carry a color.
    pub syn_keyword: u32,
    pub syn_type: u32,
    pub syn_string: u32,
    pub syn_comment: u32,
    pub syn_number: u32,
}

/// LIGHT — website paper/cobalt/kelp plus coral heat and amber warning.
const LIGHT: Theme = Theme {
    mode: ThemeMode::Light,
    bg: 0xf2eee6,
    panel: 0xf7f3eb,
    raised: 0xfbf7ef,
    sunken: 0xe9e2d5,
    ink: 0x121212,
    ink2: 0x403b34,
    muted: 0x6f675a,
    line: 0xcfc1af,
    line2: 0x8d806e,
    accent: 0x003fb8,
    accent_ink: 0x003fb8,
    engaged: 0x8c540e,
    gated: 0xaa432e,
    landed: 0x006b5f,
    resting: 0x7e6f5c,
    conflict: 0xbf2f2f,
    mayday: 0x8b1622,
    cobalt: 0x0055ff,
    flag_charlie: 0x006b5f,
    flag_kilo: 0x0055ff,
    flag_uniform: 0x8c540e,
    flag_november: 0xaa432e,
    flag_lima: 0x6f675a,
    syn_keyword: 0x003fb8,
    syn_type: 0x8c540e,
    syn_string: 0x006b5f,
    syn_comment: 0x6f675a,
    syn_number: 0xaa432e,
};

/// DARK — the exact story-linework console roles from `ports/port.css`.
/// Filled controls use the deep slab colors; text uses the brighter dark-mode
/// counterparts. Keeping those two jobs separate is what stops the shell from
/// collapsing into a generic bright-blue developer tool.
const DARK: Theme = Theme {
    mode: ThemeMode::Dark,
    bg: 0x0b0d11,
    panel: 0x101216,
    raised: 0x181c22,
    sunken: 0x0b0d11,
    ink: 0xf5f3ed,
    ink2: 0xd3cec2,
    muted: 0xa59f93,
    line: 0x2a2f3a,
    line2: 0x4a4f5c,
    accent: 0x003fb8,
    accent_ink: 0x7db4ff,
    engaged: 0xcad900,
    gated: 0xe0a5ed,
    landed: 0x5fce97,
    resting: 0x6f6a5f,
    conflict: 0xff7d7d,
    mayday: 0xff7d7d,
    cobalt: 0x7db4ff,
    flag_charlie: 0x5fce97,
    flag_kilo: 0x003fb8,
    flag_uniform: 0xf2be51,
    flag_november: 0xff7d7d,
    flag_lima: 0xe0a5ed,
    syn_keyword: 0x7db4ff,
    syn_type: 0xf2be51,
    syn_string: 0x5fce97,
    syn_comment: 0xa59f93,
    syn_number: 0xe0a5ed,
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
            // CRITICAL daemon health → the distress red (distinct from the
            // crimson `gated`/`conflict` warning tone).
            Tone::Alarm => self.mayday,
        }
    }

    /// Syntax color for a [`crate::pane::SyntaxKind`] code run — resolved
    /// here (the theme layer) so retheme/light-mode is free and no pane or
    /// renderer ever carries an inline hex.
    pub fn syntax(&self, kind: crate::pane::SyntaxKind) -> u32 {
        use crate::pane::SyntaxKind as K;
        match kind {
            K::Plain => self.ink2,
            K::Keyword => self.syn_keyword,
            K::Type => self.syn_type,
            K::Str => self.syn_string,
            K::Comment => self.syn_comment,
            K::Number => self.syn_number,
        }
    }

    /// Faint gated wash (~14% alpha) — destructive control hover.
    pub fn gated_wash(&self) -> Rgba {
        rgba((self.gated << 8) | 0x24)
    }
}
