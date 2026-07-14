use serde_json::Value;
use std::collections::HashSet;

#[path = "../src/story_motion.rs"]
mod story_motion;

const MOTION_PLAN: &str =
    include_str!("../../../docs/design/pd-console-story-linework-motion-plan.json");
const RUNG_PLAN: &str =
    include_str!("../../../docs/design/pd-console-story-linework-rung-plan.json");

#[test]
fn every_motion_surface_has_one_owner_and_a_reduced_motion_state() {
    let plan: Value = serde_json::from_str(MOTION_PLAN).expect("valid motion plan JSON");
    let surfaces = plan["surfaces"]
        .as_array()
        .expect("motion plan surfaces array");
    assert!(!surfaces.is_empty(), "motion plan must name its surfaces");

    let mut names = HashSet::new();
    let allowed_easing = ["ease_in_out", "pulsating_between", "linear"];
    let required = [
        "harbor-editor-caret-ownership",
        "harbor-editor-remote-edit-arrival",
        "harbor-editor-claim-acquire-release",
        "harbor-editor-blocked-gate",
        "harbor-editor-reconnect-recovery",
        "harbor-editor-save-receipt",
        "harbor-roster-live-session-tail",
        "harbor-human-gate-control",
    ];
    for surface in surfaces {
        let name = surface["name"].as_str().expect("surface name");
        assert!(names.insert(name), "duplicate motion surface: {name}");
        assert_eq!(surface["owners"], 1, "{name} must have exactly one owner");
        assert!(
            surface["durationMs"].as_u64().is_some_and(|ms| ms > 0),
            "{name} must declare the duration consumed by GPUI"
        );
        assert!(
            surface["stateBearingNeed"]
                .as_str()
                .is_some_and(|s| !s.is_empty()),
            "{name} must name the state it communicates"
        );
        assert_eq!(
            surface["animatesLayoutInHotRender"], false,
            "{name} must not animate layout in a hot render path"
        );
        assert_eq!(
            surface["reducedMotion"]["handled"], true,
            "{name} needs a reduced-motion state"
        );
        assert_eq!(
            surface["reducedMotion"]["preservesOrientation"], true,
            "{name} must preserve its state cue when motion is reduced"
        );
        let easing = surface["easing"].as_str().expect("surface easing");
        assert!(
            allowed_easing.contains(&easing),
            "{name} uses an unreviewed easing: {easing}"
        );

        if surface["repeat"]["present"] == true {
            assert_eq!(
                surface["repeat"]["scopedToLeaf"], true,
                "{name} repeats outside a bounded leaf"
            );
            assert_eq!(
                surface["repeat"]["pausesWhenIdle"], true,
                "{name} repeats while idle"
            );
        }
    }
    for name in required {
        assert!(names.contains(name), "motion plan is missing {name}");
    }
}

#[test]
fn production_owner_decision_consumes_every_editor_and_harbor_policy() {
    let runtime_surfaces = story_motion::motion_surfaces()
        .expect("the production parser must load the checked-in motion plan");
    assert!(!runtime_surfaces.is_empty());

    for consumed_surface in [
        "harbor-editor-caret-ownership",
        "harbor-editor-remote-edit-arrival",
        "harbor-editor-claim-acquire-release",
        "harbor-editor-blocked-gate",
        "harbor-editor-reconnect-recovery",
        "harbor-editor-save-receipt",
        "harbor-roster-live-session-tail",
        "harbor-human-gate-control",
    ] {
        let policy = story_motion::motion_surface(consumed_surface)
            .unwrap_or_else(|| panic!("production parser did not load {consumed_surface}"));
        let owner = policy
            .owner_spec(false)
            .unwrap_or_else(|| panic!("{consumed_surface} has no valid runtime owner"));
        assert!(owner.duration_ms > 0, "{consumed_surface}");
        assert!(!owner.easing.is_empty(), "{consumed_surface}");
        assert_eq!(
            policy.owner_spec(true),
            None,
            "reduced motion must consume the static branch for {consumed_surface}"
        );
        assert!(
            !story_motion::motion_orientation_cue(consumed_surface).is_empty(),
            "{consumed_surface} must retain a static orientation cue"
        );
        assert_eq!(policy.name(), consumed_surface);
        assert!(!policy.state_bearing_need().is_empty());
        assert!(!policy.animates_layout());
    }
    assert_eq!(
        story_motion::motion_surface_for_flag('F'),
        Some("harbor-human-gate-control")
    );
    assert_eq!(story_motion::motion_surface_for_flag('H'), None);
}

#[test]
fn rendering_rung_stays_gpui_until_a_state_bearing_need_earns_a_hatch() {
    let rung: Value = serde_json::from_str(RUNG_PLAN).expect("valid rung plan JSON");
    assert_eq!(rung["decision"], "gpui-default");
    assert_eq!(rung["chosenRung"], 1);
    assert_eq!(rung["chosenRenderer"], "gpui-element-tree");
    assert_eq!(rung["glyphSource"], "gpui-glyph-atlas");
    assert_eq!(rung["velloParley"]["decision"], "not-used");
    assert_eq!(rung["shader"]["decision"], "not-used");
    assert_eq!(rung["namedConstraintForLowerRung"], Value::Null);
    assert_eq!(rung["tripleBuffered"], false);
    assert_eq!(rung["redrawEveryFrame"], false);
    assert_eq!(rung["idleRedrawPolicy"], "event-driven");
    assert_eq!(rung["motionPreferenceControl"], "visible-runtime-toggle");
    let effects = rung["stateBearingEffects"]
        .as_array()
        .expect("state-bearing effects");
    for need in [
        "caret-ownership-line-rail",
        "remote-edit-author-gutter",
        "claim-acquire-release-stripe",
        "blocked-wedge-stripe",
        "recovery-snapshot-receipt",
        "save-state-vector-receipt",
        "live-session-row-stripe",
        "human-gate-foxtrot-flag",
    ] {
        assert!(
            effects.iter().any(|v| v == need),
            "rung plan must account for {need}"
        );
    }
}
