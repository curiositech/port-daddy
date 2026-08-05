use super::*;
use std::sync::Arc;

#[test]
fn test_control_receipt_validation() {
    let mut pane = EditorPane::new("test_path".to_string(), Arc::new(Identity::new()));
    let valid_command_id = "valid_command_id".to_string();
    
    // Test valid command ID
    let result = pane.validate_control_receipt(&valid_command_id);
    assert!(result);

    // Test invalid command ID
    let invalid_command_id = "invalid_command_id".to_string();
    let result = pane.validate_control_receipt(&invalid_command_id);
    assert!(!result);
}

#[test]
fn test_control_receipt_error_paths() {
    let mut pane = EditorPane::new("test_path".to_string(), Arc::new(Identity::new()));
    
    // Test missing command ID
    let result = pane.validate_control_receipt(&"".to_string());
    assert!(!result);

    // Test command ID with spaces
    let result = pane.validate_control_receipt(&"command id".to_string());
    assert!(!result);
}