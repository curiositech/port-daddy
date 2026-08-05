use super::*;
use std::path::Path;
use std::thread;
use std::time::Duration;

#[test]
fn test_concurrent_access_to_port_file() {
    let root = discovery_test_home();
    let state = root.join(".port-daddy");
    std::fs::create_dir_all(&state).expect("state dir");
    let port_file = state.join("daemon.port");
    
    // Spawn multiple threads to read the port file simultaneously
    let handles: Vec<_> = (0..10).map(|_| {
        thread::spawn(move || {
            let result = discover_daemon_base(None, Some(&root));
            assert!(result.is_ok(), "Concurrent read should not fail");
            result.unwrap()
        })
    }).collect();
    
    // Check that all threads got the same result
    let first = handles[0].join().unwrap();
    for handle in handles.iter().skip(1) {
        let result = handle.join().unwrap();
        assert_eq!(result, first, "Concurrent reads should return consistent results");
    }
    
    // Clean up
    std::fs::remove_dir_all(root).expect("remove test home");
}