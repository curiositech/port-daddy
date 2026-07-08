//! Harbor Editor **P3, slice 2: the WEDGE** — conflict prediction *before a byte is
//! written*.
//!
//! ## What this slice is (honest scope)
//! Slice 1 made a region claim a live awareness range on the coordination lane and a
//! durable `/files` mirror — pure *visibility*. This slice adds the **guard**: when a
//! replica **acquires a claim** or **enters a region** (build-coop-ide-gpui ref 03 §2:
//! coordination is presence-as-claims; ref 04: the wedge is a *pre-write* check), the
//! pane asks the daemon "does my intended edit contradict a live claim?" by calling the
//! EXISTING `POST /conflicts/predict` (routes/symbols.ts) against the other live claims.
//! When the daemon reports `blocking > 0`, the pane raises a [`Tone::Conflicted`] guard
//! band and a **pd-nudge** — it never silently merges over a contended region.
//!
//! ## The three hard invariants this module encodes (adversarial-verify targets)
//!   - **Debounced, never per-keystroke** (HARD RULE 2). The probe fires on
//!     claim-ACQUIRE / region-ENTER, coalesced through [`WedgeProbe`] — a clock-injected
//!     debounce gate (the [`crate::editor_claims::ClaimMirror`] discipline), so a fast
//!     region drag or a burst of caret moves collapses to at most one
//!     `conflicts/predict` per window. Symbol-parse-per-char would be both too slow AND
//!     would over-warn until actors ignore the guard.
//!   - **One-shot pulse, never `repeat()`** (HARD RULE 3). On overlap-detected the band
//!     plays a SINGLE ease-in-out swell then RESTS as a static [`Tone::Conflicted`] band
//!     ([`GuardBand::emphasis`]). There is no `Animation::new(..).repeat()` — an infinite
//!     throb burns the frame budget and becomes wallpaper (the rust-gpui-motion failure
//!     mode). The pure easing here is what the gpui face drives a one-shot `Animation`
//!     from; a test samples it past many pulse-durations to prove it never re-peaks.
//!   - **Refusal names only the correct action, never a bypass** (HARD RULE 5). A gated
//!     region yields a [`GuardVerdict::Gated`] whose message offers *request handoff /
//!     parley / pick another region* and NEVER a `--force`/`--no-verify`/`--allow-*`
//!     flag. It is a typed refusal (error-handling-patterns; the #718 `UnsupportedScope`
//!     precedent), not a bypass-advertising string and not a silent merge.
//!
//! ## Reuse, don't reimplement (PD hard rule + brief)
//! Conflict prediction lives in the daemon (`symbolIndex.predictConflicts`, the
//! claim-type matrix: `modify×modify = blocking`). This module does NOT re-derive it in
//! Rust — it maps a [`RegionClaim`] to the route's `{ filePath, symbolPath, type }`
//! [`SymbolClaim`] shape, builds the `{ claimsA, claimsB }` request, and tolerantly
//! parses the `{ count, blocking, warnings, info }` response. The live call is
//! [`crate::agent::DaemonClient::predict_conflicts`]; everything here is pure and
//! unit-tests on Linux CI in the default (no-`gpui`) build.
//!
//! ## Agent-neutral (PD hard rule 4)
//! Nothing here branches on which backend an actor runs. A claim is keyed by a
//! [`PeerId`] minted from any PD identity; the wedge treats a human's claim and an
//! agent's claim identically.

use crate::editor_claims::RegionClaim;
use crate::pane::Tone;

// ── The daemon claim shape (routes/symbols.ts `SymbolClaim`) ──────────────────

/// A claim's intent, mirroring the daemon route's accepted `type` values. The
/// `/conflicts/predict` validator accepts only `read` and `modify` (it rejects the
/// symbol-index's richer `add-sibling`/`delete`/… kinds), so those are the only two
/// this `Copy` enum needs. A region claim in the editor is intent-to-**modify** that
/// region; `Read` exists so a future read-only "I'm looking here" claim can predict
/// against a modify without over-blocking (`read×modify = warning`, not `blocking`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimKind {
    /// Reading the region — a non-contended intent (never `blocking` against another).
    Read,
    /// Modifying the region — the editor's default claim intent.
    Modify,
}

impl ClaimKind {
    /// The exact wire token the route matches (`c.type === 'read' | 'modify'`).
    pub fn wire(self) -> &'static str {
        match self {
            ClaimKind::Read => "read",
            ClaimKind::Modify => "modify",
        }
    }
}

