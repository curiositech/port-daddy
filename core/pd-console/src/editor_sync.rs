//! Harbor Editor P2, **slice 1: the transport** — how one file's Loro ops ride the
//! Port Daddy tube from one replica to another over the LAN, and land in a
//! [`HarborBuffer`](crate::buffer::HarborBuffer).
//!
//! ## Honest scope (read before extending)
//! Slice 1 is the durable wire: a per-file **channel name**, a **frame codec** that
//! carries a Loro update blob as one tube message, and the **fold** that imports a
//! decoded frame into a buffer.
//!
//! **Slice 2 (this file's `presence` section below) adds the ephemeral lane:** a
//! second frame kind (`presence.ephemeral`) that rides the **same** per-file tube
//! channel but carries cursor/selection/viewport as a lossy, timestamp-LWW
//! [`loro::awareness::EphemeralStore`] payload — deliberately *distinct* from the
//! durable op stream (a dropped presence frame is forgotten, never replayed; a
//! dropped op frame is not). Remote cursors are pooled by their `Copy` [`PeerId`]
//! and debounced.
//!
//! **Slice 3 (this file's `durability` + `isolation` sections below) adds P2
//! checkpoint/reconnect transport and the channel split** (build-coop-ide-gpui
//! ref 03 §3):
//!   - **Durability.** A compacted doc **snapshot** ([`HarborBuffer::export_snapshot`])
//!     rides to the content-addressed `/blob` store; the reader broadcasts a tiny
//!     [`encode_snapshot_frame`] *reference* (the blob's sha256 id) on the edit lane
//!     so a reconnecting peer catches up from snapshot+recent-deltas, not the whole
//!     log. A historical diagnostic codec can also write op **deltas** as `/notes`
//!     entries ([`encode_oplog_note`]); [`OpLog`] can import those entries for P2
//!     reconstruction tests. Neither notes nor `/blob` are P3.5 operation evidence.
//!     They do not prove complete sequence-zero history, abandonment, verified
//!     actor/scope, canonical terminal state, or claim-transfer authority.
//!   - **Channel isolation.** The high-frequency doc-op / presence lane
//!     ([`channel_for_path`]) is split OFF the low-frequency, latency-sensitive
//!     coordination control plane ([`coordination_channel_for_path`] — claims,
//!     guard, conflict-predict) onto a **separate tube channel**, so "a burst of
//!     keystrokes from five agents must never starve a `conflicts/predict` call"
//!     (ref 03 §3 Decision Point + Quality Gate). [`classify_channel`] routes a
//!     channel to its [`Lane`] and [`LaneQueues`] is the deterministic proof that a
//!     saturated edit lane leaves the coordination lane's delivery untouched.
//! It still carries line/col cursors (lossy under concurrent edits — stable
//! `loro::cursor` anchoring remains the later refinement, called out at
//! `PresenceState`).
//! What it DOES prove (see the tests): a doc-op exported by replica A is encoded
//! into a tube frame, decoded on the other side, and imported into replica B's
//! buffer byte-conflict-free with authorship intact — i.e. **doc-ops ride the tube
//! and land in the buffer** — and, slice 3, that snapshot+notes reconstruct that
//! buffer on a cold replica while the two lanes never contend.
//!
//! ## Why a codec at all
//! The PD tube (`POST /msg/:channel` → SSE `GET /msg/:channel/subscribe`) carries
//! JSON text, but a Loro update is raw bytes (`LoroDoc::export`). So a frame is a
//! tiny JSON envelope whose `ops` field is the update blob **base64-encoded**. The
//! same envelope is what `AgentTranscript` frames are to the agent stream: a typed,
//! tolerant-to-drift shape that an unknown/garbage frame can never crash (a bad
//! frame decodes to `None` and is skipped, mirroring `agent.rs`'s house rule).
//!
//! ## Renderer- and daemon-agnostic on purpose
//! Nothing here touches gpui or opens a socket. The codec + fold are pure and
//! unit-test on Linux CI in the default (no-`gpui`) build; the live SSE receiver
//! that carries these frames is [`crate::agent::DaemonClient::subscribe_channel`],
//! and declaring the intent to watch a file's channel is
//! [`crate::pane::Subscription::Editor`].

use crate::buffer::{HarborBuffer, PeerId};
use base64::Engine as _;
use std::collections::{BTreeMap, VecDeque};

/// The wire `kind` discriminant for a Loro **durable** update frame — the op
/// stream. Kept as a string (not a bare bool) so the slice-2 `presence.ephemeral`
/// kind (and a future slice-3 `loro.snapshot`) land beside it without a breaking
/// wire change. A reader routes on this: `decode_frame` accepts only this kind,
/// `decode_presence_frame` accepts only [`KIND_PRESENCE`].
const KIND_UPDATE: &str = "loro.update";

/// Current frame schema version. Bumped only on a breaking envelope change; a
/// reader tolerates a missing/other `v` by still trying to decode `ops` (forward
/// drift never blanks the lane — the util.rs tolerance rule).
const FRAME_V: u8 = 1;

/// Channel-name prefix for a Harbor Editor file sync channel. The suffix is a hex
/// digest of the file path, so the whole name is `^[a-zA-Z0-9._:*-]+$`-safe (the
/// daemon's `validateChannel` charset) and well under its 100-char cap.
const CHANNEL_PREFIX: &str = "harbor-editor:";

/// Derive the deterministic tube channel two replicas editing the same file must
/// both land on.
///
/// The path is hashed with FNV-1a(64) and rendered as 16 lowercase hex digits, so
/// the channel is `harbor-editor:<16-hex>` — charset-safe for `validateChannel`
/// (raw paths contain `/` and would be rejected) and stable across processes so a
/// reconnecting peer rejoins the *same* channel.
///
/// **Honest limitation:** this hashes the path string as given. Two peers must
/// pass the same spelling (e.g. both an absolute path) to converge; canonicalizing
/// divergent spellings to one identity is a slice-2 presence concern, not part of
/// the transport proof.
pub fn channel_for_path(path: &str) -> String {
    // FNV-1a 64-bit — same family as buffer.rs's peer id mint: deterministic,
    // dependency-free, and collision-unlikely enough for a channel key. (FNV is
    // NOT cryptographic — this is a routing digest, never a security boundary.)
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in path.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{CHANNEL_PREFIX}{hash:016x}")
}

/// A decoded editor op frame: which replica authored the ops, and the raw Loro
/// update blob ready to hand to [`HarborBuffer::apply_remote_ops`].
///
/// `peer` is the authoring replica's [`PeerId`] — a `Copy` 64-bit scalar, kept
/// scalar end-to-end (never a `String`/`Rc`) so it stays a cheap map key when
/// slice 2 pools cursors by peer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditorFrame {
    pub peer: PeerId,
    pub ops: Vec<u8>,
}

/// The on-wire JSON envelope. `ops` is base64 (the update is raw bytes; the tube
/// is JSON text). `peer` is a decimal STRING, not a JSON number: a `PeerId` is a
/// full `u64` and JSON numbers are IEEE-754 doubles, so a large peer id would lose
/// its low bits as a number — the exact bug that would silently misattribute a
/// replica. As a string it round-trips every bit.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct WireFrame {
    v: u8,
    kind: String,
    peer: String,
    ops: String,
}

/// Encode one replica's exported Loro update (`HarborBuffer::export_ops` bytes)
/// into a tube frame string — the `text` you hand to
/// [`crate::agent::DaemonClient::tube_send`] / `broadcast_editor_frame`.
pub fn encode_frame(peer: PeerId, update_bytes: &[u8]) -> String {
    let frame = WireFrame {
        v: FRAME_V,
        kind: KIND_UPDATE.to_string(),
        peer: peer.to_string(),
        ops: base64::engine::general_purpose::STANDARD.encode(update_bytes),
    };
    // Serializing a fixed-shape struct to a string cannot fail; if it somehow did
    // we'd rather send an empty (ignored) frame than panic the send path.
    serde_json::to_string(&frame).unwrap_or_default()
}

