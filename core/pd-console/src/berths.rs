// Consumed by the gpui `pd-console` bin (the daemon picker); the no-gpui repl
// bin compiles the module for its tests but doesn't call it, so allow dead_code.
#![allow(dead_code)]
//! Named daemon berths (ADR-0084) for pd-console's in-app daemon picker.
//!
//! Mirrors the Swift `BerthDirectory`: read `~/.port-daddy/dev-daemons.json`
//! (the registry `pd dev up` writes) plus the stable daemon's published port
//! file, so the operator can switch which daemon the console talks to by NAME,
//! not by remembering a port. fs-only and pure — reachability probing and the
//! actual rebind live in the console's async layer.

use serde::Deserialize;
use std::path::PathBuf;

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

fn registry_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".port-daddy/dev-daemons.json"))
}

fn stable_port_path() -> Option<PathBuf> {
    std::env::var_os("PORT_DADDY_PORT_FILE")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".port-daddy/daemon.port")))
}

/// Port atomically published by the stable daemon after it binds. An absent or
/// malformed publication is `None`; callers must not guess a replacement.
pub fn stable_port() -> Option<u16> {
    let raw = std::fs::read_to_string(stable_port_path()?).ok()?;
    let port = raw.trim().parse::<u16>().ok()?;
    (port > 0).then_some(port)
}

/// Parse the dev-daemons registry JSON; a malformed/empty file yields no records
/// (the stable berth is still synthesized by [`discover`]).
pub fn parse_registry(json: &str) -> Vec<DevDaemonRecord> {
    serde_json::from_str(json).unwrap_or_default()
}

/// Build the berth list from a registry payload: the canonical stable berth
/// first, then every recorded dev berth, de-duplicated by port. Port zero is an
/// explicit unavailable stable berth when no publication exists; it cannot
/// accidentally contact another process.
pub fn berths_from_registry(
    records: Vec<DevDaemonRecord>,
    published_stable_port: Option<u16>,
) -> Vec<Berth> {
    let stable = published_stable_port.unwrap_or(0);
    let mut berths = vec![Berth {
        label: "stable".to_string(),
        tier: "stable".to_string(),
        port: stable,
        canonical: true,
    }];
    let mut seen = vec![stable];
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
    berths_from_registry(records, stable_port())
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
        "stable" | "prod" => berths.iter().find(|b| b.canonical),
        "dev-latest" | "latest" => berths.iter().find(|b| b.port == DEV_LATEST_PORT),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PUBLISHED_STABLE_PORT: u16 = 43121;

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
        let berths = berths_from_registry(parse_registry(SAMPLE), Some(PUBLISHED_STABLE_PORT));
        assert_eq!(berths.len(), 3);
        assert_eq!(berths[0].label, "stable");
        assert!(berths[0].canonical);
        assert_eq!(berths[0].port, PUBLISHED_STABLE_PORT);
        assert_eq!(berths[1].label, "dev-latest");
        assert!(!berths[1].canonical);
        assert_eq!(berths[2].label, "my-feature");
    }

    #[test]
    fn drops_a_record_squatting_on_the_stable_port() {
        let recs = parse_registry(r#"[{"label":"impostor","tier":"codebase","port":43121}]"#);
        let berths = berths_from_registry(recs, Some(PUBLISHED_STABLE_PORT));
        assert_eq!(berths.len(), 1);
        assert_eq!(berths[0].label, "stable");
    }

    #[test]
    fn missing_stable_publication_is_explicitly_unreachable() {
        let berths = berths_from_registry(Vec::new(), None);
        assert_eq!(berths[0].port, 0);
        assert!(berths[0].canonical);
    }

    #[test]
    fn url_and_display_are_name_first() {
        let berths = berths_from_registry(parse_registry(SAMPLE), Some(PUBLISHED_STABLE_PORT));
        assert_eq!(berths[1].url(), "http://127.0.0.1:9886");
        assert_eq!(berths[1].display(), "dev-latest · :9886");
    }

    #[test]
    fn resolves_by_label_port_and_tier_alias() {
        let berths = berths_from_registry(parse_registry(SAMPLE), Some(PUBLISHED_STABLE_PORT));
        assert_eq!(resolve(&berths, "my-feature").unwrap().port, 9912);
        assert_eq!(resolve(&berths, "MY-FEATURE").unwrap().port, 9912);
        assert_eq!(resolve(&berths, ":9886").unwrap().label, "dev-latest");
        assert_eq!(resolve(&berths, "43121").unwrap().label, "stable");
        assert_eq!(resolve(&berths, "latest").unwrap().port, DEV_LATEST_PORT);
        assert_eq!(
            resolve(&berths, "prod").unwrap().port,
            PUBLISHED_STABLE_PORT
        );
        assert!(resolve(&berths, "nope").is_none());
    }
}
