//! Harbor Editor **P3, slice 3: the commit gate** — the fail-CLOSED seam
//! (`pd guard check --staged` equivalent) that refuses a commit whose staged edit
//! reaches into a region held by ANOTHER live actor's claim.
//!
//! ## What this slice is (honest scope)
//! Slice 2's wedge is a *pre-write, fail-OPEN visibility* band (a daemon round-trip that,
//! if unreachable, degrades to "no known conflict" so the editor never wedges on a flaky
//! link). This module is its durable twin: the **fail-CLOSED** decision a commit must
//! pass. It reads the SAME in-Rust [`ClaimLedger`](crate::editor_claims::ClaimLedger)
//! (who owns which region, slice 1) and refuses when a staged hunk overlaps a region
//! whose first-granted, non-revoked owner is a *live other* actor (HARD RULE 7). The
//! refusal is a typed [`CommitGateVerdict::Refused`] reusing
//! [`editor_wedge::guard_message`](crate::editor_wedge::guard_message) — so the wording
//! (handoff / parley / another region, NEVER a `--force`/`--no-verify`/`--allow-*`
//! bypass, HARD RULE 5) is authored once and audited once.
//!
//! ## The invariants this module encodes (adversarial-verify targets)
//!   - **Region-scoped, never a file lock (HARD RULE 1).** The gate refuses a hunk only
//!     because it *overlaps a claimed span*; a hunk in an adjacent unclaimed region of the
//!     same file passes. Proven by `adjacent_region_edit_passes_the_gate`.
//!   - **Only LIVE actors block (HARD RULE 7).** A dead actor's stale durable claim is
//!     filtered by the injected `is_live` predicate, so it never wedges a commit forever —
//!     it clears on liveness, while the durable twin persists until an authorized
//!     release or future P3.5 claim-transfer transaction changes it.
//!   - **First-granted wins (HARD RULE 6).** The owner named is the earliest-granted live
//!     claim over the line; if THAT owner is me, I proceed even when a later claim overlaps.
//!   - **Typed refusal, no bypass (HARD RULE 5).** The message is `guard_message`; it names
//!     only the sanctioned actions and is scanned (in tests) against
//!     [`editor_wedge::BYPASS_TOKENS`](crate::editor_wedge::BYPASS_TOKENS).
//!
//! ## Data-structure discipline & where this runs
//! Pure and gpui-free: it folds the render-thread-owned [`ClaimLedger`] plus the staged
//! hunks (a `&[(u32, u32)]` of 1-based inclusive line spans) into a verdict, so it
//! unit-tests on Linux CI under `cargo test --bin pd-console-repl` with no `gpui`
//! feature. It is a ONE-SHOT commit-time check (not a render/per-frame path), so it may
//! walk the staged lines directly; the gates it emits are de-duplicated by the owning
//! `Copy` [`ClaimKey`](crate::editor_claims::ClaimKey) into a `BTreeMap` for a
//! deterministic, flicker-free refusal order.

use crate::buffer::PeerId;
use crate::editor_claims::{ClaimKey, ClaimLedger, RegionClaim};
use crate::editor_wedge::GatedRegion;
use std::collections::{BTreeMap, BTreeSet};

/// The commit gate's decision over a file's staged hunks. `Clear` → the commit may
/// proceed (every staged line is unclaimed, mine, or held only by dead actors); `Refused`
/// → one or more staged hunks reach into a live other actor's region — a typed,
/// bypass-free refusal carrying one [`GatedRegion`] per contended owner (HARD RULE 6/7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommitGateVerdict {
    /// Nothing staged contends with a live other actor's claim — proceed.
    Clear,
    /// At least one staged hunk overlaps a live other actor's claimed region. Each
    /// [`GatedRegion`] names the owner + symbol + span and yields the typed
    /// [`guard_message`](crate::editor_wedge::guard_message) refusal (no bypass).
    Refused(Vec<GatedRegion>),
}

impl CommitGateVerdict {
    /// Does the gate refuse the commit? True only for [`CommitGateVerdict::Refused`].
    pub fn is_refused(&self) -> bool {
        matches!(self, CommitGateVerdict::Refused(_))
    }

    /// May the commit proceed?
    pub fn is_clear(&self) -> bool {
        matches!(self, CommitGateVerdict::Clear)
    }

