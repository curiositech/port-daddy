use crate::berths::{discover, Berth};
use std::env;
use std::path::PathBuf;

#[test]
fn test_discover_empty() {
    let dev_daemons_path = PathBuf::from("tests/purser/dev-daemons.json");
    std::fs::write(&dev_daemons_path, "[]").expect("Failed to write dev-daemons.json");
    env::set_var("HOME", "tests/purser");
    let berths = discover();
    assert!(berths.is_empty());
}