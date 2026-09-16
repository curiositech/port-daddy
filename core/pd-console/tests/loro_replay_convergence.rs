//! P3.5 salvage foundation — **property tests on Loro op-replay convergence**.
//!
//! The battle plan (docs/strategy/harbor-editor-battle-plan.md §6) names the risk:
//! "Replaying a dead replica's op-log onto a doc that advanced after its death must
//! converge deterministically — needs property tests on Loro op-replay ordering,
//! not a happy-path demo." This file is that property suite. TESTS ONLY — it ships
//! no salvage feature; it pins the CRDT semantics the salvage path will lean on,
//! against the exact export/import surface the editor already uses:
//!
//!   - `HarborBuffer::export_ops`      == `doc.export(ExportMode::all_updates())`
//!   - `HarborBuffer::export_snapshot` == `doc.export(ExportMode::snapshot())`
//!   - `HarborBuffer::apply_remote_ops`== `doc.import(bytes)`
//!   - incremental deltas ride `editor_sync::OpLog` via `encode_oplog_note` /
//!     `decode_oplog_note` / `OpLog::replay_into` — the real durable-op-log path.
//!
//! ## The modelled salvage scenario
//! Replica A and replica B fork from a common seeded doc. A keeps editing and then
//! "dies" — all that survives is its exported op-log (wholesale `all_updates`, its
//! per-op incremental `updates(since_vv)` chunks, and a compacted snapshot). B — the
//! live doc — advances with more edits AFTER A's death. Then A's log is replayed
//! onto B (and onto fresh salvage successors). Four properties must hold:
//!
//!   a. CONVERGENCE      — importing A's log into advanced-B and B's log into A
//!                         yield byte-identical text (bidirectional merge equality).
//!   b. ORDER-INDEPENDENCE — any interleaving of A's chunks with B's chunks lands
//!                         on the identical final state.
//!   c. IDEMPOTENCE      — re-importing A's op-log a second time changes nothing
//!                         (content AND state version vector).
//!   d. CHUNKED == WHOLESALE — replaying A as many incremental deltas (through the
//!                         real `OpLog` note codec) == importing A's single
//!                         wholesale export == importing A's snapshot.
//!
//! ## Why raw `LoroDoc` appears next to `HarborBuffer`
//! `HarborBuffer` exposes authored *inserts* only (no delete yet — live editing is
//! a later slice), but a real salvage log contains deletions. So the edit-script
//! driver is a thin `Replica` harness over `LoroDoc` that mirrors buffer.rs
//! byte-for-byte where it matters: same `peer_id_for_identity` PeerID mint, same
//! `"content"` `LoroText` container, same `ExportMode` calls. Salvage *successors*
//! then import through the real `HarborBuffer::apply_remote_ops`, so the public
//! surface is exercised on the consuming side.
//!
//! ## Determinism
//! proptest's failure persistence is left ON (default): any failing case writes its
//! seed to `tests/loro_replay_convergence.proptest-regressions`, which replays
//! deterministically forever after — commit that file if a failure is ever found.
//! Case counts are CI-sane (64 per property; 4 properties).
//!
//! This target follows the house `#[path]` re-hosting convention (see
//! `ledger_unit.rs`): pd-console has no lib target, so the gpui-free module chain
//! is compiled directly into this integration binary. Re-hosting `buffer.rs` and
//! `editor_sync.rs` also runs their inline unit tests here — harmless duplication,
//! same as the other `_unit` targets.

#[path = "../src/buffer.rs"]
mod buffer;
#[path = "../src/editor_sync.rs"]
mod editor_sync;

use buffer::{peer_id_for_identity, HarborBuffer, HistoryAction, PeerId};
use editor_sync::{
    apply_frame, channel_for_path, decode_frame, decode_oplog_note, encode_frame,
    encode_oplog_note, OpLog,
};
use loro::{ExportMode, LoroDoc, VersionVector};
use proptest::prelude::*;

// ── The edit-script model ─────────────────────────────────────────────────────

