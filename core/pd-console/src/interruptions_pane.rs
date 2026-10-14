//! Interruptions pane — the network half of the HITL contract (surface 2).
//!
//! Wraps the pure poll machine in `interruptions.rs` with the real transport:
//! `GET {relay}/v1/interruptions?state=open` with a `pdu_` bearer token, driven
//! by the console's 2 s producer cadence but actually hitting the network only
//! when the machine's jittered schedule says a poll is due (≤30 s, full
//! jitter). Config is shared with the Cloud Fleet pane:
//!
//!   - normal operator source: `~/.port-daddy/account.json`
//!   - explicit test/development overrides: `PD_CONSOLE_RELAY_URL` and
//!     `PD_CONSOLE_RELAY_TOKEN`
//!
//! Fail-honest: unconfigured or failed polls render "unknown" (never "all
//! clear"); a 4xx parks polling until the token changes; three consecutive
//! transient failures open the circuit breaker.

use crate::agent::DaemonClient;
use crate::interruptions::{
    deep_link_for, parse_open_interruptions, view_blocks, HitlGate, HitlHealth, HitlSnapshot,
    PollFailure, PollMachine,
};
use crate::pane::{Block, Pane};
use anyhow::Result;
use serde_json::Value;
use std::fmt;
use std::path::{Path, PathBuf};

pub(crate) const DEFAULT_RELAY_URL: &str = "https://relay.portdaddy.dev";

/// The signed-in operator relay identity shared by Interruptions and Cloud
/// Fleet. The bearer remains private to the process and is never rendered.
#[derive(Default, PartialEq)]
pub(crate) struct RelayCredentials {
    pub(crate) url: String,
    pub(crate) token: String,
    pub(crate) login: String,
}

/// Bearer credentials must remain safe even when a containing state value is
/// printed during a failed assertion or diagnostic. Never derive `Debug` for
/// this type: the token is deliberately replaced with a presence marker.
impl fmt::Debug for RelayCredentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RelayCredentials")
            .field("url", &self.url)
            .field(
                "token",
                &if self.token.is_empty() {
                    "<absent>"
                } else {
                    "<redacted>"
                },
            )
            .field("login", &self.login)
            .finish()
    }
}

