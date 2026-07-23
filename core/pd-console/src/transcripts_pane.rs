//! Recent LLM runs and transcript-capture conformance.
//!
//! This pane projects daemon truth from `/transcripts` and
//! `/transcripts/compliance`. It never infers a higher capture level from the
//! presence of prose: the backend profile and per-run flow assessment are the
//! evidence shown to the operator.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{age_short, arr, n, s, trunc};
use anyhow::Result;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Default)]
struct TranscriptRow {
    id: String,
    ship: String,
    backend: String,
    model: String,
    status: String,
    started_at: i64,
    messages: usize,
    outputs: usize,
}

impl TranscriptRow {
    fn from_value(value: &Value) -> Self {
        Self {
            id: s(value, "id"),
            ship: s(value, "ship"),
            backend: s(value, "backend"),
            model: s(value, "model"),
            status: s(value, "status"),
            started_at: n(value, "started_at"),
            messages: arr(value, "messages").len(),
            outputs: arr(value, "outputs").len(),
        }
    }
}

#[derive(Debug, Clone, Default)]
struct Conformance {
    support: String,
    capture_mode: String,
    flow_state: Option<String>,
    issue: Option<String>,
}

pub struct TranscriptsPane {
    rows: Vec<TranscriptRow>,
    conformance: HashMap<String, Conformance>,
    report_state: String,
    last_error: Option<String>,
}

impl Default for TranscriptsPane {
    fn default() -> Self {
        Self {
            rows: Vec::new(),
            conformance: HashMap::new(),
            report_state: "unknown".into(),
            last_error: None,
        }
    }
}

impl TranscriptsPane {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Pane for TranscriptsPane {
    fn id(&self) -> &str {
        "transcripts"
    }

    fn title(&self) -> String {
        "Transcripts".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Recent LLM runs".into())];
        if let Some(error) = &self.last_error {
            blocks.push(Block::KeyVal("evidence unavailable".into(), error.clone()));
            blocks.push(Block::KeyVal(
                "effect".into(),
                "no transcript or conformance rows are fabricated".into(),
            ));
            return blocks;
        }

        blocks.push(Block::Chip {
            label: format!("preparation conformance · {}", self.report_state),
            tone: if self.report_state == "nominal" {
                Tone::Landed
            } else {
                Tone::Gated
            },
        });
        if self.rows.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "no recent transcript rows".into(),
            ));
            return blocks;
        }

        for row in &self.rows {
            let evidence = self
                .conformance
                .get(&row.backend)
                .cloned()
                .unwrap_or_default();
            let tone = match row.status.as_str() {
                "running" => Tone::Engaged,
                "completed" => Tone::Landed,
                "failed" | "killed" | "over_budget" => Tone::Conflicted,
                _ => Tone::Resting,
            };
            blocks.push(Block::Gap);
            blocks.push(Block::Flag {
                letter: match row.status.as_str() {
                    "running" => 'K',
                    "completed" => 'C',
                    _ => 'V',
                },
                tone,
                label: format!(
                    "{}  /  {}  /  {}",
                    age_short(row.started_at),
                    row.status,
                    trunc(
                        if row.ship.is_empty() {
                            &row.id
                        } else {
                            &row.ship
                        },
                        44
                    )
                ),
            });
            blocks.push(Block::KeyVal(
                "backend".into(),
                format!("{} · {}", row.backend, row.model),
            ));
            blocks.push(Block::KeyVal(
                "capture".into(),
                format!(
                    "{} · {}",
                    if evidence.support.is_empty() {
                        "unprofiled"
                    } else {
                        &evidence.support
                    },
                    if evidence.capture_mode.is_empty() {
                        "unknown"
                    } else {
                        &evidence.capture_mode
                    }
                ),
            ));
            blocks.push(Block::KeyVal(
                "receipts".into(),
                format!("{} messages · {} outputs", row.messages, row.outputs),
            ));
            if let Some(flow) = evidence.flow_state {
                blocks.push(Block::KeyVal("flow".into(), flow));
            }
            if let Some(issue) = evidence.issue {
                blocks.push(Block::KeyVal("conformance gap".into(), issue));
            }
        }
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let list_url = format!("{}/transcripts?limit=30", daemon.base());
            let compliance_url = format!("{}/transcripts/compliance", daemon.base());
            let list = daemon.http_client().get(&list_url).send().await;
            let compliance = daemon.http_client().get(&compliance_url).send().await;
            match (list, compliance) {
                (Ok(list), Ok(compliance)) => {
                    let list = list.json::<Value>().await;
                    let compliance = compliance.json::<Value>().await;
                    match (list, compliance) {
                        (Ok(list), Ok(compliance)) => {
                            self.rows = arr(&list, "transcripts")
                                .iter()
                                .map(TranscriptRow::from_value)
                                .collect();
                            self.report_state = s(&compliance, "state");
                            self.conformance.clear();
                            for profile in arr(&compliance, "matrix") {
                                self.conformance.insert(
                                    s(profile, "backend"),
                                    Conformance {
                                        support: s(profile, "support"),
                                        capture_mode: s(profile, "captureMode"),
                                        ..Conformance::default()
                                    },
                                );
                            }
                            for run in arr(&compliance, "runs") {
                                let entry = self.conformance.entry(s(run, "backend")).or_default();
                                entry.flow_state = Some(s(run, "flowState"));
                                entry.issue = run
                                    .get("issue")
                                    .and_then(|issue| issue.get("message"))
                                    .and_then(Value::as_str)
                                    .map(str::to_string);
                            }
                            self.last_error = None;
                        }
                        (Err(error), _) | (_, Err(error)) => {
                            self.last_error = Some(format!("invalid daemon response: {error}"));
                        }
                    }
                }
                (Err(error), _) | (_, Err(error)) => {
                    self.last_error = Some(format!("daemon unreachable: {error}"));
                    self.rows.clear();
                    self.conformance.clear();
                }
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn transcript_row_reads_daemon_shape() {
        let row = TranscriptRow::from_value(&json!({
            "id": "tr-1", "ship": "spawn:codex", "backend": "codex",
            "model": "gpt-5", "status": "completed", "started_at": 42,
            "messages": [{ "role": "assistant" }], "outputs": []
        }));
        assert_eq!(row.backend, "codex");
        assert_eq!(row.messages, 1);
    }

    #[test]
    fn missing_conformance_is_labeled_unprofiled() {
        let pane = TranscriptsPane {
            rows: vec![TranscriptRow {
                id: "tr-1".into(),
                status: "completed".into(),
                ..TranscriptRow::default()
            }],
            report_state: "degraded".into(),
            ..TranscriptsPane::default()
        };
        assert!(format!("{:?}", pane.view()).contains("unprofiled"));
    }
}
