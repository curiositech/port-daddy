//! Parley pane — should the swarm convene over a disagreement? (RCP-2a / ADR-0086).
//!
//! Reads the SAME `GET /msg/:channel/lineage` route as the Lineage pane, but
//! surfaces its `parley` field: a cost-aware Signal-Detection decision
//! (`P(fail) · waste · |unresolved| > parleyCost`) computed by the daemon from
//! the unresolved contradictions in the argument graph. Where Lineage shows the
//! disagreement, Parley turns it into a *decision*: convene a debate-with-judge,
//! or let the informal parallel work continue.
//!
//! Parsed DEFENSIVELY from `serde_json::Value`. Channel comes from
//! `PD_LINEAGE_CHANNEL` (default "discourse"); `pd-console --pane parley`.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{n, s, trunc};
use anyhow::Result;
use serde_json::Value;

const DEFAULT_CHANNEL: &str = "discourse";

/// One unresolved contradiction edge driving the decision.
#[derive(Debug, Clone, PartialEq)]
struct Edge {
    from: i64,
    to: i64,
    sender: String,
}

impl Edge {
    fn from_value(v: &Value) -> Self {
        Self {
            from: n(v, "from"),
            to: n(v, "to"),
            sender: s(v, "sender"),
        }
    }
    fn label(&self) -> String {
        if self.sender.is_empty() {
            format!("#{} → #{}", self.from, self.to)
        } else {
            format!(
                "#{} → #{} ({})",
                self.from,
                self.to,
                trunc(&self.sender, 24)
            )
        }
    }
}

/// The parsed parley decision — the structured half of the `parley` field.
#[derive(Debug, Clone, Default)]
struct ParleyDecision {
    convene: bool,
    shape: String,
    unresolved: i64,
    expected_waste: f64,
    margin: f64,
    reason: String,
}

impl ParleyDecision {
    fn from_value(v: &Value) -> Self {
        let f = |k: &str| v.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0);
        Self {
            convene: v.get("convene").and_then(|x| x.as_bool()).unwrap_or(false),
            shape: s(v, "shape"),
            unresolved: n(v, "unresolved"),
            expected_waste: f("expectedWaste"),
            margin: f("margin"),
            reason: s(v, "reason"),
        }
    }
    /// expectedWaste − margin = the parley cost the daemon compared against.
    fn cost(&self) -> f64 {
        self.expected_waste - self.margin
    }
}

pub struct ParleyPane {
    channel: String,
    decision: ParleyDecision,
    contradictions: Vec<Edge>,
    last_error: Option<String>,
}

impl Default for ParleyPane {
    fn default() -> Self {
        let channel = std::env::var("PD_LINEAGE_CHANNEL")
            .ok()
            .filter(|c| !c.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_CHANNEL.to_string());
        Self {
            channel,
            decision: ParleyDecision::default(),
            contradictions: Vec::new(),
            last_error: None,
        }
    }
}

impl ParleyPane {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Pane for ParleyPane {
    fn id(&self) -> &str {
        "parley"
    }
    fn title(&self) -> String {
        "Parley".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header(format!(
            "Parley — convene? — {}",
            self.channel
        ))];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        let d = &self.decision;
        // The headline decision as a prominent chip.
        if d.convene {
            blocks.push(Block::Chip {
                label: format!(
                    "CONVENE · {}",
                    if d.shape.is_empty() {
                        "debate-with-judge"
                    } else {
                        &d.shape
                    }
                ),
                tone: Tone::Accent,
            });
        } else {
            blocks.push(Block::Chip {
                label: "hold — let parallel work continue".into(),
                tone: Tone::Landed,
            });
        }
        blocks.push(Block::KeyVal("why".into(), d.reason.clone()));

        // The economics that drove it (RCP-2a: expected waste vs parley cost).
        blocks.push(Block::Gap);
        blocks.push(Block::Header("Signal-Detection (RCP-2a)".into()));
        blocks.push(Block::KeyVal(
            "unresolved contradictions".into(),
            d.unresolved.to_string(),
        ));
        blocks.push(Block::KeyVal(
            "expected waste vs cost".into(),
            format!(
                "{:.2} vs {:.2}  (margin {:+.2})",
                d.expected_waste,
                d.cost(),
                d.margin
            ),
        ));