/// Decode a tube message's payload text back into an [`EditorFrame`], or `None`
/// for anything that isn't a well-formed update frame (the `connected` handshake,
/// a heartbeat, a slice-2 `presence.*` frame, or outright garbage). Tolerant by
/// design: a malformed frame is skipped, never fatal — a schema drift can't kill
/// the file's live lane.
pub fn decode_frame(text: &str) -> Option<EditorFrame> {
    let frame: WireFrame = serde_json::from_str(text).ok()?;
    if frame.kind != KIND_UPDATE {
        return None;
    }
    let peer: PeerId = frame.peer.parse().ok()?;
    let ops = base64::engine::general_purpose::STANDARD
        .decode(frame.ops.as_bytes())
        .ok()?;
    if ops.is_empty() {
        return None;
    }
    Some(EditorFrame { peer, ops })
}

/// Fold a decoded frame into a buffer: import the ops, merging them CRDT-clean
/// with per-line authorship preserved. Returns an error only if the blob is not a
/// valid Loro update (already-seen ops import idempotently — a replayed frame is a
/// no-op, which is what makes reconnect/resend safe).
pub fn apply_frame(buffer: &HarborBuffer, frame: &EditorFrame) -> Result<(), String> {
    buffer.apply_remote_ops(&frame.ops)
}

// ── Slice 2: the ephemeral presence lane ──────────────────────────────────────
//
// Cursors, selections, and viewports are *presence*, not document content: lossy,
// last-write-wins, and forgotten the instant a peer goes quiet. They ride the SAME
// per-file tube channel as the op stream (one subscription per file) but under a
// distinct frame `kind`, so a receiver routes ops → the buffer and presence → the
// cursor pool without the two lanes ever crossing. The substrate is Loro's own
// `EphemeralStore` (timestamp-LWW per key, per-key timeout) — the recommended
// presence primitive — so we inherit correct multi-peer merge + expiry for free
// instead of hand-rolling a parallel one.

/// The wire `kind` for an ephemeral presence frame. Distinct from [`KIND_UPDATE`]
/// so the two lanes never cross: [`decode_frame`] rejects this, and
/// [`decode_presence_frame`] rejects a `loro.update`.
const KIND_PRESENCE: &str = "presence.ephemeral";

/// How long (ms) a peer's presence survives without a refresh before it is
/// considered stale and dropped by [`PresenceStore::expire`]. 30s is the usual
/// awareness horizon: long enough to ride out a GC pause or a brief network stall,
/// short enough that a peer who closed the file stops haunting the gutter.
pub const PRESENCE_TIMEOUT_MS: i64 = 30_000;

/// One replica's transient presence in a file: where its caret is, what it has
/// selected, and what slice of the file it is looking at. **Line/column, 1-based
/// lines / 0-based columns** — the grain both consumers want (which line to glow;
/// which line span to mirror as a durable region claim).
///
/// Every field is a `Copy` `u32` scalar, so a `PresenceState` is itself `Copy` and
/// a whole remote-cursor pool is a flat `BTreeMap<PeerId, PresenceState>` of cheap
/// values — no `Rc`/`RefCell` node web, nothing to clone per frame.
///
/// **Honest lossiness:** line/col is not CRDT-anchored, so under a concurrent edit
/// above the caret a remote cursor can point one line off until its next refresh.
/// That is acceptable for an ephemeral hint (it self-heals on the next debounced
/// send) and is exactly why presence is a *separate, lossy* lane from the op
/// stream. Stable `loro::cursor` anchoring is the named later refinement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PresenceState {
    /// Caret line (1-based).
    pub cursor_line: u32,
    /// Caret column (0-based char offset within the line).
    pub cursor_col: u32,
    /// Selection anchor line (1-based); equal to the caret when there is no
    /// selection (a bare caret is an anchorless selection of length zero).
    pub anchor_line: u32,
    /// Selection anchor column (0-based).
    pub anchor_col: u32,
    /// First visible line of this replica's viewport (1-based, inclusive).
    pub top_line: u32,
    /// Last visible line of this replica's viewport (1-based, inclusive).
    pub bottom_line: u32,
}

impl PresenceState {
    /// A bare caret at `line`/`col` with the viewport spanning `top..=bottom` and
    /// no selection (anchor pinned to the caret).
    pub fn caret(line: u32, col: u32, top_line: u32, bottom_line: u32) -> Self {
        Self {
            cursor_line: line,
            cursor_col: col,
            anchor_line: line,
            anchor_col: col,
            top_line,
            bottom_line,
        }
    }

    /// Does this presence carry a real (non-empty) selection?
    pub fn has_selection(&self) -> bool {
        (self.anchor_line, self.anchor_col) != (self.cursor_line, self.cursor_col)
    }

    /// The inclusive `(start_line, end_line)` a selection covers, caret and anchor
    /// ordered low→high. This is the line span the durable claims-table mirror
    /// turns into a region reservation (see `editor_pane::EditorPane::region_claim`).
    pub fn selection_line_span(&self) -> (u32, u32) {
        (
            self.cursor_line.min(self.anchor_line),
            self.cursor_line.max(self.anchor_line),
        )
    }
}

/// A decoded presence frame: which replica it describes and the raw
/// `EphemeralStore` update blob that carries its state (already timestamp-stamped
/// by the sender's store). `peer` is a `Copy` scalar [`PeerId`], never a `String`,
/// so it stays a cheap key end-to-end.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresenceFrame {
    pub peer: PeerId,
    pub eph: Vec<u8>,
}

/// The on-wire presence envelope — same shape discipline as [`WireFrame`]: `eph`
/// is base64 (an `EphemeralStore` blob is raw bytes; the tube is JSON text), and
/// `peer` is a decimal STRING so a near-`u64::MAX` id round-trips every bit.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct WirePresence {
    v: u8,
    kind: String,
    peer: String,
    eph: String,
}

/// Encode a peer's `EphemeralStore` update blob into a presence frame string for
/// [`crate::agent::DaemonClient::send_presence`]. The blob is what
/// [`PresenceStore::publish`] returns.
pub fn encode_presence_frame(peer: PeerId, eph_bytes: &[u8]) -> String {
    let frame = WirePresence {
        v: FRAME_V,
        kind: KIND_PRESENCE.to_string(),
        peer: peer.to_string(),
        eph: base64::engine::general_purpose::STANDARD.encode(eph_bytes),
    };
    serde_json::to_string(&frame).unwrap_or_default()
}

/// Decode a tube message into a [`PresenceFrame`], or `None` for anything that is
/// not a well-formed presence frame — an op frame (`loro.update`), the `connected`
/// handshake, a heartbeat, or garbage. Tolerant by design, mirroring
/// [`decode_frame`]: a malformed frame is skipped, never fatal.
pub fn decode_presence_frame(text: &str) -> Option<PresenceFrame> {
    let frame: WirePresence = serde_json::from_str(text).ok()?;
    if frame.kind != KIND_PRESENCE {
        return None;
    }
    let peer: PeerId = frame.peer.parse().ok()?;
    let eph = base64::engine::general_purpose::STANDARD
        .decode(frame.eph.as_bytes())
        .ok()?;
    if eph.is_empty() {
        return None;
    }
    Some(PresenceFrame { peer, eph })
}

/// A per-file presence store: a thin, render-agnostic wrapper over Loro's
/// [`EphemeralStore`](loro::awareness::EphemeralStore) that keys every peer's
/// transient state under its `PeerId` and merges concurrent updates by
/// last-write-wins timestamp with a [`PRESENCE_TIMEOUT_MS`] expiry.
///
/// ## Why this, and NOT `Arc<Mutex<HashMap<PeerId, _>>>`
/// The dangerous seam in a live editor is SSE-task → render-loop. We keep that
/// seam a plain `tokio::mpsc` of frame bytes (as slice 1 already does): the store
/// lives **entirely on the render/main thread**, owned by the `EditorPane`
/// (gpui `Entity` state). Frames arrive over the channel, the pane folds them into
/// this store on the main thread via `cx`, and reads the pool back — no lock is
/// ever shared across threads, so there is no `Arc<Mutex<..>>` for a stray guard to
/// deadlock or for two threads to contend. The store's *internal* `Arc` is Loro's
/// own concern; from the console's side this is single-threaded owned state.
///
/// The read-facing pool [`remote_cursors`](Self::remote_cursors) is a
/// `BTreeMap<PeerId, PresenceState>`: keyed by the `Copy` 64-bit `PeerId` scalar
/// (not a slotmap — the PeerId *is* the stable handle, so a second indirection
/// would buy nothing), and B-tree-ordered so the cursor draw order is deterministic
/// and flicker-free frame to frame (and reproducible in tests).
pub struct PresenceStore {
    local: PeerId,
    local_key: String,
    store: loro::awareness::EphemeralStore,
}

