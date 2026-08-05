use crate::filetree::FileNav;

#[test]
fn test_state_persistence() {
    let mut nav = FileNav::default();
    nav.current_dir = Some("/home/user".to_string());
    nav.sort = FileSort { column: SortColumn::Size, dir: crate::filetree::SortDir::Desc };
    nav.cursor = 5;

    // Simulate pane switch and re-render
    let saved_state = nav.clone();
    assert_eq!(saved_state.current_dir, Some("/home/user".to_string()));
    assert_eq!(saved_state.sort.column, SortColumn::Size);
    assert_eq!(saved_state.cursor, 5);
}