//! Agents — one cross-backend, cross-berth conversation directory.

use crate::agent::DaemonClient;
use crate::pane::{Block, LedgerCell, Pane, SurfaceAction, Tone};
use crate::util::{age_short, arr, n, s};
use anyhow::Result;
use serde_json::Value;
use std::path::PathBuf;

#[derive(Debug, Clone, Default)]
struct ProviderEvidence {
    label: String,
    family: String,
    backend: String,
    model: String,
    confidence: String,
}

#[derive(Debug, Clone, Default)]
struct SessionLocation {
    id: String,
    label: String,
    tier: String,
    state: String,
    current: bool,
    canonical: bool,
    ledger_preserved: bool,
    url: String,
    branch: String,
    revision: String,
}

impl SessionLocation {
    fn from_value(value: &Value) -> Self {
        Self {
            id: s(value, "id"),
            label: s(value, "label"),
            tier: s(value, "tier"),
            state: s(value, "state"),
            current: value
                .get("current")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            canonical: value
                .get("canonical")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            ledger_preserved: value
                .get("ledgerPreserved")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            url: s(value, "url"),
            branch: s(value, "gitBranch"),
            revision: s(value, "gitRev"),
        }
    }

    fn display(&self) -> String {
        let mut bits = vec![self.label.clone(), self.tier.clone(), self.state.clone()];
        if self.current {
            bits.push("current".into());
        }
        if self.canonical {
            bits.push("canonical".into());
        }
        if !self.branch.is_empty() {
            bits.push(self.branch.clone());
        }
        if !self.revision.is_empty() {
            bits.push(self.revision.clone());
        }
        bits.join(" · ")
    }
}

#[derive(Debug, Clone, Default)]
struct SessionNote {
    kind: String,
    content: String,
    created_at_ms: i64,
}

#[derive(Debug, Clone)]
struct SessionEntry {
    id: String,
    purpose: String,
    status: String,
    phase: String,
    agent_id: String,
    project: String,
    durable: bool,
    file_count: i64,
    note_count: i64,
    updated_at_ms: i64,
    worktree_id: String,
    worktree_root: String,
    worktree_name: String,
    branch: String,
    provider: ProviderEvidence,
    liveness: String,
    primary_location_id: String,
    locations: Vec<SessionLocation>,
    notes: Vec<SessionNote>,
}

impl SessionEntry {
    fn from_value(value: &Value) -> Self {
        let provider = value.get("provider").unwrap_or(&Value::Null);
        let worktree = value.get("worktree").unwrap_or(&Value::Null);
        Self {
            id: s(value, "id"),
            purpose: s(value, "purpose"),
            status: s(value, "status"),
            phase: s(value, "phase"),
            agent_id: s(value, "agentId"),
            project: s(value, "identityProject"),
            durable: value
                .get("durable")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            file_count: n(value, "fileCount"),
            note_count: n(value, "noteCount"),
            updated_at_ms: n(value, "updatedAt"),
            worktree_id: s(worktree, "id"),
            worktree_root: s(worktree, "root"),
            worktree_name: s(worktree, "name"),
            branch: s(worktree, "branch"),
            provider: ProviderEvidence {
                label: s(provider, "label"),
                family: s(provider, "adapterFamily"),
                backend: s(provider, "backend"),
                model: s(provider, "model"),
                confidence: s(provider, "confidence"),
            },
            liveness: s(value, "liveness"),
            primary_location_id: s(value, "primaryLocationId"),
            locations: arr(value, "locations")
                .iter()
                .map(SessionLocation::from_value)
                .collect(),
            notes: arr(value, "notes")
                .iter()
                .map(|note| SessionNote {
                    kind: s(note, "type"),
                    content: s(note, "content"),
                    created_at_ms: n(note, "createdAt"),
                })
                .collect(),
        }
    }

    fn provider_label(&self) -> String {
        let mut bits = Vec::new();
        if !self.provider.label.is_empty() {
            bits.push(self.provider.label.clone());
        }
        if !self.provider.backend.is_empty() && self.provider.backend != self.provider.label {
            bits.push(self.provider.backend.clone());
        }
        if !self.provider.model.is_empty() {
            bits.push(self.provider.model.clone());
        }
        if bits.is_empty() {
            "Provider not witnessed".into()
        } else {
            bits.join(" · ")
        }
    }

