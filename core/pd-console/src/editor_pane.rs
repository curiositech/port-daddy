//! Editor pane — the Harbor Editor surface, now backed by a real Loro CRDT
//! buffer (battle-plan P1).
//!
//! P0 shipped a read-only viewer that read raw bytes with `std::fs::read_to_string`
//! and rendered a line-number gutter. P1 replaces that backing store with a
//! [`HarborBuffer`] (`buffer.rs`): a `LoroDoc`/`LoroText` whose every line carries
//! the PeerID of the replica that authored it. The pane renders `buffer.lines()`
//! and adds, beside the line-number gutter, a **per-PeerID authorship marker** —
//! the visible proof that "agent vs human" is a first-class buffer concept from
//! day one (battle-plan §7 step 7).
//!
//! ## Input boundary
//! The renderer-agnostic pane accepts guarded UTF-8 replacements and emits the
//! exact incremental Loro delta. `editor_input.rs` owns grapheme/selection/IME
//! state; `app.rs` registers GPUI's platform input handler and paints caret and
//! selection over the virtualized `CodeBuffer`. Claims and the wedge remain
//! policy here, so a human keystroke is refused before mutation inside another
//! live actor's claimed region.
//!
//! ## Authorship → gutter mapping
//! Each line's `author_peer` is rendered as a short, stable author tag in the
//! gutter (renderer-agnostic: it works in both the GPUI and TUI faces, which paint
//! the same `Block`s). The **opener** (this buffer's local replica — the operator
//! who opened the file) is the baseline; any line authored by a *different* replica
//! (an agent whose ops merged in) is tagged distinctly and marked. The semantic
//! Tone mapping the GPUI face applies — **operator = `Resting`, agent = `Engaged`**
//! — is recorded by [`author_tone`] so the rich face can color the gutter cell
//! while the TUI shows the tag text. No `rgb(0x…)` hex anywhere — color is meaning,
//! resolved from `Tone`.

use crate::agent::DaemonClient;
use crate::buffer::{peer_id_for_identity, HarborBuffer, HistoryAction, PeerId, ReceiptBatch};
use crate::editor_claims::{
    claim_tone, decode_claim_frame, encode_claim_frame, ClaimId, ClaimLedger, ClaimMirror,
    ClaimStore, RegionClaim,
};
use crate::editor_commit_gate::{check_staged_regions, CommitGateVerdict};
use crate::editor_sync::{
    decode_presence_frame, encode_presence_frame, PresenceDebouncer, PresenceState, PresenceStore,
};
use crate::editor_wedge::{
    parse_predict_response, predict_request_body, ClaimKind, GatedRegion, GuardBand, GuardVerdict,
    PdNudge, SymbolClaim, WedgeProbe,
};
use crate::pane::{Block, CodeBand, CodeLine, Pane, Subscription, Tone};
use anyhow::Result;
use std::collections::BTreeMap;
use std::sync::Arc;

/// Minimum wall-clock gap (ms) between two presence broadcasts. Caret moves fire
/// faster than anyone reads; one send per ~60ms is smooth to a watcher yet keeps
/// the tube quiet. The gate is [`PresenceDebouncer`]; this is only its interval.
const PRESENCE_SEND_INTERVAL_MS: i64 = 60;

/// Minimum wall-clock gap (ms) between two durable claim-mirror POSTs. A claim is a
/// durable reservation, not a live cursor, so it mirrors far less often than presence
/// broadcasts — a region drag coalesces into one `POST /sessions/:id/files` per this
/// window. The gate is [`ClaimMirror`]; this is only its interval.
const CLAIM_MIRROR_INTERVAL_MS: i64 = 500;

/// Minimum wall-clock gap (ms) between two conflict-prediction probes (P3 slice 2, the
/// wedge). A `conflicts/predict` round-trip is far heavier than a claim mirror, and
/// firing it per keystroke would both stall the edit loop and over-warn until actors
/// ignore the band — so the probe is armed only on a claim-acquire / region-enter edge
/// and coalesced to at most one call per this window. The gate is [`WedgeProbe`]; this
/// is only its interval.
const WEDGE_PROBE_INTERVAL_MS: i64 = 400;

/// Cap on how many lines a single file contributes to the view. The battle-plan's
/// large-file virtualization is a P1+ concern; this slice just must never let a
/// huge file wedge the render — so we render the first `MAX_LINES` and append a
/// truncation marker.
const MAX_LINES: usize = 2000;

/// Default PD identity for the local (opener) replica when none is injected. Real
/// callers pass the operator's `pd whoami` identity; tests and the headless render
/// path fall back to this so the buffer always has a stable replica id.
const DEFAULT_IDENTITY: &str = "port-daddy:console:operator";

/// Resolve the operator's PD identity for the local Loro replica.
///
/// Tries `pd whoami --identity` once; on any failure (no session, `pd` absent,
/// non-zero exit) falls back to [`DEFAULT_IDENTITY`]. Honest about the fallback:
/// the buffer is correct either way (a stable PeerID is minted from whatever
/// string we get), the identity just won't reflect the live session if `pd` is
/// unavailable. Kept synchronous and cheap; the caller invokes it at pane
/// construction, not per render tick.
pub fn resolve_operator_identity() -> String {
    let out = std::process::Command::new("pd")
        .args(["whoami", "--identity"])
        .output();
    match out {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.is_empty() {
                DEFAULT_IDENTITY.to_string()
            } else {
                s
            }
        }
        _ => DEFAULT_IDENTITY.to_string(),
    }
}

/// Width of the gutter line-number column for a file with `n` lines.
fn gutter_width(n: usize) -> usize {
    let digits = if n == 0 {
        1
    } else {
        (n as f64).log10().floor() as usize + 1
    };
    digits.max(2)
}

/// A short, stable author tag for a PeerId — the last 2 hex nibbles of the id.
/// Deterministic and compact for the gutter; the full PeerId↔PD-identity mapping
/// lives in `buffer.rs`. Returns a fixed-width 2-char tag.
fn author_tag(peer: PeerId) -> String {
    format!("{:02x}", (peer & 0xff) as u8)
}

/// The semantic Tone for a line's author relative to the opener replica.
/// **operator (opener) = `Resting`; any other replica (agent) = `Engaged`.**
/// The GPUI face applies this to the gutter cell; the TUI shows the tag text.
/// Exposed (and unit-tested) so the mapping is a checked contract, not a comment.
pub fn author_tone(author: Option<PeerId>, opener: PeerId) -> Tone {
    match author {
        Some(p) if p == opener => Tone::Resting,
        Some(_) => Tone::Engaged,
        None => Tone::Default,
    }
}

/// The pre-tokenized render cache behind [`Block::CodeBuffer`]. Rebuilt ONLY
/// when the buffer's CRDT [`HarborBuffer::change_stamp`] moves — a render pass
/// on an unchanged buffer is an `Arc` refcount bump, never a re-lex or a
/// per-line `String` clone (the old `Block::Row(text.clone())`-per-line path
/// cloned the whole file every view).
struct CodeCache {
    stamp: Vec<u8>,
    lines: Arc<[CodeLine]>,
    gutter_cols: u8,
    /// A real second author exists among the shown lines.
    show_authors: bool,
    total: usize,
}

/// The Harbor Editor surface, backed by a Loro buffer. State: `path`/`region` are
/// the bound entity + the P3 claim seam; `identity` is the PD identity the local
/// replica opens under; `buffer` is the live Loro doc (`None` until loaded or on
/// error); `error` holds any load failure; `truncated` records the large-file cap.
pub struct EditorPane {
    path: String,
    region: Option<(u32, u32)>,
    identity: String,
    buffer: Option<HarborBuffer>,
    truncated: bool,
    error: Option<String>,
    /// The per-file **edit-sync** tube channel this editor's op stream rides on (P2
    /// slice 1), derived once from `path` via [`crate::editor_sync::channel_for_path`].
    /// Two replicas opening the same file land on the same channel and exchange Loro
    /// op frames over it. Presence (slice 2) and snapshot refs (slice 3) ride this
    /// SAME channel under distinct frame kinds.
    channel: String,
    /// The per-file **coordination** tube channel (P2 slice 3), derived from `path`
    /// via [`crate::editor_sync::coordination_channel_for_path`]. Deliberately a
    /// SEPARATE channel from `channel` so claims / guard / conflict-predict signals
    /// never share a queue with the high-frequency doc-op lane — a keystroke burst
    /// cannot starve coordination (ref-03 §3 isolation). Derived once; stable for the
    /// pane's life.
    coord_channel: String,
    /// P2 slice 2 — the ephemeral presence lane. All three fields are **owned by
    /// this pane and touched only on the render/main thread** (in the gpui face,
    /// via `cx`). The SSE→render seam stays a plain mpsc of frame bytes (as slice 1
    /// established); nothing here is shared across threads, so there is deliberately
    /// no `Arc<Mutex<..>>`.
    ///
    /// `presence` is the LWW substrate (Loro `EphemeralStore`); `remote` is the
    /// derived, render-facing pool keyed by the `Copy` `PeerId` scalar (a plain
    /// `BTreeMap`, not a slotmap — the PeerId is already the stable handle); and
    /// `presence_out` debounces the local caret's outbound frames.
    presence: PresenceStore,
    remote: BTreeMap<PeerId, PresenceState>,
    presence_out: PresenceDebouncer,
    /// The local replica's own latest caret/selection/viewport — the source the
    /// durable region-claim mirror and the next outbound presence frame read from.
    local_presence: PresenceState,
    /// P3 slice 1 — the claims-as-awareness lane. Same single-threaded ownership
    /// discipline as `presence`: these live on the render/main thread and the SSE→render
    /// seam stays a plain mpsc of frame bytes, so there is deliberately no
    /// `Arc<Mutex<..>>`. `claims` is the awareness substrate on the COORDINATION channel;
    /// `claim_ledger` is the derived, render-facing keyed map (`BTreeMap<ClaimKey,_>`);
    /// `claim_out` debounces the durable `/sessions/:id/files` mirror; `next_claim_id`
    /// mints this replica's monotonic per-claim slot ids.
    claims: ClaimStore,
    claim_ledger: ClaimLedger,
    claim_out: ClaimMirror,
    next_claim_id: ClaimId,
    /// P3 slice 2 — the wedge. `wedge_probe` is the debounce gate that arms on a
    /// claim-acquire / region-enter edge (never per-keystroke) and, when due, yields the
    /// `conflicts/predict` request body; `wedge_inflight` remembers the single intent
    /// that probe was for (one at a time — the debounce guarantees it) so the async
    /// report folds back onto the right region/symbol; `guard_band` is the live
    /// [`Tone::Conflicted`] one-shot band raised when the daemon predicts a blocking
    /// conflict, or `None` when the region is clear. Same single-threaded ownership as
    /// the claim/presence lanes — no `Arc<Mutex<..>>`.
    wedge_probe: WedgeProbe,
    wedge_inflight: Option<RegionClaim>,
    guard_band: Option<GuardBand>,
    /// Tokenized-line render cache (see [`CodeCache`]). `RefCell` because the
    /// buffer has interior mutability (remote ops land through `&HarborBuffer`),
    /// so the staleness check must run inside `view(&self)`; the cell is only
    /// ever borrowed inside that single-threaded render call.
    code: std::cell::RefCell<Option<CodeCache>>,
}

impl EditorPane {
    /// Construct a pane bound to `path` with an optional `region`, opened under the
    /// default operator identity. No disk I/O here — call `load()` (sync) or
    /// `refresh()` (async) to populate the buffer.
    pub fn new(path: impl Into<String>, region: Option<(u32, u32)>) -> Self {
        Self::new_with_identity(path, region, DEFAULT_IDENTITY)
    }

    /// Construct a pane whose local Loro replica is keyed to `identity` (the
    /// operator's PD identity, e.g. from `pd whoami`). This is the identity↔replica
    /// binding the battle-plan requires for correct authorship across reconnects.
    /// It is not authority for a successor to impersonate a dead actor.
    pub fn new_with_identity(
        path: impl Into<String>,
        region: Option<(u32, u32)>,
        identity: impl Into<String>,
    ) -> Self {
        let path = path.into();
        let identity = identity.into();
        // Derive both per-file channels once at construction — each is a pure
        // function of the path, so both are stable for the pane's whole life (and
        // match every other replica that opens the same file). The edit-sync lane and
        // the coordination lane are DISTINCT channels (slice-3 isolation).
        let channel = crate::editor_sync::channel_for_path(&path);
        let coord_channel = crate::editor_sync::coordination_channel_for_path(&path);
        // Mint the local replica id from the identity directly (same FNV-1a as the
        // buffer) so presence has a stable local PeerId even before a file loads —
        // the presence lane does not depend on the buffer being open.
        let local_peer = peer_id_for_identity(&identity);
        Self {
            path,
            region,
            identity,
            buffer: None,
            truncated: false,
            error: None,
            channel,
            coord_channel,
            presence: PresenceStore::new(local_peer),
            remote: BTreeMap::new(),
            presence_out: PresenceDebouncer::new(PRESENCE_SEND_INTERVAL_MS),
            // A bare caret at the top of the file until the input layer moves it.
            local_presence: PresenceState::caret(1, 0, 1, 1),
            claims: ClaimStore::new(local_peer),
            claim_ledger: ClaimLedger::new(),
            claim_out: ClaimMirror::new(CLAIM_MIRROR_INTERVAL_MS),
            next_claim_id: 0,
            wedge_probe: WedgeProbe::new(WEDGE_PROBE_INTERVAL_MS),
            wedge_inflight: None,
            guard_band: None,
            code: std::cell::RefCell::new(None),
        }
    }

    /// Synchronously open the bound file into a Loro buffer, recording any error.
    /// Used by the GPUI render path (`&self`-sync construction) and by `refresh()`.
    /// Idempotent: clears prior state before loading.
    pub fn load(&mut self) {
        self.buffer = None;
        self.truncated = false;
        // Drop the render cache: a re-load may read DIFFERENT disk content that
        // happens to produce an equal-length op stream (an equal CRDT stamp), so
        // the stamp alone cannot be trusted across a reopen.
        self.code.replace(None);
        match HarborBuffer::open(&self.path, self.identity.clone()) {
            Ok(buf) => {
                self.buffer = Some(buf);
                self.error = None;
            }
            Err(e) => {
                self.error = Some(format!("{e}"));
            }
        }
    }

    /// Borrow the live buffer, if loaded. Lets callers (and the merge demo) inject
    /// a second replica's ops via `apply_remote_ops` so an agent's lines render
    /// with their own authorship.
    pub fn buffer(&self) -> Option<&HarborBuffer> {
        self.buffer.as_ref()
    }

    /// The most recent disk-open failure, if this pane could not establish a
    /// buffer. Navigation code reads this before committing an Editor surface so
    /// a permission error cannot replace the operator's current workspace.
    pub fn load_error(&self) -> Option<&str> {
        self.error.as_deref()
    }

    /// Current buffer text for the foreground input bridge. This is a snapshot
    /// string, never retained by the input model, so the Loro document remains
    /// the sole content authority.
    pub fn text(&self) -> Option<String> {
        self.buffer.as_ref().map(HarborBuffer::to_string)
    }

