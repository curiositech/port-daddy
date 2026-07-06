//! Harbor Editor P2, **slice 1: the transport** — how one file's Loro ops ride the
//! Port Daddy tube from one replica to another over the LAN, and land in a
//! [`HarborBuffer`](crate::buffer::HarborBuffer).
//!
//! ## Honest scope (read before extending)
//! This is ONLY the wire: a per-file **channel name**, a **frame codec** that
//! carries a Loro update blob as one tube message, and the **fold** that imports a
//! decoded frame into a buffer. It deliberately does NOT implement:
//!   - presence / remote cursors / selections (slice 2 — needs a keyed pool of
//!     peers, explicitly NOT built here), and
//!   - snapshots / persistence / salvage (slice 3 — a buffer that survives
//!     reconnect is out of scope; the buffer folded into here is the caller's).
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

/// The wire `kind` discriminant for a Loro update frame. One value today; kept as
/// a string (not a bare bool) so slice 2/3 frame kinds (`loro.snapshot`,
/// `presence.cursor`) land beside it without a breaking wire change.
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
