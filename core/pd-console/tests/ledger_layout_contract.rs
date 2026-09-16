//! Source contract for the real GPUI metadata-ledger renderer.
//!
//! GPUI 0.2.2 does not expose framebuffer readback in its headless test
//! platform, so the terminal and PNG faces prove deterministic geometry while
//! this test pins the native renderer's overflow-critical declarations.

const APP_RS: &str = include_str!("../src/app.rs");

fn ledger_header_renderer() -> &'static str {
    let start = APP_RS
        .find("fn render_ledger_header(")
        .expect("native ledger header renderer must exist");
    let rest = &APP_RS[start..];
    let end = rest
        .find("/// One responsive ledger row")
        .expect("ledger row renderer must follow the header renderer");
    &rest[..end]
}

fn ledger_row_renderer() -> &'static str {
    let start = APP_RS
        .find("fn render_ledger_row(")
        .expect("native ledger row renderer must exist");
    let rest = &APP_RS[start..];
    let end = rest
        .find("/// One clickable FileTree row")
        .expect("file tree renderer must follow the ledger row renderer");
    &rest[..end]
}

#[test]
fn sort_controls_wrap_instead_of_forcing_horizontal_overflow() {
    let renderer = ledger_header_renderer();
    assert!(
        renderer.contains(".flex_wrap()"),
        "sort controls must wrap at narrow widths:\n{renderer}"
    );
    assert!(
        !renderer.contains(".overflow_hidden()"),
        "sort controls must never hide an unavailable column:\n{renderer}"
    );
}

#[test]
fn metadata_cells_wrap_full_values_and_never_install_a_truncation_path() {
    let renderer = ledger_row_renderer();
    for required in [".flex_wrap()", ".max_w_full()", ".whitespace_normal()"] {
        assert!(
            renderer.contains(required),
            "ledger rows require {required} for narrow responsive wrapping:\n{renderer}"
        );
    }
    for forbidden in [
        ".overflow_hidden()",
        "text_ellipsis",
        "trunc_chars",
        "truncate",
    ] {
        assert!(
            !renderer.contains(forbidden),
            "ledger rows must not contain {forbidden}; complete claim identity is the contract:\n{renderer}"
        );
    }
}
