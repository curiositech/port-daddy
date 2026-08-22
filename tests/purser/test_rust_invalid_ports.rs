use super::*;
use std::path::Path;

#[test]
fn test_zero_port() {
    let root = discovery_test_home();
    let state = root.join(".port-daddy");
    std::fs::create_dir_all(&state).expect("state dir");
    std::fs::write(state.join("daemon.port"), "0
").expect("port file");
    
    let result = discover_daemon_base(None, Some(&root));
    assert!(result.is_err(), "Zero port should be rejected");
    assert!(result.unwrap_err().to_string().contains("invalid daemon port"), "Error message mismatch");
    
    std::fs::remove_dir_all(root).expect("remove test home");
}

#[test]
fn test_non_numeric_port() {
    let root = discovery_test_home();
    let state = root.join(".port-daddy");
    std::fs::create_dir_all(&state).expect("state dir");
    std::fs::write(state.join("daemon.port"), "abc
").expect("port file");
    
    let result = discover_daemon_base(None, Some(&root));
    assert!(result.is_err(), "Non-numeric port should be rejected");
    assert!(result.unwrap_err().to_string().contains("invalid daemon port"), "Error message mismatch");
    
    std::fs::remove_dir_all(root).expect("remove test home");
}

#[test]
fn test_missing_port_file() {
    let root = discovery_test_home();
    
    let result = discover_daemon_base(None, Some(&root));
    assert!(result.is_err(), "Missing port file should be rejected");
    assert!(result.unwrap_err().to_string().contains("cannot locate the Port Daddy daemon"), "Error message mismatch");
    
    std::fs::remove_dir_all(root).expect("remove test home");
}