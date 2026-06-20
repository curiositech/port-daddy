//! Lineage pane — the discourse argument graph over a typed conversation (RCP-14).
//!
//! Calls `GET /msg/:channel/lineage[?conversationId=&limit=]` (shipped on the
//! daemon via the RCP-14 route). The daemon does the threading + classification;
//! this pane just projects the digest + the already-formatted `tree` string.
//!
//! Response shape (v3.x), parsed DEFENSIVELY from `serde_json::Value` — never a
//! strict serde struct (epoch-ms numbers + nulls + schema drift would break one):
//! ```json
//! { "ok": true, "channel": "<name>", "conversationId": "<optional>",
//!   "digest": { "total": int, "participants": [str], "roots": [int], "maxDepth": int,
//!               "byRelationship": { "supports": int, "contradicts": int, ... },
//!               "byPerformative": { "<act>": int },
//!               "contradictions": [ { "from": int, "to": int, "sender": str, "relationship": str } ],
//!               "unresolvedContradictions": [ { ...same shape... } ],
//!               "typed": bool },
//!   "tree": "<indented multi-line string>" }
//! ```
//!
//! Channel comes from `PD_LINEAGE_CHANNEL` (default "discourse"); `pd-console
//! --pane lineage` opens it directly.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{arr, b, n, s, trunc};
use anyhow::Result;
use serde_json::Value;

/// Default channel when `PD_LINEAGE_CHANNEL` is unset.
const DEFAULT_CHANNEL: &str = "discourse";

/// One contradiction edge in the argument graph. `from`/`to` are message ids.
#[derive(Debug, Clone, PartialEq)]
struct ContradictionEdge {
    from: i64,
    to: i64,
    sender: String,
}

impl ContradictionEdge {
    fn from_value(v: &Value) -> Self {
        Self {
            from: n(v, "from"),
            to: n(v, "to"),
            sender: s(v, "sender"),
        }
    }

    /// Chip label: `#<from> → #<to> (<sender>)`.
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

/// The parsed lineage digest — the structured part of the response. Built off
/// `serde_json::Value` so any drift degrades to sane defaults rather than a hard
/// decode failure.
#[derive(Debug, Clone, Default)]
struct LineageDigest {
    total: i64,
    participants: i64,
    max_depth: i64,
    roots: i64,
    typed: bool,
    // byRelationship counts (zero when absent).
    supports: i64,
    contradicts: i64,
    extends: i64,
    narrows: i64,
    synthesizes: i64,
    unresolved: Vec<ContradictionEdge>,
}

impl LineageDigest {
    fn from_value(digest: &Value) -> Self {
        let rel = digest.get("byRelationship").cloned().unwrap_or(Value::Null);
        Self {
            total: n(digest, "total"),
            participants: arr(digest, "participants").len() as i64,
            max_depth: n(digest, "maxDepth"),
            roots: arr(digest, "roots").len() as i64,
            typed: b(digest, "typed"),
            supports: n(&rel, "supports"),
            contradicts: n(&rel, "contradicts"),
            extends: n(&rel, "extends"),
            narrows: n(&rel, "narrows"),
            synthesizes: n(&rel, "synthesizes"),
            unresolved: arr(digest, "unresolvedContradictions")
                .iter()
                .map(ContradictionEdge::from_value)
                .collect(),
        }
    }

