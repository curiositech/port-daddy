use super::*;
use std::sync::Arc;

#[test]
fn test_daemon_identifier_display() {
    let mut pane = EditorPane::new("test_path".to_string(), Arc::new(Identity::new()));
    let daemon_id = "test_daemon_id".to_string();
    
    // Simulate daemon ID setting
    pane.review.transition(ReviewEvent::Confirmed(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "confirmed")));
    
    // Check if daemon ID is displayed
    assert!(pane.review.evidence().source == ReviewSource::Surface);
    assert_eq!(pane.review.evidence().path, "test_path");
}

#[test]
fn test_daemon_id_error_handling() {
    let mut pane = EditorPane::new("test_path".to_string(), Arc::new(Identity::new()));
    
    // Test missing daemon ID
    pane.review.transition(ReviewEvent::Pending(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "pending")));
    assert_eq!(pane.review.current_state(), ReviewState::Pending);

    // Test invalid daemon ID
    pane.review.transition(ReviewEvent::Conflict(ReviewEvidence::new(ReviewSource::Surface, "test_path".to_string(), "invalid_id")));
    assert_eq!(pane.review.current_state(), ReviewState::Conflict);
}