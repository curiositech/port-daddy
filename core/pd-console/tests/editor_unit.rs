//! Runs the Harbor Editor pane's unit tests in a gpui-free target.
//!
//! The pd-console *binary* test build links the entire gpui shell, which exceeds
//! this machine's compiler memory (rustc SIGBUS) — same reason as
//! `ledger_unit.rs` / `dispatch_unit.rs`. `editor.rs` depends only on gpui-free
//! modules (`pane`, `agent`), so we re-host its module chain here via `#[path]`.
//! The `#[cfg(test)] mod tests` inside `editor.rs` compiles and runs as part of
//! this lightweight integration target.

#[path = "../src/theme.rs"]
mod theme;
#[path = "../src/agent.rs"]
mod agent;
#[path = "../src/util.rs"]
mod util;
#[path = "../src/pane.rs"]
mod pane;
#[path = "../src/editor.rs"]
mod editor;

// A direct probe so this file has at least one top-level test; the substance is
// the re-hosted `editor::tests` module above.
#[test]
fn editor_module_links_without_gpui() {
    use pane::Pane;
    let p = editor::EditorPane::new("/etc/hosts");
    // An unloaded editor still renders a header (never panics, never empty).
    assert!(!p.view().is_empty());
    assert_eq!(p.id(), "editor");
}

#[test]
fn editor_loads_a_real_file_and_numbers_lines() {
    use pane::{Block, Pane};
    // The crate root is this test binary's cwd, so a repo-relative path resolves.
    let p = editor::EditorPane::loaded("src/pane.rs", None);
    let rows = p
        .view()
        .into_iter()
        .filter_map(|b| if let Block::Row(cols) = b { Some(cols) } else { None })
        .collect::<Vec<_>>();
    assert!(rows.len() > 20, "pane.rs has many lines; got {} rows", rows.len());
    // The first gutter cell is the right-aligned line number "1".
    assert_eq!(rows[0][0].trim(), "1");
}
