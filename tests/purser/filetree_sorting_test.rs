use crate::filetree::{FileSort, SortColumn};

#[test]
fn test_sorting() {
    let mut sort = FileSort::default();

    // Sort by name
    sort.toggle(SortColumn::Name);
    assert_eq!(sort.column, SortColumn::Name);
    assert_eq!(sort.dir, crate::filetree::SortDir::Asc);

    // Toggle direction
    sort.toggle(SortColumn::Name);
    assert_eq!(sort.dir, crate::filetree::SortDir::Desc);

    // Sort by size
    sort.toggle(SortColumn::Size);
    assert_eq!(sort.column, SortColumn::Size);
    assert_eq!(sort.dir, crate::filetree::SortDir::Asc);
}