    /// The `relationship=count` cells for nonzero stances — the stance line.
    fn stance_cells(&self) -> Vec<String> {
        let mut cells = Vec::new();
        for (label, count) in [
            ("supports", self.supports),
            ("contradicts", self.contradicts),
            ("extends", self.extends),
            ("narrows", self.narrows),
            ("synthesizes", self.synthesizes),
        ] {
            if count > 0 {
                cells.push(format!("{label}={count}"));
            }
        }
        cells
    }
}

/// Parse a full lineage response into `(digest, tree)`. Tolerates a missing
/// `digest` object (→ defaults) and a missing/non-string `tree` (→ "").
fn parse_lineage(data: &Value) -> (LineageDigest, String) {
    let digest_val = data.get("digest").cloned().unwrap_or(Value::Null);
    let digest = LineageDigest::from_value(&digest_val);
    let tree = s(data, "tree");
    (digest, tree)
}

pub struct LineagePane {
    channel: String,
    digest: LineageDigest,
    tree: String,
    last_error: Option<String>,
}

impl Default for LineagePane {
    fn default() -> Self {
        let channel = std::env::var("PD_LINEAGE_CHANNEL")
            .ok()
            .filter(|c| !c.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_CHANNEL.to_string());
        Self {
            channel,
            digest: LineageDigest::default(),
            tree: String::new(),
            last_error: None,
        }
    }
}

impl LineagePane {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Pane for LineagePane {
    fn id(&self) -> &str {
        "lineage"
    }
    fn title(&self) -> String {
        "Lineage".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header(format!(
            "Discourse lineage — {}",
            self.channel
        ))];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        let d = &self.digest;
        blocks.push(Block::KeyVal("total".into(), d.total.to_string()));
        blocks.push(Block::KeyVal(
            "participants".into(),
            d.participants.to_string(),
        ));
        blocks.push(Block::KeyVal("roots".into(), d.roots.to_string()));
        blocks.push(Block::KeyVal("max depth".into(), d.max_depth.to_string()));
        if d.typed {
            blocks.push(Block::Chip {
                label: "typed".into(),
                tone: Tone::Accent,
            });
        }

        // Stance line — only nonzero relationships, e.g. "supports=4 contradicts=2".
        let stance = d.stance_cells();
        if !stance.is_empty() {
            blocks.push(Block::Row(stance));
        }

        // Unresolved contradictions: one Conflicted chip per edge. These are the
        // open arguments an operator most needs to see.
        if !d.unresolved.is_empty() {
            blocks.push(Block::Gap);
            blocks.push(Block::Header("Unresolved contradictions".into()));
            for edge in &d.unresolved {
                blocks.push(Block::Chip {
                    label: edge.label(),
                    tone: Tone::Conflicted,
                });
            }
        }

