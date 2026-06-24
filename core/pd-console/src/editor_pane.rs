//! Editor pane — the Harbor Editor's P0 walking skeleton.
//!
//! A **read-only** file viewer that slots into the existing `Workspace`/`Pane`
//! machinery (`pane.rs`). It is *not* a collaborative editor: P0 has no buffer,
//! no CRDT (Loro), no networking, and no claims. It reads one file from local
//! disk and renders its lines with a line-number gutter — the column where P1's
//! per-PeerID authorship color and P3's claim bands will later land.
//!
//! One pane, two faces: it emits render-agnostic `Block`s; the GPUI shell
//! (`app.rs`) paints rich text and the terminal renderer (`term.rs`) paints the
//! same lines read-only.
//!
//! The `region` seam (an optional 1-based inclusive line span) is the slot the
//! battle-plan's "open at a span" / P3 claim bands paint into; in P0 those lines
//! are simply marked so the seam is visible and exercised by tests.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;

/// Cap on how many lines a single file contributes to the view. The battle-plan's
/// large-file virtualization is a P1 concern; P0 just must never let a huge file
/// wedge the refresh tick — so we read the first `MAX_LINES` and append a
/// truncation marker.
const MAX_LINES: usize = 2000;

/// The outcome of loading a file: either its (possibly truncated) lines, plus a
/// flag for whether truncation occurred, or a human-readable error.
struct Loaded {
    lines: Vec<String>,
    truncated: bool,
}

/// Read a file from local disk into capped lines. Pure + synchronous so both the
/// async `refresh()` (via `spawn_blocking`) and the synchronous GPUI render path
/// can share one code path. Never panics — every failure becomes an `Err(String)`.
fn load_lines(path: &str) -> std::result::Result<Loaded, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| format!("{e}"))?;
    let mut lines: Vec<String> = raw.lines().map(|l| l.to_string()).collect();
    let truncated = lines.len() > MAX_LINES;
    if truncated {
        lines.truncate(MAX_LINES);
    }
    Ok(Loaded { lines, truncated })
}

/// Width of the gutter column for a file with `n` lines (digits in the largest
/// line number, minimum 2 so single-line files still read as a gutter).
fn gutter_width(n: usize) -> usize {
    let digits = if n == 0 { 1 } else { (n as f64).log10().floor() as usize + 1 };
    digits.max(2)
}

/// The read-only editor surface. State mirrors what P1 will grow into: `path` /
/// `region` are the bound entity + seam; `lines` is the rendered content;
/// `truncated` records the large-file cap; `error` holds any load failure.
pub struct EditorPane {
    path: String,
    region: Option<(u32, u32)>,
    lines: Vec<String>,
    truncated: bool,
    error: Option<String>,
}

impl EditorPane {
    /// Construct a pane bound to `path` with an optional `region`. No disk I/O
    /// here — call `load()` (sync) or `refresh()` (async) to populate `lines`.
    pub fn new(path: impl Into<String>, region: Option<(u32, u32)>) -> Self {
        Self {
            path: path.into(),
            region,
            lines: Vec::new(),
            truncated: false,
            error: None,
        }
    }