    /// The gated regions (empty when clear).
    pub fn refusals(&self) -> &[GatedRegion] {
        match self {
            CommitGateVerdict::Clear => &[],
            CommitGateVerdict::Refused(rs) => rs,
        }
    }

    /// The joined, human-facing refusal — each contended region's typed
    /// [`GatedRegion::message`], one per line. `None` when the gate is clear. Every line
    /// names only the sanctioned actions and never a bypass flag (it IS `guard_message`).
    pub fn refusal_message(&self) -> Option<String> {
        match self {
            CommitGateVerdict::Clear => None,
            CommitGateVerdict::Refused(rs) => Some(
                rs.iter().map(|r| r.message()).collect::<Vec<_>>().join("\n"),
            ),
        }
    }
}

/// The **first-granted, non-revoked, LIVE** owner covering 1-based line `n` — HARD RULE
/// 6's contention winner restricted to actors the `is_live` predicate accepts. Mirrors
/// [`ClaimLedger::first_granted_owner_of_line`] but drops claims whose peer is not live,
/// so a dead actor's stranded claim never wins (and so never gates a commit). Ties break
/// on the `Copy` [`ClaimKey`] for determinism. Identity-blind: it orders on grant time,
/// never on who or which backend holds the claim.
fn first_granted_live_owner<'a>(
    ledger: &'a ClaimLedger,
    n: u32,
    is_live: &dyn Fn(PeerId) -> bool,
) -> Option<&'a RegionClaim> {
    ledger
        .iter()
        .map(|(_, c)| c)
        .filter(|c| c.covers(n) && is_live(c.peer))
        .min_by_key(|c| (c.granted_at, c.key()))
}

/// Every distinct 1-based line touched by the staged hunks, in ascending order. A hunk
/// is a `(start, end)` 1-based inclusive span; it is read low→high so an inverted pair is
/// tolerated (never an empty or reversed loop). De-duplicated so overlapping hunks cost
/// each line once.
fn staged_lines(hunks: &[(u32, u32)]) -> BTreeSet<u32> {
    let mut lines = BTreeSet::new();
    for &(a, b) in hunks {
        let (lo, hi) = (a.min(b), a.max(b));
        for line in lo..=hi {
            lines.insert(line);
        }
    }
    lines
}

