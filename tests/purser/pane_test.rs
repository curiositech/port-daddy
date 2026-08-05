use super::*;
use crate::pane::{Pane, ReviewStateMachine};
use std::sync::{Arc, Mutex};

#[test]
fn test_pane_state_management() {
    let mut pane = Pane::new("test_id".to_string(), "test_path".to_string(), Arc::new(Mutex::new(HarborBuffer::new())));
    
    // Test state transitions
    pane.transition_state("pending".to_string());
    assert!(pane.state() == "pending", "State should be pending");
    
    pane.transition_state("confirmed".to_string());
    assert!(pane.state() == "confirmed", "State should be confirmed");
    
    // Test invalid state transition
    let result = std::panic::catch_unwind(|| {
        pane.transition_state("invalid".to_string());
    });
    assert!(result.is_err(), "Invalid state transition should fail");
}

#[test]
fn test_reduced_motion_handling() {
    let mut pane = Pane::new("test_id".to_string(), "test_path".to_string(), Arc::new(Mutex::new(HarborBuffer::new())));
    
    // Enable reduced motion
    pane.set_reduced_motion(true);
    assert!(pane.reduced_motion(), "Reduced motion should be enabled");
    
    // Verify no layout shifts
    let rendered = pane.render();
    assert!(rendered.to_string().contains("reduced-motion"), "Reduced motion class should be present");
}