    /// Drain authoritative UTF-8 receipts in mutation order. P1B syntax work
    /// consumes this seam directly and must never derive edits from snapshots.
    pub fn take_edit_receipts(&mut self) -> ReceiptBatch {
        self.buffer
            .as_ref()
            .map(HarborBuffer::take_edit_receipts)
            .unwrap_or_default()
    }

    /// Fail closed on every live claim touched by a UTF-8 replacement. History
    /// callers invoke this with Loro's stable cursor range before undo/redo, so
    /// governance always precedes mutation.
    fn ensure_editable_range(
        &self,
        before: &str,
        range: std::ops::Range<usize>,
        replacement_newlines: usize,
    ) -> std::result::Result<(), String> {
        let first_line = 1 + before[..range.start]
            .bytes()
            .filter(|b| *b == b'\n')
            .count() as u32;
        // Count newlines *inside* a non-empty replacement too: deleting a
        // newline joins two lines and therefore touches both claim regions.
        let deleted_last_line = 1 + before.as_bytes()[..range.end]
            .iter()
            .filter(|b| **b == b'\n')
            .count() as u32;
        let inserted_last_line = first_line.saturating_add(replacement_newlines as u32);
        let last_line = deleted_last_line.max(inserted_last_line);
        for line in first_line..=last_line.max(first_line) {
            if let GuardVerdict::Gated(gated) = self.guard_verdict_for_line(line) {
                return Err(gated.message());
            }
        }
        Ok(())
    }

    /// Apply one human edit expressed as a UTF-8 byte replacement. Existing
    /// live-claim policy is checked before any byte is written; accepted edits
    /// become locally-authored Loro ops and return the incremental tube frame the
    /// producer mirrors/broadcasts.
    pub fn apply_local_text_edit(
        &mut self,
        range: std::ops::Range<usize>,
        replacement: &str,
    ) -> std::result::Result<String, String> {
        let Some(buffer) = self.buffer.as_ref() else {
            return Err("editor buffer is not loaded".into());
        };
        let before = buffer.to_string();
        if range.start > range.end
            || range.end > before.len()
            || !before.is_char_boundary(range.start)
            || !before.is_char_boundary(range.end)
        {
            return Err(format!(
                "input range {range:?} is not a valid UTF-8 boundary for {} bytes",
                before.len()
            ));
        }

        self.ensure_editable_range(
            &before,
            range.clone(),
            replacement.bytes().filter(|byte| *byte == b'\n').count(),
        )?;

        let unicode = before[..range.start].chars().count()..before[..range.end].chars().count();
        let edit = buffer.replace_authored(unicode, replacement);
        let frame = crate::editor_sync::encode_frame(buffer.local_peer(), &edit.delta);
        Ok(frame)
    }

    /// Undo one foreground-authored item after resolving and claim-checking its
    /// current merged range. The returned frame is the ordinary editor-sync
    /// delta mirrored by the producer and broadcast to peers.
    pub fn undo_local_text_edit(&mut self) -> std::result::Result<Option<String>, String> {
        self.apply_local_history(false)
    }

    /// Redo one foreground-authored item through the same governed path.
    pub fn redo_local_text_edit(&mut self) -> std::result::Result<Option<String>, String> {
        self.apply_local_history(true)
    }

    fn apply_local_history(&mut self, redo: bool) -> std::result::Result<Option<String>, String> {
        let Some(buffer) = self.buffer.as_ref() else {
            return Err("editor buffer is not loaded".into());
        };
        let action = if redo {
            HistoryAction::Redo
        } else {
            HistoryAction::Undo
        };
        let edit = buffer.apply_history_governed(action, |before, guard| {
            self.ensure_editable_range(before, guard.range.clone(), guard.replacement_newlines)
        })?;
        let Some(edit) = edit else {
            return Ok(None);
        };
        let frame = crate::editor_sync::encode_frame(buffer.local_peer(), &edit.delta);
        Ok(Some(frame))
    }

    /// Fold the foreground authority's exact local delta into the producer's
    /// mirror. Unlike `ingest_frame`, this deliberately accepts our own PeerId:
    /// both panes receive the same authored op instead of independently minting
    /// two operations for one keystroke.
    pub fn ingest_local_frame(&mut self, text: &str) -> bool {
        let Some(frame) = crate::editor_sync::decode_frame(text) else {
            return false;
        };
        let Some(buffer) = self.buffer.as_ref() else {
            return false;
        };
        let before = buffer.change_stamp();
        if buffer.apply_remote_ops(&frame.ops).is_err() {
            return false;
        }
        let changed = buffer.change_stamp() != before;
        changed
    }

    /// The per-file tube channel this editor's op stream rides on. Callers open the
    /// live receiver with `DaemonClient::subscribe_channel(pane.channel())` and hand
    /// each `TubeMsg::text` back to [`ingest_frame`](Self::ingest_frame).
    pub fn channel(&self) -> &str {
        &self.channel
    }

    /// The per-file **coordination** channel (P2 slice 3) — the isolated control
    /// plane for claims / guard / conflict-predict. Callers open a SEPARATE live
    /// receiver with `DaemonClient::subscribe_channel(pane.coordination_channel())`
    /// (its own `mpsc`, distinct from the edit lane's) and send signals with
    /// `DaemonClient::send_coord_signal`. Always distinct from [`channel`](Self::channel).
    pub fn coordination_channel(&self) -> &str {
        &self.coord_channel
    }

    /// Fold one Loro op frame (a `TubeMsg::text` off this file's channel) into the
    /// buffer — the "land in the buffer" end of the P2 slice-1 transport. Decodes
    /// via [`crate::editor_sync::decode_frame`]; a non-frame (handshake, heartbeat,
    /// garbage) or a frame arriving before the buffer is loaded is ignored. A frame
    /// authored by THIS replica (its own ops echoed back over the tube) is skipped —
    /// re-importing them is idempotent, but skipping avoids needless work, mirroring
    /// the operator-chat loop that drops its own echoed turns. Returns whether a
    /// remote op actually landed.
    pub fn ingest_frame(&mut self, text: &str) -> bool {
        let Some(frame) = crate::editor_sync::decode_frame(text) else {
            return false;
        };
        let Some(buffer) = self.buffer.as_ref() else {
            return false;
        };
        if frame.peer == buffer.local_peer() {
            return false; // our own ops, echoed back — nothing to fold
        }
        let before = buffer.change_stamp();
        if buffer.apply_remote_ops(&frame.ops).is_err() {
            return false;
        }
        let changed = buffer.change_stamp() != before;
        changed
    }

    // ── P2 slice 3: durability (snapshot ⇄ /blob) ─────────────────────────────

    /// Export the buffer's current state as a compacted **snapshot** blob for the
    /// content-addressed `/blob` store — the durability primitive. `None` until a
    /// buffer is loaded. The caller POSTs these bytes with
    /// `DaemonClient::put_blob`, then broadcasts the returned id via
    /// `encode_snapshot_frame` + `broadcast_snapshot_ref` on [`channel`](Self::channel)
    /// so a behind peer can catch up from snapshot+recent-deltas.
    pub fn snapshot_blob(&self) -> Option<Vec<u8>> {
        self.buffer.as_ref().map(|b| b.export_snapshot())
    }

    /// Hydrate this pane's buffer from a snapshot blob fetched from `/blob` — the P2
    /// checkpoint/reconnect path. Imports the snapshot into the live buffer (or opens a fresh replica
    /// under this pane's identity if none is loaded), merging CRDT-clean with
    /// authorship intact. Returns whether the snapshot applied. Idempotent: importing
    /// a snapshot the buffer already contains is a no-op.
    pub fn hydrate_from_snapshot(&mut self, snapshot: &[u8]) -> bool {
        let buffer = self
            .buffer
            .get_or_insert_with(|| HarborBuffer::empty(self.identity.clone()));
        match buffer.apply_remote_ops(snapshot) {
            Ok(()) => {
                self.error = None;
                true
            }
            Err(_) => false,
        }
    }

    // ── P2 slice 2: presence lane ─────────────────────────────────────────────
    //
    // The whole lane is edge-triggered: every method that could change what is on
    // screen returns `true`/`Some` EXACTLY when something changed, and `false`/
    // `None` when nothing did. The gpui face calls `cx.notify()` only on those
    // edges, so a quiet file with live remote cursors schedules zero repaints — no
    // window-wide `repeat()` animation, no polling churn. (Proven by
    // `idle_screen_does_not_rerender_with_multiple_remote_cursors`.)

    /// Update where the LOCAL caret/selection/viewport is and queue it for a
    /// debounced broadcast. The GPUI input layer calls this after every accepted
    /// edit or caret move. Recording is cheap and does not itself send or
    /// repaint — [`take_presence_broadcast`](Self::take_presence_broadcast) does.
    pub fn set_local_presence(&mut self, state: PresenceState) {
        self.local_presence = state;
        self.presence_out.record(state);
    }

    /// The local caret's current presence (what a broadcast / region-claim reads).
    pub fn local_presence(&self) -> PresenceState {
        self.local_presence
    }

    /// If a local move is due (past the debounce interval), publish it to the
    /// store and return the encoded presence frame text for the caller to
    /// `DaemonClient::send_presence` up this file's [`channel`](Self::channel).
    /// `None` when nothing is due — an idle caret sends nothing.
    pub fn take_presence_broadcast(&mut self, now_ms: i64) -> Option<String> {
        let state = self.presence_out.take_due(now_ms)?;
        let blob = self.presence.publish(state);
        Some(encode_presence_frame(self.presence.local(), &blob))
    }

    /// Fold one presence frame (a `TubeMsg::text` off this file's channel) into the
    /// remote-cursor pool. Returns whether the visible pool actually CHANGED — i.e.
    /// whether the gpui face should `cx.notify()`. A non-presence frame (an op
    /// frame, handshake, garbage), our own presence echoed back, or a stale
    /// (older-timestamp LWW) update all fold to **no change** and return `false`,
    /// which is what keeps an idle screen from re-rendering.
    pub fn ingest_presence(&mut self, text: &str) -> bool {
        let Some(frame) = decode_presence_frame(text) else {
            return false;
        };
        if frame.peer == self.presence.local() {
            return false; // our own presence, echoed back — nothing to pool
        }
        if self.presence.apply(&frame.eph).is_err() {
            return false;
        }
        self.sync_remote_pool()
    }

    /// Drop remote cursors whose presence has aged past the timeout. Returns
    /// whether anyone was actually removed (a repaint edge); before the timeout it
    /// removes nobody and returns `false`, so the idle tick that calls this stays
    /// silent. The caller runs it on its normal refresh cadence.
    pub fn expire_presence(&mut self) -> bool {
        self.presence.expire();
        self.sync_remote_pool()
    }

    /// The current pool of remote cursors, keyed by their `Copy` `PeerId`. A cheap
    /// borrow of owned state — reading it never mutates and never repaints.
    pub fn remote_cursors(&self) -> &BTreeMap<PeerId, PresenceState> {
        &self.remote
    }

    /// Rebuild the cached render pool from the store and report whether it changed.
    /// The one place `self.remote` is written; every presence mutation funnels
    /// through here so the change signal is computed in exactly one spot.
    fn sync_remote_pool(&mut self) -> bool {
        let next = self.presence.remote_cursors();
        if next != self.remote {
            self.remote = next;
            true
        } else {
            false
        }
    }

    /// The durable claims-table mirror for the LOCAL selection: the `(path, start,
    /// end)` line-region this replica has selected, or `None` for a bare caret.
    ///
    /// Presence is ephemeral and lossy; a real multi-line *selection* is a stronger
    /// signal — "I am working here" — that belongs in the durable claims table.
    /// The caller feeds this to [`crate::agent::DaemonClient::claim_region`], which
    /// POSTs a region to the SAME `POST /sessions/:id/files` endpoint `pd session
    /// files add` uses — we REUSE the claims store, never fork a parallel one.
    pub fn region_claim(&self) -> Option<(String, u32, u32)> {
        if !self.local_presence.has_selection() {
            return None;
        }
        let (start, end) = self.local_presence.selection_line_span();
        Some((self.path.clone(), start, end))
    }

    // ── P3 slice 1: claims-as-awareness (presence-as-claims) ──────────────────
    //
    // A region claim is a peer's live awareness state on the COORDINATION channel
    // (never the edit lane) PLUS a debounced durable mirror into `/sessions/:id/files`.
    // Every method that could change what is on screen returns whether the ledger
    // actually changed, so the gpui face `cx.notify()`s only on real edges — same
    // edge-triggered discipline as the presence lane (no polling churn).

    /// Acquire a region claim over 1-based inclusive lines `start..=end`, labeled with
    /// the work name (`"parse_header"`), granted at logical time `now_ms`. Mints this
    /// replica's next [`ClaimId`], publishes it to the awareness store, refreshes the
    /// ledger, and queues it for the durable mirror. Returns the encoded claim frame to
    /// broadcast on the file's [`coordination_channel`](Self::coordination_channel) via
    /// [`DaemonClient::broadcast_claim`]. Agent-neutral: the claim is keyed by this
    /// replica's `PeerId`, with no branch on which backend the actor is (PD hard rule).
    pub fn acquire_region_claim(
        &mut self,
        start: u32,
        end: u32,
        label: impl Into<String>,
        now_ms: i64,
    ) -> String {
        let id = self.next_claim_id;
        self.next_claim_id = self.next_claim_id.wrapping_add(1);
        let claim = RegionClaim::new(self.claims.local(), id, start, end, label, now_ms as u64);
        let blob = self.claims.publish(&claim);
        // Arm the wedge on this coordination EDGE (a claim-acquire) — debounced, so a
        // fast re-acquire coalesces (HARD RULE 2). A caret move / keystroke never reaches
        // here, which is what keeps the probe off the per-keystroke path.
        self.wedge_probe.arm(claim.clone());
        self.claim_out.record(claim);
        self.claim_ledger = self.claims.ledger();
        encode_claim_frame(self.claims.local(), &blob)
    }

    /// Arm the wedge on a **region-enter** edge (the caret crossing INTO a new region),
    /// without acquiring a claim — the second coordination edge the wedge fires on
    /// (HARD RULE 2). The input layer calls this when the caret's region changes, NOT on
    /// every keystroke inside the same region. Debounced through the same [`WedgeProbe`]
    /// as acquire, so entering and re-entering collapses to one probe per window.
    pub fn enter_region(&mut self, start: u32, end: u32, label: impl Into<String>, now_ms: i64) {
        // A synthetic local intent (no claim id minted — an enter is not an acquire): it
        // carries the region + work label the predict call needs, keyed to this replica.
        let intent = RegionClaim::new(
            self.claims.local(),
            self.next_claim_id,
            start,
            end,
            label,
            now_ms as u64,
        );
        self.wedge_probe.arm(intent);
    }

    /// Release one of THIS replica's claims by id, refreshing the ledger. Returns the
    /// encoded revocation frame to broadcast on the coordination channel (a remote
    /// replica folds it and subtracts the claim from its ledger). The durable `/files`
    /// release (a `DELETE`) is a later slice; slice 1 mirrors acquires.
    pub fn release_region_claim(&mut self, id: ClaimId) -> String {
        let blob = self.claims.release(id);
        self.claim_ledger = self.claims.ledger();
        encode_claim_frame(self.claims.local(), &blob)
    }

