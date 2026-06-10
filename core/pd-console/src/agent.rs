//! The conversation multiplexer — ON THE PD BUS, backend-agnostic (ADR-0046).
//!
//! "Why can't we create new top-level agents? I want to talk to you from inside
//! pd-console." This is the answer — and it does it the *Port Daddy* way, not by
//! shelling out to one vendor:
//!
//!   create_agent(backend, prompt)  → daemon `POST /spawn` on ANY backend
//!     (ollama | claude | claude-cli | gemini | cloudflare | codex | aider | custom),
//!     bound to a per-agent **tube** channel.
//!   send(text)   → `POST /msg/<channel>`   (a turn up the tube)
//!   poll()       → `GET  /msg/<channel>?after=<cursor>`  (replies down the tube)
//!
//! On-bus means: the agent is a real voyage (observable in the Ledger/manifest),
//! steerable, and any backend works — the console never re-implements a vendor.

use anyhow::{anyhow, Context, Result};
use std::collections::BTreeMap;

/// Every backend the daemon's spawner accepts (mirrors routes/spawn.ts VALID_BACKENDS).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Ollama,
    Claude,
    ClaudeCli,
    Gemini,
    Cloudflare,
    Codex,
    Aider,
    Custom,
}

impl Backend {
    pub const ALL: [Backend; 8] = [
        Backend::Ollama,
        Backend::Claude,
        Backend::ClaudeCli,
        Backend::Gemini,
        Backend::Cloudflare,
        Backend::Codex,
        Backend::Aider,
        Backend::Custom,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Backend::Ollama => "ollama",
            Backend::Claude => "claude",
            Backend::ClaudeCli => "claude-cli",
            Backend::Gemini => "gemini",
            Backend::Cloudflare => "cloudflare",
            Backend::Codex => "codex",
            Backend::Aider => "aider",
            Backend::Custom => "custom",
        }
    }

    pub fn parse(s: &str) -> Option<Backend> {
        Backend::ALL.into_iter().find(|b| b.as_str() == s)
    }
}

/// One message off the tube.
#[derive(Debug, Clone)]
pub struct TubeMsg {
    pub id: u64,
    pub sender: String,
    pub text: String,
}

/// Thin client for the live daemon — discovers it the canonical way (PR #261):
/// `PORT_DADDY_URL`, else the TCP port from `~/.port-daddy/daemon.port`, else 9876.
pub struct DaemonClient {
    base: String,
    http: reqwest::Client,
}

impl DaemonClient {
    pub fn new(base: String) -> Self {
        Self { base: base.trim_end_matches('/').to_string(), http: reqwest::Client::new() }
    }

