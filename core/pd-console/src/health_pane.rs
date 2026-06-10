//! Health pane — daemon vitals: status, version, uptime, ports, fleet summary.
//!
//! Calls `GET /health` on the daemon.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct HealthResponse {
    status: String,
    version: String,
    uptime_seconds: u64,
    active_ports: u32,
    pid: u32,
    #[serde(default)]
    fleet: Option<FleetSummary>,
    #[serde(default)]
    routes: Option<RouteHealth>,
}

#[derive(Debug, Deserialize)]
struct FleetSummary {
    running: bool,
    agents: u32,
}

#[derive(Debug, Deserialize)]
struct RouteHealth {
    ok: bool,
    mounted: u32,
    missing: u32,
}

fn fmt_uptime(secs: u64) -> String {
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    if h > 0 { format!("{h}h {m}m") } else if m > 0 { format!("{m}m {s}s") } else { format!("{s}s") }
}

pub struct HealthPane {
    data: Option<HealthResponse>,
    last_error: Option<String>,
}

impl Default for HealthPane {
    fn default() -> Self { Self { data: None, last_error: None } }
}

impl HealthPane {
    pub fn new() -> Self { Self::default() }
}

impl Pane for HealthPane {
    fn id(&self) -> &str { "health" }
    fn title(&self) -> String { "Health".into() }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Daemon Health".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            blocks.push(Block::Chip { label: "daemon unreachable".into(), tone: Tone::Gated });
            return blocks;
        }

        let Some(h) = &self.data else {
            blocks.push(Block::KeyVal("status".into(), "connecting…".into()));
            return blocks;
        };

        let status_tone = if h.status == "ok" { Tone::Landed } else { Tone::Gated };
        blocks.push(Block::Chip { label: format!("● {}", h.status), tone: status_tone });
        blocks.push(Block::Gap);
        blocks.push(Block::KeyVal("version".into(), h.version.clone()));
        blocks.push(Block::KeyVal("uptime".into(), fmt_uptime(h.uptime_seconds)));
        blocks.push(Block::KeyVal("pid".into(), h.pid.to_string()));
        blocks.push(Block::KeyVal("active ports".into(), h.active_ports.to_string()));

        if let Some(fleet) = &h.fleet {
            blocks.push(Block::Gap);
            blocks.push(Block::Header("Fleet".into()));
            let fleet_tone = if fleet.running { Tone::Engaged } else { Tone::Resting };
            blocks.push(Block::Chip {
                label: if fleet.running { "fleet daemon running".into() } else { "fleet daemon stopped".into() },
                tone: fleet_tone,
            });
            blocks.push(Block::KeyVal("agents".into(), fleet.agents.to_string()));
        }

        if let Some(routes) = &h.routes {
            blocks.push(Block::Gap);
            blocks.push(Block::Header("Routes".into()));
            let route_tone = if routes.ok { Tone::Landed } else { Tone::Gated };
            blocks.push(Block::Chip {
                label: format!("{} mounted / {} missing", routes.mounted, routes.missing),
                tone: route_tone,
            });
        }

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/health", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.data = None;
                }
                Ok(resp) => {
                    match resp.json::<HealthResponse>().await {
                        Err(e) => self.last_error = Some(format!("bad response: {e}")),
                        Ok(data) => {
                            self.last_error = None;
                            self.data = Some(data);
                        }
                    }
                }
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fmt_uptime_values() {
        assert_eq!(fmt_uptime(45), "45s");
        assert_eq!(fmt_uptime(90), "1m 30s");
        assert_eq!(fmt_uptime(3661), "1h 1m");
    }

    #[test]
    fn view_no_data() {
        let p = HealthPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h == "Daemon Health"));
    }

    #[test]
    fn view_error() {
        let mut p = HealthPane::default();
        p.last_error = Some("timeout".into());
        let b = p.view();
        let has_gated = b.iter().any(|blk| matches!(blk, Block::Chip { tone: Tone::Gated, .. }));
        assert!(has_gated);
    }
}
