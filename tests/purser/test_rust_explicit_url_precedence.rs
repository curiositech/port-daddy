use super::*;
use std::path::Path;

#[test]
fn test_explicit_url_takes_precedence() {
    let root = discovery_test_home();
    let state = root.join(".port-daddy");
    std::fs::create_dir_all(&state).expect("state dir");
    std::fs::write(state.join("daemon.port"), "3174
").expect("port file");
    
    let explicit_url = Some("http://127.0.0.1:9900/");
    let result = discover_daemon_base(explicit_url, Some(&root));
    assert_eq!(result.unwrap(), "http://127.0.0.1:9900/", "Explicit URL should be used");
    
    std::fs::remove_dir_all(root).expect("remove test home");
}

#[test]
fn test_explicit_url_with_trailing_whitespace() {
    let root = discovery_test_home();
    let state = root.join(".port-daddy");
    std::fs::create_dir_all(&state).expect("state dir");
    std::fs::write(state.join("daemon.port"), "3174
").expect("port file");
    
    let explicit_url = Some("  http://127.0.0.1:9900/  ");
    let result = discover_daemon_base(explicit_url, Some(&root));
    assert_eq!(result.unwrap(), "http://127.0.0.1:9900/", "Whitespace in URL should be trimmed");
    
    std::fs::remove_dir_all(root).expect("remove test home");
}