//! Claims pane — live view of file/symbol claims across all sessions.
//!
//! Calls `GET /files` (the global claims endpoint). Real shape (v3.18):
//! `{ claims: [{ filePath, sessionId, purpose, agentId, phase, claimedAt(ms),
//!    startLine, endLine, symbol, symbolPath }] }`

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, SurfaceAction, Tone};
use crate::util::{age_short, arr, n, s, trunc};
use anyhow::Result;
use serde_json::Value;

#[derive(Debug, Clone)]
struct ClaimEntry {
    file_path: String,
    purpose: String,
    symbol: String,
    claimed_at_ms: i64,
}

/// A bounded ego graph projected by the suggestibility layer. The console does
/// not reinterpret the classifier: it paints the daemon's state and action.
#[derive(Debug, Clone)]
struct TroubleEntry {
    state: String,
    file_path: String,
    other_session: String,
    action: String,
    mermaid: String,
}

impl TroubleEntry {
    fn from_value(v: &Value) -> Option<Self> {
        if s(v, "kind") != "claim-tree-trouble" {
            return None;
        }
        let payload = v.get("payload")?;
        let state = s(payload, "state");
        if state.is_empty() {
            return None;
        }
        Some(Self {
            state,
            file_path: s(payload, "filePath"),
            other_session: payload
                .get("other")
                .map(|other| s(other, "sessionId"))
                .unwrap_or_default(),
            action: s(payload, "action"),
            mermaid: s(payload, "mermaid"),
        })
    }
}

fn trouble_tone(state: &str) -> Tone {
    match state {
        "COORDINATE" => Tone::Conflicted,
        "RESCUE" => Tone::Gated,
        "VERIFY" | "INSPECT" | "RECONCILE" => Tone::Accent,
        "WATCH" => Tone::Engaged,
        _ => Tone::Resting,
    }
}

impl ClaimEntry {
    fn from_value(v: &Value) -> Self {
        Self {
            file_path: s(v, "filePath"),
            purpose: s(v, "purpose"),
            symbol: s(v, "symbol"),
            claimed_at_ms: n(v, "claimedAt"),
        }
    }
}

/// Right-truncate a path, keeping the tail (the informative part).
fn tail_path(p: &str, max_chars: usize) -> String {
    let count = p.chars().count();
    if count <= max_chars {
        return p.to_string();
    }
    let tail: String = p.chars().skip(count - max_chars + 1).collect();
    format!("…{tail}")
}

pub struct ClaimsPane {
    claims: Vec<ClaimEntry>,
    trouble: Vec<TroubleEntry>,
    selected_surface: Option<String>,
    last_error: Option<String>,
}

impl Default for ClaimsPane {
    fn default() -> Self {
        Self {
            claims: Vec::new(),
            trouble: Vec::new(),
            selected_surface: None,
            last_error: None,
        }
    }
}

impl ClaimsPane {
    pub fn new() -> Self {
        Self::default()
    }

    fn trouble_rank(state: &str) -> usize {
        match state {
            "RESCUE" => 0,
            "COORDINATE" => 1,
            "VERIFY" | "INSPECT" | "RECONCILE" => 2,
            "WATCH" => 3,
            _ => 4,
        }
    }
}

