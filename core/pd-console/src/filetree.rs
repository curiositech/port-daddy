//! Pure FileTree navigator logic — the state and algorithms behind the
//! pd-console "files" surface's browser-style upgrade (history back/up, dynamic
//! sort, metadata columns). Deliberately **gpui-free** so it compiles in the
//! headless repl bin and is fully unit-tested (`cargo test -p pd-console`).
//!
//! The GPUI wiring (clickable rows, key handling, column headers) lives in
//! `app.rs`; this module owns the render-agnostic model it drives.

use std::path::{Path, PathBuf};

/// The type of a directory entry, as the operator sees it (dir / file /
/// symlink). Classified from the entry's own file-type, so a symlink is a
/// symlink regardless of what it points at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    Dir,
    Symlink,
    File,
}

impl FileKind {
    /// Short column label.
    pub fn label(self) -> &'static str {
        match self {
            FileKind::Dir => "dir",
            FileKind::Symlink => "link",
            FileKind::File => "file",
        }
    }
    /// Ordering rank for the Type column (dirs, then links, then files).
    fn rank(self) -> u8 {
        match self {
            FileKind::Dir => 0,
            FileKind::Symlink => 1,
            FileKind::File => 2,
        }
    }
}

/// One entry's metadata, ready for the list view.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileMeta {
    /// Basename (no trailing slash — the renderer adds a marker).
    pub name: String,
    /// Absolute path to open / descend into.
    pub path: String,
    pub kind: FileKind,
    /// Size in bytes (entry's own len; for a dir this is the directory node
    /// size the FS reports, shown as `--` in the UI).
    pub size: u64,
    /// Modified time, whole seconds since the Unix epoch (0 if unavailable).
    pub mtime: i64,
}

impl FileMeta {
    pub fn is_dir(&self) -> bool {
        self.kind == FileKind::Dir
    }
}

/// Which column the listing is sorted by.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortColumn {
    Name,
    Type,
    Size,
    Mtime,
}

/// Sort direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortDir {
    Asc,
    Desc,
}

impl SortDir {
    fn flip(self) -> SortDir {
        match self {
            SortDir::Asc => SortDir::Desc,
            SortDir::Desc => SortDir::Asc,
        }
    }
    pub fn arrow(self) -> &'static str {
        match self {
            SortDir::Asc => "^",
            SortDir::Desc => "v",
        }
    }
}

/// The current sort selection. Sticks in the surface state (req #6 "the choice
/// sticks").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileSort {
    pub column: SortColumn,
    pub dir: SortDir,
}

impl Default for FileSort {
    fn default() -> Self {
        FileSort { column: SortColumn::Name, dir: SortDir::Asc }
    }
}

impl FileSort {
    /// Toggle behavior when the operator picks a column: choosing the *same*
    /// column flips direction; choosing a *new* column selects it ascending.
    pub fn toggle(&mut self, column: SortColumn) {
        if self.column == column {
            self.dir = self.dir.flip();
        } else {
            self.column = column;
            self.dir = SortDir::Asc;
        }
    }
}

/// Browser-style back stack of directories the operator navigated *away from*.
/// `visit(from)` records leaving `from`; `back()` returns the last such dir.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NavHistory {
    back: Vec<String>,
}

impl NavHistory {
    /// Record that we are leaving `from` (descend / up). Coalesces a repeated
    /// entry so the back button never stutters on a no-op move.
    pub fn visit(&mut self, from: impl Into<String>) {
        let from = from.into();
        if self.back.last().map(|s| s.as_str()) != Some(from.as_str()) {
            self.back.push(from);
        }
    }
    /// Pop the previous directory, if any (the Back action).
    pub fn back(&mut self) -> Option<String> {
        self.back.pop()
    }
    pub fn can_back(&self) -> bool {
        !self.back.is_empty()
    }
    pub fn depth(&self) -> usize {
        self.back.len()
    }
}

