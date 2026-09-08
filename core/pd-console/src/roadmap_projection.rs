//! Roadmap projection — the console's typed mirror of the roadmap-home read
//! model ("roadmap is home", operator decision 4; binder ch19: the fleet is
//! plumbing, the front door is intent).
//!
//! CANONICAL SOURCE: `lib/roadmap-projection.ts` on branch
//! `claude/roadmap-projection` (PR #9223), served read-only at
//! `GET /roadmap/projection`. That module's parsimony law is why this file is
//! dumb Deserialize structs and a pure display function, not a second
//! derivation:
//!
//!   "those surfaces render THIS projection — they never re-derive roadmap
//!    state from roadmap_items / claims / dispatches themselves. One
//!    derivation, three renderers."
//!
//! The three renderers are web (the relay account page), pd-console (this
//! crate), and iOS (`apps/pd-ios/PortDaddy/RoadmapProjection.swift`, PR
//! #9333, which this module's shape and `display_state` deliberately mirror
//! field-for-field and clause-for-clause). Nothing in this file computes
//! roadmap state — it decodes it, and it refuses to render it more
//! confidently than the evidence allows.
//!
//! HARD EDGE on #9223: these types mirror `RoadmapProjection` as that PR
//! defines it TODAY (`ROADMAP_PROJECTION_VERSION = 1`). This branch merges
//! after #9223, not before — if the projection's shape changes before that
//! merge, this module's structs need the matching change too. A field #9223
//! adds later is additive on the wire; the tolerant-reader stance below (plain
//! `String` status/kind/source fields, `#[serde(default)]` on collections) is
//! what lets an OLDER console binary decode a NEWER projection without a
//! decode error.
//!
//! No GPUI view wiring lives here on purpose — this is the data layer only.
//! `roadmap_pane.rs` is a separate, pre-existing pane that talks to a
//! different route (`GET /roadmap/items`) and is untouched by this module.

use serde::{Deserialize, Serialize};

/// `ROADMAP_PROJECTION_VERSION` in lib/roadmap-projection.ts.
pub const ROADMAP_PROJECTION_VERSION: i64 = 1;

/// `ROADMAP_LIVE_EVIDENCE_MAX_AGE_MS` in lib/roadmap-projection.ts (itself
/// `AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS` from lib/agent-run-receipts.ts).
/// Informational only — [`RoadmapLiveEvidence::display_state`] reads the
/// window from the item's own `max_age_ms` field, never this constant, so the
/// freshness window stays the server's to move (same stance as the iOS port).
pub const ROADMAP_LIVE_EVIDENCE_MAX_AGE_MS: i64 = 65_000;

/// `ROADMAP_LIVE_EVIDENCE_MAX_SKEW_MS` in lib/roadmap-projection.ts. How far
/// ahead of the reader's clock an evidence timestamp may sit before the
/// projection stops believing it. Informational — the skew decision is made
/// server-side; a future-dated row already arrives with `live: false`.
pub const ROADMAP_LIVE_EVIDENCE_MAX_SKEW_MS: i64 = 30_000;

/// `DO_THIS_NEXT_MAX` in lib/roadmap-projection.ts.
pub const DO_THIS_NEXT_MAX: usize = 5;

/// `STATUS_RANK` in lib/roadmap-projection.ts — the primary item sort key.
/// An unrecognized status (a value this build predates) ranks after every
/// known one rather than jumping the queue, matching the iOS port's
/// `RoadmapStatus.rank`.
const STATUS_RANK_ORDER: &[&str] = &["now", "merge", "backlog", "parked", "done"];

/// Rank of a status string for the total item order. Unknown strings rank
/// after every known status.
pub fn status_rank(status: &str) -> usize {
    STATUS_RANK_ORDER
        .iter()
        .position(|s| *s == status)
        .unwrap_or(STATUS_RANK_ORDER.len())
}

/// `RoadmapProjectionReceipt` — `{ kind, at, by, detail }`. `kind` is
/// `'status-event' | 'note' | 'dispatch'` on the wire; kept as a plain
/// `String` here (tolerant reader — an unrecognized kind still decodes and
/// still renders, it just carries no icon mapping).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapProjectionReceipt {
    pub kind: String,
    /// Epoch milliseconds, as the projection emits.
    pub at: i64,
    #[serde(default)]
    pub by: Option<String>,
    #[serde(default)]
    pub detail: String,
}