/// One random edit. Positions/lengths are raw seeds, clamped against the doc's
/// *current* length at apply time (so every generated script is valid on any doc
/// state — no rejection, no shrink explosions).
#[derive(Debug, Clone)]
enum EditOp {
    Insert { pos_seed: usize, text: String },
    Delete { pos_seed: usize, len_seed: usize },
}

/// Strategy for one edit op. Insert text mixes ASCII, Greek, CJK, an astral-plane
/// emoji, spaces and newlines — Unicode-position bugs (code-point vs byte vs UTF-16
/// indexing) are exactly where replay ordering would silently diverge.
fn edit_op() -> impl Strategy<Value = EditOp> {
    let unicode_text = prop::collection::vec(
        prop_oneof![
            prop::char::range('a', 'z'),
            prop::char::range('α', 'ω'),
            Just('日'),
            Just('本'),
            Just('🦀'),
            Just('\n'),
            Just(' '),
        ],
        1..=6,
    )
    .prop_map(|cs| cs.into_iter().collect::<String>());
    prop_oneof![
        // Weighted toward inserts so docs grow enough for deletes to bite.
        3 => (any::<usize>(), unicode_text)
            .prop_map(|(pos_seed, text)| EditOp::Insert { pos_seed, text }),
        2 => (any::<usize>(), any::<usize>())
            .prop_map(|(pos_seed, len_seed)| EditOp::Delete { pos_seed, len_seed }),
    ]
}

/// A random edit script of 1..=max ops.
fn edit_script(max: usize) -> impl Strategy<Value = Vec<EditOp>> {
    prop::collection::vec(edit_op(), 1..=max)
}

// ── The replica harness (mirrors buffer.rs's Loro usage exactly) ──────────────

/// Loro container name — MUST match buffer.rs's `TEXT_CONTAINER` (private const),
/// asserted equivalent by property (d): `HarborBuffer` successors only see this
/// harness's ops because both address the same `"content"` `LoroText`.
const TEXT_CONTAINER: &str = "content";

/// A scripted Loro replica. Same PeerID mint and export calls as `HarborBuffer`;
/// additionally records the per-op incremental update chunk (the op-log deltas a
/// dead replica leaves behind for salvage).
struct Replica {
    doc: LoroDoc,
    peer: PeerId,
    /// Version vector at the last chunk export — `updates(since)` cursor.
    last_export_vv: VersionVector,
    /// The incremental op-log: one `ExportMode::updates(since_vv)` blob per edit.
    chunks: Vec<Vec<u8>>,
}

impl Replica {
    fn new(identity: &str) -> Self {
        let peer = peer_id_for_identity(identity);
        let doc = LoroDoc::new();
        // Same discipline as HarborBuffer::empty — peer id set before any op.
        doc.set_peer_id(peer).expect("set_peer_id on a fresh doc");
        let last_export_vv = doc.oplog_vv();
        Self {
            doc,
            peer,
            last_export_vv,
            chunks: Vec::new(),
        }
    }

    /// Apply one scripted edit, commit, and record its incremental delta chunk.
    fn apply(&mut self, op: &EditOp) {
        let text = self.doc.get_text(TEXT_CONTAINER);
        let len = text.len_unicode();
        match op {
            EditOp::Insert { pos_seed, text: s } => {
                let pos = if len == 0 { 0 } else { pos_seed % (len + 1) };
                text.insert(pos, s).expect("scripted insert is in-bounds");
            }
            EditOp::Delete { pos_seed, len_seed } => {
                if len == 0 {
                    return; // nothing to delete; no delta chunk either
                }
                let pos = pos_seed % len;
                let max_del = len - pos; // >= 1 because pos < len
                let dlen = 1 + len_seed % max_del;
                text.delete(pos, dlen)
                    .expect("scripted delete is in-bounds");
            }
        }
        self.doc.commit();
        // The incremental delta since the previous export — what the durable
        // op-log (`editor_sync::OpLog`) stores per edit.
        let chunk = self
            .doc
            .export(ExportMode::updates(&self.last_export_vv))
            .expect("export incremental updates");
        self.last_export_vv = self.doc.oplog_vv();
        if !chunk.is_empty() {
            self.chunks.push(chunk);
        }
    }