impl PresenceStore {
    /// A fresh presence store for the local replica `local`.
    pub fn new(local: PeerId) -> Self {
        Self {
            local,
            local_key: local.to_string(),
            store: loro::awareness::EphemeralStore::new(PRESENCE_TIMEOUT_MS),
        }
    }

    /// The local replica id this store publishes under.
    pub fn local(&self) -> PeerId {
        self.local
    }

    /// Set the local replica's presence and return the encoded update blob to
    /// broadcast (wrap it with [`encode_presence_frame`]). Only the local key is
    /// encoded — every other peer republishes its own — so a frame stays small.
    pub fn publish(&self, state: PresenceState) -> Vec<u8> {
        // Store the state as one compact JSON string value under the peer key. A
        // string keeps the LoroValue trivial (no Map construction) and round-trips
        // losslessly; the LWW timestamp is the store's own.
        let json = serde_json::to_string(&state).unwrap_or_default();
        self.store.set(&self.local_key, json);
        self.store.encode(&self.local_key)
    }

    /// Fold a remote peer's presence blob (a decoded [`PresenceFrame::eph`]) into
    /// the store, LWW-merging it. Returns `Err` only if the blob is undecodable;
    /// a stale (older-timestamp) update imports as a no-op, which is what makes a
    /// replayed or out-of-order presence frame harmless.
    pub fn apply(&self, eph_bytes: &[u8]) -> Result<(), String> {
        self.store.apply(eph_bytes).map_err(|e| e.to_string())
    }

    /// The current pool of **remote** cursors (the local peer is excluded — you do
    /// not render your own remote-cursor chip). Rebuilt from the store on demand;
    /// cheap for the handful of peers on one file. A peer whose stored value fails
    /// to parse (a drift/garbage entry) is skipped rather than crashing the pool.
    pub fn remote_cursors(&self) -> BTreeMap<PeerId, PresenceState> {
        let mut out = BTreeMap::new();
        for (key, value) in self.store.get_all_states() {
            let Ok(peer) = key.parse::<PeerId>() else { continue };
            if peer == self.local {
                continue; // skip our own presence
            }
            // The stored value is the JSON string we set in `publish`.
            let loro::LoroValue::String(s) = value else { continue };
            if let Ok(state) = serde_json::from_str::<PresenceState>(s.as_ref()) {
                out.insert(peer, state);
            }
        }
        out
    }

    /// Drop peers whose presence has aged past [`PRESENCE_TIMEOUT_MS`]. The caller
    /// runs this on an idle tick; it is the ONLY thing that mutates the pool while
    /// no frames arrive, and it changes nothing until a peer actually times out —
    /// so a quiet screen stays quiet (see the 0-re-render gate in `editor_pane`).
    pub fn expire(&self) {
        self.store.remove_outdated();
    }
}

/// A pure, clock-injected debounce gate for the presence *send* path. Caret moves
/// fire far faster than anyone can read them; without a gate a fast typist would
/// flood the tube. The gate coalesces every move recorded between ticks into **at
/// most one** send per `min_interval_ms`, always carrying the latest state.
///
/// Deliberately clock-free (the caller passes `now_ms`) so it unit-tests
/// deterministically with a fake clock — no sleeps, no flakes.
#[derive(Debug)]
pub struct PresenceDebouncer {
    min_interval_ms: i64,
    last_sent_ms: Option<i64>,
    pending: Option<PresenceState>,
}

impl PresenceDebouncer {
    /// A debouncer that emits at most once per `min_interval_ms`.
    pub fn new(min_interval_ms: i64) -> Self {
        Self { min_interval_ms, last_sent_ms: None, pending: None }
    }

    /// Record the latest local presence. Cheap and idempotent between ticks — it
    /// only stashes the newest value; the actual send happens in [`take_due`].
    ///
    /// [`take_due`]: Self::take_due
    pub fn record(&mut self, state: PresenceState) {
        self.pending = Some(state);
    }

    /// If a move is pending AND enough time has elapsed since the last send, return
    /// the state to broadcast (and arm the interval). Otherwise `None` — the caller
    /// sends nothing, so an idle caret produces zero traffic and zero re-renders.
    pub fn take_due(&mut self, now_ms: i64) -> Option<PresenceState> {
        let due = match self.last_sent_ms {
            None => true,
            Some(last) => now_ms - last >= self.min_interval_ms,
        };
        if due {
            if let Some(state) = self.pending.take() {
                self.last_sent_ms = Some(now_ms);
                return Some(state);
            }
        }
        None
    }
}

// ── Slice 3a: durable snapshots — content-addressed via /blob ─────────────────
//
// A snapshot is the whole doc state compacted into one blob (`export_snapshot`).
// It is stored in the daemon's content-addressed `/blob` store, which hashes the
// body with sha256 and returns that hex digest as the object id — so the blob id
// IS the content address (we REUSE routes/blob.ts's addressing rather than hashing
// client-side; no crypto dep enters the console). Once stored, the reader
// broadcasts a tiny *reference* frame on the edit lane naming the blob; a peer that
// is behind fetches `GET /blob/:id` and imports it in one shot instead of replaying
// the whole op log.

/// The wire `kind` for a snapshot **reference** frame — it names a blob id, it does
/// NOT carry the snapshot bytes (those live in `/blob`). Distinct from
/// [`KIND_UPDATE`]/[`KIND_PRESENCE`] so the edit lane's decoders never cross.
const KIND_SNAPSHOT: &str = "loro.snapshot";

/// A `/blob` object id is `sha256(body)` rendered as 64 lowercase hex — the exact
/// contract routes/blob.ts enforces (`ID_REGEX = /^[0-9a-f]{64}$/`). Mirrored here
/// so a snapshot-ref frame carrying a malformed id decodes to `None` rather than
/// sending a peer to fetch a blob that can never exist.
fn is_blob_id(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// A decoded snapshot-reference frame: which replica published the snapshot and the
/// content-addressed `/blob` id (sha256 hex) to fetch it by. `peer` stays a `Copy`
/// scalar [`PeerId`]; `blob_id` is owned once (never re-cloned per frame).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotRef {
    pub peer: PeerId,
    pub blob_id: String,
}

/// On-wire snapshot-ref envelope — same discipline as [`WireFrame`]: `peer` is a
/// decimal STRING (a `u64` round-trips every bit), `blob` is the sha256 hex id.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct WireSnapshot {
    v: u8,
    kind: String,
    peer: String,
    blob: String,
}

/// Encode a snapshot-reference frame for the edit lane. `blob_id` is what
/// [`crate::agent::DaemonClient::put_blob`] returned after POSTing the
/// [`HarborBuffer::export_snapshot`] bytes. Broadcast it with
/// [`crate::agent::DaemonClient::broadcast_snapshot_ref`].
pub fn encode_snapshot_frame(peer: PeerId, blob_id: &str) -> String {
    let frame = WireSnapshot {
        v: FRAME_V,
        kind: KIND_SNAPSHOT.to_string(),
        peer: peer.to_string(),
        blob: blob_id.to_string(),
    };
    serde_json::to_string(&frame).unwrap_or_default()
}

/// Decode a tube message into a [`SnapshotRef`], or `None` for anything that is not
/// a well-formed snapshot-ref frame (an op/presence frame, the handshake, garbage,
/// or a frame whose `blob` is not a 64-hex `/blob` id). Tolerant by design, like
/// [`decode_frame`].
pub fn decode_snapshot_frame(text: &str) -> Option<SnapshotRef> {
    let frame: WireSnapshot = serde_json::from_str(text).ok()?;
    if frame.kind != KIND_SNAPSHOT {
        return None;
    }
    let peer: PeerId = frame.peer.parse().ok()?;
    if !is_blob_id(&frame.blob) {
        return None;
    }
    Some(SnapshotRef { peer, blob_id: frame.blob })
}

