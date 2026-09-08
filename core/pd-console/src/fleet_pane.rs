//! Fleet roster pane — live agent cards with ICS maritime flags.
//!
//! Calls `GET /agents` on the daemon. Real response shape (v3.18):
//! `{ agents: [{ id, name, type, isActive, identity, identityProject, purpose,
//!    status, worktreeId, lastHeartbeat, ... }] }` — many fields nullable.

use crate::agent::DaemonClient;
use crate::pane::{Block, Meta, Pane, Stat, Tone};
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
            blocks.push(Block::Card {
                accent: Tone::Gated,
                flag: None,
                title: "daemon unreachable".into(),
                subtitle: err.clone(),
                meta: vec![],
            });
            return blocks;
        }

        if self.agents.is_empty() {
            blocks.push(Block::Card {
                accent: Tone::Resting,
                flag: None,
                title: "No agents registered".into(),
                subtitle: "Run `pd spawn` (or pd-console-repl :new) to launch one onto the bus.".into(),
                meta: vec![],
            });
            return blocks;
        }

        let total = self.agents.len();
        let active = self.agents.iter().filter(|a| a.active).count();
        let backends = self
            .agents
            .iter()
            .map(|a| a.backend.as_str())
            .filter(|b| !b.is_empty())
            .collect::<std::collections::BTreeSet<_>>()
            .len();

        // Headline stat strip.
        blocks.push(Block::Stats(vec![
            Stat::new(total.to_string(), "agents", Tone::Accent),
            Stat::new(
                active.to_string(),
                "active",
                if active > 0 { Tone::Engaged } else { Tone::Resting },
            ),
            Stat::new(backends.to_string(), "backends", Tone::Default),
        ]));
        blocks.push(Block::Subhead("Roster".into()));

        // One card per agent — purpose wraps in full, no truncation.
        for a in &self.agents {
            let title = if a.identity.is_empty() {
                trunc(&a.id, 40)
            } else {
                trunc(&a.identity, 40)
            };
            let accent = if a.active { Tone::Engaged } else { Tone::Resting };

            let mut meta = vec![];
            if !a.backend.is_empty() {
                meta.push(Meta::new(a.backend.clone(), Tone::Default));
            }
            if !a.state.is_empty() {
                meta.push(Meta::new(a.state.clone(), accent));
            }
            meta.push(Meta::new(age_short(a.last_heartbeat_ms), Tone::Resting));

            blocks.push(Block::Card {
                accent,
                flag: Some(a.state.clone()),
                title,
                subtitle: a.purpose.clone(),
                meta,
            });
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
        assert!(blocks.iter().any(|b| matches!(b, Block::Card { .. })));
    }
}
