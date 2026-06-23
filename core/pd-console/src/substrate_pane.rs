//! Substrate pane — the stigmergic pheromone blackboard (RCP-7a + RCP-12).
//!
//! Two soma kernels, made legible:
//!   - RCP-12 coverage: for each tracked table, what fraction of entities carry
//!     any pheromone ("seen") and which are still invisible — via
//!     `GET /pheromone/coverage/:table`.
//!   - RCP-7a resolution traces: active signals with their effective (damped)
//!     heat — `effective = raw·(1 − clamp(resolution))` — via `GET /pheromone`,
//!     whose entries now carry a `resolutions` map alongside `pheromones`.
//!
//! Parsed DEFENSIVELY from `serde_json::Value` (never a strict serde struct).
//! `pd-console --pane substrate` opens it directly.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{n, s, trunc};
use anyhow::Result;
use serde_json::Value;

/// Tables the daemon tracks pheromones on.
const TABLES: [&str; 4] = ["services", "projects", "sessions", "agents"];

/// effective = raw · (1 − clamp(resolution, 0, 1)) — the RCP-7a damping the
/// daemon applies on `?effective=1` reads, mirrored here so the pane can show
/// raw → effective side by side without an extra per-entity fetch.
fn effective(raw: f64, resolution: f64) -> f64 {
    if !(resolution > 0.0) {
        return raw;
    }
    raw * (1.0 - resolution.clamp(0.0, 1.0))
}

#[derive(Debug, Clone, PartialEq)]
struct TableCoverage {
    table: String,
    total: i64,
    seen: i64,
    unseen: i64,
}

impl TableCoverage {
    fn from_value(table: &str, v: &Value) -> Self {
        let total = n(v, "total");
        let seen = n(v, "seen");
        Self {
            table: table.to_string(),
            total,
            seen,
            unseen: (total - seen).max(0),
        }
    }
    /// seen/total as a percentage; 100 when the universe is empty.
    fn pct(&self) -> i64 {
        if self.total <= 0 {
            100
        } else {
            ((self.seen as f64 / self.total as f64) * 100.0).round() as i64
        }
    }
    fn summary(&self) -> String {
        format!("{}/{} seen ({}%)", self.seen, self.total, self.pct())
    }
}

/// One active signal on one entity, with its raw and effective (damped) heat.
#[derive(Debug, Clone, PartialEq)]
struct Signal {
    table: String,
    id: String,
    key: String,
    raw: f64,
    eff: f64,
    resolved: bool,
}

impl Signal {
    /// `services/svc-1 · heat` (the entity + signal key).
    fn label(&self) -> String {
        format!("{}/{} · {}", self.table, trunc(&self.id, 28), self.key)
    }
    /// `0.90` or, when a resolution damps it, `0.90→0.00`.
    fn value(&self) -> String {
        if self.resolved {
            format!("{:.2}→{:.2}", self.raw, self.eff)
        } else {
            format!("{:.2}", self.raw)
        }
    }
}

/// Pull active signals out of a `GET /pheromone` list response. Each entry has
/// `{ table, id, pheromones:{k:v}, resolutions:{k:v} }`.
fn parse_signals(data: &Value) -> Vec<Signal> {
    let mut out = Vec::new();
    let Some(entries) = data.get("pheromones").and_then(|p| p.as_array()) else {
        return out;
    };
    for entry in entries {
        let table = s(entry, "table");
        let id = s(entry, "id");
        let resolutions = entry.get("resolutions").and_then(|r| r.as_object());
        let Some(pheromones) = entry.get("pheromones").and_then(|p| p.as_object()) else {
            continue;
        };
        for (key, raw_val) in pheromones {
            let raw = raw_val.as_f64().unwrap_or(0.0);
            let res = resolutions
                .and_then(|r| r.get(key))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            out.push(Signal {
                table: table.clone(),
                id: id.clone(),
                key: key.clone(),
                raw,
                eff: effective(raw, res),
                resolved: res > 0.0,
            });
        }
    }
    // Hottest first by raw heat — deterministic on ties via the label.
    out.sort_by(|a, b| {
        b.raw
            .partial_cmp(&a.raw)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.label().cmp(&b.label()))
    });
    out
}

pub struct SubstratePane {
    coverage: Vec<TableCoverage>,
    signals: Vec<Signal>,
    last_error: Option<String>,
}

impl Default for SubstratePane {
    fn default() -> Self {
        Self {
            coverage: Vec::new(),
            signals: Vec::new(),
            last_error: None,
        }
    }
}

impl SubstratePane {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Pane for SubstratePane {
    fn id(&self) -> &str {
        "substrate"
    }
    fn title(&self) -> String {
        "Substrate".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Stigmergic substrate".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        // One-line orientation: what this surface is for.
        blocks.push(Block::KeyVal(
            "reads".into(),
            "where agents left signals · what's still unseen · what's been resolved".into(),
        ));

        // ── RCP-12 coverage ──────────────────────────────────────────────
        blocks.push(Block::Header("Coverage — who's been looked at (RCP-12)".into()));
        if self.coverage.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no tracked entities".into()));
        }
        for c in &self.coverage {
            blocks.push(Block::KeyVal(c.table.clone(), c.summary()));
            // A mostly-unseen table is where an innate scan should look next.
            if c.total > 0 && c.pct() < 50 {
                blocks.push(Block::Chip {
                    label: format!("{} unseen in {}", c.unseen, c.table),
                    tone: Tone::Conflicted,
                });
            }
        }