// ── Slice 3b: historical P2 reconstruction codec — immutable /notes ──────────
//
// This codec serializes a delta as an immutable note for P2 diagnostics and
// reconstruction experiments. The body carries (channel, peer, seq, base64 ops),
// and [`OpLog`] imports such entries idempotently. A note is generic coordination
// history: it is not a daemon-owned editor operation receipt, cannot establish a
// complete sequence-zero ledger or abandonment high-water mark, and must never be
// accepted as P3.5 recovery authority.

/// The `kind` tag inside an op-log note body. Not a tube-frame kind (a note is not
/// a tube message), but the same tolerant, versioned envelope shape.
const KIND_OPLOG: &str = "loro.oplog";

/// One decoded op-log entry: the file channel it belongs to, the authoring replica
/// ([`PeerId`], a `Copy` scalar), a monotonically-increasing per-replica sequence
/// number, and the raw Loro update blob. `(peer, seq)` is the stable, `Copy`
/// dedup key — never an `Rc`/`String` node identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpLogEntry {
    pub channel: String,
    pub peer: PeerId,
    pub seq: u64,
    pub ops: Vec<u8>,
}

/// On-wire op-log note envelope. `peer` decimal STRING (full `u64`), `seq` a JSON
/// number (a sequence counter never approaches the 2^53 JSON-safe ceiling), `ops`
/// base64 (raw Loro bytes over a JSON note body).
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct WireOpLogNote {
    v: u8,
    kind: String,
    channel: String,
    peer: String,
    seq: u64,
    ops: String,
}

/// Build the immutable-note **content** for one op-log delta — the string handed to
/// [`crate::agent::DaemonClient::log_oplog_delta`] (`POST /notes`). Pure so the
/// envelope shape is a checked contract without a live daemon.
pub fn encode_oplog_note(channel: &str, peer: PeerId, seq: u64, ops: &[u8]) -> String {
    let note = WireOpLogNote {
        v: FRAME_V,
        kind: KIND_OPLOG.to_string(),
        channel: channel.to_string(),
        peer: peer.to_string(),
        seq,
        ops: base64::engine::general_purpose::STANDARD.encode(ops),
    };
    serde_json::to_string(&note).unwrap_or_default()
}

/// Decode an op-log note body back into an [`OpLogEntry`], or `None` if it is not a
/// well-formed op-log note (a plain operator note, another envelope, or garbage —
/// the `/notes` store holds all of them, so the reader must skip non-op-log rows).
pub fn decode_oplog_note(content: &str) -> Option<OpLogEntry> {
    let note: WireOpLogNote = serde_json::from_str(content).ok()?;
    if note.kind != KIND_OPLOG {
        return None;
    }
    let peer: PeerId = note.peer.parse().ok()?;
    let ops = base64::engine::general_purpose::STANDARD
        .decode(note.ops.as_bytes())
        .ok()?;
    if ops.is_empty() {
        return None;
    }
    Some(OpLogEntry { channel: note.channel, peer, seq: note.seq, ops })
}

/// A client-side P2 reconstruction view: an ordered, **deduplicated** set of
/// note-encoded deltas keyed by `(peer, seq)`. This is not the authoritative P3.5
/// typed operation ledger.
///
/// ## Data-structure choice (operator's discipline)
/// A `BTreeMap<(PeerId, u64), Vec<u8>>` — the key is a pair of `Copy` scalars, so
/// there is no `Rc<RefCell<_>>` node web and no `String` identity to clone; the
/// B-tree gives a deterministic replay order (by peer, then sequence) and O(log n)
/// idempotent insert. `(peer, seq)` is the natural dedup identity: replaying a
/// duplicate-delivered reconstruction log re-inserts the same keys
/// and changes nothing, so replay is idempotent at THIS layer as well as inside
/// Loro's import.
#[derive(Debug, Default)]
pub struct OpLog {
    entries: BTreeMap<(PeerId, u64), Vec<u8>>,
}

impl OpLog {
    /// An empty op-log.
    pub fn new() -> Self {
        Self { entries: BTreeMap::new() }
    }

    /// Append one decoded entry. Returns `true` if it was new, `false` if a delta
    /// with the same `(peer, seq)` was already present (a duplicate note read back
    /// twice) — useful for duplicate-delivery and reconnect safety.
    pub fn append(&mut self, entry: OpLogEntry) -> bool {
        self.entries.insert((entry.peer, entry.seq), entry.ops).is_none()
    }

    /// How many distinct deltas the log holds.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Is the log empty?
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Replay every delta into `buffer`, in `(peer, seq)` order, reconstructing the
    /// doc. Loro import is itself idempotent, so replaying a log that overlaps the
    /// buffer's existing state is safe; combined with a snapshot import this proves
    /// P2 reconstruction mechanics (snapshot for the bulk, notes for the tail).
    /// It does not authorize editor recovery. Returns `Err` on the first
    /// undecodable delta, naming nothing it already applied.
    pub fn replay_into(&self, buffer: &HarborBuffer) -> Result<(), String> {
        for ops in self.entries.values() {
            buffer.apply_remote_ops(ops)?;
        }
        Ok(())
    }
}

// ── Slice 3c: channel isolation — edit-sync lane vs coordination control plane ─
//
// The named risk (ref 03 §3 Decision Point + Quality Gate, battle-plan :99):
// "Isolate the edit-sync channel from the coordination control plane so editor load
// never regresses claim latency. A burst of keystrokes from five agents must never
// starve a `conflicts/predict` call." So doc-ops + presence ride
// `channel_for_path` (high frequency, lossy-tolerant) and claims / guard /
// conflict-predict ride a SEPARATE `coordination_channel_for_path` (low frequency,
// latency-sensitive). They are physically separate at every hop: the daemon keeps a
// per-channel message list + per-channel subscriber (routes/messaging.ts), and the
// client opens ONE `subscribe_channel` — its own tokio task + its own `mpsc(256)` —
// per channel. Nothing is shared for a keystroke burst to head-of-line-block across.

/// Channel-name prefix for a file's **coordination** control plane — claims, guard
/// signals, and conflict-prediction pings for that file. Distinct prefix from
/// [`CHANNEL_PREFIX`] so the edit-sync lane and the coordination lane are always
/// different channel strings (and thus different daemon queues + client
/// subscriptions), while sharing the path digest so they pair up per file.
const COORD_CHANNEL_PREFIX: &str = "harbor-coord:";

/// Derive the deterministic **coordination** channel for a file — the control-plane
/// twin of [`channel_for_path`]. Same FNV-1a(64) path digest, different prefix, so
/// `coordination_channel_for_path(p) != channel_for_path(p)` for every path while
/// both are stable and charset-safe for the daemon's `validateChannel`.
pub fn coordination_channel_for_path(path: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in path.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{COORD_CHANNEL_PREFIX}{hash:016x}")
}

/// Which isolated lane a channel belongs to. A `Copy` scalar enum — a channel
/// string is classified to a `Lane` ONCE (by cheap prefix check, no allocation),
/// then routed by this `Copy` value, so the hot receive path never hashes or clones
/// a channel key per frame (the operator's "don't clone String keys every frame").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lane {
    /// Doc-ops, presence, and snapshot refs — `channel_for_path`. High frequency.
    EditSync,
    /// Claims, guard, conflict-predict — `coordination_channel_for_path`.
    Coordination,
}

/// Classify a channel name into its [`Lane`], or `None` if it is neither a Harbor
/// Editor edit-sync nor coordination channel. Pure prefix match — no allocation.
pub fn classify_channel(channel: &str) -> Option<Lane> {
    if channel.starts_with(CHANNEL_PREFIX) {
        Some(Lane::EditSync)
    } else if channel.starts_with(COORD_CHANNEL_PREFIX) {
        Some(Lane::Coordination)
    } else {
        None
    }
}