    /// Synchronously load the bound file into `lines`, recording any error. Used
    /// by the GPUI render path (which is `&self`-sync) and by `refresh()`'s
    /// blocking body. Idempotent: clears prior state before loading.
    pub fn load(&mut self) {
        self.lines.clear();
        self.truncated = false;
        match load_lines(&self.path) {
            Ok(Loaded { lines, truncated }) => {
                self.lines = lines;
                self.truncated = truncated;
                self.error = None;
            }
            Err(e) => {
                self.error = Some(e);
            }
        }
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
            // One error block — the unreadable-path face.
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        let width = gutter_width(self.lines.len());
        for (i, line) in self.lines.iter().enumerate() {
            let n = (i + 1) as u32; // 1-based line numbers.
            let gutter = format!("{n:>width$}", width = width);
            if self.in_region(n) {
                // Region lines are marked with a tone-bearing chip-like marker in
                // the gutter cell so "open at region" is visible across both faces.
                // (Monochrome line bodies now; per-author/claim color is P1/P3.)
                blocks.push(Block::Row(vec![format!("▍{gutter}"), line.clone()]));
            } else {
                blocks.push(Block::Row(vec![format!(" {gutter}"), line.clone()]));
            }
        }

        if self.truncated {
            blocks.push(Block::Gap);
            blocks.push(Block::Chip {
                label: format!("… truncated at {MAX_LINES} lines (large-file view is P1)"),
                tone: Tone::Resting,
            });
        }

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        _daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        // P0 reads from local disk (no daemon/blob fetch — that's P1+). Do the
        // blocking std::fs read off the async runtime so a slow/huge file can't
        // stall the reactor, then fold the result back into `self`.
        Box::pin(async move {
            let path = self.path.clone();
            let loaded = tokio::task::spawn_blocking(move || load_lines(&path))
                .await
                .map_err(|e| anyhow::anyhow!("editor load task panicked: {e}"))?;
            match loaded {
                Ok(Loaded { lines, truncated }) => {
                    self.lines = lines;
                    self.truncated = truncated;
                    self.error = None;
                }
                Err(e) => {
                    self.error = Some(e);
                    self.lines.clear();
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
    use std::io::Write;
    use std::path::PathBuf;

    /// Scratch dir under ~/coding/tmp (NEVER /tmp — the OS sweeps it). Falls back
    /// to the crate's target dir if HOME is somehow unset.
    fn scratch_dir() -> PathBuf {
        let base = std::env::var("HOME")
            .map(|h| PathBuf::from(h).join("coding/tmp/pd-harbor-editor-tests"))
            .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/editor-tests"));
        std::fs::create_dir_all(&base).expect("create scratch dir");
        base
    }

    /// Write a temp file with `contents` and return its path string.
    fn write_temp(name: &str, contents: &str) -> String {
        let path = scratch_dir().join(name);
        let mut f = std::fs::File::create(&path).expect("create temp file");
        f.write_all(contents.as_bytes()).expect("write temp file");
        path.to_string_lossy().into_owned()
    }

    /// Make a loaded pane for a known file (mirrors the `make_pane` test idiom).
    fn make_pane(path: &str, region: Option<(u32, u32)>) -> EditorPane {
        let mut p = EditorPane::new(path, region);
        p.load();
        p
    }

    fn row_count(blocks: &[Block]) -> usize {
        blocks.iter().filter(|b| matches!(b, Block::Row(_))).count()
    }

    #[test]
    fn view_yields_one_row_per_line_with_gutter_numbers() {
        let path = write_temp("known.txt", "alpha\nbravo\ncharlie\n");
        let pane = make_pane(&path, None);
        let blocks = pane.view();

        // Header + three line rows, no error.
        assert!(matches!(&blocks[0], Block::Header(h) if h == "edit known.txt"));
        assert_eq!(row_count(&blocks), 3, "three content lines → three rows");

        // Gutter holds the 1-based line numbers, content holds the line text.
        let rows: Vec<&Vec<String>> = blocks
            .iter()
            .filter_map(|b| if let Block::Row(c) = b { Some(c) } else { None })
            .collect();
        assert_eq!(rows[0][0].trim(), "1");
        assert_eq!(rows[0][1], "alpha");
        assert_eq!(rows[1][0].trim(), "2");
        assert_eq!(rows[2][0].trim(), "3");
        assert_eq!(rows[2][1], "charlie");
    }

    #[test]
    fn unreadable_path_yields_one_error_block() {
        let pane = make_pane("/nonexistent/path/does/not/exist.rs", None);
        let blocks = pane.view();

        // Header + exactly one error KeyVal, zero content rows.
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
        // 1-based inclusive region covering lines 2..=4.
        let pane = make_pane(&path, Some((2, 4)));
        let blocks = pane.view();

        let rows: Vec<&Vec<String>> = blocks
            .iter()
            .filter_map(|b| if let Block::Row(c) = b { Some(c) } else { None })
            .collect();
        assert_eq!(rows.len(), 5);

        // The marker prefix "▍" appears only on lines 2, 3, 4 (indices 1,2,3).
        let marked: Vec<bool> = rows.iter().map(|c| c[0].starts_with('▍')).collect();
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
}