fn is_valid_operator_token(token: &str) -> bool {
    token.len() == 68
        && token.starts_with("pdu_")
        && token[4..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn normalize_relay_url(raw: &str, allow_loopback_http: bool) -> Option<String> {
    let normalized = raw.trim().trim_end_matches('/');
    let parsed = reqwest::Url::parse(normalized).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return None;
    }

    let transport_is_safe = match parsed.scheme() {
        "https" => true,
        "http" if allow_loopback_http => {
            matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1" | "[::1]")
        }
        _ => false,
    };
    transport_is_safe.then_some(normalized.to_string())
}

fn account_credentials(account_json: Option<&str>) -> Option<RelayCredentials> {
    let account = serde_json::from_str::<Value>(account_json?).ok()?;
    let token = account.get("token")?.as_str()?.to_string();
    if !is_valid_operator_token(&token) {
        return None;
    }
    let raw_url = account
        .get("relayUrl")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(DEFAULT_RELAY_URL);
    // Match FleetBar's shared account contract exactly: remote credentials
    // require HTTPS; plaintext is permitted only for a relay bound to this Mac
    // so explicit local development remains possible.
    let url = normalize_relay_url(raw_url, true)?;
    let login = account
        .get("login")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    Some(RelayCredentials { url, token, login })
}

fn development_override(
    env_url: Option<String>,
    env_token: Option<String>,
) -> Option<RelayCredentials> {
    // An override is one explicit credential pair. Never combine an override
    // URL with the operator's stored bearer (or the reverse): a partial or
    // malformed override fails closed instead of silently changing where an
    // account secret is sent.
    let token = env_token?;
    if !is_valid_operator_token(&token) {
        return None;
    }
    let url = normalize_relay_url(&env_url?, true)?;
    Some(RelayCredentials {
        url,
        token,
        login: String::new(),
    })
}

pub(crate) fn resolve_relay_credentials(
    env_url: Option<String>,
    env_token: Option<String>,
    account_json: Option<&str>,
) -> RelayCredentials {
    let override_requested = env_url.is_some() || env_token.is_some();
    if override_requested {
        return development_override(env_url, env_token).unwrap_or_default();
    }
    account_credentials(account_json).unwrap_or_default()
}

pub(crate) fn load_relay_credentials_from(
    account_path: Option<&Path>,
    env_url: Option<String>,
    env_token: Option<String>,
) -> RelayCredentials {
    let account_json = account_path.and_then(|path| std::fs::read_to_string(path).ok());
    resolve_relay_credentials(env_url, env_token, account_json.as_deref())
}

pub(crate) fn load_relay_credentials() -> RelayCredentials {
    let account_path: Option<PathBuf> =
        dirs::home_dir().map(|home| home.join(".port-daddy").join("account.json"));
    load_relay_credentials_from(
        account_path.as_deref(),
        std::env::var("PD_CONSOLE_RELAY_URL").ok(),
        std::env::var("PD_CONSOLE_RELAY_TOKEN").ok(),
    )
}

/// Per-poll request timeout (the agent contract's "each poll carries a ≤10 s
/// request timeout" applies to UI surfaces too — a hung poll must not wedge
/// the producer loop).
pub const POLL_TIMEOUT_SECS: u64 = 10;

/// The pane. Holds the relay config, the pure poll machine, the last snapshot,
/// and a tiny xorshift RNG for jitter samples (no new dependencies).
pub struct InterruptionsPane {
    relay_url: String,
    relay_token: String,
    machine: PollMachine,
    snapshot: HitlSnapshot,
    rng_state: u64,
}

impl Default for InterruptionsPane {
    fn default() -> Self {
        Self::with_credentials(load_relay_credentials())
    }
}

impl InterruptionsPane {
    /// Build from the signed-in account, with explicit development overrides.
    pub fn new() -> Self {
        Self::default()
    }

    fn with_credentials(credentials: RelayCredentials) -> Self {
        Self::with_relay(credentials.url, credentials.token)
    }

    /// Build against an explicit relay (tests point this at a mock server).
    pub fn with_relay(relay_url: impl Into<String>, relay_token: impl Into<String>) -> Self {
        // Seed the jitter RNG from the clock; a zero seed would make xorshift
        // emit only zeros, so nudge it.
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9e3779b97f4a7c15)
            | 1;
        Self {
            relay_url: relay_url.into(),
            relay_token: relay_token.into(),
            machine: PollMachine::new(),
            snapshot: HitlSnapshot::default(),
            rng_state: seed,
        }
    }

    fn is_configured(&self) -> bool {
        !self.relay_url.trim().is_empty() && !self.relay_token.trim().is_empty()
    }

    /// Apply a newly-read account without restarting the console. A changed
    /// token releases an auth park immediately; a changed relay starts a fresh
    /// scheduler because the prior endpoint's failure history is irrelevant.
    pub(crate) fn apply_credentials(&mut self, credentials: RelayCredentials) -> bool {
        if self.relay_url == credentials.url && self.relay_token == credentials.token {
            return false;
        }
        let url_changed = self.relay_url != credentials.url;
        self.relay_url = credentials.url;
        self.relay_token = credentials.token;
        if url_changed {
            self.machine = PollMachine::new();
        }
        self.machine.note_token(&self.relay_token);
        if !self.is_configured() {
            self.snapshot = HitlSnapshot::default();
        }
        true
    }

    /// One xorshift64* step mapped into `[0, 1)` — the injected jitter sample.
    fn next_sample(&mut self) -> f64 {
        let mut x = self.rng_state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.rng_state = x;
        // Top 53 bits → uniform double in [0, 1).
        (x >> 11) as f64 / (1u64 << 53) as f64
    }

    fn now_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    /// The gate the GPUI shell reads each producer tick: open count, the
    /// blocking critical title (if any), known/unknown, and the deep link.
    pub fn gate(&self) -> HitlGate {
        self.snapshot.gate(deep_link_for(&self.relay_url))
    }

    /// Read-only snapshot (contract tests; unused by the GPUI bin itself).
    #[allow(dead_code)]
    pub fn snapshot(&self) -> &HitlSnapshot {
        &self.snapshot
    }

    /// Read-only machine state (contract tests).
    #[allow(dead_code)]
    pub fn machine(&self) -> &PollMachine {
        &self.machine
    }

    /// Run one poll attempt NOW (no due-check) against the configured relay.
    /// Split from `refresh` so tests can drive the network path directly.
    pub async fn poll_now(&mut self, daemon: &DaemonClient) {
        let url = format!(
            "{}/v1/interruptions?state=open",
            self.relay_url.trim_end_matches('/')
        );
        let mut req = daemon
            .http_client()
            .get(&url)
            .timeout(std::time::Duration::from_secs(POLL_TIMEOUT_SECS));
        if !self.relay_token.trim().is_empty() {
            req = req.bearer_auth(self.relay_token.trim());
        }
        let now = Self::now_ms();
        let sample = self.next_sample();
        let outcome: std::result::Result<serde_json::Value, PollFailure> = match req.send().await {
            Err(e) => Err(PollFailure::Transient {
                reason: format!("relay unreachable: {e}"),
            }),
            Ok(resp) => {
                let status = resp.status().as_u16();
                if (200..300).contains(&status) {
                    resp.json::<serde_json::Value>()
                        .await
                        .map_err(|e| PollFailure::Transient {
                            reason: format!("bad response body: {e}"),
                        })
                } else {
                    Err(PollFailure::from_status(status))
                }
            }
        };
        match outcome {
            Ok(body) => {
                self.machine.on_success(now, sample);
                self.snapshot = HitlSnapshot {
                    health: HitlHealth::Live,
                    open: parse_open_interruptions(&body),
                };
            }
            Err(failure) => {
                self.machine.on_failure(now, &failure, sample);
                // Keep the last-known list (a stale critical still blocks);
                // only the health flips to unknown, with the REAL reason.
                self.snapshot.health = HitlHealth::Unknown {
                    reason: failure.reason(),
                };
            }
        }
    }
}

impl Pane for InterruptionsPane {
    fn id(&self) -> &str {
        "interruptions"
    }

    fn title(&self) -> String {
        "Interruptions".into()
    }

    fn view(&self) -> Vec<Block> {
        view_blocks(
            &self.snapshot,
            deep_link_for(&self.relay_url).as_deref(),
            Self::now_ms(),
        )
    }

    /// Called every producer tick (2 s). Actually polls only when the jittered
    /// schedule says so — parked/breaker-open phases poll nothing at all.
    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            // Account sign-in and token rotation are external to this process.
            // Re-read the tiny owner-only file every producer tick so both
            // panes converge without a relaunch. Explicit env overrides remain
            // stable because resolution applies them after each read.
            self.apply_credentials(load_relay_credentials());
            if !self.is_configured() {
                self.snapshot = HitlSnapshot::default(); // Unconfigured + empty
                return Ok(());
            }
            self.machine.note_token(&self.relay_token);
            if !self.machine.due(Self::now_ms()) {
                return Ok(());
            }
            self.poll_now(daemon).await;
            Ok(())
        })
    }
}
