//! Claims pane — the claim forest as a conflict tree (ADR-0038 Phase 1).
//!
//! Calls `GET /claims/tree` (the claim-forest read endpoint). Real shape (v3.27):
//! `{ success, generatedAt, roots: [node], stats: { nodes, claims, conflicts,
//!    deadClaims, sessions } }` where node is
//! `{ nodeId, selectorKind, path, symbol, symbolPath, startLine, endLine,
//!    label, claims: [{ sessionId, agentId, purpose, mode, claimedAt(ms),
//!    sessionStatus, live }], conflict: { sessionIds } | null,
//!    rollup: { claims, conflicts, deadClaims }, children: [node] }`.
//!
//! Tone is the point: conflicted nodes render `Tone::Conflicted`, live claims
//! `Tone::Engaged`, dead-session claims (zombie protocol left them unreleased)
//! `Tone::Resting` with a `†` marker. Rollups keep an ancestor line red even
//! when the conflict is deep in the subtree.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{age_short, arr, b, n, s, trunc};
use anyhow::Result;
use serde_json::Value;

#[derive(Debug, Clone)]
struct ClaimEntry {
    agent_id: String,
    purpose: String,
    mode: String,
    claimed_at_ms: i64,
    live: bool,
}

impl ClaimEntry {
    fn from_value(v: &Value) -> Self {
        Self {
            agent_id: s(v, "agentId"),
            purpose: s(v, "purpose"),
            mode: s(v, "mode"),
            claimed_at_ms: n(v, "claimedAt"),
            live: b(v, "live"),
        }
    }
}

#[derive(Debug, Clone)]
struct TreeNode {
    label: String,
    conflict: bool,
    rollup_conflicts: i64,
    claims: Vec<ClaimEntry>,
    children: Vec<TreeNode>,
}

impl TreeNode {
    fn from_value(v: &Value) -> Self {
        let rollup = v.get("rollup");
        Self {
            label: s(v, "label"),
            conflict: v.get("conflict").map(|c| !c.is_null()).unwrap_or(false),
            rollup_conflicts: rollup.map(|r| n(r, "conflicts")).unwrap_or(0),
            claims: arr(v, "claims").iter().map(ClaimEntry::from_value).collect(),
            children: arr(v, "children").iter().map(TreeNode::from_value).collect(),
        }
    }
}

/// Node tone: conflict (direct or rolled up from the subtree) wins, then live
/// engagement, then dead-only claims dim, then structural default.
fn node_tone(node: &TreeNode) -> Tone {
    if node.conflict || node.rollup_conflicts > 0 {
        Tone::Conflicted
    } else if node.claims.iter().any(|c| c.live) {
        Tone::Engaged
    } else if !node.claims.is_empty() {
        Tone::Resting
    } else {
        Tone::Default
    }
}

fn claim_tone(node_conflicted: bool, claim: &ClaimEntry) -> Tone {
    if !claim.live {
        Tone::Resting
    } else if node_conflicted {
        Tone::Conflicted
    } else {
        Tone::Engaged
    }
}

/// Emit one node (and its claims + subtree) as box-drawing transcript lines.
fn push_tree_lines(node: &TreeNode, prefix: &str, is_last: bool, is_root: bool, out: &mut Vec<Block>) {
    let (branch, child_prefix) = if is_root {
        (prefix.to_string(), prefix.to_string())
    } else {
        (
            format!("{prefix}{}", if is_last { "└─ " } else { "├─ " }),
            format!("{prefix}{}", if is_last { "   " } else { "│  " }),
        )
    };

    let mut text = format!("{branch}{}", trunc(&node.label, 48));
    if node.conflict {
        text.push_str("  ‼ conflict");
    }
    out.push(Block::TranscriptLine {
        text,
        tone: node_tone(node),
    });

    let total = node.claims.len() + node.children.len();
    let mut idx = 0usize;

    for claim in &node.claims {
        idx += 1;
        let mark = if idx == total { "└─ " } else { "├─ " };
        let who = if claim.agent_id.is_empty() {
            trunc(&claim.purpose, 28)
        } else {
            format!("{}/{}", trunc(&claim.agent_id, 14), trunc(&claim.purpose, 22))
        };
        let mut line = format!(
            "{child_prefix}{mark}{} · {} · {}",
            claim.mode,
            who,
            age_short(claim.claimed_at_ms)
        );
        if !claim.live {
            line.push_str(" †");
        }
        out.push(Block::TranscriptLine {
            text: line,
            tone: claim_tone(node.conflict, claim),
        });
    }

    for child in &node.children {
        idx += 1;
        push_tree_lines(child, &child_prefix, idx == total, false, out);
    }
}

