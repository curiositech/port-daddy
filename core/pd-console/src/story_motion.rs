//! Executable story-linework motion policy.
//!
//! This module is deliberately GPUI-free. The native renderer and the headless
//! contract test consume the same parsed policy and the same owner decision, so
//! checked-in JSON cannot pass as decorative documentation.

use serde::Deserialize;
use std::sync::OnceLock;

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

/// Values handed to the sole GPUI animation owner after policy validation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct MotionOwnerSpec<'a> {
    pub duration_ms: u64,
    pub easing: &'a str,
    pub repeats: bool,
}

impl MotionSurface {
    pub(crate) fn name(&self) -> &str {
        &self.name
    }

    pub(crate) fn state_bearing_need(&self) -> &str {
        &self.state_bearing_need
    }

    pub(crate) fn static_cue(&self) -> &str {
        &self.reduced_motion.static_cue
    }

    pub(crate) fn animates_layout(&self) -> bool {
        self.animates_layout_in_hot_render
    }

    /// Validate and consume the checked-in plan for one render. `None` means a
    /// static rail: reduced motion, malformed ownership, or an unsafe policy.
    pub(crate) fn owner_spec(&self, reduced: bool) -> Option<MotionOwnerSpec<'_>> {
        let valid_owner = self.owners == 1
            && self.duration_ms > 0
            && !self.animates_layout_in_hot_render
            && self.interruptible
            && self.reduced_motion.handled
            && self.reduced_motion.preserves_orientation
            && (!self.repeat.present
                || (self.repeat.scoped_to_leaf && self.repeat.pauses_when_idle));
        if reduced || !valid_owner {
            return None;
        }
        Some(MotionOwnerSpec {
            duration_ms: self.duration_ms,
            easing: &self.easing,
            repeats: self.repeat.present,
        })
    }
}

static MOTION_PLAN: OnceLock<Result<MotionPlan, String>> = OnceLock::new();

fn motion_plan() -> Option<&'static MotionPlan> {
    MOTION_PLAN
        .get_or_init(|| {
            serde_json::from_str(MOTION_PLAN_JSON)
                .map_err(|error| format!("invalid story-linework motion plan: {error}"))
        })
        .as_ref()
        .ok()
}

pub(crate) fn motion_surfaces() -> Option<&'static [MotionSurface]> {
    motion_plan().map(|plan| plan.surfaces.as_slice())
}

pub(crate) fn motion_surface(name: &str) -> Option<&'static MotionSurface> {
    motion_surfaces()?
        .iter()
        .find(|surface| surface.name == name)
}

pub(crate) fn motion_orientation_cue(name: &str) -> &'static str {
    motion_surface(name)
        .map(MotionSurface::static_cue)
        .unwrap_or("state edge and label remain visible")
}

/// Foxtrot is reserved by the shared review grammar for a real daemon-backed
/// human decision. Other flag letters do not acquire this policy.
pub(crate) fn motion_surface_for_flag(letter: char) -> Option<&'static str> {
    (letter == 'F').then_some("harbor-human-gate-control")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owner_spec_consumes_duration_easing_repeat_and_reduced_policy() {
        let policy = motion_surface("harbor-editor-remote-edit-arrival").unwrap();
        assert_eq!(
            policy.owner_spec(false),
            Some(MotionOwnerSpec {
                duration_ms: 220,
                easing: "ease_in_out",
                repeats: false,
            })
        );
        assert_eq!(policy.owner_spec(true), None);
        assert!(!policy.animates_layout());
        assert!(policy.state_bearing_need().contains("remote Loro ops"));
        assert_eq!(
            motion_surface_for_flag('F'),
            Some("harbor-human-gate-control")
        );
        assert_eq!(motion_surface_for_flag('H'), None);
    }
}
