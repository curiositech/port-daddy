//! `HarborBuffer` — the Loro CRDT substrate behind the Harbor Editor (battle-plan
//! §3, P1 row). This is the slice that proves **agents and humans are co-equal
//! replicas**: every editing actor — operator or dispatched agent — is a first-class
//! Loro replica keyed to its Port Daddy identity, and two such replicas' edits
//! merge byte-conflict-free with per-line authorship preserved.
//!
//! ## Honest scope (read before extending)
//! This remains the renderer-free substrate. Live selection, IME, clipboard and
//! grapheme navigation live in `editor_input.rs`; `EditorPane` translates those
//! accepted UTF-8 replacements into the authored incremental deltas implemented
//! here. Claims and `/conflicts/predict` remain policy above this buffer.
//!
//! ## Renderer-agnostic on purpose
//! Nothing here touches gpui. The buffer compiles and unit-tests on Linux with the
//! default (no-`gpui`) feature set, so the co-equal-replica proof runs in CI.
//!
//! ## Identity → PeerID mapping
//! A Loro `PeerID` is a `u64`. We mint one deterministically from the actor's PD
//! identity string (`project:stack:context` for an agent, the OS user for a human,
//! whatever `pd whoami` reports) by hashing it with FNV-1a. The same identity
//! therefore always maps to the same replica — authorship and audit survive
//! reconnect/salvage (battle-plan risk: "Loro-replica↔PD-identity binding must
//! survive reconnect"). We mask off `u64::MAX` because Loro reserves it.

use loro::{ExpandType, ExportMode, LoroDoc, LoroText, StyleConfig, StyleConfigMap};
use std::ops::Range;

/// Loro container name for the file's text. One file = one `LoroDoc` holding one
/// `LoroText` under this key (battle-plan §3).
const TEXT_CONTAINER: &str = "content";

/// The richtext mark key under which we record the authoring replica's PeerID.
/// Loro marks merge with the text and carry per-span attributes, so this is how
/// authorship rides along inside the CRDT itself rather than in a side table that
/// could drift out of sync on merge.
const AUTHOR_MARK: &str = "author";

/// A Loro replica id. `u64` per `loro_common::PeerID`; re-aliased here so the
/// public surface does not force callers to depend on the loro crate directly.
pub type PeerId = u64;

/// Mint a stable Loro `PeerId` from a PD identity string.
///
/// FNV-1a over the identity's bytes — deterministic, dependency-free, and stable
/// across process restarts so a salvaged successor replaying a dead actor's
/// identity lands on the *same* replica id (authorship stays attributed to the
/// original actor). We clear the top bit's all-ones edge by masking `u64::MAX`,
/// which Loro reserves internally.
pub fn peer_id_for_identity(identity: &str) -> PeerId {
    // FNV-1a 64-bit.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in identity.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    // Avoid the single reserved sentinel; everything else is a valid replica id.
    if hash == u64::MAX {
        hash ^= 1;
    }
    hash
}

/// One line of the buffer as rendered: its text (newline stripped) plus the
/// replica that authored it, if known. `author_peer` is `None` only for content
/// that carries no author mark (e.g. a file's initial bytes loaded before any
/// authored edit — see `open`, which DOES attribute the initial load).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LineView {
    pub text: String,
    pub author_peer: Option<PeerId>,
}

/// A Loro-backed collaborative buffer for a single file. Renderer-agnostic and
/// unit-testable without gpui.
pub struct HarborBuffer {
    doc: LoroDoc,
    text: LoroText,
    /// This buffer's own replica id (the local actor). Retained for diagnostics
    /// and so callers can label "me" in the gutter.
    local_peer: PeerId,
    /// The PD identity string this replica was opened under (for audit/debug).
    identity: String,
}

impl HarborBuffer {
    /// Build the style map that registers the `author` mark. Marks need a
    /// registered `StyleConfig` so the attribute is preserved as a span value;
    /// `ExpandType::None` means typing at a line's boundary does NOT silently
    /// inherit the neighbouring line's author — each insert must mark its own
    /// span, which is exactly the per-line attribution contract we want.
    fn author_styles() -> StyleConfigMap {
        let mut styles = StyleConfigMap::new();
        styles.insert(
            AUTHOR_MARK.into(),
            StyleConfig {
                expand: ExpandType::None,
            },
        );
        styles
    }

