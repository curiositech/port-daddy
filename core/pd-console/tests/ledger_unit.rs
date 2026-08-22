//! Runs the Cost Ledger's unit tests in a gpui-free target.
//!
//! The pd-console *binary* test build links the entire gpui shell, which exceeds
//! this machine's compiler memory (rustc SIGBUS). The ledger's logic — the
//! cost⨝wallet join, burn-bar math, USD formatting — depends only on gpui-free
//! modules, so we re-host its module chain here via `#[path]`. The
//! `#[cfg(test)] mod tests` inside `ledger_pane.rs` compiles and runs as part of
//! this lightweight integration target.

#[path = "../src/agent.rs"]
mod agent;
// agent.rs resolves the stable-berth default via crate::berths (daemon
// discovery's final fallback), so every target hosting agent.rs must also
// host the berths module.
#[path = "../src/berths.rs"]
mod berths;
#[path = "../src/ledger_pane.rs"]
mod ledger_pane;
#[path = "../src/pane.rs"]
mod pane;
#[path = "../src/theme.rs"]
mod theme;
#[path = "../src/util.rs"]
mod util;

// A trivial probe so this file has at least one direct test; the substance is
// the re-hosted `ledger_pane::tests` module above.
#[test]
fn ledger_module_links_without_gpui() {
    let pane = ledger_pane::LedgerPane::new();
    // An empty ledger still renders a header (never panics, never empty).
    use pane::Pane;
    assert!(!pane.view().is_empty());
}
