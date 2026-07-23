//! Pure model of the dispatch review state machine — no GPU, no I/O.
//!
//! `ReviewState` is NOT invented for this viz. It is a 1:1 port of the real,
//! already-shipped 10-state machine defined in `lib/dispatch/state-machine.ts`
//! and `lib/dispatch/queue.ts` (the `DispatchState` union + `SCHEMA_SQL` CHECK
//! constraint), which is what `core/pd-console/src/dispatch_pane.rs` renders
//! (`review_pending` head-of-queue + the Approve/Reject/Cancel gate at
//! `core/pd-console/src/app.rs:4178-4181`) and what
//! `core/pd-console/src/conductor_pane.rs:55-67` styles per-state (its
//! `"produced" | "review_pending"` arm is the same pairing as here). The two
//! panes render *views* of this one machine; this file is the machine itself,
//! extracted so it can be laid out and drawn.
//!
//! Transition table below is a straight port of
//! `lib/dispatch/state-machine.ts`'s `FORWARD_TRANSITIONS` + the "failed /
//! salvage reachable from any non-terminal state" privileged-jump rules in
//! `canTransition()`. See that file's ASCII diagram for the canonical picture.

use std::collections::HashMap;

use anyhow::{bail, Context, Result};
use serde::Deserialize;

/// The 10 dispatch states, ported verbatim from `DispatchState` in
/// `lib/dispatch/queue.ts:44-54`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ReviewState {
    Proposed,
    Claimed,
    InProgress,
    Produced,
    ReviewPending,
    Accepted,
    Rejected,
    Settled,
    Failed,
    Salvage,
}

impl ReviewState {
    /// All 10 states, in the queue.ts declaration order. Used for layout and
    /// for exhaustively testing totality of `tone()` / `label()`.
    pub const ALL: [ReviewState; 10] = [
        ReviewState::Proposed,
        ReviewState::Claimed,
        ReviewState::InProgress,
        ReviewState::Produced,
        ReviewState::ReviewPending,
        ReviewState::Accepted,
        ReviewState::Rejected,
        ReviewState::Settled,
        ReviewState::Failed,
        ReviewState::Salvage,
    ];

    /// Operator-facing label — matches `describeState()` in
    /// `lib/dispatch/state-machine.ts:119-132` (not the raw DB string; that's
    /// `Self::wire_name`).
    pub fn label(self) -> &'static str {
        match self {
            ReviewState::Proposed => "queued",
            ReviewState::Claimed => "claimed",
            ReviewState::InProgress => "running",
            ReviewState::Produced => "PR open",
            ReviewState::ReviewPending => "awaiting review",
            ReviewState::Accepted => "accepted",
            ReviewState::Rejected => "rejected",
            ReviewState::Settled => "settled",
            ReviewState::Failed => "failed",
            ReviewState::Salvage => "salvaged",
        }
    }

    /// The raw wire string as stored in the `dispatches.state` column and
    /// emitted by the daemon — the SAME strings `dispatch_pane.rs` matches on
    /// (`"review_pending"`, `"salvage"`, etc). This is the `from_runtime`
    /// parse target, and the round-trip inverse of `Self::from_wire_name`.
    pub fn wire_name(self) -> &'static str {
        match self {
            ReviewState::Proposed => "proposed",
            ReviewState::Claimed => "claimed",
            ReviewState::InProgress => "in_progress",
            ReviewState::Produced => "produced",
            ReviewState::ReviewPending => "review_pending",
            ReviewState::Accepted => "accepted",
            ReviewState::Rejected => "rejected",
            ReviewState::Settled => "settled",
            ReviewState::Failed => "failed",
            ReviewState::Salvage => "salvage",
        }
    }

    pub fn from_wire_name(s: &str) -> Result<ReviewState> {
        ReviewState::ALL
            .into_iter()
            .find(|st| st.wire_name() == s)
            .with_context(|| format!("unknown ReviewState wire name: {s:?}"))
    }

    /// True for the 3 terminal states (`DISPATCH_TERMINAL_STATES` in queue.ts:75-79
    /// / `TERMINAL_STATES` in state-machine.ts:65-69). Public API surface for
    /// future callers (e.g. a live wiring that needs to stop polling once
    /// terminal); exercised by tests today.
    #[allow(dead_code)]
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            ReviewState::Settled | ReviewState::Failed | ReviewState::Salvage
        )
    }

    /// Semantic tone bucket for rendering — totality-tested (every variant maps
    /// to exactly one tone). Named after, but independent of, `pane::Tone` in
    /// `core/pd-console/src/pane.rs:17` (this crate does not depend on pd-console).
    pub fn tone(self) -> Tone {
        match self {
            ReviewState::Proposed => Tone::Resting,
            ReviewState::Claimed => Tone::Gated,
            ReviewState::InProgress => Tone::Engaged,
            ReviewState::Produced | ReviewState::ReviewPending => Tone::Accent,
            ReviewState::Accepted => Tone::Accent,
            ReviewState::Settled => Tone::Landed,
            ReviewState::Rejected | ReviewState::Failed => Tone::Conflicted,
            ReviewState::Salvage => Tone::Conflicted,
        }
    }
}

