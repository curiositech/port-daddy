use super::*;
use std::sync::{Arc, Mutex};
use crate::pane::{EditorMotionCue, ReviewEvent, ReviewStateMachine};

#[test]
fn test_state_machine_transitions() {
    let mut review = ReviewStateMachine::unknown(ReviewEvidence::new(ReviewSource::Surface, "test_path", "initial"));
    
    // Valid transitions
    review.transition(ReviewEvent::Pending(ReviewEvidence::new(ReviewSource::Surface, "test_path", "pending")));
    review.transition(ReviewEvent::Confirmed(ReviewEvidence::new(ReviewSource::Surface, "test_path", "confirmed")));
    
    // Invalid transition
    let result = std::panic::catch_unwind(|| {
        review.transition(ReviewEvent::Conflict(ReviewEvidence::new(ReviewSource::Surface, "test_path", "conflict")));
    });
    assert!(result.is_err(), "Should reject invalid state transition");
}

#[test]
fn test_daemon_verification() {
    let mut pane = EditorPane::new("test_path".to_string(), None, Arc::new(Mutex::new(HarborBuffer::new())));
    
    // Test valid commandId
    let valid_receipt = "valid_command_id".to_string();
    assert!(pane.verify_daemon_receipt(&valid_receipt), "Valid receipt should pass");
    
    // Test invalid commandId
    let invalid_receipt = "invalid_command_id".to_string();
    assert!(!pane.verify_daemon_receipt(&invalid_receipt), "Invalid receipt should fail");
}

#[test]
fn test_motion_cue_rendering() {
    let cue = EditorMotionCue::CaretOwnership;
    let reduced = true;
    
    // Test reduced motion handling
    let rendered = render_code_buffer(
        0, 
        vec![CodeLine::default()].into(),
        2, 
        vec![],
        cue,
        None
    );
    
    // Verify no layout shifts
    assert!(rendered.to_string().contains("reduced-motion"), "Reduced motion should be detected");
}