    fn apply_script(&mut self, script: &[EditOp]) {
        for op in script {
            self.apply(op);
        }
    }

    /// Wholesale op-log — mirrors `HarborBuffer::export_ops`.
    fn export_all_updates(&self) -> Vec<u8> {
        self.doc.commit();
        self.doc
            .export(ExportMode::all_updates())
            .expect("export all updates")
    }

    /// Compacted snapshot — mirrors `HarborBuffer::export_snapshot`.
    fn export_snapshot(&self) -> Vec<u8> {
        self.doc.commit();
        self.doc
            .export(ExportMode::snapshot())
            .expect("export snapshot")
    }

    /// Import — mirrors `HarborBuffer::apply_remote_ops`.
    fn import(&self, bytes: &[u8]) {
        self.doc.import(bytes).expect("import a valid Loro blob");
        self.doc.commit();
    }

    fn content(&self) -> String {
        self.doc.get_text(TEXT_CONTAINER).to_string()
    }

    /// State stamp — mirrors `HarborBuffer::change_stamp` (encoded state vv).
    fn change_stamp(&self) -> Vec<u8> {
        self.doc.state_vv().encode()
    }
}

/// Build the salvage fork: A seeds a common base, B joins from A's export, then A
/// applies its dying edits and B advances independently after A's "death".
fn fork(seed: &[EditOp], a_script: &[EditOp], b_script: &[EditOp]) -> (Replica, Replica) {
    let mut a = Replica::new("port-daddy:editor:dead-agent-A");
    a.apply_script(seed);
    let base = a.export_all_updates();
    let mut b = Replica::new("port-daddy:console:live-operator-B");
    b.import(&base);
    a.apply_script(a_script); // A's final ops before it dies
    b.apply_script(b_script); // B advances AFTER A's death
    (a, b)
}

#[test]
fn peer_local_undo_redo_frames_preserve_intervening_peer_edits_and_replay_idempotently() {
    let a = HarborBuffer::empty("port-daddy:console:foreground-A");
    a.replace_authored(0..0, "core");
    let b = HarborBuffer::empty("port-daddy:editor:peer-B");
    b.apply_remote_ops(&a.export_ops())
        .expect("B joins seeded A");

    let a_edit = a.replace_authored(0..0, "A-");
    let a_frame = encode_frame(a.local_peer(), &a_edit.delta);
    apply_frame(&b, &decode_frame(&a_frame).expect("A edit frame")).expect("B imports A edit");

    let b_end = b.to_string().chars().count();
    let b_edit = b.replace_authored(b_end..b_end, "-B");
    let b_frame = encode_frame(b.local_peer(), &b_edit.delta);
    apply_frame(&a, &decode_frame(&b_frame).expect("B edit frame")).expect("A imports B edit");
    assert_eq!(a.to_string(), "A-core-B");

    let undo = a
        .apply_history_governed(HistoryAction::Undo, |_, _| Ok(()))
        .expect("A undo succeeds")
        .expect("A has a local edit to undo");
    assert_eq!(a.to_string(), "core-B", "A undo preserves B's suffix");
    let undo_frame = encode_frame(a.local_peer(), &undo.delta);
    let decoded_undo = decode_frame(&undo_frame).expect("undo is an ordinary update frame");
    apply_frame(&b, &decoded_undo).expect("B imports A undo");
    assert_eq!(b.to_string(), a.to_string(), "undo frame converges");

    let stamp_after_undo = b.change_stamp();
    apply_frame(&b, &decoded_undo).expect("undo frame can be replayed");
    assert_eq!(
        b.change_stamp(),
        stamp_after_undo,
        "undo replay is idempotent"
    );

    let later_end = b.to_string().chars().count();
    let later_b = b.replace_authored(later_end..later_end, "-later");
    apply_frame(
        &a,
        &decode_frame(&encode_frame(b.local_peer(), &later_b.delta)).expect("later B frame"),
    )
    .expect("A imports intervening B edit");
    assert!(a.can_redo(), "peer imports do not clear A's redo stack");

    let redo = a
        .apply_history_governed(HistoryAction::Redo, |_, _| Ok(()))
        .expect("A redo succeeds")
        .expect("A still has redo history");
    assert!(a.to_string().contains("A-"), "redo restores A's edit");
    assert!(
        a.to_string().contains("-B-later"),
        "redo preserves both B edits"
    );
    let redo_frame = encode_frame(a.local_peer(), &redo.delta);
    let decoded_redo = decode_frame(&redo_frame).expect("redo is an ordinary update frame");
    apply_frame(&b, &decoded_redo).expect("B imports A redo");
    assert_eq!(b.to_string(), a.to_string(), "redo frame converges");

    let stamp_after_redo = b.change_stamp();
    apply_frame(&b, &decoded_redo).expect("redo frame can be replayed");
    assert_eq!(
        b.change_stamp(),
        stamp_after_redo,
        "redo replay is idempotent"
    );
}

