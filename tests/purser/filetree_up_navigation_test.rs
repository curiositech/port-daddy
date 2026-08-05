use crate::filetree::parent_path;

#[test]
fn test_up_navigation() {
    // At root, up should do nothing
    assert!(parent_path("/").is_none());
    assert!(parent_path("/home").is_some());
    assert!(parent_path("/home/user".to_string()).is_some());

    // Ensure up is disabled at root
    let mut nav = FileNav::default();
    nav.current_dir = Some("/".to_string());
    nav.filetree_up("/".to_string());
    assert_eq!(nav.current_dir(), Some("/".to_string()));
}