    /// Construct an empty buffer for `identity` with no backing file content.
    /// Used by tests and by callers that will `insert_authored` programmatically
    /// (e.g. a second "agent" replica). Use [`open`] to load a real file.
    pub fn empty(identity: impl Into<String>) -> Self {
        let identity = identity.into();
        let local_peer = peer_id_for_identity(&identity);
        let doc = LoroDoc::new();
        // PeerID set must precede any op so the first edit is attributed correctly.
        doc.set_peer_id(local_peer)
            .expect("set_peer_id on a fresh doc");
        doc.config_text_style(Self::author_styles());
        let text = doc.get_text(TEXT_CONTAINER);
        Self {
            doc,
            text,
            local_peer,
            identity,
        }
    }

    /// Open a file from local disk into a Loro buffer under `identity`'s replica.
    ///
    /// The file's bytes become the initial `LoroText` content, authored to this
    /// replica (so even the seed content has provenance — a human who opened the
    /// file owns its initial lines until an agent edits them). Returns an error
    /// only if the file cannot be read; an empty file yields an empty buffer.
    pub fn open(
        path: &str,
        identity: impl Into<String>,
    ) -> std::result::Result<Self, std::io::Error> {
        let contents = std::fs::read_to_string(path)?;
        let buf = Self::empty(identity);
        if !contents.is_empty() {
            buf.text
                .insert(0, &contents)
                .expect("seed insert into fresh LoroText");
            let len = buf.text.len_unicode();
            buf.text
                .mark(0..len, AUTHOR_MARK, buf.local_peer as i64)
                .expect("mark seed content with opener's peer");
            buf.doc.commit();
        }
        Ok(buf)
    }

    /// The local replica's PeerId.
    pub fn local_peer(&self) -> PeerId {
        self.local_peer
    }

    /// The PD identity string this replica opened under.
    pub fn identity(&self) -> &str {
        &self.identity
    }

    /// Insert `s` at Unicode position `pos`, authored to this replica, and mark
    /// the inserted span with this replica's PeerId. Appending a full line should
    /// include its trailing `\n`.
    pub fn insert_authored(&self, pos: usize, s: &str) {
        let _ = self.replace_authored(pos..pos, s);
    }

    /// Replace a Unicode-scalar range with locally-authored text and return only
    /// the newly-created Loro update bytes. The returned delta is the exact op
    /// the live editor broadcasts; it does not resend the file's full history on
    /// every keystroke.
    pub fn replace_authored(&self, range: Range<usize>, s: &str) -> Vec<u8> {
        let len = self.text.len_unicode();
        assert!(
            range.start <= range.end && range.end <= len,
            "authored replacement range {range:?} must fit Unicode length {len}"
        );
        if range.is_empty() && s.is_empty() {
            return Vec::new();
        }

        let before = self.doc.oplog_vv();
        if !range.is_empty() {
            self.text
                .delete(range.start, range.end - range.start)
                .expect("delete authored span");
        }
        if !s.is_empty() {
            self.text
                .insert(range.start, s)
                .expect("insert authored span");
            let inserted_len = s.chars().count();
            self.text
                .mark(
                    range.start..(range.start + inserted_len),
                    AUTHOR_MARK,
                    self.local_peer as i64,
                )
                .expect("mark authored span");
        }
        self.doc.commit();
        self.doc
            .export(ExportMode::updates(&before))
            .expect("export authored replacement delta")
    }

    /// Append `line` (a single logical line WITHOUT a trailing newline) at the end
    /// of the buffer, authored to this replica. A newline is added so the next
    /// append starts a fresh line. Convenience over `insert_authored` for the
    /// common "agent adds a line" case the merge test exercises.
    pub fn append_line(&self, line: &str) {
        let end = self.text.len_unicode();
        self.insert_authored(end, &format!("{line}\n"));
    }

    /// Export this replica's ops for another replica to import. Uses
    /// `ExportMode::all_updates()` — the full update log — which is what a fresh
    /// peer needs to merge (battle-plan §3: "a SECOND replica's ops can merge in").
    pub fn export_ops(&self) -> Vec<u8> {
        self.doc.commit();
        self.doc
            .export(ExportMode::all_updates())
            .expect("export updates")
    }

