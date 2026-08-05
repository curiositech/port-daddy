use super::*;
use crate::harbor::{Harbor, HarborNode};
use std::sync::{Arc, Mutex};

#[test]
fn test_harbor_node_operations() {
    let mut harbor = Harbor::new();
    let node = HarborNode::new("test_id".to_string(), "test_data".to_string());
    
    // Add node
    harbor.add_node(node);
    assert!(harbor.nodes().len() == 1, "Node should be added");
    
    // Get node by ID
    let retrieved = harbor.get_node("test_id").unwrap();
    assert!(retrieved.id == "test_id", "Node ID should match");
    
    // Remove node
    harbor.remove_node("test_id");
    assert!(harbor.nodes().len() == 0, "Node should be removed");
}

#[test]
fn test_harbor_conflict_resolution() {
    let mut harbor = Harbor::new();
    let node1 = HarborNode::new("test_id".to_string(), "data1".to_string());
    let node2 = HarborNode::new("test_id".to_string(), "data2".to_string());
    
    harbor.add_node(node1);
    let result = std::panic::catch_unwind(|| {
        harbor.add_node(node2);
    });
    assert!(result.is_err(), "Duplicate node should be rejected");
}
