//! The launcher grid — the "Jump to a pane" tiles and their 1:1 binding to the
//! producer's pane slots.
//!
//! This is **data, not UI**: deliberately free of any `gpui` dependency so it
//! compiles into *both* bins — the `gpui` console (`main.rs`) and the headless
//! REPL (`bin/repl.rs`), which is the rust-console CI gate. That's what lets the
//! 1:1 invariant tests below actually run in CI; if this lived in `app.rs` (which
//! only the `gpui` bin builds) the gate would never see them.
//!
//! The invariant: tile *N* in [`NAV`] addresses producer slot *N*, whose pane id
//! is [`SLOT_PANE_IDS`]`[N]`. A `debug_assert!` in `main.rs` pins `SLOT_PANE_IDS`
//! to the real constructed pane objects; the tests here pin [`NAV`] to it and
//! guarantee every tile has a distinct, on-disk icon. Add a pane → update all
//! three (NAV, SLOT_PANE_IDS, the producer) or the gate turns red.

// ── Nav items ────────────────────────────────────────────────────────────────

#[allow(dead_code)] // label/icon retained for the title-bar + surface picker
pub struct NavItem {
    pub id: &'static str,
    pub label: &'static str,
    /// SVG asset path (custom stroke icons — never emoji; operator rule).
    pub icon: &'static str,
    pub key: &'static str,
}

pub const NAV: &[NavItem] = &[
    NavItem { id: "fleet",    label: "Fleet",    icon: "icons/nav/fleet.svg",    key: "1" },
    NavItem { id: "cockpit",  label: "Cockpit",  icon: "icons/nav/cockpit.svg",  key: "2" },
    NavItem { id: "sorties",  label: "Runs",     icon: "icons/nav/sorties.svg",  key: "3" },
    NavItem { id: "claims",   label: "Claims",   icon: "icons/nav/claims.svg",   key: "4" },
    NavItem { id: "peek",     label: "Peek",     icon: "icons/nav/peek.svg",     key: "5" },
    NavItem { id: "planner",  label: "Planner",  icon: "icons/nav/roadmap.svg",  key: "6" },
    NavItem { id: "adrs",     label: "ADRs",     icon: "icons/nav/adrs.svg",     key: "7" },
    NavItem { id: "activity", label: "Activity", icon: "icons/nav/activity.svg", key: "8" },
    NavItem { id: "sessions", label: "Agents", icon: "icons/nav/sessions.svg", key: "9" },
    NavItem { id: "inbox",    label: "Inbox",    icon: "icons/nav/inbox.svg",    key: "0" },
    NavItem { id: "suggest",  label: "Suggest",  icon: "icons/nav/suggest.svg",  key: "s" },
    NavItem { id: "memory",   label: "Memory",   icon: "icons/nav/memory.svg",   key: "m" },
    NavItem { id: "prs",      label: "PRs",      icon: "icons/nav/prs.svg",      key: "p" },
    NavItem { id: "health",   label: "Health",   icon: "icons/nav/health.svg",   key: "h" },
    NavItem { id: "coast-guard", label: "C.Guard", icon: "icons/nav/coast.svg", key: "c" },
    NavItem { id: "dispatch", label: "Gates",    icon: "icons/nav/dispatch.svg", key: "d" },
    NavItem { id: "lane",     label: "Lane",     icon: "icons/nav/lane.svg",     key: "l" },
    NavItem { id: "ledger",   label: "Cost",     icon: "icons/nav/ledger.svg",   key: "b" },
    NavItem { id: "lineage",  label: "Lineage",  icon: "icons/nav/lineage.svg",  key: "g" },
    NavItem { id: "substrate",label: "Substrate",icon: "icons/nav/substrate.svg",key: "y" },
    NavItem { id: "parley",   label: "Parley",   icon: "icons/nav/parley.svg",   key: "j" },
    NavItem { id: "conductor",label: "Conductor",icon: "icons/nav/conductor.svg",key: "k" },
    NavItem { id: "daemons",  label: "Daemons",  icon: "icons/nav/daemons.svg",  key: "e" },
    NavItem { id: "cloud-fleet", label: "Cloud Fleet", icon: "icons/nav/cloud-fleet.svg", key: "f" },
    NavItem { id: "active-agents", label: "Harness", icon: "icons/nav/agents.svg", key: "a" },
    NavItem { id: "harbor",   label: "Harbor",   icon: "icons/nav/harbor.svg",   key: "r" },
    NavItem { id: "sextant",  label: "Sextant",  icon: "icons/nav/galaxy.svg",   key: "x" },
    NavItem { id: "interruptions", label: "HITL", icon: "icons/nav/interruptions.svg", key: "i" },
];