/// The daemon's `{ filePath, symbolPath, type }` claim shape — one element of the
/// `claimsA`/`claimsB` arrays `POST /conflicts/predict` expects. Built from a
/// [`RegionClaim`] via [`SymbolClaim::from_region`]: the region's `label` (the symbol
/// name the actor is working, e.g. `"parse_header"`) is the `symbolPath`, so two
/// claims on the SAME symbol of the SAME file are what the daemon's claim-type matrix
/// scores (`modify×modify = blocking`). `file_path`/`symbol_path` own their strings
/// once, off the render hot path — this is built at probe time (debounced), never per
/// frame.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct SymbolClaim {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "symbolPath")]
    pub symbol_path: String,
    #[serde(rename = "type", serialize_with = "serialize_kind")]
    pub kind: ClaimKind,
}

fn serialize_kind<S: serde::Serializer>(kind: &ClaimKind, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(kind.wire())
}

impl SymbolClaim {
    /// Map a region claim to the daemon's symbol-claim shape for a file at `path`. The
    /// region's work `label` becomes the `symbolPath`; the intent is `Modify` (holding
    /// a region to edit it). Agent-neutral: the claim's authoring `PeerId` is NOT sent —
    /// the daemon scores intents on `(filePath, symbolPath, type)`, never on who or which
    /// backend holds them.
    pub fn from_region(path: &str, claim: &RegionClaim, kind: ClaimKind) -> Self {
        Self {
            file_path: path.to_string(),
            symbol_path: claim.label.clone(),
            kind,
        }
    }
}

/// Build the `POST /conflicts/predict` request body: `{ claimsA, claimsB }`. Pure, so
/// the wire shape is a checked contract against the route schema (see the tests) with
/// no live daemon. `a` is the acquiring/entering replica's intended claim(s); `b` is
/// the OTHER live claims it is being predicted against.
pub fn predict_request_body(a: &[SymbolClaim], b: &[SymbolClaim]) -> serde_json::Value {
    serde_json::json!({ "claimsA": a, "claimsB": b })
}

// ── The daemon's conflict verdict (route response) ────────────────────────────

/// The severity tallies `POST /conflicts/predict` returns for one prediction call:
/// `{ count, blocking, warnings, info }`. All `Copy` scalars. `blocking > 0` is the
/// wedge trip-wire — the daemon's claim-type matrix found a `modify×modify` (or a
/// broken-signature) contradiction on a shared symbol, so the intended edit must not
/// land silently.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ConflictReport {
    /// Total predicted conflicts across all severities.
    pub count: u32,
    /// `blocking`-severity conflicts — the wedge trip-wire.
    pub blocking: u32,
    /// `warning`-severity conflicts (e.g. `read×modify`, a dependency touch).
    pub warnings: u32,
    /// `info`-severity conflicts (a distant transitive touch).
    pub info: u32,
}

impl ConflictReport {
    /// Does this report trip the guard? True iff the daemon found a `blocking`
    /// conflict. Warnings/info are surfaced (a `pd-nudge`) but do NOT raise the
    /// [`Tone::Conflicted`] band or gate a commit — over-blocking on soft conflicts is
    /// exactly the "train actors to ignore the guard" failure this slice avoids.
    pub fn is_blocking(&self) -> bool {
        self.blocking > 0
    }

    /// Is there anything at all to surface (any severity)? A quiet, conflict-free
    /// probe returns `false`, so the pane raises no band and no nudge.
    pub fn is_quiet(&self) -> bool {
        self.count == 0 && self.blocking == 0 && self.warnings == 0 && self.info == 0
    }
}

/// Tolerantly parse a `POST /conflicts/predict` response into a [`ConflictReport`].
///
/// The route has TWO shapes and both must read correctly (util.rs tolerance rule):
///   - The full tally `{ success, count, blocking, warnings, info, conflicts }`.
///   - The early-return `{ success: true, conflicts: [], count: 0 }` (both claim sets
///     empty) — which OMITS `blocking`/`warnings`/`info`, so a missing field reads as
///     `0`, never a parse failure.
/// A non-object, an error body, or a garbled response yields an all-zero (quiet)
/// report rather than crashing — a wedge that cannot reach the daemon fails OPEN to
/// "no known conflict" for *visibility*, while the durable commit gate (a later seam)
/// is what fails closed. (Slice 2 renders a band; it does not itself block a write.)
pub fn parse_predict_response(v: &serde_json::Value) -> ConflictReport {
    let u = |key: &str| -> u32 {
        v.get(key).and_then(|n| n.as_u64()).unwrap_or(0).min(u32::MAX as u64) as u32
    };
    // If the daemon reported an explicit failure, treat it as quiet (no false band).
    if v.get("success").and_then(|s| s.as_bool()) == Some(false) {
        return ConflictReport::default();
    }
    ConflictReport {
        count: u("count"),
        blocking: u("blocking"),
        warnings: u("warnings"),
        info: u("info"),
    }
}

