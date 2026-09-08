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
    if h > 0 {
        format!("{h}h {m}m")
    } else if m > 0 {
        format!("{m}m {sec}s")
    } else {
        format!("{sec}s")
    }
}

/// The shared three-tier severity the daemon reports (lib/health-severity.ts).
/// Read the top-level `severity` field; fall back to deriving it from
/// routes/runtime/status for an older daemon that predates the field, so the
/// console never silently shows "ok" against a degraded daemon.
fn read_severity(h: &Value) -> &'static str {
    match h.get("severity").and_then(|v| v.as_str()) {
        Some("critical") => "critical",
        Some("warn") => "warn",
        Some("ok") => "ok",
        _ => {
            // Derive: routes not ok ⇒ critical; runtime degraded or status not
            // "ok" ⇒ warn; else ok.
            let routes_ok = h.get("routes").map(|r| b(r, "ok")).unwrap_or(true);
            if !routes_ok {
                "critical"
            } else if h.get("runtime").map(|r| b(r, "degraded")).unwrap_or(false)
                || s(h, "status") != "ok"
            {
                "warn"
            } else {
                "ok"
            }
        }
    }
}

/// Map a severity to its semantic tone. `critical` gets the LOUD `Alarm` tone
/// (distinct distress red), `warn` the `Gated` warning tone, `ok` the calm
/// `Landed` tone.
fn severity_tone(sev: &str) -> Tone {
    match sev {
        "critical" => Tone::Alarm,
        "warn" => Tone::Gated,
        _ => Tone::Landed,
    }
}

pub struct HealthPane {
    data: Option<Value>,
    last_error: Option<String>,
}

impl Default for HealthPane {
    fn default() -> Self {
        Self {
            data: None,
            last_error: None,
        }
    }
}

impl HealthPane {
    pub fn new() -> Self {
        Self::default()
    }

    /// Ambient connection truth for the global chrome. Boot completion is not
    /// connectivity: a daemon can disappear after the first successful frame.
    pub fn is_connected(&self) -> bool {
        self.last_error.is_none() && self.data.is_some()
    }
}

