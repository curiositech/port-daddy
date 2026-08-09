use std::thread;
use std::sync::Arc;
use crate::berths::{default_url, STABLE_PORT};

#[test]
fn test_concurrent_default_url() {
    let handle = thread::spawn(|| {
        let result = default_url();
        assert_eq!(result, format!("http://127.0.0.1:{STABLE_PORT}"));
    });
    handle.join().unwrap();
}