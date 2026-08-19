// Consumed by the gpui `pd-console` bin (the daemon picker); the no-gpui repl
// bin compiles the module for its tests but doesn't call it, so allow dead_code.
#![allow(dead_code)]
//! Named daemon berths (ADR-0084) for pd-console's in-app daemon picker.
//!
//! Mirrors the Swift `BerthDirectory`: read `~/.port-daddy/dev-daemons.json`
//! (the registry `pd dev up` writes) and synthesize the always-present canonical
//! stable berth, so the operator can switch which daemon the console talks to by
//! NAME, not by remembering a port. fs-only and pure — reachability probing and
//! the actual rebind live in the console's async layer.

use serde::Deserialize;
use std::path::PathBuf;

/// The canonical stable/brew daemon lane (shared/daemon-berths.ts).
pub const STABLE_PORT: u16 = 9876;
/// The shared dev-latest lane.
pub const DEV_LATEST_PORT: u16 = 9886;

/// One record in `~/.port-daddy/dev-daemons.json` (the TS `DevDaemonRecord`).
/// Only the fields the picker needs are decoded; unknown fields are ignored.
#[derive(Debug, Clone, Deserialize)]
pub struct DevDaemonRecord {
    pub label: String,
    pub tier: String,
    pub port: u16,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default, rename = "gitRev")]
    pub git_rev: Option<String>,
}

/// A selectable daemon: a name, a tier, a port, and whether it is the canonical
/// stable lane (which can never be stopped from here).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Berth {
    pub label: String,
    pub tier: String,
    pub port: u16,
    pub canonical: bool,
}

impl Berth {
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// Menu label — name first, port as the disambiguator ("dev-latest · :9886").
    pub fn display(&self) -> String {
        format!("{} · :{}", self.label, self.port)
    }
}

/// Base URL of the canonical stable daemon on this machine.
///
/// Why this exists: startup daemon discovery ([`crate::agent::DaemonClient::discover`])
/// must never strand the operator at a panic when no `daemon.port` file exists —
/// the design intent is that a fresh console always opens against the one port
/// the stable daemon is contractually berthed on, and shows "unreachable" state
/// in-pane if nothing is listening. Centralizing the URL here keeps the port
/// literal in the single allowlisted berth module rather than scattering
/// hardcoded daemon URLs (which the no-hardcoded-daemon-url guard forbids).
///
/// Returns the stable berth's `http://127.0.0.1:<STABLE_PORT>` base URL.
pub fn stable_url() -> String {
    format!("http://127.0.0.1:{STABLE_PORT}")
}

fn registry_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".port-daddy/dev-daemons.json"))
}

/// Parse the dev-daemons registry JSON; a malformed/empty file yields no records
/// (the stable berth is still synthesized by [`discover`]).
pub fn parse_registry(json: &str) -> Vec<DevDaemonRecord> {
    serde_json::from_str(json).unwrap_or_default()
}

/// Build the berth list from a registry payload: the canonical stable berth
/// first, then every recorded dev berth, de-duplicated by port (a record on the
/// stable port is dropped — the stable lane is synthesized, never recorded).
pub fn berths_from_registry(records: Vec<DevDaemonRecord>) -> Vec<Berth> {
    let mut berths = vec![Berth {
        label: "stable".to_string(),
        tier: "stable".to_string(),
        port: STABLE_PORT,
        canonical: true,
    }];
    let mut seen = vec![STABLE_PORT];
    for rec in records {
        if seen.contains(&rec.port) {
            continue;
        }
        seen.push(rec.port);
        berths.push(Berth {
            label: rec.label,
            tier: rec.tier,
            port: rec.port,
            canonical: false,
        });
    }
    berths
}

/// All known berths on this machine (fs read of the registry + synthesized
/// stable berth). Never fails — a missing/garbled registry just yields the
/// stable berth alone.
pub fn discover() -> Vec<Berth> {
    let records = registry_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| parse_registry(&s))
        .unwrap_or_default();
    berths_from_registry(records)
}

/// Resolve a `:use`-style target to a berth: match by label (case-insensitive),
/// then by `:port`/port, then the tier aliases "stable" and "dev-latest".
pub fn resolve<'a>(berths: &'a [Berth], target: &str) -> Option<&'a Berth> {
    let t = target.trim();
    if let Some(b) = berths.iter().find(|b| b.label.eq_ignore_ascii_case(t)) {
        return Some(b);
    }
    if let Ok(port) = t.trim_start_matches(':').parse::<u16>() {
        if let Some(b) = berths.iter().find(|b| b.port == port) {
            return Some(b);
        }
    }
    match t.to_ascii_lowercase().as_str() {
        "stable" | "prod" => berths.iter().find(|b| b.port == STABLE_PORT),
        "dev-latest" | "latest" => berths.iter().find(|b| b.port == DEV_LATEST_PORT),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Doubled-hash raw string: the JSON colour literals contain `"#`, which would
    // close an `r#"…"#` string early.
    const SAMPLE: &str = r##"[
        {"label":"dev-latest","tier":"dev-latest","port":9886,"color":"#3B82F6","gitRev":"abc1234","pid":42,"startedAt":"2026-06-26T00:00:00Z"},
        {"label":"my-feature","tier":"codebase","port":9912,"color":"#A855F7","pid":43}
    ]"##;

    #[test]
    fn parses_records_ignoring_unknown_fields() {
        let recs = parse_registry(SAMPLE);
        assert_eq!(recs.len(), 2);
        assert_eq!(recs[0].label, "dev-latest");
        assert_eq!(recs[0].port, 9886);
        assert_eq!(recs[1].tier, "codebase");
    }

    #[test]
    fn malformed_registry_yields_no_records() {
        assert!(parse_registry("not json").is_empty());
        assert!(parse_registry("").is_empty());
    }

    #[test]
    fn synthesizes_stable_first_then_dev_berths() {
        let berths = berths_from_registry(parse_registry(SAMPLE));
        assert_eq!(berths.len(), 3);
        assert_eq!(berths[0].label, "stable");
        assert!(berths[0].canonical);
        assert_eq!(berths[0].port, STABLE_PORT);
        assert_eq!(berths[1].label, "dev-latest");
        assert!(!berths[1].canonical);
        assert_eq!(berths[2].label, "my-feature");
    }

    #[test]
    fn drops_a_record_squatting_on_the_stable_port() {
        let recs = parse_registry(r#"[{"label":"impostor","tier":"codebase","port":9876}]"#);
        let berths = berths_from_registry(recs);
        assert_eq!(berths.len(), 1);
        assert_eq!(berths[0].label, "stable");
    }

    #[test]
    fn url_and_display_are_name_first() {
        let berths = berths_from_registry(parse_registry(SAMPLE));
        assert_eq!(berths[1].url(), "http://127.0.0.1:9886");
        assert_eq!(berths[1].display(), "dev-latest · :9886");
    }

    #[test]
    fn resolves_by_label_port_and_tier_alias() {
        let berths = berths_from_registry(parse_registry(SAMPLE));
        assert_eq!(resolve(&berths, "my-feature").unwrap().port, 9912);
        assert_eq!(resolve(&berths, "MY-FEATURE").unwrap().port, 9912);
        assert_eq!(resolve(&berths, ":9886").unwrap().label, "dev-latest");
        assert_eq!(resolve(&berths, "9876").unwrap().label, "stable");
        assert_eq!(resolve(&berths, "latest").unwrap().port, DEV_LATEST_PORT);
        assert_eq!(resolve(&berths, "prod").unwrap().port, STABLE_PORT);
        assert!(resolve(&berths, "nope").is_none());
    }
}