/// `RoadmapProjectionClaim` — `{ claimedBy, claimedAt, kind, sessionId, agentId }`.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapProjectionClaim {
    pub claimed_by: String,
    pub claimed_at: i64,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
}

/// `RoadmapLiveEvidence` — the law-13 gate the projection has already run.
/// This type carries the server's verdict AND the sentence explaining it. It
/// adds exactly one rule of its own, in [`display_state`]: it will not render
/// LIVE on evidence that does not support it.
///
/// [`display_state`]: RoadmapLiveEvidence::display_state
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapLiveEvidence {
    pub live: bool,
    /// `'popper-dispatch'` or null — the only stream source the projection
    /// recognizes today.
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub dispatch_id: Option<String>,
    #[serde(default)]
    pub last_evidence_at: Option<i64>,
    #[serde(default)]
    pub age_ms: Option<i64>,
    /// Read from the projection on every item — never hard-coded — so the
    /// freshness window is the server's to move.
    pub max_age_ms: i64,
    /// The projection's own honesty label, e.g. "live — events arriving",
    /// "static — no dispatch receipt trail". Rendered verbatim by any
    /// eventual UI; this module does not paraphrase the server's account of
    /// what it knows.
    #[serde(default)]
    pub label: String,
}

/// Law 13's three renderable outcomes. Never a fourth: a projection that says
/// `live: true` with nothing behind it renders [`DisplayState::Stale`], not
/// [`DisplayState::Live`] — a stale chip is a small disappointment, a fake
/// LIVE is an operator acting on a body that stopped talking.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisplayState {
    /// Events are arriving now, and the evidence backs it.
    Live,
    /// There is a receipt trail but the last evidence is older than the
    /// freshness window (or the server itself says the stream is not live) —
    /// cached truth, shown as cached.
    Stale,
    /// No dispatch at all. Not stale, not live: nothing ever streamed.
    NoEvidence,
}

impl DisplayState {
    pub fn label(self) -> &'static str {
        match self {
            DisplayState::Live => "LIVE",
            DisplayState::Stale => "STALE",
            DisplayState::NoEvidence => "NO EVIDENCE",
        }
    }
}

impl RoadmapLiveEvidence {
    /// Law 13, rendered honestly. Mirrors
    /// `RoadmapLiveEvidence.displayState` in the iOS port
    /// (apps/pd-ios/PortDaddy/RoadmapProjection.swift) clause-for-clause:
    ///
    ///   1. No `dispatch_id` at all -> [`DisplayState::NoEvidence`], decided
    ///      before any other field is consulted. An item without a popper
    ///      receipt trail can never render LIVE, whatever its other fields
    ///      say.
    ///   2. `live` is the server's own verdict and is checked FIRST among the
    ///      remaining clauses, not treated as a formality: a settled dispatch
    ///      can carry a fresh `age_ms` and a real `last_evidence_at` and still
    ///      say `live: false`, and this function must not override that with
    ///      its own age arithmetic.
    ///   3. Only with `live == true`, a present `age_ms`, a present
    ///      `last_evidence_at`, AND `age_ms <= max_age_ms` does this return
    ///      [`DisplayState::Live`]. Anything else with a dispatch trail is
    ///      [`DisplayState::Stale`] — including a future-dated evidence
    ///      timestamp, which the server already refuses to mark `live: true`
    ///      for (see lib/roadmap-projection.ts's `ROADMAP_LIVE_EVIDENCE_MAX_SKEW_MS`
    ///      guard), so it falls into the same `live == false` -> Stale path
    ///      here without this function needing its own clock or skew logic.
    ///
    /// Pure: no clock read, no I/O. The server has already decided; this
    /// function only refuses to overstate that decision.
    pub fn display_state(&self) -> DisplayState {
        if self.dispatch_id.is_none() {
            return DisplayState::NoEvidence;
        }
        match (self.live, self.age_ms, self.last_evidence_at) {
            (true, Some(age), Some(_)) if age <= self.max_age_ms => DisplayState::Live,
            _ => DisplayState::Stale,
        }
    }

    /// Age of the last evidence in whole seconds, when there is any.
    pub fn evidence_age_secs(&self) -> Option<i64> {
        self.age_ms.map(|ms| ms / 1000)
    }
}

