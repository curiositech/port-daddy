//! HITL operator interruptions — the poll state machine + view model.
//!
//! Implements the mandatory UI contract of `docs/hitl-interruptions.md` §4 for
//! pd-console: poll `GET /v1/interruptions?state=open` on the relay with full
//! jitter (≤30 s between polls), surface every open ask (title, urgency, source
//! agent, age — loud red for `critical`/`high`), block fleet-dispatch actions
//! while a `critical` ask is open, deep-link answer/ack to the session-gated
//! `/account/interruptions` web surface (a bearer token must never silence its
//! own escalations), render an HONEST empty state, and render "unknown" — never
//! "all clear" — when a poll fails.
//!
//! Everything in this module is deliberately gpui-free and pure: time and
//! randomness are INJECTED (`now_ms`, a `[0,1)` jitter sample), so the whole
//! contract is unit-testable without a window, a clock, or a network. The
//! network half lives in `interruptions_pane.rs`; the three render states are
//! provable as PNGs through `headless_capture::render_blocks`.

use crate::pane::{Block, Tone};

/// Maximum interval between polls (contract §4.1: "poll interval ≤ 30 s with
/// full jitter"). The jittered delay is `sample × POLL_MAX_MS`, so the mean
/// interval is 15 s and an open ask is visible well inside the 60 s bound.
pub const POLL_MAX_MS: i64 = 30_000;

/// Consecutive transient failures that open the circuit breaker (mirrors the
/// relay's own webhook breaker: "3 consecutive delivery failures open the
/// breaker").
pub const BREAKER_THRESHOLD: u32 = 3;

/// Base cooldown for an open breaker; doubled per successive open, capped by
/// [`BREAKER_CAP_MS`], and full-jittered.
pub const BREAKER_BASE_MS: i64 = 30_000;

/// Hard cap on the breaker cooldown (5 minutes).
pub const BREAKER_CAP_MS: i64 = 300_000;

/// Full-jitter delay: `sample × min(cap, base × 2^attempt)`.
///
/// This is AWS-style full jitter — the whole range `[0, ceiling]` is candidate
/// delay, never a fixed offset, so many consoles polling one relay can't
/// thundering-herd a cron tick (the same rule the relay's nag engine follows).
/// `sample` is clamped to `[0, 1]`; `attempt` saturates rather than
/// overflowing. Exercised by the `jitter_*` unit tests in
/// `tests/interruptions_unit.rs` (this crate is bin-only, so the unit tests
/// there are the runnable mirror of this contract).
pub fn full_jitter_ms(base_ms: i64, cap_ms: i64, attempt: u32, sample: f64) -> i64 {
    let ceiling = base_ms
        .saturating_mul(1i64.checked_shl(attempt.min(32)).unwrap_or(i64::MAX))
        .min(cap_ms)
        .max(0);
    let s = if sample.is_finite() {
        sample.clamp(0.0, 1.0)
    } else {
        1.0
    };
    (ceiling as f64 * s) as i64
}

// ─────────────────────────────────────────────────────────────────────────────
// Data model
// ─────────────────────────────────────────────────────────────────────────────

/// Ask urgency, ordered least → most urgent. Unknown strings decode as
/// [`Urgency::Normal`] (tolerant, like every pd-console daemon decode).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Urgency {
    Low,
    Normal,
    High,
    Critical,
}

impl Urgency {
    /// Tolerant parse of the relay's `urgency` field: `"low"`, `"high"`,
    /// `"critical"` map to themselves; anything else decodes as `Normal`.
    pub fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "low" => Urgency::Low,
            "high" => Urgency::High,
            "critical" => Urgency::Critical,
            _ => Urgency::Normal,
        }
    }

    /// Display label (the relay's canonical lowercase word).
    pub fn label(self) -> &'static str {
        match self {
            Urgency::Low => "low",
            Urgency::Normal => "normal",
            Urgency::High => "high",
            Urgency::Critical => "critical",
        }
    }

    /// Semantic tone — contract §4.2: `critical`/`high` MUST be visually loud
    /// (red). `Alarm` is the console's deep distress red; `Gated` its muted
    /// warning; `Resting` the quiet state.
    pub fn tone(self) -> Tone {
        match self {
            Urgency::Critical | Urgency::High => Tone::Alarm,
            Urgency::Normal => Tone::Gated,
            Urgency::Low => Tone::Resting,
        }
    }

    /// Single-letter flag for the maritime `Block::Flag` square.
    pub fn letter(self) -> char {
        match self {
            Urgency::Low => 'L',
            Urgency::Normal => 'N',
            Urgency::High => 'H',
            Urgency::Critical => 'C',
        }
    }
}