/// Rendering tone bucket. Mirrors the subset of `pane::Tone` this viz actually
/// needs; kept local (not imported from pd-console) so this crate stays a
/// standalone workspace with no cross-crate coupling.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Resting,
    Gated,
    Engaged,
    Accent,
    Landed,
    Conflicted,
}

/// The 8 "primary chain" edges — a straight port of `FORWARD_TRANSITIONS` in
/// `lib/dispatch/state-machine.ts:39-51` (non-empty entries only). Used both
/// to build the full edge set below and to drive layered layout, since these
/// are the edges that form a clean DAG (the privileged failed/salvage escape
/// jumps do not — they fan out from every non-terminal state).
const PRIMARY_EDGES: &[(ReviewState, ReviewState, &str)] = &[
    (ReviewState::Proposed, ReviewState::Claimed, "claim"),
    (ReviewState::Claimed, ReviewState::InProgress, "start"),
    (ReviewState::InProgress, ReviewState::Produced, "produce"),
    (
        ReviewState::Produced,
        ReviewState::ReviewPending,
        "request_review",
    ),
    (ReviewState::ReviewPending, ReviewState::Accepted, "accept"),
    (ReviewState::ReviewPending, ReviewState::Rejected, "reject"),
    (ReviewState::Accepted, ReviewState::Settled, "settle"),
    (ReviewState::Rejected, ReviewState::Salvage, "salvage"),
];

/// The 7 non-terminal states from which `failed` / `salvage` are privileged
/// escape jumps (`NON_TERMINAL` in state-machine.ts:54-62).
const NON_TERMINAL: &[ReviewState] = &[
    ReviewState::Proposed,
    ReviewState::Claimed,
    ReviewState::InProgress,
    ReviewState::Produced,
    ReviewState::ReviewPending,
    ReviewState::Accepted,
    ReviewState::Rejected,
];

