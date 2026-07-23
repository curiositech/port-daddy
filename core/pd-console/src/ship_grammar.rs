//! Ship Grammar — deterministic little-boat avatars for agents.
//!
//! Two axes, one rule: *what stays is the silhouette (the agent), what drifts is
//! the livery (the fleet)* — Theseus, settled. A `code-reviewer` looks like a
//! `code-reviewer` in every fleet; two fleets' code-reviewers wear different
//! colors, sigils, and scale so "my fleet" has a visual signature.
//!
//! - **Hull / silhouette** = hash of the agent CODENAME (the role / last segment,
//!   e.g. `code-reviewer`, `spark`, `qa`) → one of 8 stable [`HullShape`]s. Codename
//!   letter-metrics (length / vowels / consonants) add masts & deck structures on
//!   top, so the silhouette is a pure function of the codename — never the fleet.
//! - **Livery / drift** = hash of the FLEET PREFIX (e.g. `port-daddy`,
//!   `curiositech`) → primary/accent/trim color (4-color Swiss palette), one of 8
//!   geometric [`SigilKind`]s, and a scale drift ∈ {1,2,3}.
//!
//! Constrained signature space (stolen from `docs/shipwright/SHIP-GRAMMAR.md`):
//! 4 primary × ~3 accent × ~3 trim × 8 sigils × 3 scale drifts ≈ **864**
//! distinguishable fleet signatures, using coprime multipliers (37 for the sigil,
//! 13/7 for the trim stripe) so the axes vary independently. Hashing is FNV-1a —
//! stable and portable, never `std`'s default hasher (which is not portable and
//! would make the same identity draw a different boat on a different machine).
//!
//! The pure core ([`build_ship`] and the plain-data types) has NO gpui dependency
//! so it compiles into the headless REPL bin + the Linux CI gate and its
//! determinism invariants run in CI. The GPUI renderer (paths / quads, an inline
//! [`AgentChip`], and a gallery element) sits behind the `gpui` feature.

#![allow(dead_code)] // Public renderer API; not every fn is wired into a pane yet.

// ─────────────────────────────────────────────────────────────────────────────
// Pure core — no gpui, always compiled (so tests run on the Linux gate).
// ─────────────────────────────────────────────────────────────────────────────

/// The 4-color Swiss signature palette, tokenized from
/// `docs/shipwright/SHIP-GRAMMAR.md` (and the website's `tokens.css`). Livery
/// draws primary/accent/trim from these four so a fleet reads at a glance without
/// the "accent sprawl" rainbow failure mode. Packed `0xRRGGBB`.
pub const PALETTE: [u32; 4] = [
    0xbf_2f_2f, // 0 · Signal Red
    0x00_55_ff, // 1 · Cobalt Blue
    0xdf_ff_00, // 2 · Cyber Yellow
    0x12_12_12, // 3 · Obsidian Black
];

/// Neutral warm off-white for the base hull. The hull is always neutral so drift
/// colors read as *livery*, not camouflage — the same reason navy ships are gray.
pub const HULL_NEUTRAL: u32 = 0xcf_c9_bb;

/// FNV-1a, 32-bit. Deterministic and portable across machines/runs (unlike
/// `std::hash::DefaultHasher`, whose output is intentionally unstable). Same
/// bytes → same hash, everywhere, forever — the whole grammar rests on this.
pub fn fnv1a_32(bytes: &[u8]) -> u32 {
    const OFFSET: u32 = 0x811c_9dc5;
    const PRIME: u32 = 0x0100_0193;
    let mut h = OFFSET;
    for &b in bytes {
        h ^= b as u32;
        h = h.wrapping_mul(PRIME);
    }
    h
}

/// The 8 stable hull silhouettes. A codename hashes to exactly one; it is the
/// coarse "class of vessel" the eye latches onto first. Named after the seven
/// `docs/shipwright/AGENT-MODEL.md` archetypes (plus a balanced `Sloop`) purely
/// for flavor — the mapping is hash-based, not semantic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HullShape {
    /// bookkeeping-skiff — low, flat, unglamorous state-keeper.
    Skiff,
    /// scheduled-cutter — sharp raked bow, punctual.
    Cutter,
    /// reactive-interceptor — long, low, pointed both ends; fast.
    Interceptor,
    /// daemon-lighthouse — a tower rising amidships; always-on, no body.
    Lighthouse,
    /// shipwright-flagship — tall, multi-deck, the biggest silhouette.
    Flagship,
    /// human-dinghy — tiny rowboat; a person on the Plane.
    Dinghy,
    /// salvaged-wreck — broken, listing deck line.
    Wreck,
    /// a balanced mid-size sloop (the "none of the above" hull).
    Sloop,
}

impl HullShape {
    pub const ALL: [HullShape; 8] = [
        HullShape::Skiff,
        HullShape::Cutter,
        HullShape::Interceptor,
        HullShape::Lighthouse,
        HullShape::Flagship,
        HullShape::Dinghy,
        HullShape::Wreck,
        HullShape::Sloop,
    ];

    pub fn index(self) -> u8 {
        HullShape::ALL.iter().position(|&h| h == self).unwrap() as u8
    }

    fn from_hash(h: u32) -> Self {
        HullShape::ALL[(h % 8) as usize]
    }

    /// Short label for the gallery / accessibility.
    pub fn label(self) -> &'static str {
        match self {
            HullShape::Skiff => "skiff",
            HullShape::Cutter => "cutter",
            HullShape::Interceptor => "interceptor",
            HullShape::Lighthouse => "lighthouse",
            HullShape::Flagship => "flagship",
            HullShape::Dinghy => "dinghy",
            HullShape::Wreck => "wreck",
            HullShape::Sloop => "sloop",
        }
    }
}

/// The 8 geometric sigils stamped on the mainsail. Geometric marks only — never
/// emoji, never letters — so they read at ~16px, same discipline as maritime
/// signal flags.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SigilKind {
    Chevron,
    Bar,
    Cross,
    Ring,
    DotPair,
    Triangle,
    Slash,
    DoubleStripe,
}

impl SigilKind {
    pub const ALL: [SigilKind; 8] = [
        SigilKind::Chevron,
        SigilKind::Bar,
        SigilKind::Cross,
        SigilKind::Ring,
        SigilKind::DotPair,
        SigilKind::Triangle,
        SigilKind::Slash,
        SigilKind::DoubleStripe,
    ];

    fn from_hash(h: u32) -> Self {
        // 37 is coprime to both 4 (palette) and 3 (scale), so the sigil varies
        // independently of primary color and scale drift.
        SigilKind::ALL[(h.wrapping_mul(37) % 8) as usize]
    }

