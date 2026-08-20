//! Fleetbot Quality pane — the "this fleetbot review was wrong" flag stream.
//!
//! Part 2's real slice: the operator-facing browse surface for the feedback
//! entries `pd feedback --fleetbot-review <run-id>` drops (lib/feedback.ts,
//! routes/feedback.ts). It is NOT a new data store — the pane is a thin,
//! filtered read of the same durable, queryable `/feedback` stream every
//! other feedback consumer (cartographer, `pd feedback fleetbot`) uses:
//!
//!   GET /feedback?surface=Fleetbot&status=open&limit=100
//!
//! against the LOCAL daemon (`daemon.base()`), the same one `fleet_pane.rs`
//! and `ledger_pane.rs` poll — unlike `cloud_fleet_pane.rs`, which watches the
//! REMOTE relay. Fleetbot verdicts are posted by the cloud fleet-executor, but
//! the *flag* an agent or human drops when they disagree is a local-daemon
//! `pd feedback` call (the reviewer is working in a local checkout), so this
//! pane reads local truth, no relay token required.
//!
//! Render-agnostic on purpose (emits `Block`s), same as every other pane.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{age_short, arr, s, trunc};
use anyhow::Result;
use serde_json::Value;

/// One "this verdict is wrong" flag — a `/feedback` entry with `surface`
/// `'Fleetbot'`. Everything here comes straight off the wire; no field is
/// synthesized.
#[derive(Debug, Clone)]
struct QualityFlag {
    feedback_id: String,
    severity: String,
    status: String,
    summary: String,
    dropped_by: String,
    /// `fleetbotRunId` — the `fleet_runs.id` (relay D1) this flag is about, if
    /// the dropper supplied one via `--fleetbot-review`. A flag dropped
    /// without it (surface set by hand, not through the CLI flag) still
    /// renders — the run pointer is a courtesy, not a requirement.
    run_id: Option<String>,
    /// Epoch milliseconds (matches `lib/feedback.ts`'s `Date.now()` clock).
    at: i64,
}

impl QualityFlag {
    fn from_value(v: &Value) -> Self {
        let run_id = match v.get("fleetbotRunId") {
            Some(Value::String(x)) if !x.is_empty() => Some(x.clone()),
            _ => None,
        };
        Self {
            feedback_id: s(v, "feedbackId"),
            severity: s(v, "severity"),
            status: s(v, "status"),
            summary: s(v, "summary"),
            dropped_by: s(v, "droppedBy"),
            run_id,
            at: v.get("at").and_then(|x| x.as_i64()).unwrap_or(0),
        }
    }
}

fn severity_tone(severity: &str) -> Tone {
    match severity {
        "critical" | "high" => Tone::Conflicted,
        "medium" => Tone::Gated,
        _ => Tone::Default,
    }
}

pub struct FleetbotQualityPane {
    flags: Vec<QualityFlag>,
    error: Option<String>,
}

impl FleetbotQualityPane {
    pub fn new() -> Self {
        Self {
            flags: Vec::new(),
            error: None,
        }
    }

    fn open_count(&self) -> usize {
        self.flags.iter().filter(|f| f.status == "open").count()
    }

    fn severity_count(&self, severity: &str) -> usize {
        self.flags
            .iter()
            .filter(|f| f.status == "open" && f.severity == severity)
            .count()
    }
}

impl Default for FleetbotQualityPane {
    fn default() -> Self {
        Self::new()
    }
}

impl Pane for FleetbotQualityPane {
    fn id(&self) -> &str {
        "fleetbot"
    }

    fn title(&self) -> String {
        "Fleetbot Quality".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Fleetbot Quality".into())];

        if let Some(err) = &self.error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            blocks.push(Block::Chip {
                label: "daemon unreachable".into(),
                tone: Tone::Gated,
            });
            return blocks;
        }

        let open = self.open_count();
        let critical = self.severity_count("critical");
        let high = self.severity_count("high");
        let alarmed = critical > 0 || high > 0;

        blocks.push(Block::Chip {
            label: if open == 0 {
                "no open flags".into()
            } else {
                format!("{open} open flag{}", if open == 1 { "" } else { "s" })
            },
            tone: if open == 0 {
                Tone::Landed
            } else if alarmed {
                Tone::Conflicted
            } else {
                Tone::Gated
            },
        });

        blocks.push(Block::KeyVal(
            "by severity".into(),
            format!(
                "critical={} high={} medium={} low={}",
                critical,
                high,
                self.severity_count("medium"),
                self.severity_count("low"),
            ),
        ));