// ── The debounce gate: fire on acquire / region-enter, NEVER per-keystroke ────

/// A clock-injected debounce gate for the conflict-prediction probe (HARD RULE 2).
///
/// A `conflicts/predict` call is comparatively expensive (a daemon round-trip + a
/// symbol-index scan) and, fired per keystroke, would both stall the edit loop and
/// warn so often that actors learn to ignore the band. So the probe is armed ONLY on a
/// coarse edge — a claim ACQUIRE or a region ENTER — and even those are coalesced here:
/// a fast region drag (many enters) or repeated acquires collapse to **at most one**
/// probe per `min_interval_ms`, always carrying the LATEST region intent.
///
/// Clock-free (the caller passes `now_ms`) so it unit-tests deterministically with a
/// fake clock — no sleeps, no flakes — exactly like
/// [`crate::editor_claims::ClaimMirror`] and
/// [`crate::editor_sync::PresenceDebouncer`]. The pending intent is a single
/// [`RegionClaim`] (the newest wins); there is deliberately no per-keystroke queue for
/// a flood to fill.
#[derive(Debug, Default)]
pub struct WedgeProbe {
    min_interval_ms: i64,
    last_fired_ms: Option<i64>,
    pending: Option<RegionClaim>,
}

impl WedgeProbe {
    /// A probe gate that fires at most once per `min_interval_ms`.
    pub fn new(min_interval_ms: i64) -> Self {
        Self { min_interval_ms, last_fired_ms: None, pending: None }
    }

    /// Arm the probe with the region intent the actor just ACQUIRED or ENTERED. This is
    /// the ONLY way a probe is scheduled — a caret move / keystroke that neither
    /// acquires a claim nor crosses into a new region never calls this, which is what
    /// makes the gate fire on coordination edges and not per-keystroke. Idempotent
    /// between flushes (it stashes the newest intent; the call happens in [`take_due`]).
    ///
    /// [`take_due`]: Self::take_due
    pub fn arm(&mut self, intent: RegionClaim) {
        self.pending = Some(intent);
    }

    /// Is a probe currently armed (a coordination edge is pending a predict call)?
    pub fn is_armed(&self) -> bool {
        self.pending.is_some()
    }

    /// If an intent is armed AND enough time has elapsed since the last probe, take it
    /// (arming the interval) so the caller can run `conflicts/predict` against it.
    /// Otherwise `None` — an idle editor, or a second edge inside the debounce window,
    /// produces NO probe (zero daemon traffic, zero over-warning).
    pub fn take_due(&mut self, now_ms: i64) -> Option<RegionClaim> {
        let due = match self.last_fired_ms {
            None => true,
            Some(last) => now_ms - last >= self.min_interval_ms,
        };
        if due {
            if let Some(intent) = self.pending.take() {
                self.last_fired_ms = Some(now_ms);
                return Some(intent);
            }
        }
        None
    }
}

// ── The one-shot conflict guard band (Tone::Conflicted) ───────────────────────

/// Duration (ms) of the SINGLE ease-in-out swell a conflict band plays on
/// overlap-detected. After this, the band rests static forever — it is NEVER a
/// `repeat()` loop (HARD RULE 3). ~half a second reads as one deliberate "look here"
/// pulse without becoming a throb.
pub const PULSE_MS: i64 = 480;

/// The resting emphasis of a conflict band once its one-shot pulse has settled — the
/// static [`Tone::Conflicted`] band that stays until the conflict clears. Deliberately
/// high (the band remains clearly visible at rest); the pulse only briefly lifts it to
/// [`PEAK_EMPHASIS`] once.
pub const REST_EMPHASIS: f32 = 0.72;

/// The peak emphasis at the crest of the one-shot swell (mid-pulse).
pub const PEAK_EMPHASIS: f32 = 1.0;

