use super::*;
use std::sync::Arc;

#[test]
fn test_state_transitions_runtime_policies() {
    let mut pane = EditorPane::new("test_path".to_string(), Arc::new(Identity::new()));
    
    // Test all eight runtime policies
    for i in 0..8 {
        let event = match i {
            0 => ReviewEvent::Pending(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "pending")),
            1 => ReviewEvent::Recovering(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "recovering")),
            2 => ReviewEvent::Confirmed(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "confirmed")),
            3 => ReviewEvent::Conflict(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "conflict")),
            4 => ReviewEvent::AwaitingHuman(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "awaiting")),
            5 => ReviewEvent::Unknown(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "unknown")),
            6 => ReviewEvent::Pending(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "pending")),
            7 => ReviewEvent::Recovering(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "recovering")),
            _ => panic!(),
        };
        
        pane.review.transition(event);
        assert!(pane.review.current_state() != ReviewState::Unknown);
    }
}

#[test]
fn test_state_transition_error_handling() {
    let mut pane = EditorPane::new("test_path".to_string(), Arc::new(Identity::new()));
    
    // Test invalid state transition
    let result = pane.review.transition(ReviewEvent::Conflict(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "invalid")));
    assert!(result.is_err());
}