    pub fn discover() -> Result<Self> {
        let base = if let Ok(url) = std::env::var("PORT_DADDY_URL") {
            url.trim_end_matches('/').to_string()
        } else {
            let port = dirs::home_dir()
                .map(|h| h.join(".port-daddy/daemon.port"))
                .and_then(|p| std::fs::read_to_string(p).ok())
                .and_then(|s| s.trim().parse::<u16>().ok())
                .unwrap_or(9876);
            format!("http://127.0.0.1:{port}")
        };
        Ok(Self { base, http: reqwest::Client::new() })
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    /// Expose the underlying reqwest client so panes can issue arbitrary requests
    /// to the daemon without re-implementing discovery.
    pub fn http_client(&self) -> &reqwest::Client {
        &self.http
    }

    /// Create a top-level agent on `backend`, bound to `channel` for the conversation.
    /// Returns the agent id. (The spawned agent listens+replies on the tube channel —
    /// the steering-channel pattern; one-shot backends reply once.)
    pub async fn spawn(&self, backend: Backend, prompt: &str, channel: &str) -> Result<String> {
        let body = serde_json::json!({
            "backend": backend.as_str(),
            "task": prompt,
            "identity": format!("console:agent:{channel}"),
            "purpose": "Top-level console agent (tube conversation)",
            "tubeChannel": channel,
        });
        let resp = self
            .http
            .post(format!("{}/spawn", self.base))
            .json(&body)
            .send()
            .await
            .context("POST /spawn")?;
        let v: serde_json::Value = resp.json().await.context("spawn response")?;
        v.get("agentId")
            .and_then(|a| a.as_str())
            .map(String::from)
            .ok_or_else(|| anyhow!("spawn failed: {}", v))
    }

    /// Post a turn up the tube.
    pub async fn tube_send(&self, channel: &str, text: &str, sender: &str) -> Result<()> {
        let body = serde_json::json!({ "payload": { "text": text }, "sender": sender });
        self.http
            .post(format!("{}/msg/{channel}", self.base))
            .json(&body)
            .send()
            .await
            .context("POST /msg/<channel>")?;
        Ok(())
    }

    /// Pull replies after `cursor`. Returns (new_cursor, messages).
    pub async fn tube_poll(&self, channel: &str, cursor: u64) -> Result<(u64, Vec<TubeMsg>)> {
        let v: serde_json::Value = self
            .http
            .get(format!("{}/msg/{channel}", self.base))
            .query(&[("after", cursor.to_string())])
            .send()
            .await
            .context("GET /msg/<channel>")?
            .json()
            .await?;
        let mut out = Vec::new();
        let mut max = cursor;
        if let Some(arr) = v.get("messages").and_then(|m| m.as_array()) {
            for m in arr {
                let id = m.get("id").and_then(|i| i.as_u64()).unwrap_or(0);
                max = max.max(id);
                out.push(TubeMsg {
                    id,
                    sender: m.get("sender").and_then(|s| s.as_str()).unwrap_or("?").to_string(),
                    text: extract_text(m.get("payload")),
                });
            }
        }
        Ok((max, out))
    }
}

/// A payload may be a string, `{text:...}`, or `{content:...}` — pull readable text.
fn extract_text(payload: Option<&serde_json::Value>) -> String {
    match payload {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Object(o)) => o
            .get("text")
            .or_else(|| o.get("content"))
            .and_then(|t| t.as_str())
            .map(String::from)
            .unwrap_or_else(|| serde_json::Value::Object(o.clone()).to_string()),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

/// One hosted top-level agent.
pub struct TopLevelAgent {
    pub id: String,
    pub backend: Backend,
    pub channel: String,
    pub cursor: u64,
}

/// The console's conversation registry — create / switch / converse, all on-bus.
pub struct AgentManager {
    client: DaemonClient,
    pub agents: BTreeMap<u64, TopLevelAgent>,
    pub active: Option<u64>,
    next: u64,
}

impl AgentManager {
    pub fn new() -> Result<Self> {
        Ok(Self { client: DaemonClient::discover()?, agents: BTreeMap::new(), active: None, next: 1 })
    }

    pub fn daemon(&self) -> &DaemonClient {
        &self.client
    }

    /// Create a NEW top-level agent on `backend`. The thing iterm2 was for.
    pub async fn create_agent(&mut self, backend: Backend, prompt: &str) -> Result<u64> {
        let local = self.next;
        self.next += 1;
        let channel = format!("console-agent-{local}");
        let id = self.client.spawn(backend, prompt, &channel).await?;
        self.agents.insert(local, TopLevelAgent { id, backend, channel, cursor: 0 });
        self.active = Some(local);
        Ok(local)
    }

    pub async fn send(&mut self, text: &str) -> Result<()> {
        let a = self.active.and_then(|i| self.agents.get(&i)).ok_or_else(|| anyhow!("no active agent"))?;
        self.client.tube_send(&a.channel, text, "operator").await
    }

    pub async fn poll_active(&mut self) -> Result<Vec<TubeMsg>> {
        let local = self.active.ok_or_else(|| anyhow!("no active agent"))?;
        let (channel, cursor) = {
            let a = self.agents.get(&local).unwrap();
            (a.channel.clone(), a.cursor)
        };
        let (new_cursor, msgs) = self.client.tube_poll(&channel, cursor).await?;
        if let Some(a) = self.agents.get_mut(&local) {
            a.cursor = new_cursor;
        }
        // Don't echo the operator's own turns back as replies.
        Ok(msgs.into_iter().filter(|m| m.sender != "operator").collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_backends_round_trip() {
        for b in Backend::ALL {
            assert_eq!(Backend::parse(b.as_str()), Some(b));
        }
        assert!(Backend::parse("nope").is_none());
    }

    #[test]
    fn extract_text_handles_shapes() {
        assert_eq!(extract_text(Some(&serde_json::json!("hi"))), "hi");
        assert_eq!(extract_text(Some(&serde_json::json!({ "text": "yo" }))), "yo");
        assert_eq!(extract_text(Some(&serde_json::json!({ "content": "c" }))), "c");
        assert_eq!(extract_text(None), "");
    }
}