    pub fn label(self) -> &'static str {
        match self {
            SigilKind::Chevron => "chevron",
            SigilKind::Bar => "bar",
            SigilKind::Cross => "cross",
            SigilKind::Ring => "ring",
            SigilKind::DotPair => "dot-pair",
            SigilKind::Triangle => "triangle",
            SigilKind::Slash => "slash",
            SigilKind::DoubleStripe => "double-stripe",
        }
    }
}

/// Runtime state — applied as a *material swap / overlay* at render time, never a
/// new hull shape. A `slashed` spark is still a spark; only its paint changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ShipState {
    /// At anchor: an anchor mark, no wake.
    Docked,
    /// Coming alive: sail raised to half.
    Activating,
    /// Working: running lights + a wake trailing astern.
    Underway,
    /// Rate-limited: an amber pennant at the masthead + amber tint.
    Throttled,
    /// Operator focus: an emissive bright ring around the vessel.
    Selected,
    /// Mayday: a red distress flare above the mast + red tint.
    Distress,
    /// Bond slashed: hull lists to port + a red stripe; motion frozen.
    Slashed,
    /// Proposed / not-yet-real: a dry-dock wireframe outline, no fill.
    Ghost,
}

impl ShipState {
    pub const ALL: [ShipState; 8] = [
        ShipState::Docked,
        ShipState::Activating,
        ShipState::Underway,
        ShipState::Throttled,
        ShipState::Selected,
        ShipState::Distress,
        ShipState::Slashed,
        ShipState::Ghost,
    ];

    pub fn label(self) -> &'static str {
        match self {
            ShipState::Docked => "docked",
            ShipState::Activating => "activating",
            ShipState::Underway => "underway",
            ShipState::Throttled => "throttled",
            ShipState::Selected => "selected",
            ShipState::Distress => "distress",
            ShipState::Slashed => "slashed",
            ShipState::Ghost => "ghost",
        }
    }
}

/// Codename-derived letter metrics — the numbers behind the silhouette. Because
/// they depend only on the codename, they are identical across fleets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShipMetrics {
    /// Codename length (hyphens stripped).
    pub l_a: u32,
    /// Vowel count (`y` counts only after a consonant).
    pub v_a: u32,
    /// Consonant count (`l_a - v_a`).
    pub c_a: u32,
    /// FNV-1a of the codename (drives [`HullShape`]).
    pub h_hull: u32,
    /// FNV-1a of the fleet prefix (drives livery).
    pub h_fleet: u32,
}

/// Fleet-derived drift — the livery. Every field is a function of the fleet hash
/// (accent/trim also fold in codename length so short and long names within one
/// fleet still separate). Colors are packed `0xRRGGBB`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Livery {
    pub color_primary: u32,
    pub color_accent: u32,
    pub color_trim: u32,
    pub sigil: SigilKind,
    /// Height/scale multiplier ∈ {1,2,3}.
    pub scale_drift: u8,
}

/// The full plan for one agent's boat — pure plain data. Same identity → a
/// deep-equal `ShipPlan`, on any machine (verified by test).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShipPlan {
    pub identity: String,
    pub fleet: String,
    pub codename: String,
    pub hull: HullShape,
    pub metrics: ShipMetrics,
    pub livery: Livery,
    /// Masts / sails: `min(v_a, 3)` — vowels are the open sounds, so vowel-rich
    /// names carry more canvas. Always ≥1 for a name with any vowel.
    pub masts: u8,
    /// Deck structures (cabins/stacks): `min(c_a, 4)` — hard consonant sounds get
    /// more superstructure. Capped so a long name doesn't porcupine.
    pub deck_structures: u8,
    /// Relative hull length in grammar units (clamped `l_a`), drives aspect.
    pub hull_units: u8,
}

impl ShipPlan {
    /// The silhouette fingerprint — everything that must stay constant across
    /// fleets. Two boats with the same signature are the same *role*, whatever
    /// livery they wear. Used by the distinctness test.
    pub fn silhouette_signature(&self) -> (u8, u32, u32, u32, u8, u8, u8) {
        (
            self.hull.index(),
            self.metrics.l_a,
            self.metrics.v_a,
            self.metrics.c_a,
            self.masts,
            self.deck_structures,
            self.hull_units,
        )
    }
}

/// Split an identity into `(fleet_prefix, codename)`.
///
/// Total and lenient by design — [`build_ship`] never panics on a weird string
/// (it is called on live daemon identities of several shapes):
/// - `<fleet>:fleet:<agent>` → `(fleet, agent)` (the canonical Shipwright form)
/// - `<project>:<stack>:<context>` → `(project, context)` (a pd session identity)
/// - `<fleet>:<agent>` → `(fleet, agent)`
/// - `spark` (no colon) → `(spark, spark)` — a bare codename is its own fleet.
///
/// The fleet is the FIRST non-empty segment; the codename is the LAST non-empty
/// segment, with a literal `fleet` segment skipped so `a:fleet:b` yields `b`.
pub fn parse_identity(identity: &str) -> (String, String) {
    let segs: Vec<&str> = identity
        .split(':')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    match segs.as_slice() {
        [] => (identity.to_string(), identity.to_string()),
        [only] => (only.to_string(), only.to_string()),
        _ => {
            let fleet = segs[0].to_string();
            // Prefer the last segment; if it is the literal separator word
            // `fleet` (malformed `a:fleet`), fall back to the previous one.
            let last = *segs.last().unwrap();
            let codename = if last.eq_ignore_ascii_case("fleet") && segs.len() >= 2 {
                segs[segs.len() - 2].to_string()
            } else {
                last.to_string()
            };
            (fleet, codename)
        }
    }
}

/// Count vowels in a codename. `y` is a vowel only when it follows a consonant
/// (`sentry` → e,y = 2; `yak` → a = 1) — matches native-English intuition and
/// keeps the mast count feeling right for the codenames we expect.
pub fn count_vowels(name: &str) -> u32 {
    let s: Vec<char> = name
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    let is_vowel = |c: char| matches!(c, 'a' | 'e' | 'i' | 'o' | 'u');
    let mut v = 0u32;
    for (i, &c) in s.iter().enumerate() {
        if is_vowel(c) {
            v += 1;
        } else if c == 'y' {
            let prev_is_consonant = i > 0 && !is_vowel(s[i - 1]) && s[i - 1] != 'y';
            if prev_is_consonant {
                v += 1;
            }
        }
    }
    v
}

