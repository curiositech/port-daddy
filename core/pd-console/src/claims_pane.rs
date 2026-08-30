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
use futures_util::{stream, StreamExt};
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::{BTreeSet, HashMap};

const SESSION_JOIN_FAST_PATH_LIMIT: usize = 1_000;
const SESSION_DETAIL_CONCURRENCY: usize = 8;

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

fn referenced_session_ids(claims: &[Value]) -> Vec<String> {
    claims
        .iter()
        .map(|claim| s(claim, "sessionId"))
        .filter(|id| !id.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn missing_session_ids(claims: &[Value], sessions: &HashMap<String, SessionMeta>) -> Vec<String> {
    referenced_session_ids(claims)
        .into_iter()
        .filter(|id| !sessions.contains_key(id))
        .collect()
}

fn session_detail_url(base: &str, session_id: &str) -> std::result::Result<reqwest::Url, String> {
    let mut url =
        reqwest::Url::parse(base).map_err(|error| format!("invalid daemon URL: {error}"))?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "daemon URL cannot carry path segments".to_string())?;
        segments.pop_if_empty().push("sessions").push(session_id);
    }
    Ok(url)
}

async fn fetch_session_meta(
    client: reqwest::Client,
    base: String,
    session_id: String,
) -> std::result::Result<(String, SessionMeta), (String, String)> {
    let url =
        session_detail_url(&base, &session_id).map_err(|error| (session_id.clone(), error))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| (session_id.clone(), format!("request failed: {error}")))?;
    let status = response.status();
    if !status.is_success() {
        return Err((session_id, format!("returned {status}")));
    }
    let data = response
        .json::<Value>()
        .await
        .map_err(|error| (session_id.clone(), format!("invalid response: {error}")))?;
    let session = data
        .get("session")
        .filter(|value| value.is_object())
        .ok_or_else(|| {
            (
                session_id.clone(),
                "response omitted session metadata".into(),
            )
        })?;
    Ok((session_id, SessionMeta::from_value(session)))
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
    session_join_notice: Option<String>,
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
            session_join_notice: None,
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
        if let Some(notice) = &self.session_join_notice {
            blocks.push(Block::WrappedText {
                text: format!("SESSION METADATA RECOVERED\n{notice}"),
                tone: Tone::Engaged,
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

            let claim_values = arr(&claims_data, "claims");
            let mut sessions = HashMap::new();
            let mut join_notices = Vec::new();
            // This bounded collection is the fast path, not the correctness
            // boundary. Every referenced session it omits is recovered by its
            // exact /sessions/:id route below, with bounded concurrency and an
            // explicit degradation notice. Large harbors therefore never turn
            // claim owners back into anonymous strings because of a list cap.
            let sessions_url = format!(
                "{}/sessions?allWorktrees=true&status=active&limit={SESSION_JOIN_FAST_PATH_LIMIT}",
                daemon.base(),
            );
            match daemon.http_client().get(&sessions_url).send().await {
                Err(error) => {
                    join_notices.push(format!("GET /sessions unavailable: {error}"));
                }
                Ok(response) => {
                    let status = response.status();
                    if !status.is_success() {
                        join_notices.push(format!("GET /sessions returned {status}"));
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
                                join_notices.push(format!("Invalid sessions response: {error}"));
                            }
                        }
                    }
                }
            }

            let missing_before = missing_session_ids(claim_values, &sessions);
            if !missing_before.is_empty() {
                let requested = missing_before.len();
                let client = daemon.http_client().clone();
                let base = daemon.base().to_string();
                let recovered = stream::iter(missing_before.into_iter().map(|session_id| {
                    fetch_session_meta(client.clone(), base.clone(), session_id)
                }))
                .buffer_unordered(SESSION_DETAIL_CONCURRENCY)
                .collect::<Vec<_>>()
                .await;

                let mut recovered_count = 0;
                let mut failures = Vec::new();
                for result in recovered {
                    match result {
                        Ok((id, metadata)) => {
                            sessions.insert(id, metadata);
                            recovered_count += 1;
                        }
                        Err((id, reason)) => failures.push(format!("{id}: {reason}")),
                    }
                }
                if recovered_count > 0 {
                    join_notices.push(format!(
                        "Bulk session index omitted {requested} referenced session(s); exact recovery restored {recovered_count}."
                    ));
                }
                if !failures.is_empty() {
                    let hidden = failures.len().saturating_sub(3);
                    failures.truncate(3);
                    let suffix = if hidden == 0 {
                        String::new()
                    } else {
                        format!("; plus {hidden} more")
                    };
                    join_notices.push(format!(
                        "Exact session recovery failed for {}{suffix}",
                        failures.join("; ")
                    ));
                }
            }

            let malformed_claims = claim_values
                .iter()
                .filter(|claim| s(claim, "sessionId").is_empty())
                .count();
            if malformed_claims > 0 {
                join_notices.push(format!(
                    "{malformed_claims} claim(s) arrived without a session id."
                ));
            }
            let still_missing = missing_session_ids(claim_values, &sessions);
            let join_degraded = malformed_claims > 0 || !still_missing.is_empty();
            if !still_missing.is_empty() {
                let hidden = still_missing.len().saturating_sub(5);
                let mut visible = still_missing;
                visible.truncate(5);
                let suffix = if hidden == 0 {
                    String::new()
                } else {
                    format!("; plus {hidden} more")
                };
                join_notices.push(format!(
                    "{} claim session(s) still lack metadata: {}{suffix}",
                    visible.len() + hidden,
                    visible.join(", ")
                ));
            }
            let join_details = if claim_values.is_empty() || join_notices.is_empty() {
                None
            } else {
                Some(join_notices.join("\n"))
            };
            if join_degraded {
                self.session_join_error = join_details;
                self.session_join_notice = None;
            } else {
                self.session_join_error = None;
                self.session_join_notice = join_details;
            }

            self.last_error = None;
            self.claims = claim_values
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
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn claims_daemon_with_empty_bulk_join(detail_status: u16) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind claims test daemon");
        let base = format!(
            "http://{}",
            listener.local_addr().expect("test daemon address")
        );
        let handle = thread::spawn(move || {
            for _ in 0..3 {
                let (mut stream, _) = listener.accept().expect("accept claims request");
                let mut request = [0_u8; 8_192];
                let read = stream.read(&mut request).expect("read claims request");
                let request = String::from_utf8_lossy(&request[..read]);
                let (status, body) = if request.starts_with("GET /files ") {
                    (
                        200,
                        json!({
                            "success": true,
                            "claims": [{
                                "filePath": "src/recovered.rs",
                                "sessionId": "session-recovered",
                                "purpose": "prove exact metadata recovery",
                                "agentId": "agent-recovered",
                                "phase": "in_progress",
                                "claimedAt": 42,
                                "repoId": "port-daddy",
                                "worldKind": "worktree",
                                "worldId": "world-recovered",
                                "nodeId": "claim-node:recovered"
                            }]
                        })
                        .to_string(),
                    )
                } else if request.starts_with("GET /sessions?") {
                    (200, json!({ "success": true, "sessions": [] }).to_string())
                } else if request.starts_with("GET /sessions/session-recovered ") {
                    (
                        detail_status,
                        json!({
                            "success": detail_status == 200,
                            "session": {
                                "id": "session-recovered",
                                "status": "active",
                                "phase": "in_progress",
                                "agentId": "agent-recovered",
                                "worktreeId": "worktree-recovered",
                                "identityProject": "port-daddy",
                                "updatedAt": 43,
                                "metadata": {
                                    "identityString": "port-daddy:console:recovered",
                                    "roadmapLink": "claims-roadmap",
                                    "worktree": {
                                        "name": "recovered-worktree",
                                        "branch": "codex/recovered",
                                        "root": "/repo/recovered"
                                    }
                                },
                                "durable": true
                            }
                        })
                        .to_string(),
                    )
                } else {
                    (404, json!({ "success": false }).to_string())
                };
                let reason = if status == 200 { "OK" } else { "Not Found" };
                let response = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("write claims response");
            }
        });
        (base, handle)
    }

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
    fn missing_session_detection_is_exact_and_deduplicated() {
        let claims = json!({
            "claims": [
                { "sessionId": "session-b" },
                { "sessionId": "session-a" },
                { "sessionId": "session-b" },
                { "sessionId": "" },
                {}
            ]
        });
        let mut sessions = HashMap::new();
        sessions.insert("session-a".into(), SessionMeta::default());

        assert_eq!(
            missing_session_ids(arr(&claims, "claims"), &sessions),
            vec!["session-b"]
        );
    }

    #[test]
    fn exact_session_url_encodes_the_server_supplied_id_as_one_segment() {
        let url = session_detail_url("http://127.0.0.1:43127/", "session/with space")
            .expect("session detail URL");
        assert_eq!(
            url.as_str(),
            "http://127.0.0.1:43127/sessions/session%2Fwith%20space"
        );
    }

    #[tokio::test]
    async fn refresh_recovers_metadata_omitted_by_a_successful_empty_bulk_join() {
        let (base, server) = claims_daemon_with_empty_bulk_join(200);
        let daemon = DaemonClient::new(base);
        let mut pane = ClaimsPane::default();

        pane.refresh(&daemon).await.expect("refresh claims");
        server.join().expect("claims test daemon");

        assert!(pane.session_join_error.is_none());
        assert!(pane
            .session_join_notice
            .as_deref()
            .is_some_and(|notice| notice.contains("exact recovery restored 1")));
        let claim = pane.claims.first().expect("recovered claim");
        assert_eq!(claim.session.identity, "port-daddy:console:recovered");
        assert_eq!(claim.session.branch, "codex/recovered");
        assert_eq!(claim.session.roadmap_link, "claims-roadmap");
    }

    #[tokio::test]
    async fn refresh_exposes_an_exact_join_failure_instead_of_anonymous_silence() {
        let (base, server) = claims_daemon_with_empty_bulk_join(404);
        let daemon = DaemonClient::new(base);
        let mut pane = ClaimsPane::default();

        pane.refresh(&daemon).await.expect("refresh claims");
        server.join().expect("claims test daemon");

        assert!(pane.session_join_notice.is_none());
        let error = pane
            .session_join_error
            .as_deref()
            .expect("explicit join degradation");
        assert!(error.contains("session-recovered: returned 404 Not Found"));
        assert!(error.contains("still lack metadata"));
        assert_eq!(pane.claims[0].owner(), "agent-recovered");
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
