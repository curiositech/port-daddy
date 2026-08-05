use crate::filetree::FileNav;

#[test]
fn test_cursor_navigation() {
    let mut nav = FileNav::default();
    nav.cursor = 0;

    // Move down
    nav.filetree_move_cursor(1, 5);
    assert_eq!(nav.cursor, 1);

    // Move up
    nav.filetree_move_cursor(-1, 5);
    assert_eq!(nav.cursor, 0);

    // Out of bounds
    nav.filetree_move_cursor(10, 5);
    assert_eq!(nav.cursor, 4);
    nav.filetree_move_cursor(-10, 5);
    assert_eq!(nav.cursor, 0);
}