/// The commit gate (HARD RULE 6/7): given a file's live-claim [`ClaimLedger`], the
/// **staged** hunks the commit would write (`hunks`, 1-based inclusive spans), the local
/// actor `me`, a liveness predicate `is_live`, and an owner-labeler `label_of`, decide
/// whether the commit may land.
///
/// It is [`CommitGateVerdict::Clear`] when every staged line is unclaimed, first-owned by
/// `me`, or held only by dead actors; it is [`CommitGateVerdict::Refused`] — a typed,
/// bypass-free refusal — when a staged line's first-granted LIVE owner is another actor.
/// Region-scoped by construction: a hunk gates only because it overlaps a *claimed span*,
/// so an adjacent unclaimed hunk of the same file always clears (HARD RULE 1). The
/// refusals are one [`GatedRegion`] per contended owning claim (de-duplicated by the
/// owner's `Copy` [`ClaimKey`]), each naming the owner + symbol + the owner's full span.
///
/// This is a one-shot commit-time check off the render path, so walking the staged lines
/// directly (rather than an interval sweep) is the simplest correct thing; the emitted
/// gates are keyed by `ClaimKey` for a deterministic refusal order.
pub fn check_staged_regions(
    ledger: &ClaimLedger,
    hunks: &[(u32, u32)],
    me: PeerId,
    is_live: impl Fn(PeerId) -> bool,
    label_of: impl Fn(PeerId) -> String,
) -> CommitGateVerdict {
    let is_live: &dyn Fn(PeerId) -> bool = &is_live;
    // Distinct owning claims that gate the commit, keyed by their Copy ClaimKey for a
    // deterministic, de-duplicated refusal order (one GatedRegion per contended owner,
    // not one per line).
    let mut gates: BTreeMap<ClaimKey, GatedRegion> = BTreeMap::new();
    for line in staged_lines(hunks) {
        let Some(owner) = first_granted_live_owner(ledger, line, is_live) else {
            continue; // the line is free (or held only by dead actors) — no gate
        };
        if owner.peer == me {
            continue; // I hold the first-granted claim over this line — I proceed
        }
        gates.entry(owner.key()).or_insert_with(|| GatedRegion {
            owner_label: label_of(owner.peer),
            symbol: owner.label.clone(),
            region: owner.line_span(),
        });
    }
    if gates.is_empty() {
        CommitGateVerdict::Clear
    } else {
        CommitGateVerdict::Refused(gates.into_values().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buffer::peer_id_for_identity;
    use crate::editor_wedge::BYPASS_TOKENS;

    fn ledger_with(claims: Vec<RegionClaim>) -> ClaimLedger {
        let mut l = ClaimLedger::new();
        for c in claims {
            l.upsert(c);
        }
        l
    }

    /// A simple owner-labeler: "peer <id>". The gate is identity-blind; the label is only
    /// for the human-facing refusal, never a branch input.
    fn label(peer: PeerId) -> String {
        format!("peer {peer}")
    }

    /// THE P3 SLICE-3 COMMIT-GATE PROOF — a staged edit that reaches INTO another LIVE
    /// actor's claimed region is refused (HARD RULE 7). A owns parse_header (L12–40); B
    /// stages a hunk at L20–25 (inside A's region) and the gate refuses, naming A + the
    /// symbol, with a typed message that advertises NO bypass (HARD RULE 5).
    #[test]
    fn out_of_claim_edit_against_a_live_actor_is_refused() {
        let a = peer_id_for_identity("port-daddy:editor:agent-A");
        let b = peer_id_for_identity("port-daddy:editor:agent-B");
        let ledger = ledger_with(vec![RegionClaim::new(a, 0, 12, 40, "parse_header", 100)]);

        // B stages an edit at lines 20–25 — inside A's live region.
        let verdict = check_staged_regions(&ledger, &[(20, 25)], b, |_| true, label);
        assert!(verdict.is_refused(), "editing into A's live region is refused");
        let refusals = verdict.refusals();
        assert_eq!(refusals.len(), 1, "exactly one contended region");
        assert_eq!(refusals[0].symbol, "parse_header");
        assert_eq!(refusals[0].region, (12, 40), "the refusal names A's full span");
        assert_eq!(refusals[0].owner_label, label(a), "the refusal names the owner A");

        // The refusal message names only the sanctioned actions and NEVER a bypass flag.
        let msg = verdict.refusal_message().expect("a refused commit has a message");
        let lower = msg.to_lowercase();
        for action in ["request a handoff", "open a parley", "pick another region"] {
            assert!(msg.contains(action), "refusal must offer ‘{action}’");
        }
        for tok in BYPASS_TOKENS {
            assert!(!lower.contains(tok), "commit-gate refusal must NEVER name a bypass (‘{tok}’): {msg}");
        }
    }

    /// HARD RULE 1: the gate is REGION-scoped, not a file lock. B stages an edit in an
    /// adjacent UNCLAIMED region (L200–260) of the same file A partly holds — it clears.
    #[test]
    fn adjacent_region_edit_passes_the_gate() {
        let a = peer_id_for_identity("port-daddy:editor:agent-A");
        let b = peer_id_for_identity("port-daddy:editor:agent-B");
        let ledger = ledger_with(vec![RegionClaim::new(a, 0, 12, 40, "parse_header", 1)]);

        // A hunk entirely below A's span, plus the boundary lines just outside it.
        assert!(check_staged_regions(&ledger, &[(200, 260)], b, |_| true, label).is_clear());
        assert!(check_staged_regions(&ledger, &[(1, 11)], b, |_| true, label).is_clear(), "the line above A's span is free");
        assert!(check_staged_regions(&ledger, &[(41, 60)], b, |_| true, label).is_clear(), "the line below A's span is free");
        // A hunk that only clips the edge (L40) IS refused — it overlaps.
        assert!(check_staged_regions(&ledger, &[(40, 45)], b, |_| true, label).is_refused(), "clipping the last claimed line still contends");
    }

    /// HARD RULE 7: only LIVE actors block. A's claim is present but A is reported DEAD by
    /// the liveness predicate, so B's overlapping edit clears (the stale durable claim does
    /// not wedge the commit forever).
    #[test]
    fn a_dead_actors_stale_claim_does_not_gate() {
        let a = peer_id_for_identity("port-daddy:editor:agent-A");
        let b = peer_id_for_identity("port-daddy:editor:agent-B");
        let ledger = ledger_with(vec![RegionClaim::new(a, 0, 12, 40, "parse_header", 1)]);
        // A is dead → not live; B's edit into A's old region clears.
        let is_live = |p: PeerId| p != a;
        assert!(check_staged_regions(&ledger, &[(20, 25)], b, is_live, label).is_clear());
        // But if A is live, the same edit is refused — the predicate is what gates.
        assert!(check_staged_regions(&ledger, &[(20, 25)], b, |_| true, label).is_refused());
    }

    /// HARD RULE 6: the first-granted live claim wins. A (granted seq 3) and B (granted
    /// seq 9) overlap; C staging into the overlap is told A holds it (the earlier grant).
    #[test]
    fn first_granted_owner_is_named_on_contention() {
        let a = peer_id_for_identity("port-daddy:editor:agent-A");
        let b = peer_id_for_identity("port-daddy:editor:agent-B");
        let c = peer_id_for_identity("port-daddy:editor:agent-C");
        let ledger = ledger_with(vec![
            RegionClaim::new(b, 0, 18, 30, "b_work", 9),
            RegionClaim::new(a, 0, 20, 40, "a_work", 3),
        ]);
        let verdict = check_staged_regions(&ledger, &[(22, 24)], c, |_| true, label);
        assert!(verdict.is_refused());
        assert_eq!(verdict.refusals()[0].owner_label, label(a), "the earlier-granted A is named");
        assert_eq!(verdict.refusals()[0].symbol, "a_work");
    }

    /// The first-granted owner editing its OWN region proceeds, even when a later claim by
    /// another actor overlaps — I win the line I granted first (HARD RULE 6).
    #[test]
    fn first_granted_owner_edits_its_own_region_freely() {
        let a = peer_id_for_identity("port-daddy:editor:agent-A");
        let b = peer_id_for_identity("port-daddy:editor:agent-B");
        let ledger = ledger_with(vec![
            RegionClaim::new(a, 0, 20, 40, "a_work", 3), // A granted first
            RegionClaim::new(b, 0, 18, 30, "b_work", 9), // B granted later, overlapping
        ]);
        // A stages into the shared lines 22–24: A is first-granted, so A proceeds.
        assert!(check_staged_regions(&ledger, &[(22, 24)], a, |_| true, label).is_clear());
        // B staging into the same overlap is refused (A holds it).
        assert!(check_staged_regions(&ledger, &[(22, 24)], b, |_| true, label).is_refused());
    }

    /// A commit staging into TWO different live actors' regions yields one refusal per
    /// contended owner, de-duplicated and in deterministic ClaimKey order.
    #[test]
    fn multiple_contended_owners_each_named_once() {
        let a = peer_id_for_identity("port-daddy:editor:agent-A");
        let b = peer_id_for_identity("port-daddy:editor:agent-B");
        let me = peer_id_for_identity("port-daddy:editor:agent-Z");
        let ledger = ledger_with(vec![
            RegionClaim::new(a, 0, 12, 40, "parse_header", 1),
            RegionClaim::new(b, 0, 200, 260, "write_footer", 2),
        ]);
        // A big staged span crossing BOTH claimed regions (and the free gap between).
        let verdict = check_staged_regions(&ledger, &[(30, 210)], me, |_| true, label);
        assert!(verdict.is_refused());
        assert_eq!(verdict.refusals().len(), 2, "one refusal per contended owner, de-duplicated");
        // Both symbols are named across the joined message.
        let msg = verdict.refusal_message().unwrap();
        assert!(msg.contains("parse_header") && msg.contains("write_footer"));
    }

    /// An empty ledger, an empty staged set, and a self-only ledger all clear — the gate
    /// blocks nothing when there is no live contention.
    #[test]
    fn no_contention_clears() {
        let me = peer_id_for_identity("port-daddy:editor:agent-Z");
        assert!(check_staged_regions(&ClaimLedger::new(), &[(1, 100)], me, |_| true, label).is_clear());
        let ledger = ledger_with(vec![RegionClaim::new(me, 0, 12, 40, "mine", 1)]);
        assert!(check_staged_regions(&ledger, &[], me, |_| true, label).is_clear(), "nothing staged clears");
        assert!(check_staged_regions(&ledger, &[(20, 25)], me, |_| true, label).is_clear(), "my own region clears");
        assert!(check_staged_regions(&ledger, &[(20, 25)], me, |_| true, label).refusal_message().is_none());
    }
}