    fn location_label(&self) -> String {
        self.locations
            .iter()
            .map(|location| location.label.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    }

    fn tone(&self) -> Tone {
        match (self.status.as_str(), self.liveness.as_str()) {
            ("active", "alive") => Tone::Engaged,
            ("active", "stale") => Tone::Gated,
            ("active", _) => Tone::Accent,
            ("completed", _) => Tone::Landed,
            ("failed", _) => Tone::Conflicted,
            ("abandoned", _) => Tone::Gated,
            _ => Tone::Resting,
        }
    }
}

#[derive(Debug, Clone)]
struct TranscriptEntry {
    sequence: u64,
    kind: String,
    speaker: String,
    text: String,
    tone: Tone,
}

impl TranscriptEntry {
    fn from_value(value: &Value) -> Self {
        let kind = s(value, "kind");
        let payload = value.get("payloadJson").unwrap_or(&Value::Null);
        let mut text = ["text", "message", "summary", "command", "path", "detail"]
            .iter()
            .map(|key| s(payload, key))
            .find(|candidate| !candidate.is_empty())
            .unwrap_or_else(|| kind.clone());
        let redaction = s(value, "redactionState");
        if matches!(redaction.as_str(), "redacted" | "quarantined") {
            text = format!("[{redaction}] content withheld by retention policy");
        }
        let (speaker, tone) = match kind.as_str() {
            "operator_message" => ("you", Tone::Accent),
            "assistant_message" | "assistant_delta" | "reasoning_summary" => {
                ("agent", Tone::Default)
            }
            "tool_denied" | "approval_request" | "budget_warning" => ("gate", Tone::Gated),
            "adapter_error" | "provider_error" | "transcript_gap" | "retention_failure" => {
                ("error", Tone::Conflicted)
            }
            "receipt_completed" | "receipt_verified" | "checkpoint" => ("receipt", Tone::Landed),
            "tool_call" | "tool_result" | "shell_command" | "stdout_chunk" | "stderr_chunk" => {
                ("tool", Tone::Resting)
            }
            _ => ("event", Tone::Default),
        };
        Self {
            sequence: value.get("sequence").and_then(Value::as_u64).unwrap_or(0),
            kind,
            speaker: speaker.into(),
            text,
            tone,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionSort {
    Updated,
    Status,
    Provider,
    Project,
    Purpose,
}

impl SessionSort {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "updated" => Some(Self::Updated),
            "status" => Some(Self::Status),
            "provider" => Some(Self::Provider),
            "project" => Some(Self::Project),
            "purpose" => Some(Self::Purpose),
            _ => None,
        }
    }
    fn key(self) -> &'static str {
        match self {
            Self::Updated => "updated",
            Self::Status => "status",
            Self::Provider => "provider",
            Self::Project => "project",
            Self::Purpose => "purpose",
        }
    }
}

pub struct SessionsPane {
    sessions: Vec<SessionEntry>,
    locations: Vec<SessionLocation>,
    selected_id: Option<String>,
    selected_location_id: Option<String>,
    sort: SessionSort,
    descending: bool,
    transcript: Vec<TranscriptEntry>,
    transcript_error: Option<String>,
    generated_at_ms: i64,
    last_error: Option<String>,
}

impl Default for SessionsPane {
    fn default() -> Self {
        let (selected_id, selected_location_id) = Self::load_selection();
        Self {
            sessions: Vec::new(),
            locations: Vec::new(),
            selected_id,
            selected_location_id,
            sort: SessionSort::Updated,
            descending: true,
            transcript: Vec::new(),
            transcript_error: None,
            generated_at_ms: 0,
            last_error: None,
        }
    }
}

impl SessionsPane {
    pub fn new() -> Self {
        Self::default()
    }
    fn selection_path() -> Option<PathBuf> {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .map(|home| home.join(".port-daddy/pd-console-selected-session"))
    }
    fn load_selection() -> (Option<String>, Option<String>) {
        let Some(value) = Self::selection_path()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            return (None, None);
        };
        if let Ok(saved) = serde_json::from_str::<Value>(&value) {
            let session_id = s(&saved, "sessionId");
            let location_id = s(&saved, "locationId");
            return (
                (!session_id.is_empty()).then_some(session_id),
                (!location_id.is_empty()).then_some(location_id),
            );
        }
        // Backward compatibility for the original one-line session-id file.
        (Some(value), None)
    }
    fn persist_selection(session_id: &str, location_id: &str) {
        let Some(path) = Self::selection_path() else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let saved = serde_json::json!({
            "sessionId": session_id,
            "locationId": location_id,
        });
        let _ = std::fs::write(path, format!("{saved}\n"));
    }
    fn sorted_indices(&self) -> Vec<usize> {
        let mut indices: Vec<_> = (0..self.sessions.len()).collect();
        indices.sort_by(|left, right| {
            let left = &self.sessions[*left];
            let right = &self.sessions[*right];
            let order = match self.sort {
                SessionSort::Updated => left.updated_at_ms.cmp(&right.updated_at_ms),
                SessionSort::Status => left.status.cmp(&right.status),
                SessionSort::Provider => left.provider_label().cmp(&right.provider_label()),
                SessionSort::Project => left.project.cmp(&right.project),
                SessionSort::Purpose => left.purpose.cmp(&right.purpose),
            };
            (if self.descending {
                order.reverse()
            } else {
                order
            })
            .then_with(|| left.id.cmp(&right.id))
        });
        indices
    }
    fn selected(&self) -> Option<&SessionEntry> {
        let id = self.selected_id.as_deref()?;
        self.sessions.iter().find(|session| session.id == id)
    }
    /// The stable Port Daddy actor and authoritative daemon berth selected for
    /// conversational control. Provider process identity is deliberately
    /// irrelevant. Cross-berth routing must move the daemon client before Lane
    /// sends; an actor id is not globally addressable by an arbitrary daemon.
    pub fn selected_active_agent_target(&self) -> Option<(String, String)> {
        let session = self.selected().filter(|session| session.status == "active")?;
        if self.selected_location_id.as_deref() != Some(session.primary_location_id.as_str()) {
            return None;
        }
        let agent_id = session.agent_id.trim();
        if agent_id.is_empty() {
            return None;
        }
        let location = session
            .locations
            .iter()
            .find(|location| location.id == session.primary_location_id)?;
        if location.state == "offline" || location.url.trim().is_empty() {
            return None;
        }
        Some((agent_id.to_string(), location.url.clone()))
    }