/// A single smooth ease-in-out swell over `t ∈ [0, 1]`: `0 → 1 → 0`, a half-sine so it
/// accelerates out of rest and decelerates back (the ease-in-out shape rust-gpui-motion
/// names), peaking once at `t = 0.5`. Outside `[0, 1]` it is `0` — the property that
/// makes the band ONE-SHOT: there is no modulo/period, so past the pulse window the
/// swell contributes nothing and the band sits at [`REST_EMPHASIS`].
fn one_shot_swell(t: f32) -> f32 {
    if !(0.0..=1.0).contains(&t) {
        return 0.0;
    }
    (std::f32::consts::PI * t).sin()
}

/// The live conflict guard band raised when the daemon predicts a `blocking` conflict
/// on a region the local replica is acquiring/entering. Renders as a
/// [`Tone::Conflicted`] band; its brightness is a ONE-SHOT [`emphasis`](Self::emphasis)
/// pulse that swells once then rests. The band carries the contended `symbol` + region
/// span + the daemon's [`ConflictReport`] so the pane can title it and drive a nudge.
#[derive(Debug, Clone, PartialEq)]
pub struct GuardBand {
    /// The contended work symbol (the claim label, e.g. `"parse_header"`).
    pub symbol: String,
    /// The 1-based inclusive line span the band covers.
    pub region: (u32, u32),
    /// The daemon's severity tally that raised this band (`blocking > 0`).
    pub report: ConflictReport,
    /// Logical time (ms) the band was raised — the pulse clock origin. The one-shot
    /// swell is a pure function of `now_ms - raised_at_ms`, so the gpui face drives a
    /// single (non-repeating) `Animation` from it and this stays deterministically
    /// testable with a fake clock.
    pub raised_at_ms: i64,
}

impl GuardBand {
    /// Raise a band for a `blocking` [`ConflictReport`] over `region`, working `symbol`,
    /// at logical time `raised_at_ms`.
    pub fn raised(symbol: impl Into<String>, region: (u32, u32), report: ConflictReport, raised_at_ms: i64) -> Self {
        Self { symbol: symbol.into(), region, report, raised_at_ms }
    }

    /// A conflict band is always [`Tone::Conflicted`] — the single, reserved color path
    /// for a predicted contradiction (no parallel color is introduced; HARD RULE 3/5).
    pub fn tone(&self) -> Tone {
        Tone::Conflicted
    }

    /// The band's emphasis (0..=1) at logical time `now_ms` — a ONE-SHOT ease-in-out
    /// pulse then a static rest:
    ///   - `reduced_motion` → constant [`REST_EMPHASIS`] (no swell at all; the band is
    ///     shown, just never animated — reduced-motion-safe per rust-gpui-motion).
    ///   - before the pulse (`now < raised_at`) or after it (`elapsed ≥ PULSE_MS`) →
    ///     [`REST_EMPHASIS`].
    ///   - during the pulse → `REST + (PEAK - REST) · swell`, a single half-sine crest.
    ///
    /// Because [`one_shot_swell`] is zero outside `[0, 1]`, sampling this at any
    /// multiple of [`PULSE_MS`] returns exactly [`REST_EMPHASIS`] — the machine-checked
    /// proof it does not `repeat()` (a looped animation would re-crest every period).
    pub fn emphasis(&self, now_ms: i64, reduced_motion: bool) -> f32 {
        if reduced_motion {
            return REST_EMPHASIS;
        }
        let elapsed = now_ms - self.raised_at_ms;
        if elapsed < 0 || elapsed >= PULSE_MS {
            return REST_EMPHASIS;
        }
        let t = elapsed as f32 / PULSE_MS as f32;
        REST_EMPHASIS + (PEAK_EMPHASIS - REST_EMPHASIS) * one_shot_swell(t)
    }

    /// Has the one-shot pulse finished at `now_ms` (the band now resting static)? The
    /// gpui face uses this to stop animating and hold the static band — it never
    /// re-arms the pulse.
    pub fn pulse_done(&self, now_ms: i64) -> bool {
        now_ms - self.raised_at_ms >= PULSE_MS
    }
}

// ── The typed refusal + the pd-nudge (Tone::Gated) ────────────────────────────

/// The ONLY actions a gated refusal ever offers (HARD RULE 5). Every one is a
/// forward, honest move — negotiate for the region or leave it. There is deliberately
/// NO `--force` / `--no-verify` / `--allow-*` here; a bypass flag is not an option the
/// guard advertises, and `guard_message` is asserted (in tests) to contain none.
pub const GATED_ACTIONS: [&str; 3] = ["request a handoff", "open a parley", "pick another region"];

