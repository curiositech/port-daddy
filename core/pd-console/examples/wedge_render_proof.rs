//! Visual-proof harness for PR #729 (`harbor-editor/wire-wedge-live`).
//!
//! WHAT THIS IS (be honest about it): this renders the **repl / TUI "second
//! face"** of the Harbor Editor — NOT the gpui window. Per
//! `core/pd-console/docs/recording-visual-artifacts.md`, the gpui element tree
//! cannot render windowless, and `screencapture` is denied in a headless/TCC
//! context, so the gpui face is not screenshot-capturable here. The console is a
//! "one pane, two faces" design: the gpui window and this headless painter emit
//! the SAME `pane::Block`s. This harness seeds the in-editor wedge with the
//! EXACT state asserted by the committed CI test
//! `wired_editor_surface_renders_wedge_with_conflicts_above_housekeeping`
//! (`src/editor_pane.rs`), then paints the real `EditorPane::view()` Blocks
//! through the repl's real painter `term::render_blocks` — so the claim band,
//! the `Tone::Conflicted` predicted-conflict band, the `Tone::Gated` contender +
//! commit-gate chips, and the remote presence cursor are ACTUAL rendered pixels.
//!
//! Run:  cargo run --example wedge_render_proof   (no `gpui` feature needed)
//!
//! The `#[path]` include set is the same closure the `pd-console-repl` bin
//! compiles (no gpui). `crate::…` resolves because each file is a module of this
//! example crate, exactly as they are modules of the repl bin.

#![allow(dead_code)]
#![allow(unused_imports)]

#[path = "../src/berths.rs"]
mod berths; // agent.rs's DaemonClient::discover() needs crate::berths::default_url()
#[path = "../src/agent.rs"]
mod agent;
#[path = "../src/buffer.rs"]
mod buffer;
#[path = "../src/theme.rs"]
mod theme;
#[path = "../src/pane.rs"]
mod pane;
#[path = "../src/term.rs"]
mod term;
#[path = "../src/editor_sync.rs"]
mod editor_sync;
#[path = "../src/editor_claims.rs"]
mod editor_claims;
#[path = "../src/editor_wedge.rs"]
mod editor_wedge;
#[path = "../src/editor_commit_gate.rs"]
mod editor_commit_gate;
#[path = "../src/editor_pane.rs"]
mod editor_pane;
#[path = "../src/syntax.rs"]
mod syntax;

use editor_pane::EditorPane;
use editor_sync::PresenceState;
use pane::Pane;
use term::{ColorMode, TermStyle};

/// A plausible Rust source so the editor reads like a real file. `parse_header`
/// spans lines 10–18, so a claim on L10–20 lands squarely on that symbol and a
/// local selection of L12–18 sits inside it.
const SAMPLE: &str = "\
// harbor/src/wire.rs — frame header codec
use crate::codec::{Frame, HEADER_BYTES};

pub struct Header {
    pub len: u32,
    pub kind: u8,
    pub flags: u16,
}

pub fn parse_header(buf: &[u8]) -> Option<Header> {
    if buf.len() < HEADER_BYTES {
        return None;
    }
    let len = u32::from_be_bytes(buf[0..4].try_into().ok()?);
    let kind = buf[4];
    let flags = u16::from_be_bytes(buf[5..7].try_into().ok()?);
    Some(Header { len, kind, flags })
}

pub fn frame_len(h: &Header) -> usize {
    h.len as usize + HEADER_BYTES
}

// TODO: zero-copy header view over the ring buffer.
";

fn write_sample() -> String {
    // Under the crate's own target/ dir — NEVER /tmp (macOS purges it).
    let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/wedge-proof");
    std::fs::create_dir_all(&dir).expect("create scratch dir");
    let path = dir.join("wire.rs");
    std::fs::write(&path, SAMPLE).expect("write sample source");
    path.to_string_lossy().into_owned()
}