    /// Export a **compacted full-state snapshot** of this buffer — the durability
    /// primitive for P2 slice 3. Where [`export_ops`](Self::export_ops) is the
    /// unbounded update *log*, this is Loro's `ExportMode::Snapshot`: the current
    /// state + history folded into one blob a fresh (or reconnecting/salvaging)
    /// replica imports via [`apply_remote_ops`](Self::apply_remote_ops) to
    /// reconstruct the doc in one shot — no full-history replay. This is the byte
    /// stream that rides to the content-addressed `/blob` store (build-coop-ide-gpui
    /// ref 03 §3: "doc snapshots → content-addressed `/blob` … the salvage
    /// substrate"), so a peer that missed the live op stream catches up from
    /// snapshot+recent-deltas instead of the whole log.
    pub fn export_snapshot(&self) -> Vec<u8> {
        self.doc.commit();
        self.doc
            .export(ExportMode::snapshot())
            .expect("export snapshot")
    }

    /// Import another replica's exported ops, merging them into this buffer. This
    /// is the M×N proof: agent B's edits land here, byte-conflict-free, each line
    /// still attributed to its authoring replica. Returns an error if the bytes
    /// are not a valid Loro update blob.
    pub fn apply_remote_ops(&self, export_bytes: &[u8]) -> std::result::Result<(), String> {
        self.doc.import(export_bytes).map_err(|e| format!("{e}"))?;
        self.doc.commit();
        Ok(())
    }

    /// The full text content (all lines, newlines intact).
    pub fn to_string(&self) -> String {
        self.text.to_string()
    }

    /// A cheap, comparable stamp of the buffer's current CRDT state (the
    /// encoded state version vector). Equal stamps ⇒ identical content, so the
    /// editor pane rebuilds its tokenized render cache ONLY when this changes —
    /// including changes applied through a shared `&HarborBuffer` (interior
    /// mutability) that the pane never saw as a method call.
    pub fn change_stamp(&self) -> Vec<u8> {
        self.doc.state_vv().encode()
    }

    /// Derive per-line views with authorship.
    ///
    /// ## Attribution approach (honest)
    /// Authorship lives in Loro richtext marks: every authored insert marks its
    /// span with the inserting replica's PeerId. `get_richtext_value()` returns
    /// the text as a list of spans, each carrying its `author` attribute, and
    /// these merge deterministically across replicas (proven in the merge test).
    /// We walk those spans, accumulate characters into lines, and attribute each
    /// line to the author of the span that contributes its FIRST character.
    ///
    /// **The approximation:** if a single line is straddled by two spans with
    /// different authors (e.g. one replica inserted mid-line into another's line),
    /// the line is attributed to the author of its leading character, not split
    /// per-character. The battle-plan explicitly sanctions this per-line
    /// approximation over heavy per-char attribution; line-granular authorship is
    /// the right grain for the gutter marker anyway. Per-character attribution is
    /// a later refinement, not a correctness gap in the co-equal-replica proof.
    pub fn lines(&self) -> Vec<LineView> {
        let spans = self.richtext_spans();
        let mut lines: Vec<LineView> = Vec::new();
        // The author of the line currently being built; `None` until the first
        // char lands. Once set for a line, it sticks (leading-char attribution).
        let mut current_author: Option<PeerId> = None;
        let mut current_text = String::new();
        let mut line_started = false;

        for (chunk, author) in spans {
            for ch in chunk.chars() {
                if ch == '\n' {
                    lines.push(LineView {
                        text: std::mem::take(&mut current_text),
                        author_peer: current_author.take(),
                    });
                    line_started = false;
                } else {
                    if !line_started {
                        current_author = author;
                        line_started = true;
                    }
                    current_text.push(ch);
                }
            }
        }
        // Trailing content without a final newline is still a line.
        if line_started || !current_text.is_empty() {
            lines.push(LineView {
                text: current_text,
                author_peer: current_author,
            });
        }
        lines
    }