/// Build a boat plan from a canonical (or near-canonical) identity. PURE — same
/// input, deep-equal output, every time, everywhere. See the module tests for the
/// invariants (determinism, hull-constant-across-fleets, livery-varies).
pub fn build_ship(identity: &str) -> ShipPlan {
    let (fleet, codename) = parse_identity(identity);

    // ── Agent axis (silhouette) — codename only ─────────────────────────────
    let letters: String = codename
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_ascii_lowercase();
    let l_a = letters.chars().count().max(1) as u32;
    let v_a = count_vowels(&codename);
    let c_a = l_a.saturating_sub(v_a);
    let h_hull = fnv1a_32(letters.as_bytes());
    let hull = HullShape::from_hash(h_hull);
    let masts = v_a.clamp(1, 3) as u8;
    let deck_structures = c_a.min(4) as u8;
    let hull_units = l_a.clamp(2, 14) as u8;

    // ── Fleet axis (livery) — fleet prefix (+ codename length for color) ─────
    let fleet_key = fleet.to_ascii_lowercase();
    let h_fleet = fnv1a_32(fleet_key.as_bytes());
    let primary_idx = (h_fleet % 4) as usize;
    let color_primary = PALETTE[primary_idx];
    // Collision dodge: an accent equal to the primary vanishes into the hull, so
    // rotate +1. 13 & 7 are coprime to 4 → trim shifts independently.
    let mut accent_idx = ((h_fleet.wrapping_add(l_a)) % 4) as usize;
    if accent_idx == primary_idx {
        accent_idx = (accent_idx + 1) % 4;
    }
    let color_accent = PALETTE[accent_idx];
    let mut trim_idx = ((h_fleet.wrapping_mul(13).wrapping_add(l_a.wrapping_mul(7))) % 4) as usize;
    if trim_idx == primary_idx {
        trim_idx = (trim_idx + 1) % 4;
    }
    let color_trim = PALETTE[trim_idx];
    let scale_drift = ((h_fleet % 3) + 1) as u8;
    let sigil = SigilKind::from_hash(h_fleet);

    ShipPlan {
        identity: identity.to_string(),
        fleet,
        codename,
        hull,
        metrics: ShipMetrics { l_a, v_a, c_a, h_hull, h_fleet },
        livery: Livery { color_primary, color_accent, color_trim, sigil, scale_drift },
        masts,
        deck_structures,
        hull_units,
    }
}

/// A resolved paint recipe for one `(plan, state)` — the material swap the
/// renderer applies over the constant silhouette. Colors are packed `0xRRGGBB`;
/// the boolean overlays are additive marks the renderer draws on top.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StateStyle {
    /// Hull fill (already blended for tints; ghost is drawn stroke-only).
    pub hull_fill: u32,
    /// Deck / superstructure fill.
    pub deck_fill: u32,
    /// Sail fill.
    pub sail_fill: u32,
    /// Outline / stroke color.
    pub stroke: u32,
    /// Draw only strokes (dry-dock wireframe) — no filled bodies.
    pub wireframe: bool,
    /// Anchor mark under the bow.
    pub anchor: bool,
    /// Sail is only half-raised (activating).
    pub half_sail: bool,
    /// Running lights (bow green / stern red) + a wake astern.
    pub wake: bool,
    /// Amber pennant at the masthead.
    pub pennant: bool,
    /// A bright emissive selection ring around the vessel.
    pub emissive_ring: bool,
    /// A red distress flare above the mast.
    pub flare: bool,
    /// Hull lists to port by this many normalized units (0 = level).
    pub list: f32,
    /// A red damage stripe across the hull.
    pub damage_stripe: bool,
    /// The renderer may animate (bob/pulse). False ⇒ snap (reduced motion or a
    /// frozen state like `Slashed`).
    pub animated: bool,
}

