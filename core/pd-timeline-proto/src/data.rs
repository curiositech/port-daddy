//! Timeline data model + ingestion.
//!
//! Two sources, in priority order:
//!   1. The live Port Daddy daemon: `GET /activity/timeline?limit=50`.
//!   2. A baked-in realistic fixture (clearly marked) when the daemon is down.
//!
//! Each raw activity event carries `{ timestamp, type, agentId, content, ... }`.
//! We bin events onto one of four horizontal *tracks* and synthesize at least one
//! *causal thread* (a cause on one track flowing to an effect on another).

use serde::Deserialize;

/// The four horizontal lanes of the Voyage Timeline.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Track {
    Dispatches = 0,
    Sorties = 1,
    Agents = 2,
    Human = 3,
}

impl Track {
    pub const ALL: [Track; 4] = [
        Track::Dispatches,
        Track::Sorties,
        Track::Agents,
        Track::Human,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Track::Dispatches => "dispatches",
            Track::Sorties => "sorties",
            Track::Agents => "agents",
            Track::Human => "human",
        }
    }

    pub fn row(self) -> usize {
        self as usize
    }
}

/// One placed event on a track.
#[derive(Clone, Debug)]
pub struct Event {
    /// Unix epoch milliseconds.
    pub t_ms: i64,
    pub track: Track,
    pub label: String,
    /// Stable id, used to wire causal threads.
    pub id: String,
}

/// A causal link: a cause marker flows to an effect marker (usually cross-track).
#[derive(Clone, Debug)]
pub struct CausalThread {
    pub cause_id: String,
    pub effect_id: String,
    pub note: &'static str,
}

/// The fully laid-out timeline the renderer consumes.
pub struct Timeline {
    pub events: Vec<Event>,
    pub threads: Vec<CausalThread>,
    pub t_min: i64,
    pub t_max: i64,
    /// True if data came from a baked fixture rather than the live daemon.
    pub is_fixture: bool,
    pub source_note: String,
}

#[derive(Deserialize)]
struct RawEvent {
    timestamp: i64,
    #[serde(rename = "type")]
    kind: String,
    #[serde(rename = "agentId")]
    agent_id: Option<String>,
    content: Option<String>,
    id: Option<String>,
}

/// Map a daemon event type onto one of the four tracks.
///
/// This is a *structured-field* dispatch on `type` (an enum-like string the
/// daemon controls), NOT free-text keyword NLP — see the project rule banning
/// keyword classification of unstructured text. `type` is a closed vocabulary.
fn track_for(kind: &str) -> Track {
    match kind {
        // Dispatch-queue / port lifecycle.
        "service.claim" | "service.release" | "dispatch" | "dispatch.enqueue" => {
            Track::Dispatches
        }
        // Sortie runs.
        "sortie" | "sortie.run" | "sortie.start" | "sortie.done" => Track::Sorties,
        // Human-driven coordination surface.
        "note" | "session.note" | "feedback" | "human" => Track::Human,
        // Everything agent-lifecycle lands on the agents lane.
        _ => Track::Agents,
    }
}

/// Short, legible label for a marker.
fn label_for(kind: &str, content: Option<&str>) -> String {
    // Prefer a trimmed slice of content; fall back to the type.
    if let Some(c) = content {
        let c = c.trim();
        if !c.is_empty() {
            let short: String = c.chars().take(36).collect();
            return if c.chars().count() > 36 {
                format!("{short}…")
            } else {
                short
            };
        }
    }
    kind.to_string()
}

impl Timeline {
    /// Build a timeline from the live daemon, falling back to fixture.
    pub fn load(daemon_base: &str) -> Self {
        match fetch_live(daemon_base) {
            Ok(tl) if !tl.events.is_empty() => tl,
            Ok(_) => Self::fixture("daemon returned no events; using fixture"),
            Err(e) => Self::fixture(&format!("daemon unreachable ({e}); using fixture")),
        }
    }

    fn from_events(mut events: Vec<Event>, is_fixture: bool, source_note: String) -> Self {
        events.sort_by_key(|e| e.t_ms);
        let t_min = events.iter().map(|e| e.t_ms).min().unwrap_or(0);
        let t_max = events.iter().map(|e| e.t_ms).max().unwrap_or(t_min + 1);
        // Synthesize causal threads: link the first cross-track pairs we can find.
        let threads = synthesize_threads(&events);
        Self {
            events,
            threads,
            t_min,
            t_max: t_max.max(t_min + 1),
            is_fixture,
            source_note,
        }
    }

