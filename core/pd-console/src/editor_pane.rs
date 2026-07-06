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
//! ## Honest scope
//! Still **read-only on screen**: there is NO live keystroke editing in this slice
//! (GPUI 0.2.x ships no text-input widget — that custom Element is the named NEXT
//! step). The buffer is editable programmatically (so a merged agent replica's
//! lines show up), but the human cannot type into it yet. We did not fake an
//! editable buffer. P3 claims (the wedge) are also not here; the `region` seam and
//! the authorship gutter built here are where they land.
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
use crate::buffer::{peer_id_for_identity, HarborBuffer, PeerId};
use crate::editor_sync::{
    decode_presence_frame, encode_presence_frame, PresenceDebouncer, PresenceState, PresenceStore,
};
use crate::pane::{Block, Pane, Subscription, Tone};
use anyhow::Result;
use std::collections::BTreeMap;

/// Minimum wall-clock gap (ms) between two presence broadcasts. Caret moves fire
/// faster than anyone reads; one send per ~60ms is smooth to a watcher yet keeps
/// the tube quiet. The gate is [`PresenceDebouncer`]; this is only its interval.
const PRESENCE_SEND_INTERVAL_MS: i64 = 60;

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
            if s.is_empty() { DEFAULT_IDENTITY.to_string() } else { s }
        }
        _ => DEFAULT_IDENTITY.to_string(),
    }
}