        // The tree the daemon already formatted — render line by line so the
        // indentation survives in both renderers.
        if !self.tree.trim().is_empty() {
            blocks.push(Block::Gap);
            blocks.push(Block::Header("Tree".into()));
            for line in self.tree.lines() {
                blocks.push(Block::Row(vec![line.to_string()]));
            }
        } else if d.total == 0 {
            blocks.push(Block::Gap);
            blocks.push(Block::KeyVal(
                "status".into(),
                "no lineage on this channel yet".into(),
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
                    self.digest = LineageDigest::default();
                    self.tree.clear();
                }
                Ok(resp) => match resp.json::<Value>().await {
                    Err(e) => self.last_error = Some(format!("bad response: {e}")),
                    Ok(data) => {
                        // `ok: false` is a structured daemon error (e.g. unknown
                        // channel) — surface its message rather than rendering an
                        // empty digest as if it were real.
                        if data.get("ok") == Some(&Value::Bool(false)) {
                            let msg = s(&data, "error");
                            self.last_error = Some(if msg.is_empty() {
                                "daemon returned ok=false".into()
                            } else {
                                msg
                            });
                            self.digest = LineageDigest::default();
                            self.tree.clear();
                        } else {
                            self.last_error = None;
                            let (digest, tree) = parse_lineage(&data);
                            self.digest = digest;
                            self.tree = tree;
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

    fn sample_response() -> Value {
        json!({
            "ok": true,
            "channel": "discourse",
            "conversationId": "conv-1",
            "digest": {
                "total": 7,
                "participants": ["alice", "bob", "carol"],
                "roots": [1],
                "maxDepth": 3,
                "byRelationship": {
                    "supports": 4,
                    "contradicts": 2,
                    "extends": 1,
                    "narrows": 0,
                    "synthesizes": 0
                },
                "byPerformative": { "assert": 5, "challenge": 2 },
                "contradictions": [
                    { "from": 5, "to": 2, "sender": "bob", "relationship": "contradicts" },
                    { "from": 7, "to": 3, "sender": "carol", "relationship": "contradicts" }
                ],
                "unresolvedContradictions": [
                    { "from": 7, "to": 3, "sender": "carol", "relationship": "contradicts" }
                ],
                "typed": true
            },
            "tree": "#1 assert (alice)\n  #2 supports (bob)\n  #3 extends (carol)\n    #7 contradicts (carol)"
        })
    }

    #[test]
    fn parse_extracts_digest_and_tree() {
        let (digest, tree) = parse_lineage(&sample_response());
        assert_eq!(digest.total, 7);
        assert_eq!(digest.participants, 3);
        assert_eq!(digest.roots, 1);
        assert_eq!(digest.max_depth, 3);
        assert!(digest.typed);
        assert_eq!(digest.supports, 4);
        assert_eq!(digest.contradicts, 2);
        assert_eq!(digest.extends, 1);
        assert_eq!(digest.narrows, 0);
        assert_eq!(tree.lines().count(), 4);
        assert!(tree.starts_with("#1 assert"));
    }

    #[test]
    fn parse_extracts_unresolved_contradictions() {
        let (digest, _) = parse_lineage(&sample_response());
        assert_eq!(digest.unresolved.len(), 1);
        let edge = &digest.unresolved[0];
        assert_eq!(edge.from, 7);
        assert_eq!(edge.to, 3);
        assert_eq!(edge.sender, "carol");
        assert_eq!(edge.label(), "#7 → #3 (carol)");
    }

    #[test]
    fn stance_cells_skip_zero_relationships() {
        let (digest, _) = parse_lineage(&sample_response());
        let cells = digest.stance_cells();
        // supports=4 contradicts=2 extends=1 (narrows/synthesizes are zero → skipped)
        assert_eq!(cells, vec!["supports=4", "contradicts=2", "extends=1"]);
    }

    #[test]
    fn view_emits_contradiction_chips() {
        let mut pane = LineagePane::new();
        let (digest, tree) = parse_lineage(&sample_response());
        pane.digest = digest;
        pane.tree = tree;

        let blocks = pane.view();

        // Header present.
        assert!(matches!(&blocks[0], Block::Header(h) if h.starts_with("Discourse lineage")));

        // Exactly one Conflicted chip for the single unresolved contradiction,
        // labeled with the edge.
        let conflict_chips: Vec<&str> = blocks
            .iter()
            .filter_map(|b| match b {
                Block::Chip {
                    label,
                    tone: Tone::Conflicted,
                } => Some(label.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(conflict_chips, vec!["#7 → #3 (carol)"]);

        // The "Unresolved contradictions" header is present.
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::Header(h) if h == "Unresolved contradictions")));

        // The tree is rendered line-by-line — every line after the "Tree" header
        // (4 lines from the sample, including indented children) becomes a 1-cell
        // Row whose content mentions a message id.
        let tree_rows = blocks
            .iter()
            .filter(
                |b| matches!(b, Block::Row(cells) if cells.len() == 1 && cells[0].contains('#')),
            )
            .count();
        assert_eq!(tree_rows, 4);
    }

    #[test]
    fn view_renders_error_state() {
        let mut pane = LineagePane::new();
        pane.last_error = Some("daemon unreachable: connection refused".into());
        let blocks = pane.view();
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, _) if k == "error")));
        // Error short-circuits — no chips or tree rows.
        assert!(!blocks.iter().any(|b| matches!(b, Block::Chip { .. })));
    }

    #[test]
    fn parse_tolerates_missing_digest_and_tree() {
        let (digest, tree) = parse_lineage(&json!({ "ok": true, "channel": "x" }));
        assert_eq!(digest.total, 0);
        assert_eq!(digest.participants, 0);
        assert!(digest.unresolved.is_empty());
        assert!(tree.is_empty());
    }

    #[test]
    fn channel_defaults_when_env_unset() {
        // Don't assume the test process has PD_LINEAGE_CHANNEL set; the default
        // path must yield the documented fallback.
        std::env::remove_var("PD_LINEAGE_CHANNEL");
        let pane = LineagePane::new();
        assert_eq!(pane.channel, DEFAULT_CHANNEL);
    }
}
