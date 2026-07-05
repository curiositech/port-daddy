//! GPUI-free tests for pd-console command-line parsing and display selection.
//! The real binary is feature-gated behind gpui, but these contracts are pure
//! enough to test without opening a window or requiring physical displays.

#[path = "../src/cli_args.rs"]
mod cli_args;

use cli_args::{parse_console_args, resolve_display_selector};

#[test]
fn parses_pane_display_and_list_flags() {
    let args = parse_console_args([
        "pd-console",
        "--pane",
        "sorties",
        "--display",
        "2",
        "--list-displays",
    ]);

    assert_eq!(args.initial_pane.as_deref(), Some("sorties"));
    assert_eq!(args.display_selector.as_deref(), Some("2"));
    assert!(args.list_displays);
}

#[test]
fn missing_display_value_falls_back_to_primary() {
    let args = parse_console_args(["pd-console", "--display"]);

    assert!(args.display_selector.is_none());
    assert!(!args.list_displays);
}

#[test]
fn display_selector_accepts_zero_based_index() {
    let displays = [
        (10_u32, Some("primary".into())),
        (20_u32, Some("virtual".into())),
    ];
    let selection = resolve_display_selector(Some("1"), &displays);

    assert_eq!(selection.display_id, Some(20));
    assert!(selection.warning.is_none());
}

#[test]
fn display_selector_warns_and_uses_primary_for_out_of_range_index() {
    let displays = [(10_u32, Some("primary".into()))];
    let selection = resolve_display_selector(Some("7"), &displays);

    assert_eq!(selection.display_id, None);
    assert_eq!(
        selection.warning.as_deref(),
        Some("pd-console: --display 7 out of range (1 display(s)); using primary")
    );
}

#[test]
fn display_selector_accepts_uuid_case_insensitively() {
    let displays = [
        (10_u32, Some("11111111-1111-1111-1111-111111111111".into())),
        (20_u32, Some("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE".into())),
    ];
    let selection =
        resolve_display_selector(Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), &displays);

    assert_eq!(selection.display_id, Some(20));
    assert!(selection.warning.is_none());
}

#[test]
fn display_selector_warns_and_uses_primary_for_unknown_uuid() {
    let displays = [(10_u32, Some("11111111-1111-1111-1111-111111111111".into()))];
    let selection =
        resolve_display_selector(Some("22222222-2222-2222-2222-222222222222"), &displays);

    assert_eq!(selection.display_id, None);
    assert_eq!(
        selection.warning.as_deref(),
        Some(
            "pd-console: --display '22222222-2222-2222-2222-222222222222' matched no display; using primary"
        )
    );
}

#[test]
fn display_selector_warns_when_virtual_display_is_missing() {
    let displays = [(10_u32, Some("physical-display".into()))];
    let selection = resolve_display_selector(Some("virtual-display-uuid"), &displays);

    assert_eq!(selection.display_id, None);
    assert_eq!(
        selection.warning.as_deref(),
        Some("pd-console: --display 'virtual-display-uuid' matched no display; using primary")
    );
}