/// Blend `fg` over `bg` at alpha `a` (0..1) → an opaque `0xRRGGBB`. Used so every
/// tint/ghost effect paints as a solid color (no reliance on path alpha).
pub fn blend(fg: u32, bg: u32, a: f32) -> u32 {
    let a = a.clamp(0.0, 1.0);
    let ch = |shift: u32| -> u32 {
        let f = ((fg >> shift) & 0xff) as f32;
        let b = ((bg >> shift) & 0xff) as f32;
        (f * a + b * (1.0 - a)).round().clamp(0.0, 255.0) as u32
    };
    (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/// Resolve the overlay recipe for a state. `bg` is the surface background the
/// tints blend against; `reduced_motion` snaps animation off. The silhouette is
/// unchanged — only paint and additive marks vary.
pub fn state_style(plan: &ShipPlan, state: ShipState, bg: u32, reduced_motion: bool) -> StateStyle {
    let lv = &plan.livery;
    let red = PALETTE[0];
    let amber = 0xf2_be_51;
    let base = StateStyle {
        hull_fill: HULL_NEUTRAL,
        deck_fill: lv.color_primary,
        sail_fill: blend(HULL_NEUTRAL, bg, 0.92),
        stroke: PALETTE[3],
        wireframe: false,
        anchor: false,
        half_sail: false,
        wake: false,
        pennant: false,
        emissive_ring: false,
        flare: false,
        list: 0.0,
        damage_stripe: false,
        animated: !reduced_motion,
    };
    match state {
        ShipState::Docked => StateStyle {
            anchor: true,
            animated: false,
            ..base
        },
        ShipState::Activating => StateStyle {
            half_sail: true,
            ..base
        },
        ShipState::Underway => StateStyle {
            wake: true,
            ..base
        },
        ShipState::Throttled => StateStyle {
            pennant: true,
            deck_fill: blend(amber, lv.color_primary, 0.5),
            sail_fill: blend(amber, base.sail_fill, 0.28),
            ..base
        },
        ShipState::Selected => StateStyle {
            emissive_ring: true,
            deck_fill: blend(0xff_ff_ff, lv.color_primary, 0.22),
            ..base
        },
        ShipState::Distress => StateStyle {
            flare: true,
            hull_fill: blend(red, HULL_NEUTRAL, 0.30),
            deck_fill: blend(red, lv.color_primary, 0.45),
            stroke: red,
            animated: !reduced_motion,
            ..base
        },
        ShipState::Slashed => StateStyle {
            damage_stripe: true,
            list: 0.14,
            hull_fill: blend(red, HULL_NEUTRAL, 0.18),
            stroke: red,
            animated: false,
            ..base
        },
        ShipState::Ghost => StateStyle {
            wireframe: true,
            hull_fill: bg,
            deck_fill: bg,
            sail_fill: bg,
            stroke: blend(HULL_NEUTRAL, bg, 0.55),
            animated: false,
            ..base
        },
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry — normalized unit-space silhouette (shared by any renderer).
// x: 0 (stern/left) .. 1 (bow/right); y: 0 (top) .. 1 (bottom of waterline box).
// ─────────────────────────────────────────────────────────────────────────────

/// Waterline height in unit space (hull sits above; wake below).
pub const WATERLINE: f32 = 0.70;

/// The hull outline as a closed polygon in unit space, per shape. Deck line runs
/// bow→stern along the top; the hull belly returns underneath to the waterline.
/// `scale_drift` gently raises the deck (a drift-3 fleet rides taller).
pub fn hull_polygon(shape: HullShape, scale_drift: u8) -> Vec<(f32, f32)> {
    // deck_y: top of the hull; lower value = taller freeboard.
    let lift = (scale_drift as f32 - 1.0) * 0.03; // 0, 0.03, 0.06
    let d = 0.52 - lift; // deck line
    let w = WATERLINE; // hull bottom meets water
    match shape {
        // Low flat workboat.
        HullShape::Skiff => vec![
            (0.10, d + 0.02),
            (0.90, d + 0.02),
            (0.86, w),
            (0.14, w),
        ],
        // Sharp raked bow, fine entry.
        HullShape::Cutter => vec![
            (0.08, d),
            (0.82, d - 0.04),
            (0.96, d + 0.06),
            (0.80, w),
            (0.16, w),
        ],
        // Long, low, pointed both ends.
        HullShape::Interceptor => vec![
            (0.04, d + 0.06),
            (0.30, d - 0.01),
            (0.72, d - 0.01),
            (0.98, d + 0.06),
            (0.88, w - 0.02),
            (0.12, w - 0.02),
        ],
        // Tower amidships handled by deck structures; hull is a stout base.
        HullShape::Lighthouse => vec![
            (0.16, d + 0.03),
            (0.84, d + 0.03),
            (0.80, w),
            (0.20, w),
        ],
        // Tall, multi-level, raised forecastle + quarterdeck.
        HullShape::Flagship => vec![
            (0.06, d - 0.02),
            (0.20, d - 0.10),
            (0.30, d - 0.02),
            (0.74, d - 0.02),
            (0.84, d - 0.10),
            (0.96, d - 0.02),
            (0.86, w),
            (0.14, w),
        ],
        // Tiny shallow rowboat.
        HullShape::Dinghy => vec![
            (0.24, d + 0.10),
            (0.76, d + 0.10),
            (0.66, w - 0.04),
            (0.34, w - 0.04),
        ],
        // Broken, jagged, listing deck.
        HullShape::Wreck => vec![
            (0.10, d + 0.14),
            (0.34, d + 0.05),
            (0.48, d + 0.12),
            (0.64, d + 0.03),
            (0.92, d + 0.10),
            (0.82, w),
            (0.18, w),
        ],
        // Balanced mid-size.
        HullShape::Sloop => vec![
            (0.10, d + 0.01),
            (0.86, d - 0.02),
            (0.94, d + 0.05),
            (0.82, w),
            (0.16, w),
        ],
    }
}

/// Where the deck sits (top y of the hull, before masts) — the base of every mast.
pub fn deck_y(shape: HullShape, scale_drift: u8) -> f32 {
    let lift = (scale_drift as f32 - 1.0) * 0.03;
    match shape {
        HullShape::Dinghy => 0.62 - lift,
        HullShape::Wreck => 0.62 - lift,
        HullShape::Skiff => 0.54 - lift,
        _ => 0.52 - lift,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — pure, run on the Linux/REPL gate.
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv1a_is_stable_and_known() {
        // Pin the algorithm: FNV-1a/32 of "" and "a" are fixed constants. If
        // these change the whole grammar re-skins — that is a visual regression.
        assert_eq!(fnv1a_32(b""), 0x811c_9dc5);
        assert_eq!(fnv1a_32(b"a"), 0xe40c_292c);
        assert_eq!(fnv1a_32(b"foobar"), 0xbf9c_f968);
    }

    #[test]
    fn build_ship_is_pure_deep_equal() {
        let a = build_ship("port-daddy:fleet:spark");
        let b = build_ship("port-daddy:fleet:spark");
        assert_eq!(a, b, "same identity must produce a deep-equal ShipPlan");
    }

    #[test]
    fn vowel_counting_matches_english_intuition() {
        assert_eq!(count_vowels("spark"), 1); // a
        assert_eq!(count_vowels("sentry"), 2); // e, y-after-t
        assert_eq!(count_vowels("yak"), 1); // leading y is a consonant
        assert_eq!(count_vowels("qa"), 1); // a
        assert_eq!(count_vowels("code-reviewer"), 6); // o,e,e,i,e,e
    }

    #[test]
    fn hull_is_constant_across_fleets() {
        // The whole point: a spark looks like a spark in every fleet. The
        // silhouette signature (hull + letter metrics + masts/decks) must match.
        for codename in ["spark", "code-reviewer", "qa", "cartographer"] {
            let a = build_ship(&format!("port-daddy:fleet:{codename}"));
            let b = build_ship(&format!("curiositech:fleet:{codename}"));
            let c = build_ship(&format!("windags:fleet:{codename}"));
            assert_eq!(a.hull, b.hull, "{codename}: hull drifted across fleets");
            assert_eq!(a.hull, c.hull, "{codename}: hull drifted across fleets");
            assert_eq!(
                a.silhouette_signature(),
                b.silhouette_signature(),
                "{codename}: silhouette drifted a→b"
            );
            assert_eq!(
                a.silhouette_signature(),
                c.silhouette_signature(),
                "{codename}: silhouette drifted a→c"
            );
        }
    }

    #[test]
    fn livery_varies_across_fleets() {
        // Same role, different house: at least one livery axis must differ, or a
        // fleet has no visual signature.
        let a = build_ship("port-daddy:fleet:spark").livery;
        let b = build_ship("curiositech:fleet:spark").livery;
        let differs = a.color_primary != b.color_primary
            || a.color_accent != b.color_accent
            || a.color_trim != b.color_trim
            || a.sigil != b.sigil
            || a.scale_drift != b.scale_drift;
        assert!(differs, "port-daddy and curiositech sparks wear identical livery");
    }

    #[test]
    fn signatures_are_distinct_across_roles() {
        // Eight distinct roles in one fleet must yield eight distinct silhouettes,
        // so a fleet roster is legible at a glance.
        let roles = [
            "spark",
            "qa",
            "scout",
            "sentry",
            "gardener",
            "cartographer",
            "sweeper",
            "code-reviewer",
        ];
        let mut seen = std::collections::HashSet::new();
        for r in roles {
            let sig = build_ship(&format!("port-daddy:fleet:{r}")).silhouette_signature();
            assert!(seen.insert(sig), "role '{r}' collides with an earlier silhouette: {sig:?}");
        }
        assert_eq!(seen.len(), roles.len());
    }

    #[test]
    fn all_eight_hulls_are_reachable() {
        // Sanity: the hash spreads across all 8 hull buckets for realistic names,
        // so the gallery's "8 role hulls" panel is populated by real codenames.
        let names = [
            "spark", "qa", "scout", "sentry", "gardener", "cartographer", "sweeper",
            "code-reviewer", "hawk", "scribe", "nomad", "sentinel", "spider", "gremlin",
            "tugboat", "pilot", "beacon", "raven", "otter", "marlin", "wren", "kestrel",
        ];
        let mut buckets = std::collections::HashSet::new();
        for n in names {
            buckets.insert(build_ship(&format!("pd:fleet:{n}")).hull);
        }
        assert_eq!(buckets.len(), 8, "not all 8 hull shapes reachable from a realistic name set");
    }

    #[test]
    fn parse_identity_handles_every_shape() {
        assert_eq!(parse_identity("port-daddy:fleet:spark"), ("port-daddy".into(), "spark".into()));
        assert_eq!(parse_identity("port-daddy:console:operator"), ("port-daddy".into(), "operator".into()));
        assert_eq!(parse_identity("curiositech:hawk"), ("curiositech".into(), "hawk".into()));
        assert_eq!(parse_identity("spark"), ("spark".into(), "spark".into()));
        assert_eq!(parse_identity("a:fleet"), ("a".into(), "a".into()));
        // Never panics on junk.
        let _ = build_ship("");
        let _ = build_ship(":::");
    }

    #[test]
    fn state_style_selects_the_right_overlay() {
        let plan = build_ship("port-daddy:fleet:spark");
        let bg = 0x101216;
        assert!(state_style(&plan, ShipState::Docked, bg, false).anchor);
        assert!(state_style(&plan, ShipState::Activating, bg, false).half_sail);
        assert!(state_style(&plan, ShipState::Underway, bg, false).wake);
        assert!(state_style(&plan, ShipState::Throttled, bg, false).pennant);
        assert!(state_style(&plan, ShipState::Selected, bg, false).emissive_ring);
        assert!(state_style(&plan, ShipState::Distress, bg, false).flare);
        let slashed = state_style(&plan, ShipState::Slashed, bg, false);
        assert!(slashed.damage_stripe && slashed.list > 0.0 && !slashed.animated);
        assert!(state_style(&plan, ShipState::Ghost, bg, false).wireframe);
        // Reduced motion snaps animation off even for an underway boat.
        assert!(!state_style(&plan, ShipState::Underway, bg, true).animated);
    }

    #[test]
    fn hull_polygon_is_a_closed_ring_for_every_shape() {
        for shape in HullShape::ALL {
            let poly = hull_polygon(shape, 2);
            assert!(poly.len() >= 3, "{:?} hull is not a polygon", shape);
            for (x, y) in &poly {
                assert!((0.0..=1.0).contains(x), "{shape:?} x out of unit range: {x}");
                assert!((0.0..=1.0).contains(y), "{shape:?} y out of unit range: {y}");
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GPUI renderer — behind the `gpui` feature (Metal-native window only).
// ─────────────────────────────────────────────────────────────────────────────
#[cfg(feature = "gpui")]
// `render_boat` / `agent_chip` / `BoatSize` are public API for callers that will
// drop boats/chips into other panes; only `ship_gallery` + `AgentChip` are wired
// so far, so the rest read as "unused" in this bin until then.
#[allow(unused_imports)]
pub use render::{agent_chip, render_boat, ship_gallery, AgentChip, BoatSize};

#[cfg(feature = "gpui")]
mod render {
    use super::*;
    use crate::app::ControlMsg;
    use crate::palette::Theme;
    use gpui::prelude::*;
    use gpui::*;
    use std::sync::mpsc;

    /// Two render sizes: `Chip` is the inline ~18px glyph for an [`AgentChip`];
    /// `Detail` is the large ~72px header vessel. Small draws minimum legible
    /// detail (hull + one sail + sigil); large draws the full rig.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum BoatSize {
        Chip,
        Detail,
    }

    impl BoatSize {
        fn px(self) -> (f32, f32) {
            match self {
                // Slightly wider than tall — boats are horizontal.
                BoatSize::Chip => (26.0, 20.0),
                BoatSize::Detail => (108.0, 84.0),
            }
        }
        fn is_small(self) -> bool {
            matches!(self, BoatSize::Chip)
        }
    }

    /// Paint a closed polygon (unit-space points mapped into `bounds`) as a solid
    /// fill. `list` shears the top of the shape left to imply a port list.
    #[allow(clippy::too_many_arguments)]
    fn fill_poly(
        window: &mut Window,
        ox: f32,
        oy: f32,
        bw: f32,
        bh: f32,
        pts: &[(f32, f32)],
        list: f32,
        color: u32,
    ) {
        if pts.len() < 3 {
            return;
        }
        let map = |(ux, uy): (f32, f32)| {
            // Shear: higher points (smaller uy) shift further to port (−x).
            let shear = list * (1.0 - uy) * bw;
            point(px(ox + ux * bw - shear), px(oy + uy * bh))
        };
        let mut pb = PathBuilder::fill();
        pb.move_to(map(pts[0]));
        for &p in &pts[1..] {
            pb.line_to(map(p));
        }
        pb.close();
        if let Ok(path) = pb.build() {
            window.paint_path(path, rgb(color));
        }
    }

    /// Paint a stroked polyline as a thin quad chain (gpui has no stroke path, so
    /// we fill a small-width ribbon between successive points).
    fn stroke_seg(
        window: &mut Window,
        a: Point<Pixels>,
        b: Point<Pixels>,
        width: f32,
        color: u32,
    ) {
        let ax = f32::from(a.x);
        let ay = f32::from(a.y);
        let bx = f32::from(b.x);
        let by = f32::from(b.y);
        let dx = bx - ax;
        let dy = by - ay;
        let len = (dx * dx + dy * dy).sqrt().max(0.0001);
        // Perpendicular unit × half width.
        let (nx, ny) = (-dy / len * width * 0.5, dx / len * width * 0.5);
        let mut pb = PathBuilder::fill();
        pb.move_to(point(px(ax + nx), px(ay + ny)));
        pb.line_to(point(px(bx + nx), px(by + ny)));
        pb.line_to(point(px(bx - nx), px(by - ny)));
        pb.line_to(point(px(ax - nx), px(ay - ny)));
        pb.close();
        if let Ok(path) = pb.build() {
            window.paint_path(path, rgb(color));
        }
    }

    fn dot(window: &mut Window, cx: f32, cy: f32, r: f32, color: u32) {
        // Approximate a disc with an octagon — cheap and legible at small size.
        let mut pb = PathBuilder::fill();
        let n = 8;
        for i in 0..n {
            let a = std::f32::consts::TAU * (i as f32) / (n as f32);
            let p = point(px(cx + r * a.cos()), px(cy + r * a.sin()));
            if i == 0 {
                pb.move_to(p);
            } else {
                pb.line_to(p);
            }
        }
        pb.close();
        if let Ok(path) = pb.build() {
            window.paint_path(path, rgb(color));
        }
    }

    /// The full boat as a `canvas` element sized to `size`. All geometry is
    /// computed from `bounds` so it scales cleanly at any px. `bg` is the surface
    /// color tints blend against.
    pub fn render_boat(
        plan: &ShipPlan,
        state: ShipState,
        size: BoatSize,
        bg: u32,
        reduced_motion: bool,
    ) -> impl IntoElement {
        let (w, h) = size.px();
        let plan = plan.clone();
        let style = state_style(&plan, state, bg, reduced_motion);
        let small = size.is_small();
        let animated = style.animated && !reduced_motion;
        let anim_id = plan.identity.clone();

        let boat = canvas(
            |_bounds, _window, _cx| (),
            move |bounds, _prepaint, window, _cx| {
                let ox = f32::from(bounds.origin.x);
                let oy = f32::from(bounds.origin.y);
                let bw = f32::from(bounds.size.width);
                let bh = f32::from(bounds.size.height);
                let sd = plan.livery.scale_drift;
                let stroke_w = if small { 1.0 } else { 1.6 };

                // Selection ring behind the vessel (bright emissive halo).
                if style.emissive_ring {
                    let ring = [
                        (0.02, 0.10),
                        (0.98, 0.10),
                        (0.98, WATERLINE + 0.14),
                        (0.02, WATERLINE + 0.14),
                    ];
                    let glow = blend(0xff_ff_ff, plan.livery.color_primary, 0.35);
                    // Two nested outlines = a soft ring without a blur pass.
                    for inset in [0.0f32, 0.03] {
                        let r: Vec<(f32, f32)> = ring
                            .iter()
                            .map(|&(x, y)| {
                                (x + inset * if x < 0.5 { 1.0 } else { -1.0 }, y + inset)
                            })
                            .collect();
                        let pts: Vec<Point<Pixels>> = r
                            .iter()
                            .map(|&(ux, uy)| point(px(ox + ux * bw), px(oy + uy * bh)))
                            .collect();
                        for i in 0..pts.len() {
                            stroke_seg(window, pts[i], pts[(i + 1) % pts.len()], stroke_w, glow);
                        }
                    }
                }

                // Waterline (a faint band) + wake if underway.
                let wl_y = oy + WATERLINE * bh;
                if !style.wireframe {
                    let wline = blend(plan.livery.color_accent, bg, 0.22);
                    stroke_seg(
                        window,
                        point(px(ox + 0.02 * bw), px(wl_y)),
                        point(px(ox + 0.98 * bw), px(wl_y)),
                        stroke_w * 0.8,
                        wline,
                    );
                }
                if style.wake {
                    let wake = blend(0xff_ff_ff, bg, 0.5);
                    for k in 0..3 {
                        let x0 = ox + (0.06 + k as f32 * 0.05) * bw;
                        stroke_seg(
                            window,
                            point(px(x0), px(wl_y + 0.04 * bh)),
                            point(px(x0 + 0.05 * bw), px(wl_y + 0.09 * bh)),
                            stroke_w,
                            wake,
                        );
                    }
                    // Running lights: green to starboard (bow), red to port (stern).
                    dot(window, ox + 0.9 * bw, oy + 0.5 * bh, stroke_w * 1.3, 0x35_d0_7a);
                    dot(window, ox + 0.12 * bw, oy + 0.5 * bh, stroke_w * 1.3, 0xff_5a_5a);
                }

                // Hull.
                let poly = hull_polygon(plan.hull, sd);
                if style.wireframe {
                    let pts: Vec<Point<Pixels>> = poly
                        .iter()
                        .map(|&(ux, uy)| {
                            let shear = style.list * (1.0 - uy) * bw;
                            point(px(ox + ux * bw - shear), px(oy + uy * bh))
                        })
                        .collect();
                    for i in 0..pts.len() {
                        stroke_seg(window, pts[i], pts[(i + 1) % pts.len()], stroke_w, style.stroke);
                    }
                } else {
                    fill_poly(window, ox, oy, bw, bh, &poly, style.list, style.hull_fill);
                    // Trim stripe along the deck line.
                    let dy = deck_y(plan.hull, sd);
                    let shear = style.list * (1.0 - dy) * bw;
                    stroke_seg(
                        window,
                        point(px(ox + 0.12 * bw - shear), px(oy + dy * bh + 0.02 * bh)),
                        point(px(ox + 0.9 * bw - shear), px(oy + dy * bh + 0.02 * bh)),
                        stroke_w,
                        plan.livery.color_trim,
                    );
                }

                // Deck structures / superstructure (skip on the tiniest chips
                // except a single cabin, to keep the glyph legible).
                let dyb = deck_y(plan.hull, sd);
                let cabins = if small { plan.deck_structures.min(2) } else { plan.deck_structures };
                if !style.wireframe && cabins > 0 {
                    let is_tower = matches!(plan.hull, HullShape::Lighthouse);
                    let count = cabins.max(1);
                    let span = 0.42f32;
                    let start = 0.30f32;
                    for i in 0..count {
                        let frac = if count == 1 { 0.5 } else { i as f32 / (count - 1) as f32 };
                        let cx0 = start + frac * span;
                        let ch = if is_tower { 0.30 } else { 0.10 + 0.03 * (sd as f32 - 1.0) };
                        let cw = if is_tower { 0.10 } else { 0.06 };
                        let cab = [
                            (cx0 - cw, dyb),
                            (cx0 + cw, dyb),
                            (cx0 + cw, dyb - ch),
                            (cx0 - cw, dyb - ch),
                        ];
                        fill_poly(window, ox, oy, bw, bh, &cab, style.list, style.deck_fill);
                        if is_tower {
                            // Lighthouse lantern room: an accent cap.
                            let cap = [
                                (cx0 - cw, dyb - ch),
                                (cx0 + cw, dyb - ch),
                                (cx0 + cw, dyb - ch - 0.05),
                                (cx0 - cw, dyb - ch - 0.05),
                            ];
                            fill_poly(window, ox, oy, bw, bh, &cap, style.list, plan.livery.color_accent);
                        }
                    }
                }

                // Masts + sails.
                if !matches!(plan.hull, HullShape::Lighthouse) {
                    let masts = plan.masts.max(1);
                    let mast_top = 0.14 - (sd as f32 - 1.0) * 0.02;
                    let sail_bottom = dyb - 0.02;
                    let sail_top = if style.half_sail {
                        mast_top + (sail_bottom - mast_top) * 0.5
                    } else {
                        mast_top
                    };
                    // Mainmast centered; extra masts fore/aft.
                    let xs: Vec<f32> = match masts {
                        1 => vec![0.52],
                        2 => vec![0.40, 0.64],
                        _ => vec![0.34, 0.52, 0.70],
                    };
                    for (mi, &mx) in xs.iter().enumerate() {
                        let shear_top = style.list * (1.0 - sail_top) * bw;
                        let shear_base = style.list * (1.0 - sail_bottom) * bw;
                        // Mast pole.
                        stroke_seg(
                            window,
                            point(px(ox + mx * bw - shear_base), px(oy + sail_bottom * bh)),
                            point(px(ox + mx * bw - shear_top), px(oy + sail_top * bh)),
                            stroke_w,
                            style.stroke,
                        );
                        if style.wireframe {
                            continue;
                        }
                        // Triangular sail on the mainmast (and others when large).
                        let draw_sail = mi == xs.len() / 2 || !small;
                        if draw_sail {
                            let sw = if small { 0.16 } else { 0.14 };
                            let sail = [
                                (mx, sail_top),
                                (mx + sw, sail_bottom),
                                (mx, sail_bottom),
                            ];
                            fill_poly(window, ox, oy, bw, bh, &sail, style.list, style.sail_fill);
                            // Sigil on the mainsail (largest sail).
                            if mi == xs.len() / 2 {
                                draw_sigil(
                                    window,
                                    ox + (mx + sw * 0.42) * bw - shear_top,
                                    oy + (sail_top + sail_bottom) * 0.5 * bh,
                                    (if small { 0.09 } else { 0.07 }) * bw,
                                    plan.livery.sigil,
                                    plan.livery.color_accent,
                                    stroke_w,
                                );
                            }
                        }
                    }
                    // Amber throttle pennant at the mainmast head.
                    if style.pennant {
                        let mx = 0.52;
                        let pen = [
                            (mx, mast_top),
                            (mx + 0.12, mast_top + 0.03),
                            (mx, mast_top + 0.06),
                        ];
                        fill_poly(window, ox, oy, bw, bh, &pen, style.list, 0xf2_be_51);
                    }
                    // Distress flare above the mast.
                    if style.flare {
                        let cxp = ox + 0.52 * bw;
                        let cyp = oy + (mast_top - 0.06) * bh;
                        dot(window, cxp, cyp, stroke_w * 1.6, PALETTE[0]);
                        for a in 0..6 {
                            let ang = std::f32::consts::TAU * a as f32 / 6.0;
                            stroke_seg(
                                window,
                                point(px(cxp), px(cyp)),
                                point(px(cxp + 0.05 * bw * ang.cos()), px(cyp + 0.05 * bh * ang.sin())),
                                stroke_w * 0.8,
                                PALETTE[0],
                            );
                        }
                    }
                }

                // Anchor under the bow (docked).
                if style.anchor && !style.wireframe {
                    let axc = ox + 0.86 * bw;
                    let ayc = oy + (WATERLINE + 0.06) * bh;
                    let ink = plan.livery.color_accent;
                    dot(window, axc, ayc - 0.05 * bh, stroke_w * 1.1, ink); // ring
                    stroke_seg(
                        window,
                        point(px(axc), px(ayc - 0.05 * bh)),
                        point(px(axc), px(ayc + 0.06 * bh)),
                        stroke_w,
                        ink,
                    ); // shank
                    stroke_seg(
                        window,
                        point(px(axc - 0.05 * bw), px(ayc + 0.03 * bh)),
                        point(px(axc + 0.05 * bw), px(ayc + 0.03 * bh)),
                        stroke_w,
                        ink,
                    ); // stock
                }

                // Damage stripe across a slashed hull.
                if style.damage_stripe {
                    stroke_seg(
                        window,
                        point(px(ox + 0.16 * bw), px(oy + 0.46 * bh)),
                        point(px(ox + 0.82 * bw), px(oy + (WATERLINE - 0.02) * bh)),
                        stroke_w * 1.6,
                        PALETTE[0],
                    );
                }
            },
        )
        .absolute()
        .size_full();

        let container = div().relative().w(px(w)).h(px(h)).child(boat);
        // Gentle bob for an underway/active boat (honors reduced motion via snap).
        if animated {
            container
                .with_animation(
                    SharedString::from(format!("boat-bob-{anim_id}")),
                    Animation::new(std::time::Duration::from_millis(2600))
                        .repeat()
                        .with_easing(ease_in_out),
                    |el, delta| el.top(px((delta - 0.5) * 2.4)),
                )
                .into_any_element()
        } else {
            container.into_any_element()
        }
    }

    fn ease_in_out(t: f32) -> f32 {
        // A smooth 0→1→0 is not needed; gpui repeats 0→1. Use a sine for a bob.
        (t * std::f32::consts::TAU).sin() * 0.5 + 0.5
    }

    /// Draw one of the 8 geometric sigils centered at `(cx, cy)` with radius `r`.
    /// Marks only — never letters/emoji — so they read at chip scale.
    fn draw_sigil(
        window: &mut Window,
        cx: f32,
        cy: f32,
        r: f32,
        sigil: SigilKind,
        color: u32,
        sw: f32,
    ) {
        let p = |x: f32, y: f32| point(px(x), px(y));
        match sigil {
            SigilKind::Chevron => {
                stroke_seg(window, p(cx - r, cy + r * 0.5), p(cx, cy - r * 0.5), sw, color);
                stroke_seg(window, p(cx, cy - r * 0.5), p(cx + r, cy + r * 0.5), sw, color);
            }
            SigilKind::Bar => {
                stroke_seg(window, p(cx - r, cy), p(cx + r, cy), sw * 1.4, color);
            }
            SigilKind::Cross => {
                stroke_seg(window, p(cx - r, cy), p(cx + r, cy), sw, color);
                stroke_seg(window, p(cx, cy - r), p(cx, cy + r), sw, color);
            }
            SigilKind::Ring => {
                let n = 10;
                let mut prev = p(cx + r, cy);
                for i in 1..=n {
                    let a = std::f32::consts::TAU * i as f32 / n as f32;
                    let cur = p(cx + r * a.cos(), cy + r * a.sin());
                    stroke_seg(window, prev, cur, sw, color);
                    prev = cur;
                }
            }
            SigilKind::DotPair => {
                dot(window, cx - r * 0.5, cy, sw * 1.2, color);
                dot(window, cx + r * 0.5, cy, sw * 1.2, color);
            }
            SigilKind::Triangle => {
                stroke_seg(window, p(cx, cy - r), p(cx + r, cy + r), sw, color);
                stroke_seg(window, p(cx + r, cy + r), p(cx - r, cy + r), sw, color);
                stroke_seg(window, p(cx - r, cy + r), p(cx, cy - r), sw, color);
            }
            SigilKind::Slash => {
                stroke_seg(window, p(cx - r, cy + r), p(cx + r, cy - r), sw * 1.3, color);
            }
            SigilKind::DoubleStripe => {
                stroke_seg(window, p(cx - r, cy - r * 0.4), p(cx + r, cy - r * 0.4), sw, color);
                stroke_seg(window, p(cx - r, cy + r * 0.4), p(cx + r, cy + r * 0.4), sw, color);
            }
        }
    }

    /// A tiny reusable inline element: a boat glyph + the agent name, clickable.
    /// Dropped anywhere an agent is named. Clicking emits
    /// [`ControlMsg::SelectAgent`] by identity over the supplied control channel —
    /// the one wiring point; it is deliberately NOT yet plugged into other panes.
    #[derive(IntoElement)]
    pub struct AgentChip {
        identity: String,
        state: ShipState,
        theme: Theme,
        reduced_motion: bool,
        tx: Option<mpsc::Sender<ControlMsg>>,
    }

    impl AgentChip {
        pub fn new(identity: impl Into<String>, theme: Theme) -> Self {
            Self {
                identity: identity.into(),
                state: ShipState::Underway,
                theme,
                reduced_motion: false,
                tx: None,
            }
        }
        pub fn state(mut self, state: ShipState) -> Self {
            self.state = state;
            self
        }
        pub fn reduced_motion(mut self, r: bool) -> Self {
            self.reduced_motion = r;
            self
        }
        /// Wire the click hook: on click, `ControlMsg::SelectAgent { identity }`
        /// is sent over this channel (the console's foreground→producer bus).
        pub fn on_select(mut self, tx: mpsc::Sender<ControlMsg>) -> Self {
            self.tx = Some(tx);
            self
        }
    }

    impl RenderOnce for AgentChip {
        fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
            let plan = build_ship(&self.identity);
            let t = self.theme;
            let boat = render_boat(&plan, self.state, BoatSize::Chip, t.panel, self.reduced_motion);
            let identity = self.identity.clone();
            let tx = self.tx.clone();
            div()
                .id(SharedString::from(format!("agent-chip-{}", self.identity)))
                .flex()
                .items_center()
                .gap(px(6.0))
                .px(px(6.0))
                .py(px(3.0))
                .rounded(px(6.0))
                .border_1()
                .border_color(rgb(t.line))
                .bg(rgb(t.raised))
                .cursor_pointer()
                .hover(|s| s.border_color(rgb(t.accent)).bg(rgb(t.panel)))
                .child(boat)
                .child(
                    div()
                        // 14px floor — never squint at an agent's name.
                        .text_size(px(14.0))
                        .text_color(rgb(t.ink))
                        .font_weight(FontWeight::MEDIUM)
                        .child(plan.codename.clone()),
                )
                .on_click(move |_ev, _window, _app| {
                    if let Some(tx) = &tx {
                        let _ = tx.send(ControlMsg::SelectAgent { identity: identity.clone() });
                    }
                })
        }
    }

    /// Convenience constructor mirroring the `render_block` free-fn style.
    pub fn agent_chip(identity: impl Into<String>, theme: Theme) -> AgentChip {
        AgentChip::new(identity, theme)
    }

    fn caption(text: impl Into<String>, color: u32) -> impl IntoElement {
        div()
            .text_size(px(13.0))
            .text_color(rgb(color))
            .font_weight(FontWeight::SEMIBOLD)
            .child(text.into())
    }

    fn section_title(text: impl Into<String>, t: &Theme) -> impl IntoElement {
        div()
            .text_size(px(15.0))
            .text_color(rgb(t.accent_ink))
            .font_weight(FontWeight::SEMIBOLD)
            .mt(px(14.0))
            .mb(px(6.0))
            .child(text.into())
    }

    /// A labeled boat card for the gallery (boat over a caption).
    fn boat_card(
        plan: &ShipPlan,
        state: ShipState,
        label: String,
        sub: String,
        t: &Theme,
        reduced: bool,
    ) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .items_center()
            .gap(px(4.0))
            .p(px(8.0))
            .rounded(px(8.0))
            .border_1()
            .border_color(rgb(t.line))
            .bg(rgb(t.raised))
            .child(render_boat(plan, state, BoatSize::Detail, t.raised, reduced))
            .child(caption(label, t.ink))
            .child(caption(sub, t.muted))
    }

    /// The demo/gallery: the 8 role hulls, one agent across 3 fleet liveries
    /// (hull-constant / livery-varies), and one boat in all 8 states. Verifiable
    /// only in a dev-build (GPUI can't be headless-captured).
    pub fn ship_gallery(
        theme: Theme,
        reduced_motion: bool,
        tx: Option<mpsc::Sender<ControlMsg>>,
    ) -> impl IntoElement {
        let t = theme;
        let reduced = reduced_motion;

        // Panel 1 — 8 role hulls (real codenames that spread across all 8 shapes).
        let role_names = [
            "spark", "qa", "sentinel", "cartographer", "gremlin", "tugboat", "beacon", "kestrel",
        ];
        let mut hulls_row = div().flex().flex_wrap().gap(px(10.0));
        for name in role_names {
            let plan = build_ship(&format!("port-daddy:fleet:{name}"));
            hulls_row = hulls_row.child(boat_card(
                &plan,
                ShipState::Underway,
                plan.codename.clone(),
                plan.hull.label().to_string(),
                &t,
                reduced,
            ));
        }

        // Panel 2 — same agent, three fleet liveries (hull constant, livery drifts).
        let fleets = ["port-daddy", "curiositech", "windags"];
        let mut livery_row = div().flex().flex_wrap().gap(px(10.0));
        for f in fleets {
            let plan = build_ship(&format!("{f}:fleet:spark"));
            livery_row = livery_row.child(boat_card(
                &plan,
                ShipState::Underway,
                f.to_string(),
                format!("sigil {}", plan.livery.sigil.label()),
                &t,
                reduced,
            ));
        }

        // Panel 3 — one boat in all 8 states.
        let state_plan = build_ship("port-daddy:fleet:spark");
        let mut states_row = div().flex().flex_wrap().gap(px(10.0));
        for st in ShipState::ALL {
            states_row = states_row.child(boat_card(
                &state_plan,
                st,
                st.label().to_string(),
                String::new(),
                &t,
                reduced,
            ));
        }

        // Panel 4 — the AgentChip (inline glyph + name), a few examples.
        let mut chips_row = div().flex().flex_wrap().gap(px(8.0)).items_center();
        for id in ["port-daddy:fleet:spark", "curiositech:fleet:code-reviewer", "windags:fleet:qa"] {
            let mut chip = AgentChip::new(id, t).reduced_motion(reduced);
            if let Some(tx) = &tx {
                chip = chip.on_select(tx.clone());
            }
            chips_row = chips_row.child(chip);
        }

        div()
            .flex()
            .flex_col()
            .p(px(16.0))
            .gap(px(4.0))
            .child(section_title("Ship Grammar — 8 role hulls (hash of codename)", &t))
            .child(hulls_row)
            .child(section_title("Same agent, 3 fleet liveries (hull constant, livery drifts)", &t))
            .child(livery_row)
            .child(section_title("One boat, all 8 states (material swaps, not new shapes)", &t))
            .child(states_row)
            .child(section_title("AgentChip — inline glyph + name (clickable)", &t))
            .child(chips_row)
    }
}