fn main() {
    let path = write_sample();

    // The local operator's editor replica.
    let mut pane = EditorPane::new_with_identity(&path, None, "port-daddy:editor:agent-local");
    pane.load();

    // (1) Coordination lane — a REMOTE actor B (human-B) is first-granted owner of
    // parse_header (L10–20) at t=100, delivered through the producer's coord fold hook.
    let mut actor_b =
        EditorPane::new_with_identity(&path, None, "port-daddy:console:human-B");
    actor_b.load();
    let b_claim = actor_b.acquire_region_claim(10, 20, "parse_header", 100);
    pane.ingest_claim(&b_claim);
    assert_eq!(pane.claim_ledger().len(), 1, "B's claim landed off the coord lane");

    // (2) Edit-sync lane — a DIFFERENT remote actor C's live caret, emitted as the real
    // wire presence frame and folded through the producer's edit hook (presence rides
    // the multiplexed edit lane). Built from a real pane so it is the genuine frame.
    let mut actor_c = EditorPane::new_with_identity(&path, None, "port-daddy:editor:agent-C");
    actor_c.load();
    actor_c.set_local_presence(PresenceState::caret(5, 0, 1, 25));
    let c_cursor = actor_c
        .take_presence_broadcast(100_000)
        .expect("C's caret move is due → a real presence frame");
    pane.ingest_presence(&c_cursor);
    assert_eq!(pane.remote_cursors().len(), 1, "C's cursor pooled off the edit lane");

    // (3) The local operator selects L12–18 — inside B's claim: an explicit intent that
    // gates both the caret and the commit span.
    pane.set_local_presence(PresenceState {
        cursor_line: 12,
        cursor_col: 0,
        anchor_line: 18,
        anchor_col: 1,
        top_line: 1,
        bottom_line: 25,
    });

    // (4) The wedge — the local replica acquires the SAME symbol; the probe fires on that
    // acquire edge and the daemon predicts a BLOCKING conflict → the band is raised.
    pane.acquire_region_claim(10, 20, "parse_header", 200);
    let _ = pane
        .take_wedge_probe(300)
        .expect("the acquire armed a due wedge probe");
    let blocking = serde_json::json!({
        "success": true, "count": 1, "blocking": 1, "warnings": 0, "info": 0,
        "conflicts": [{ "severity": "blocking" }],
    });
    assert!(
        pane.apply_conflict_report(&blocking, 400),
        "the blocking prediction raised the band"
    );

    // ── Paint the SAME Blocks the gpui window paints, through the repl painter ──
    // Force Truecolor so the band tones render regardless of stdout tty detection.
    let style = TermStyle::with_mode(ColorMode::Truecolor, &theme::DARK);
    let blocks = pane.view();

    // A short honest banner, then the real rendered surface.
    println!(
        "\x1b[1m pd-console — Harbor Editor (repl face) · PR #729 wedge · {}\x1b[0m",
        "port-daddy:editor:agent-local"
    );
    println!(
        "\x1b[90m one pane, two faces — the gpui window paints these same Blocks\x1b[0m\n"
    );
    print!("{}", term::render_blocks_width(&blocks, &style, Some(124)));

    // A compact machine-checkable proof line under the render (stderr, so it never
    // pollutes the captured surface): which wedge Blocks were emitted.
    let n_conflicted = blocks
        .iter()
        .filter(|b| matches!(b, pane::Block::WrappedText { tone: pane::Tone::Conflicted, .. }))
        .count();
    let n_gated_chip = blocks
        .iter()
        .filter(|b| matches!(b, pane::Block::Chip { tone: pane::Tone::Gated, .. }))
        .count();
    let n_flags = blocks
        .iter()
        .filter(|b| matches!(b, pane::Block::Flag { .. }))
        .count();
    eprintln!(
        "wedge-proof: Conflicted bands={n_conflicted} Gated chips={n_gated_chip} awareness flags={n_flags} total blocks={}",
        blocks.len()
    );
}