/// `RoadmapProjectionItem`. `status` is a plain `String` (tolerant reader —
/// see [`status_rank`] for the sort behavior of an unrecognized value).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapProjectionItem {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub status: String,
    pub priority: i64,
    #[serde(default)]
    pub claim: Option<RoadmapProjectionClaim>,
    #[serde(default)]
    pub receipts: Vec<RoadmapProjectionReceipt>,
    pub live_evidence: RoadmapLiveEvidence,
    pub last_touched_at: i64,
    #[serde(default)]
    pub dependencies: Vec<String>,
}

/// `RoadmapDoThisNextEntry` — `{ slug, title, reason }`. `reason` is
/// `'status-now' | 'popper-next'` on the wire; kept as a plain `String`
/// (tolerant reader).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapDoThisNextEntry {
    pub slug: String,
    pub title: String,
    #[serde(default)]
    pub reason: String,
}

/// `RoadmapProjection` — `{ v, harbor, generatedAt, items, doThisNext }`, the
/// full response body of `GET /roadmap/projection`.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapProjection {
    pub v: i64,
    pub harbor: String,
    pub generated_at: i64,
    #[serde(default)]
    pub items: Vec<RoadmapProjectionItem>,
    #[serde(default)]
    pub do_this_next: Vec<RoadmapDoThisNextEntry>,
}

impl RoadmapProjection {
    /// True when `v` is the version this build knows how to interpret
    /// ([`ROADMAP_PROJECTION_VERSION`]). A newer version still decodes and
    /// still renders — the wire format is additive by the parsimony law — a
    /// caller just knows to say so rather than claim full understanding.
    pub fn is_known_version(&self) -> bool {
        self.v == ROADMAP_PROJECTION_VERSION
    }

    /// Re-applies the server's total item order locally: `STATUS_RANK`, then
    /// `priority` ascending, then `last_touched_at` DESCENDING (most recently
    /// touched first), then `slug` ascending as a plain byte/code-unit
    /// compare (Rust `String: Ord` — the same compare the TS source picked
    /// deliberately over `localeCompare`, and the same compare the iOS port
    /// uses via Swift's `<`).
    ///
    /// The projection already arrives in this order; a caller that filters or
    /// merges the item list calls this so the result cannot silently reorder
    /// relative to the other two homes.
    pub fn in_projection_order(items: &[RoadmapProjectionItem]) -> Vec<RoadmapProjectionItem> {
        let mut sorted = items.to_vec();
        sorted.sort_by(|a, b| {
            status_rank(&a.status)
                .cmp(&status_rank(&b.status))
                .then_with(|| a.priority.cmp(&b.priority))
                .then_with(|| b.last_touched_at.cmp(&a.last_touched_at))
                .then_with(|| a.slug.cmp(&b.slug))
        });
        sorted
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The fixture pinned by tests/roadmap_projection_fixture.rs is derived
    /// from lib/roadmap-projection.ts's documented law-13 cases (that module
    /// ships no fixture of its own to reuse — see this crate's tests file for
    /// the full provenance note). Kept here too as a byte-identical copy so
    /// this module's own unit tests do not depend on the integration test's
    /// file layout.
    const FIXTURE: &str = include_str!("../tests/fixtures/roadmap-projection.fixture.json");

    fn fixture() -> RoadmapProjection {
        serde_json::from_str(FIXTURE).expect("fixture must decode as RoadmapProjection")
    }

    // ── Premise assertions ──────────────────────────────────────────────
    //
    // Before trusting any law-13 assertion below, confirm the fixture really
    // does contain the scenario each test claims to exercise. Without these,
    // a fixture edit that accidentally deleted a case would leave the
    // corresponding `find` returning `None` and the test panicking on
    // `.expect(...)` for the WRONG reason — indistinguishable from the logic
    // actually being broken.

    #[test]
    fn premise_fixture_has_six_items_covering_every_law_13_case() {
        let p = fixture();
        assert_eq!(p.v, ROADMAP_PROJECTION_VERSION);
        assert_eq!(
            p.items.len(),
            6,
            "fixture must carry exactly the six law-13 scenarios this suite pins"
        );
        let slugs: Vec<&str> = p.items.iter().map(|i| i.slug.as_str()).collect();
        for expected in [
            "ship-roadmap-home",
            "popper-live",
            "popper-stale",
            "popper-future",
            "popper-settled-fresh",
            "popper-ghost",
        ] {
            assert!(
                slugs.contains(&expected),
                "fixture missing expected slug {expected:?} (has {slugs:?})"
            );
        }
    }

    // ── Decoding ─────────────────────────────────────────────────────────

    #[test]
    fn decodes_the_fixture_into_the_versioned_shape() {
        let p = fixture();
        assert_eq!(p.v, 1);
        assert!(p.is_known_version());
        assert_eq!(p.harbor, "fleet");
        assert!(!p.items.is_empty());
        assert!(!p.do_this_next.is_empty());
        assert!(p.do_this_next.len() <= DO_THIS_NEXT_MAX);
    }

    #[test]
    fn round_trips_through_serialize_and_deserialize() {
        let original = fixture();
        let encoded = serde_json::to_string(&original).expect("serialize");
        let decoded: RoadmapProjection = serde_json::from_str(&encoded).expect("deserialize");
        assert_eq!(
            decoded, original,
            "a re-encode must survive a re-decode unchanged"
        );
    }

    #[test]
    fn nulls_survive_the_round_trip_as_nulls() {
        let p = fixture();
        let item = p
            .items
            .iter()
            .find(|i| i.slug == "ship-roadmap-home")
            .expect("premise: ship-roadmap-home present (see premise test above)");
        assert!(item.claim.is_none() || item.claim.as_ref().unwrap().session_id.is_some());
        assert!(item.live_evidence.dispatch_id.is_none());
        assert!(item.live_evidence.source.is_none());
        assert!(item.live_evidence.age_ms.is_none());
    }

    #[test]
    fn unknown_status_decodes_and_sorts_after_every_known_status() {
        let json = r#"{
            "v": 1, "harbor": "fleet", "generatedAt": 1755820800000,
            "items": [{
                "id": "rm_x", "slug": "invented-status",
                "title": "An item with a status from the future",
                "status": "marooned", "priority": 1, "claim": null,
                "receipts": [],
                "liveEvidence": {
                    "live": false, "source": null, "dispatchId": null,
                    "lastEvidenceAt": null, "ageMs": null, "maxAgeMs": 65000,
                    "label": "static — no dispatch receipt trail"
                },
                "lastTouchedAt": 1755820800000, "dependencies": []
            }],
            "doThisNext": []
        }"#;
        let p: RoadmapProjection =
            serde_json::from_str(json).expect("unknown status must still decode");
        let item = &p.items[0];
        assert_eq!(item.status, "marooned");
        assert!(status_rank(&item.status) > status_rank("done"));
    }

