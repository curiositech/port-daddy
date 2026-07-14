//! Shared GPUI primitives for the story-linework visual grammar.
//!
//! These elements carry meaning across panes: corner ticks bound an inspectable
//! live surface, paired blocks identify context, and an edge stripe carries
//! state. They stay small and composable so feature panes do not invent local
//! variants of the same language.

use gpui::prelude::*;
use gpui::*;
use serde::Deserialize;
use std::sync::OnceLock;
use std::time::Duration;

const MOTION_PLAN_JSON: &str =
    include_str!("../../../docs/design/pd-console-story-linework-motion-plan.json");

#[derive(Debug, Deserialize)]
struct MotionPlan {
    surfaces: Vec<MotionSurface>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MotionSurface {
    name: String,
    duration_ms: u64,
    owners: u8,
    state_bearing_need: String,
    animates_layout_in_hot_render: bool,
    reduced_motion: ReducedMotion,
    repeat: RepeatPolicy,
    easing: String,
    interruptible: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReducedMotion {
    handled: bool,
    preserves_orientation: bool,
    static_cue: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepeatPolicy {
    present: bool,
    #[serde(default)]
    scoped_to_leaf: bool,
    #[serde(default)]
    pauses_when_idle: bool,
}

static MOTION_PLAN: OnceLock<Result<MotionPlan, String>> = OnceLock::new();

/// Typed production lookup for the checked-in motion plan. A malformed plan
/// degrades to static rails in production and fails the contract tests; it can
/// never take the operator console down.
pub(crate) fn motion_surface(name: &str) -> Option<&'static MotionSurface> {
    let plan = MOTION_PLAN.get_or_init(|| {
        serde_json::from_str(MOTION_PLAN_JSON)
            .map_err(|error| format!("invalid story-linework motion plan: {error}"))
    });
    match plan {
        Ok(plan) => plan.surfaces.iter().find(|surface| surface.name == name),
        Err(_) => None,
    }
}

/// Reduced-motion orientation copy comes from the same policy the animated
/// owner consumes. This makes the JSON executable configuration, not a design
/// appendix that can silently drift from the app.
pub(crate) fn motion_orientation_cue(name: &str) -> &'static str {
    motion_surface(name)
        .map(|surface| surface.reduced_motion.static_cue.as_str())
        .unwrap_or("state edge and label remain visible")
}

pub(crate) fn corner_ticks(prefix: impl Into<String>, color: u32) -> Vec<AnyElement> {
    let prefix = prefix.into();
    let corner = |suffix: &'static str, top: bool, left: bool| {
        div()
            .id(SharedString::from(format!("{prefix}-{suffix}")))
            .absolute()
            .when(top, |d| d.top_0())
            .when(!top, |d| d.bottom_0())
            .when(left, |d| d.left_0())
            .when(!left, |d| d.right_0())
            .w(px(20.0))
            .h(px(20.0))
            .child(
                div()
                    .absolute()
                    .when(top, |d| d.top_0())
                    .when(!top, |d| d.bottom_0())
                    .when(left, |d| d.left_0())
                    .when(!left, |d| d.right_0())
                    .w(px(20.0))
                    .h(px(2.0))
                    .bg(rgb(color)),
            )
            .child(
                div()
                    .absolute()
                    .when(top, |d| d.top_0())
                    .when(!top, |d| d.bottom_0())
                    .when(left, |d| d.left_0())
                    .when(!left, |d| d.right_0())
                    .w(px(2.0))
                    .h(px(20.0))
                    .bg(rgb(color)),
            )
            .into_any_element()
    };
    vec![
        corner("tick-nw", true, true),
        corner("tick-ne", true, false),
        corner("tick-sw", false, true),
        corner("tick-se", false, false),
    ]
}

