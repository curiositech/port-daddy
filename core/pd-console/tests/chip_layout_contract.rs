//! Source-text contract pin for the Block::Chip full-width-stretch fix.
//!
//! app.rs's `render_block` match arms are gpui-feature-gated and only build
//! under `--features gpui` (real GPU-backed layout, unavailable in this
//! sandbox and not exercised by the default `cargo test` this crate's
//! required CI job runs). headless_capture.rs's own Block::Chip renderer is
//! a fully independent hand-rolled implementation that never had this bug,
//! so it cannot prove this fix either (see the PR body for both points in
//! full). Absent a way to render-test the actual fix, this pins the fix's
//! presence directly in the source, in the same style as this repo's other
//! source-text contract tests (e.g. AccountChip's).

use std::fs;

const APP_RS: &str = include_str!("../src/app.rs");

/// Extract the full `Block::Chip { .. } => { .. }` match arm body as a
/// slice, bounded by the next sibling arm (`Block::Flag {`) so the
/// assertions below can't accidentally match code belonging to some other
/// arm.
fn chip_arm() -> &'static str {
    let start = APP_RS
        .find("Block::Chip { label, tone } => {")
        .expect("Block::Chip match arm must exist in app.rs");
    let rest = &APP_RS[start..];
    let end = rest
        .find("Block::Flag {")
        .expect("Block::Flag arm must follow Block::Chip");
    &rest[..end]
}

#[test]
fn chip_opts_out_of_the_flex_col_stretch_default_via_align_self() {
    let arm = chip_arm();
    assert!(
        arm.contains("el.style().align_self = Some(gpui::AlignItems::Start)"),
        "Block::Chip must set align_self = Start so it does not stretch to the \
         full width of its flex_col() parent (the 2026-08-23 operator-reported \
         Planner Gantt full-bleed banner bug). Found chip arm:\n{arm}"
    );
}

#[test]
fn chip_does_not_regress_to_the_flex_shrink_0_dead_end() {
    let arm = chip_arm();
    // flex_shrink_0 governs MAIN-axis sizing in a flex_col() container
    // (vertical here), not the cross-axis stretch that caused the bug — a
    // regression back to this pattern would silently reintroduce it.
    assert!(
        !arm.contains(".flex_shrink_0()"),
        "Block::Chip must not rely on flex_shrink_0 to prevent full-width \
         stretch — it has no effect on cross-axis (horizontal) sizing in a \
         flex_col() container; only align_self does. Found chip arm:\n{arm}"
    );
}

#[test]
fn row_keeps_the_stretch_default_it_actually_wants() {
    // Regression pin for the fix's own stated boundary: Block::Row's outer
    // wrapper deliberately keeps the flex_col() stretch default (a table
    // row should span full width) and must NOT gain an align_self override
    // by copy-paste drift from the Chip fix.
    let start = APP_RS
        .find("Block::Row(cells) => div()")
        .expect("Block::Row match arm must exist in app.rs");
    let rest = &APP_RS[start..];
    let end = rest
        .find("Block::ChatTurn {")
        .expect("Block::ChatTurn arm must follow Block::Row");
    let row_arm = &rest[..end];
    assert!(
        !row_arm.contains("align_self"),
        "Block::Row's own wrapper div must keep the stretch default (rows \
         should span full width) — an align_self override here would be an \
         unintended regression, not a fix. Found row arm:\n{row_arm}"
    );
}

#[test]
fn the_test_file_itself_is_reachable_from_disk() {
    // Cheap sanity check that include_str! is reading the real file this
    // crate ships (not a stale copy), so a future rename of app.rs fails
    // loudly here instead of the assertions above silently going moot.
    let on_disk = fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/app.rs"))
        .expect("src/app.rs must exist on disk");
    assert_eq!(on_disk, APP_RS, "include_str! and fs::read_to_string diverge");
}
