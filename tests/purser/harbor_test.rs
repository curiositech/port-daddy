use super::*;
use crate::pane::{HarborNode, ReviewStateMachine};
use std::sync::{Arc, Mutex};

#[test]
fn test_harbor_state_consistency() {
    let mut harbor = Harbor::new();
    let node = HarborNode::new("test_id".to_string(), "test_data".to_string());
    
    // Add node and verify state
    harbor.add_node(node);
    assert!(harbor.nodes().len() == 1, "Node should be added");
    
    // Test state consistency after update
    let updated = HarborNode::new("test_id".to_string(), "updated_data".to_string());
    harbor.update_node(updated);
    assert!(harbor.nodes().len() == 1, "Node should be updated");
    
    // Test conflict resolution
    let conflict = HarborNode::new("test_id".to_string(), "conflict_data".to_string());
    let result = std::panic::catch_unwind(|| {
        harbor.update_node(conflict);
    });
    assert!(result.is_err(), "Conflict should be rejected");
}

#[test]
fn test_loro_synchronization() {
    let mut review = ReviewStateMachine::unknown(ReviewEvidence::new(ReviewSource::Surface, "test_path", "initial"));
    
    // Simulate Loro claim
    let claim = "loro_claim".to_string();
    review.transition(ReviewEvent::LoroClaim(claim));
    
    // Verify synchronization
    assert!(review.evidence().source == ReviewSource::Loro, "Loro source should be set");
    assert!(review.evidence().data == "loro_claim", "Loro data should match");
}
