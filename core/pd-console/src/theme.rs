//! The locked operator-console design system (operator-decided 2026-06-05).
//! Editorial: General Sans + IBM Plex Mono, warm-dark high-contrast, one cobalt
//! accent, color = meaning only.
//!
//! Colors are defined in **OKLCH** (perceptually uniform — harmonious ramps,
//! clean light/dark derivation, matched chroma across the accent set). No hex.
//! `to_srgb8()` converts for whatever the renderer needs (GPUI takes rgb(u32)).

/// An OKLCH color. `l` 0..1 (lightness), `c` chroma (~0..0.4), `h` hue degrees.
#[derive(Debug, Clone, Copy)]
pub struct Oklch {
    pub l: f32,
    pub c: f32,
    pub h: f32,
}

impl Oklch {
    pub const fn new(l: f32, c: f32, h: f32) -> Self {
        Self { l, c, h }
    }

    /// OKLCH → OKLab → linear sRGB → gamma sRGB, packed 0xRRGGBB.
    /// Standard Björn Ottosson conversion.
    pub fn to_srgb8(self) -> u32 {
        let hr = self.h.to_radians();
        let (a, b) = (self.c * hr.cos(), self.c * hr.sin());
        // OKLab -> LMS'
        let l_ = self.l + 0.396_337_78 * a + 0.215_803_76 * b;
        let m_ = self.l - 0.105_561_346 * a - 0.063_854_17 * b;
        let s_ = self.l - 0.089_484_18 * a - 1.291_485_5 * b;
        let (l3, m3, s3) = (l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_);
        // LMS -> linear sRGB
        let lin_r = 4.076_741_7 * l3 - 3.307_711_6 * m3 + 0.230_969_94 * s3;
        let lin_g = -1.268_438 * l3 + 2.609_757_4 * m3 - 0.341_319_38 * s3;
        let lin_b = -0.004_196_086 * l3 - 0.703_418_6 * m3 + 1.707_614_7 * s3;
        let enc = |v: f32| -> u32 {
            let v = v.clamp(0.0, 1.0);
            let s = if v <= 0.003_130_8 {
                12.92 * v
            } else {
                1.055 * v.powf(1.0 / 2.4) - 0.055
            };
            (s.clamp(0.0, 1.0) * 255.0 + 0.5) as u32
        };
        (enc(lin_r) << 16) | (enc(lin_g) << 8) | enc(lin_b)
    }
}

/// The console theme — every token an OKLCH value.
pub struct Theme {
    pub bg: Oklch,
    pub panel: Oklch,
    pub raised: Oklch,
    pub ink: Oklch,
    pub ink2: Oklch,
    pub muted: Oklch,
    pub accent: Oklch, // the single system accent (cobalt)
    // status = meaning only; matched chroma, paired lightness
    pub engaged: Oklch,
    pub gated: Oklch,
    pub resting: Oklch,
    pub landed: Oklch,
    pub conflicted: Oklch,
    /// LOUD alarm red — deeper + higher chroma than `gated`/`conflicted`, for a
    /// CRITICAL daemon-health state that must read as distinct from a warning.
    pub alarm: Oklch,
    pub sans: &'static str,
    pub mono: &'static str,
}

/// Warm neutral hue for surfaces + text; status hues at their semantic angles.
pub const DARK: Theme = Theme {
    bg: Oklch::new(0.16, 0.006, 80.0),
    panel: Oklch::new(0.19, 0.008, 80.0),
    raised: Oklch::new(0.23, 0.009, 80.0),
    ink: Oklch::new(0.95, 0.012, 85.0),
    ink2: Oklch::new(0.84, 0.012, 82.0),
    muted: Oklch::new(0.70, 0.012, 80.0),
    accent: Oklch::new(0.66, 0.18, 258.0),
    engaged: Oklch::new(0.84, 0.15, 110.0),
    gated: Oklch::new(0.72, 0.10, 25.0),
    resting: Oklch::new(0.50, 0.008, 80.0),
    landed: Oklch::new(0.78, 0.10, 150.0),
    conflicted: Oklch::new(0.72, 0.10, 25.0),
    // Deeper, more saturated than gated (0.72,0.10,25) — a true distress red.
    alarm: Oklch::new(0.58, 0.18, 22.0),
    sans: "General Sans",
    mono: "IBM Plex Mono",
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oklch_converts_to_plausible_srgb() {
        // near-white ink should be high in all channels
        let rgb = DARK.ink.to_srgb8();
        let (r, g, b) = ((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff);
        assert!(r > 220 && g > 220 && b > 200, "ink not bright: {rgb:06x}");
        // near-black bg should be low
        let bg = DARK.bg.to_srgb8();
        assert!((bg >> 16) < 40 && (bg & 0xff) < 40, "bg not dark: {bg:06x}");
        // cobalt accent: blue is the dominant channel.
        let ac = DARK.accent.to_srgb8();
        let (ar, ag, ab) = ((ac >> 16) & 0xff, (ac >> 8) & 0xff, ac & 0xff);
        assert!(ab > ar && ab > ag, "accent not cobalt: {ac:06x}");
    }
}