pub struct ClaimsPane {
    roots: Vec<TreeNode>,
    stats_claims: i64,
    stats_conflicts: i64,
    stats_dead: i64,
    last_error: Option<String>,
}

impl Default for ClaimsPane {
    fn default() -> Self {
        Self {
            roots: Vec::new(),
            stats_claims: 0,
            stats_conflicts: 0,
            stats_dead: 0,
            last_error: None,
        }
    }
}

impl ClaimsPane {
    pub fn new() -> Self {
        Self::default()
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
        let mut blocks = vec![Block::Header("Claim Tree".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        if self.roots.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no unreleased claims".into()));
        } else {
            blocks.push(Block::Gap);
            for root in &self.roots {
                push_tree_lines(root, "", true, true, &mut blocks);
            }
        }

        blocks.push(Block::Gap);
        let mut label = format!(
            "{} claim{} · {} conflict{}",
            self.stats_claims,
            if self.stats_claims == 1 { "" } else { "s" },
            self.stats_conflicts,
            if self.stats_conflicts == 1 { "" } else { "s" },
        );
        if self.stats_dead > 0 {
            label.push_str(&format!(" · {} dead", self.stats_dead));
        }
        blocks.push(Block::Chip {
            label,
            tone: if self.stats_conflicts > 0 {
                Tone::Conflicted
            } else if self.stats_claims > 0 {
                Tone::Engaged
            } else {
                Tone::Resting
            },
        });
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/claims/tree", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.roots.clear();
                }
                Ok(resp) => match resp.json::<Value>().await {
                    Err(e) => self.last_error = Some(format!("bad response: {e}")),
                    Ok(data) => {
                        self.last_error = None;
                        self.roots = arr(&data, "roots").iter().map(TreeNode::from_value).collect();
                        let stats = data.get("stats");
                        self.stats_claims = stats.map(|st| n(st, "claims")).unwrap_or(0);
                        self.stats_conflicts = stats.map(|st| n(st, "conflicts")).unwrap_or(0);
                        self.stats_dead = stats.map(|st| n(st, "deadClaims")).unwrap_or(0);
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

    /// Trimmed from a REAL `GET /claims/tree` response (daemon v3.27, seeded
    /// over HTTP: two live sessions force-claiming lib/claim-forest.ts).
    fn real_payload_root() -> Value {
        json!({
            "nodeId": "claim-node:0a9110de1d49d2cfe1e88f9c",
            "selectorKind": "repo",
            "path": null, "symbol": null, "symbolPath": null,
            "startLine": null, "endLine": null,
            "repoId": "local", "worldKind": "worktree", "worldId": "006928dd",
            "label": "local @ 006928dd",
            "claims": [],
            "conflict": null,
            "rollup": { "claims": 2, "conflicts": 1, "deadClaims": 0 },
            "children": [{
                "nodeId": "claim-node:0fd0fc700bbdfd4764681880",
                "selectorKind": "directory",
                "path": "lib", "label": "lib/",
                "claims": [],
                "conflict": null,
                "rollup": { "claims": 2, "conflicts": 1, "deadClaims": 0 },
                "children": [{
                    "nodeId": "claim-node:e55a139b6bf5f4db6e0c9820",
                    "selectorKind": "file",
                    "path": "lib/claim-forest.ts", "label": "claim-forest.ts",
                    "claims": [
                        {
                            "sessionId": "session-revive-claim-tree-viz-eab334973131",
                            "agentId": "agent-alpha", "purpose": "revive claim-tree viz",
                            "mode": "X", "intent": null,
                            "claimedAt": 1785849153954i64,
                            "sessionStatus": "active", "live": true
                        },
                        {
                            "sessionId": "session-refactor-sessions-facade-91f051fbf7f8",
                            "agentId": "agent-beta", "purpose": "refactor sessions facade",
                            "mode": "X", "intent": null,
                            "claimedAt": 1785849167459i64,
                            "sessionStatus": "active", "live": true
                        }
                    ],
                    "conflict": {
                        "sessionIds": [
                            "session-refactor-sessions-facade-91f051fbf7f8",
                            "session-revive-claim-tree-viz-eab334973131"
                        ]
                    },
                    "rollup": { "claims": 2, "conflicts": 1, "deadClaims": 0 },
                    "children": []
                }]
            }]
        })
    }

    #[test]
    fn from_value_real_shape() {
        let root = TreeNode::from_value(&real_payload_root());
        assert_eq!(root.label, "local @ 006928dd");
        assert!(!root.conflict);
        assert_eq!(root.rollup_conflicts, 1); // rolled up from the file node
        assert_eq!(root.children.len(), 1);

        let file = &root.children[0].children[0];
        assert_eq!(file.label, "claim-forest.ts");
        assert!(file.conflict); // non-null conflict object
        assert_eq!(file.claims.len(), 2);
        assert!(file.claims.iter().all(|c| c.live));
        assert_eq!(file.claims[0].mode, "X");
        assert_eq!(file.claims[0].claimed_at_ms, 1785849153954);
    }

    #[test]
    fn view_empty() {
        let p = ClaimsPane::default();
        let blocks = p.view();
        assert!(matches!(&blocks[0], Block::Header(h) if h.contains("Claim")));
        assert!(blocks
            .iter()
            .any(|blk| matches!(blk, Block::KeyVal(k, _) if k == "status")));
    }

    #[test]
    fn view_marks_conflict_tone() {
        let mut p = ClaimsPane::default();
        p.roots = vec![TreeNode::from_value(&real_payload_root())];
        p.stats_claims = 2;
        p.stats_conflicts = 1;
        let blocks = p.view();

        // The conflicted file node line is red and carries the text marker.
        assert!(blocks.iter().any(|blk| matches!(
            blk,
            Block::TranscriptLine { text, tone: Tone::Conflicted } if text.contains("claim-forest.ts") && text.contains("‼ conflict")
        )));
        // Ancestor lines read red too (rollup), even without a direct conflict.
        assert!(blocks.iter().any(|blk| matches!(
            blk,
            Block::TranscriptLine { text, tone: Tone::Conflicted } if text.contains("lib/")
        )));
        // Both live claims under a conflicted node render conflicted.
        let conflicted_claims = blocks
            .iter()
            .filter(|blk| matches!(
                blk,
                Block::TranscriptLine { text, tone: Tone::Conflicted } if text.contains("X · agent-")
            ))
            .count();
        assert_eq!(conflicted_claims, 2);
        // Summary chip goes conflicted.
        assert!(blocks.iter().any(|blk| matches!(
            blk,
            Block::Chip { label, tone: Tone::Conflicted } if label.contains("1 conflict")
        )));
    }

    #[test]
    fn view_dims_dead_session_claims() {
        let node = json!({
            "label": "claims_pane.rs", "selectorKind": "file",
            "claims": [{
                "sessionId": "session-doomed", "agentId": "agent-gamma",
                "purpose": "doomed zombie work", "mode": "X",
                "claimedAt": 1785849175156i64,
                "sessionStatus": "abandoned", "live": false
            }],
            "conflict": null,
            "rollup": { "claims": 1, "conflicts": 0, "deadClaims": 1 },
            "children": []
        });
        let mut p = ClaimsPane::default();
        p.roots = vec![TreeNode::from_value(&node)];
        p.stats_claims = 1;
        p.stats_dead = 1;
        let blocks = p.view();

        // Dead claim: dimmed (Resting) with the † marker; never conflict-causing.
        assert!(blocks.iter().any(|blk| matches!(
            blk,
            Block::TranscriptLine { text, tone: Tone::Resting } if text.contains('†') && text.contains("agent-gamma")
        )));
        // A node holding only dead claims dims too.
        assert!(blocks.iter().any(|blk| matches!(
            blk,
            Block::TranscriptLine { text, tone: Tone::Resting } if text.contains("claims_pane.rs")
        )));
        // Chip reports the dead count without going conflicted.
        assert!(blocks.iter().any(|blk| matches!(
            blk,
            Block::Chip { label, tone: Tone::Engaged } if label.contains("1 dead")
        )));
    }

    #[test]
    fn view_tree_row_count() {
        let mut p = ClaimsPane::default();
        p.roots = vec![TreeNode::from_value(&real_payload_root())];
        let lines = p
            .view()
            .iter()
            .filter(|blk| matches!(blk, Block::TranscriptLine { .. }))
            .count();
        // 3 nodes (repo → lib/ → claim-forest.ts) + 2 claim lines.
        assert_eq!(lines, 5);
    }

    #[test]
    fn tree_prefixes_nest() {
        let mut blocks = Vec::new();
        let root = TreeNode::from_value(&real_payload_root());
        push_tree_lines(&root, "", true, true, &mut blocks);
        let texts: Vec<&str> = blocks
            .iter()
            .filter_map(|blk| match blk {
                Block::TranscriptLine { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(texts[0], "local @ 006928dd");
        assert!(texts[1].starts_with("└─ lib/"));
        assert!(texts[2].starts_with("   └─ claim-forest.ts"));
        assert!(texts[3].starts_with("      ├─ X · agent-alpha/"));
        assert!(texts[4].starts_with("      └─ X · agent-beta/"));
    }
}
