//! Activity pane — rolling feed of daemon events.
//!
//! Calls `GET /activity?limit=40`. Real shape (v3.18):
//! `{ entries: [{ id, timestamp(ms), type, agentId, targetId, details, metadata }] }`

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{age_short, arr, n, s, trunc};
use anyhow::Result;
use serde_json::Value;

#[derive(Debug, Clone)]
struct ActivityEntry {
    event_type: String,
    agent_id: String,
    target: String,
    detail: String,
    timestamp_ms: i64,
}

impl ActivityEntry {
    fn from_value(v: &Value) -> Self {
        Self {
            event_type: s(v, "type"),
            agent_id: s(v, "agentId"),
            target: s(v, "targetId"),
            detail: s(v, "details"),
            timestamp_ms: n(v, "timestamp"),
        }
    }
}

fn tone_for_type(t: &str) -> Tone {
    match t {
        x if x.contains("error") || x.contains("fail") || x.contains("reject") => Tone::Gated,
        x if x.contains("done") || x.contains("complete") || x.contains("release") => Tone::Landed,
        x if x.contains("claim")
            || x.contains("begin")
            || x.contains("spawn")
            || x.contains("start") =>
        {
            Tone::Engaged
        }
        _ => Tone::Default,
    }
}

pub struct ActivityPane {
    entries: Vec<ActivityEntry>,
    last_error: Option<String>,
}

impl Default for ActivityPane {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            last_error: None,
        }
    }
}

impl ActivityPane {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Pane for ActivityPane {
    fn id(&self) -> &str {
        "activity"
    }
    fn title(&self) -> String {
        "Activity".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Activity Feed".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        if self.entries.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no recent activity".into()));
        } else {
            for e in self.entries.iter().take(30) {
                let _ = tone_for_type(&e.event_type);
                blocks.push(Block::Row(vec![
                    age_short(e.timestamp_ms),
                    trunc(&e.event_type, 20),
                    trunc(&e.agent_id, 14),
                    trunc(&e.detail, 44),
                ]));
            }
        }

        blocks.push(Block::Gap);
        blocks.push(Block::KeyVal(
            "events shown".into(),
            self.entries.len().min(30).to_string(),
        ));
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/activity?limit=40", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.entries.clear();
                }
                Ok(resp) => match resp.json::<Value>().await {
                    Err(e) => self.last_error = Some(format!("bad response: {e}")),
                    Ok(data) => {
                        self.last_error = None;
                        self.entries = arr(&data, "entries")
                            .iter()
                            .map(ActivityEntry::from_value)
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
        let p = ActivityPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h == "Activity Feed"));
    }

    #[test]
    fn tone_classification() {
        assert!(matches!(tone_for_type("session_done"), Tone::Landed));
        assert!(matches!(tone_for_type("claim_error"), Tone::Gated));
        assert!(matches!(tone_for_type("service.claim"), Tone::Engaged));
    }

    #[test]
    fn from_value_real_shape() {
        let v = json!({
            "id": 108020, "timestamp": 1781123816886i64, "type": "service.claim",
            "agentId": "pid-3272", "targetId": "daemon:server:main",
            "details": "claimed port 4847", "metadata": {"port": 4847}
        });
        let e = ActivityEntry::from_value(&v);
        assert_eq!(e.event_type, "service.claim");
        assert_eq!(e.target, "daemon:server:main");
        assert_eq!(e.timestamp_ms, 1781123816886);
    }
}