    fn choose_default_selection(&mut self) {
        if self
            .selected_id
            .as_deref()
            .is_some_and(|id| self.sessions.iter().any(|session| session.id == id))
        {
            return;
        }
        if self.selected_id.is_some() {
            return;
        }
        self.selected_id = self
            .sessions
            .iter()
            .find(|session| session.status == "active")
            .or_else(|| self.sessions.first())
            .map(|session| session.id.clone());
    }
    fn inspector(&self, session: &SessionEntry) -> Vec<Block> {
        let ownership_changed =
            self.selected_location_id.as_deref() != Some(session.primary_location_id.as_str());
        let workspace = [
            session.worktree_root.as_str(),
            session.branch.as_str(),
            session.worktree_name.as_str(),
            session.worktree_id.as_str(),
        ]
        .iter()
        .filter(|value| !value.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join(" · ");
        let mut blocks = vec![
            Block::Gap,
            Block::Header("Conversation".into()),
            Block::KeyVal("session".into(), session.id.clone()),
            Block::KeyVal(
                "agent".into(),
                if session.agent_id.is_empty() {
                    "No Port Daddy actor bound".into()
                } else {
                    session.agent_id.clone()
                },
            ),
            Block::KeyVal(
                "provider".into(),
                format!(
                    "{} · evidence {}{}",
                    session.provider_label(),
                    if session.provider.confidence.is_empty() {
                        "unknown"
                    } else {
                        session.provider.confidence.as_str()
                    },
                    if session.provider.family.is_empty() {
                        String::new()
                    } else {
                        format!(" · adapter {}", session.provider.family)
                    }
                ),
            ),
            Block::KeyVal(
                "lifecycle".into(),
                format!(
                    "{} · {} · {} · {}",
                    session.status,
                    session.phase,
                    session.liveness,
                    if session.durable {
                        "durable"
                    } else {
                        "ephemeral"
                    }
                ),
            ),
            Block::KeyVal("workspace".into(), workspace),
            Block::KeyVal(
                "evidence".into(),
                format!(
                    "{} claims · {} notes",
                    session.file_count, session.note_count
                ),
            ),
            Block::KeyVal(
                "control".into(),
                if ownership_changed {
                    format!(
                        "saved berth {} is unavailable or no longer authoritative; select this row again to confirm switching to {}",
                        self.selected_location_id.as_deref().unwrap_or("unknown"),
                        session.primary_location_id
                    )
                } else if session.status == "active" && !session.agent_id.is_empty() {
                    "selected agent is bound to the shared chat and Lane controls".into()
                } else {
                    "historical session; transcript is inspectable but no live agent is addressed"
                        .into()
                },
            ),
        ];
        for location in &session.locations {
            blocks.push(Block::KeyVal("berth".into(), location.display()));
        }
        for note in session.notes.iter().rev().take(3) {
            blocks.push(Block::WrappedText {
                text: format!(
                    "{}{}{}\n{}",
                    if note.kind.is_empty() {
                        "note"
                    } else {
                        note.kind.as_str()
                    },
                    if note.created_at_ms > 0 { " · " } else { "" },
                    if note.created_at_ms > 0 {
                        age_short(note.created_at_ms)
                    } else {
                        String::new()
                    },
                    note.content
                ),
                tone: Tone::Resting,
            });
        }
        blocks.push(Block::Gap);
        blocks.push(Block::Header("Transcript + receipts".into()));
        if let Some(error) = &self.transcript_error {
            blocks.push(Block::WrappedText {
                text: error.clone(),
                tone: Tone::Gated,
            });
        } else if self.transcript.is_empty() {
            blocks.push(Block::WrappedText { text: "No projected transcript events yet. The session row is durable, but a provider conversation is not inferred from that row.".into(), tone: Tone::Resting });
        } else {
            for event in self.transcript.iter().rev().take(80).rev() {
                blocks.push(Block::ChatTurn {
                    speaker: format!("{} · {} · #{}", event.speaker, event.kind, event.sequence),
                    text: event.text.clone(),
                    tone: event.tone,
                });
            }
        }
        blocks
    }
}

impl Pane for SessionsPane {
    fn id(&self) -> &str {
        "sessions"
    }
    fn title(&self) -> String {
        "Agents".into()
    }
    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Agents".into())];
        if let Some(error) = &self.last_error {
            blocks.push(Block::WrappedText {
                text: format!("Agent directory unavailable\n{error}"),
                tone: Tone::Conflicted,
            });
            return blocks;
        }
        let active = self
            .sessions
            .iter()
            .filter(|session| session.status == "active")
            .count();
        let online = self
            .locations
            .iter()
            .filter(|location| location.state != "offline")
            .count();
        let offline = self.locations.len().saturating_sub(online);
        let unknown = self
            .sessions
            .iter()
            .filter(|session| session.provider.confidence == "unknown")
            .count();
        blocks.push(Block::Chip {
            label: format!("{} conversations · {} active", self.sessions.len(), active),
            tone: if offline > 0 {
                Tone::Gated
            } else {
                Tone::Engaged
            },
        });
        blocks.push(Block::Chip {
            label: format!("{online} berths online · {offline} offline"),
            tone: if offline > 0 {
                Tone::Gated
            } else {
                Tone::Engaged
            },
        });
        if unknown > 0 {
            blocks.push(Block::WrappedText { text: format!("{unknown} conversation(s) have no witnessed provider/model. Port Daddy will not guess from an agent name or endpoint."), tone: Tone::Gated });
        }
        let offline_locations = self
            .locations
            .iter()
            .filter(|location| location.state == "offline")
            .collect::<Vec<_>>();
        if !offline_locations.is_empty() {
            let preserved = offline_locations
                .iter()
                .filter(|location| location.ledger_preserved)
                .count();
            let sample = offline_locations
                .iter()
                .take(4)
                .map(|location| location.label.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            blocks.push(Block::WrappedText {
                text: format!(
                    "{offline} offline berths · {preserved} ledgers preserved · {sample}{}",
                    if offline_locations.len() > 4 {
                        format!(" +{} more", offline_locations.len() - 4)
                    } else {
                        String::new()
                    }
                ),
                tone: Tone::Gated,
            });
        }
        if self.generated_at_ms > 0 {
            blocks.push(Block::KeyVal(
                "refreshed".into(),
                age_short(self.generated_at_ms),
            ));
        }
        if self.sessions.is_empty() {
            blocks.push(Block::WrappedText { text: "No running berth returned a session. Offline ledgers remain listed above; start or switch to that berth to let its daemon interpret them.".into(), tone: Tone::Resting });
            return blocks;
        }
        blocks.push(Block::LedgerHeader {
            surface: self.id().into(),
            columns: vec![
                ("updated".into(), "Updated".into()),
                ("status".into(), "State".into()),
                ("provider".into(), "Provider / model".into()),
                ("project".into(), "Project".into()),
                ("purpose".into(), "Conversation".into()),
            ],
            active_sort: self.sort.key().into(),
            descending: self.descending,
        });
        for (row_index, session_index) in self.sorted_indices().into_iter().enumerate().take(120) {
            let session = &self.sessions[session_index];
            blocks.push(Block::LedgerRow {
                surface: self.id().into(),
                index: row_index,
                selected: self.selected_id.as_deref() == Some(session.id.as_str()),
                cells: vec![
                    LedgerCell::wide("conversation", session.purpose.clone()),
                    LedgerCell::standard(
                        "state",
                        format!(
                            "{} · {} · {}",
                            session.status, session.phase, session.liveness
                        ),
                    ),
                    LedgerCell::standard("provider / model", session.provider_label()),
                    LedgerCell::standard(
                        "project",
                        if session.project.is_empty() {
                            "unknown".into()
                        } else {
                            session.project.clone()
                        },
                    ),
                    LedgerCell::standard("updated", age_short(session.updated_at_ms)),
                    LedgerCell::standard("berth", session.location_label()),
                ],
                tone: session.tone(),
            });
        }
        if let Some(session) = self.selected() {
            blocks.extend(self.inspector(session));
        } else if let Some(id) = &self.selected_id {
            blocks.push(Block::WrappedText { text: format!("Selected conversation {id} is not visible from any running berth. Its saved selection is preserved; bring the owning berth online and it will reopen here."), tone: Tone::Gated });
        }
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/operator/session-directory", daemon.base());
            let response = match daemon.http_client().get(&url).send().await {
                Err(error) => {
                    self.last_error = Some(format!("daemon unreachable: {error}"));
                    return Ok(());
                }
                Ok(response) => response,
            };
            let status = response.status();
            if !status.is_success() {
                self.last_error =
                    Some(format!("GET /operator/session-directory returned {status}"));
                return Ok(());
            }
            let data = match response.json::<Value>().await {
                Ok(data) => data,
                Err(error) => {
                    self.last_error = Some(format!("invalid session directory: {error}"));
                    return Ok(());
                }
            };
            self.last_error = None;
            self.generated_at_ms = n(&data, "generatedAt");
            self.locations = arr(&data, "locations")
                .iter()
                .map(SessionLocation::from_value)
                .collect();
            self.sessions = arr(&data, "sessions")
                .iter()
                .map(SessionEntry::from_value)
                .collect();
            self.choose_default_selection();
            self.transcript.clear();
            self.transcript_error = None;
            let Some(session) = self.selected().cloned() else {
                return Ok(());
            };
            if self.selected_location_id.is_none() && !session.primary_location_id.is_empty() {
                self.selected_location_id = Some(session.primary_location_id.clone());
                Self::persist_selection(&session.id, &session.primary_location_id);
            }
            if self
                .selected_location_id
                .as_deref()
                .is_some_and(|location_id| location_id != session.primary_location_id)
            {
                self.transcript_error = Some(format!(
                    "Saved berth {} is unavailable or no longer authoritative. Select this row again to confirm opening {}.",
                    self.selected_location_id.as_deref().unwrap_or("unknown"),
                    session.primary_location_id
                ));
                return Ok(());
            }
            let location = session
                .locations
                .iter()
                .find(|location| location.id == session.primary_location_id)
                .or_else(|| {
                    session
                        .locations
                        .iter()
                        .find(|location| location.state != "offline")
                });
            let Some(location) = location else {
                self.transcript_error =
                    Some("Owning berth is offline; the durable selection remains saved.".into());
                return Ok(());
            };
            if location.url.is_empty() {
                self.transcript_error =
                    Some("Owning berth did not publish a transcript URL.".into());
                return Ok(());
            }
            let events_url = format!("{}/sessions/{}/events?limit=200", location.url, session.id);
            match daemon.http_client().get(&events_url).send().await {
                Err(error) => {
                    self.transcript_error = Some(format!("Transcript unavailable: {error}"))
                }
                Ok(response) => {
                    let status = response.status();
                    if !status.is_success() {
                        self.transcript_error =
                            Some(format!("Transcript endpoint returned {status}"));
                    } else if let Ok(data) = response.json::<Value>().await {
                        let mut events: Vec<_> = arr(&data, "data")
                            .iter()
                            .map(TranscriptEntry::from_value)
                            .collect();
                        events.sort_by_key(|event| event.sequence);
                        self.transcript = events;
                    }
                }
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
                    if let Some(session_index) = self.sorted_indices().get(index).copied() {
                        let id = self.sessions[session_index].id.clone();
                        let location_id = self.sessions[session_index].primary_location_id.clone();
                        self.selected_id = Some(id.clone());
                        self.selected_location_id = Some(location_id.clone());
                        self.transcript.clear();
                        self.transcript_error = None;
                        Self::persist_selection(&id, &location_id);
                    }
                }
                SurfaceAction::Sort { key } => {
                    if let Some(sort) = SessionSort::parse(&key) {
                        if self.sort == sort {
                            self.descending = !self.descending;
                        } else {
                            self.sort = sort;
                            self.descending = matches!(sort, SessionSort::Updated);
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
    fn session_value() -> Value {
        json!({ "id":"session-1","purpose":"Build cross-backend switcher","status":"active","phase":"in_progress","agentId":"actor-1","identityProject":"port-daddy","durable":true,"fileCount":2,"noteCount":1,"updatedAt":200,
        "worktree":{"id":"wt-1","root":"/repo","name":"repo","branch":"codex/switcher"},
        "provider":{"adapterFamily":"codex-cli","label":"Codex CLI","backend":"cli:codex","model":"provider-model-v1","confidence":"witnessed"},"liveness":"alive","primaryLocationId":"stable",
        "locations":[{"id":"stable","label":"stable","tier":"stable","state":"online","current":true,"canonical":true,"ledgerPreserved":true,"url":"http://127.0.0.1:43210"}],
        "notes":[{"type":"scope","content":"owns sessions pane","createdAt":150}] })
    }
    #[test]
    fn parses_full_identity_provider_workspace_and_location() {
        let entry = SessionEntry::from_value(&session_value());
        assert_eq!(entry.agent_id, "actor-1");
        assert_eq!(entry.provider.family, "codex-cli");
        assert_eq!(entry.provider.model, "provider-model-v1");
        assert_eq!(entry.worktree_root, "/repo");
        assert_eq!(entry.locations[0].label, "stable");
        assert!(entry.durable);
    }
    #[test]
    fn view_is_a_selectable_ledger_with_untruncated_inspector() {
        let mut pane = SessionsPane {
            selected_id: Some("session-1".into()),
            selected_location_id: Some("stable".into()),
            ..SessionsPane::default()
        };
        pane.sessions = vec![SessionEntry::from_value(&session_value())];
        pane.locations = pane.sessions[0].locations.clone();
        let blocks = pane.view();
        assert!(matches!(&blocks[0],Block::Header(value) if value=="Agents"));
        assert!(blocks.iter().any(|block| matches!(block,Block::LedgerRow{surface,selected:true,..} if surface=="sessions")));
        assert!(blocks.iter().any(
            |block| matches!(block,Block::KeyVal(key,value) if key=="session"&&value=="session-1")
        ));
        assert_eq!(
            pane.selected_active_agent_target(),
            Some(("actor-1".into(), "http://127.0.0.1:43210".into()))
        );
    }
    #[test]
    fn transcript_event_preserves_real_text_and_receipt_tone() {
        let row = TranscriptEntry::from_value(
            &json!({"sequence":42,"kind":"receipt_verified","payloadJson":{"summary":"artifact hashes verified"},"redactionState":"clear"}),
        );
        assert_eq!(row.sequence, 42);
        assert_eq!(row.text, "artifact hashes verified");
        assert_eq!(row.tone, Tone::Landed);
    }

    #[test]
    fn requires_confirmation_before_rebinding_a_saved_session_to_another_berth() {
        let mut pane = SessionsPane {
            selected_id: Some("session-1".into()),
            selected_location_id: Some("profile:old-owner".into()),
            ..SessionsPane::default()
        };
        pane.sessions = vec![SessionEntry::from_value(&session_value())];
        assert_eq!(pane.selected_active_agent_target(), None);
        assert!(pane.view().iter().any(|block| matches!(
            block,
            Block::KeyVal(key, value)
                if key == "control" && value.contains("select this row again")
        )));
    }

    #[test]
    fn requires_confirmation_before_upgrading_a_legacy_session_only_selection() {
        let mut pane = SessionsPane {
            selected_id: Some("session-1".into()),
            selected_location_id: None,
            ..SessionsPane::default()
        };
        pane.sessions = vec![SessionEntry::from_value(&session_value())];
        assert_eq!(pane.selected_active_agent_target(), None);
        assert!(pane.view().iter().any(|block| matches!(
            block,
            Block::KeyVal(key, value)
                if key == "control" && value.contains("select this row again")
        )));
    }
}