/// Width of the gutter line-number column for a file with `n` lines.
fn gutter_width(n: usize) -> usize {
    let digits = if n == 0 { 1 } else { (n as f64).log10().floor() as usize + 1 };
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
    /// The per-file tube channel this editor's op stream rides on (P2 slice 1),
    /// derived once from `path` via [`crate::editor_sync::channel_for_path`]. Two
    /// replicas opening the same file land on the same channel and exchange Loro op
    /// frames over it. Presence (slice 2) rides this SAME channel under a distinct
    /// frame kind.
    channel: String,
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
    /// binding the battle-plan requires for correct authorship and salvage.
    pub fn new_with_identity(
        path: impl Into<String>,
        region: Option<(u32, u32)>,
        identity: impl Into<String>,
    ) -> Self {
        let path = path.into();
        let identity = identity.into();
        // Derive the sync channel once at construction — it is a pure function of
        // the path, so it is stable for the pane's whole life (and matches every
        // other replica that opens the same file).
        let channel = crate::editor_sync::channel_for_path(&path);
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
            presence: PresenceStore::new(local_peer),
            remote: BTreeMap::new(),
            presence_out: PresenceDebouncer::new(PRESENCE_SEND_INTERVAL_MS),
            // A bare caret at the top of the file until the input layer moves it.
            local_presence: PresenceState::caret(1, 0, 1, 1),
        }
    }

    /// Synchronously open the bound file into a Loro buffer, recording any error.
    /// Used by the GPUI render path (`&self`-sync construction) and by `refresh()`.
    /// Idempotent: clears prior state before loading.
    pub fn load(&mut self) {
        self.buffer = None;
        self.truncated = false;
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

    /// The per-file tube channel this editor's op stream rides on. Callers open the
    /// live receiver with `DaemonClient::subscribe_channel(pane.channel())` and hand
    /// each `TubeMsg::text` back to [`ingest_frame`](Self::ingest_frame).
    pub fn channel(&self) -> &str {
        &self.channel
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
        crate::editor_sync::apply_frame(buffer, &frame).is_ok()
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
    /// debounced broadcast. This is the injection point for the (not-yet-built)
    /// keystroke input layer, mirroring how `HarborBuffer::insert_authored` is the
    /// injection point for edits. Recording is cheap and does not itself send or
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

    /// Is the 1-based line `n` inside the bound region (inclusive)?
    fn in_region(&self, n: u32) -> bool {
        matches!(self.region, Some((start, end)) if n >= start && n <= end)
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
        let all_lines = buffer.lines();
        let total = all_lines.len();
        let shown = total.min(MAX_LINES);
        let width = gutter_width(total);

        // Legend: which tag is the operator vs an agent replica. Rendered as a
        // tone-bearing Flag so the authorship vocabulary is visible at a glance and
        // color carries meaning (Resting = you/opener, Engaged = an agent peer).
        blocks.push(Block::Flag {
            letter: 'H',
            label: format!("operator {} (opener)", author_tag(opener)),
            tone: Tone::Resting,
        });

        let mut saw_agent = false;
        for line in all_lines.iter().take(shown) {
            if matches!(line.author_peer, Some(p) if p != opener) {
                saw_agent = true;
                break;
            }
        }
        if saw_agent {
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

        for (i, line) in all_lines.iter().take(shown).enumerate() {
            let n = (i + 1) as u32; // 1-based line numbers.
            let num = format!("{n:>width$}", width = width);
            // Authorship marker: the short author tag, prefixed with a region
            // marker chip when this line is inside the bound region. Both faces
            // paint this same gutter cell; the GPUI face additionally tones the
            // cell via author_tone(line.author_peer, opener).
            let tag = match line.author_peer {
                Some(p) => author_tag(p),
                None => "··".into(),
            };
            let region_mark = if self.in_region(n) { "▍" } else { " " };
            let gutter = format!("{region_mark}{num} {tag}");
            blocks.push(Block::Row(vec![gutter, line.text.clone()]));
        }

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
        self.buffer
            .as_ref()
            .map(|_| Subscription::Editor { channel: self.channel.clone() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buffer::peer_id_for_identity;
    use std::io::Write;
    use std::path::PathBuf;

    /// Scratch dir under ~/coding/tmp (NEVER /tmp — the OS sweeps it). Falls back
    /// to the crate's target dir if HOME is unset.
    fn scratch_dir() -> PathBuf {
        let base = std::env::var("HOME")
            .map(|h| PathBuf::from(h).join("coding/tmp/pd-harbor-editor-tests"))
            .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/editor-tests"));
        std::fs::create_dir_all(&base).expect("create scratch dir");
        base
    }

    fn write_temp(name: &str, contents: &str) -> String {
        let path = scratch_dir().join(name);
        let mut f = std::fs::File::create(&path).expect("create temp file");
        f.write_all(contents.as_bytes()).expect("write temp file");
        path.to_string_lossy().into_owned()
    }

    fn make_pane(path: &str, region: Option<(u32, u32)>) -> EditorPane {
        let mut p = EditorPane::new_with_identity(path, region, "port-daddy:console:operator");
        p.load();
        p
    }

    fn row_count(blocks: &[Block]) -> usize {
        blocks.iter().filter(|b| matches!(b, Block::Row(_))).count()
    }

    fn rows(blocks: &[Block]) -> Vec<&Vec<String>> {
        blocks
            .iter()
            .filter_map(|b| if let Block::Row(c) = b { Some(c) } else { None })
            .collect()
    }

    #[test]
    fn view_yields_one_row_per_line_with_gutter_numbers() {
        let path = write_temp("known.txt", "alpha\nbravo\ncharlie\n");
        let pane = make_pane(&path, None);
        let blocks = pane.view();

        assert!(matches!(&blocks[0], Block::Header(h) if h == "edit known.txt"));
        assert_eq!(row_count(&blocks), 3, "three content lines → three rows");

        let r = rows(&blocks);
        // Gutter cell holds the 1-based number; content cell holds the text.
        assert!(r[0][0].contains('1'));
        assert_eq!(r[0][1], "alpha");
        assert!(r[1][0].contains('2'));
        assert_eq!(r[2][1], "charlie");
    }

    #[test]
    fn unreadable_path_yields_one_error_block() {
        let pane = make_pane("/nonexistent/path/does/not/exist.rs", None);
        let blocks = pane.view();
        assert_eq!(row_count(&blocks), 0, "an unreadable file renders no content rows");
        let error_blocks = blocks
            .iter()
            .filter(|b| matches!(b, Block::KeyVal(k, _) if k == "error"))
            .count();
        assert_eq!(error_blocks, 1, "exactly one error block on an unreadable path");
    }

    #[test]
    fn region_marks_the_right_lines() {
        let path = write_temp("region.txt", "l1\nl2\nl3\nl4\nl5\n");
        let pane = make_pane(&path, Some((2, 4)));
        let blocks = pane.view();
        let r = rows(&blocks);
        assert_eq!(r.len(), 5);
        // The region marker "▍" prefixes only lines 2,3,4 (indices 1,2,3).
        let marked: Vec<bool> = r.iter().map(|c| c[0].starts_with('▍')).collect();
        assert_eq!(marked, vec![false, true, true, true, false]);
    }

    #[test]
    fn large_file_is_capped_and_marked_truncated() {
        let big: String = (0..(MAX_LINES + 50)).map(|i| format!("line {i}\n")).collect();
        let path = write_temp("big.txt", &big);
        let pane = make_pane(&path, None);
        let blocks = pane.view();
        assert_eq!(row_count(&blocks), MAX_LINES, "capped at MAX_LINES rows");
        let has_trunc = blocks
            .iter()
            .any(|b| matches!(b, Block::Chip { label, .. } if label.contains("truncated")));
        assert!(has_trunc, "a truncation chip is appended when the cap is hit");
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
        assert!(resting_flag, "operator authorship legend flag (Resting) must render");
        assert!(engaged_flag, "agent authorship legend flag (Engaged) must render once an agent line merges");

        // The two lines carry different gutter author tags.
        let r = rows(&blocks);
        assert_eq!(r.len(), 2, "human line + merged agent line");
        let human_tag = author_tag(opener);
        let agent_tag = author_tag(peer_id_for_identity(agent_id));
        assert!(r[0][0].contains(&human_tag), "line 0 gutter carries the operator's author tag");
        assert!(r[1][0].contains(&agent_tag), "line 1 gutter carries the agent's author tag");
        assert_eq!(r[1][1], "agent added this");
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
            Some(Subscription::Editor { channel }) => {
                assert_eq!(channel, crate::editor_sync::channel_for_path(&path));
                assert_eq!(channel, pane.channel());
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
        assert!(pane.ingest_frame(&frame), "a remote op frame must land in the buffer");

        // The pane now renders the agent's line with agent authorship.
        let blocks = pane.view();
        let r = rows(&blocks);
        assert_eq!(r.len(), 2, "human line + wired-in agent line");
        assert_eq!(r[1][1], "agent added over the wire");
        let agent_tag = author_tag(peer_id_for_identity(agent_id));
        assert!(
            r[1][0].contains(&agent_tag),
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
        assert!(!pane.ingest_frame(&self_frame), "our own echoed ops must not re-fold");
        assert!(!pane.ingest_frame("not a frame at all"), "garbage is ignored");
        assert_eq!(rows(&pane.view()).len(), 2, "buffer unchanged by self-echo/garbage");
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
        assert!(pane.remote_cursors().is_empty(), "no remote cursors before any frame");

        let a = "port-daddy:editor:agent-A";
        let b = "port-daddy:editor:agent-B";
        let frame_a = remote_presence_frame(a, PresenceState::caret(2, 0, 1, 4));
        let frame_b = remote_presence_frame(
            b,
            PresenceState { cursor_line: 3, cursor_col: 1, anchor_line: 4, anchor_col: 0, top_line: 1, bottom_line: 4 },
        );

        assert!(pane.ingest_presence(&frame_a), "A's cursor is a real change");
        assert!(pane.ingest_presence(&frame_b), "B's cursor is a real change");

        let pool = pane.remote_cursors();
        assert_eq!(pool.len(), 2, "both remote cursors pooled");
        assert_eq!(pool.get(&peer_id_for_identity(a)).map(|s| s.cursor_line), Some(2));
        assert_eq!(cursor_flags(&pane.view()), 2, "two presence legend flags render");

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
        let frame = pane.take_presence_broadcast(1_000).expect("a due move broadcasts");
        let decoded = decode_presence_frame(&frame).expect("the broadcast is a presence frame");
        assert_eq!(decoded.peer, local, "the frame is attributed to THIS replica");

        // Within the interval, a further move does not flush again.
        pane.set_local_presence(PresenceState::caret(1, 4, 1, 1));
        assert!(pane.take_presence_broadcast(1_020).is_none(), "suppressed inside the debounce window");
        // Past the interval it flushes.
        assert!(pane.take_presence_broadcast(1_500).is_some(), "flushes after the interval");
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
            cursor_line: 2, cursor_col: 0, anchor_line: 4, anchor_col: 1, top_line: 1, bottom_line: 5,
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
        let frame_a = encode_presence_frame(store_a.local(), &store_a.publish(PresenceState::caret(2, 0, 1, 5)));
        let frame_b = encode_presence_frame(store_b.local(), &store_b.publish(PresenceState::caret(4, 1, 1, 5)));
        assert!(pane.ingest_presence(&frame_a), "A's first cursor repaints once");
        assert!(pane.ingest_presence(&frame_b), "B's first cursor repaints once");
        assert_eq!(pane.remote_cursors().len(), 2, "two cursors are on screen");

        // Idle: nothing changes. Count every repaint-worthy edge over 240 ticks.
        let mut repaints = 0usize;
        for tick in 0..240i64 {
            let now = 1_000 + tick * 16; // ~60fps
            // Pure reads must never mutate or repaint on their own.
            let _ = pane.view();
            let _ = pane.remote_cursors();
            // Re-delivering the SAME frames (stale LWW) folds to no change.
            if pane.ingest_presence(&frame_a) { repaints += 1; }
            if pane.ingest_presence(&frame_b) { repaints += 1; }
            // No local movement → nothing to broadcast.
            if pane.take_presence_broadcast(now).is_some() { repaints += 1; }
            // Expiry before the timeout removes nobody.
            if pane.expire_presence() { repaints += 1; }
        }
        assert_eq!(repaints, 0, "an idle screen with 2+ remote cursors must not re-render");
        assert_eq!(pane.remote_cursors().len(), 2, "both cursors still present after idle");

        // The gate is not vacuous: a GENUINE new remote cursor repaints exactly
        // once (a new PeerId is unambiguously a pool change, independent of clock
        // resolution), and replaying that same frame does not.
        let c = "port-daddy:editor:agent-C";
        let store_c = PresenceStore::new(peer_id_for_identity(c));
        let frame_c = encode_presence_frame(store_c.local(), &store_c.publish(PresenceState::caret(5, 2, 1, 5)));
        assert!(pane.ingest_presence(&frame_c), "a genuine new cursor re-renders once");
        assert!(!pane.ingest_presence(&frame_c), "replaying that same frame does not re-render");
        assert_eq!(pane.remote_cursors().len(), 3, "the new cursor joined the pool");
    }
}
