use crate::filetree::{filetree_size_str, short_age};

#[test]
fn test_metadata_display() {
    // Test size formatting
    assert_eq!(filetree_size_str(&FileMeta { size: 512, ..Default::default() }), "512 B");
    assert_eq!(filetree_size_str(&FileMeta { size: 1500, ..Default::default() }), "1.5 KB");
    assert_eq!(filetree_size_str(&FileMeta { size: 3_000_000_000, ..Default::default() }), "3.0 GB");

    // Test relative age calculation
    let now = 1717027200; // Example timestamp
    assert_eq!(short_age(now - 30), "just now");
    assert_eq!(short_age(now - 3600), "1h ago");
    assert_eq!(short_age(now - 86400), "1d ago");
    assert_eq!(short_age(now - 2_592_000), "1mo ago");
}