#[test]
fn history_frames_preserve_remote_replacement_inside_local_span_across_repeated_cycles() {
    let a = HarborBuffer::empty("port-daddy:console:interior-frame-A");
    a.replace_authored(0..0, "ABC\n");
    let b = HarborBuffer::empty("port-daddy:editor:interior-frame-B");
    b.apply_remote_ops(&a.export_ops()).expect("B joins A");

    let remote = b.replace_authored(1..2, "X");
    let remote_frame = encode_frame(b.local_peer(), &remote.delta);
    apply_frame(
        &a,
        &decode_frame(&remote_frame).expect("remote interior frame"),
    )
    .expect("A imports B replacement");
    assert_eq!(a.to_string(), "AXC\n");

    for cycle in 0..3 {
        let undo = a
            .apply_history_governed(HistoryAction::Undo, |_, _| Ok(()))
            .expect("governed interior undo")
            .expect("effective interior undo");
        assert_eq!(a.to_string(), "X", "undo cycle {cycle} preserves B");
        let undo_frame = encode_frame(a.local_peer(), &undo.delta);
        let decoded_undo = decode_frame(&undo_frame).expect("ordinary undo frame");
        apply_frame(&b, &decoded_undo).expect("B imports interior undo");
        assert_eq!(b.to_string(), a.to_string());
        let stamp = b.change_stamp();
        apply_frame(&b, &decoded_undo).expect("undo frame reimport");
        assert_eq!(b.change_stamp(), stamp, "undo cycle {cycle} is idempotent");

        let redo = a
            .apply_history_governed(HistoryAction::Redo, |_, _| Ok(()))
            .expect("governed interior redo")
            .expect("effective interior redo");
        assert_eq!(a.to_string(), "AXC\n", "redo cycle {cycle} preserves B");
        let redo_frame = encode_frame(a.local_peer(), &redo.delta);
        let decoded_redo = decode_frame(&redo_frame).expect("ordinary redo frame");
        apply_frame(&b, &decoded_redo).expect("B imports interior redo");
        assert_eq!(b.to_string(), a.to_string());
        let stamp = b.change_stamp();
        apply_frame(&b, &decoded_redo).expect("redo frame reimport");
        assert_eq!(b.change_stamp(), stamp, "redo cycle {cycle} is idempotent");
    }
}