/// One open operator ask, as decoded from the relay's `publicShape`.
#[derive(Debug, Clone, PartialEq)]
pub struct Interruption {
    pub id: String,
    pub title: String,
    pub urgency: Urgency,
    /// The agent that filed the ask (`sourceAgent`); empty when absent.
    pub source_agent: String,
    /// Creation time in epoch **milliseconds** (the relay stores unix seconds;
    /// tolerant decode normalizes either unit). `None` when absent/unparsable.
    pub created_at_ms: Option<i64>,
}

impl Interruption {
    /// Tolerant decode of one relay row. Only `id` and `title` are required —
    /// a strict serde struct would turn one new nullable column into a
    /// whole-poll failure (the dispatch pane learned this the hard way).
    pub fn from_value(v: &serde_json::Value) -> Option<Self> {
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
        let id = s("id")?;
        let title = s("title")?;
        let created_at_ms = v
            .get("createdAt")
            .or_else(|| v.get("created_at"))
            .and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f as i64)))
            .map(|t| if t < 100_000_000_000 { t * 1000 } else { t });
        Some(Self {
            id,
            title,
            urgency: Urgency::parse(&s("urgency").unwrap_or_default()),
            source_agent: s("sourceAgent")
                .or_else(|| s("source_agent"))
                .unwrap_or_default(),
            created_at_ms,
        })
    }

    /// Display-ready age ("3m", "2h", "1d") relative to `now_ms`; `"?"` when
    /// the creation time is unknown or in the future.
    pub fn age_label(&self, now_ms: i64) -> String {
        let Some(created) = self.created_at_ms else {
            return "?".into();
        };
        let delta_s = (now_ms - created) / 1000;
        if delta_s < 0 {
            return "?".into();
        }
        if delta_s < 60 {
            format!("{delta_s}s")
        } else if delta_s < 3600 {
            format!("{}m", delta_s / 60)
        } else if delta_s < 86_400 {
            format!("{}h", delta_s / 3600)
        } else {
            format!("{}d", delta_s / 86_400)
        }
    }
}

/// Decode the poll body `{ code, error, openCount, interruptions: […] }` into
/// open asks, most-urgent first (the relay already orders `state=open` results
/// by urgency; we re-sort defensively so a proxy can't reorder the banner).
pub fn parse_open_interruptions(v: &serde_json::Value) -> Vec<Interruption> {
    let mut list: Vec<Interruption> = v
        .get("interruptions")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|row| {
                    // Tolerate a relay that returns non-open rows on ?state=open.
                    row.get("state")
                        .and_then(|s| s.as_str())
                        .map(|s| s == "open")
                        .unwrap_or(true)
                })
                .filter_map(Interruption::from_value)
                .collect()
        })
        .unwrap_or_default();
    list.sort_by(|a, b| {
        b.urgency.cmp(&a.urgency).then(
            a.created_at_ms
                .unwrap_or(i64::MAX)
                .cmp(&b.created_at_ms.unwrap_or(i64::MAX)),
        )
    });
    list
}

// ─────────────────────────────────────────────────────────────────────────────
// Poll state machine — pure; time + randomness injected
// ─────────────────────────────────────────────────────────────────────────────

/// Why one poll attempt failed, pre-classified by the transport layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PollFailure {
    /// The relay REJECTED the request (any 4xx except 429): a bad/expired
    /// token or a route that predates the contract. Retrying with the same
    /// credentials is spam — the machine parks until the token changes.
    Rejected { status: u16 },
    /// A transient failure: transport error, 5xx, 429, or an undecodable
    /// body. Retried with backoff; three in a row open the breaker.
    Transient { reason: String },
}