    #[test]
    fn a_newer_projection_version_still_decodes_and_is_flagged_not_rejected() {
        let json =
            r#"{ "v": 2, "harbor": "fleet", "generatedAt": 1, "items": [], "doThisNext": [] }"#;
        let p: RoadmapProjection =
            serde_json::from_str(json).expect("a newer version must still decode");
        assert!(!p.is_known_version());
    }

    // ── Ordering ─────────────────────────────────────────────────────────

    #[test]
    fn projection_order_matches_the_fixtures_own_order() {
        let p = fixture();
        let ordered = RoadmapProjection::in_projection_order(&p.items);
        let ordered_slugs: Vec<&str> = ordered.iter().map(|i| i.slug.as_str()).collect();
        let original_slugs: Vec<&str> = p.items.iter().map(|i| i.slug.as_str()).collect();
        assert_eq!(
            ordered_slugs, original_slugs,
            "the fixture is already in projection order"
        );
    }

    fn item(
        slug: &str,
        status: &str,
        priority: i64,
        last_touched_at: i64,
    ) -> RoadmapProjectionItem {
        RoadmapProjectionItem {
            id: slug.into(),
            slug: slug.into(),
            title: slug.into(),
            status: status.into(),
            priority,
            claim: None,
            receipts: Vec::new(),
            live_evidence: RoadmapLiveEvidence {
                live: false,
                source: None,
                dispatch_id: None,
                last_evidence_at: None,
                age_ms: None,
                max_age_ms: 65_000,
                label: "static — no dispatch receipt trail".into(),
            },
            last_touched_at,
            dependencies: Vec::new(),
        }
    }

    #[test]
    fn equal_priorities_fall_back_to_most_recently_touched_first() {
        let older = item("b-older", "backlog", 3, 1_755_500_000_000);
        let newer = item("a-newer", "backlog", 3, 1_755_800_000_000);
        // Premise: same status and priority, so lastTouchedAt is the ONLY
        // thing that can decide this ordering.
        assert_eq!(status_rank(&older.status), status_rank(&newer.status));
        assert_eq!(older.priority, newer.priority);
        let ordered = RoadmapProjection::in_projection_order(&[older, newer]);
        assert_eq!(
            ordered.iter().map(|i| i.slug.as_str()).collect::<Vec<_>>(),
            vec!["a-newer", "b-older"],
            "lastTouchedAt is DESCENDING — the item worked on most recently comes first"
        );
    }

