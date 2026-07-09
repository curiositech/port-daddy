//! Cockpit pane — on-bus agent conversation multiplexer (ADR-0046).
//!
//! Shows live agents (filtered to isActive) from `GET /agents`. Spawning new
//! top-level agents and tube turns come via the repl today; GPUI input next.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{age_short, arr, b, n, s, trunc};
use anyhow::Result;
use serde_json::Value;

#[derive(Debug, Clone)]
struct ConvEntry {
    id: String,
    name: String,
    backend: String,
    purpose: String,
    active: bool,
    last_heartbeat_ms: i64,
}

impl ConvEntry {
    fn from_value(v: &Value) -> Self {
        Self {
            id: s(v, "id"),
            name: s(v, "name"),
            backend: s(v, "type"),
            purpose: s(v, "purpose"),
            active: b(v, "isActive"),
            last_heartbeat_ms: n(v, "lastHeartbeat"),
        }
    }
}

pub struct CockpitPane {
    convs: Vec<ConvEntry>,
    last_error: Option<String>,
}

impl Default for CockpitPane {
    fn default() -> Self {
        Self {
            convs: Vec::new(),
            last_error: None,
        }
    }
}

impl CockpitPane {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Pane for CockpitPane {
    fn id(&self) -> &str {
        "cockpit"
    }
    fn title(&self) -> String {
        "Cockpit".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Cockpit — Live Agents".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        if self.convs.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "no live agents — pd spawn or pd-console-repl :new".into(),
            ));
        } else {
            blocks.push(Block::KeyVal("live".into(), self.convs.len().to_string()));
            blocks.push(Block::Gap);

            for c in &self.convs {
                let label = if c.name.is_empty() {
                    trunc(&c.id, 20)
                } else {
                    trunc(&c.name, 32)
                };
                blocks.push(Block::Chip {
                    label: format!(
                        "{label}  [{}]  {}",
                        c.backend,
                        age_short(c.last_heartbeat_ms)
                    ),
                    tone: if c.active {
                        Tone::Engaged
                    } else {
                        Tone::Resting
                    },
                });
                if !c.purpose.is_empty() {
                    blocks.push(Block::KeyVal("purpose".into(), trunc(&c.purpose, 60)));
                }
                blocks.push(Block::Gap);
            }
        }

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/agents", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.convs.clear();
                }
                Ok(resp) => match resp.json::<Value>().await {
                    Err(e) => self.last_error = Some(format!("bad response: {e}")),
                    Ok(data) => {
                        self.last_error = None;
                        self.convs = arr(&data, "agents")
                            .iter()
                            .map(ConvEntry::from_value)
                            .filter(|c| c.active)
                            .collect();
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

    #[test]
    fn view_empty() {
        let p = CockpitPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h.contains("Cockpit")));
    }

    #[test]
    fn from_value_tolerates_nulls() {
        let v = json!({
            "id": "agent-1", "name": null, "type": "cli",
            "isActive": true, "purpose": null, "lastHeartbeat": 1781123382383i64
        });
        let c = ConvEntry::from_value(&v);
        assert!(c.active);
        assert_eq!(c.name, "");
    }

    #[test]
    fn view_agents() {
        let mut p = CockpitPane::default();
        p.convs = vec![ConvEntry {
            id: "agent-abc".into(),
            name: "port-daddy:panels".into(),
            backend: "cli".into(),
            purpose: "build the panels".into(),
            active: true,
            last_heartbeat_ms: 0,
        }];
        let b = p.view();
        assert!(b.iter().any(|blk| matches!(blk, Block::Chip { .. })));
    }
}