#[test]
fn multi_pop_history_frame_contains_the_one_effective_loro_update() {
    let a = HarborBuffer::empty("port-daddy:console:multi-pop-frame-A");
    a.replace_authored(0..0, "OLD-");
    a.replace_authored(4..4, "TOP-");
    let b = HarborBuffer::empty("port-daddy:editor:multi-pop-frame-B");
    b.apply_remote_ops(&a.export_ops()).expect("B joins A");

    let neutralize_top = b.replace_authored(4..8, "");
    a.apply_remote_ops(&neutralize_top.delta)
        .expect("A imports neutralizing remote deletion");
    assert_eq!(a.to_string(), "OLD-");

    let undo = a
        .apply_history_governed(HistoryAction::Undo, |_, _| Ok(()))
        .expect("multi-pop undo succeeds")
        .expect("older item is effective");
    assert_eq!((a.undo_count(), a.redo_count()), (0, 1));
    assert_eq!(a.to_string(), "");
    let frame = encode_frame(a.local_peer(), &undo.delta);
    let decoded = decode_frame(&frame).expect("multi-pop undo is an ordinary frame");
    apply_frame(&b, &decoded).expect("B imports the effective undo update");
    assert_eq!(b.to_string(), a.to_string());
    let stamp = b.change_stamp();
    apply_frame(&b, &decoded).expect("multi-pop undo frame reimports");
    assert_eq!(b.change_stamp(), stamp);

    let redo = a
        .apply_history_governed(HistoryAction::Redo, |_, _| Ok(()))
        .expect("reconciled redo succeeds")
        .expect("older redo is effective");
    let frame = encode_frame(a.local_peer(), &redo.delta);
    apply_frame(
        &b,
        &decode_frame(&frame).expect("ordinary reconciled redo frame"),
    )
    .expect("B imports reconciled redo");
    assert_eq!(b.to_string(), a.to_string());
}