impl Pane for ClaimsPane {
    fn id(&self) -> &str {
        "claims"
    }
    fn title(&self) -> String {
        "Claims".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("File & Symbol Claims".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        if !self.trouble.is_empty() {
            blocks.push(Block::Gap);
            blocks.push(Block::Header("Claim-tree trouble radar".into()));
            blocks.push(Block::KeyVal(
                "legend".into(),
                "you  →  claimed surface  →  finite-state action".into(),
            ));
            let mut radar: Vec<&TroubleEntry> = self.trouble.iter().collect();
            radar.sort_by_key(|trouble| Self::trouble_rank(&trouble.state));
            let selected_surface = self
                .selected_surface
                .as_deref()
                .or_else(|| radar.first().map(|trouble| trouble.file_path.as_str()));
            for (index, trouble) in radar.iter().enumerate() {
                let tone = trouble_tone(&trouble.state);
                blocks.push(Block::ClaimTroubleCard {
                    index,
                    selected: selected_surface == Some(trouble.file_path.as_str()),
                    flag: trouble.state.chars().next().unwrap_or('!'),
                    state: trouble.state.clone(),
                    surface: tail_path(&trouble.file_path, 42),
                    other: trunc(&trouble.other_session, 20),
                    action: if trouble.action.is_empty() {
                        "Inspect the claim evidence.".into()
                    } else {
                        trouble.action.clone()
                    },
                    tone,
                });
            }
            if let Some(selected) = radar
                .iter()
                .find(|trouble| selected_surface == Some(trouble.file_path.as_str()))
            {
                blocks.push(Block::Gap);
                blocks.push(Block::Header("Focused trouble evidence".into()));
                blocks.push(Block::Row(vec![
                    "you".into(),
                    "→".into(),
                    tail_path(&selected.file_path, 32),
                    "→".into(),
                    trunc(&selected.other_session, 20),
                ]));
                blocks.push(Block::KeyVal("state".into(), selected.state.clone()));
                blocks.push(Block::KeyVal(
                    "recommended next move".into(),
                    if selected.action.is_empty() {
                        "Inspect, then decide whether to open Parley or split the surface.".into()
                    } else {
                        selected.action.clone()
                    },
                ));
                if !selected.mermaid.is_empty() {
                    blocks.push(Block::WrappedText {
                        text: selected.mermaid.clone(),
                        tone: trouble_tone(&selected.state),
                    });
                }
            }
        }

        if self.claims.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no active claims".into()));
        } else {
            blocks.push(Block::KeyVal("total".into(), self.claims.len().to_string()));
            blocks.push(Block::Gap);

            for claim in &self.claims {
                let kind = if claim.symbol.is_empty() {
                    "file"
                } else {
                    "symbol"
                };
                blocks.push(Block::Row(vec![
                    age_short(claim.claimed_at_ms),
                    kind.to_string(),
                    trunc(&claim.purpose, 22),
                    tail_path(&claim.file_path, 42),
                ]));
            }
        }

        blocks.push(Block::Gap);
        blocks.push(Block::Chip {
            label: format!(
                "{} claim{}",
                self.claims.len(),
                if self.claims.len() == 1 { "" } else { "s" }
            ),
            tone: if self.claims.is_empty() {
                Tone::Resting
            } else {
                Tone::Engaged
            },
        });
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/files", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.claims.clear();
                }
                Ok(resp) => match resp.json::<Value>().await {
                    Err(e) => self.last_error = Some(format!("bad response: {e}")),
                    Ok(data) => {
                        self.last_error = None;
                        self.claims = arr(&data, "claims")
                            .iter()
                            .map(ClaimEntry::from_value)
                            .collect();
                        let suggestions_url =
                            format!("{}/suggestions?status=pending&limit=12", daemon.base());
                        match daemon.http_client().get(&suggestions_url).send().await {
                            Ok(resp) if resp.status().is_success() => {
                                match resp.json::<Value>().await {
                                    Ok(data) => {
                                        self.trouble = arr(&data, "suggestions")
                                            .iter()
                                            .filter_map(TroubleEntry::from_value)
                                            .collect()
                                    }
                                    Err(_) => self.trouble.clear(),
                                }
                            }
                            _ => self.trouble.clear(),
                        }
                    }
                },
            }
            Ok(())
        })
    }

    fn mutate<'a>(
        &'a mut self,
        _daemon: &'a DaemonClient,
        action: SurfaceAction,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        if let SurfaceAction::SelectRow { index } = action {
            let mut radar: Vec<&TroubleEntry> = self.trouble.iter().collect();
            radar.sort_by_key(|trouble| Self::trouble_rank(&trouble.state));
            self.selected_surface = radar.get(index).map(|trouble| trouble.file_path.clone());
        }
        Box::pin(async { Ok(()) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn from_value_real_shape() {
        let v = json!({
            "filePath": "bin/port-daddy-cli.ts",
            "sessionId": "session-x", "purpose": "port-daddy:context-p3:review-fix",
            "agentId": "agent-x", "phase": "in_progress",
            "claimedAt": 1781123399804i64,
            "startLine": null, "endLine": null, "symbol": null, "symbolPath": null
        });
        let e = ClaimEntry::from_value(&v);
        assert_eq!(e.file_path, "bin/port-daddy-cli.ts");
        assert_eq!(e.symbol, ""); // null tolerated
        assert_eq!(e.claimed_at_ms, 1781123399804);
    }

    #[test]
    fn view_empty() {
        let p = ClaimsPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h.contains("Claims")));
    }

    #[test]
    fn tail_path_keeps_tail() {
        assert_eq!(tail_path("a/b.rs", 20), "a/b.rs");
        let long = "core/pd-console/src/very/deep/path/file.rs";
        let t = tail_path(long, 20);
        assert!(t.starts_with('…') && t.ends_with("file.rs"));
        assert!(t.chars().count() <= 20);
    }

    #[test]
    fn view_claims() {
        let mut p = ClaimsPane::default();
        p.claims = vec![ClaimEntry {
            file_path: "core/pd-console/src/app.rs".into(),
            purpose: "console-panels".into(),
            symbol: String::new(),
            claimed_at_ms: 0,
        }];
        let b = p.view();
        let rows = b.iter().filter(|blk| matches!(blk, Block::Row(_))).count();
        assert_eq!(rows, 1);
    }

    #[test]
    fn renders_a_colored_ego_graph_for_claim_tree_trouble() {
        let mut p = ClaimsPane::default();
        p.trouble = vec![TroubleEntry {
            state: "COORDINATE".into(),
            file_path: "lib/claim-tree-trouble.ts".into(),
            other_session: "session-other".into(),
            action: "open a parley".into(),
            mermaid: "flowchart LR".into(),
        }];
        let blocks = p.view();
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::ClaimTroubleCard {
                tone: Tone::Conflicted,
                ..
            }
        )));
        assert!(blocks.iter().any(
            |block| matches!(block, Block::WrappedText { text, .. } if text == "flowchart LR")
        ));
    }

    #[test]
    fn ignores_claim_tree_trouble_without_a_state() {
        let malformed = json!({
            "kind": "claim-tree-trouble",
            "payload": { "filePath": "lib/auth.ts", "state": "" }
        });
        assert!(TroubleEntry::from_value(&malformed).is_none());
    }

    #[test]
    fn selecting_a_radar_card_retargets_only_the_inspector() {
        let mut p = ClaimsPane::default();
        p.trouble = vec![
            TroubleEntry {
                state: "WATCH".into(),
                file_path: "lib/quiet.ts".into(),
                other_session: "session-watch".into(),
                action: "keep observing".into(),
                mermaid: String::new(),
            },
            TroubleEntry {
                state: "COORDINATE".into(),
                file_path: "lib/shared.ts".into(),
                other_session: "session-peer".into(),
                action: "open Parley".into(),
                mermaid: "flowchart LR".into(),
            },
        ];
        let daemon = DaemonClient::new("http://127.0.0.1:1".into());
        // Selection is applied before the no-op future is returned; no runtime
        // is necessary for this purely local UI mutation.
        drop(p.mutate(&daemon, SurfaceAction::SelectRow { index: 1 }));
        assert_eq!(p.selected_surface.as_deref(), Some("lib/quiet.ts"));
        let blocks = p.view();
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::KeyVal(key, value) if key == "recommended next move" && value == "keep observing"
        )));
    }
}
