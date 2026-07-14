use serde_json::Value;
use std::collections::HashSet;

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
    for surface in surfaces {
        let name = surface["name"].as_str().expect("surface name");
        assert!(names.insert(name), "duplicate motion surface: {name}");
        assert_eq!(surface["owners"], 1, "{name} must have exactly one owner");
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
}

#[test]
fn rung_one_returns_to_event_driven_redraw_when_idle() {
    let rung: Value = serde_json::from_str(RUNG_PLAN).expect("valid rung plan JSON");
    assert_eq!(rung["chosenRung"], 1);
    assert_eq!(rung["glyphSource"], "parley");
    assert_eq!(rung["tripleBuffered"], false);
    assert_eq!(rung["redrawEveryFrame"], false);
    assert_eq!(rung["idleRedrawPolicy"], "event-driven");
    assert_eq!(rung["motionPreferenceControl"], "visible-runtime-toggle");
}
