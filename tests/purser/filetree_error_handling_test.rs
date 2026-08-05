use crate::filetree::filetree_listing;

#[test]
fn test_error_handling() {
    // Test non-existent directory
    let result = filetree_listing(Some("/nonexistent"), FileSort::default());
    assert!(result.is_err());

    // Test large directory (simulate truncation)
    let dir = std::env::temp_dir().join("large_dir");
    std::fs::create_dir(&dir).unwrap();
    for i in 0..1001 {
        std::fs::File::create(dir.join(format!("file{}.txt", i))).unwrap();
    }
    let entries = filetree_listing(Some(&dir.to_string_lossy()), FileSort::default()).unwrap();
    assert_eq!(entries.len(), 1000);
}