    /// Fold one claim-awareness frame (a `TubeMsg::text` off this file's COORDINATION
    /// channel) into the ledger. Returns whether the visible ledger CHANGED — the
    /// gpui-face repaint edge. A non-claim frame (a coord signal, an edit-lane frame,
    /// handshake, garbage), our own claim echoed back, or a stale LWW update all fold
    /// to no change and return `false`, keeping an idle screen quiet.
    pub fn ingest_claim(&mut self, text: &str) -> bool {
        let Some(frame) = decode_claim_frame(text) else {
            return false;
        };
        if frame.peer == self.claims.local() {
            return false; // our own claim, echoed back — already in the ledger
        }
        if self.claims.apply(&frame.eph).is_err() {
            return false;
        }
        let next = self.claims.ledger();
        if next != self.claim_ledger {
            self.claim_ledger = next;
            true
        } else {
            false
        }
    }

    /// The current claim ledger — the keyed map of every live region claim on this
    /// file (this replica's own AND every remote peer's). A cheap borrow of owned
    /// state; reading it never mutates or repaints.
    pub fn claim_ledger(&self) -> &ClaimLedger {
        &self.claim_ledger
    }

    /// The local claims that are DUE for a durable mirror (past the debounce window).
    /// The caller POSTs each to `POST /sessions/:id/files` via
    /// [`DaemonClient::claim_region`] using this pane's [`path`](Self::path_str) — the
    /// SAME region endpoint `pd session files add` drives, never a parallel store. An
    /// empty `Vec` when nothing is due (a quiet claim set mirrors nothing).
    pub fn take_claim_mirror(&mut self, now_ms: i64) -> Vec<RegionClaim> {
        self.claim_out.take_due(now_ms)
    }

    /// This pane's bound file path — the `path` a durable claim mirror POSTs against.
    pub fn path_str(&self) -> &str {
        &self.path
    }

    // ── P3 slice 2: the wedge (conflict prediction before a byte is written) ───

    /// If a wedge probe is DUE (past the debounce window since the last one), build the
    /// `POST /conflicts/predict` request body and mark the intent in-flight. `claimsA`
    /// is the local intended edit (modify the region's symbol); `claimsB` is every OTHER
    /// live actor's claim on this file (never our own — you do not conflict with
    /// yourself). `None` when no edge is armed or we are inside the window — so an idle
    /// editor and a keystroke burst both produce zero predict traffic (HARD RULE 2). The
    /// caller POSTs the body via [`crate::agent::DaemonClient::predict_conflicts`] and
    /// folds the response back through [`apply_conflict_report`](Self::apply_conflict_report).
    pub fn take_wedge_probe(&mut self, now_ms: i64) -> Option<serde_json::Value> {
        let intent = self.wedge_probe.take_due(now_ms)?;
        let a = [SymbolClaim::from_region(
            &self.path,
            &intent,
            ClaimKind::Modify,
        )];
        let me = self.claims.local();
        let b: Vec<SymbolClaim> = self
            .claim_ledger
            .iter()
            .filter(|(k, _)| k.peer != me)
            .map(|(_, c)| SymbolClaim::from_region(&self.path, c, ClaimKind::Modify))
            .collect();
        let body = predict_request_body(&a, &b);
        self.wedge_inflight = Some(intent);
        Some(body)
    }

    /// Fold a `conflicts/predict` response onto the in-flight probe intent. When the
    /// daemon reports a `blocking` conflict, raise a [`Tone::Conflicted`] one-shot guard
    /// band over the intended region — NOT a silent merge; the caller also surfaces the
    /// [`blocking_nudge`](Self::blocking_nudge). When it reports clear, drop any band we
    /// were showing. Returns whether the visible band CHANGED (the gpui repaint edge):
    /// re-confirming the SAME conflict does not restart the pulse or repaint (so a
    /// re-probe never re-throbs — HARD RULE 3). `None` in flight ⇒ no change.
    pub fn apply_conflict_report(&mut self, resp: &serde_json::Value, now_ms: i64) -> bool {
        let Some(intent) = self.wedge_inflight.take() else {
            return false;
        };
        let report = parse_predict_response(resp);
        if report.is_blocking() {
            let region = intent.line_span();
            let already = self
                .guard_band
                .as_ref()
                .map(|b| (b.symbol.as_str(), b.region))
                == Some((intent.label.as_str(), region));
            if already {
                return false; // same conflict already banded — don't restart the pulse
            }
            self.guard_band = Some(GuardBand::raised(
                intent.label.clone(),
                region,
                report,
                now_ms,
            ));
            true
        } else {
            let had = self.guard_band.is_some();
            self.guard_band = None;
            had
        }
    }

    /// The live conflict guard band, if one is raised. A cheap borrow; the gpui face
    /// reads [`GuardBand::emphasis`] each frame of the ONE-SHOT pulse, then holds it
    /// static. `None` when the intended region is conflict-free.
    pub fn guard_band(&self) -> Option<&GuardBand> {
        self.guard_band.as_ref()
    }

    /// The operator **pd-nudge** for the live conflict band, if any — the "you are about
    /// to edit into a predicted conflict" note the caller surfaces alongside the band
    /// (never a silent merge). `None` when no band is up.
    pub fn blocking_nudge(&self) -> Option<PdNudge> {
        self.guard_band
            .as_ref()
            .map(|b| PdNudge::blocking(&b.symbol, b.report))
    }

    /// The guard's verdict for editing 1-based line `n` — HARD RULE 6/7's pure core.
    /// `Gated` when the FIRST-GRANTED, non-revoked owner of the line is ANOTHER live
    /// actor (the contender negotiates or moves; the refusal names only sanctioned
    /// actions, never a bypass); `Clear` when the line is free or held only by this
    /// replica. This is what a later commit gate consults; slice 2 uses it to render the
    /// contender's [`Tone::Gated`] chip.
    pub fn guard_verdict_for_line(&self, n: u32) -> GuardVerdict {
        let me = self.claims.local();
        match self.claim_ledger.first_granted_owner_of_line(n) {
            Some(owner) if owner.peer != me => GuardVerdict::Gated(GatedRegion {
                owner_label: format!("peer {}", author_tag(owner.peer)),
                symbol: owner.label.clone(),
                region: owner.line_span(),
            }),
            _ => GuardVerdict::Clear,
        }
    }

    /// The commit gate (HARD RULE 7): the verdict for committing an edit spanning 1-based
    /// inclusive lines `start..=end`. `Gated` at the FIRST line held by another live
    /// actor's claim (the commit is refused with a typed, bypass-free note — the actor
    /// requests handoff / parleys / moves); `Clear` when every edited line is free or held
    /// only by this replica. This is the `pd guard check --staged` equivalent for the
    /// editor: it consults the SAME first-granted-wins ledger the live chip does, so the
    /// on-screen guard and the commit refusal can never disagree. Pure + region-scoped —
    /// an edit adjacent to (but outside) another's claim is never refused.
    pub fn commit_verdict(&self, start: u32, end: u32) -> GuardVerdict {
        for n in start.min(end)..=start.max(end) {
            let verdict = self.guard_verdict_for_line(n);
            if verdict.is_gated() {
                return verdict;
            }
        }
        GuardVerdict::Clear
    }

    /// The **staged commit gate** (P3 slice 3, the `pd guard check --staged` equivalent
    /// for a multi-hunk commit). Delegates to [`check_staged_regions`] over the pane's
    /// live claim ledger: refuses when ANY staged hunk reaches into a region whose
    /// first-granted, non-revoked owner is another LIVE actor, returning one typed,
    /// bypass-free [`GatedRegion`] per contended owner (HARD RULE 5/6/7). Region-scoped —
    /// a hunk adjacent to (but outside) another's claim clears (HARD RULE 1).
    ///
    /// Liveness comes from the ledger itself: it is rebuilt from the coordination-lane
    /// awareness store, which expires a dead actor's claim after `CLAIM_TIMEOUT_MS`, so a
    /// claim present here is from a live-enough actor (the `is_live` predicate is `true`;
    /// the injected-liveness path is the durable/daemon MCP gate's, not the pane's). The
    /// owner label reuses the same `peer <tag>` composition as the live guard chip, so the
    /// on-screen chip and the commit refusal can never name an owner differently.
    pub fn staged_commit_gate(&self, hunks: &[(u32, u32)]) -> CommitGateVerdict {
        let me = self.claims.local();
        check_staged_regions(
            &self.claim_ledger,
            hunks,
            me,
            |_peer| true,
            |peer| format!("peer {}", author_tag(peer)),
        )
    }

    /// The tokenized code snapshot for the current buffer, rebuilding the cache
    /// ONLY when the CRDT stamp moved (covers every mutation path, including
    /// remote ops applied through a shared `&HarborBuffer`). The unchanged path
    /// is a stamp compare + `Arc` clone — no re-lex, no per-line `String` clone.
    /// Returns `(lines, gutter_cols, show_authors, total_line_count)`.
    fn code_snapshot(&self, buffer: &HarborBuffer) -> (Arc<[CodeLine]>, u8, bool, usize) {
        let stamp = buffer.change_stamp();
        let mut slot = self.code.borrow_mut();
        if slot.as_ref().map_or(true, |c| c.stamp != stamp) {
            let lang = crate::syntax::lang_for_path(&self.path);
            let opener = buffer.local_peer();
            let all = buffer.lines();
            let total = all.len();
            let show_authors = all
                .iter()
                .take(MAX_LINES)
                .any(|l| matches!(l.author_peer, Some(p) if p != opener));
            let lines: Arc<[CodeLine]> = all
                .into_iter()
                .take(MAX_LINES)
                .enumerate()
                .map(|(i, l)| {
                    let runs = crate::syntax::highlight_line(&l.text, lang);
                    CodeLine {
                        number: (i + 1) as u32,
                        author_tag: l.author_peer.map(|peer| Arc::<str>::from(author_tag(peer))),
                        author_tone: author_tone(l.author_peer, opener),
                        runs,
                        text: Arc::<str>::from(l.text),
                    }
                })
                .collect();
            *slot = Some(CodeCache {
                stamp,
                lines,
                gutter_cols: gutter_width(total) as u8,
                show_authors,
                total,
            });
        }
        let c = slot.as_ref().expect("cache ensured above");
        (c.lines.clone(), c.gutter_cols, c.show_authors, c.total)
    }
}

impl Pane for EditorPane {
    fn id(&self) -> &str {
        "editor"
    }

    fn title(&self) -> String {
        let base = self
            .path
            .rsplit(['/', '\\'])
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or(&self.path);
        format!("edit {base}")
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header(self.title())];

        if let Some(err) = &self.error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        let Some(buffer) = &self.buffer else {
            // Not loaded yet (constructed but neither load() nor refresh() ran).
            blocks.push(Block::KeyVal("status".into(), "buffer not loaded".into()));
            return blocks;
        };

        let opener = buffer.local_peer();
        // The tokenized snapshot: an Arc clone on the unchanged path — the old
        // path re-cloned every line's String into a Block::Row per view().
        let (lines, gutter_cols, show_authors, total) = self.code_snapshot(buffer);

        // Legend: which tag is the operator vs an agent replica. Rendered as a
        // tone-bearing Flag so the authorship vocabulary is visible at a glance and
        // color carries meaning (Resting = you/opener, Engaged = an agent peer).
        blocks.push(Block::Flag {
            letter: 'H',
            label: format!("operator {} (opener)", author_tag(opener)),
            tone: Tone::Resting,
        });

        if show_authors {
            blocks.push(Block::Flag {
                letter: 'A',
                label: "agent replica (merged ops)".into(),
                tone: Tone::Engaged,
            });
        }

        // Live presence: one legend flag per REMOTE cursor (slice 2). This is
        // O(remote peers) — a handful — NOT O(lines): we deliberately do not stamp a
        // glyph into each visible line's gutter (that would add a per-line clone to
        // the hot render path). `self.remote` is BTree-ordered, so the flags render
        // in a stable order frame to frame (no flicker). The gpui face animates each
        // caret's glide as an opacity/offset transition on its own leaf element; the
        // Blocks here are the render-agnostic, TUI-visible shadow of that.
        for (peer, state) in &self.remote {
            let (sel_lo, sel_hi) = state.selection_line_span();
            let where_ = if state.has_selection() {
                format!("sel L{sel_lo}–L{sel_hi}")
            } else {
                format!("caret L{}", state.cursor_line)
            };
            blocks.push(Block::Flag {
                letter: 'C',
                label: format!(
                    "peer {} · {where_} · view L{}–L{}",
                    author_tag(*peer),
                    state.top_line,
                    state.bottom_line
                ),
                tone: Tone::Engaged,
            });
        }

        // Live region claims (P3 slice 1): one legend flag per claim — "who has
        // reserved which region" — actor-colored by PeerId (claim_tone: your own claim
        // Resting, a peer's Engaged). O(claims) — a handful — NOT O(lines): like the
        // presence flags we do not stamp a glyph into each claimed line's gutter (that
        // would add a per-line clone to the hot render path). The ledger is BTree-keyed
        // so the bands render in a stable order frame to frame. Slice 1 is visibility:
        // no Conflicted band, no guard refusal — those are later slices.
        for (key, claim) in self.claim_ledger.iter() {
            let who = if key.peer == opener {
                "you".to_string()
            } else {
                format!("peer {}", author_tag(key.peer))
            };
            let (lo, hi) = claim.line_span();
            blocks.push(Block::Flag {
                letter: 'R',
                label: format!("{who} — {} · L{lo}–L{hi}", claim.label),
                tone: claim_tone(key.peer, opener),
            });
        }

        // P3 slice 2 — the WEDGE. If the daemon predicted a BLOCKING conflict for the
        // region this replica is acquiring/entering, render a Tone::Conflicted guard
        // band (the one-shot pulse lives in the gpui face; the render-agnostic shadow is
        // this never-truncated band) plus its pd-nudge — surfaced, never silently merged.
        if let Some(band) = &self.guard_band {
            let (lo, hi) = band.region;
            blocks.push(Block::WrappedText {
                text: format!(
                    "⚠ predicted conflict — ‘{}’ (L{lo}–L{hi}): {} blocking",
                    band.symbol, band.report.blocking
                ),
                tone: band.tone(), // Tone::Conflicted
            });
            if let Some(nudge) = self.blocking_nudge() {
                blocks.push(Block::WrappedText {
                    text: nudge.detail,
                    tone: nudge.tone,
                });
            }
        }

        // Contender signal (HARD RULE 6): if the LOCAL caret sits inside a region held
        // by another live claim, render a Tone::Gated chip — "claimed by <owner>" —
        // offering handoff/parley/move. The first-granted claim wins; the contender
        // negotiates or moves. The refusal wording names no bypass.
        if let GuardVerdict::Gated(gated) =
            self.guard_verdict_for_line(self.local_presence.cursor_line)
        {
            blocks.push(Block::Chip {
                label: gated.nudge().headline,
                tone: gated.tone(), // Tone::Gated
            });
            blocks.push(Block::WrappedText {
                text: gated.message(),
                tone: Tone::Gated,
            });
        }

