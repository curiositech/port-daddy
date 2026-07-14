//! Shared GPUI primitives for the story-linework visual grammar.
//!
//! These elements carry meaning across panes: corner ticks bound an inspectable
//! live surface, paired blocks identify context, and an edge stripe carries
//! state. They stay small and composable so feature panes do not invent local
//! variants of the same language.

use gpui::prelude::*;
use gpui::*;
use std::time::Duration;

pub(crate) use crate::story_motion::{
    motion_orientation_cue, motion_surface, motion_surface_for_flag,
};

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
    let Some(owner) = policy.owner_spec(reduced) else {
        return stripe().into_any_element();
    };

    let animation = Animation::new(Duration::from_millis(owner.duration_ms));
    let animation = match owner.easing {
        "pulsating_between" => animation.with_easing(pulsating_between(0.55, 1.0)),
        "linear" => animation,
        _ => animation.with_easing(ease_in_out),
    };
    let animation = if owner.repeats {
        animation.repeat()
    } else {
        animation
    };
    let repeats = owner.repeats;
    stripe()
        .with_animation(
            SharedString::from(format!("{id}-{}-owner", policy.name())),
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
        assert_eq!(policy.owner_spec(false).unwrap().duration_ms, 480);
        assert!(!policy.animates_layout());
        assert!(policy.state_bearing_need().contains("conflict"));
        assert_eq!(
            motion_orientation_cue("harbor-editor-blocked-gate"),
            "Conflicted wedge stripe and PAN-PAN flag remain"
        );
    }

    #[test]
    fn every_runtime_editor_policy_has_one_valid_motion_owner() {
        for name in [
            "harbor-editor-caret-ownership",
            "harbor-editor-remote-edit-arrival",
            "harbor-editor-claim-acquire-release",
            "harbor-editor-blocked-gate",
            "harbor-editor-reconnect-recovery",
            "harbor-editor-save-receipt",
            "harbor-roster-live-session-tail",
            "harbor-human-gate-control",
        ] {
            let policy = motion_surface(name).unwrap_or_else(|| panic!("missing {name}"));
            assert!(policy.owner_spec(false).is_some(), "{name}");
            assert!(policy.owner_spec(true).is_none(), "{name}");
            assert!(!policy.animates_layout(), "{name}");
        }
    }
}