/// Canonical slot → pane-id map: the single source of truth the producer thread
/// (`main.rs`) builds one pane per, in this exact order. The grid ([`NAV`]) and
/// the producer slots MUST stay 1:1 with this list — a `debug_assert!` in
/// `main.rs` pins it to the real constructed pane objects, and
/// `grid_is_one_to_one_with_pane_slots` (below) pins it to [`NAV`]. Add a pane
/// here, in [`NAV`], and in the producer — or the gate turns red. Order is
/// load-bearing (slot index == NAV index == producer index).
pub const SLOT_PANE_IDS: [&str; 28] = [
    "fleet", "cockpit", "sorties", "claims", "peek", "planner", "adrs",
    "activity", "sessions", "inbox", "suggest", "memory", "prs", "health",
    "coast-guard", "dispatch", "lane", "ledger", "lineage", "substrate", "parley",
    "conductor", "daemons", "cloud-fleet", "active-agents", "harbor", "sextant",
    "interruptions",
];

// ── Launcher-grid 1:1 invariants ────────────────────────────────────────────
// These run in the headless REPL bin, so the rust-console gate enforces them.

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::path::Path;

    #[test]
    fn grid_is_one_to_one_with_pane_slots() {
        // Same count: every grid tile has exactly one producer slot, no orphans.
        assert_eq!(
            NAV.len(),
            SLOT_PANE_IDS.len(),
            "grid tiles ({}) must equal pane slots ({}) — a tile with no pane, or a pane with no tile",
            NAV.len(),
            SLOT_PANE_IDS.len(),
        );
        // Same order: grid tile N addresses producer slot N (NAV index == slot index).
        for (i, nav) in NAV.iter().enumerate() {
            assert_eq!(
                nav.id, SLOT_PANE_IDS[i],
                "grid tile {i} ('{}') is misaligned with producer slot {i} ('{}') — \
                 reorder NAV and SLOT_PANE_IDS together",
                nav.id, SLOT_PANE_IDS[i],
            );
        }
    }

    #[test]
    fn grid_ids_and_keys_are_unique() {
        let mut ids = HashSet::new();
        let mut keys = HashSet::new();
        for nav in NAV {
            assert!(ids.insert(nav.id), "duplicate grid id: '{}'", nav.id);
            assert!(
                keys.insert(nav.key),
                "duplicate leader key '{}' (tile '{}')",
                nav.key,
                nav.id
            );
            // The launcher lowercases the operator's query (`surface_for_query`),
            // so an uppercase key is unreachable — and shadows its lowercase twin.
            assert_eq!(
                nav.key,
                nav.key.to_lowercase(),
                "leader key '{}' (tile '{}') must be lowercase — launcher queries are lowercased",
                nav.key,
                nav.id,
            );
        }
    }

    #[test]
    fn every_grid_tile_has_a_unique_icon() {
        let mut seen: HashSet<&str> = HashSet::new();
        for nav in NAV {
            assert!(
                seen.insert(nav.icon),
                "grid tile '{}' reuses icon '{}' — every pane type needs its own icon",
                nav.id,
                nav.icon,
            );
        }
    }

    #[test]
    fn every_grid_icon_file_exists() {
        let assets = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets");
        for nav in NAV {
            let path = assets.join(nav.icon);
            assert!(
                path.is_file(),
                "grid tile '{}' points at a missing icon: {} (looked in {})",
                nav.id,
                nav.icon,
                path.display(),
            );
        }
    }
}