        blocks.push(Block::Gap);
        blocks.push(Block::Header("Open Flags".into()));
        let open_flags: Vec<&QualityFlag> =
            self.flags.iter().filter(|f| f.status == "open").collect();
        if open_flags.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "no open fleetbot-review flags — `pd feedback --fleetbot-review <run-id>` \
                 is how one lands here"
                    .into(),
            ));
        } else {
            for flag in open_flags.iter().take(30) {
                blocks.push(Block::Row(vec![
                    age_short(flag.at),
                    flag.severity.clone(),
                    flag.run_id.clone().unwrap_or_else(|| "—".into()),
                    trunc(&flag.summary, 60),
                    trunc(&flag.dropped_by, 20),
                ]));
                blocks.push(Block::Chip {
                    label: format!(
                        "{} · id={}",
                        trunc(&flag.summary, 72),
                        trunc(&flag.feedback_id, 8),
                    ),
                    tone: severity_tone(&flag.severity),
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
            let url = format!("{}/feedback?surface=Fleetbot&status=open&limit=100", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.error = Some(format!("daemon unreachable: {e}"));
                }
                Ok(resp) if !resp.status().is_success() => {
                    self.error = Some(format!("GET /feedback -> {}", resp.status()));
                }
                Ok(resp) => match resp.json::<Value>().await {
                    Ok(data) => {
                        self.error = None;
                        self.flags = arr(&data, "entries").iter().map(QualityFlag::from_value).collect();
                    }
                    Err(e) => {
                        self.error = Some(format!("bad response: {e}"));
                    }
                },
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn flag(feedback_id: &str, severity: &str, run_id: Option<&str>) -> QualityFlag {
        QualityFlag::from_value(&json!({
            "feedbackId": feedback_id,
            "severity": severity,
            "status": "open",
            "summary": "qa-bot flagged a non-bug, blocked merge for nothing",
            "droppedBy": "agent-reviewer",
            "fleetbotRunId": run_id,
            "at": 1_719_432_000_000i64,
        }))
    }

    #[test]
    fn no_flags_renders_landed_zero_state() {
        let p = FleetbotQualityPane::new();
        let blocks = p.view();
        assert!(matches!(&blocks[0], Block::Header(h) if h == "Fleetbot Quality"));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Chip { label, tone: Tone::Landed } if label == "no open flags"
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(k, v) if k == "status" && v.contains("pd feedback --fleetbot-review")
        )));
    }

    #[test]
    fn error_short_circuits_before_any_flag_rendering() {
        let mut p = FleetbotQualityPane::new();
        p.error = Some("daemon unreachable: connection refused".into());
        let blocks = p.view();
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, _) if k == "error")));
        assert!(!blocks.iter().any(|b| matches!(b, Block::Header(h) if h == "Open Flags")));
    }

    #[test]
    fn critical_or_high_open_flags_alarm_the_summary_chip() {
        let mut p = FleetbotQualityPane::new();
        p.flags = vec![flag("fb-1", "critical", Some("run:delivery-abc"))];
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Chip { label, tone: Tone::Conflicted } if label == "1 open flag"
        )));
    }

    #[test]
    fn medium_only_open_flags_are_gated_not_alarmed() {
        let mut p = FleetbotQualityPane::new();
        p.flags = vec![flag("fb-1", "medium", None)];
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Chip { label, tone: Tone::Gated } if label == "1 open flag"
        )));
    }

    #[test]
    fn severity_rollup_counts_only_open_flags() {
        let mut p = FleetbotQualityPane::new();
        p.flags = vec![
            flag("fb-1", "high", Some("run:a")),
            flag("fb-2", "high", Some("run:b")),
            flag("fb-3", "low", None),
        ];
        p.flags[2].status = "harvested".into();
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(k, v) if k == "by severity" && v == "critical=0 high=2 medium=0 low=0"
        )));
    }

    #[test]
    fn each_open_flag_renders_a_row_with_run_id_and_a_severity_chip() {
        let mut p = FleetbotQualityPane::new();
        p.flags = vec![flag("fb-1", "high", Some("run:delivery-abc"))];
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Row(cells) if cells.contains(&"run:delivery-abc".to_string())
                && cells.contains(&"high".to_string())
        )));
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Chip { label, tone: Tone::Conflicted } if label.contains("id=fb-1")
        )));
    }

    #[test]
    fn missing_run_id_renders_an_em_dash_not_a_panic() {
        let mut p = FleetbotQualityPane::new();
        p.flags = vec![flag("fb-1", "medium", None)];
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(
            b, Block::Row(cells) if cells.iter().any(|c| c == "—")
        )));
    }

    #[test]
    fn harvested_flags_are_excluded_from_open_rendering() {
        let mut p = FleetbotQualityPane::new();
        let mut harvested = flag("fb-1", "high", None);
        harvested.status = "harvested".into();
        p.flags = vec![harvested];
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(
            b, Block::KeyVal(k, v) if k == "status" && v.contains("no open fleetbot-review flags")
        )));
    }
}
