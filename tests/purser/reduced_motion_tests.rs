use super::*;
use std::sync::Arc;

#[test]
fn test_reduced_motion_state_rails() {
    let mut pane = EditorPane::new("test_path".to_string(), Arc::new(Identity::new()));
    
    // Enable reduced motion
    pane.review.transition(ReviewEvent::ReducedMotion(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "reduced")));
    
    // Check if state rails are preserved
    assert!(pane.review.evidence().source == ReviewSource::Surface);
    assert_eq!(pane.review.evidence().path, "test_path");
}

#[test]
fn test_reduced_motion_orientation_parity() {
    let mut pane = EditorPane::new("test_path".to_string(), Arc::new(Identity::new()));
    
    // Simulate reduced motion
    let reduced = true;
    let orientation = pane.calculate_orientation(reduced);
    
    // Check if orientation is preserved
    assert_eq!(orientation, "preserved");
}