/// The `kind` of a coordination control-plane signal — the low-frequency messages
/// that ride the coordination lane and must never be starved by an edit burst.
/// A `Copy` enum; the tolerant decoder maps an unknown tag to `None` (skip) rather
/// than crashing the lane.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum CoordKind {
    /// A replica acquired a region claim (the "claim as awareness range" bridge).
    ClaimAcquire,
    /// A replica released a region claim.
    ClaimRelease,
    /// Conflict prediction found a contradictory plan on this region.
    ConflictPredicted,
}

/// The wire `kind` discriminant for a coordination-signal frame. Distinct from
/// every edit-lane kind so a coordination frame never decodes as an op/presence/
/// snapshot frame and vice versa — the lanes stay unambiguous even if a frame were
/// ever misrouted.
const KIND_COORD: &str = "coord.signal";

/// One decoded coordination signal: which replica, what kind, and the inclusive
/// 1-based line span it concerns (the claimed/conflicting region). All `Copy`
/// scalars — a whole signal is `Copy`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CoordSignal {
    pub peer: PeerId,
    pub kind: CoordKind,
    pub start_line: u32,
    pub end_line: u32,
}

/// On-wire coordination envelope — `peer` decimal STRING (full `u64`).
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct WireCoord {
    v: u8,
    kind: String,
    signal: CoordKind,
    peer: String,
    start_line: u32,
    end_line: u32,
}

/// Encode a coordination signal for the coordination lane — the string handed to
/// [`crate::agent::DaemonClient::send_coord_signal`] with the file's
/// [`coordination_channel_for_path`].
pub fn encode_coord_frame(signal: CoordSignal) -> String {
    let frame = WireCoord {
        v: FRAME_V,
        kind: KIND_COORD.to_string(),
        signal: signal.kind,
        peer: signal.peer.to_string(),
        start_line: signal.start_line,
        end_line: signal.end_line,
    };
    serde_json::to_string(&frame).unwrap_or_default()
}

/// Decode a coordination-lane message into a [`CoordSignal`], or `None` for
/// anything that is not a well-formed coordination frame (an edit-lane frame, the
/// handshake, garbage). Tolerant by design, mirroring [`decode_frame`].
pub fn decode_coord_frame(text: &str) -> Option<CoordSignal> {
    let frame: WireCoord = serde_json::from_str(text).ok()?;
    if frame.kind != KIND_COORD {
        return None;
    }
    let peer: PeerId = frame.peer.parse().ok()?;
    Some(CoordSignal {
        peer,
        kind: frame.signal,
        start_line: frame.start_line,
        end_line: frame.end_line,
    })
}

/// The bound on each lane's client-side queue — the exact capacity
/// [`crate::agent::DaemonClient::subscribe_channel`] gives its `mpsc` (256). Named
/// here so the isolation model uses the real number, not a toy.
const LANE_QUEUE_CAP: usize = 256;

/// A deterministic, offline model of the client receive seam that PROVES the
/// isolation claim: doc-ops and coordination signals land in SEPARATE bounded
/// queues, so a keystroke burst on the edit lane cannot starve the coordination
/// lane. This mirrors the real plumbing exactly — one bounded `mpsc(256)` per
/// channel, each drained by its own task; the daemon likewise keeps a per-channel
/// message list + per-channel subscriber. Two channels ⇒ two independent queues,
/// nothing shared to head-of-line-block across.
///
/// Overflow is modelled as a drop (a full queue refuses the frame). The real
/// `mpsc` applies *backpressure* (the sender awaits), but the isolation property is
/// identical either way: a full edit lane stalls/drops only the edit lane's own
/// task and queue, never the coordination task's — which is precisely what
/// [`Self::route`] enforces by keying on [`Lane`].
#[derive(Debug, Default)]
pub struct LaneQueues {
    edit: VecDeque<String>,
    coord: VecDeque<String>,
}

impl LaneQueues {
    /// Two empty per-lane queues.
    pub fn new() -> Self {
        Self { edit: VecDeque::new(), coord: VecDeque::new() }
    }

    /// Route one frame published on `channel` into ITS lane's queue. Returns `true`
    /// if it was accepted, `false` if that lane was at [`LANE_QUEUE_CAP`] (dropped)
    /// or the channel is not an editor lane. Crucially, a frame is only ever pushed
    /// to the queue for its own [`classify_channel`] lane — an edit-lane flood can
    /// fill `edit` to the brim without ever touching `coord`.
    pub fn route(&mut self, channel: &str, frame: String) -> bool {
        match classify_channel(channel) {
            Some(Lane::EditSync) => Self::push_bounded(&mut self.edit, frame),
            Some(Lane::Coordination) => Self::push_bounded(&mut self.coord, frame),
            None => false,
        }
    }

    fn push_bounded(q: &mut VecDeque<String>, frame: String) -> bool {
        if q.len() >= LANE_QUEUE_CAP {
            return false; // bounded backpressure — this lane is saturated
        }
        q.push_back(frame);
        true
    }

    /// Drain (FIFO) everything queued on the edit lane.
    pub fn drain_edit(&mut self) -> Vec<String> {
        self.edit.drain(..).collect()
    }

    /// Drain (FIFO) everything queued on the coordination lane.
    pub fn drain_coord(&mut self) -> Vec<String> {
        self.coord.drain(..).collect()
    }

    /// How many frames are queued on the coordination lane right now.
    pub fn coord_len(&self) -> usize {
        self.coord.len()
    }