// ── The four salvage properties ───────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// (a) CONVERGENCE — bidirectional merge equality. Replaying dead-A's op-log
    /// onto advanced-B yields exactly the text that replaying B's log onto A does.
    #[test]
    fn a_convergence_bidirectional_merge_equality(
        seed in edit_script(6),
        a_script in edit_script(10),
        b_script in edit_script(10),
    ) {
        let (a, b) = fork(&seed, &a_script, &b_script);
        let a_log = a.export_all_updates();
        let b_log = b.export_all_updates();

        b.import(&a_log); // salvage direction: dead replica's log → live doc
        a.import(&b_log); // mirror direction

        prop_assert_eq!(
            a.content(),
            b.content(),
            "A⇐B and B⇐A must converge to identical text"
        );
        prop_assert_eq!(
            a.change_stamp(),
            b.change_stamp(),
            "converged replicas must agree on the state version vector"
        );
    }

    /// (b) ORDER-INDEPENDENCE — importing A's delta chunks in ANY interleaving
    /// with B's chunks produces the identical final state. Successors import via
    /// the real `HarborBuffer::apply_remote_ops`. Loro must hold out-of-order
    /// deltas as pending and apply them once causal deps arrive.
    #[test]
    fn b_order_independence_of_chunk_interleavings(
        seed in edit_script(4),
        a_script in edit_script(8),
        b_script in edit_script(8),
        picks in prop::collection::vec(any::<bool>(), 16),
    ) {
        let (a, b) = fork(&seed, &a_script, &b_script);
        let base = {
            // The common ancestor both successors start from (fork-time state).
            let mut common = Replica::new("port-daddy:editor:dead-agent-A");
            common.apply_script(&seed);
            common.export_all_updates()
        };

        // Interleave A's and B's chunk streams by the random pick pattern; the
        // mirrored successor uses the negated pattern (a genuinely different order).
        let interleave = |flip: bool| -> Vec<&Vec<u8>> {
            let (mut ai, mut bi) = (a.chunks.iter(), b.chunks.iter());
            let mut out: Vec<&Vec<u8>> = Vec::new();
            for &p in &picks {
                match if p != flip { ai.next() } else { bi.next() } {
                    Some(c) => out.push(c),
                    None => {}
                }
            }
            out.extend(ai);
            out.extend(bi);
            out
        };

        let mut finals: Vec<String> = Vec::new();
        for flip in [false, true] {
            let successor = HarborBuffer::empty("port-daddy:console:salvage-successor");
            successor.apply_remote_ops(&base).expect("base imports");
            for chunk in interleave(flip) {
                successor
                    .apply_remote_ops(chunk)
                    .expect("a delta chunk imports (possibly pending) without error");
            }
            finals.push(successor.to_string());
        }

        // Reference: wholesale logs in one order.
        let reference = HarborBuffer::empty("port-daddy:console:salvage-reference");
        reference.apply_remote_ops(&b.export_all_updates()).expect("B log imports");
        reference.apply_remote_ops(&a.export_all_updates()).expect("A log imports");

        prop_assert_eq!(
            &finals[0], &finals[1],
            "two different chunk interleavings must converge identically"
        );
        prop_assert_eq!(
            &finals[0], &reference.to_string(),
            "interleaved chunk replay must equal wholesale import"
        );
    }

    /// (c) IDEMPOTENCE — re-importing A's op-log a second time (wholesale AND
    /// every chunk) changes neither the text nor the state version vector.
    #[test]
    fn c_reimporting_the_dead_op_log_is_idempotent(
        seed in edit_script(4),
        a_script in edit_script(10),
        b_script in edit_script(10),
    ) {
        let (a, b) = fork(&seed, &a_script, &b_script);
        let a_log = a.export_all_updates();

        b.import(&a_log); // first salvage replay
        let text_once = b.content();
        let stamp_once = b.change_stamp();

        b.import(&a_log); // double-consume: wholesale replayed again
        for chunk in &a.chunks {
            b.import(chunk); // …and every incremental delta again
        }

        prop_assert_eq!(b.content(), text_once, "re-replay must not change the text");
        prop_assert_eq!(
            b.change_stamp(),
            stamp_once,
            "re-replay must not advance the state version vector"
        );
    }

    /// (d) CHUNKED REPLAY == WHOLESALE == SNAPSHOT — replaying A's ops as many
    /// incremental deltas through the REAL durable op-log path
    /// (`encode_oplog_note` → `decode_oplog_note` → `OpLog::replay_into`)
    /// converges identically to importing A's single wholesale export, and to
    /// importing A's compacted snapshot.
    #[test]
    fn d_chunked_replay_equals_wholesale_and_snapshot(
        seed in edit_script(4),
        a_script in edit_script(10),
        b_script in edit_script(10),
    ) {
        let (a, b) = fork(&seed, &a_script, &b_script);
        let b_log = b.export_all_updates();
        let channel = channel_for_path("/salvaged/file.rs");

        // Successor 1: B's log + A wholesale.
        let wholesale = HarborBuffer::empty("port-daddy:console:successor-wholesale");
        wholesale.apply_remote_ops(&b_log).expect("B log imports");
        wholesale.apply_remote_ops(&a.export_all_updates()).expect("A wholesale imports");

        // Successor 2: B's log + A's chunks through the durable op-log note codec.
        let chunked = HarborBuffer::empty("port-daddy:console:successor-chunked");
        chunked.apply_remote_ops(&b_log).expect("B log imports");
        let mut log = OpLog::new();
        for (seq, chunk) in a.chunks.iter().enumerate() {
            let note = encode_oplog_note(&channel, a.peer, seq as u64, chunk);
            let entry = decode_oplog_note(&note).expect("an op-log note round-trips");
            prop_assert!(log.append(entry), "each (peer, seq) delta is new");
        }
        log.replay_into(&chunked).expect("op-log replay lands");

        // Successor 3: B's log + A's compacted snapshot.
        let snapshotted = HarborBuffer::empty("port-daddy:console:successor-snapshot");
        snapshotted.apply_remote_ops(&b_log).expect("B log imports");
        snapshotted.apply_remote_ops(&a.export_snapshot()).expect("A snapshot imports");

        prop_assert_eq!(
            wholesale.to_string(),
            chunked.to_string(),
            "chunked op-log replay must equal wholesale import"
        );
        prop_assert_eq!(
            wholesale.to_string(),
            snapshotted.to_string(),
            "snapshot import must equal wholesale import"
        );
    }
}
