use crate::filetree::{FileNav, NavHistory};

#[test]
fn test_back_forward_navigation() {
    let mut nav = FileNav::default();
    let root = Some("/home/user".to_string());

    // Navigate to subdirectory
    nav.filetree_descend("/home/user".to_string(), "/home/user/docs".to_string());
    assert_eq!(nav.history.len(), 1);

    // Navigate further
    nav.filetree_descend("/home/user/docs".to_string(), "/home/user/docs/project".to_string());
    assert_eq!(nav.history.len(), 2);

    // Back should return to previous directory
    nav.filetree_back();
    assert_eq!(nav.current_dir(), "/home/user/docs");
    assert_eq!(nav.history.len(), 1);

    // Back again should return to root
    nav.filetree_back();
    assert_eq!(nav.current_dir(), "/home/user");
    assert_eq!(nav.history.len(), 0);

    // No-op back has no effect
    nav.filetree_back();
    assert_eq!(nav.current_dir(), "/home/user");
    assert_eq!(nav.history.len(), 0);
}