/// All allowed transitions: the 8 primary edges, plus every non-terminal
/// state's privileged jump to `failed` (crash/budget exhaustion) and to
/// `salvage` (operator cancel) — ported from `canTransition()` in
/// state-machine.ts:87-93, which is exactly "primary edge, OR `to` is
/// failed/salvage and `from` is non-terminal." `rejected -> salvage` is
/// already a primary edge, so it is not duplicated (this mirrors
/// `nextStates()`'s `if !out.includes(...)` guard at state-machine.ts:109-110).
pub fn transitions() -> Vec<(ReviewState, ReviewState, &'static str)> {
    let mut edges: Vec<(ReviewState, ReviewState, &'static str)> = PRIMARY_EDGES.to_vec();
    for &from in NON_TERMINAL {
        if !edges
            .iter()
            .any(|&(f, t, _)| f == from && t == ReviewState::Failed)
        {
            edges.push((from, ReviewState::Failed, "fail"));
        }
        if !edges
            .iter()
            .any(|&(f, t, _)| f == from && t == ReviewState::Salvage)
        {
            edges.push((from, ReviewState::Salvage, "cancel"));
        }
    }
    edges
}

/// True iff `to` is reachable from `from` in one step — a straight port of
/// `canTransition()` (state-machine.ts:87-93).
pub fn can_transition(from: ReviewState, to: ReviewState) -> bool {
    if from == to {
        return false;
    }
    transitions().iter().any(|&(f, t, _)| f == from && t == to)
}

/// One observed transition, as it would appear in a `runtime-state.json`
/// event log (see `fixtures/runtime-state.sample.json` for the schema this
/// parses, and this module's doc comment for provenance).
#[derive(Debug, Clone, PartialEq)]
pub struct TransitionEvent {
    /// `None` only for the very first event (dispatch creation — there is no
    /// prior state).
    pub from: Option<ReviewState>,
    pub to: ReviewState,
    pub t_ms: i64,
}

/// The graph the renderer draws: the full static node/edge set (always all 10
/// states + all legal transitions — the viz shows the whole machine, not just
/// visited states) plus a specific dispatch's observed timeline.
#[derive(Debug, Clone)]
pub struct StateGraph {
    pub nodes: Vec<ReviewState>,
    pub edges: Vec<(ReviewState, ReviewState, &'static str)>,
    pub timeline: Vec<TransitionEvent>,
    /// Present only when parsed `from_runtime` — carried through for the
    /// scene's title/banner (dispatch id + goal), same idea as
    /// `Timeline::source_note` in pd-timeline-proto.
    pub source_note: String,
}

impl StateGraph {
    /// The static graph (all states + all legal edges) with an empty timeline
    /// — the machine's shape with no dispatch instance overlaid. Used by
    /// layout tests and available to a future caller that wants to render
    /// the bare machine with nothing highlighted.
    #[allow(dead_code)]
    pub fn structural() -> StateGraph {
        StateGraph {
            nodes: ReviewState::ALL.to_vec(),
            edges: transitions(),
            timeline: Vec::new(),
            source_note: "structural — no live dispatch".to_string(),
        }
    }

    /// The state currently occupied: the `to` of the last timeline event, or
    /// `Proposed` (the machine's start state) if the timeline is empty.
    /// `scene.rs` scrubs with `state_at()` instead (playhead-driven); this is
    /// the simpler "where did it end up" query, kept for callers that don't
    /// need scrubbing (and exercised directly by tests).
    #[allow(dead_code)]
    pub fn active_state(&self) -> ReviewState {
        self.timeline
            .last()
            .map(|ev| ev.to)
            .unwrap_or(ReviewState::Proposed)
    }

    /// The state occupied at time `t_ms`: the `to` of the last event whose
    /// `t_ms <= t_ms`, or `Proposed` if `t_ms` precedes the first event (or
    /// the timeline is empty). This is what a scrubbable playhead highlights
    /// (see `scene::build_scene`); `active_state()` above is the simpler
    /// "where did it end up" query.
    pub fn state_at(&self, t_ms: i64) -> ReviewState {
        self.timeline
            .iter()
            .rev()
            .find(|ev| ev.t_ms <= t_ms)
            .map(|ev| ev.to)
            .unwrap_or(ReviewState::Proposed)
    }

    /// `(t_min, t_max)` spanning the timeline, with `t_max` guaranteed `>
    /// t_min` (so callers can divide by the span without a zero-check). Empty
    /// timelines span `[0, 1]`.
    pub fn time_span(&self) -> (i64, i64) {
        let t_min = self.timeline.first().map(|e| e.t_ms).unwrap_or(0);
        let t_max = self.timeline.last().map(|e| e.t_ms).unwrap_or(t_min);
        (t_min, t_max.max(t_min + 1))
    }

    /// Parse a `runtime-state.json` document (schema below) into a `StateGraph`.
    /// The node/edge set is always the full structural machine — only the
    /// `timeline` and `source_note` vary per document. Every parsed transition
    /// is validated against `can_transition` (a JSON payload asserting an
    /// illegal jump is a hard parse error, not a silently-accepted edge).
    ///
    /// # `runtime-state.json` schema
    ///
    /// ```json
    /// {
    ///   "dispatchId": "d-abc123",
    ///   "goal": "ship the state machine viz",
    ///   "events": [
    ///     { "to": "proposed", "tMs": 0 },
    ///     { "from": "proposed", "to": "claimed", "tMs": 1200 },
    ///     { "from": "claimed", "to": "in_progress", "tMs": 1850 }
    ///   ]
    /// }
    /// ```
    ///
    /// - `dispatchId` / `goal`: free-text, used only for the on-screen banner.
    /// - `events`: chronological (caller's responsibility — `from_runtime`
    ///   does not re-sort; a fixture or the daemon should already emit them in
    ///   `t_ms` order the way `queue.ts`'s `selectSinceStmt` does).
    /// - `events[].from`: the wire name (`ReviewState::wire_name`) of the
    ///   prior state, or omitted/null for the first event.
    /// - `events[].to`: the wire name of the state entered.
    /// - `events[].tMs`: milliseconds, any epoch the caller likes (this proto
    ///   only uses relative spacing, matching pd-timeline-proto's `t_ms`).
    ///
    /// This schema does not exist anywhere else yet — no editor flow or daemon
    /// route emits it today. It is invented here, modeled directly on the
    /// shape `lib/dispatch/queue.ts` already persists (`state`, `producedAt`,
    /// `reviewedAt`, `settledAt` columns), so that wiring a real emitter later
    /// is a straight projection, not a redesign.
    pub fn from_runtime(json: &str) -> Result<StateGraph> {
        let doc: RuntimeStateDoc =
            serde_json::from_str(json).context("runtime-state.json: invalid JSON")?;

        let mut timeline = Vec::with_capacity(doc.events.len());
        for (i, raw) in doc.events.iter().enumerate() {
            let to =
                ReviewState::from_wire_name(&raw.to).with_context(|| format!("events[{i}].to"))?;
            let from = match &raw.from {
                Some(f) => Some(
                    ReviewState::from_wire_name(f).with_context(|| format!("events[{i}].from"))?,
                ),
                None => None,
            };
            if let Some(from) = from {
                if !can_transition(from, to) {
                    bail!(
                        "events[{i}]: illegal transition {} -> {} (not in the state machine)",
                        from.wire_name(),
                        to.wire_name()
                    );
                }
            } else if i != 0 {
                bail!("events[{i}]: `from` is required after the first event");
            }
            timeline.push(TransitionEvent {
                from,
                to,
                t_ms: raw.t_ms,
            });
        }

        let source_note = match (&doc.dispatch_id, &doc.goal) {
            (Some(id), Some(goal)) => format!("{id} — {goal}"),
            (Some(id), None) => id.clone(),
            (None, Some(goal)) => goal.clone(),
            (None, None) => "runtime-state.json".to_string(),
        };

        Ok(StateGraph {
            nodes: ReviewState::ALL.to_vec(),
            edges: transitions(),
            timeline,
            source_note,
        })
    }
}

#[derive(Debug, Deserialize)]
struct RuntimeStateDoc {
    #[serde(rename = "dispatchId")]
    dispatch_id: Option<String>,
    goal: Option<String>,
    events: Vec<RawEvent>,
}

#[derive(Debug, Deserialize)]
struct RawEvent {
    from: Option<String>,
    to: String,
    #[serde(rename = "tMs")]
    t_ms: i64,
}

/// Convenience: build a lookup from state to its outgoing edges. Not required
/// by the renderer today but exercised by tests to sanity-check the edge set
/// (every non-terminal state has at least one outgoing edge; every terminal
/// state has zero).
#[allow(dead_code)]
pub fn outgoing(
    edges: &[(ReviewState, ReviewState, &'static str)],
) -> HashMap<ReviewState, Vec<ReviewState>> {
    let mut out: HashMap<ReviewState, Vec<ReviewState>> = HashMap::new();
    for &(from, to, _) in edges {
        out.entry(from).or_default().push(to);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_states_have_a_tone_totality() {
        // Every ReviewState must map to exactly one Tone — exercising this
        // over ALL is what makes `tone()` provably total, not just
        // spot-checked.
        for st in ReviewState::ALL {
            let _ = st.tone();
        }
    }

    #[test]
    fn wire_name_round_trips() {
        for st in ReviewState::ALL {
            assert_eq!(ReviewState::from_wire_name(st.wire_name()).unwrap(), st);
        }
    }

    #[test]
    fn from_wire_name_rejects_unknown() {
        assert!(ReviewState::from_wire_name("bogus_state").is_err());
    }

    #[test]
    fn terminal_states_match_dispatch_terminal_states() {
        // DISPATCH_TERMINAL_STATES in queue.ts:75-79.
        let terminal: Vec<ReviewState> = ReviewState::ALL
            .into_iter()
            .filter(|s| s.is_terminal())
            .collect();
        assert_eq!(
            terminal,
            vec![
                ReviewState::Settled,
                ReviewState::Failed,
                ReviewState::Salvage
            ]
        );
    }

    #[test]
    fn edge_count_matches_forward_table_plus_privileged_jumps() {
        // 8 primary + 7 escapes-to-failed + 6 escapes-to-salvage (rejected's
        // salvage escape is already a primary edge) = 21.
        assert_eq!(transitions().len(), 21);
    }

    #[test]
    fn every_primary_edge_is_a_legal_transition() {
        for &(from, to, _) in PRIMARY_EDGES {
            assert!(
                can_transition(from, to),
                "{from:?} -> {to:?} should be legal (primary chain)"
            );
        }
    }

    #[test]
    fn every_non_terminal_can_escape_to_failed_and_salvage() {
        for &from in NON_TERMINAL {
            assert!(can_transition(from, ReviewState::Failed));
            assert!(can_transition(from, ReviewState::Salvage));
        }
    }

    #[test]
    fn terminal_states_have_no_outgoing_edges() {
        let out = outgoing(&transitions());
        for st in [
            ReviewState::Settled,
            ReviewState::Failed,
            ReviewState::Salvage,
        ] {
            assert!(
                out.get(&st).is_none(),
                "{st:?} must be terminal (no outgoing edges)"
            );
        }
    }

    #[test]
    fn self_transition_is_never_legal() {
        for st in ReviewState::ALL {
            assert!(!can_transition(st, st));
        }
    }

    #[test]
    fn illegal_skip_ahead_is_rejected() {
        // proposed -> review_pending skips claimed/in_progress/produced.
        assert!(!can_transition(
            ReviewState::Proposed,
            ReviewState::ReviewPending
        ));
        // settled is terminal — nothing leaves it.
        assert!(!can_transition(ReviewState::Settled, ReviewState::Failed));
    }

    #[test]
    fn structural_graph_active_state_defaults_to_proposed() {
        let g = StateGraph::structural();
        assert_eq!(g.active_state(), ReviewState::Proposed);
        assert_eq!(g.nodes.len(), 10);
        assert_eq!(g.edges.len(), 21);
    }

    const FIXTURE_JSON: &str = include_str!("../fixtures/runtime-state.sample.json");

    #[test]
    fn from_runtime_parses_the_baked_fixture() {
        let g = StateGraph::from_runtime(FIXTURE_JSON).expect("fixture parses");
        assert!(!g.timeline.is_empty());
        assert_eq!(g.nodes.len(), 10);
        assert_eq!(g.edges.len(), 21);
    }

    #[test]
    fn from_runtime_active_state_is_last_events_to() {
        let g = StateGraph::from_runtime(FIXTURE_JSON).expect("fixture parses");
        let expected = g.timeline.last().unwrap().to;
        assert_eq!(g.active_state(), expected);
    }

    #[test]
    fn from_runtime_rejects_illegal_transition() {
        let bad = r#"{
            "dispatchId": "d-bad",
            "events": [
                { "to": "proposed", "tMs": 0 },
                { "from": "proposed", "to": "settled", "tMs": 10 }
            ]
        }"#;
        let err = StateGraph::from_runtime(bad).unwrap_err();
        assert!(err.to_string().contains("illegal transition"), "{err}");
    }

    #[test]
    fn from_runtime_rejects_missing_from_after_first_event() {
        let bad = r#"{
            "events": [
                { "to": "proposed", "tMs": 0 },
                { "to": "claimed", "tMs": 10 }
            ]
        }"#;
        assert!(StateGraph::from_runtime(bad).is_err());
    }

    #[test]
    fn from_runtime_rejects_unknown_state_name() {
        let bad = r#"{ "events": [ { "to": "not_a_real_state", "tMs": 0 } ] }"#;
        assert!(StateGraph::from_runtime(bad).is_err());
    }

    #[test]
    fn from_runtime_rejects_malformed_json() {
        assert!(StateGraph::from_runtime("{ not json").is_err());
    }

    #[test]
    fn state_at_tracks_the_timeline_forward() {
        let g = StateGraph::from_runtime(FIXTURE_JSON).expect("fixture parses");
        assert_eq!(g.state_at(0), ReviewState::Proposed);
        assert_eq!(g.state_at(500), ReviewState::Proposed); // before the claim event
        assert_eq!(g.state_at(1200), ReviewState::Claimed); // exactly at the claim event
        assert_eq!(g.state_at(2_000_000), g.active_state()); // past the last event
    }

    #[test]
    fn time_span_is_never_zero_width() {
        let empty = StateGraph::structural();
        let (min, max) = empty.time_span();
        assert!(max > min);

        let g = StateGraph::from_runtime(FIXTURE_JSON).expect("fixture parses");
        let (min, max) = g.time_span();
        assert_eq!(min, 0);
        assert!(max > min);
    }

    #[test]
    fn source_note_prefers_dispatch_id_and_goal() {
        let doc = r#"{
            "dispatchId": "d-xyz",
            "goal": "ship it",
            "events": [ { "to": "proposed", "tMs": 0 } ]
        }"#;
        let g = StateGraph::from_runtime(doc).unwrap();
        assert_eq!(g.source_note, "d-xyz — ship it");
    }
}
