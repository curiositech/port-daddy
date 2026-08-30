//! Claims pane — sortable file/symbol authority with a full inspector.
//!
//! `GET /files` is authoritative. `GET /sessions?allWorktrees=true` adds the
//! identity, worktree, branch, roadmap, and durability context operators need
//! to understand each claim. If that join fails, claims remain visible and the
//! missing context is reported explicitly.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, SurfaceAction, Tone};
use crate::util::{age_short, arr, n, s};
use anyhow::Result;
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::HashMap;

#[derive(Debug, Clone, Default)]
struct SessionMeta {
    status: String,
    identity: String,
    project: String,
    worktree_id: String,
    worktree_root: String,
    worktree_name: String,
    branch: String,
    roadmap_link: String,
    updated_at_ms: i64,
    durable: bool,
}

impl SessionMeta {
    fn from_value(v: &Value) -> Self {
        let metadata = v.get("metadata").unwrap_or(&Value::Null);
        let worktree = metadata.get("worktree").unwrap_or(&Value::Null);
        Self {
            status: s(v, "status"),
            identity: s(metadata, "identityString"),
            project: s(v, "identityProject"),
            worktree_id: s(v, "worktreeId"),
            worktree_root: s(worktree, "root"),
            worktree_name: s(worktree, "name"),
            branch: s(worktree, "branch"),
            roadmap_link: s(metadata, "roadmapLink"),
            updated_at_ms: n(v, "updatedAt"),
            durable: v.get("durable").and_then(Value::as_bool).unwrap_or(false),
        }
    }
}

#[derive(Debug, Clone)]
struct ClaimEntry {
    file_path: String,
    session_id: String,
    purpose: String,
    agent_id: String,
    phase: String,
    claimed_at_ms: i64,
    start_line: Option<i64>,
    end_line: Option<i64>,
    symbol: String,
    symbol_path: String,
    repo_id: String,
    world_kind: String,
    world_id: String,
    node_id: String,
    session: SessionMeta,
}

impl ClaimEntry {
    fn from_value(v: &Value, sessions: &HashMap<String, SessionMeta>) -> Self {
        let session_id = s(v, "sessionId");
        Self {
            file_path: s(v, "filePath"),
            session_id: session_id.clone(),
            purpose: s(v, "purpose"),
            agent_id: s(v, "agentId"),
            phase: s(v, "phase"),
            claimed_at_ms: n(v, "claimedAt"),
            start_line: v.get("startLine").and_then(Value::as_i64),
            end_line: v.get("endLine").and_then(Value::as_i64),
            symbol: s(v, "symbol"),
            symbol_path: s(v, "symbolPath"),
            repo_id: s(v, "repoId"),
            world_kind: s(v, "worldKind"),
            world_id: s(v, "worldId"),
            node_id: s(v, "nodeId"),
            session: sessions.get(&session_id).cloned().unwrap_or_default(),
        }
    }

    fn stable_id(&self) -> String {
        if !self.node_id.is_empty() {
            self.node_id.clone()
        } else {
            format!("{}:{}:{}", self.session_id, self.file_path, self.scope())
        }
    }

    fn scope(&self) -> String {
        if !self.symbol_path.is_empty() {
            format!("symbol {}", self.symbol_path)
        } else if !self.symbol.is_empty() {
            format!("symbol {}", self.symbol)
        } else if let (Some(start), Some(end)) = (self.start_line, self.end_line) {
            format!("lines {start}-{end}")
        } else {
            "whole file".into()
        }
    }

    fn owner(&self) -> String {
        if self.session.identity.is_empty() {
            self.agent_id.clone()
        } else {
            format!("{} · {}", self.session.identity, self.agent_id)
        }
    }

    fn worktree(&self) -> String {
        let label = if !self.session.worktree_name.is_empty() {
            self.session.worktree_name.clone()
        } else if !self.session.worktree_id.is_empty() {
            self.session.worktree_id.clone()
        } else {
            "unknown worktree".into()
        };
        if self.session.branch.is_empty() {
            label
        } else {
            format!("{label} · {}", self.session.branch)
        }
    }

    fn phase_label(&self) -> String {
        if self.session.status.is_empty() || self.session.status == self.phase {
            self.phase.clone()
        } else {
            format!("{} · session {}", self.phase, self.session.status)
        }
    }