        // The code itself: ONE CodeBuffer block — a tight monospace surface the
        // GPUI face virtualizes with uniform_list, never per-line Row cards.
        // Highlight bands paint BEHIND the text: the bound region, every live
        // claim (actor-toned), and the conflict wedge LAST so it wins where
        // bands overlap (renderers take the last covering band per line).
        let mut bands: Vec<CodeBand> = Vec::new();
        if let Some((start, end)) = self.region {
            bands.push(CodeBand {
                start,
                end,
                tone: Tone::Accent,
            });
        }
        for (key, claim) in self.claim_ledger.iter() {
            let (start, end) = claim.line_span();
            bands.push(CodeBand {
                start,
                end,
                tone: claim_tone(key.peer, opener),
            });
        }
        if let Some(band) = &self.guard_band {
            let (start, end) = band.region;
            bands.push(CodeBand {
                start,
                end,
                tone: band.tone(),
            });
        }
        blocks.push(Block::CodeBuffer {
            lines,
            gutter_cols,
            bands,
            show_authors,
        });

        if total > MAX_LINES {
            blocks.push(Block::Gap);
            blocks.push(Block::Chip {
                label: format!("… truncated at {MAX_LINES} lines (large-file view is later)"),
                tone: Tone::Resting,
            });
        }

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        _daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        // Reads from local disk (no daemon/blob fetch yet — that's P2+). The Loro
        // open does a blocking std::fs read; do it off the reactor so a slow/huge
        // file can't stall it, then fold the buffer (or error) back into `self`.
        Box::pin(async move {
            let path = self.path.clone();
            let identity = self.identity.clone();
            // Same reopen hazard as `load()`: never trust the old cache across
            // a fresh disk read.
            self.code.replace(None);
            let opened = tokio::task::spawn_blocking(move || HarborBuffer::open(&path, identity))
                .await
                .map_err(|e| anyhow::anyhow!("editor load task panicked: {e}"))?;
            match opened {
                Ok(buf) => {
                    self.buffer = Some(buf);
                    self.error = None;
                    self.truncated = false;
                }
                Err(e) => {
                    self.error = Some(format!("{e}"));
                    self.buffer = None;
                    self.truncated = false;
                }
            }
            Ok(())
        })
    }

    /// Declare this editor's live intent: watch the file's op-stream channel so a
    /// second replica's Loro edits arrive over the tube (P2 slice 1). Same
    /// declare-intent contract the `AgentTranscript` lane uses — main.rs opens the
    /// SSE (`DaemonClient::subscribe_channel`) and drains frames back through
    /// [`ingest_frame`](Self::ingest_frame). Only once a real buffer is open: an
    /// errored / not-yet-loaded pane has nothing to fold remote ops into, so it
    /// subscribes to nothing (poll-only).
    fn subscription(&self) -> Option<Subscription> {
        self.buffer.as_ref().map(|_| Subscription::Editor {
            channel: self.channel.clone(),
            coord_channel: self.coord_channel.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buffer::peer_id_for_identity;
    use std::io::Write;
    use std::path::PathBuf;

    /// A UNIQUE scratch dir per call, rooted at the crate's COMPILE-TIME
    /// `CARGO_MANIFEST_DIR` (under `target/`, never `/tmp`).
    ///
    /// It deliberately does NOT read the runtime `HOME` env var: another test in this
    /// binary (`conjure`) hijacks the process-global `HOME` to a sandbox and then
    /// deletes that sandbox, so a harbor-editor test reading `HOME` at write time could
    /// land its file in the doomed sandbox and have it vanish (ENOENT) before
    /// `HarborBuffer::open` reads it back — leaving the pane bufferless so `view()`
    /// rendered nothing. `CARGO_MANIFEST_DIR` is baked at compile time and immune to
    /// that mutation. Each call also gets its own `<pid>-<seq>` subdir so parallel
    /// tests never share a directory.
    fn scratch_dir() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/editor-tests");
        let unique = base.join(format!(
            "{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&unique).expect("create scratch dir");
        unique
    }

    fn write_temp(name: &str, contents: &str) -> String {
        let path = scratch_dir().join(name);
        let mut f = std::fs::File::create(&path).expect("create temp file");
        f.write_all(contents.as_bytes()).expect("write temp file");
        // Flush to disk before the immediate reader (`HarborBuffer::open`) opens it, so
        // a just-written file is never seen half-written under parallel test load.
        f.sync_all().expect("sync temp file to disk");
        path.to_string_lossy().into_owned()
    }

    fn make_pane(path: &str, region: Option<(u32, u32)>) -> EditorPane {
        let mut p = EditorPane::new_with_identity(path, region, "port-daddy:console:operator");
        p.load();
        p
    }

    /// The single CodeBuffer block a populated view emits (lines, bands,
    /// show_authors). Code renders as ONE tight block now — never Row cards.
    fn code_buffer(blocks: &[Block]) -> Option<(Arc<[CodeLine]>, Vec<CodeBand>, bool)> {
        blocks.iter().find_map(|b| match b {
            Block::CodeBuffer {
                lines,
                bands,
                show_authors,
                ..
            } => Some((lines.clone(), bands.clone(), *show_authors)),
            _ => None,
        })
    }

    /// The code lines of a view (empty when no CodeBuffer rendered).
    fn rows(blocks: &[Block]) -> Vec<CodeLine> {
        code_buffer(blocks)
            .map(|(l, _, _)| l.to_vec())
            .unwrap_or_default()
    }

    fn row_count(blocks: &[Block]) -> usize {
        rows(blocks).len()
    }

    /// No code line may ever ride the legacy Block::Row card path.
    fn assert_no_row_cards(blocks: &[Block]) {
        assert!(
            !blocks.iter().any(|b| matches!(b, Block::Row(_))),
            "editor views must not emit Block::Row cards for code lines"
        );
    }

    #[test]
    fn view_yields_one_row_per_line_with_gutter_numbers() {
        let path = write_temp("known.txt", "alpha\nbravo\ncharlie\n");
        let pane = make_pane(&path, None);
        let blocks = pane.view();

        assert!(matches!(&blocks[0], Block::Header(h) if h == "edit known.txt"));
        assert_eq!(
            row_count(&blocks),
            3,
            "three content lines → three code lines"
        );
        assert_no_row_cards(&blocks);

        let r = rows(&blocks);
        // Line numbers are 1-based and always present; text is the raw line.
        assert_eq!(r[0].number, 1);
        assert_eq!(r[0].text.as_ref(), "alpha");
        assert_eq!(r[1].number, 2);
        assert_eq!(r[2].text.as_ref(), "charlie");
        // The author column is ALWAYS present (operator ruling 2026-07-07):
        // a single-author file's lines all carry the opener's tag, Resting-
        // toned; show_authors stays false as the "no second author" hint.
        let (lines, _, show_authors) = code_buffer(&blocks).expect("a code buffer renders");
        assert!(!show_authors, "one author ⇒ no agent legend flag");
        assert!(
            lines.iter().all(|l| l.author_tag.is_some()),
            "every line carries its author tag"
        );
        assert!(
            lines.iter().all(|l| matches!(l.author_tone, Tone::Resting)),
            "opener-authored lines tone Resting"
        );
    }

    #[test]
    fn unreadable_path_yields_one_error_block() {
        let pane = make_pane("/nonexistent/path/does/not/exist.rs", None);
        let blocks = pane.view();
        assert_eq!(
            row_count(&blocks),
            0,
            "an unreadable file renders no content rows"
        );
        let error_blocks = blocks
            .iter()
            .filter(|b| matches!(b, Block::KeyVal(k, _) if k == "error"))
            .count();
        assert_eq!(
            error_blocks, 1,
            "exactly one error block on an unreadable path"
        );
    }

    #[test]
    fn region_marks_the_right_lines() {
        let path = write_temp("region.txt", "l1\nl2\nl3\nl4\nl5\n");
        let pane = make_pane(&path, Some((2, 4)));
        let blocks = pane.view();
        let (lines, bands, _) = code_buffer(&blocks).expect("a code buffer renders");
        assert_eq!(lines.len(), 5);
        // The bound region is a BACKGROUND band behind lines 2..=4 — not
        // per-line gutter chrome.
        let region = bands
            .iter()
            .find(|b| b.tone == Tone::Accent)
            .expect("region band");
        let covered: Vec<bool> = (1..=5).map(|n| region.covers(n)).collect();
        assert_eq!(covered, vec![false, true, true, true, false]);
    }

    #[test]
    fn large_file_is_capped_and_marked_truncated() {
        let big: String = (0..(MAX_LINES + 50))
            .map(|i| format!("line {i}\n"))
            .collect();
        let path = write_temp("big.txt", &big);
        let pane = make_pane(&path, None);
        let blocks = pane.view();
        assert_eq!(row_count(&blocks), MAX_LINES, "capped at MAX_LINES rows");
        let has_trunc = blocks
            .iter()
            .any(|b| matches!(b, Block::Chip { label, .. } if label.contains("truncated")));
        assert!(
            has_trunc,
            "a truncation chip is appended when the cap is hit"
        );
    }

    /// THE NO-RECLONE PROOF: two view() calls on an unchanged buffer hand back
    /// the SAME Arc (a refcount bump — zero re-lex, zero per-line String clone);
    /// a real remote op lands a NEW Arc with the new line tokenized.
    #[test]
    fn unchanged_buffer_reuses_the_same_code_arc_across_views() {
        let path = write_temp("cache.rs", "pub fn go() {}\nlet x = 1;\n");
        let mut pane = make_pane(&path, None);
        let (a1, _, _) = code_buffer(&pane.view()).expect("code buffer");
        let (a2, _, _) = code_buffer(&pane.view()).expect("code buffer");
        assert!(
            Arc::ptr_eq(&a1, &a2),
            "an idle buffer re-renders from the SAME Arc"
        );

        // A merged remote op is a REAL change: the cache rebuilds exactly once.
        let agent = HarborBuffer::empty("port-daddy:editor:agent-cache");
        agent
            .apply_remote_ops(&pane.buffer().unwrap().export_ops())
            .unwrap();
        agent.append_line("let y = 2;");
        let frame = crate::editor_sync::encode_frame(agent.local_peer(), &agent.export_ops());
        assert!(pane.ingest_frame(&frame));
        let (a3, _, _) = code_buffer(&pane.view()).expect("code buffer");
        assert!(
            !Arc::ptr_eq(&a1, &a3),
            "a landed remote op rebuilds the cache"
        );
        assert_eq!(a3.len(), 3, "the new line is in the rebuilt cache");
        let (a4, _, _) = code_buffer(&pane.view()).expect("code buffer");
        assert!(
            Arc::ptr_eq(&a3, &a4),
            "and the rebuilt cache is reused thereafter"
        );
    }

    #[test]
    fn keystroke_becomes_one_authored_delta_and_updates_code_buffer() {
        let path = write_temp("local-input.rs", "let value = 1;\n");
        let identity = "port-daddy:console:human-input";
        let mut foreground = make_pane_as(&path, identity);
        let mut producer_mirror = make_pane_as(&path, identity);
        let (before_lines, _, _) = code_buffer(&foreground.view()).expect("code buffer");

        let text = foreground.text().expect("loaded text");
        let mut input = crate::editor_input::EditorInput::default();
        for _ in 0..4 {
            input.right(&text, false);
        }
        let edit = input.replace_bytes(&text, input.selection(), "mut ");
        let frame = foreground
            .apply_local_text_edit(edit.range, &edit.text)
            .expect("claim-clear local edit");

        assert_eq!(foreground.text().as_deref(), Some("let mut value = 1;\n"));
        assert!(
            producer_mirror.ingest_local_frame(&frame),
            "the producer imports the foreground's exact authored delta"
        );
        assert_eq!(producer_mirror.text(), foreground.text());

        let (after_lines, _, _) = code_buffer(&foreground.view()).expect("updated code buffer");
        assert!(!Arc::ptr_eq(&before_lines, &after_lines));
        assert_eq!(after_lines[0].text.as_ref(), "let mut value = 1;");
        let (idle_lines, _, _) = code_buffer(&foreground.view()).expect("idle code buffer");
        assert!(
            Arc::ptr_eq(&after_lines, &idle_lines),
            "the post-keystroke render cache is reused while idle"
        );
    }

    #[test]
    fn undo_redo_frames_keep_foreground_and_producer_mirror_converged() {
        let path = write_temp("history-mirror.rs", "let value = 1;\n");
        let identity = "port-daddy:console:history-mirror";
        let mut foreground = make_pane_as(&path, identity);
        let mut producer_mirror = make_pane_as(&path, identity);

        let foreground_initial = foreground.take_edit_receipts();
        let producer_initial = producer_mirror.take_edit_receipts();
        assert!(foreground_initial.complete && foreground_initial.receipts.is_empty());
        assert!(producer_initial.complete && producer_initial.receipts.is_empty());

        let edit_frame = foreground
            .apply_local_text_edit(4..9, "answer")
            .expect("local replacement");
        assert!(producer_mirror.ingest_local_frame(&edit_frame));
        assert_eq!(producer_mirror.text(), foreground.text());

        let undo_frame = foreground
            .undo_local_text_edit()
            .expect("undo is governed")
            .expect("one local undo item");
        assert_eq!(foreground.text().as_deref(), Some("let value = 1;\n"));
        assert!(producer_mirror.ingest_local_frame(&undo_frame));
        assert_eq!(producer_mirror.text(), foreground.text());
        assert!(
            !producer_mirror.ingest_local_frame(&undo_frame),
            "the producer reimports the exact frame idempotently"
        );

        let redo_frame = foreground
            .redo_local_text_edit()
            .expect("redo is governed")
            .expect("one local redo item");
        assert_eq!(foreground.text().as_deref(), Some("let answer = 1;\n"));
        assert!(producer_mirror.ingest_local_frame(&redo_frame));
        assert_eq!(producer_mirror.text(), foreground.text());
        assert!(
            !producer_mirror.ingest_local_frame(&redo_frame),
            "redo frame replay is also idempotent"
        );

        let foreground_batch = foreground.take_edit_receipts();
        let producer_batch = producer_mirror.take_edit_receipts();
        assert!(foreground_batch.complete);
        assert!(producer_batch.complete);
        let foreground_receipts = foreground_batch.receipts;
        let producer_receipts = producer_batch.receipts;
        assert_eq!(foreground_receipts.len(), 3);
        assert_eq!(producer_receipts, foreground_receipts);
        assert_eq!(foreground_receipts[0].deleted_text, "value");
        assert_eq!(foreground_receipts[0].inserted_text, "answer");
        assert_eq!(foreground_receipts[1].deleted_text, "answer");
        assert_eq!(foreground_receipts[1].inserted_text, "value");
        assert_eq!(foreground_receipts[2].deleted_text, "value");
        assert_eq!(foreground_receipts[2].inserted_text, "answer");
        let empty = foreground.take_edit_receipts();
        assert!(empty.complete);
        assert!(empty.receipts.is_empty(), "drain is exact");
    }

    #[test]
    fn foreground_and_producer_receipt_overflow_is_bounded_and_explicit() {
        let path = write_temp("receipt-overflow-mirror.txt", "x");
        let identity = "port-daddy:console:receipt-overflow-mirror";
        let mut foreground = make_pane_as(&path, identity);
        let mut producer_mirror = make_pane_as(&path, identity);

        for _ in 0..=crate::buffer::EDIT_RECEIPT_CAPACITY {
            let end = foreground.text().expect("foreground text").len();
            let frame = foreground
                .apply_local_text_edit(end..end, "x")
                .expect("local append");
            assert!(producer_mirror.ingest_local_frame(&frame));
        }

        for batch in [
            foreground.take_edit_receipts(),
            producer_mirror.take_edit_receipts(),
        ] {
            assert!(!batch.complete, "every mirror reports the discontinuity");
            assert!(
                batch.receipts.is_empty(),
                "no mirror retains or exposes a truncated receipt prefix"
            );
        }
    }

    #[test]
    fn text_noop_creates_one_history_item_but_no_fake_receipt() {
        let path = write_temp("noop-history.txt", "same\n");
        let mut pane = make_pane_as(&path, "port-daddy:console:noop-history");
        pane.apply_local_text_edit(0..4, "same")
            .expect("valid replacement is accepted");
        assert_eq!(pane.buffer().unwrap().undo_count(), 1);
        let batch = pane.take_edit_receipts();
        assert!(batch.complete);
        assert!(batch.receipts.is_empty());
    }

    #[test]
    fn ime_combining_grapheme_replacement_is_one_history_item() {
        let path = write_temp("ime-history.txt", "e\u{301}lan\n");
        let mut pane = make_pane_as(&path, "port-daddy:console:ime-history");
        let before = pane.text().expect("loaded text");
        let mut input = crate::editor_input::EditorInput::default();
        let edit = input.replace(&before, Some(0..2), "👩‍🚀", true, Some(5..5));
        pane.apply_local_text_edit(edit.range, &edit.text)
            .expect("IME replacement is accepted as one edit");

        assert_eq!(pane.text().as_deref(), Some("👩‍🚀lan\n"));
        assert_eq!(pane.buffer().unwrap().undo_count(), 1);
        pane.undo_local_text_edit()
            .expect("IME undo succeeds")
            .expect("one IME undo frame");
        assert_eq!(pane.text().as_deref(), Some("e\u{301}lan\n"));
        assert!(!pane.buffer().unwrap().can_undo());
    }

    #[test]
    fn local_keystroke_is_refused_inside_another_live_claim() {
        let path = write_temp("guarded-input.rs", "fn guarded() {}\nfn free() {}\n");
        let mut human = make_pane_as(&path, "port-daddy:console:human");
        let mut agent = make_pane_as(&path, "port-daddy:editor:agent");
        let claim = agent.acquire_region_claim(1, 1, "guarded", 1_000);
        assert!(human.ingest_claim(&claim));

        let before = human.text().unwrap();
        let refusal = human
            .apply_local_text_edit(3..3, " blocked")
            .expect_err("another live peer owns line 1");
        assert!(refusal.contains("is held by"));
        assert!(refusal.contains("live claim"));
        assert_eq!(human.text().as_deref(), Some(before.as_str()));
        for token in BYPASS {
            assert!(!refusal.to_ascii_lowercase().contains(token));
        }
    }

    fn assert_history_denied_without_mutation(pane: &mut EditorPane, redo: bool) {
        let before_text = pane.text().expect("loaded history text");
        let before_stamp = pane.buffer().unwrap().change_stamp();
        let before_undo_count = pane.buffer().unwrap().undo_count();
        let before_redo_count = pane.buffer().unwrap().redo_count();
        let before_receipts = pane.buffer().unwrap().edit_receipt_batch_snapshot();
        let refusal = if redo {
            pane.redo_local_text_edit()
        } else {
            pane.undo_local_text_edit()
        }
        .expect_err("an overlapping live claim must deny before history mutation");

        assert!(refusal.contains("is held by"));
        assert_eq!(pane.text().as_deref(), Some(before_text.as_str()));
        assert_eq!(pane.buffer().unwrap().change_stamp(), before_stamp);
        assert_eq!(pane.buffer().unwrap().undo_count(), before_undo_count);
        assert_eq!(pane.buffer().unwrap().redo_count(), before_redo_count);
        assert_eq!(
            pane.buffer().unwrap().edit_receipt_batch_snapshot(),
            before_receipts,
            "denial must preserve the authoritative receipt batch byte-for-byte"
        );
    }

    #[test]
    fn multiline_insertion_history_denies_every_touched_line_and_allows_adjacent_lines() {
        const BEFORE: &str = "adjacent-before\nanchor\nadjacent-after\n";
        const AFTER: &str = "adjacent-before\nanchor\nnew-one\nnew-two\nadjacent-after\n";
        let insertion = "adjacent-before\nanchor".len();

        for claimed_line in 2..=4 {
            let path = write_temp(&format!("guarded-history-line-{claimed_line}.rs"), BEFORE);
            let mut human = make_pane_as(
                &path,
                &format!("port-daddy:console:history-human-{claimed_line}"),
            );
            let mut agent = make_pane_as(
                &path,
                &format!("port-daddy:editor:history-claimant-{claimed_line}"),
            );
            human
                .apply_local_text_edit(insertion..insertion, "\nnew-one\nnew-two")
                .expect("initial multiline insertion is claim-clear");
            let authored = human.take_edit_receipts();
            assert!(authored.complete && authored.receipts.len() == 1);

            let undo_claim =
                agent.acquire_region_claim(claimed_line, claimed_line, "undo-touched-line", 1_000);
            assert!(human.ingest_claim(&undo_claim));
            assert_history_denied_without_mutation(&mut human, false);

            let release = agent.release_region_claim(0);
            assert!(human.ingest_claim(&release));
            human
                .undo_local_text_edit()
                .expect("released undo succeeds")
                .expect("released undo frame");
            let undone = human.take_edit_receipts();
            assert!(undone.complete && undone.receipts.len() == 1);

            let redo_claim =
                agent.acquire_region_claim(claimed_line, claimed_line, "redo-touched-line", 2_000);
            assert!(human.ingest_claim(&redo_claim));
            assert_history_denied_without_mutation(&mut human, true);
        }

        for adjacent_line in [1, 5] {
            let path = write_temp(&format!("adjacent-history-line-{adjacent_line}.rs"), BEFORE);
            let mut human = make_pane_as(
                &path,
                &format!("port-daddy:console:adjacent-human-{adjacent_line}"),
            );
            let mut agent = make_pane_as(
                &path,
                &format!("port-daddy:editor:adjacent-claimant-{adjacent_line}"),
            );
            human
                .apply_local_text_edit(insertion..insertion, "\nnew-one\nnew-two")
                .expect("initial multiline insertion is claim-clear");
            let authored = human.take_edit_receipts();
            assert!(authored.complete && authored.receipts.len() == 1);
            let adjacent_claim = agent.acquire_region_claim(
                adjacent_line,
                adjacent_line,
                "adjacent-unrelated",
                3_000,
            );
            assert!(human.ingest_claim(&adjacent_claim));

            human
                .undo_local_text_edit()
                .expect("adjacent claim does not deny undo")
                .expect("adjacent undo frame");
            assert_eq!(human.text().as_deref(), Some(BEFORE));
            let undone = human.take_edit_receipts();
            assert!(undone.complete && undone.receipts.len() == 1);
            human
                .redo_local_text_edit()
                .expect("adjacent claim does not deny redo")
                .expect("adjacent redo frame");
            assert_eq!(human.text().as_deref(), Some(AFTER));
            let redone = human.take_edit_receipts();
            assert!(redone.complete && redone.receipts.len() == 1);
        }
    }

    #[test]
    fn pure_deletion_history_checks_restored_line_without_touching_adjacent_line() {
        const BEFORE: &str = "open\nclaimed\nadjacent\n";
        const AFTER: &str = "openclaimed\nadjacent\n";

        let path = write_temp("guarded-deletion-history.rs", BEFORE);
        let mut human = make_pane_as(&path, "port-daddy:console:deletion-history-human");
        let mut agent = make_pane_as(&path, "port-daddy:editor:deletion-history-claimant");
        human
            .apply_local_text_edit(4..5, "")
            .expect("initial newline deletion is claim-clear");
        assert_eq!(human.text().as_deref(), Some(AFTER));
        let authored = human.take_edit_receipts();
        assert!(authored.complete && authored.receipts.len() == 1);

        let undo_claim = agent.acquire_region_claim(2, 2, "restored-line", 1_000);
        assert!(human.ingest_claim(&undo_claim));
        assert_history_denied_without_mutation(&mut human, false);
        let release = agent.release_region_claim(0);
        assert!(human.ingest_claim(&release));
        human
            .undo_local_text_edit()
            .expect("released deletion undo succeeds")
            .expect("deletion undo frame");
        let undone = human.take_edit_receipts();
        assert!(undone.complete && undone.receipts.len() == 1);

        let redo_claim = agent.acquire_region_claim(2, 2, "rejoined-line", 2_000);
        assert!(human.ingest_claim(&redo_claim));
        assert_history_denied_without_mutation(&mut human, true);

        let adjacent_path = write_temp("adjacent-deletion-history.rs", BEFORE);
        let mut adjacent_human =
            make_pane_as(&adjacent_path, "port-daddy:console:deletion-adjacent-human");
        let mut adjacent_agent = make_pane_as(
            &adjacent_path,
            "port-daddy:editor:deletion-adjacent-claimant",
        );
        adjacent_human
            .apply_local_text_edit(4..5, "")
            .expect("adjacent deletion fixture edit");
        let authored = adjacent_human.take_edit_receipts();
        assert!(authored.complete && authored.receipts.len() == 1);
        let adjacent_claim = adjacent_agent.acquire_region_claim(3, 3, "unrelated-line", 3_000);
        assert!(adjacent_human.ingest_claim(&adjacent_claim));
        adjacent_human
            .undo_local_text_edit()
            .expect("line three does not deny deletion undo")
            .expect("adjacent deletion undo frame");
        assert_eq!(adjacent_human.text().as_deref(), Some(BEFORE));
        let undone = adjacent_human.take_edit_receipts();
        assert!(undone.complete && undone.receipts.len() == 1);
        adjacent_human
            .redo_local_text_edit()
            .expect("line three does not deny deletion redo")
            .expect("adjacent deletion redo frame");
        assert_eq!(adjacent_human.text().as_deref(), Some(AFTER));
        let redone = adjacent_human.take_edit_receipts();
        assert!(redone.complete && redone.receipts.len() == 1);
    }

    #[test]
    fn neutralized_undo_top_cannot_skip_an_older_claimed_item() {
        const BEFORE: &str = "older\nneutral\nadjacent\n";
        let path = write_temp("neutralized-undo-claim.rs", BEFORE);
        let mut human = make_pane_as(&path, "port-daddy:console:neutralized-undo-human");
        human
            .apply_local_text_edit(0..0, "OLD-")
            .expect("older line edit");
        let top = human.text().unwrap().find("neutral").unwrap();
        human
            .apply_local_text_edit(top..top, "TOP-")
            .expect("top line edit");

        let peer = HarborBuffer::empty("port-daddy:editor:neutralized-undo-peer");
        peer.apply_remote_ops(&human.buffer().unwrap().export_ops())
            .unwrap();
        let peer_text = peer.to_string();
        let top = peer_text.find("TOP-").unwrap();
        let top_unicode = peer_text[..top].chars().count();
        let deletion = peer.replace_authored(top_unicode..top_unicode + 4, "");
        let frame = crate::editor_sync::encode_frame(peer.local_peer(), &deletion.delta);
        assert!(human.ingest_frame(&frame));
        assert_eq!(
            human.text().as_deref(),
            Some("OLD-older\nneutral\nadjacent\n")
        );
        assert_eq!(
            (
                human.buffer().unwrap().undo_count(),
                human.buffer().unwrap().redo_count()
            ),
            (2, 0)
        );

        let mut claimant = make_pane_as(&path, "port-daddy:editor:neutralized-undo-claimant");
        let overlap = claimant.acquire_region_claim(1, 1, "older-item", 1_000);
        assert!(human.ingest_claim(&overlap));
        assert_history_denied_without_mutation(&mut human, false);

        let release = claimant.release_region_claim(0);
        assert!(human.ingest_claim(&release));
        let adjacent = claimant.acquire_region_claim(3, 3, "adjacent-line", 2_000);
        assert!(human.ingest_claim(&adjacent));
        human
            .undo_local_text_edit()
            .expect("adjacent claim permits multi-pop undo")
            .expect("older effective undo frame");
        assert_eq!(human.text().as_deref(), Some(BEFORE));
        assert_eq!(
            (
                human.buffer().unwrap().undo_count(),
                human.buffer().unwrap().redo_count()
            ),
            (0, 1)
        );

        let release = claimant.release_region_claim(1);
        assert!(human.ingest_claim(&release));
        let overlap = claimant.acquire_region_claim(1, 1, "older-redo", 3_000);
        assert!(human.ingest_claim(&overlap));
        assert_history_denied_without_mutation(&mut human, true);

        let release = claimant.release_region_claim(2);
        assert!(human.ingest_claim(&release));
        let adjacent = claimant.acquire_region_claim(3, 3, "adjacent-redo", 4_000);
        assert!(human.ingest_claim(&adjacent));
        human
            .redo_local_text_edit()
            .expect("adjacent claim permits reconciled redo")
            .expect("older redo frame");
        assert_eq!(
            human.text().as_deref(),
            Some("OLD-older\nneutral\nadjacent\n")
        );
    }

    #[test]
    fn neutralized_newline_redo_cannot_skip_an_older_claimed_item() {
        const BEFORE: &str = "claim\nvictim\n";
        let path = write_temp("neutralized-redo-claim.rs", BEFORE);
        let mut human = make_pane_as(&path, "port-daddy:console:neutralized-redo-human");
        human
            .apply_local_text_edit(5..6, "")
            .expect("delete newline as older authored item");
        let end = human.text().unwrap().len();
        human
            .apply_local_text_edit(end..end, "OLDER")
            .expect("newer authored item");
        human.undo_local_text_edit().unwrap().unwrap();
        human.undo_local_text_edit().unwrap().unwrap();
        assert_eq!(human.text().as_deref(), Some(BEFORE));
        assert_eq!(
            (
                human.buffer().unwrap().undo_count(),
                human.buffer().unwrap().redo_count()
            ),
            (0, 2)
        );

        let peer = HarborBuffer::empty("port-daddy:editor:neutralized-redo-peer");
        peer.apply_remote_ops(&human.buffer().unwrap().export_ops())
            .unwrap();
        let deletion = peer.replace_authored(5..6, "");
        let frame = crate::editor_sync::encode_frame(peer.local_peer(), &deletion.delta);
        assert!(human.ingest_frame(&frame));
        assert_eq!(human.text().as_deref(), Some("claimvictim\n"));

        let mut claimant = make_pane_as(&path, "port-daddy:editor:neutralized-redo-claimant");
        let claim = claimant.acquire_region_claim(2, 2, "older-redo-target", 1_000);
        assert!(human.ingest_claim(&claim));
        assert_history_denied_without_mutation(&mut human, true);

        let release = claimant.release_region_claim(0);
        assert!(human.ingest_claim(&release));
        human
            .redo_local_text_edit()
            .expect("released multi-pop redo succeeds")
            .expect("older redo frame");
        assert_eq!(human.text().as_deref(), Some("claimvictim\nOLDER"));
        assert_eq!(
            (
                human.buffer().unwrap().undo_count(),
                human.buffer().unwrap().redo_count()
            ),
            (1, 0)
        );
    }

    #[test]
    fn repeated_remote_shift_history_denies_shifted_line_and_allows_adjacent_lines() {
        const BEFORE: &str = "abcd\ntail\n";
        const PREFIX: &str = "REMOTE\n";
        let cases = [
            ("insertion", 2..2, "LOCAL", "abLOCALcd\ntail\n"),
            ("replacement", 1..3, "XY", "aXYd\ntail\n"),
            ("deletion", 1..3, "", "ad\ntail\n"),
        ];

        for (name, range, replacement, expected_after) in cases {
            let path = write_temp(&format!("repeated-history-{name}.rs"), BEFORE);
            let mut human = make_pane_as(
                &path,
                &format!("port-daddy:console:repeated-history-{name}"),
            );
            human
                .apply_local_text_edit(range, replacement)
                .expect("initial local edit is accepted");
            human
                .undo_local_text_edit()
                .expect("first undo succeeds")
                .expect("first undo frame");

            let peer = HarborBuffer::empty(format!("port-daddy:editor:remote-shift-{name}"));
            peer.apply_remote_ops(&human.buffer().unwrap().export_ops())
                .expect("peer joins after first undo");
            let remote = peer.replace_authored(0..0, PREFIX);
            let remote_frame = crate::editor_sync::encode_frame(peer.local_peer(), &remote.delta);
            assert!(human.ingest_frame(&remote_frame));

            human
                .redo_local_text_edit()
                .expect("first redo succeeds after remote shift")
                .expect("first redo frame");
            assert_eq!(
                human.text().as_deref(),
                Some(format!("{PREFIX}{expected_after}").as_str())
            );
            human
                .undo_local_text_edit()
                .expect("second undo succeeds")
                .expect("second undo frame");
            assert_eq!(
                human.text().as_deref(),
                Some(format!("{PREFIX}{BEFORE}").as_str())
            );

            let queued = human.buffer().unwrap().edit_receipt_batch_snapshot();
            assert!(queued.complete);
            assert_eq!(
                queued.receipts.len(),
                5,
                "accepted edit, undo, import, redo, and second undo remain queued"
            );

            let mut claimant = make_pane_as(
                &path,
                &format!("port-daddy:editor:repeated-claimant-{name}"),
            );
            let overlap = claimant.acquire_region_claim(2, 2, "shifted-actual-line", 1_000);
            assert!(human.ingest_claim(&overlap));
            assert_history_denied_without_mutation(&mut human, true);

            let release_overlap = claimant.release_region_claim(0);
            assert!(human.ingest_claim(&release_overlap));
            let before_adjacent = claimant.acquire_region_claim(1, 1, "adjacent-before", 2_000);
            assert!(human.ingest_claim(&before_adjacent));
            human
                .redo_local_text_edit()
                .expect("preceding adjacent line allows redo")
                .expect("adjacent redo frame");
            human
                .undo_local_text_edit()
                .expect("preceding adjacent line allows undo")
                .expect("adjacent undo frame");

            let release_before = claimant.release_region_claim(1);
            assert!(human.ingest_claim(&release_before));
            let after_adjacent = claimant.acquire_region_claim(3, 3, "adjacent-after", 3_000);
            assert!(human.ingest_claim(&after_adjacent));
            human
                .redo_local_text_edit()
                .expect("following adjacent line allows redo")
                .expect("following adjacent redo frame");
            human
                .undo_local_text_edit()
                .expect("following adjacent line allows undo")
                .expect("following adjacent undo frame");
        }
    }

    #[test]
    fn deleting_a_newline_checks_the_claim_on_both_joined_lines() {
        let path = write_temp("guarded-newline.rs", "open\nclaimed\n");
        let mut human = make_pane_as(&path, "port-daddy:console:human");
        let mut agent = make_pane_as(&path, "port-daddy:editor:agent");
        let claim = agent.acquire_region_claim(2, 2, "claimed", 1_000);
        assert!(human.ingest_claim(&claim));

        let before = human.text().unwrap();
        let refusal = human
            .apply_local_text_edit(4..5, "")
            .expect_err("joining into a claimed line must be refused");
        assert!(refusal.contains("is held by"));
        assert_eq!(human.text().as_deref(), Some(before.as_str()));
    }

    /// A Rust file's lines carry syntax runs (keyword/type/string classified)
    /// that exactly cover each line's text.
    #[test]
    fn code_lines_carry_syntax_runs_for_rust() {
        use crate::pane::SyntaxKind;
        let path = write_temp("syn.rs", "pub fn go(n: u32) -> String { \"hi\" }\n");
        let pane = make_pane(&path, None);
        let r = rows(&pane.view());
        assert_eq!(r.len(), 1);
        let covered: u32 = r[0].runs.iter().map(|(len, _)| len).sum();
        assert_eq!(
            covered as usize,
            r[0].text.len(),
            "runs exactly cover the line"
        );
        let kinds: Vec<SyntaxKind> = r[0].runs.iter().map(|(_, k)| *k).collect();
        assert!(
            kinds.contains(&SyntaxKind::Keyword),
            "pub/fn classify as keywords"
        );
        assert!(
            kinds.contains(&SyntaxKind::Type),
            "u32/String classify as types"
        );
        assert!(
            kinds.contains(&SyntaxKind::Str),
            "the literal classifies as a string"
        );
    }

    /// Claims and the conflict wedge render as BACKGROUND bands on the code
    /// buffer (the wedge last, so it wins overlaps) — not per-line chrome.
    #[test]
    fn claims_and_wedge_render_as_background_bands() {
        let path = write_temp("bands.txt", "l1\nl2\nl3\nl4\nl5\n");
        let mut pane = make_pane_as(&path, "port-daddy:editor:agent-A");

        // A remote actor's claim lands → one actor-toned band over L2–4.
        let mut other = make_pane_as(&path, "port-daddy:console:human-B");
        let frame = other.acquire_region_claim(2, 4, "parse_header", 500);
        assert!(pane.ingest_claim(&frame));
        let (_, bands, _) = code_buffer(&pane.view()).expect("code buffer");
        assert!(
            bands.iter().any(|b| b.covers(3) && b.tone == Tone::Engaged),
            "a remote claim is an Engaged background band: {bands:?}"
        );

        // A blocking predict raises the Conflicted wedge band LAST (it wins).
        pane.acquire_region_claim(2, 4, "parse_header", 1_000);
        let _ = pane.take_wedge_probe(1_400).expect("probe due");
        let blocking = serde_json::json!({
            "success": true, "count": 1, "blocking": 1, "warnings": 0, "info": 0,
            "conflicts": [{ "severity": "blocking" }],
        });
        assert!(pane.apply_conflict_report(&blocking, 1_500));
        let (_, bands, _) = code_buffer(&pane.view()).expect("code buffer");
        let last_covering = bands
            .iter()
            .rev()
            .find(|b| b.covers(3))
            .expect("a band covers L3");
        assert_eq!(
            last_covering.tone,
            Tone::Conflicted,
            "the wedge band wins overlaps"
        );
    }

    #[test]
    fn title_is_basename_only() {
        let pane = EditorPane::new("core/pd-console/src/mux.rs", None);
        assert_eq!(pane.title(), "edit mux.rs");
    }

    /// The authorship gutter renders. After an agent replica's line merges into the
    /// opener's buffer, the pane shows BOTH an operator legend flag and an agent
    /// legend flag, and the agent's line carries a DIFFERENT gutter author tag than
    /// the operator's lines. This is the visible per-PeerID authorship proof.
    #[test]
    fn authorship_gutter_distinguishes_operator_and_agent_lines() {
        let path = write_temp("authorship.txt", "human line\n");
        let pane = make_pane(&path, None);

        let opener = pane.buffer().expect("buffer loaded").local_peer();

        // A second replica (an agent) joins from the opener's state and adds a line.
        let agent_id = "port-daddy:editor:agent-X";
        let agent = HarborBuffer::empty(agent_id);
        agent
            .apply_remote_ops(&pane.buffer().unwrap().export_ops())
            .expect("agent imports operator state");
        agent.append_line("agent added this");

        // Merge the agent's ops into the pane's buffer.
        pane.buffer()
            .unwrap()
            .apply_remote_ops(&agent.export_ops())
            .expect("operator imports agent ops");

        let blocks = pane.view();

        // Two authorship legend flags: operator (Resting) + agent (Engaged).
        let resting_flag = blocks.iter().any(
            |b| matches!(b, Block::Flag { tone: Tone::Resting, label, .. } if label.contains("operator")),
        );
        let engaged_flag = blocks
            .iter()
            .any(|b| matches!(b, Block::Flag { tone: Tone::Engaged, label, .. } if label.contains("agent")));
        assert!(
            resting_flag,
            "operator authorship legend flag (Resting) must render"
        );
        assert!(
            engaged_flag,
            "agent authorship legend flag (Engaged) must render once an agent line merges"
        );

        // The two lines carry different gutter author tags, and a REAL second
        // author flips show_authors on (the only time tags render).
        let (lines, _, show_authors) = code_buffer(&blocks).expect("a code buffer renders");
        assert!(
            show_authors,
            "a merged agent line makes author tags visible"
        );
        assert_eq!(lines.len(), 2, "human line + merged agent line");
        let human_tag = author_tag(opener);
        let agent_tag = author_tag(peer_id_for_identity(agent_id));
        assert_eq!(lines[0].author_tag.as_deref(), Some(human_tag.as_str()));
        assert_eq!(lines[1].author_tag.as_deref(), Some(agent_tag.as_str()));
        assert_ne!(
            human_tag, agent_tag,
            "distinct replicas carry distinct tags"
        );
        assert_eq!(lines[1].text.as_ref(), "agent added this");
    }

    /// The author→Tone mapping is the checked contract behind the gutter color:
    /// opener is Resting, any other replica is Engaged, unknown is Default.
    #[test]
    fn author_tone_maps_opener_to_resting_and_agents_to_engaged() {
        let opener = peer_id_for_identity("port-daddy:console:operator");
        let agent = peer_id_for_identity("port-daddy:editor:agent-Y");
        assert!(matches!(author_tone(Some(opener), opener), Tone::Resting));
        assert!(matches!(author_tone(Some(agent), opener), Tone::Engaged));
        assert!(matches!(author_tone(None, opener), Tone::Default));
    }

    /// A loaded editor declares its intent to watch the file's op-stream channel;
    /// an errored/empty pane subscribes to nothing (no buffer to fold ops into).
    #[test]
    fn subscription_targets_the_files_channel_once_loaded() {
        let path = write_temp("sub.txt", "hello\n");
        let pane = make_pane(&path, None);
        match pane.subscription() {
            Some(Subscription::Editor {
                channel,
                coord_channel,
            }) => {
                assert_eq!(channel, crate::editor_sync::channel_for_path(&path));
                assert_eq!(channel, pane.channel());
                // Slice-3 isolation: the coordination lane is a SEPARATE channel.
                assert_eq!(
                    coord_channel,
                    crate::editor_sync::coordination_channel_for_path(&path)
                );
                assert_eq!(coord_channel, pane.coordination_channel());
                assert_ne!(
                    channel, coord_channel,
                    "edit-sync and coordination ride distinct channels"
                );
            }
            other => panic!("a loaded editor must subscribe to its file channel, got {other:?}"),
        }
        // An unreadable file → no buffer → nothing to fold into → no subscription.
        let errored = make_pane("/nonexistent/does/not/exist.rs", None);
        assert!(errored.subscription().is_none());
    }

    /// THE PANE-LEVEL SLICE-1 PROOF: a second replica's Loro op frame, delivered as
    /// a tube message's text, lands in this pane's buffer and renders as an
    /// agent-authored line. Self-echoes and garbage are ignored.
    #[test]
    fn remote_op_frame_rides_the_tube_and_lands_in_the_pane_buffer() {
        let path = write_temp("wire-pane.txt", "human line\n");
        let mut pane = make_pane(&path, None);
        let opener = pane.buffer().expect("buffer loaded").local_peer();

        // A second replica (agent) joins from the opener's state, adds a line, and
        // its ops become a tube frame — the exact string that would arrive on the
        // pane's channel subscription.
        let agent_id = "port-daddy:editor:agent-wire";
        let agent = HarborBuffer::empty(agent_id);
        agent
            .apply_remote_ops(&pane.buffer().unwrap().export_ops())
            .expect("agent imports opener state");
        agent.append_line("agent added over the wire");
        let frame = crate::editor_sync::encode_frame(agent.local_peer(), &agent.export_ops());

        // The pane folds the frame off its channel — the transport landing.
        assert!(
            pane.ingest_frame(&frame),
            "a remote op frame must land in the buffer"
        );

        // The pane now renders the agent's line with agent authorship.
        let blocks = pane.view();
        let r = rows(&blocks);
        assert_eq!(r.len(), 2, "human line + wired-in agent line");
        assert_eq!(r[1].text.as_ref(), "agent added over the wire");
        let agent_tag = author_tag(peer_id_for_identity(agent_id));
        assert_eq!(
            r[1].author_tag.as_deref(),
            Some(agent_tag.as_str()),
            "the wired-in line carries the agent's author tag"
        );
        assert!(
            blocks.iter().any(|b| matches!(
                b,
                Block::Flag { tone: Tone::Engaged, label, .. } if label.contains("agent")
            )),
            "the agent authorship legend flag renders once a remote op lands"
        );

        // A frame authored by THIS replica (its own ops echoed back) is a no-op,
        // and a non-frame is skipped — neither corrupts the buffer.
        let self_frame =
            crate::editor_sync::encode_frame(opener, &pane.buffer().unwrap().export_ops());
        assert!(
            !pane.ingest_frame(&self_frame),
            "our own echoed ops must not re-fold"
        );
        assert!(
            !pane.ingest_frame("not a frame at all"),
            "garbage is ignored"
        );
        assert_eq!(
            rows(&pane.view()).len(),
            2,
            "buffer unchanged by self-echo/garbage"
        );
    }

    // ── P2 slice 2: presence lane ─────────────────────────────────────────────

    /// Count how many presence ('C') legend flags a view emits — how many remote
    /// cursors are on screen.
    fn cursor_flags(blocks: &[Block]) -> usize {
        blocks
            .iter()
            .filter(|b| matches!(b, Block::Flag { letter: 'C', .. }))
            .count()
    }

    /// Encode a presence frame from a distinct remote replica, the exact string
    /// that would arrive on this pane's channel subscription.
    fn remote_presence_frame(identity: &str, state: PresenceState) -> String {
        let peer = peer_id_for_identity(identity);
        let store = PresenceStore::new(peer);
        encode_presence_frame(peer, &store.publish(state))
    }

    /// A remote replica's cursor rides the tube-shaped presence frame, lands in the
    /// pane's pool keyed by its PeerId, and renders as a presence legend flag.
    #[test]
    fn remote_presence_frame_pools_and_renders() {
        let path = write_temp("presence-pane.txt", "l1\nl2\nl3\nl4\n");
        let mut pane = make_pane(&path, None);
        assert!(
            pane.remote_cursors().is_empty(),
            "no remote cursors before any frame"
        );

        let a = "port-daddy:editor:agent-A";
        let b = "port-daddy:editor:agent-B";
        let frame_a = remote_presence_frame(a, PresenceState::caret(2, 0, 1, 4));
        let frame_b = remote_presence_frame(
            b,
            PresenceState {
                cursor_line: 3,
                cursor_col: 1,
                anchor_line: 4,
                anchor_col: 0,
                top_line: 1,
                bottom_line: 4,
            },
        );

        assert!(
            pane.ingest_presence(&frame_a),
            "A's cursor is a real change"
        );
        assert!(
            pane.ingest_presence(&frame_b),
            "B's cursor is a real change"
        );

        let pool = pane.remote_cursors();
        assert_eq!(pool.len(), 2, "both remote cursors pooled");
        assert_eq!(
            pool.get(&peer_id_for_identity(a)).map(|s| s.cursor_line),
            Some(2)
        );
        assert_eq!(
            cursor_flags(&pane.view()),
            2,
            "two presence legend flags render"
        );

        // A non-presence frame (an op frame) and garbage are ignored by the lane.
        let op = crate::editor_sync::encode_frame(peer_id_for_identity(a), &[1, 2, 3]);
        assert!(!pane.ingest_presence(&op), "an op frame is not presence");
        assert!(!pane.ingest_presence("not a frame"), "garbage is ignored");
    }

    /// The local caret's outbound presence is debounced: a burst of moves flushes
    /// at most once per interval, and the frame carries THIS replica's PeerId.
    #[test]
    fn local_presence_broadcast_is_debounced() {
        let path = write_temp("presence-out.txt", "hello\n");
        let mut pane = make_pane(&path, None);
        let local = peer_id_for_identity("port-daddy:console:operator");

        // Nothing moved yet → nothing to broadcast.
        assert!(pane.take_presence_broadcast(0).is_none());

        // A burst of caret moves before the first tick coalesces to the latest.
        pane.set_local_presence(PresenceState::caret(1, 0, 1, 1));
        pane.set_local_presence(PresenceState::caret(1, 3, 1, 1));
        let frame = pane
            .take_presence_broadcast(1_000)
            .expect("a due move broadcasts");
        let decoded = decode_presence_frame(&frame).expect("the broadcast is a presence frame");
        assert_eq!(
            decoded.peer, local,
            "the frame is attributed to THIS replica"
        );

        // Within the interval, a further move does not flush again.
        pane.set_local_presence(PresenceState::caret(1, 4, 1, 1));
        assert!(
            pane.take_presence_broadcast(1_020).is_none(),
            "suppressed inside the debounce window"
        );
        // Past the interval it flushes.
        assert!(
            pane.take_presence_broadcast(1_500).is_some(),
            "flushes after the interval"
        );
    }

    /// A real multi-line local selection mirrors into a durable region claim; a
    /// bare caret does not (nothing durable to record).
    #[test]
    fn local_selection_mirrors_to_a_durable_region_claim() {
        let path = write_temp("claim-mirror.txt", "a\nb\nc\nd\ne\n");
        let mut pane = make_pane(&path, None);

        // A bare caret → no region claim.
        pane.set_local_presence(PresenceState::caret(2, 0, 1, 5));
        assert_eq!(pane.region_claim(), None, "a caret is not a durable claim");

        // Select lines 2..=4 (drag upward: caret above anchor) → a region claim
        // spanning 2..4, mirrored against the file's real path.
        pane.set_local_presence(PresenceState {
            cursor_line: 2,
            cursor_col: 0,
            anchor_line: 4,
            anchor_col: 1,
            top_line: 1,
            bottom_line: 5,
        });
        assert_eq!(
            pane.region_claim(),
            Some((path.clone(), 2, 4)),
            "a selection mirrors to a (path, startLine, endLine) region claim"
        );
    }

    /// THE P2 SLICE-2 GATE — an idle screen with 2+ remote cursors must schedule
    /// ZERO re-renders. We drive ~4 seconds of 60fps idle ticks with two remote
    /// cursors established and assert that every repaint-gating call
    /// (`ingest_presence`/`take_presence_broadcast`/`expire_presence`) reports NO
    /// change, and that pure reads (`view`/`remote_cursors`) never mutate. This is
    /// the machine-checked proof behind "no per-peer window-wide `repeat()`": the
    /// gpui face notifies only on the change edges this test holds at zero.
    #[test]
    fn idle_screen_does_not_rerender_with_multiple_remote_cursors() {
        let path = write_temp("presence-idle.txt", "l1\nl2\nl3\nl4\nl5\n");
        let mut pane = make_pane(&path, None);

        // Establish two remote cursors — two genuine repaint edges.
        let a = "port-daddy:editor:agent-A";
        let b = "port-daddy:editor:agent-B";
        let store_a = PresenceStore::new(peer_id_for_identity(a));
        let store_b = PresenceStore::new(peer_id_for_identity(b));
        let frame_a = encode_presence_frame(
            store_a.local(),
            &store_a.publish(PresenceState::caret(2, 0, 1, 5)),
        );
        let frame_b = encode_presence_frame(
            store_b.local(),
            &store_b.publish(PresenceState::caret(4, 1, 1, 5)),
        );
        assert!(
            pane.ingest_presence(&frame_a),
            "A's first cursor repaints once"
        );
        assert!(
            pane.ingest_presence(&frame_b),
            "B's first cursor repaints once"
        );
        assert_eq!(pane.remote_cursors().len(), 2, "two cursors are on screen");

        // Idle: nothing changes. Count every repaint-worthy edge over 240 ticks.
        let mut repaints = 0usize;
        for tick in 0..240i64 {
            let now = 1_000 + tick * 16; // ~60fps
                                         // Pure reads must never mutate or repaint on their own.
            let _ = pane.view();
            let _ = pane.remote_cursors();
            // Re-delivering the SAME frames (stale LWW) folds to no change.
            if pane.ingest_presence(&frame_a) {
                repaints += 1;
            }
            if pane.ingest_presence(&frame_b) {
                repaints += 1;
            }
            // No local movement → nothing to broadcast.
            if pane.take_presence_broadcast(now).is_some() {
                repaints += 1;
            }
            // Expiry before the timeout removes nobody.
            if pane.expire_presence() {
                repaints += 1;
            }
        }
        assert_eq!(
            repaints, 0,
            "an idle screen with 2+ remote cursors must not re-render"
        );
        assert_eq!(
            pane.remote_cursors().len(),
            2,
            "both cursors still present after idle"
        );

        // The gate is not vacuous: a GENUINE new remote cursor repaints exactly
        // once (a new PeerId is unambiguously a pool change, independent of clock
        // resolution), and replaying that same frame does not.
        let c = "port-daddy:editor:agent-C";
        let store_c = PresenceStore::new(peer_id_for_identity(c));
        let frame_c = encode_presence_frame(
            store_c.local(),
            &store_c.publish(PresenceState::caret(5, 2, 1, 5)),
        );
        assert!(
            pane.ingest_presence(&frame_c),
            "a genuine new cursor re-renders once"
        );
        assert!(
            !pane.ingest_presence(&frame_c),
            "replaying that same frame does not re-render"
        );
        assert_eq!(
            pane.remote_cursors().len(),
            3,
            "the new cursor joined the pool"
        );
    }

    // ── P2 slice 3: durability + isolation ────────────────────────────────────

    /// THE PANE-LEVEL SLICE-3 DURABILITY PROOF: a pane exports its buffer as a
    /// snapshot blob (the bytes that would land in `/blob`); a COLD pane — a
    /// reconnecting replica that never saw the live op stream — hydrates
    /// from ONLY that blob and renders the same content, with authorship intact.
    #[test]
    fn cold_pane_hydrates_from_a_snapshot_blob() {
        // A live editor with an operator line + a merged agent line.
        let path = write_temp("snapshot-src.txt", "operator seed\n");
        let live = make_pane(&path, None);
        let agent_id = "port-daddy:editor:agent-snap";
        let agent = HarborBuffer::empty(agent_id);
        agent
            .apply_remote_ops(&live.buffer().unwrap().export_ops())
            .unwrap();
        agent.append_line("agent added before the crash");
        live.buffer()
            .unwrap()
            .apply_remote_ops(&agent.export_ops())
            .unwrap();

        // Export the snapshot blob — content-addressed durability.
        let snapshot = live.snapshot_blob().expect("a loaded pane snapshots");

        // A cold successor pane (no file on disk) hydrates from ONLY the blob.
        let mut cold = EditorPane::new_with_identity(&path, None, "port-daddy:console:successor");
        assert!(
            cold.buffer().is_none(),
            "cold pane has no buffer before hydrate"
        );
        assert!(
            cold.hydrate_from_snapshot(&snapshot),
            "the snapshot blob hydrates the cold pane"
        );

        // It renders both lines, each attributed to its original author.
        let blocks = cold.view();
        let r = rows(&blocks);
        assert_eq!(
            r.len(),
            2,
            "operator + agent lines survived to the cold replica via /blob"
        );
        assert_eq!(r[1].text.as_ref(), "agent added before the crash");
        let agent_tag = author_tag(peer_id_for_identity(agent_id));
        assert_eq!(
            r[1].author_tag.as_deref(),
            Some(agent_tag.as_str()),
            "the agent's line keeps the agent's author tag after checkpoint restore"
        );

        // Hydrating the same snapshot again is idempotent (duplicate-delivery safety).
        assert!(cold.hydrate_from_snapshot(&snapshot));
        let after = cold.view();
        assert_eq!(
            rows(&after).len(),
            2,
            "re-hydrating the snapshot must not duplicate lines"
        );
    }

    // ── P3 slice 1: claims-as-awareness ───────────────────────────────────────

    /// Count the region-claim ('R') legend flags a view emits.
    fn claim_flags(blocks: &[Block]) -> usize {
        blocks
            .iter()
            .filter(|b| matches!(b, Block::Flag { letter: 'R', .. }))
            .count()
    }

    fn make_pane_as(path: &str, identity: &str) -> EditorPane {
        let mut p = EditorPane::new_with_identity(path, None, identity);
        p.load();
        p
    }

    /// THE PANE-LEVEL P3 SLICE-1 PROOF: a region claim acquired on pane A rides the
    /// COORDINATION channel as an awareness frame, lands in remote pane B's ledger, and
    /// renders as an actor-colored 'R' band. Self-echoes and garbage are ignored.
    #[test]
    fn region_claim_rides_the_coord_lane_and_lands_in_a_remote_pane() {
        let path = write_temp("claim-wire.txt", "l1\nl2\nl3\nl4\nl5\n");
        let mut pane_a = make_pane_as(&path, "port-daddy:editor:agent-A");
        let mut pane_b = make_pane_as(&path, "port-daddy:console:human-B");

        // Both panes agree on the coordination channel (pure function of the path).
        assert_eq!(pane_a.coordination_channel(), pane_b.coordination_channel());
        assert!(
            pane_b.claim_ledger().is_empty(),
            "no claims before any frame"
        );

        // A claims parse_header over lines 2–4; the returned frame is what A would
        // broadcast_claim() on the coordination channel.
        let frame = pane_a.acquire_region_claim(2, 4, "parse_header", 1_000);
        assert_eq!(
            pane_a.claim_ledger().len(),
            1,
            "A sees its own claim immediately"
        );

        // B folds the frame off its coordination subscription.
        assert!(
            pane_b.ingest_claim(&frame),
            "a remote claim frame changes B's ledger"
        );
        let a_peer = peer_id_for_identity("port-daddy:editor:agent-A");
        let owners = pane_b.claim_ledger().owners_of_line(3);
        assert_eq!(owners.len(), 1, "line 3 is claimed on B");
        assert_eq!(owners[0].peer, a_peer, "the claim is attributed to A");
        assert_eq!(owners[0].label, "parse_header");

        // B renders exactly one 'R' band naming A as a peer working parse_header.
        let blocks = pane_b.view();
        assert_eq!(claim_flags(&blocks), 1, "one claim band renders on B");
        assert!(
            blocks.iter().any(|b| matches!(
                b,
                Block::Flag { letter: 'R', tone: Tone::Engaged, label } if label.contains("parse_header")
            )),
            "a remote peer's claim band is Engaged-toned and labeled with the work name"
        );

        // Re-delivering the same frame (stale LWW) is no change; garbage is ignored.
        assert!(
            !pane_b.ingest_claim(&frame),
            "replaying the same claim frame does not re-render"
        );
        assert!(
            !pane_b.ingest_claim("not a claim frame"),
            "garbage is ignored"
        );
        // A op frame is not a claim (lane isolation at the pane boundary).
        let op = crate::editor_sync::encode_frame(a_peer, &[1, 2, 3]);
        assert!(
            !pane_b.ingest_claim(&op),
            "an edit-lane op frame is not a claim"
        );
    }

    /// THE PANE-LEVEL REGION-GRANULARITY PROOF: two panes claim DISJOINT adjacent
    /// regions of the SAME file and both coexist — claiming one symbol's line range
    /// never locks the rest of the file (HARD RULE 1 at the pane boundary).
    #[test]
    fn pane_region_claim_does_not_lock_the_rest_of_the_file() {
        let big: String = (0..300).map(|i| format!("line {i}\n")).collect();
        let path = write_temp("claim-region.txt", &big);
        let mut pane_a = make_pane_as(&path, "port-daddy:editor:agent-A");
        let mut pane_b = make_pane_as(&path, "port-daddy:editor:agent-B");

        // A claims parse_header (L12–40); B claims write_footer (L200–260). Exchange.
        let a_frame = pane_a.acquire_region_claim(12, 40, "parse_header", 1);
        let b_frame = pane_b.acquire_region_claim(200, 260, "write_footer", 2);
        assert!(pane_b.ingest_claim(&a_frame), "B folds A's claim");
        assert!(pane_a.ingest_claim(&b_frame), "A folds B's claim");

        // Both panes converge to the same two-claim ledger.
        for pane in [&pane_a, &pane_b] {
            let led = pane.claim_ledger();
            assert_eq!(led.len(), 2, "two disjoint claims coexist on one file");
            assert_eq!(
                led.owners_of_line(25)[0].label,
                "parse_header",
                "L25 is the header claim"
            );
            assert_eq!(
                led.owners_of_line(230)[0].label,
                "write_footer",
                "L230 is the footer claim"
            );
            assert!(
                led.owners_of_line(100).is_empty(),
                "the gap between the regions stays free"
            );
            assert!(
                led.owners_of_line(1).is_empty(),
                "the file head is unclaimed"
            );
        }

        // Region-scoped, not file-scoped: A's own header line is not an 'other' claim
        // to A, but B's footer line is — on the very same file.
        let a_peer = peer_id_for_identity("port-daddy:editor:agent-A");
        let led = pane_a.claim_ledger();
        assert!(
            !led.is_line_claimed_by_other(25, a_peer),
            "A's own region is not foreign to A"
        );
        assert!(
            led.is_line_claimed_by_other(230, a_peer),
            "B's region IS foreign to A"
        );
        assert!(
            !led.is_line_claimed_by_other(100, a_peer),
            "the free gap is foreign to nobody"
        );
    }

    /// The durable claim mirror is debounced at the pane level: an acquire is due once,
    /// carries the right span/label/path, then is suppressed inside the window.
    #[test]
    fn claim_mirror_is_debounced_at_pane_level() {
        let path = write_temp("claim-mirror-pane.txt", "a\nb\nc\nd\ne\n");
        let mut pane = make_pane_as(&path, "port-daddy:editor:agent-A");

        // Nothing acquired → nothing to mirror.
        assert!(
            pane.take_claim_mirror(0).is_empty(),
            "an idle pane mirrors no claims"
        );

        // Acquire two disjoint claims before the first mirror tick.
        pane.acquire_region_claim(2, 3, "parse_header", 10);
        pane.acquire_region_claim(5, 5, "write_footer", 11);
        let due = pane.take_claim_mirror(20);
        assert_eq!(
            due.len(),
            2,
            "both acquired claims are due for the durable mirror"
        );
        assert!(due
            .iter()
            .any(|c| c.label == "parse_header" && c.line_span() == (2, 3)));
        // The caller POSTs each against this pane's path via DaemonClient::claim_region.
        assert_eq!(
            pane.path_str(),
            path,
            "the mirror targets the pane's real file path"
        );

        // Within the interval a further acquire does not flush again.
        pane.acquire_region_claim(1, 1, "imports", 30);
        assert!(
            pane.take_claim_mirror(100).is_empty(),
            "suppressed inside the debounce window"
        );
        // Past the interval the pending acquire flushes.
        assert_eq!(
            pane.take_claim_mirror(600).len(),
            1,
            "the later acquire flushes after the interval"
        );
    }

    /// Ingesting a release frame drops the claim band from a remote pane's view.
    #[test]
    fn ingesting_a_release_frame_drops_the_claim_band() {
        let path = write_temp("claim-release.txt", "l1\nl2\nl3\n");
        let mut pane_a = make_pane_as(&path, "port-daddy:editor:agent-A");
        let mut pane_b = make_pane_as(&path, "port-daddy:console:human-B");

        // A claims (id 0), B sees the band.
        let acquire = pane_a.acquire_region_claim(1, 2, "tidy", 1);
        assert!(pane_b.ingest_claim(&acquire));
        assert_eq!(claim_flags(&pane_b.view()), 1, "B shows A's claim band");

        // A releases claim id 0; B folds the tombstone and the band disappears.
        let release = pane_a.release_region_claim(0);
        assert!(
            pane_a.claim_ledger().is_empty(),
            "A's own ledger clears on release"
        );
        assert!(
            pane_b.ingest_claim(&release),
            "the release changes B's ledger"
        );
        assert!(
            pane_b.claim_ledger().is_empty(),
            "B's ledger clears after the release"
        );
        assert_eq!(
            claim_flags(&pane_b.view()),
            0,
            "the claim band is gone from B's view"
        );
    }

    // ── P3 slice 2: the wedge (conflict prediction before a byte is written) ───

    const BYPASS: [&str; 5] = ["--force", "--no-verify", "--allow", "bypass", "override"];

    /// THE PANE-LEVEL HARD-RULE-2 PROOF: the wedge fires on a claim-ACQUIRE edge and
    /// NOT on caret moves (keystrokes). A burst of `set_local_presence` (the stand-in
    /// for typing) arms nothing; an `acquire_region_claim` arms exactly one probe whose
    /// body carries the acquired symbol as a `modify` claim against the file path.
    #[test]
    fn wedge_probe_fires_on_acquire_not_on_caret_moves() {
        let path = write_temp("wedge-probe.txt", "l1\nl2\nl3\nl4\nl5\n");
        let mut pane = make_pane_as(&path, "port-daddy:editor:agent-A");

        // 50 caret moves (keystrokes): none arms a predict — the machine-checked
        // "debounced, never per-keystroke" at the pane boundary.
        for col in 0..50u32 {
            pane.set_local_presence(PresenceState::caret(2, col, 1, 5));
            assert!(
                pane.take_wedge_probe(1_000 + col as i64).is_none(),
                "a caret move never arms a predict"
            );
        }

        // A claim-acquire IS a coordination edge → exactly one due probe.
        pane.acquire_region_claim(2, 4, "parse_header", 2_000);
        let body = pane
            .take_wedge_probe(3_000)
            .expect("an acquire arms a due probe");
        assert_eq!(body["claimsA"][0]["symbolPath"], "parse_header");
        assert_eq!(
            body["claimsA"][0]["type"], "modify",
            "the intended edit is a modify claim"
        );
        assert_eq!(body["claimsA"][0]["filePath"], path);
        assert_eq!(
            body["claimsB"].as_array().unwrap().len(),
            0,
            "no other live claims yet"
        );

        // Nothing newly armed → no further predict (quiet).
        assert!(
            pane.take_wedge_probe(3_100).is_none(),
            "no new edge → no predict"
        );
    }

    /// A remote actor's live claim shows up in `claimsB` — the wedge predicts the local
    /// intent against the OTHER actors' claims, never its own.
    #[test]
    fn wedge_probe_body_carries_other_actors_claims_as_claimsB() {
        let path = write_temp("wedge-b.txt", "l1\nl2\nl3\nl4\nl5\n");
        let mut pane = make_pane_as(&path, "port-daddy:editor:agent-A");

        // A remote actor B claims parse_header (L2–4); A folds it in.
        let mut other = make_pane_as(&path, "port-daddy:console:human-B");
        let b_frame = other.acquire_region_claim(2, 4, "parse_header", 500);
        assert!(pane.ingest_claim(&b_frame));

        // A now acquires the SAME symbol — the wedge probes A's modify against B's claim.
        pane.acquire_region_claim(2, 4, "parse_header", 1_000);
        let body = pane.take_wedge_probe(1_500).expect("probe due");
        let claims_b = body["claimsB"].as_array().unwrap();
        assert_eq!(claims_b.len(), 1, "B's live claim is the contended set");
        assert_eq!(claims_b[0]["symbolPath"], "parse_header");
        // A's own claim is NOT in claimsB (you do not conflict with yourself).
        assert_eq!(body["claimsA"].as_array().unwrap().len(), 1);
    }

    /// THE PANE-LEVEL WEDGE PROOF: a daemon `blocking` prediction raises a
    /// Tone::Conflicted band + a bypass-free pd-nudge (surfaced, NOT merged); re-
    /// confirming the SAME conflict does not repaint (no pulse restart — HARD RULE 3);
    /// a later CLEAR prediction drops the band.
    #[test]
    fn blocking_predict_raises_a_conflicted_band_and_nudge_then_clears() {
        let path = write_temp("wedge-band.txt", "l1\nl2\nl3\nl4\nl5\n");
        let mut pane = make_pane_as(&path, "port-daddy:editor:agent-A");

        pane.acquire_region_claim(2, 4, "parse_header", 1_000);
        let _ = pane.take_wedge_probe(1_400).expect("probe due");

        let blocking = serde_json::json!({
            "success": true, "count": 1, "blocking": 1, "warnings": 0, "info": 0,
            "conflicts": [{ "severity": "blocking" }],
        });
        assert!(
            pane.apply_conflict_report(&blocking, 1_500),
            "a blocking report raises the band"
        );
        assert!(pane.guard_band().is_some());

        // A Tone::Conflicted band + a bypass-free nudge render.
        let blocks = pane.view();
        assert!(
            blocks.iter().any(|b| matches!(b, Block::WrappedText { tone: Tone::Conflicted, text } if text.contains("parse_header"))),
            "a Conflicted guard band renders in the view"
        );
        let nudge = pane
            .blocking_nudge()
            .expect("a pd-nudge accompanies the band");
        assert_eq!(nudge.tone, Tone::Conflicted);
        for tok in BYPASS {
            assert!(
                !nudge.detail.to_lowercase().contains(tok),
                "the blocking nudge advertises no bypass (‘{tok}’)"
            );
        }

        // Re-confirming the SAME conflict does not repaint (the pulse is not restarted).
        pane.acquire_region_claim(2, 4, "parse_header", 2_000);
        let _ = pane.take_wedge_probe(2_400).expect("probe due again");
        assert!(
            !pane.apply_conflict_report(&blocking, 2_500),
            "re-confirming the same conflict does not repaint"
        );

        // A later CLEAR predict (moving to a conflict-free region) drops the band.
        pane.acquire_region_claim(7, 8, "write_footer", 3_000);
        let _ = pane.take_wedge_probe(3_400).expect("probe due");
        let clear = serde_json::json!({ "success": true, "count": 0, "conflicts": [] });
        assert!(
            pane.apply_conflict_report(&clear, 3_500),
            "a clear predict drops the band"
        );
        assert!(
            pane.guard_band().is_none(),
            "no band once the region is clear"
        );
    }

    /// THE PANE-LEVEL HARD-RULE-6 PROOF: a contender whose caret sits INSIDE another
    /// actor's live claim gets a Tone::Gated chip + a typed refusal that names
    /// negotiation (handoff / parley / move) and NEVER a bypass. The first-granted owner
    /// is never gated on its own region.
    #[test]
    fn contender_inside_anothers_claim_gets_a_gated_chip_no_bypass() {
        let path = write_temp("wedge-gated.txt", "l1\nl2\nl3\nl4\nl5\n");
        let mut pane_a = make_pane_as(&path, "port-daddy:editor:agent-A");
        let mut pane_b = make_pane_as(&path, "port-daddy:console:human-B");

        // A claims L2–4 (parse_header); B folds it in.
        let frame = pane_a.acquire_region_claim(2, 4, "parse_header", 1_000);
        assert!(pane_b.ingest_claim(&frame));

        // B's caret sits at L3 — inside A's live claim. B is the contender.
        pane_b.set_local_presence(PresenceState::caret(3, 0, 1, 5));
        assert!(
            pane_b.guard_verdict_for_line(3).is_gated(),
            "L3 is held by A's first-granted claim"
        );

        let blocks = pane_b.view();
        assert!(
            blocks.iter().any(|b| matches!(
                b,
                Block::Chip {
                    tone: Tone::Gated,
                    ..
                }
            )),
            "a Gated contender chip renders on B"
        );
        let gated_msg = blocks
            .iter()
            .find_map(|b| match b {
                Block::WrappedText {
                    tone: Tone::Gated,
                    text,
                } => Some(text.clone()),
                _ => None,
            })
            .expect("a gated refusal renders");
        assert!(
            gated_msg.contains("handoff") && gated_msg.contains("parley"),
            "the refusal names negotiation"
        );
        for tok in BYPASS {
            assert!(
                !gated_msg.to_lowercase().contains(tok),
                "the gated refusal names no bypass (‘{tok}’)"
            );
        }

        // The OWNER is never gated on its own region (HARD RULE 6: first-granted wins).
        pane_a.set_local_presence(PresenceState::caret(3, 0, 1, 5));
        assert!(
            !pane_a.guard_verdict_for_line(3).is_gated(),
            "the owner is never gated on its own region"
        );
    }

    /// THE COMMIT GATE (HARD RULE 7): committing an edit that overlaps another live
    /// actor's claimed region is REFUSED with a typed, bypass-free verdict; an edit in a
    /// disjoint adjacent region of the same file commits clear (region-scoped, never a
    /// whole-file lock).
    #[test]
    fn commit_gate_refuses_edits_overlapping_a_live_claim_but_not_adjacent_ones() {
        let big: String = (0..300).map(|i| format!("line {i}\n")).collect();
        let path = write_temp("wedge-commit.txt", &big);
        let mut pane_a = make_pane_as(&path, "port-daddy:editor:agent-A");
        let mut pane_b = make_pane_as(&path, "port-daddy:console:human-B");

        // A holds parse_header (L12–40); B folds it in.
        let frame = pane_a.acquire_region_claim(12, 40, "parse_header", 1_000);
        assert!(pane_b.ingest_claim(&frame));

        // B tries to commit an edit overlapping A's region → refused, bypass-free.
        let verdict = pane_b.commit_verdict(30, 45);
        assert!(
            verdict.is_gated(),
            "a commit overlapping A's live claim is refused"
        );
        if let GuardVerdict::Gated(g) = &verdict {
            let msg = g.message();
            assert!(msg.contains("handoff") && msg.contains("parse_header"));
            for tok in BYPASS {
                assert!(
                    !msg.to_lowercase().contains(tok),
                    "the commit refusal names no bypass (‘{tok}’)"
                );
            }
        }

        // B committing a DISJOINT adjacent region (L200–260) of the same file is clear.
        assert!(
            !pane_b.commit_verdict(200, 260).is_gated(),
            "an adjacent region commits clear (region-scoped)"
        );
        // A committing its OWN region is clear (first-granted owner is A).
        assert!(
            !pane_a.commit_verdict(12, 40).is_gated(),
            "the owner commits its own region clear"
        );
    }

    /// P3 SLICE-3 WIRING PROOF — the pane's multi-hunk `staged_commit_gate` delegates to
    /// the commit-gate module over the pane's live ledger: a staged commit whose hunks
    /// cross TWO live owners' regions is refused with one bypass-free refusal per owner,
    /// while a staged set landing only in free/own regions clears.
    #[test]
    fn staged_commit_gate_wires_the_pane_ledger_to_the_module() {
        let big: String = (0..300).map(|i| format!("line {i}\n")).collect();
        let path = write_temp("wedge-staged.txt", &big);
        let mut pane_a = make_pane_as(&path, "port-daddy:editor:agent-A");
        let mut pane_b = make_pane_as(&path, "port-daddy:console:human-B");
        let mut pane_z = make_pane_as(&path, "port-daddy:editor:agent-Z");

        // A holds parse_header (L12–40); B holds write_footer (L200–260). Z folds both in.
        let fa = pane_a.acquire_region_claim(12, 40, "parse_header", 1_000);
        let fb = pane_b.acquire_region_claim(200, 260, "write_footer", 1_001);
        assert!(pane_z.ingest_claim(&fa) && pane_z.ingest_claim(&fb));

        // Z stages two hunks, one inside EACH owner's region → refused, one per owner.
        let verdict = pane_z.staged_commit_gate(&[(30, 35), (205, 210)]);
        assert!(
            verdict.is_refused(),
            "staged hunks inside two live regions are refused"
        );
        assert_eq!(
            verdict.refusals().len(),
            2,
            "one bypass-free refusal per contended owner"
        );
        let msg = verdict
            .refusal_message()
            .expect("a refused commit has a message");
        let lower = msg.to_lowercase();
        assert!(msg.contains("parse_header") && msg.contains("write_footer"));
        for tok in BYPASS {
            assert!(
                !lower.contains(tok),
                "the staged-commit refusal names no bypass (‘{tok}’)"
            );
        }

        // Z staging only in the free gap (L100–150) between the two claims clears.
        assert!(
            pane_z.staged_commit_gate(&[(100, 150)]).is_clear(),
            "the free gap commits clear (region-scoped)"
        );
        // A staging into its OWN region clears (first-granted owner).
        assert!(
            pane_a.staged_commit_gate(&[(12, 40)]).is_clear(),
            "the owner commits its own region clear"
        );
    }
}
