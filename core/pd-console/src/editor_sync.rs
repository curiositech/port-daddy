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
//! and debounced. It still deliberately does NOT implement:
//!   - snapshots / persistence / salvage (slice 3 — a buffer that survives
//!     reconnect is out of scope; the buffer folded into here is the caller's), and
//!   - CRDT-anchored cursor positions (slice 2 carries line/col, which is lossy
//!     under concurrent edits — acceptable for an ephemeral presence hint; stable
//!     `loro::cursor` anchoring is a later refinement, called out at `PresenceState`).
//! What it DOES prove (see the tests): a doc-op exported by replica A is encoded
//! into a tube frame, decoded on the other side, and imported into replica B's
//! buffer byte-conflict-free with authorship intact — i.e. **doc-ops ride the tube
//! and land in the buffer**.
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
use std::collections::BTreeMap;

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
/// reconnecting or salvaged peer rejoins the *same* channel.
///
/// **Honest limitation:** this hashes the path string as given. Two peers must
/// pass the same spelling (e.g. both an absolute path) to converge; canonicalizing
/// divergent spellings to one identity is a slice-2 presence concern, not part of
/// the transport proof.
pub fn channel_for_path(path: &str) -> String {
    // FNV-1a 64-bit — same family as buffer.rs's peer id mint: deterministic,
    // dependency-free, and good enough for a collision-resistant channel key.
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

    /// Scratch dir under ~/coding/tmp (NEVER /tmp — the OS sweeps it).
    fn scratch_dir() -> std::path::PathBuf {
        let base = std::env::var("HOME")
            .map(|h| std::path::PathBuf::from(h).join("coding/tmp/pd-editor-sync-tests"))
            .unwrap_or_else(|_| {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/editor-sync-tests")
            });
        std::fs::create_dir_all(&base).expect("create scratch dir");
        base
    }
}