    fn tone(&self) -> Tone {
        match self.phase.as_str() {
            "completed" | "done" => Tone::Landed,
            "blocked" | "abandoned" => Tone::Conflicted,
            "paused" => Tone::Gated,
            _ => Tone::Engaged,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClaimSort {
    Path,
    Scope,
    Owner,
    Purpose,
    Worktree,
    Phase,
    Acquired,
}

impl ClaimSort {
    fn key(self) -> &'static str {
        match self {
            Self::Path => "path",
            Self::Scope => "scope",
            Self::Owner => "owner",
            Self::Purpose => "purpose",
            Self::Worktree => "worktree",
            Self::Phase => "phase",
            Self::Acquired => "acquired",
        }
    }

    fn parse(key: &str) -> Option<Self> {
        Some(match key {
            "path" => Self::Path,
            "scope" => Self::Scope,
            "owner" => Self::Owner,
            "purpose" => Self::Purpose,
            "worktree" => Self::Worktree,
            "phase" => Self::Phase,
            "acquired" => Self::Acquired,
            _ => return None,
        })
    }
}

pub struct ClaimsPane {
    claims: Vec<ClaimEntry>,
    selected_id: Option<String>,
    sort: ClaimSort,
    descending: bool,
    last_error: Option<String>,
    session_join_error: Option<String>,
}

impl Default for ClaimsPane {
    fn default() -> Self {
        Self {
            claims: Vec::new(),
            selected_id: None,
            sort: ClaimSort::Acquired,
            descending: true,
            last_error: None,
            session_join_error: None,
        }
    }
}

impl ClaimsPane {
    pub fn new() -> Self {
        Self::default()
    }

    fn sorted_indices(&self) -> Vec<usize> {
        let mut indices: Vec<usize> = (0..self.claims.len()).collect();
        indices.sort_by(|a, b| {
            let left = &self.claims[*a];
            let right = &self.claims[*b];
            let order = match self.sort {
                ClaimSort::Path => cmp_text(&left.file_path, &right.file_path),
                ClaimSort::Scope => cmp_text(&left.scope(), &right.scope()),
                ClaimSort::Owner => cmp_text(&left.owner(), &right.owner()),
                ClaimSort::Purpose => cmp_text(&left.purpose, &right.purpose),
                ClaimSort::Worktree => cmp_text(&left.worktree(), &right.worktree()),
                ClaimSort::Phase => cmp_text(&left.phase_label(), &right.phase_label()),
                ClaimSort::Acquired => left.claimed_at_ms.cmp(&right.claimed_at_ms),
            };
            let order = if self.descending {
                order.reverse()
            } else {
                order
            };
            order.then_with(|| left.stable_id().cmp(&right.stable_id()))
        });
        indices
    }

    fn selected(&self) -> Option<&ClaimEntry> {
        let id = self.selected_id.as_deref()?;
        self.claims.iter().find(|claim| claim.stable_id() == id)
    }

    fn inspector(claim: &ClaimEntry) -> Vec<Block> {
        let range = match (claim.start_line, claim.end_line) {
            (Some(start), Some(end)) => format!("{start}-{end}"),
            _ => "whole file".into(),
        };
        let fields = [
            ("claim node", claim.stable_id()),
            ("file", claim.file_path.clone()),
            ("scope", claim.scope()),
            ("symbol", claim.symbol.clone()),
            ("symbol path", claim.symbol_path.clone()),
            ("line range", range),
            ("agent", claim.agent_id.clone()),
            ("session", claim.session_id.clone()),
            ("identity", claim.session.identity.clone()),
            ("purpose", claim.purpose.clone()),
            ("phase", claim.phase_label()),
            ("acquired", timestamp_label(claim.claimed_at_ms)),
            (
                "session updated",
                timestamp_label(claim.session.updated_at_ms),
            ),
            ("project", claim.session.project.clone()),
            ("repository", claim.repo_id.clone()),
            (
                "world",
                format!("{} · {}", claim.world_kind, claim.world_id),
            ),
            ("worktree", claim.worktree()),
            ("worktree root", claim.session.worktree_root.clone()),
            ("branch", claim.session.branch.clone()),
            ("roadmap", claim.session.roadmap_link.clone()),
            ("durable", claim.session.durable.to_string()),
        ];
        let mut blocks = vec![Block::Gap, Block::Header("Claim inspector".into())];
        blocks.extend(fields.into_iter().map(|(label, value)| Block::WrappedText {
            text: format!("{}\n{}", label.to_ascii_uppercase(), breakable(&value)),
            tone: if value.is_empty() {
                Tone::Resting
            } else {
                claim.tone()
            },
        }));
        blocks
    }
}

fn cmp_text(left: &str, right: &str) -> Ordering {
    left.to_ascii_lowercase().cmp(&right.to_ascii_lowercase())
}

fn timestamp_label(timestamp: i64) -> String {
    if timestamp <= 0 {
        "unknown".into()
    } else {
        format!("{} · {timestamp}", age_short(timestamp))
    }
}

/// Invisible wrap opportunities preserve every visible character while
/// preventing structured ids and paths from forcing horizontal overflow.
fn breakable(value: &str) -> String {
    value
        .replace('/', "/\u{200b}")
        .replace(':', ":\u{200b}")
        .replace('-', "-\u{200b}")
}

impl Pane for ClaimsPane {
    fn id(&self) -> &str {
        "claims"
    }
    fn title(&self) -> String {
        "Claims".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Claims".into())];
        if let Some(error) = &self.last_error {
            blocks.push(Block::WrappedText {
                text: error.clone(),
                tone: Tone::Conflicted,
            });
            return blocks;
        }
        blocks.push(Block::KeyVal(
            "active claims".into(),
            self.claims.len().to_string(),
        ));
        if let Some(error) = &self.session_join_error {
            blocks.push(Block::WrappedText {
                text: format!("SESSION METADATA DEGRADED\n{error}"),
                tone: Tone::Gated,
            });
        }
        if self.claims.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no active claims".into()));
            return blocks;
        }

        blocks.push(Block::LedgerHeader {
            surface: self.id().into(),
            columns: vec![
                ("path".into(), "Path".into()),
                ("scope".into(), "Scope".into()),
                ("owner".into(), "Owner".into()),
                ("purpose".into(), "Purpose".into()),
                ("worktree".into(), "Worktree / branch".into()),
                ("phase".into(), "Phase".into()),
                ("acquired".into(), "Acquired".into()),
            ],
            active_sort: self.sort.key().into(),
            descending: self.descending,
        });

        for (row_index, claim_index) in self.sorted_indices().into_iter().enumerate() {
            let claim = &self.claims[claim_index];
            let stable_id = claim.stable_id();
            blocks.push(Block::LedgerRow {
                surface: self.id().into(),
                index: row_index,
                selected: self.selected_id.as_deref() == Some(stable_id.as_str()),
                cells: vec![
                    ("path".into(), breakable(&claim.file_path)),
                    ("scope".into(), breakable(&claim.scope())),
                    ("owner".into(), breakable(&claim.owner())),
                    ("purpose".into(), breakable(&claim.purpose)),
                    ("worktree".into(), breakable(&claim.worktree())),
                    ("phase".into(), claim.phase_label()),
                    ("acquired".into(), timestamp_label(claim.claimed_at_ms)),
                ],
                tone: claim.tone(),
            });
        }
        if let Some(claim) = self.selected() {
            blocks.extend(Self::inspector(claim));
        } else {
            blocks.push(Block::WrappedText {
                text: "Select a claim to inspect every raw authority and worktree field.".into(),
                tone: Tone::Resting,
            });
        }
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let claims_url = format!("{}/files", daemon.base());
            let claims_data = match daemon.http_client().get(&claims_url).send().await {
                Err(error) => {
                    self.last_error = Some(format!("Claims authority unreachable: {error}"));
                    self.claims.clear();
                    return Ok(());
                }
                Ok(response) => {
                    let status = response.status();
                    if !status.is_success() {
                        self.last_error = Some(format!("GET /files returned {status}"));
                        self.claims.clear();
                        return Ok(());
                    }
                    match response.json::<Value>().await {
                        Ok(data) => data,
                        Err(error) => {
                            self.last_error = Some(format!("Invalid claims response: {error}"));
                            self.claims.clear();
                            return Ok(());
                        }
                    }
                }
            };

            let mut sessions = HashMap::new();
            self.session_join_error = None;
            // /files only returns claims from ACTIVE sessions, so fetch that
            // exact cohort and lift the default 50-row session cap. Without
            // the explicit limit, a busy harbor silently loses the join for
            // most claim rows and falls back to the same anonymous strings
            // this ledger exists to replace.
            let sessions_url = format!(
                "{}/sessions?allWorktrees=true&status=active&limit=1000",
                daemon.base()
            );
            match daemon.http_client().get(&sessions_url).send().await {
                Err(error) => {
                    self.session_join_error = Some(format!("GET /sessions unavailable: {error}"))
                }
                Ok(response) => {
                    let status = response.status();
                    if !status.is_success() {
                        self.session_join_error = Some(format!("GET /sessions returned {status}"));
                    } else {
                        match response.json::<Value>().await {
                            Ok(data) => {
                                for session in arr(&data, "sessions") {
                                    let id = s(session, "id");
                                    if !id.is_empty() {
                                        sessions.insert(id, SessionMeta::from_value(session));
                                    }
                                }
                            }
                            Err(error) => {
                                self.session_join_error =
                                    Some(format!("Invalid sessions response: {error}"))
                            }
                        }
                    }
                }
            }

            self.last_error = None;
            self.claims = arr(&claims_data, "claims")
                .iter()
                .map(|value| ClaimEntry::from_value(value, &sessions))
                .collect();
            if self
                .selected_id
                .as_deref()
                .is_some_and(|id| !self.claims.iter().any(|claim| claim.stable_id() == id))
            {
                self.selected_id = None;
            }
            Ok(())
        })
    }

    fn mutate<'a>(
        &'a mut self,
        _daemon: &'a DaemonClient,
        action: SurfaceAction,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            match action {
                SurfaceAction::SelectRow { index } => {
                    if let Some(claim_index) = self.sorted_indices().get(index).copied() {
                        self.selected_id = Some(self.claims[claim_index].stable_id());
                    }
                }
                SurfaceAction::Sort { key } => {
                    if let Some(sort) = ClaimSort::parse(&key) {
                        if self.sort == sort {
                            self.descending = !self.descending;
                        } else {
                            self.sort = sort;
                            self.descending = matches!(sort, ClaimSort::Acquired);
                        }
                    }
                }
                _ => {}
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry(path: &str, purpose: &str, claimed_at: i64) -> ClaimEntry {
        let mut sessions = HashMap::new();
        sessions.insert(
            "session-x".into(),
            SessionMeta {
                identity: "port-daddy:console:claims".into(),
                worktree_name: "claims-worktree".into(),
                branch: "codex/claims".into(),
                ..SessionMeta::default()
            },
        );
        ClaimEntry::from_value(
            &json!({
                "filePath": path, "sessionId": "session-x", "purpose": purpose,
                "agentId": "agent-x", "phase": "in_progress", "claimedAt": claimed_at,
                "startLine": 10, "endLine": 42, "symbol": null,
                "symbolPath": "ClaimsPane::view", "repoId": "port-daddy",
                "worldKind": "worktree", "worldId": "abc123", "nodeId": format!("node-{claimed_at}")
            }),
            &sessions,
        )
    }

    #[test]
    fn parses_authority_and_joined_session_metadata() {
        let claim = entry(
            "core/pd-console/src/claims_pane.rs",
            "make claims legible",
            99,
        );
        assert_eq!(claim.scope(), "symbol ClaimsPane::view");
        assert!(claim.owner().contains("port-daddy:console:claims"));
        assert!(claim.worktree().contains("codex/claims"));
    }

    #[test]
    fn view_never_truncates_path_purpose_or_owner() {
        let mut pane = ClaimsPane::default();
        let path = "core/pd-console/src/a/very/deep/full/path/that/must/remain.rs";
        let purpose = "a complete purpose that must remain visible and inspectable";
        pane.claims = vec![entry(path, purpose, 99)];
        let cells = pane
            .view()
            .into_iter()
            .find_map(|block| match block {
                Block::LedgerRow { cells, .. } => Some(cells),
                _ => None,
            })
            .expect("ledger row");
        let visible = cells
            .into_iter()
            .map(|(_, value)| value.replace('\u{200b}', ""))
            .collect::<Vec<_>>()
            .join(" ");
        assert!(visible.contains(path));
        assert!(visible.contains(purpose));
        assert!(visible.contains("port-daddy:console:claims"));
    }

    #[tokio::test]
    async fn sort_and_selection_follow_visible_order() {
        let mut pane = ClaimsPane::default();
        pane.claims = vec![entry("z.rs", "second", 1), entry("a.rs", "first", 2)];
        let daemon = DaemonClient::new("http://127.0.0.1:1".into());
        pane.mutate(&daemon, SurfaceAction::Sort { key: "path".into() })
            .await
            .unwrap();
        pane.mutate(&daemon, SurfaceAction::SelectRow { index: 0 })
            .await
            .unwrap();
        assert_eq!(
            pane.selected().map(|claim| claim.file_path.as_str()),
            Some("a.rs")
        );
        assert!(pane
            .view()
            .iter()
            .any(|block| matches!(block, Block::Header(text) if text == "Claim inspector")));
    }

    #[test]
    fn wrap_opportunities_preserve_visible_text() {
        let original = "/long/path/session-id:claim";
        assert_eq!(breakable(original).replace('\u{200b}', ""), original);
    }
}