/// A tripwire list a test scans a refusal string against: a refusal that mentions any
/// of these has advertised a bypass and is a defect.
pub const BYPASS_TOKENS: [&str; 6] = ["--force", "--no-verify", "--allow", "force", "override", "bypass"];

/// A concise operator-facing **pd-nudge** the wedge surfaces — never a silent merge.
/// Carries the semantic [`Tone`] the pane paints it in and a full, never-truncated
/// message (HCD: bridge the Gulf of Evaluation — the operator reads the whole reason).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PdNudge {
    pub tone: Tone,
    pub headline: String,
    pub detail: String,
}

impl PdNudge {
    /// The nudge for a daemon-predicted `blocking` conflict on `symbol`: a
    /// [`Tone::Conflicted`] "you are about to edit into a predicted conflict" note. It
    /// states the contradiction and points at negotiation — it does not offer a bypass.
    pub fn blocking(symbol: &str, report: ConflictReport) -> Self {
        Self {
            tone: Tone::Conflicted,
            headline: format!("predicted conflict on ‘{symbol}’"),
            detail: format!(
                "the daemon predicts {} blocking conflict(s) if you edit ‘{symbol}’ now — {}.",
                report.blocking,
                GATED_ACTIONS.join(", "),
            ),
        }
    }

    /// The nudge for editing INSIDE another live claim (region ownership, first-granted
    /// wins — HARD RULE 6): a [`Tone::Gated`] "claimed by <owner>" note offering
    /// handoff/parley/move. The contender negotiates or moves; it never silently merges.
    pub fn gated(owner_label: &str, symbol: &str) -> Self {
        Self {
            tone: Tone::Gated,
            headline: format!("‘{symbol}’ is claimed by {owner_label}"),
            detail: guard_message(owner_label, symbol),
        }
    }
}

/// The refusal string for a gated region — names the owner, the symbol, and ONLY the
/// [`GATED_ACTIONS`]. This is the load-bearing HARD-RULE-5 sentence: it must never name
/// a bypass flag. Kept pure + reused by [`PdNudge::gated`] and [`GatedRegion::message`]
/// so there is exactly one wording to audit.
pub fn guard_message(owner_label: &str, symbol: &str) -> String {
    format!(
        "region ‘{symbol}’ is held by {owner_label}'s live claim — {}.",
        GATED_ACTIONS.join(", "),
    )
}

/// A region the local replica is trying to edit that is already held by ANOTHER live
/// claim (the first-granted winner, HARD RULE 6). The contender gets this — a
/// [`Tone::Gated`] chip, not a [`Tone::Conflicted`] band — because it is an ownership
/// contention (someone is here), distinct from a daemon-predicted semantic contradiction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GatedRegion {
    /// Display label of the owning actor (e.g. `"peer 3a"`), composed by the pane.
    pub owner_label: String,
    /// The contended work symbol (the owner's claim label).
    pub symbol: String,
    /// The 1-based inclusive line span the owner holds.
    pub region: (u32, u32),
}

impl GatedRegion {
    /// A gated chip is [`Tone::Gated`] — the reserved muted-warning path (not the
    /// louder [`Tone::Conflicted`] band; no parallel color path is added).
    pub fn tone(&self) -> Tone {
        Tone::Gated
    }

    /// The typed refusal message — [`guard_message`], naming only [`GATED_ACTIONS`].
    pub fn message(&self) -> String {
        guard_message(&self.owner_label, &self.symbol)
    }

    /// The operator nudge for this gated region.
    pub fn nudge(&self) -> PdNudge {
        PdNudge::gated(&self.owner_label, &self.symbol)
    }
}

/// The guard's decision for a region the local replica wants to edit (HARD RULE 6/7's
/// pure core; the pane's commit gate reads this). `Clear` to proceed; `Gated` when
/// another live claim holds the region — the contender negotiates or moves, and the
/// message NEVER advertises a bypass.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GuardVerdict {
    /// The region is free (unclaimed, or held only by the local replica) — proceed.
    Clear,
    /// The region is held by another live claim — refuse with a typed, bypass-free note.
    Gated(GatedRegion),
}