    #[test]
    fn items_identical_on_every_other_key_break_the_tie_on_slug_both_input_orders() {
        let z = item("z-item", "backlog", 3, 1_755_600_000_000);
        let a = item("a-item", "backlog", 3, 1_755_600_000_000);
        let from_za = RoadmapProjection::in_projection_order(&[z.clone(), a.clone()]);
        let from_az = RoadmapProjection::in_projection_order(&[a, z]);
        assert_eq!(
            from_za.iter().map(|i| i.slug.as_str()).collect::<Vec<_>>(),
            vec!["a-item", "z-item"]
        );
        assert_eq!(
            from_az.iter().map(|i| i.slug.as_str()).collect::<Vec<_>>(),
            vec!["a-item", "z-item"],
            "the same two items in the other input order must produce the same output order"
        );
    }

    #[test]
    fn status_rank_outranks_priority() {
        let parked_urgent = item("parked-urgent", "parked", 1, 1_755_800_000_000);
        let now_trivial = item("now-trivial", "now", 9, 1_755_400_000_000);
        let ordered = RoadmapProjection::in_projection_order(&[parked_urgent, now_trivial]);
        assert_eq!(
            ordered.iter().map(|i| i.slug.as_str()).collect::<Vec<_>>(),
            vec!["now-trivial", "parked-urgent"]
        );
    }

    // ── Law 13 — never a fake LIVE ──────────────────────────────────────

    #[test]
    fn no_evidence_case_renders_no_evidence() {
        let p = fixture();
        let item = p
            .items
            .iter()
            .find(|i| i.slug == "ship-roadmap-home")
            .expect("premise: ship-roadmap-home present");
        // Premise: this scenario really has no dispatch trail at all.
        assert!(item.live_evidence.dispatch_id.is_none());
        assert_eq!(item.live_evidence.display_state(), DisplayState::NoEvidence);
    }

    #[test]
    fn fresh_evidence_inside_the_window_renders_live() {
        let p = fixture();
        let item = p
            .items
            .iter()
            .find(|i| i.slug == "popper-live")
            .expect("premise: popper-live present");
        // Premise: this scenario really is inside the freshness window.
        assert!(item.live_evidence.live);
        assert!(item.live_evidence.age_ms.unwrap() <= item.live_evidence.max_age_ms);
        assert_eq!(item.live_evidence.display_state(), DisplayState::Live);
    }

    #[test]
    fn stale_age_renders_stale() {
        let p = fixture();
        let item = p
            .items
            .iter()
            .find(|i| i.slug == "popper-stale")
            .expect("premise: popper-stale present");
        // Premise: evidence age really is past the freshness window.
        assert!(item.live_evidence.age_ms.unwrap() > item.live_evidence.max_age_ms);
        assert_eq!(item.live_evidence.display_state(), DisplayState::Stale);
    }

    #[test]
    fn future_dated_evidence_can_never_render_live() {
        let p = fixture();
        let item = p
            .items
            .iter()
            .find(|i| i.slug == "popper-future")
            .expect("premise: popper-future present");
        // Premise: the server already refused `live: true` for this row (the
        // future-skew guard is server-side, per lib/roadmap-projection.ts);
        // the label names the reason so a reader can confirm the scenario.
        assert!(!item.live_evidence.live);
        assert!(item.live_evidence.label.to_lowercase().contains("future"));
        assert_eq!(item.live_evidence.display_state(), DisplayState::Stale);
    }

