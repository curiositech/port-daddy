//! Interruptions pane — the network half of the HITL contract (surface 2).
//!
//! Wraps the pure poll machine in `interruptions.rs` with the real transport:
//! `GET {relay}/v1/interruptions?state=open` with a `pdu_` bearer token, driven
//! by the console's 2 s producer cadence but actually hitting the network only
//! when the machine's jittered schedule says a poll is due (≤30 s, full
//! jitter). Config mirrors the Cloud Fleet pane:
//!
//!   - `PD_CONSOLE_RELAY_URL`   — e.g. `https://relay.port-daddy.dev`
//!   - `PD_CONSOLE_RELAY_TOKEN` — a `pdu_` device-flow bearer token
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
        Self::with_relay(
            std::env::var("PD_CONSOLE_RELAY_URL").unwrap_or_default(),
            std::env::var("PD_CONSOLE_RELAY_TOKEN").unwrap_or_default(),
        )
    }
}

impl InterruptionsPane {
    /// Build from `PD_CONSOLE_RELAY_URL` / `PD_CONSOLE_RELAY_TOKEN`.
    pub fn new() -> Self {
        Self::default()
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
        !self.relay_url.trim().is_empty()
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