    /// How many frames are queued on the edit lane right now.
    pub fn edit_len(&self) -> usize {
        self.edit.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buffer::{peer_id_for_identity, HarborBuffer};

    #[test]
    fn channel_is_deterministic_charset_safe_and_bounded() {
        let a = channel_for_path("/Users/erich/coding/port-daddy/core/pd-console/src/mux.rs");
        let b = channel_for_path("/Users/erich/coding/port-daddy/core/pd-console/src/mux.rs");
        let c = channel_for_path("/Users/erich/coding/port-daddy/core/pd-console/src/pane.rs");
        assert_eq!(a, b, "same path must map to the same channel (peers converge)");
        assert_ne!(a, c, "different files get different channels");
        // The daemon's validateChannel charset + length contract.
        assert!(a.len() <= 100);
        assert!(
            a.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | ':' | '*' | '-')),
            "channel must satisfy validateChannel's ^[a-zA-Z0-9._:*-]+$: {a}"
        );
        assert!(a.starts_with(CHANNEL_PREFIX));
    }

    #[test]
    fn frame_round_trips_peer_and_ops() {
        let peer: PeerId = peer_id_for_identity("port-daddy:editor:agent-A");
        let ops = vec![0u8, 1, 2, 250, 251, 255, 42];
        let text = encode_frame(peer, &ops);
        let decoded = decode_frame(&text).expect("well-formed frame decodes");
        assert_eq!(decoded.peer, peer, "peer id round-trips every bit (decimal string)");
        assert_eq!(decoded.ops, ops, "op bytes round-trip through base64");
    }

    #[test]
    fn large_peer_id_survives_the_wire() {
        // A peer id near u64::MAX would lose low bits if serialized as a JSON
        // number; the decimal-string encoding must preserve it exactly.
        let peer: PeerId = u64::MAX - 3;
        let text = encode_frame(peer, &[9, 9, 9]);
        assert_eq!(decode_frame(&text).unwrap().peer, peer);
    }

    #[test]
    fn garbage_and_foreign_frames_decode_to_none() {
        // Not JSON.
        assert!(decode_frame("not json at all").is_none());
        // The SSE `connected` handshake shape — no update fields.
        assert!(decode_frame(r#"{"channel":"harbor-editor:abc"}"#).is_none());
        // A future/foreign kind (e.g. a slice-2 presence frame) is skipped, not fatal.
        assert!(decode_frame(r#"{"v":1,"kind":"presence.cursor","peer":"5","ops":"AA=="}"#).is_none());
        // Bad base64 in ops.
        assert!(decode_frame(r#"{"v":1,"kind":"loro.update","peer":"5","ops":"!!!!"}"#).is_none());
        // Empty ops (a no-op frame carries no update).
        assert!(decode_frame(r#"{"v":1,"kind":"loro.update","peer":"5","ops":""}"#).is_none());
    }

    /// THE SLICE-1 PROOF — a doc-op rides the tube-shaped frame and lands in the
    /// buffer, byte-conflict-free, with authorship intact.
    ///
    /// Replica A opens a file and exports its ops. We ENCODE those into a tube
    /// frame (the exact string that would be POSTed to `/msg/<channel>` and
    /// re-delivered over SSE), then on the "other side" DECODE it and fold it into
    /// replica B. B now holds A's content, attributed to A. B then edits and sends
    /// a frame back; A folds it and sees B's line attributed to B. No sockets — the
    /// frame string IS the wire contract, proven end-to-end.
    #[test]
    fn doc_ops_ride_the_frame_and_land_in_the_buffer() {
        let dir = scratch_dir();
        let path = dir.join("wire.txt");
        std::fs::write(&path, "operator line one\noperator line two\n").unwrap();

        let human_id = "port-daddy:console:human";
        let agent_id = "port-daddy:editor:agent-A";
        let human_peer = peer_id_for_identity(human_id);
        let agent_peer = peer_id_for_identity(agent_id);

        // Replica A opens the file; its ops become a frame on the tube.
        let replica_a = HarborBuffer::open(path.to_str().unwrap(), human_id).unwrap();
        let a_to_b = encode_frame(replica_a.local_peer(), &replica_a.export_ops());

        // Replica B receives the frame text off its channel subscription and folds
        // it in — the transport landing, not a direct buffer handoff.
        let replica_b = HarborBuffer::empty(agent_id);
        let frame = decode_frame(&a_to_b).expect("A's frame decodes on B's side");
        apply_frame(&replica_b, &frame).expect("A's ops land in B");
        assert_eq!(
            replica_b.to_string(),
            "operator line one\noperator line two\n",
            "A's document content arrived over the frame"
        );

        // B edits and sends a frame back the other way.
        replica_b.append_line("agent added over the wire");
        let b_to_a = encode_frame(replica_b.local_peer(), &replica_b.export_ops());
        let frame = decode_frame(&b_to_a).expect("B's frame decodes on A's side");
        apply_frame(&replica_a, &frame).expect("B's ops land in A");

        // A now shows both contributions, each attributed to the correct replica.
        let lines = replica_a.lines();
        assert_eq!(lines.len(), 3, "two operator lines + one agent line after the wire round-trip");
        assert_eq!(lines[2].text, "agent added over the wire");
        assert_eq!(lines[0].author_peer, Some(human_peer), "operator's line stays the operator's");
        assert_eq!(lines[2].author_peer, Some(agent_peer), "the wired-in line is attributed to the agent replica");
        // Both replicas converge to identical bytes (CRDT merge over the tube).
        assert_eq!(replica_a.to_string(), replica_b.to_string());
    }

    #[test]
    fn replayed_frame_is_idempotent() {
        // Reconnect/resend safety: importing the same frame twice must not
        // duplicate content (Loro import is idempotent; the codec must not defeat it).
        let a = HarborBuffer::empty("port-daddy:editor:a");
        a.append_line("one");
        let frame_text = encode_frame(a.local_peer(), &a.export_ops());
        let b = HarborBuffer::empty("port-daddy:editor:b");
        let frame = decode_frame(&frame_text).unwrap();
        apply_frame(&b, &frame).unwrap();
        apply_frame(&b, &frame).unwrap(); // replay
        assert_eq!(b.lines().len(), 1, "replaying an identical frame must not duplicate the line");
    }

    // ── Slice 2: presence lane ────────────────────────────────────────────────

    #[test]
    fn presence_frame_round_trips_peer_and_blob() {
        let peer: PeerId = peer_id_for_identity("port-daddy:editor:agent-A");
        let eph = vec![1u8, 2, 3, 250, 255, 0, 7];
        let text = encode_presence_frame(peer, &eph);
        let decoded = decode_presence_frame(&text).expect("well-formed presence frame decodes");
        assert_eq!(decoded.peer, peer, "presence peer round-trips every bit");
        assert_eq!(decoded.eph, eph, "the ephemeral blob round-trips through base64");
    }

    #[test]
    fn presence_peer_survives_the_wire_near_u64_max() {
        let peer: PeerId = u64::MAX - 5;
        let text = encode_presence_frame(peer, &[9, 9]);
        assert_eq!(decode_presence_frame(&text).unwrap().peer, peer);
    }

    /// The two lanes never cross: an op decoder rejects a presence frame and vice
    /// versa, so a receiver can route by kind without one lane eating the other.
    #[test]
    fn presence_and_op_frames_do_not_cross_lanes() {
        let peer: PeerId = peer_id_for_identity("port-daddy:editor:x");
        let op_frame = encode_frame(peer, &[1, 2, 3]);
        let presence_frame = encode_presence_frame(peer, &[4, 5, 6]);

        // The op decoder must not accept a presence frame...
        assert!(decode_frame(&presence_frame).is_none(), "op decoder rejects presence");
        // ...and the presence decoder must not accept an op frame.
        assert!(decode_presence_frame(&op_frame).is_none(), "presence decoder rejects ops");

        // Both reject garbage, the handshake, and empty payloads.
        assert!(decode_presence_frame("not json").is_none());
        assert!(decode_presence_frame(r#"{"channel":"harbor-editor:abc"}"#).is_none());
        assert!(decode_presence_frame(r#"{"v":1,"kind":"presence.ephemeral","peer":"5","eph":""}"#).is_none());
        assert!(decode_presence_frame(r#"{"v":1,"kind":"presence.ephemeral","peer":"5","eph":"!!!"}"#).is_none());
    }

    #[test]
    fn presence_state_selection_helpers() {
        let caret = PresenceState::caret(10, 4, 5, 40);
        assert!(!caret.has_selection(), "a bare caret has no selection");
        assert_eq!(caret.selection_line_span(), (10, 10), "a caret spans its own line");

        // A selection from line 20 (anchor) up to line 12 (caret) spans 12..=20.
        let sel = PresenceState {
            cursor_line: 12,
            cursor_col: 0,
            anchor_line: 20,
            anchor_col: 3,
            top_line: 8,
            bottom_line: 30,
        };
        assert!(sel.has_selection());
        assert_eq!(sel.selection_line_span(), (12, 20), "span is ordered low→high regardless of drag direction");
    }

    /// THE SLICE-2 PRESENCE PROOF — replica A's cursor rides the tube-shaped
    /// presence frame and lands in replica B's remote-cursor pool, keyed by A's
    /// PeerId, with B's own presence excluded.
    #[test]
    fn remote_cursor_rides_the_frame_and_pools_by_peer() {
        let a_peer = peer_id_for_identity("port-daddy:editor:agent-A");
        let b_peer = peer_id_for_identity("port-daddy:console:human-B");
        assert_ne!(a_peer, b_peer);

        let store_a = PresenceStore::new(a_peer);
        let store_b = PresenceStore::new(b_peer);

        // B has its own caret; its pool of *remote* cursors starts empty.
        store_b.publish(PresenceState::caret(1, 0, 1, 20));
        assert!(store_b.remote_cursors().is_empty(), "B does not render its own cursor as remote");

        // A publishes a selection; the blob becomes a frame on the shared channel.
        let a_state = PresenceState {
            cursor_line: 7,
            cursor_col: 2,
            anchor_line: 9,
            anchor_col: 0,
            top_line: 3,
            bottom_line: 25,
        };
        let frame_text = encode_presence_frame(a_peer, &store_a.publish(a_state));

        // B receives it off its subscription and folds it in — the transport landing.
        let frame = decode_presence_frame(&frame_text).expect("A's presence frame decodes on B");
        assert_eq!(frame.peer, a_peer);
        store_b.apply(&frame.eph).expect("A's presence lands in B's store");

        let pool = store_b.remote_cursors();
        assert_eq!(pool.len(), 1, "exactly A shows up as a remote cursor");
        assert_eq!(pool.get(&a_peer).copied(), Some(a_state), "A's full presence state arrived, keyed by A's PeerId");
        assert!(!pool.contains_key(&b_peer), "B's own presence is never in the remote pool");
    }

    /// Re-applying an identical presence blob is a no-op (LWW: same timestamp is not
    /// newer), so a replayed/out-of-order presence frame never churns the pool. This
    /// is the invariant the idle 0-re-render gate leans on.
    #[test]
    fn replayed_presence_is_a_noop() {
        let a_peer = peer_id_for_identity("port-daddy:editor:a");
        let b_peer = peer_id_for_identity("port-daddy:editor:b");
        let store_a = PresenceStore::new(a_peer);
        let store_b = PresenceStore::new(b_peer);

        let blob = store_a.publish(PresenceState::caret(4, 1, 1, 10));
        store_b.apply(&blob).unwrap();
        let before = store_b.remote_cursors();
        store_b.apply(&blob).unwrap(); // replay the exact same blob
        let after = store_b.remote_cursors();
        assert_eq!(before, after, "replaying identical presence must not change the pool");
        assert_eq!(after.len(), 1);
    }

    #[test]
    fn debouncer_coalesces_rapid_moves_into_one_send() {
        let mut d = PresenceDebouncer::new(100); // ≤ 1 send / 100ms

        // Idle: nothing pending → nothing due.
        assert_eq!(d.take_due(0), None, "an idle caret sends nothing");

        // Three rapid moves before the first tick collapse to the latest state.
        d.record(PresenceState::caret(1, 0, 1, 10));
        d.record(PresenceState::caret(2, 0, 1, 10));
        d.record(PresenceState::caret(3, 5, 1, 10));
        let sent = d.take_due(10).expect("a pending move is due on the first tick");
        assert_eq!(sent, PresenceState::caret(3, 5, 1, 10), "only the newest coalesced state is sent");

        // Immediately after, within the interval, nothing new is due even if it moved.
        d.record(PresenceState::caret(4, 0, 1, 10));
        assert_eq!(d.take_due(50), None, "a second send is suppressed inside the debounce window");

        // Past the interval, the latest pending state flushes.
        let sent = d.take_due(120).expect("after the interval the pending move flushes");
        assert_eq!(sent, PresenceState::caret(4, 0, 1, 10));

        // With nothing newly recorded, the next tick is silent again.
        assert_eq!(d.take_due(500), None, "no new move → no send");
    }

    // ── Slice 3a: durable snapshots (content-addressed /blob refs) ─────────────

    #[test]
    fn snapshot_ref_frame_round_trips_and_validates_blob_id() {
        let peer: PeerId = peer_id_for_identity("port-daddy:editor:agent-A");
        let blob_id = "a".repeat(64); // a well-formed sha256 hex /blob id
        let text = encode_snapshot_frame(peer, &blob_id);
        let decoded = decode_snapshot_frame(&text).expect("well-formed snapshot ref decodes");
        assert_eq!(decoded.peer, peer, "snapshot-ref peer round-trips every bit");
        assert_eq!(decoded.blob_id, blob_id, "the blob id round-trips");

        // A near-u64::MAX peer id survives (decimal string, not JSON number).
        let big: PeerId = u64::MAX - 7;
        assert_eq!(decode_snapshot_frame(&encode_snapshot_frame(big, &blob_id)).unwrap().peer, big);

        // Malformed blob ids are rejected (would send a peer to fetch a phantom blob).
        assert!(decode_snapshot_frame(r#"{"v":1,"kind":"loro.snapshot","peer":"5","blob":"tooshort"}"#).is_none());
        let upper = "A".repeat(64); // /blob ids are LOWERCASE hex only
        assert!(decode_snapshot_frame(&encode_snapshot_frame(peer, &upper)).is_none(), "uppercase hex is not a /blob id");
        assert!(decode_snapshot_frame("not json").is_none());
    }

    /// The snapshot-ref lane never crosses the op / presence lanes: each decoder
    /// accepts only its own kind, so a receiver routes by kind unambiguously.
    #[test]
    fn snapshot_ref_does_not_cross_op_or_presence_lanes() {
        let peer: PeerId = peer_id_for_identity("port-daddy:editor:x");
        let snap = encode_snapshot_frame(peer, &"c".repeat(64));
        assert!(decode_frame(&snap).is_none(), "op decoder rejects a snapshot ref");
        assert!(decode_presence_frame(&snap).is_none(), "presence decoder rejects a snapshot ref");
        // ...and the snapshot decoder rejects op/presence frames.
        assert!(decode_snapshot_frame(&encode_frame(peer, &[1, 2, 3])).is_none());
        assert!(decode_snapshot_frame(&encode_presence_frame(peer, &[4, 5, 6])).is_none());
    }

    // ── Slice 3b: the durable op-log (immutable /notes) ────────────────────────

    #[test]
    fn oplog_note_round_trips_and_skips_foreign_notes() {
        let channel = channel_for_path("/x/y.rs");
        let peer: PeerId = peer_id_for_identity("port-daddy:editor:agent-A");
        let ops = vec![7u8, 8, 9, 250, 255, 0];
        let content = encode_oplog_note(&channel, peer, 3, &ops);
        let entry = decode_oplog_note(&content).expect("op-log note decodes");
        assert_eq!(entry.channel, channel);
        assert_eq!(entry.peer, peer, "op-log peer round-trips every bit");
        assert_eq!(entry.seq, 3);
        assert_eq!(entry.ops, ops, "op bytes round-trip through base64");

        // A plain operator note (not an op-log envelope) is skipped, not fatal —
        // the /notes store holds both, and the reader must ignore non-op-log rows.
        assert!(decode_oplog_note("just an operator note").is_none());
        assert!(decode_oplog_note(r#"{"content":"hi","agentId":"console-operator"}"#).is_none());
        // Empty ops carry no delta.
        assert!(decode_oplog_note(r#"{"v":1,"kind":"loro.oplog","channel":"c","peer":"5","seq":1,"ops":""}"#).is_none());
    }

    /// THE SLICE-3 DURABILITY PROOF (op-log half): op deltas persisted as immutable
    /// notes, read back, DEDUPED by (peer, seq), and replayed to reconstruct the
    /// buffer — content AND per-line authorship — idempotently under duplicate
    /// delivery. This is explicitly not a P3.5 authority proof.
    #[test]
    fn oplog_dedups_and_replays_to_reconstruct_the_buffer() {
        let path = "/repo/src/parse_header.rs";
        let channel = channel_for_path(path);
        let human_id = "port-daddy:console:human";
        let agent_id = "port-daddy:editor:agent-A";
        let human_peer = peer_id_for_identity(human_id);
        let agent_peer = peer_id_for_identity(agent_id);

        // The live doc: operator seeds two lines, an agent merges a third. After each
        // edit we persist the authoring replica's update-log as an op-log NOTE — the
        // exact string that would be POSTed to /notes.
        let op = HarborBuffer::empty(human_id);
        op.append_line("human line one");
        let note0 = encode_oplog_note(&channel, op.local_peer(), 0, &op.export_ops());
        op.append_line("human line two");
        let note1 = encode_oplog_note(&channel, op.local_peer(), 1, &op.export_ops());

        let agent = HarborBuffer::empty(agent_id);
        agent.apply_remote_ops(&op.export_ops()).unwrap();
        agent.append_line("agent refactored parse_header");
        let note_a = encode_oplog_note(&channel, agent.local_peer(), 0, &agent.export_ops());

        // A cold P2 peer reads the notes back off /notes and folds them into an OpLog.
        // Reading a note TWICE (a resend or duplicate delivery) must not grow
        // the log — dedup is on (peer, seq).
        let mut log = OpLog::new();
        for note in [&note0, &note1, &note_a, &note1 /* duplicate */] {
            let entry = decode_oplog_note(note).expect("each note decodes");
            log.append(entry);
        }
        assert_eq!(log.len(), 3, "three distinct deltas; the replayed note1 deduped away");

        // Replay the whole durable log onto a COLD replica → the live doc, rebuilt.
        let restored = HarborBuffer::empty("port-daddy:console:successor");
        log.replay_into(&restored).expect("the op-log replays clean");
        let lines = restored.lines();
        assert_eq!(lines.len(), 3, "operator's two lines + the agent's line, reconstructed");
        assert_eq!(lines[0].author_peer, Some(human_peer), "authorship survives the note round-trip");
        assert_eq!(lines[2].author_peer, Some(agent_peer), "the agent's line stays the agent's after replay");

        // Replaying the same log again is idempotent (duplicate-delivery safety).
        log.replay_into(&restored).unwrap();
        assert_eq!(restored.lines().len(), 3, "re-replaying the op-log must not duplicate lines");
    }

    /// THE SLICE-3 P2 RECONSTRUCTION PROOF: snapshot (the bulk, from `/blob`) + a
    /// note-encoded tail reconstruct a cold replica that converges byte-for-byte to
    /// the live doc, authorship intact. This proves reconnect mechanics only; notes
    /// and blobs are never authoritative P3.5 recovery evidence.
    #[test]
    fn snapshot_plus_oplog_tail_reconstructs_the_live_doc() {
        let path = "/repo/src/lib.rs";
        let channel = channel_for_path(path);
        let human_id = "port-daddy:console:human";

        let live = HarborBuffer::empty(human_id);
        live.append_line("bulk line 1");
        live.append_line("bulk line 2");
        // Snapshot the bulk state → this is the blob that would land in /blob.
        let snapshot = live.export_snapshot();

        // The tail: two more edits, each persisted as an op-log note.
        let mut tail = OpLog::new();
        live.append_line("tail line 3");
        tail.append(decode_oplog_note(&encode_oplog_note(&channel, live.local_peer(), 10, &live.export_ops())).unwrap());
        live.append_line("tail line 4");
        tail.append(decode_oplog_note(&encode_oplog_note(&channel, live.local_peer(), 11, &live.export_ops())).unwrap());

        // Cold replica: import the snapshot (bulk), then replay the tail notes.
        let restored = HarborBuffer::empty("port-daddy:console:successor");
        restored.apply_remote_ops(&snapshot).expect("snapshot blob imports");
        tail.replay_into(&restored).expect("tail deltas replay onto the snapshot");

        assert_eq!(restored.to_string(), live.to_string(), "snapshot+tail converges to the live doc byte-for-byte");
        assert_eq!(restored.lines().len(), 4, "all four lines present after reconnect");
        assert_eq!(
            restored.lines()[3].author_peer,
            Some(peer_id_for_identity(human_id)),
            "the tail line's authorship survives snapshot+replay"
        );
    }

    // ── Slice 3c: channel isolation (edit-sync vs coordination) ────────────────

    #[test]
    fn edit_and_coordination_channels_are_distinct_lanes() {
        for path in ["/a.rs", "/very/long/path/to/some/file.rs", "core/pd-console/src/mux.rs"] {
            let edit = channel_for_path(path);
            let coord = coordination_channel_for_path(path);
            assert_ne!(edit, coord, "a file's edit lane and coordination lane are different channels");
            assert_eq!(classify_channel(&edit), Some(Lane::EditSync));
            assert_eq!(classify_channel(&coord), Some(Lane::Coordination));
            // Both satisfy the daemon's validateChannel charset + length contract.
            for ch in [&edit, &coord] {
                assert!(ch.len() <= 100);
                assert!(ch.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '*' | '-')));
            }
        }
        // A non-editor channel classifies to neither lane.
        assert_eq!(classify_channel("agent:some-id"), None);
        assert_eq!(classify_channel("coordination:audit"), None);
    }

    #[test]
    fn coord_frame_round_trips_and_stays_off_the_edit_lanes() {
        let peer: PeerId = peer_id_for_identity("port-daddy:editor:agent-A");
        let signal = CoordSignal { peer, kind: CoordKind::ClaimAcquire, start_line: 12, end_line: 40 };
        let text = encode_coord_frame(signal);
        assert_eq!(decode_coord_frame(&text), Some(signal), "a coordination signal round-trips whole");

        // The coordination lane never crosses the edit lanes, in either direction.
        assert!(decode_frame(&text).is_none(), "op decoder rejects a coord frame");
        assert!(decode_presence_frame(&text).is_none(), "presence decoder rejects a coord frame");
        assert!(decode_snapshot_frame(&text).is_none(), "snapshot decoder rejects a coord frame");
        assert!(decode_coord_frame(&encode_frame(peer, &[1, 2, 3])).is_none(), "coord decoder rejects an op frame");
        assert!(decode_coord_frame("not json").is_none());
    }

    /// THE SLICE-3 ISOLATION PROOF — a keystroke burst on the edit lane cannot
    /// starve the coordination lane. We flood the edit lane far past its bounded
    /// capacity with op frames, interleave a handful of coordination signals, and
    /// assert EVERY coordination signal is delivered — because the two lanes are
    /// physically separate queues keyed by [`Lane`]. The counterfactual (a single
    /// shared queue — the anti-pattern the Decision Point forbids) is shown to drop
    /// those same signals, so the test is not vacuous: isolation is what saves them.
    #[test]
    fn keystroke_burst_on_edit_lane_does_not_starve_coordination() {
        let path = "/repo/src/hot_file.rs";
        let edit = channel_for_path(path);
        let coord = coordination_channel_for_path(path);
        let peer: PeerId = peer_id_for_identity("port-daddy:editor:agent-A");

        // Five agents hammering the buffer: 10_000 op frames — ~40x the queue cap.
        let burst = 10_000usize;
        // Six coordination signals that MUST get through (claim/predict control plane).
        let coord_frames: Vec<String> = (0..6)
            .map(|i| encode_coord_frame(CoordSignal {
                peer,
                kind: CoordKind::ConflictPredicted,
                start_line: i * 3 + 1,
                end_line: i * 3 + 2,
            }))
            .collect();

        // Isolated lanes (the real design): route the flood + the coord signals.
        let mut lanes = LaneQueues::new();
        for k in 0..burst {
            lanes.route(&edit, encode_frame(peer, &[(k % 251) as u8, 1, 2]));
            // Trickle the coord signals in, one every ~1500 keystrokes, so each lands
            // when the edit lane is already saturated far past its bound.
            let step = k / 1500;
            if k % 1500 == 0 && step < coord_frames.len() {
                lanes.route(&coord, coord_frames[step].clone());
            }
        }

        // The edit lane saturated at its bound (backpressure contained the firehose)…
        assert_eq!(lanes.edit_len(), LANE_QUEUE_CAP, "the edit lane is capped, not unbounded");
        // …while EVERY coordination signal was delivered intact.
        let delivered = lanes.drain_coord();
        assert_eq!(delivered.len(), coord_frames.len(), "no coordination signal was starved by the edit burst");
        for (got, want) in delivered.iter().zip(coord_frames.iter()) {
            let sig = decode_coord_frame(got).expect("a delivered coord frame still decodes");
            assert_eq!(&encode_coord_frame(sig), want, "the exact coordination signal survived");
        }

        // Counterfactual — the forbidden shared single queue: the same burst fills it
        // and the coordination signals are dropped. This is what isolation prevents.
        let mut shared: VecDeque<String> = VecDeque::new();
        let mut shared_coord_dropped = 0usize;
        for k in 0..burst {
            if shared.len() < LANE_QUEUE_CAP { shared.push_back(encode_frame(peer, &[(k % 251) as u8])); }
            if k % 1500 == 0 {
                if shared.len() < LANE_QUEUE_CAP { shared.push_back(coord_frames[k / 1500].clone()); }
                else { shared_coord_dropped += 1; }
            }
        }
        assert!(shared_coord_dropped > 0, "a SHARED queue starves coordination — the very failure isolation prevents");
    }

    /// A UNIQUE scratch dir per call, rooted at the COMPILE-TIME `CARGO_MANIFEST_DIR`
    /// (under `target/`, never `/tmp`). It does NOT read the runtime `HOME`: another
    /// test in this binary (`conjure`) hijacks the process-global `HOME` to a sandbox it
    /// then deletes, which would make a file written under `HOME` vanish before it is
    /// read back. `CARGO_MANIFEST_DIR` is immune; the `<pid>-<seq>` subdir keeps
    /// parallel tests isolated.
    fn scratch_dir() -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let base = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/editor-sync-tests");
        let unique = base.join(format!("{}-{}", std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir_all(&unique).expect("create scratch dir");
        unique
    }
}