/// All the mutable state the FileTree surface carries across re-renders and
/// pane switches (req #1 state memory, #2 back, #6 sticky sort). Stored on the
/// `SurfaceKind::FileTree` variant so it lives in the workspace tree.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FileNav {
    pub history: NavHistory,
    pub sort: FileSort,
    /// Keyboard selection cursor (row index within the current listing).
    pub cursor: usize,
}

impl FileNav {
    /// Descend from `current` into `child`: remember where we were and reset the
    /// cursor to the top of the new listing.
    pub fn descend(&mut self, current: impl Into<String>) {
        self.history.visit(current);
        self.cursor = 0;
    }
    /// Go back one step; returns the directory to show, or `None` if the stack
    /// is empty. Resets the cursor.
    pub fn back(&mut self) -> Option<String> {
        let prev = self.history.back();
        if prev.is_some() {
            self.cursor = 0;
        }
        prev
    }
    /// Clamp the cursor into `[0, len)` (len 0 → cursor 0). Called after a
    /// listing is produced so a stale cursor never points off the end.
    pub fn clamp_cursor(&mut self, len: usize) {
        if len == 0 {
            self.cursor = 0;
        } else if self.cursor >= len {
            self.cursor = len - 1;
        }
    }
    /// Move the cursor by `delta` rows within a listing of `len`, saturating at
    /// the ends (no wrap — arrow keys stop at top/bottom like a real list).
    pub fn move_cursor(&mut self, delta: isize, len: usize) {
        if len == 0 {
            self.cursor = 0;
            return;
        }
        let max = len - 1;
        let next = self.cursor as isize + delta;
        self.cursor = next.clamp(0, max as isize) as usize;
    }
}

/// Resolve the parent of `path`. Returns `None` at a filesystem root (`/`).
/// Trailing slashes are normalized first (`/a/b/` → parent `/a`).
pub fn parent_path(path: &str) -> Option<String> {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        // path was "/" (or all slashes): already at root.
        return None;
    }
    let p = Path::new(trimmed);
    p.parent().map(|par| {
        if par.as_os_str().is_empty() {
            // e.g. a bare relative "foo" → parent is "." for navigation.
            ".".to_string()
        } else {
            par.to_string_lossy().into_owned()
        }
    })
}

/// Format a byte count as a compact human-readable string (base-1024). Whole
/// bytes stay `B`; larger units carry one decimal place (`1.5 KB`).
pub fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 6] = ["B", "KB", "MB", "GB", "TB", "PB"];
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let mut value = bytes as f64;
    let mut unit = 0usize;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    format!("{value:.1} {}", UNITS[unit])
}

/// Sort a listing in place by the selected column + direction. A case-folded
/// name is the stable tiebreaker for every column so equal keys keep a
/// deterministic order.
pub fn sort_entries(entries: &mut [FileMeta], sort: FileSort) {
    entries.sort_by(|a, b| {
        let name_key = a.name.to_lowercase().cmp(&b.name.to_lowercase());
        let primary = match sort.column {
            SortColumn::Name => name_key.clone(),
            SortColumn::Type => a.kind.rank().cmp(&b.kind.rank()).then(name_key.clone()),
            SortColumn::Size => a.size.cmp(&b.size).then(name_key.clone()),
            SortColumn::Mtime => a.mtime.cmp(&b.mtime).then(name_key.clone()),
        };
        match sort.dir {
            SortDir::Asc => primary,
            SortDir::Desc => primary.reverse(),
        }
    });
}