    /// A hand-built, realistic fixture. CLEARLY MARKED as not-live data.
    pub fn fixture(reason: &str) -> Self {
        // A ~24s window of a plausible fleet morning.
        let base: i64 = 1_781_560_000_000;
        let s = |secs: i64| base + secs * 1000;
        let ev = |t: i64, track: Track, label: &str, id: &str| Event {
            t_ms: t,
            track,
            label: label.to_string(),
            id: id.to_string(),
        };
        let events = vec![
            ev(s(0), Track::Human, "operator: pd begin", "h0"),
            ev(s(2), Track::Dispatches, "claim port 9876", "d0"),
            ev(s(3), Track::Agents, "agent spawned: gardener", "a0"),
            ev(s(5), Track::Sorties, "sortie: triage worktrees", "s0"),
            ev(s(8), Track::Agents, "agent: copilot-fixes #403", "a1"),
            ev(s(9), Track::Dispatches, "claim port 4847", "d1"),
            ev(s(12), Track::Sorties, "sortie: ffi unsafe-extern", "s1"),
            ev(s(14), Track::Agents, "agent: parity doc-fix #402", "a2"),
            ev(s(17), Track::Human, "operator: pd note scope", "h1"),
            ev(s(19), Track::Sorties, "sortie: stream-interrupt", "s2"),
            ev(s(21), Track::Agents, "agent: finish PR #400", "a3"),
            ev(s(23), Track::Dispatches, "release port 4847", "d2"),
        ];
        let threads = vec![
            // The signature: a human note CAUSES a sortie, which CAUSES an agent run.
            CausalThread {
                cause_id: "h0".into(),
                effect_id: "s0".into(),
                note: "begin → triage",
            },
            CausalThread {
                cause_id: "s1".into(),
                effect_id: "a1".into(),
                note: "sortie → agent",
            },
            CausalThread {
                cause_id: "h1".into(),
                effect_id: "s2".into(),
                note: "note → sortie",
            },
        ];
        let mut tl = Self::from_events(events, true, format!("FIXTURE — {reason}"));
        tl.threads = threads;
        tl
    }
}

fn fetch_live(daemon_base: &str) -> Result<Timeline, String> {
    let url = format!("{daemon_base}/activity/timeline?limit=50");
    let raw: Vec<RawEvent> = ureq::get(&url)
        .timeout(std::time::Duration::from_millis(800))
        .call()
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())?;

    let events: Vec<Event> = raw
        .into_iter()
        .enumerate()
        .map(|(i, r)| {
            // Prefer content for the label; fall back to a short agent id.
            let content = r.content.clone().or_else(|| {
                r.agent_id
                    .as_ref()
                    .map(|a| a.split('-').take(2).collect::<Vec<_>>().join("-"))
            });
            Event {
                t_ms: r.timestamp,
                track: track_for(&r.kind),
                label: label_for(&r.kind, content.as_deref()),
                id: r.id.unwrap_or_else(|| format!("ev{i}")),
            }
        })
        .collect();

    Ok(Timeline::from_events(
        events,
        false,
        "LIVE — GET /activity/timeline?limit=50".to_string(),
    ))
}

/// Find a few cross-track cause→effect pairs by temporal adjacency.
///
/// Heuristic, deterministic: for each event, the next event on a *different*
/// track within a small window is treated as a caused effect. We keep the first
/// three to avoid visual clutter. This is just to prove the bezier rendering —
/// real causality would come from the daemon's parent/child edges.
fn synthesize_threads(events: &[Event]) -> Vec<CausalThread> {
    let mut threads = Vec::new();
    for (i, cause) in events.iter().enumerate() {
        if threads.len() >= 3 {
            break;
        }
        if let Some(effect) = events[i + 1..]
            .iter()
            .find(|e| e.track != cause.track && e.t_ms - cause.t_ms < 6000)
        {
            threads.push(CausalThread {
                cause_id: cause.id.clone(),
                effect_id: effect.id.clone(),
                note: "temporal",
            });
        }
    }
    threads
}