pub(crate) fn micro_flag(
    id: impl Into<SharedString>,
    primary: u32,
    secondary: u32,
    block_width: f32,
    block_height: f32,
) -> AnyElement {
    div()
        .id(id.into())
        .flex()
        .flex_shrink_0()
        .child(
            div()
                .w(px(block_width))
                .h(px(block_height))
                .bg(rgb(primary)),
        )
        .child(
            div()
                .w(px(block_width))
                .h(px(block_height))
                .bg(rgb(secondary)),
        )
        .into_any_element()
}

pub(crate) fn state_stripe(
    id: impl Into<SharedString>,
    color: u32,
    width: f32,
    height: f32,
) -> AnyElement {
    div()
        .id(id.into())
        .w(px(width))
        .h(px(height))
        .flex_shrink_0()
        .bg(rgb(color))
        .into_any_element()
}

/// The single animation owner for one state-bearing surface. Only opacity is
/// animated (compositor-friendly and layout-stable); the stripe's size, color,
/// label, and neighboring flag remain static orientation cues. Reduced motion,
/// malformed policy, or an invalid ownership contract all render the same final
/// static stripe.
pub(crate) fn motion_state_stripe(
    id: impl Into<String>,
    surface_name: &str,
    color: u32,
    width: f32,
    height: f32,
    reduced: bool,
) -> AnyElement {
    let id = id.into();
    let stripe = || {
        div()
            .id(SharedString::from(id.clone()))
            .w(px(width))
            .h(px(height))
            .flex_shrink_0()
            .bg(rgb(color))
    };
    let Some(policy) = motion_surface(surface_name) else {
        return stripe().into_any_element();
    };
    let valid_owner = policy.owners == 1
        && !policy.animates_layout_in_hot_render
        && policy.interruptible
        && policy.reduced_motion.handled
        && policy.reduced_motion.preserves_orientation
        && (!policy.repeat.present
            || (policy.repeat.scoped_to_leaf && policy.repeat.pauses_when_idle));
    if reduced || !valid_owner {
        return stripe().into_any_element();
    }

    let animation = Animation::new(Duration::from_millis(policy.duration_ms.max(1)));
    let animation = match policy.easing.as_str() {
        "pulsating_between" => animation.with_easing(pulsating_between(0.55, 1.0)),
        "linear" => animation,
        _ => animation.with_easing(ease_in_out),
    };
    let animation = if policy.repeat.present {
        animation.repeat()
    } else {
        animation
    };
    let repeats = policy.repeat.present;
    stripe()
        .with_animation(
            SharedString::from(format!("{id}-{}-owner", policy.name)),
            animation,
            move |element, delta| {
                element.opacity(if repeats {
                    delta.clamp(0.45, 1.0)
                } else {
                    0.45 + 0.55 * delta
                })
            },
        )
        .into_any_element()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_motion_lookup_consumes_named_surface_policy() {
        let policy = motion_surface("harbor-editor-blocked-gate")
            .expect("the runtime consumes the blocked-gate plan");
        assert_eq!(policy.owners, 1);
        assert!(policy.duration_ms > 0);
        assert!(!policy.animates_layout_in_hot_render);
        assert!(policy.interruptible);
        assert!(policy.state_bearing_need.contains("conflict"));
        assert_eq!(
            motion_orientation_cue("harbor-editor-blocked-gate"),
            "Conflicted wedge stripe and PAN-PAN flag remain"
        );
    }

    #[test]
    fn every_runtime_editor_policy_has_one_valid_motion_owner() {
        for name in [
            "harbor-editor-caret-ownership",
            "harbor-editor-claim-acquire-release",
            "harbor-editor-blocked-gate",
            "harbor-roster-live-session-tail",
        ] {
            let policy = motion_surface(name).unwrap_or_else(|| panic!("missing {name}"));
            assert_eq!(policy.owners, 1, "{name}");
            assert!(policy.duration_ms > 0, "{name}");
            assert!(policy.reduced_motion.handled, "{name}");
            assert!(policy.reduced_motion.preserves_orientation, "{name}");
            assert!(!policy.animates_layout_in_hot_render, "{name}");
        }
    }
}