    /// Decompose the richtext value into `(text_chunk, author_peer)` spans. The
    /// `get_richtext_value()` shape is a JSON-ish list of
    /// `{"insert": "...", "attributes": {"author": <peerid>}}` objects; spans
    /// without an `author` attribute (none, in practice, since `open`/`insert`
    /// always mark) yield `None`.
    fn richtext_spans(&self) -> Vec<(String, Option<PeerId>)> {
        let value = self.text.get_richtext_value();
        let mut out: Vec<(String, Option<PeerId>)> = Vec::new();
        // LoroValue → JSON is the documented, stable way to read spans here.
        if let Ok(json) = serde_json::to_value(&value) {
            if let Some(arr) = json.as_array() {
                for span in arr {
                    let insert = span
                        .get("insert")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let author = span
                        .get("attributes")
                        .and_then(|a| a.get(AUTHOR_MARK))
                        .and_then(|p| p.as_i64())
                        .map(|p| p as PeerId);
                    if !insert.is_empty() {
                        out.push((insert, author));
                    }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stable PD identity → PeerId mapping: same identity, same id; different
    /// identities, (overwhelmingly) different ids. This underpins the
    /// replica↔identity binding that authorship and salvage depend on.
    #[test]
    fn peer_id_is_stable_and_identity_specific() {
        let human = "port-daddy:console:erich";
        let agent = "port-daddy:editor:refactor-agent";
        assert_eq!(
            peer_id_for_identity(human),
            peer_id_for_identity(human),
            "same identity must mint the same replica id (salvage depends on this)"
        );
        assert_ne!(
            peer_id_for_identity(human),
            peer_id_for_identity(agent),
            "distinct actors must be distinct replicas"
        );
        assert_ne!(
            peer_id_for_identity(human),
            u64::MAX,
            "must dodge the reserved sentinel"
        );
    }

    /// Opening a real file seeds the buffer and attributes every initial line to
    /// the opener's replica.
    #[test]
    fn open_seeds_lines_attributed_to_opener() {
        let dir = scratch_dir();
        let path = dir.join("seed.txt");
        std::fs::write(&path, "alpha\nbravo\ncharlie\n").unwrap();
        let id = "port-daddy:console:operator";
        let buf = HarborBuffer::open(path.to_str().unwrap(), id).unwrap();

        let opener = peer_id_for_identity(id);
        let lines = buf.lines();
        assert_eq!(lines.len(), 3, "three seeded lines");
        assert_eq!(lines[0].text, "alpha");
        assert_eq!(lines[2].text, "charlie");
        for (i, l) in lines.iter().enumerate() {
            assert_eq!(
                l.author_peer,
                Some(opener),
                "line {i} must be attributed to the opener replica"
            );
        }
    }

    #[test]
    fn authored_replacement_deletes_unicode_and_exports_only_the_delta() {
        let human = HarborBuffer::empty("port-daddy:console:human");
        human.insert_authored(0, "a😀z\n");
        let agent = HarborBuffer::empty("port-daddy:editor:agent");
        agent.apply_remote_ops(&human.export_ops()).unwrap();

        // Loro positions are Unicode scalar offsets: the emoji occupies one.
        let delta = human.replace_authored(1..2, "é");
        assert_eq!(human.to_string(), "aéz\n");
        agent.apply_remote_ops(&delta).unwrap();
        assert_eq!(agent.to_string(), human.to_string());

        // The replacement span keeps local authorship after a remote import.
        let spans = human.richtext_spans();
        assert!(spans
            .iter()
            .any(|(text, author)| { text.contains('é') && *author == Some(human.local_peer()) }));
    }

    /// THE P1 DELIVERABLE — the co-equal-replica proof.
    ///
    /// Replica A (operator) opens a file. Replica B (an "agent") starts from A's
    /// exported state, inserts a line, and exports its ops. A imports B's ops.
    /// Afterwards A's `lines()` shows BOTH contributions, each attributed to the
    /// correct replica. Humans and agents are the same kind of participant —
    /// distinguished only by PeerID provenance.
    #[test]
    fn two_replicas_merge_with_correct_authorship() {
        let dir = scratch_dir();
        let path = dir.join("merge.txt");
        std::fs::write(&path, "human line one\nhuman line two\n").unwrap();

        let human_id = "port-daddy:console:human";
        let agent_id = "port-daddy:editor:agent-A";
        let human_peer = peer_id_for_identity(human_id);
        let agent_peer = peer_id_for_identity(agent_id);
        assert_ne!(
            human_peer, agent_peer,
            "the two actors are distinct replicas"
        );

        // Replica A — the operator opens the file.
        let replica_a = HarborBuffer::open(path.to_str().unwrap(), human_id).unwrap();

        // Replica B — the agent. It joins by importing A's state, then edits.
        let replica_b = HarborBuffer::empty(agent_id);
        replica_b
            .apply_remote_ops(&replica_a.export_ops())
            .expect("agent imports operator's state");
        replica_b.append_line("agent refactored parse_header");

        // Merge B's ops back into A (the M×N proof).
        replica_a
            .apply_remote_ops(&replica_b.export_ops())
            .expect("operator imports the agent's ops");

        // A now sees both contributions, each correctly attributed.
        let lines = replica_a.lines();
        assert_eq!(
            lines.len(),
            3,
            "two human lines + one agent line after merge"
        );
        assert_eq!(lines[0].text, "human line one");
        assert_eq!(
            lines[0].author_peer,
            Some(human_peer),
            "human authored line 0"
        );
        assert_eq!(
            lines[1].author_peer,
            Some(human_peer),
            "human authored line 1"
        );
        assert_eq!(lines[2].text, "agent refactored parse_header");
        assert_eq!(
            lines[2].author_peer,
            Some(agent_peer),
            "the agent's line is attributed to the agent replica, not the human"
        );

        // Merge is symmetric: B also converges to the same byte content.
        assert_eq!(
            replica_a.to_string(),
            replica_b.to_string(),
            "both replicas converge to identical content (CRDT byte-merge)"
        );
    }

    /// Importing the same ops twice is idempotent (a salvage/replay successor may
    /// re-import; the buffer must not duplicate lines). Foundational for the P3.5
    /// salvage story even though salvage itself is not in this slice.
    #[test]
    fn reimporting_ops_is_idempotent() {
        let a = HarborBuffer::empty("port-daddy:editor:a");
        a.append_line("one");
        let b = HarborBuffer::empty("port-daddy:editor:b");
        let ops = a.export_ops();
        b.apply_remote_ops(&ops).unwrap();
        b.apply_remote_ops(&ops).unwrap(); // replay the same delta
        assert_eq!(
            b.lines().len(),
            1,
            "re-importing identical ops must not duplicate the line"
        );
    }

    /// P2 slice 3 durability: a compacted snapshot reconstructs the whole buffer —
    /// content AND per-line authorship — in one import, exactly what a reconnecting
    /// or salvaging replica does after fetching the snapshot blob from `/blob`.
    #[test]
    fn snapshot_reconstructs_content_and_authorship() {
        let human_id = "port-daddy:console:human";
        let agent_id = "port-daddy:editor:agent-A";
        let human_peer = peer_id_for_identity(human_id);
        let agent_peer = peer_id_for_identity(agent_id);

        // A two-replica doc: the operator's seed line + an agent's merged line.
        let a = HarborBuffer::empty(human_id);
        a.append_line("human line");
        let agent = HarborBuffer::empty(agent_id);
        agent.apply_remote_ops(&a.export_ops()).unwrap();
        agent.append_line("agent line");
        a.apply_remote_ops(&agent.export_ops()).unwrap();

        // Snapshot the live doc, then rebuild a cold replica from ONLY that blob.
        let snapshot = a.export_snapshot();
        let restored = HarborBuffer::empty("port-daddy:console:successor");
        restored
            .apply_remote_ops(&snapshot)
            .expect("a snapshot blob imports like any Loro export");

        assert_eq!(
            restored.to_string(),
            a.to_string(),
            "snapshot restores exact bytes"
        );
        let lines = restored.lines();
        assert_eq!(lines.len(), 2);
        assert_eq!(
            lines[0].author_peer,
            Some(human_peer),
            "authorship survives the snapshot"
        );
        assert_eq!(
            lines[1].author_peer,
            Some(agent_peer),
            "the agent's line stays the agent's"
        );

        // Re-importing the snapshot is idempotent (double-consume safety).
        restored.apply_remote_ops(&snapshot).unwrap();
        assert_eq!(
            restored.lines().len(),
            2,
            "re-applying the snapshot must not duplicate lines"
        );
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
        let base = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/buffer-tests");
        let unique = base.join(format!(
            "{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&unique).expect("create scratch dir");
        unique
    }
}