        // ── RCP-7a active signals (raw → effective) ──────────────────────
        blocks.push(Block::Gap);
        blocks.push(Block::Header("Active signals — heat, raw→resolved (RCP-7a)".into()));
        if self.signals.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "no active pheromones".into(),
            ));
        }
        for sig in self.signals.iter().take(20) {
            blocks.push(Block::Row(vec![sig.label(), sig.value()]));
            // A resolved (damped) signal is anti-inflammatory — flag it so an
            // agent knows the heat is suppressed, not gone.
            if sig.resolved {
                blocks.push(Block::Chip {
                    label: format!("resolved: {}/{}", sig.id, sig.key),
                    tone: Tone::Landed,
                });
            }
        }

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            // Active signals (the one required fetch; its failure is the pane error).
            let list_url = format!("{}/pheromone", daemon.base());
            match daemon.http_client().get(&list_url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.coverage.clear();
                    self.signals.clear();
                    return Ok(());
                }
                Ok(resp) => match resp.json::<Value>().await {
                    Err(e) => {
                        self.last_error = Some(format!("bad response: {e}"));
                        return Ok(());
                    }
                    Ok(data) => {
                        self.last_error = None;
                        self.signals = parse_signals(&data);
                    }
                },
            }

            // Coverage per table — best-effort; a table that errors is skipped.
            let mut coverage = Vec::new();
            for table in TABLES {
                let url = format!("{}/pheromone/coverage/{}", daemon.base(), table);
                if let Ok(resp) = daemon.http_client().get(&url).send().await {
                    if let Ok(data) = resp.json::<Value>().await {
                        if data.get("success") != Some(&Value::Bool(false)) {
                            coverage.push(TableCoverage::from_value(table, &data));
                        }
                    }
                }
            }
            self.coverage = coverage;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn effective_damping_matches_the_daemon() {
        assert_eq!(effective(0.8, 0.0), 0.8); // no resolution
        assert!((effective(0.8, 1.0) - 0.0).abs() < 1e-9); // fully resolved
        assert!((effective(0.8, 0.5) - 0.4).abs() < 1e-9); // half
        assert!((effective(0.8, 5.0) - 0.0).abs() < 1e-9); // clamped
    }

    #[test]
    fn coverage_summary_and_pct() {
        let c = TableCoverage::from_value("services", &json!({ "total": 3, "seen": 1 }));
        assert_eq!(c.unseen, 2);
        assert_eq!(c.pct(), 33);
        assert_eq!(c.summary(), "1/3 seen (33%)");
    }

    #[test]
    fn empty_universe_is_fully_covered() {
        let c = TableCoverage::from_value("agents", &json!({ "total": 0, "seen": 0 }));
        assert_eq!(c.pct(), 100);
    }

    #[test]
    fn parse_signals_extracts_raw_and_effective() {
        let data = json!({
            "pheromones": [
                { "table": "services", "id": "svc-a", "pheromones": { "heat": 0.9 }, "resolutions": { "heat": 1.0 } },
                { "table": "services", "id": "svc-b", "pheromones": { "urgency": 0.4 }, "resolutions": {} }
            ]
        });
        let sigs = parse_signals(&data);
        assert_eq!(sigs.len(), 2);
        // Sorted hottest-first: svc-a (0.9) before svc-b (0.4).
        assert_eq!(sigs[0].id, "svc-a");
        assert!(sigs[0].resolved);
        assert!((sigs[0].eff - 0.0).abs() < 1e-9);
        assert_eq!(sigs[0].value(), "0.90→0.00");
        assert!(!sigs[1].resolved);
        assert_eq!(sigs[1].value(), "0.40");
    }

    #[test]
    fn parse_signals_tolerates_missing_fields() {
        assert!(parse_signals(&json!({ "ok": true })).is_empty());
        // Entry with no pheromones object is skipped, not panicked on.
        let sigs = parse_signals(&json!({ "pheromones": [ { "table": "x", "id": "y" } ] }));
        assert!(sigs.is_empty());
    }

    #[test]
    fn view_shows_coverage_and_resolved_chip() {
        let mut pane = SubstratePane::new();
        pane.coverage = vec![TableCoverage::from_value(
            "services",
            &json!({ "total": 4, "seen": 1 }),
        )];
        pane.signals = parse_signals(&json!({
            "pheromones": [
                { "table": "services", "id": "svc-a", "pheromones": { "heat": 0.9 }, "resolutions": { "heat": 1.0 } }
            ]
        }));
        let blocks = pane.view();

        // The mostly-unseen table yields a Conflicted chip.
        assert!(blocks.iter().any(|b| matches!(b, Block::Chip { tone: Tone::Conflicted, label } if label.contains("unseen in services"))));
        // The resolved signal yields a Landed chip.
        assert!(blocks.iter().any(
            |b| matches!(b, Block::Chip { tone: Tone::Landed, label } if label.contains("resolved"))
        ));
    }

    #[test]
    fn view_renders_error_state() {
        let mut pane = SubstratePane::new();
        pane.last_error = Some("daemon unreachable: connection refused".into());
        let blocks = pane.view();
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, _) if k == "error")));
        // Error short-circuits — no coverage/signal headers.
        assert!(!blocks
            .iter()
            .any(|b| matches!(b, Block::Header(h) if h.contains("Coverage"))));
    }
}
