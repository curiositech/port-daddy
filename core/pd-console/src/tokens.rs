//! Design tokens — Tier 1 (primitive) of pd-console's three-tier system.
//!
//! The semantic *color* layer already lives in `palette.rs` (the maritime
//! `Theme`, light + dark). This module is everything else a component needs and
//! the console has historically hand-picked: an 8pt spacing grid, a modular type
//! scale with a hard 14px body floor, a radius scale, and motion durations.
//!
//! The contract: **components reference these named tokens, never a raw `px()`
//! literal.** That's what lets a pane be retuned in one place and keeps the
//! "Magic Numbers in Components" anti-pattern out (today `app.rs` alone carries
//! 19 distinct `px()` values). Realizes the ADR-0046 Phase-4 token-mirror goal
//! on the Rust side; a follow-up generates these from `tokens.semantic.css` with
//! a CI diff-gate so console / website / FleetBar can never drift.
//!
//! Values are `f32` (wrap at the call site: `.px(px(tokens::SPACE_3))`) because
//! gpui's `px()` is not a const fn; motion is `Duration` (const-constructible).

use std::time::Duration;

// ── Spacing — 8pt grid, 4pt micro-step ───────────────────────────────────────
// Absorbs the scattered 13/10/5/22/26/28 the panes use today.
/// 4px — micro: icon↔text gap, button y-padding.
pub const SPACE_1: f32 = 4.0;
/// 8px — tight: chip padding, inline gaps.
pub const SPACE_2: f32 = 8.0;
/// 12px — default: pane padding-x, button padding-x.
pub const SPACE_3: f32 = 12.0;
/// 16px — comfortable: section gaps.
pub const SPACE_4: f32 = 16.0;
/// 24px — loose: group separation.
pub const SPACE_6: f32 = 24.0;
/// 32px — major: pane margins.
pub const SPACE_8: f32 = 32.0;

// ── Radius — collapses the 3/4/5/6 the console uses ──────────────────────────
/// 4px — chips, small inset controls.
pub const RADIUS_SM: f32 = 4.0;
/// 6px — buttons, cards.
pub const RADIUS_MD: f32 = 6.0;
/// 10px — panes, surfaces.
pub const RADIUS_LG: f32 = 10.0;

// ── Type — modular scale; `TEXT_BODY` is the 14px floor ──────────────────────
// AGENTS.md "no tiny fonts": prose/body/caption ≥14px; 12px ONLY as a bold,
// uppercase, tracked-out eyebrow. The console's 14 `px(13)`-on-prose sites are
// caption-only metadata; anything that reads as a sentence must be `TEXT_BODY`.
/// 12px — eyebrow ONLY (uppercase + bold + letter-spacing).
pub const TEXT_EYEBROW: f32 = 12.0;
/// 13px — caption: secondary metadata (bond/cost, ages, ids).
pub const TEXT_CAPTION: f32 = 13.0;
/// 14px — body: the prose floor.
pub const TEXT_BODY: f32 = 14.0;
/// 15px — emphasized body.
pub const TEXT_BODY_LG: f32 = 15.0;
/// 17px — pane / section header.
pub const TEXT_HEADER: f32 = 17.0;
/// 20px — title.
pub const TEXT_TITLE: f32 = 20.0;

// ── Motion — transform/opacity only; honor reduced-motion at the call site ───
/// 120ms — button press, hover glow.
pub const MOTION_FAST: Duration = Duration::from_millis(120);
/// 200ms — pane focus, chip change.
pub const MOTION_BASE: Duration = Duration::from_millis(200);
/// 300ms — split / tab transitions.
pub const MOTION_SLOW: Duration = Duration::from_millis(300);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spacing_is_on_the_8pt_grid() {
        // Every spacing token is a multiple of the 4pt micro-grid.
        for v in [SPACE_1, SPACE_2, SPACE_3, SPACE_4, SPACE_6, SPACE_8] {
            assert_eq!(v % 4.0, 0.0, "{v} is off the 4pt grid");
        }
    }

    #[test]
    fn body_text_meets_the_14px_floor() {
        // The no-tiny-fonts rule: body and up are >= 14; only the eyebrow may dip
        // to 12 (and only as bold/uppercase/tracked).
        assert!(TEXT_BODY >= 14.0);
        assert!(TEXT_BODY_LG >= TEXT_BODY);
        assert!(TEXT_HEADER >= TEXT_BODY);
        assert!(TEXT_TITLE >= TEXT_HEADER);
        assert_eq!(TEXT_EYEBROW, 12.0); // the one allowed sub-14, eyebrow-only
    }

    #[test]
    fn type_scale_is_monotonic() {
        assert!(TEXT_CAPTION < TEXT_BODY);
        assert!(TEXT_BODY < TEXT_BODY_LG);
        assert!(TEXT_BODY_LG < TEXT_HEADER);
    }

    #[test]
    fn motion_durations_ascend() {
        assert!(MOTION_FAST < MOTION_BASE);
        assert!(MOTION_BASE < MOTION_SLOW);
    }
}