impl GuardVerdict {
    /// Does the guard refuse the edit? True only for [`GuardVerdict::Gated`].
    pub fn is_gated(&self) -> bool {
        matches!(self, GuardVerdict::Gated(_))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buffer::peer_id_for_identity;
    use crate::editor_claims::RegionClaim;

    fn region(peer_ident: &str, id: u32, start: u32, end: u32, label: &str, granted: u64) -> RegionClaim {
        RegionClaim::new(peer_id_for_identity(peer_ident), id, start, end, label, granted)
    }

    /// A region claim maps to the daemon's `{ filePath, symbolPath, type }` shape: the
    /// work label becomes the symbolPath, the intent is `modify`, and NO peer/backend
    /// identity leaks into the wire (agent-neutral — HARD RULE 4).
    #[test]
    fn region_claim_maps_to_the_daemon_symbol_claim_shape() {
        let claim = region("port-daddy:editor:agent-A", 0, 12, 40, "parse_header", 1);
        let sc = SymbolClaim::from_region("core/pd-console/src/mux.rs", &claim, ClaimKind::Modify);
        assert_eq!(sc.symbol_path, "parse_header", "the work label is the symbolPath");
        assert_eq!(sc.file_path, "core/pd-console/src/mux.rs");
        assert_eq!(sc.kind, ClaimKind::Modify);

        // Serialized, it matches the route's field names exactly (filePath/symbolPath/type)
        // and the type is the wire token — never a peer id or backend name.
        let v = serde_json::to_value(&sc).unwrap();
        assert_eq!(v["filePath"], "core/pd-console/src/mux.rs");
        assert_eq!(v["symbolPath"], "parse_header");
        assert_eq!(v["type"], "modify");
        assert!(v.get("peer").is_none(), "no authoring peer leaks to the daemon (agent-neutral)");
        assert_eq!(ClaimKind::Read.wire(), "read");
    }

    /// The predict request body is exactly `{ claimsA, claimsB }` with each element in
    /// the route's `{ filePath, symbolPath, type }` schema — a checked contract against
    /// routes/symbols.ts's validator without a live daemon.
    #[test]
    fn predict_request_body_matches_the_route_schema() {
        let path = "src/lib.rs";
        let a = [SymbolClaim::from_region(path, &region("id:a", 0, 1, 9, "parse_header", 1), ClaimKind::Modify)];
        let b = [SymbolClaim::from_region(path, &region("id:b", 0, 1, 9, "parse_header", 2), ClaimKind::Modify)];
        let body = predict_request_body(&a, &b);

        let ca = body["claimsA"].as_array().expect("claimsA is an array");
        let cb = body["claimsB"].as_array().expect("claimsB is an array");
        assert_eq!(ca.len(), 1);
        assert_eq!(cb.len(), 1);
        // The route's validateClaim requires exactly these three fields + a read|modify type.
        for c in ca.iter().chain(cb.iter()) {
            assert!(c["filePath"].is_string());
            assert!(c["symbolPath"].is_string());
            assert!(matches!(c["type"].as_str(), Some("read") | Some("modify")));
        }
    }

    /// The full route response `{ count, blocking, warnings, info }` parses field-for-field.
    #[test]
    fn parse_predict_response_reads_the_full_tally() {
        let v = serde_json::json!({
            "success": true, "count": 3, "blocking": 1, "warnings": 1, "info": 1,
            "conflicts": [{ "type": "direct", "severity": "blocking" }],
        });
        let r = parse_predict_response(&v);
        assert_eq!(r, ConflictReport { count: 3, blocking: 1, warnings: 1, info: 1 });
        assert!(r.is_blocking(), "blocking > 0 trips the guard");
        assert!(!r.is_quiet());
    }

    /// The early-return shape `{ success, conflicts: [], count: 0 }` OMITS
    /// blocking/warnings/info — a missing field must read as 0, never a parse failure.
    #[test]
    fn parse_predict_response_tolerates_the_empty_early_return_and_garbage() {
        let empty = serde_json::json!({ "success": true, "conflicts": [], "count": 0 });
        let r = parse_predict_response(&empty);
        assert!(r.is_quiet(), "an empty predict is quiet — no band, no nudge");
        assert!(!r.is_blocking());

        // An explicit failure body is treated as quiet (no false band on a 500).
        let failed = serde_json::json!({ "success": false, "error": "internal server error" });
        assert!(parse_predict_response(&failed).is_quiet(), "a failed predict raises no band");

        // Non-object / garbage → quiet (fails OPEN for the visibility band; the durable
        // commit gate is the fail-CLOSED seam, not this render band).
        assert!(parse_predict_response(&serde_json::json!("nonsense")).is_quiet());
        assert!(parse_predict_response(&serde_json::json!(null)).is_quiet());
    }

    /// THE HARD-RULE-2 GATE (module half): the probe fires ONLY when armed by a
    /// coordination edge, and a burst of edges collapses to ONE probe per window.
    /// Ticks that arm nothing (the stand-in for keystrokes/caret moves that neither
    /// acquire a claim nor enter a region) produce ZERO probes — the machine-checked
    /// "debounced, never per-keystroke". (The pane-level test drives real caret moves.)
    #[test]
    fn wedge_probe_fires_on_arm_and_coalesces_never_per_tick() {
        let mut probe = WedgeProbe::new(100); // ≤ 1 predict / 100ms

        // 500ms of idle ticks that arm nothing → not a single probe.
        let mut probes = 0usize;
        for tick in 0..500i64 {
            if probe.take_due(tick).is_some() {
                probes += 1;
            }
        }
        assert_eq!(probes, 0, "an unarmed probe never fires — no predict per keystroke/tick");
        assert!(!probe.is_armed());

        // A claim-acquire arms it once; the first due tick fires exactly one probe.
        probe.arm(region("id:a", 0, 12, 40, "parse_header", 1));
        assert!(probe.is_armed());
        let fired = probe.take_due(1_000).expect("an armed probe is due");
        assert_eq!(fired.label, "parse_header");
        assert!(!probe.is_armed(), "taking the probe disarms it");

        // A fast region drag: three rapid re-arms before the next window collapse to the
        // LATEST intent, and only one probe escapes the window.
        probe.arm(region("id:a", 0, 12, 30, "parse_header", 1));
        probe.arm(region("id:a", 0, 12, 35, "parse_header", 1));
        probe.arm(region("id:a", 0, 12, 40, "parse_header", 1));
        assert!(probe.take_due(1_050).is_none(), "suppressed inside the debounce window");
        let coalesced = probe.take_due(1_120).expect("the drag flushes once past the window");
        assert_eq!(coalesced.line_span(), (12, 40), "only the newest region intent is probed");
        // Nothing newly armed → silent.
        assert!(probe.take_due(2_000).is_none(), "no new edge → no probe");
    }

    /// THE HARD-RULE-3 GATE: the conflict band is a ONE-SHOT ease-in-out pulse then a
    /// static rest — it must NOT `repeat()`. We raise a band at t0, confirm it starts at
    /// rest, swells to a single crest mid-pulse, settles back to rest by PULSE_MS, and —
    /// the load-bearing assertion — STAYS at rest for 20 further pulse-durations AND at
    /// every mid-period offset. A `repeat()` animation would re-crest every period; this
    /// proves ours never does.
    #[test]
    fn conflict_band_pulse_is_one_shot_not_repeat() {
        let band = GuardBand::raised("parse_header", (12, 40), ConflictReport { count: 1, blocking: 1, ..Default::default() }, 1_000);
        assert_eq!(band.tone(), Tone::Conflicted);

        // Starts at rest (no jarring jump-in), crests once mid-pulse, back to rest at end.
        assert!((band.emphasis(1_000, false) - REST_EMPHASIS).abs() < 1e-4, "band starts at rest");
        let crest = band.emphasis(1_000 + PULSE_MS / 2, false);
        assert!((crest - PEAK_EMPHASIS).abs() < 1e-3, "the single crest reaches peak at mid-pulse");
        assert!(crest > REST_EMPHASIS + 0.2, "the crest is a real, visible swell above rest");
        assert!(band.pulse_done(1_000 + PULSE_MS), "the pulse is finished one duration in");

        // THE NON-REPEAT PROOF: at every whole pulse-duration AND every half-period
        // offset for 20 periods, emphasis is exactly rest — never a second crest.
        for k in 1..=20i64 {
            let at_period = band.emphasis(1_000 + k * PULSE_MS, false);
            assert!((at_period - REST_EMPHASIS).abs() < 1e-4, "no re-crest at period {k} (would fail if repeat())");
            let mid_later_period = band.emphasis(1_000 + k * PULSE_MS + PULSE_MS / 2, false);
            assert!((mid_later_period - REST_EMPHASIS).abs() < 1e-4, "no crest mid-period {k} (a repeat() would peak here)");
        }
        // Far in the future it is still just resting.
        assert!((band.emphasis(1_000 + 10_000 * PULSE_MS, false) - REST_EMPHASIS).abs() < 1e-4);
        // A now before the raise (clock skew) clamps to rest, never negative/NaN.
        assert!((band.emphasis(500, false) - REST_EMPHASIS).abs() < 1e-4);
    }

    /// Reduced-motion safety (rust-gpui-motion): with reduced motion the band is shown
    /// at a constant rest emphasis — no swell at ANY time — so a motion-sensitive
    /// operator still sees the conflict, just without the animation.
    #[test]
    fn conflict_band_respects_reduced_motion() {
        let band = GuardBand::raised("io", (1, 3), ConflictReport { count: 1, blocking: 1, ..Default::default() }, 0);
        for t in [0i64, PULSE_MS / 4, PULSE_MS / 2, PULSE_MS, 5 * PULSE_MS] {
            assert!((band.emphasis(t, true) - REST_EMPHASIS).abs() < 1e-6, "reduced motion is constant rest at t={t}");
        }
        // The band is still visible (rest emphasis is high), not hidden.
        assert!(REST_EMPHASIS > 0.5, "a reduced-motion conflict band is still clearly shown");
    }

    /// THE HARD-RULE-5 GATE: a gated refusal names ONLY the correct actions (handoff /
    /// parley / another region) and NEVER a bypass flag. We scan the message against a
    /// tripwire list of bypass tokens and assert none appear, and that each sanctioned
    /// action IS named.
    #[test]
    fn gated_refusal_names_correct_actions_never_a_bypass() {
        let msg = guard_message("peer 3a", "parse_header");
        let lower = msg.to_lowercase();
        // Every sanctioned action is offered.
        for action in GATED_ACTIONS {
            assert!(msg.contains(action), "refusal must offer ‘{action}’");
        }
        // NO bypass token anywhere — the load-bearing invariant.
        for tok in BYPASS_TOKENS {
            assert!(!lower.contains(tok), "refusal must NEVER name a bypass (‘{tok}’ found): {msg}");
        }
        // It names the owner and the symbol so the contender knows whom to negotiate with.
        assert!(msg.contains("peer 3a") && msg.contains("parse_header"));

        // The gated chip and its nudge carry the same bypass-free wording + Tone::Gated.
        let gated = GatedRegion { owner_label: "peer 3a".into(), symbol: "parse_header".into(), region: (12, 40) };
        assert_eq!(gated.tone(), Tone::Gated);
        let nudge = gated.nudge();
        assert_eq!(nudge.tone, Tone::Gated);
        for tok in BYPASS_TOKENS {
            assert!(!nudge.detail.to_lowercase().contains(tok), "the gated nudge must not advertise ‘{tok}’");
        }
    }

    /// The blocking nudge (from a daemon-predicted conflict) is Tone::Conflicted, states
    /// the contradiction, points at negotiation — and, like every refusal, advertises no
    /// bypass. This is the "surface a pd-nudge, NOT a silent merge" proof.
    #[test]
    fn blocking_nudge_is_conflicted_and_bypass_free() {
        let report = ConflictReport { count: 2, blocking: 2, warnings: 0, info: 0 };
        let nudge = PdNudge::blocking("write_footer", report);
        assert_eq!(nudge.tone, Tone::Conflicted);
        assert!(nudge.headline.contains("write_footer"));
        assert!(nudge.detail.contains("2 blocking"), "the nudge states the daemon's blocking count");
        for tok in BYPASS_TOKENS {
            assert!(!nudge.detail.to_lowercase().contains(tok), "the blocking nudge must not advertise ‘{tok}’");
        }
    }

    /// The guard verdict is a typed refusal: `Clear` proceeds, `Gated` refuses (and is
    /// bypass-free). This is the pure core the pane's commit gate reads (HARD RULE 6/7).
    #[test]
    fn guard_verdict_is_a_typed_clear_or_gated() {
        let clear = GuardVerdict::Clear;
        assert!(!clear.is_gated());

        let gated = GuardVerdict::Gated(GatedRegion {
            owner_label: "peer 3a".into(),
            symbol: "parse_header".into(),
            region: (12, 40),
        });
        assert!(gated.is_gated());
        if let GuardVerdict::Gated(g) = &gated {
            assert_eq!(g.tone(), Tone::Gated);
            assert!(g.message().contains("handoff"));
        }
    }
}

