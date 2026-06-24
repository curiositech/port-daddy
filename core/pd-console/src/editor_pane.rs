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
use crate::buffer::{HarborBuffer, PeerId};
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;

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
        Self {
            path: path.into(),
            region,
            identity: identity.into(),
            buffer: None,
            truncated: false,
            error: None,
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
        let mut pane = make_pane(&path, None);

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
}