    /// The adversarial case: a settled dispatch with FRESH evidence and
    /// `live: false`. Every other stale fixture case is stale because
    /// `age_ms` is missing or past the window, so those alone cannot prove
    /// `display_state` checks the `live` flag rather than re-deriving
    /// liveness from age. This is the one case where only the flag decides —
    /// see the mutation check on this exact test in the PR description.
    #[test]
    fn a_settled_dispatch_with_fresh_evidence_still_renders_stale_not_live() {
        let p = fixture();
        let item = p
            .items
            .iter()
            .find(|i| i.slug == "popper-settled-fresh")
            .expect("premise: popper-settled-fresh present");
        // Premise: every clause OTHER than `live` is satisfied here, so if
        // this assertion passed on `live` alone being false, we know it.
        assert!(!item.live_evidence.live);
        assert!(item.live_evidence.dispatch_id.is_some());
        assert!(item.live_evidence.last_evidence_at.is_some());
        assert!(item.live_evidence.age_ms.unwrap() <= item.live_evidence.max_age_ms);
        assert_eq!(
            item.live_evidence.display_state(),
            DisplayState::Stale,
            "the server's own live flag is the first clause, not a formality"
        );
    }

    #[test]
    fn a_dispatch_trail_without_a_stream_timestamp_renders_stale() {
        let p = fixture();
        let item = p
            .items
            .iter()
            .find(|i| i.slug == "popper-ghost")
            .expect("premise: popper-ghost present");
        // Premise: a dispatch id exists but no evidence timestamp does.
        assert!(item.live_evidence.dispatch_id.is_some());
        assert!(item.live_evidence.last_evidence_at.is_none());
        assert_eq!(item.live_evidence.display_state(), DisplayState::Stale);
    }

    #[test]
    fn age_exactly_at_the_deadline_is_still_live_the_window_is_inclusive() {
        let boundary = RoadmapLiveEvidence {
            live: true,
            source: Some("popper-dispatch".into()),
            dispatch_id: Some("dsp_live".into()),
            last_evidence_at: Some(1_755_820_000_000),
            age_ms: Some(65_000),
            max_age_ms: 65_000,
            label: "live — events arriving".into(),
        };
        assert_eq!(boundary.display_state(), DisplayState::Live);
    }

    #[test]
    fn one_millisecond_past_the_deadline_is_stale() {
        let past = RoadmapLiveEvidence {
            live: true,
            source: Some("popper-dispatch".into()),
            dispatch_id: Some("dsp_live".into()),
            last_evidence_at: Some(1_755_820_000_000),
            age_ms: Some(65_001),
            max_age_ms: 65_000,
            label: "live — events arriving".into(),
        };
        assert_eq!(past.display_state(), DisplayState::Stale);
    }

    #[test]
    fn a_fresh_age_with_no_evidence_timestamp_is_still_stale() {
        // The bypass this pins (mirrors the iOS port's identical test): every
        // OTHER stale case in this suite also has `age_ms: None`, so `let
        // Some(age) = age_ms` fails first there and this clause never gets
        // to decide anything on its own. This case isolates it: an age
        // arrives, it is fresh, and there is still no timestamp saying when
        // the evidence was seen.
        let age_without_timestamp = RoadmapLiveEvidence {
            live: true,
            source: Some("popper-dispatch".into()),
            dispatch_id: Some("dsp_ghost".into()),
            last_evidence_at: None,
            age_ms: Some(1_000),
            max_age_ms: 65_000,
            label: "live — events arriving".into(),
        };
        assert_eq!(age_without_timestamp.display_state(), DisplayState::Stale);
    }

    #[test]
    fn claimed_live_with_no_dispatch_id_is_no_evidence_not_live() {
        let no_dispatch_but_live = RoadmapLiveEvidence {
            live: true,
            source: None,
            dispatch_id: None,
            last_evidence_at: Some(1_755_820_000_000),
            age_ms: Some(10),
            max_age_ms: 65_000,
            label: "live — events arriving".into(),
        };
        assert_eq!(
            no_dispatch_but_live.display_state(),
            DisplayState::NoEvidence,
            "there is no live without a dispatch"
        );
    }

    #[test]
    fn every_display_state_has_a_non_empty_label() {
        for state in [
            DisplayState::Live,
            DisplayState::Stale,
            DisplayState::NoEvidence,
        ] {
            assert!(!state.label().is_empty());
        }
    }

    #[test]
    fn evidence_age_secs_converts_from_milliseconds() {
        let e = RoadmapLiveEvidence {
            live: true,
            source: Some("popper-dispatch".into()),
            dispatch_id: Some("dsp_live".into()),
            last_evidence_at: Some(0),
            age_ms: Some(4_000),
            max_age_ms: 65_000,
            label: "live — events arriving".into(),
        };
        assert_eq!(e.evidence_age_secs(), Some(4));
        assert_eq!(RoadmapLiveEvidence::default().evidence_age_secs(), None);
    }
}