impl PollFailure {
    /// Classify an HTTP status: non-429 4xx parks (`Rejected`), everything
    /// else — 5xx and 429 — is `Transient`.
    pub fn from_status(status: u16) -> Self {
        if (400..500).contains(&status) && status != 429 {
            PollFailure::Rejected { status }
        } else {
            PollFailure::Transient {
                reason: format!("HTTP {status}"),
            }
        }
    }

    /// Human-readable reason for the "unknown" state.
    pub fn reason(&self) -> String {
        match self {
            PollFailure::Rejected { status } => {
                format!("relay rejected the poll (HTTP {status}) — check the pdu_ token")
            }
            PollFailure::Transient { reason } => reason.clone(),
        }
    }
}

/// Where the machine is in its polling life.
#[derive(Debug, Clone, PartialEq)]
pub enum PollPhase {
    /// Polling normally on the jittered ≤30 s cadence.
    Ready,
    /// Parked on a 4xx — NO further polls until the bearer token changes.
    Parked { status: u16 },
    /// Circuit breaker open after [`BREAKER_THRESHOLD`] consecutive transient
    /// failures; no polls until `until_ms`, then ONE half-open probe.
    Open { until_ms: i64 },
}

/// The pure poll scheduler. It never touches a clock, an RNG, or a socket —
/// callers inject `now_ms` and a `[0,1)` jitter `sample`, which is what makes
/// the jitter-bounds / park / breaker contract unit-testable.
///
/// Lifecycle: `due()` gates each attempt; the caller reports the outcome via
/// [`PollMachine::on_success`] / [`PollMachine::on_failure`]; `note_token()`
/// un-parks when the operator rotates credentials.
#[derive(Debug, Clone, PartialEq)]
pub struct PollMachine {
    next_poll_at_ms: i64,
    consecutive_failures: u32,
    /// How many times the breaker has opened without an intervening success —
    /// scales the cooldown exponent.
    opens: u32,
    phase: PollPhase,
    token_fingerprint: u64,
}

impl Default for PollMachine {
    fn default() -> Self {
        Self::new()
    }
}

impl PollMachine {
    /// A fresh machine polls immediately (`next_poll_at_ms = 0`).
    pub fn new() -> Self {
        Self {
            next_poll_at_ms: 0,
            consecutive_failures: 0,
            opens: 0,
            phase: PollPhase::Ready,
            token_fingerprint: 0,
        }
    }

    /// Is a poll attempt allowed at `now_ms`? `false` while parked, while the
    /// breaker cooldown runs, or before the next jittered slot.
    pub fn due(&self, now_ms: i64) -> bool {
        match &self.phase {
            PollPhase::Parked { .. } => false,
            PollPhase::Open { until_ms } => now_ms >= *until_ms,
            PollPhase::Ready => now_ms >= self.next_poll_at_ms,
        }
    }

    /// Record a successful poll: failures reset, the breaker closes, and the
    /// next poll lands at `now + sample ×` [`POLL_MAX_MS`] (full jitter).
    pub fn on_success(&mut self, now_ms: i64, sample: f64) {
        self.consecutive_failures = 0;
        self.opens = 0;
        self.phase = PollPhase::Ready;
        self.next_poll_at_ms = now_ms + full_jitter_ms(POLL_MAX_MS, POLL_MAX_MS, 0, sample);
    }

    /// Record a failed poll. `Rejected` parks the machine (no retries until
    /// the token changes); the third consecutive `Transient` opens the breaker
    /// for a full-jittered, exponentially-growing cooldown.
    pub fn on_failure(&mut self, now_ms: i64, failure: &PollFailure, sample: f64) {
        match failure {
            PollFailure::Rejected { status } => {
                self.phase = PollPhase::Parked { status: *status };
            }
            PollFailure::Transient { .. } => {
                self.consecutive_failures = self.consecutive_failures.saturating_add(1);
                if self.consecutive_failures >= BREAKER_THRESHOLD {
                    let cooldown =
                        full_jitter_ms(BREAKER_BASE_MS, BREAKER_CAP_MS, self.opens, sample)
                            // A zero-jitter sample must still yield a real pause,
                            // or an unlucky roll turns the breaker into a busy loop.
                            .max(BREAKER_BASE_MS / 10);
                    self.opens = self.opens.saturating_add(1);
                    // Half-open: exactly one probe is allowed at expiry; its
                    // failure re-opens immediately because the count stays at
                    // threshold − 1.
                    self.consecutive_failures = BREAKER_THRESHOLD - 1;
                    self.phase = PollPhase::Open {
                        until_ms: now_ms + cooldown,
                    };
                } else {
                    self.phase = PollPhase::Ready;
                    self.next_poll_at_ms =
                        now_ms + full_jitter_ms(POLL_MAX_MS, POLL_MAX_MS, 0, sample);
                }
            }
        }
    }

