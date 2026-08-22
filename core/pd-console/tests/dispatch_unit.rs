//! Runs the Dispatch review gate's unit tests in a gpui-free target (same reason
//! as `ledger_unit.rs`: the pd-console binary test build SIGBUSes rustc on this
//! machine). `dispatch_pane.rs` depends only on gpui-free modules, so its
//! `#[cfg(test)] mod tests` (queue rendering, utf8-safe truncation, tolerant
//! decode, and the head-of-queue gate plumbing) compiles and runs here.

#[path = "../src/agent.rs"]
mod agent;
// agent.rs resolves the stable-berth default via crate::berths (daemon
// discovery's final fallback), so every target hosting agent.rs must also
// host the berths module.
#[path = "../src/berths.rs"]
mod berths;
#[path = "../src/dispatch_pane.rs"]
mod dispatch_pane;
#[path = "../src/pane.rs"]
mod pane;
#[path = "../src/theme.rs"]
mod theme;
#[path = "../src/util.rs"]
mod util;

#[test]
fn dispatch_module_links_without_gpui() {
    use pane::Pane;
    let pane = dispatch_pane::DispatchQueuePane::new();
    assert!(
        !pane.view().is_empty(),
        "empty queue still renders a header + chip"
    );
    assert!(pane.head().is_none(), "empty queue has no head");
}
