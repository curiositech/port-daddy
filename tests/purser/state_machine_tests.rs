use super::*;
use std::sync::Arc;

#[test]
fn test_state_machine_transitions() {
    let mut pane = EditorPane::new("test_path".to_string(), Arc::new(Identity::new()));
    
    // Test valid transitions
    pane.review.transition(ReviewEvent::Pending(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "pending")));
    assert_eq!(pane.review.current_state(), ReviewState::Pending);

    pane.review.transition(ReviewEvent::Recovering(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "recovering")));
    assert_eq!(pane.review.current_state(), ReviewState::Recovering);

    pane.review.transition(ReviewEvent::Confirmed(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "confirmed")));
    assert_eq!(pane.review.current_state(), ReviewState::Confirmed);

    // Test invalid transition
    pane.review.transition(ReviewEvent::Conflict(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "conflict")));
    assert_eq!(pane.review.current_state(), ReviewState::Conflict);

    // Test state reset
    pane.review.transition(ReviewEvent::AwaitingHuman(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "awaiting")));
    assert_eq!(pane.review.current_state(), ReviewState::AwaitingHuman);
}

#[test]
fn test_state_machine_boundary_values() {
    let mut pane = EditorPane::new("test_path".to_string(), Arc::new(Identity::new()));
    
    // Test initial state
    assert_eq!(pane.review.current_state(), ReviewState::Unknown);

    // Test maximum transitions
    for _ in 0..10 {
        pane.review.transition(ReviewEvent::Pending(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "pending")));
    }
    assert_eq!(pane.review.current_state(), ReviewState::Pending);
}
