//! Fleet roster pane — live agent cards with ICS maritime flags.
//!
//! Calls `GET /agents` and `GET /sessions` on the daemon.
//! Each card shows: flag badge, callsign, backend, state chip, session, cost.
//! Hover on the flag → full ICS tooltip.

use crate::agent::DaemonClient;
use crate::maritime::flag_for_state;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEntry {
    pub id: String,
    #[serde(default)]
    pub identity: String,
    #[serde(default)]
    pub purpose: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub backend: String,
    #[serde(rename = "sessionId", default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub cost_usd: Option<f64>,
    #[serde(rename = "lastSeen", default)]
    pub last_seen: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AgentsResponse {
    #[serde(default)]
    agents: Vec<AgentEntry>,
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
            blocks.push(Block::KeyVal("status".into(), "no agents registered — :new <backend> <prompt> to spawn one".into()));
        } else {
            blocks.push(Block::KeyVal("total".into(), self.agents.len().to_string()));
            for a in &self.agents {
                let flag = flag_for_state(&a.state);
                let callsign = if a.identity.is_empty() {
                    a.id[..a.id.len().min(12)].to_string()
                } else {
                    a.identity[..a.identity.len().min(20)].to_string()
                };
                let cost = a.cost_usd.map(|c| format!("${:.4}", c)).unwrap_or_else(|| "-".into());
                let state = if a.state.is_empty() { "idle".to_string() } else { a.state.clone() };
                blocks.push(Block::Row(vec![
                    format!("[{}]", flag.letter()),
                    callsign,
                    a.backend.clone(),
                    state,
                    cost,
                ]));
            }
        }

        let engaged = self.agents.iter().filter(|a| {
            matches!(a.state.as_str(), "claim-active" | "engaged" | "spawning" | "awaiting-human")
        }).count();
        let tone = if engaged > 0 { Tone::Engaged } else { Tone::Resting };
        blocks.push(Block::Chip {
            label: format!("{} engaged / {} total", engaged, self.agents.len()),
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
                Ok(resp) => {
                    match resp.json::<AgentsResponse>().await {
                        Err(e) => {
                            self.last_error = Some(format!("bad response: {e}"));
                        }
                        Ok(data) => {
                            self.last_error = None;
                            self.agents = data.agents;
                        }
                    }
                }
            }
            Ok(())
        })
    }
}