    /// Observe the current bearer token. A CHANGED token un-parks a 4xx-parked
    /// machine (contract: "stop polling on auth failure until token changes")
    /// and lets it poll immediately.
    pub fn note_token(&mut self, token: &str) {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        token.hash(&mut h);
        let fp = h.finish();
        if fp != self.token_fingerprint {
            let was_parked = matches!(self.phase, PollPhase::Parked { .. });
            self.token_fingerprint = fp;
            if was_parked {
                self.phase = PollPhase::Ready;
                self.next_poll_at_ms = 0; // poll immediately with the new token
                self.consecutive_failures = 0;
            }
        }
    }

    /// Current phase (read-only; exercised by the contract tests, unused by
    /// the GPUI bin itself — hence the allow).
    #[allow(dead_code)]
    pub fn phase(&self) -> &PollPhase {
        &self.phase
    }

    /// Consecutive transient failures recorded so far (contract tests).
    #[allow(dead_code)]
    pub fn consecutive_failures(&self) -> u32 {
        self.consecutive_failures
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot + gate — what the console renders and what it must refuse
// ─────────────────────────────────────────────────────────────────────────────

/// Whether the console currently KNOWS the operator's interruption state.
#[derive(Debug, Clone, PartialEq)]
pub enum HitlHealth {
    /// No relay configured (`PD_CONSOLE_RELAY_URL` unset) — state is unknown,
    /// which is NOT the same as "all clear".
    Unconfigured,
    /// The last poll failed; `reason` is the real transport/HTTP error. Any
    /// items shown are the LAST KNOWN list, marked stale.
    Unknown { reason: String },
    /// The last poll succeeded; `open` is the truth as of that poll.
    Live,
}

/// The interruptions view model: poll health + the open-ask list.
#[derive(Debug, Clone, PartialEq)]
pub struct HitlSnapshot {
    pub health: HitlHealth,
    /// Open asks, most urgent first. On `Unknown` this is the last-known list
    /// (kept so a critical block cannot vanish behind a network blip).
    pub open: Vec<Interruption>,
}

impl Default for HitlSnapshot {
    fn default() -> Self {
        Self {
            health: HitlHealth::Unconfigured,
            open: Vec::new(),
        }
    }
}

impl HitlSnapshot {
    /// The most urgent open `critical` ask, if any — the one that blocks
    /// fleet-dispatch actions (contract §4.3).
    pub fn critical(&self) -> Option<&Interruption> {
        self.open.iter().find(|i| i.urgency == Urgency::Critical)
    }

    /// Project the compact gate the GPUI shell consumes (banner + dispatch
    /// blocking) without carrying the full list across the channel.
    pub fn gate(&self, deep_link: Option<String>) -> HitlGate {
        HitlGate {
            open_count: self.open.len(),
            critical_title: self.critical().map(|i| i.title.clone()),
            known: matches!(self.health, HitlHealth::Live),
            deep_link,
        }
    }
}

/// What the window chrome needs to know: how many asks are open, whether a
/// `critical` one must block dispatch (and its title — the operator always
/// sees WHY), whether the state is actually known, and where to answer.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct HitlGate {
    pub open_count: usize,
    /// `Some(title)` ⇒ fleet-dispatch actions must be refused, showing this
    /// title as the reason. Stale (`known == false`) criticals still block —
    /// fail closed, never fail permissive.
    pub critical_title: Option<String>,
    /// `false` when the last poll failed or no relay is configured: the UI
    /// must say "unknown", never imply "all clear".
    pub known: bool,
    /// The session-gated web answer surface (`…/account/interruptions`).
    /// Answer/ack is NEVER offered in-app: a bearer token an agent holds must
    /// not be able to silence its own escalations.
    pub deep_link: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Render-agnostic view
// ─────────────────────────────────────────────────────────────────────────────

/// Emit the pane's `Block`s for a snapshot. Pure — both faces (GPUI + REPL)
/// and the headless PNG raster paint exactly these blocks, which is what makes
/// the three contract states screenshot-provable without a window.
pub fn view_blocks(snap: &HitlSnapshot, deep_link: Option<&str>, now_ms: i64) -> Vec<Block> {
    let mut blocks = vec![Block::Header("Operator Interruptions".into())];

    match &snap.health {
        HitlHealth::Unconfigured => {
            blocks.push(Block::KeyVal(
                "status".into(),
                "unknown — no relay configured (set PD_CONSOLE_RELAY_URL + PD_CONSOLE_RELAY_TOKEN)"
                    .into(),
            ));
            blocks.push(Block::Chip {
                label: "UNKNOWN — not \u{201c}all clear\u{201d}".into(),
                tone: Tone::Gated,
            });
            return blocks;
        }
        HitlHealth::Unknown { reason } => {
            blocks.push(Block::KeyVal(
                "status".into(),
                format!("unknown — last poll failed: {reason}"),
            ));
            blocks.push(Block::Chip {
                label: "UNKNOWN — not \u{201c}all clear\u{201d}".into(),
                tone: Tone::Gated,
            });
            if snap.open.is_empty() {
                return blocks;
            }
            blocks.push(Block::KeyVal(
                "showing".into(),
                "last known open asks (stale)".into(),
            ));
        }
        HitlHealth::Live => {
            blocks.push(Block::KeyVal("open".into(), snap.open.len().to_string()));
        }
    }

    if snap.open.is_empty() {
        // Honest empty state (contract §4.5): a real rendered "none open",
        // never a hidden widget.
        blocks.push(Block::KeyVal(
            "status".into(),
            "no open interruptions — nothing is waiting on you".into(),
        ));
        blocks.push(Block::Chip {
            label: "clear".into(),
            tone: Tone::Resting,
        });
        return blocks;
    }

    for ask in &snap.open {
        blocks.push(Block::Flag {
            letter: ask.urgency.letter(),
            label: format!(
                "{} \u{00b7} {} \u{00b7} from {} \u{00b7} {}",
                ask.title,
                ask.urgency.label(),
                if ask.source_agent.is_empty() {
                    "unknown agent"
                } else {
                    &ask.source_agent
                },
                ask.age_label(now_ms),
            ),
            tone: ask.urgency.tone(),
        });
    }

    if let Some(critical) = snap.critical() {
        blocks.push(Block::WrappedText {
            text: format!(
                "DISPATCH BLOCKED \u{2014} a critical ask is open: \u{201c}{}\u{201d}. \
                 New fleet work that depends on the answer is refused until a human \
                 answers or acks it on the web surface.",
                critical.title
            ),
            tone: Tone::Alarm,
        });
    }

    // Answer/ack is web-only by design (session-gated): the console
    // deep-links to the account page; it never closes asks itself.
    let link_label = match deep_link {
        Some(link) => format!("answer / ack \u{2192} {link}"),
        None => "answer / ack \u{2192} /account/interruptions (relay URL unset)".to_string(),
    };
    let link_tone = if snap.critical().is_some() {
        Tone::Alarm
    } else {
        Tone::Gated
    };
    blocks.push(Block::Chip {
        label: link_label,
        tone: link_tone,
    });

    blocks
}

/// Build the web answer-surface deep link from a relay base URL: the base with
/// any trailing slash removed, plus `/account/interruptions`. An empty or
/// whitespace-only base yields `None`.
pub fn deep_link_for(relay_url: &str) -> Option<String> {
    let base = relay_url.trim().trim_end_matches('/');
    if base.is_empty() {
        None
    } else {
        Some(format!("{base}/account/interruptions"))
    }
}