impl Pane for HealthPane {
    fn id(&self) -> &str {
        "health"
    }
    fn title(&self) -> String {
        "Health".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Daemon Health".into())];

        if let Some(err) = &self.last_error {
            // Unreachable daemon is the loudest state: a CRITICAL alarm banner.
            blocks.push(Block::Chip {
                label: "✗ DAEMON UNREACHABLE".into(),
                tone: Tone::Alarm,
            });
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        };

        let Some(h) = &self.data else {
            blocks.push(Block::KeyVal("status".into(), "connecting…".into()));
            return blocks;
        };

        let severity = read_severity(h);
        let status = s(h, "status");

        // LOUD alert banner at the top of the pane when not nominal — the pane
        // visibly changes, it does not silently stay green.
        match severity {
            "critical" => blocks.push(Block::Chip {
                label: "✗ DAEMON CRITICAL — core health failing".into(),
                tone: Tone::Alarm,
            }),
            "warn" => blocks.push(Block::Chip {
                label: "⚠ DAEMON DEGRADED".into(),
                tone: Tone::Gated,
            }),
            _ => {}
        }

        blocks.push(Block::Chip {
            label: format!("status: {status} ({severity})"),
            tone: severity_tone(severity),
        });
        blocks.push(Block::Gap);
        blocks.push(Block::KeyVal("version".into(), s(h, "version")));
        blocks.push(Block::KeyVal(
            "uptime".into(),
            fmt_uptime(n(h, "uptime_seconds")),
        ));
        blocks.push(Block::KeyVal("pid".into(), n(h, "pid").to_string()));
        blocks.push(Block::KeyVal(
            "active ports".into(),
            n(h, "active_ports").to_string(),
        ));

        if let Some(fleet) = h.get("fleet") {
            blocks.push(Block::Gap);
            blocks.push(Block::Header("Fleet".into()));
            let running = b(fleet, "running");
            blocks.push(Block::Chip {
                label: if running {
                    "fleet daemon running".into()
                } else {
                    "fleet daemon stopped".into()
                },
                tone: if running {
                    Tone::Engaged
                } else {
                    Tone::Resting
                },
            });
            blocks.push(Block::KeyVal(
                "projects".into(),
                n(fleet, "projects").to_string(),
            ));
            blocks.push(Block::KeyVal(
                "agents".into(),
                n(fleet, "agents").to_string(),
            ));
        }

        if let Some(routes) = h.get("routes") {
            blocks.push(Block::Gap);
            blocks.push(Block::Header("Routes".into()));
            let ok = b(routes, "ok");
            let missing = routes
                .get("missing")
                .and_then(|m| m.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            blocks.push(Block::Chip {
                label: format!("{} checked / {} missing", n(routes, "checked"), missing),
                // A daemon 404'ing its own critical routes is a CRITICAL state.
                tone: if ok { Tone::Landed } else { Tone::Alarm },
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
        assert!(!p.is_connected());
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h == "Daemon Health"));
    }

    #[test]
    fn view_real_shape() {
        let mut p = HealthPane::default();
        p.data = Some(json!({
            "status": "ok", "severity": "ok", "version": "3.18.0", "uptime_seconds": 1412,
            "active_ports": 52, "pid": 3467,
            "fleet": {"running": true, "projects": 0, "agents": 0},
            "routes": {"ok": true, "missing": [], "checked": 11},
            "runtime": {"state": "nominal", "degraded": false}
        }));
        assert!(p.is_connected());
        let blocks = p.view();
        let chips = blocks
            .iter()
            .filter(|b| matches!(b, Block::Chip { .. }))
            .count();
        assert!(chips >= 3, "expected status, fleet, routes, runtime chips");
        // A nominal daemon shows NO alarm tone anywhere.
        assert!(
            !blocks.iter().any(|b| matches!(
                b,
                Block::Chip {
                    tone: Tone::Alarm,
                    ..
                }
            )),
            "ok daemon must not show an alarm tone"
        );
    }

    #[test]
    fn view_error() {
        let mut p = HealthPane::default();
        p.last_error = Some("timeout".into());
        assert!(!p.is_connected());
        let b = p.view();
        // Unreachable daemon is a CRITICAL alarm, not a soft warning.
        assert!(
            b.iter().any(|blk| matches!(
                blk,
                Block::Chip {
                    tone: Tone::Alarm,
                    ..
                }
            )),
            "unreachable daemon must raise an alarm tone"
        );
    }

    #[test]
    fn view_critical_severity_raises_alarm() {
        // Daemon 404'ing its own routes → severity critical → loud Alarm banner.
        let mut p = HealthPane::default();
        p.data = Some(json!({
            "status": "degraded", "severity": "critical", "version": "3.22.0",
            "uptime_seconds": 10, "active_ports": 0, "pid": 1,
            "routes": {"ok": false, "missing": [{"method": "GET", "url": "/health"}], "checked": 11},
            "runtime": {"state": "degraded", "degraded": true}
        }));
        let blocks = p.view();
        let alarms = blocks
            .iter()
            .filter(|b| {
                matches!(
                    b,
                    Block::Chip {
                        tone: Tone::Alarm,
                        ..
                    }
                )
            })
            .count();
        assert!(
            alarms >= 2,
            "critical daemon must show the alarm banner AND an alarm status chip"
        );
        assert!(
            blocks
                .iter()
                .any(|b| matches!(b, Block::Chip { label, .. } if label.contains("CRITICAL"))),
            "critical banner must be present"
        );
    }

    #[test]
    fn view_warn_severity_is_degraded_not_alarm() {
        // Runtime degraded but routes ok → warn → Gated banner, no Alarm.
        let mut p = HealthPane::default();
        p.data = Some(json!({
            "status": "ok", "severity": "warn", "version": "3.22.0",
            "uptime_seconds": 10, "active_ports": 1, "pid": 1,
            "routes": {"ok": true, "missing": [], "checked": 11},
            "runtime": {"state": "degraded", "degraded": true}
        }));
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(b, Block::Chip { label, tone: Tone::Gated } if label.contains("DEGRADED"))),
            "warn must show a degraded banner");
        assert!(
            !blocks.iter().any(|b| matches!(
                b,
                Block::Chip {
                    tone: Tone::Alarm,
                    ..
                }
            )),
            "warn must not escalate to an alarm tone"
        );
    }

    #[test]
    fn read_severity_derives_when_field_absent() {
        // Older daemon without the severity field: derive from routes.
        let degraded =
            json!({"status": "degraded", "routes": {"ok": false, "missing": [{}], "checked": 5}});
        assert_eq!(read_severity(&degraded), "critical");
        let warn = json!({"status": "ok", "routes": {"ok": true}, "runtime": {"degraded": true}});
        assert_eq!(read_severity(&warn), "warn");
        let ok = json!({"status": "ok", "routes": {"ok": true}, "runtime": {"degraded": false}});
        assert_eq!(read_severity(&ok), "ok");
    }
}