/// Read a directory's immediate children as [`FileMeta`]. Uses the entry's own
/// metadata (does not follow symlinks) so a broken link is still listed. Bounded
/// so an absurd directory can never wedge the render path.
pub fn list_dir(dir: &str) -> Result<Vec<FileMeta>, String> {
    let mut out: Vec<FileMeta> = Vec::new();
    let read = std::fs::read_dir(dir).map_err(|e| format!("{dir}: {e}"))?;
    for ent in read.flatten() {
        let path: PathBuf = ent.path();
        let name = ent.file_name().to_string_lossy().into_owned();
        // symlink_metadata never traverses the link — classify the entry itself.
        let (kind, size, mtime) = match std::fs::symlink_metadata(&path) {
            Ok(md) => {
                let ft = md.file_type();
                let kind = if ft.is_symlink() {
                    FileKind::Symlink
                } else if ft.is_dir() {
                    FileKind::Dir
                } else {
                    FileKind::File
                };
                let mtime = md
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);
                (kind, md.len(), mtime)
            }
            Err(_) => (FileKind::File, 0, 0),
        };
        out.push(FileMeta { name, path: path.to_string_lossy().into_owned(), kind, size, mtime });
        if out.len() >= 1000 {
            break;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(name: &str, kind: FileKind, size: u64, mtime: i64) -> FileMeta {
        FileMeta { name: name.into(), path: format!("/root/{name}"), kind, size, mtime }
    }

    // ── nav-history stack (push / back) ─────────────────────────────────────
    #[test]
    fn nav_history_back_returns_previous_dirs_lifo() {
        let mut h = NavHistory::default();
        assert!(!h.can_back());
        h.visit("/a");
        h.visit("/a/b");
        assert_eq!(h.depth(), 2);
        assert!(h.can_back());
        assert_eq!(h.back(), Some("/a/b".into()));
        assert_eq!(h.back(), Some("/a".into()));
        assert_eq!(h.back(), None);
        assert!(!h.can_back());
    }

    #[test]
    fn nav_history_coalesces_repeats() {
        let mut h = NavHistory::default();
        h.visit("/a");
        h.visit("/a");
        assert_eq!(h.depth(), 1, "leaving the same dir twice records it once");
    }

    #[test]
    fn filenav_descend_then_back_round_trips_and_resets_cursor() {
        let mut nav = FileNav::default();
        nav.cursor = 5;
        nav.descend("/repo"); // was at /repo, descending into a child
        assert_eq!(nav.cursor, 0, "descend parks the cursor at the top");
        nav.cursor = 3;
        assert_eq!(nav.back(), Some("/repo".into()));
        assert_eq!(nav.cursor, 0, "back resets the cursor");
        assert_eq!(nav.back(), None);
    }

    // ── up navigation via parent_path ───────────────────────────────────────
    #[test]
    fn parent_path_walks_up_and_stops_at_root() {
        assert_eq!(parent_path("/a/b/c").as_deref(), Some("/a/b"));
        assert_eq!(parent_path("/a").as_deref(), Some("/"));
        assert_eq!(parent_path("/"), None);
        assert_eq!(parent_path("///"), None);
    }

    #[test]
    fn parent_path_normalizes_trailing_slash() {
        assert_eq!(parent_path("/a/b/").as_deref(), Some("/a"));
    }

    // ── human size formatting ───────────────────────────────────────────────
    #[test]
    fn human_size_covers_unit_boundaries() {
        assert_eq!(human_size(0), "0 B");
        assert_eq!(human_size(512), "512 B");
        assert_eq!(human_size(1023), "1023 B");
        assert_eq!(human_size(1024), "1.0 KB");
        assert_eq!(human_size(1536), "1.5 KB");
        assert_eq!(human_size(1024 * 1024), "1.0 MB");
        assert_eq!(human_size(3 * 1024 * 1024 * 1024), "3.0 GB");
    }

    // ── sort toggle semantics ───────────────────────────────────────────────
    #[test]
    fn sort_toggle_flips_same_column_and_resets_new_one() {
        let mut s = FileSort::default();
        assert_eq!(s.column, SortColumn::Name);
        assert_eq!(s.dir, SortDir::Asc);
        s.toggle(SortColumn::Name);
        assert_eq!(s.dir, SortDir::Desc, "same column flips direction");
        s.toggle(SortColumn::Size);
        assert_eq!(s.column, SortColumn::Size);
        assert_eq!(s.dir, SortDir::Asc, "new column resets to ascending");
    }

    // ── sort comparator over (name,size,mtime,type) × direction ─────────────
    #[test]
    fn sort_by_name_asc_and_desc() {
        let mut v = vec![
            meta("banana", FileKind::File, 1, 1),
            meta("Apple", FileKind::File, 1, 1),
            meta("cherry", FileKind::File, 1, 1),
        ];
        sort_entries(&mut v, FileSort { column: SortColumn::Name, dir: SortDir::Asc });
        assert_eq!(names(&v), ["Apple", "banana", "cherry"]);
        sort_entries(&mut v, FileSort { column: SortColumn::Name, dir: SortDir::Desc });
        assert_eq!(names(&v), ["cherry", "banana", "Apple"]);
    }

    #[test]
    fn sort_by_size_then_mtime() {
        let mut v = vec![
            meta("small", FileKind::File, 10, 100),
            meta("big", FileKind::File, 9000, 100),
            meta("mid", FileKind::File, 500, 100),
        ];
        sort_entries(&mut v, FileSort { column: SortColumn::Size, dir: SortDir::Asc });
        assert_eq!(names(&v), ["small", "mid", "big"]);

        let mut w = vec![
            meta("old", FileKind::File, 1, 100),
            meta("new", FileKind::File, 1, 900),
            meta("mid", FileKind::File, 1, 500),
        ];
        sort_entries(&mut w, FileSort { column: SortColumn::Mtime, dir: SortDir::Desc });
        assert_eq!(names(&w), ["new", "mid", "old"]);
    }

    #[test]
    fn sort_by_type_groups_dirs_then_links_then_files() {
        let mut v = vec![
            meta("z_file", FileKind::File, 1, 1),
            meta("a_link", FileKind::Symlink, 1, 1),
            meta("m_dir", FileKind::Dir, 1, 1),
        ];
        sort_entries(&mut v, FileSort { column: SortColumn::Type, dir: SortDir::Asc });
        assert_eq!(names(&v), ["m_dir", "a_link", "z_file"]);
    }

    // ── cursor movement saturates ───────────────────────────────────────────
    #[test]
    fn cursor_moves_and_saturates_at_ends() {
        let mut nav = FileNav::default();
        nav.move_cursor(-1, 4);
        assert_eq!(nav.cursor, 0, "cannot go above the first row");
        nav.move_cursor(2, 4);
        assert_eq!(nav.cursor, 2);
        nav.move_cursor(10, 4);
        assert_eq!(nav.cursor, 3, "clamps to the last row");
        nav.move_cursor(1, 0);
        assert_eq!(nav.cursor, 0, "empty listing parks at 0");
    }

    #[test]
    fn clamp_cursor_pulls_stale_index_into_range() {
        let mut nav = FileNav { cursor: 9, ..Default::default() };
        nav.clamp_cursor(3);
        assert_eq!(nav.cursor, 2);
        nav.clamp_cursor(0);
        assert_eq!(nav.cursor, 0);
    }

    // ── fs listing (integration against a tempdir) ──────────────────────────
    #[test]
    fn list_dir_reads_children_with_kinds_and_sizes() {
        let base = std::env::temp_dir().join(format!("pd-ft-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("sub")).unwrap();
        std::fs::write(base.join("hello.txt"), b"12345").unwrap();
        let dir_str = base.to_string_lossy().into_owned();

        let mut entries = list_dir(&dir_str).expect("listing succeeds");
        sort_entries(&mut entries, FileSort { column: SortColumn::Name, dir: SortDir::Asc });
        assert_eq!(entries.len(), 2);
        let file = entries.iter().find(|e| e.name == "hello.txt").unwrap();
        assert_eq!(file.kind, FileKind::File);
        assert_eq!(file.size, 5);
        let sub = entries.iter().find(|e| e.name == "sub").unwrap();
        assert_eq!(sub.kind, FileKind::Dir);

        let err = list_dir(&base.join("does-not-exist").to_string_lossy()).unwrap_err();
        assert!(err.contains("does-not-exist"), "error names the missing path");
        let _ = std::fs::remove_dir_all(&base);
    }

    fn names(v: &[FileMeta]) -> Vec<String> {
        v.iter().map(|e| e.name.clone()).collect()
    }
}
