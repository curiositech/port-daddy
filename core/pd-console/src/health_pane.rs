//! Health pane — daemon vitals: status, version, uptime, ports, fleet summary.
//!
//! Calls `GET /health`. Real shape (v3.18):
//! `{ status, version, uptime_seconds, active_ports, pid,
//!    fleet: { running, projects, agents, watchers, ... },
//!    routes: { ok, missing: [..], checked },
//!    runtime: { state, degraded, ... } }`

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{b, n, s};
use anyhow::Result;
use serde_json::Value;

fn fmt_uptime(secs: i64) -> String {
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    let sec = secs % 60;
    if h > 0 { format!("{h}h {m}m") } else if m > 0 { format!("{m}m {sec}s") } else { format!("{sec}s") }
}

pub struct HealthPane {
    data: Option<Value>,
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

        let status = s(h, "status");
        let status_tone = if status == "ok" { Tone::Landed } else { Tone::Gated };
        blocks.push(Block::Chip { label: format!("status: {status}"), tone: status_tone });
        blocks.push(Block::Gap);
        blocks.push(Block::KeyVal("version".into(), s(h, "version")));
        blocks.push(Block::KeyVal("uptime".into(), fmt_uptime(n(h, "uptime_seconds"))));
        blocks.push(Block::KeyVal("pid".into(), n(h, "pid").to_string()));
        blocks.push(Block::KeyVal("active ports".into(), n(h, "active_ports").to_string()));

        if let Some(fleet) = h.get("fleet") {
            blocks.push(Block::Gap);
            blocks.push(Block::Header("Fleet".into()));
            let running = b(fleet, "running");
            blocks.push(Block::Chip {
                label: if running { "fleet daemon running".into() } else { "fleet daemon stopped".into() },
                tone: if running { Tone::Engaged } else { Tone::Resting },
            });
            blocks.push(Block::KeyVal("projects".into(), n(fleet, "projects").to_string()));
            blocks.push(Block::KeyVal("agents".into(), n(fleet, "agents").to_string()));
        }

        if let Some(routes) = h.get("routes") {
            blocks.push(Block::Gap);
            blocks.push(Block::Header("Routes".into()));
            let ok = b(routes, "ok");
            let missing = routes.get("missing").and_then(|m| m.as_array()).map(|a| a.len()).unwrap_or(0);
            blocks.push(Block::Chip {
                label: format!("{} checked / {} missing", n(routes, "checked"), missing),
                tone: if ok { Tone::Landed } else { Tone::Gated },
            });
        }

        if let Some(rt) = h.get("runtime") {
            blocks.push(Block::Gap);
            blocks.push(Block::Header("Runtime".into()));
            let degraded = b(rt, "degraded");
            blocks.push(Block::Chip {
                label: format!("runtime: {}", s(rt, "state")),
                tone: if degraded { Tone::Gated } else { Tone::Landed },
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
                Ok(resp) => match resp.json::<Value>().await {
                    Err(e) => self.last_error = Some(format!("bad response: {e}")),
                    Ok(data) => {
                        self.last_error = None;
                        self.data = Some(data);
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
    fn view_real_shape() {
        let mut p = HealthPane::default();
        p.data = Some(json!({
            "status": "ok", "version": "3.18.0", "uptime_seconds": 1412,
            "active_ports": 52, "pid": 3467,
            "fleet": {"running": true, "projects": 0, "agents": 0},
            "routes": {"ok": true, "missing": [], "checked": 11},
            "runtime": {"state": "nominal", "degraded": false}
        }));
        let blocks = p.view();
        let chips = blocks.iter().filter(|b| matches!(b, Block::Chip { .. })).count();
        assert!(chips >= 3, "expected status, fleet, routes, runtime chips");
    }

    #[test]
    fn view_error() {
        let mut p = HealthPane::default();
        p.last_error = Some("timeout".into());
        let b = p.view();
        assert!(b.iter().any(|blk| matches!(blk, Block::Chip { tone: Tone::Gated, .. })));
    }
}
