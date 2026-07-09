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
    NavItem {
        id: "fleet",
        label: "Fleet",
        icon: "icons/nav/fleet.svg",
        key: "1",
    },
    NavItem {
        id: "sorties",
        label: "Sorties",
        icon: "icons/nav/sorties.svg",
        key: "3",
    },
    NavItem {
        id: "claims",
        label: "Claims",
        icon: "icons/nav/claims.svg",
        key: "4",
    },
    NavItem {
        id: "planner",
        label: "Planner",
        icon: "icons/nav/roadmap.svg",
        key: "6",
    },
    NavItem {
        id: "activity",
        label: "Activity",
        icon: "icons/nav/activity.svg",
        key: "8",
    },
    NavItem {
        id: "sessions",
        label: "Sessions",
        icon: "icons/nav/sessions.svg",
        key: "9",
    },
    NavItem {
        id: "health",
        label: "Health",
        icon: "icons/nav/health.svg",
        key: "h",
    },
    NavItem {
        id: "dispatch",
        label: "Dispatch",
        icon: "icons/nav/dispatch.svg",
        key: "d",
    },
    NavItem {
        id: "lane",
        label: "Lane",
        icon: "icons/nav/lane.svg",
        key: "l",
    },
    NavItem {
        id: "ledger",
        label: "Cost",
        icon: "icons/nav/ledger.svg",
        key: "b",
    },
    NavItem {
        id: "conductor",
        label: "Conductor",
        icon: "icons/nav/conductor.svg",
        key: "k",
    },
    NavItem {
        id: "daemons",
        label: "Daemons",
        icon: "icons/nav/daemons.svg",
        key: "e",
    },
    NavItem {
        id: "harbor",
        label: "Harbor",
        icon: "icons/nav/harbor.svg",
        key: "r",
    },
    NavItem {
        id: "sextant",
        label: "Sextant",
        icon: "icons/nav/galaxy.svg",
        key: "x",
    },
];

/// Canonical slot → pane-id map: the single source of truth the producer thread
/// (`main.rs`) builds one pane per, in this exact order. The grid ([`NAV`]) and
/// the producer slots MUST stay 1:1 with this list — a `debug_assert!` in
/// `main.rs` pins it to the real constructed pane objects, and
/// `grid_is_one_to_one_with_pane_slots` (below) pins it to [`NAV`]. Add a pane
/// here, in [`NAV`], and in the producer — or the gate turns red. Order is
/// load-bearing (slot index == NAV index == producer index).
pub const SLOT_PANE_IDS: [&str; 14] = [
    "fleet",
    "sorties",
    "claims",
    "planner",
    "activity",
    "sessions",
    "health",
    "dispatch",
    "lane",
    "ledger",
    "conductor",
    "daemons",
    "harbor",
    "sextant",
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
