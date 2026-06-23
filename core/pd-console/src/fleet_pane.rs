//! Fleet roster pane — live agent cards with ICS maritime flags.
//!
//! Calls `GET /agents` on the daemon. Real response shape (v3.18):
//! `{ agents: [{ id, name, type, isActive, identity, identityProject, purpose,
//!    status, worktreeId, lastHeartbeat, ... }] }` — many fields nullable.

use crate::agent::DaemonClient;
use crate::maritime::flag_for_state;
use crate::pane::{Block, Pane, Tone};
use crate::util::{age_short, arr, b, n, s, trunc};
use anyhow::Result;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct AgentEntry {
    pub id: String,
    pub identity: String,
    pub purpose: String,
    pub state: String,
    pub backend: String,
    pub active: bool,
    pub last_heartbeat_ms: i64,
}

impl AgentEntry {
    fn from_value(v: &Value) -> Self {
        let status = s(v, "status");
        let active = b(v, "isActive");
        let state = if !status.is_empty() {
            status
        } else if active {
            "engaged".into()
        } else {
            "idle".into()
        };
        let identity = {
            let i = s(v, "identity");
            if i.is_empty() { s(v, "name") } else { i }
        };
        Self {
            id: s(v, "id"),
            identity,
            purpose: s(v, "purpose"),
            state,
            backend: s(v, "type"),
            active,
            last_heartbeat_ms: n(v, "lastHeartbeat"),
        }
    }
}

pub struct FleetPane {
    pub agents: Vec<AgentEntry>,
    last_error: Option<String>,
}

impl Default for FleetPane {
    fn default() -> Self {
        Self { agents: Vec::new(), last_error: None }
    }
}

impl FleetPane {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Pane for FleetPane {
    fn id(&self) -> &str { "fleet" }

    fn title(&self) -> String { "Fleet".into() }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Fleet Roster".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        if self.agents.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no agents registered — pd spawn to launch one".into()));
        } else {
            let active = self.agents.iter().filter(|a| a.active).count();
            blocks.push(Block::KeyVal("total".into(), self.agents.len().to_string()));
            blocks.push(Block::KeyVal("active".into(), active.to_string()));
            blocks.push(Block::Gap);
            for a in &self.agents {
                let flag = flag_for_state(&a.state);
                let callsign = if a.identity.is_empty() {
                    trunc(&a.id, 12)
                } else {
                    trunc(&a.identity, 24)
                };
                // A real hoisted signal flag (colored square + ICS letter),
                // tone by engagement. The letter encodes the ICS state.
                let tone = if a.active { Tone::Engaged } else { Tone::Resting };
                blocks.push(Block::Flag {
                    letter: flag.letter(),
                    label: format!("{callsign}  ·  {}", a.state),
                    tone,
                });
                blocks.push(Block::KeyVal(
                    "  detail".into(),
                    format!("{} · {} ago", a.backend, age_short(a.last_heartbeat_ms)),
                ));
                if !a.purpose.is_empty() {
                    blocks.push(Block::KeyVal("  purpose".into(), trunc(&a.purpose, 60)));
                }
            }
        }

        let engaged = self.agents.iter().filter(|a| a.active).count();
        let tone = if engaged > 0 { Tone::Engaged } else { Tone::Resting };
        blocks.push(Block::Gap);
        blocks.push(Block::Chip {
            label: format!("{} active / {} total", engaged, self.agents.len()),
            tone,
        });
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
                    self.agents.clear();
                }
                Ok(resp) => match resp.json::<Value>().await {
                    Err(e) => self.last_error = Some(format!("bad response: {e}")),
                    Ok(data) => {
                        self.last_error = None;
                        self.agents = arr(&data, "agents").iter().map(AgentEntry::from_value).collect();
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
    fn from_value_tolerates_nulls() {
        let v = json!({
            "id": "agent-x", "name": "port-daddy:console", "type": "cli",
            "isActive": true, "identity": null, "purpose": null,
            "status": null, "lastHeartbeat": 1781123382383i64
        });
        let a = AgentEntry::from_value(&v);
        assert_eq!(a.id, "agent-x");
        assert_eq!(a.identity, "port-daddy:console"); // falls back to name
        assert_eq!(a.state, "engaged"); // isActive=true, no status
        assert!(a.active);
    }

    #[test]
    fn view_empty() {
        let p = FleetPane::default();
        let blocks = p.view();
        assert!(matches!(&blocks[0], Block::Header(h) if h == "Fleet Roster"));
    }

    #[test]
    fn view_with_agents() {
        let mut p = FleetPane::default();
        p.agents = vec![AgentEntry {
            id: "agent-1".into(),
            identity: "port-daddy:panels".into(),
            purpose: "build panels".into(),
            state: "engaged".into(),
            backend: "cli".into(),
            active: true,
            last_heartbeat_ms: 0,
        }];
        let blocks = p.view();
        // The roster now hoists a real signal flag per agent (was a `[A]` Row).
        assert!(
            blocks.iter().any(|b| matches!(b, Block::Flag { .. })),
            "each agent must render a maritime Flag block"
        );
        // The engaged agent's flag carries its callsign + state.
        let labelled = blocks.iter().any(|b| matches!(
            b, Block::Flag { label, .. } if label.contains("port-daddy:panels") && label.contains("engaged")
        ));
        assert!(labelled, "flag label must carry callsign + state");
    }
}