        // The contradiction edges — what a parley would actually reconcile.
        if !self.contradictions.is_empty() {
            blocks.push(Block::Gap);
            blocks.push(Block::Header("Unresolved contradictions".into()));
            for e in &self.contradictions {
                blocks.push(Block::Chip {
                    label: e.label(),
                    tone: Tone::Conflicted,
                });
            }
        } else {
            blocks.push(Block::Gap);
            blocks.push(Block::KeyVal(
                "status".into(),
                "no unresolved contradictions on this channel".into(),
            ));
        }

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/msg/{}/lineage", daemon.base(), self.channel);
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.decision = ParleyDecision::default();
                    self.contradictions.clear();
                }
                Ok(resp) => match resp.json::<Value>().await {
                    Err(e) => self.last_error = Some(format!("bad response: {e}")),
                    Ok(data) => {
                        if data.get("ok") == Some(&Value::Bool(false)) {
                            let msg = s(&data, "error");
                            self.last_error = Some(if msg.is_empty() {
                                "daemon returned ok=false".into()
                            } else {
                                msg
                            });
                            self.decision = ParleyDecision::default();
                            self.contradictions.clear();
                        } else {
                            self.last_error = None;
                            self.decision = data
                                .get("parley")
                                .map(ParleyDecision::from_value)
                                .unwrap_or_default();
                            let digest = data.get("digest").cloned().unwrap_or(Value::Null);
                            self.contradictions =
                                crate::util::arr(&digest, "unresolvedContradictions")
                                    .iter()
                                    .map(Edge::from_value)
                                    .collect();
                        }
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

    fn convene_response() -> Value {
        json!({
            "ok": true,
            "channel": "discourse",
            "digest": {
                "total": 3,
                "unresolvedContradictions": [
                    { "from": 7, "to": 3, "sender": "carol", "relationship": "contradicts" }
                ]
            },
            "parley": {
                "convene": true,
                "shape": "debate-with-judge",
                "unresolved": 1,
                "expectedWaste": 2.0,
                "margin": 1.0,
                "reason": "expected waste 2.00 > parley cost 1.00 across 1 unresolved contradiction(s)"
            }
        })
    }

    fn parse(data: &Value) -> (ParleyDecision, Vec<Edge>) {
        let decision = data
            .get("parley")
            .map(ParleyDecision::from_value)
            .unwrap_or_default();
        let digest = data.get("digest").cloned().unwrap_or(Value::Null);
        let edges = crate::util::arr(&digest, "unresolvedContradictions")
            .iter()
            .map(Edge::from_value)
            .collect();
        (decision, edges)
    }

    #[test]
    fn parses_a_convene_decision() {
        let (d, edges) = parse(&convene_response());
        assert!(d.convene);
        assert_eq!(d.shape, "debate-with-judge");
        assert_eq!(d.unresolved, 1);
        assert!((d.expected_waste - 2.0).abs() < 1e-9);
        assert!((d.cost() - 1.0).abs() < 1e-9); // expectedWaste - margin
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].label(), "#7 → #3 (carol)");
    }

    #[test]
    fn view_shows_convene_chip_and_contradiction() {
        let mut pane = ParleyPane::new();
        let (d, edges) = parse(&convene_response());
        pane.decision = d;
        pane.contradictions = edges;
        let blocks = pane.view();
        // An Accent chip carrying the CONVENE recommendation.
        assert!(blocks.iter().any(|b| matches!(b, Block::Chip { tone: Tone::Accent, label } if label.starts_with("CONVENE"))));
        // A Conflicted chip for the edge.
        assert!(blocks.iter().any(|b| matches!(b, Block::Chip { tone: Tone::Conflicted, label } if label.contains("#7 → #3"))));
    }

    #[test]
    fn view_shows_hold_when_not_convening() {
        let mut pane = ParleyPane::new();
        pane.decision = ParleyDecision {
            convene: false,
            reason: "no unresolved contradictions".into(),
            ..Default::default()
        };
        let blocks = pane.view();
        assert!(blocks.iter().any(
            |b| matches!(b, Block::Chip { tone: Tone::Landed, label } if label.contains("hold"))
        ));
        assert!(!blocks.iter().any(|b| matches!(
            b,
            Block::Chip {
                tone: Tone::Accent,
                ..
            }
        )));
    }

    #[test]
    fn view_renders_error_state() {
        let mut pane = ParleyPane::new();
        pane.last_error = Some("daemon unreachable".into());
        let blocks = pane.view();
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, _) if k == "error")));
        assert!(!blocks.iter().any(|b| matches!(b, Block::Chip { .. })));
    }

    #[test]
    fn channel_defaults_when_env_unset() {
        std::env::remove_var("PD_LINEAGE_CHANNEL");
        assert_eq!(ParleyPane::new().channel, DEFAULT_CHANNEL);
    }
}
