//! Isolated process test for the one-way inspection admission latch.
#[path = "../src/local_control.rs"]
mod local_control;

#[test]
fn inspection_denies_effects_even_if_markers_are_absent() {
    local_control::enter_inspection_mode();
    assert!(local_control::inspection_mode());
    assert_eq!(local_control::current_state(), local_control::State::Inspection);
    assert!(!local_control::current_state().allows_effects());
    assert!(local_control::ensure_allowed().is_err());
    assert!(local_control::current_state().detail().contains("unverified"));
}
