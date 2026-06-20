//! Editor pane (read-only) — shows a file's contents with a line-number gutter.
//!
//! The first Harbor Editor slice (P0): a Surface that reads a file from DISK
//! rather than the daemon. It impls the same `Pane` contract as every other
//! pane, so both renderers (ratatui `term::render_blocks` + GPUI
//! `app::render_block`) paint it for free — one pane, two faces.
//!
//! Read-only by construction: `refresh()` re-reads the file, `view()` emits one
//! `Block::Row([gutter, content])` per line. No mutate / no subscription — it
//! inherits the trait's no-op defaults. The editable step is a later slice.
//!
//! gpui-FREE on purpose: imports only the render-agnostic `Block`/`Pane`
//! contract, the shared `DaemonClient` (required by the trait signature but
//! unused here), `anyhow`, and `std`.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;
use std::path::{Path, PathBuf};

/// Max lines rendered as rows — keeps `view()` bounded for huge files (the
/// renderer paints every row). Lines beyond this are summarized in a footer.
const MAX_LINES: usize = 2_000;
/// Max display width of a single line's content before it is truncated with an
/// ellipsis. The gutter is rendered separately, so this bounds content only.
const MAX_LINE_WIDTH: usize = 200;

pub struct EditorPane {
    /// The file this pane is bound to.
    path: PathBuf,
    /// File contents, split into lines (capped at `MAX_LINES`).
    lines: Vec<String>,
    /// Whether the on-disk file had more than `MAX_LINES` lines.
    truncated: bool,
    /// Last read error (missing file, permission, non-UTF8), shown in `view()`.
    last_error: Option<String>,
    /// Optional 1-based inclusive line range to focus. When set, `view()` shows
    /// only those lines (gutter keeps real numbers) so a `foo.rs:10-20` label is
    /// HONEST — it never promises a range the view then ignores.
    region: Option<(usize, usize)>,
}

impl EditorPane {
    /// Bind the pane to a path. The file is not read until `refresh()` runs.
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into(), lines: Vec::new(), truncated: false, last_error: None, region: None }
    }

    /// The path currently being viewed.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Point the pane at a different file. Clears stale content; the next
    /// `refresh()` loads the new file.
    pub fn open(&mut self, path: impl Into<PathBuf>) {
        self.path = path.into();
        self.lines.clear();
        self.truncated = false;
        self.last_error = None;
    }

    /// Read the bound file from disk synchronously, capping at `MAX_LINES`. This
    /// is the same logic `refresh()` runs; pulled out so the GPUI face can load
    /// an editor surface lazily from `&self` without a boxed future / runtime.
    fn load(&mut self) {
        match std::fs::read_to_string(&self.path) {
            Ok(text) => {
                self.last_error = None;
                // Single pass: after taking MAX_LINES, the iterator's next item
                // (if any) is line MAX_LINES — no second scan of the file.
                let mut it = text.lines();
                self.lines = it.by_ref().take(MAX_LINES).map(|l| l.to_string()).collect();
                self.truncated = it.next().is_some();
            }
            Err(e) => {
                self.last_error = Some(format!("{e}"));
                self.lines.clear();
                self.truncated = false;
            }
        }
    }

    /// Construct + load in one call — the convenience the GPUI `blocks_for_surface`
    /// path uses to render an Editor surface synchronously on each frame.
    pub fn loaded(path: impl Into<PathBuf>, region: Option<(usize, usize)>) -> Self {
        let mut p = Self::new(path);
        p.region = region;
        p.load();
        p
    }

    /// Truncate `content` to `MAX_LINE_WIDTH` *characters* (not bytes — never
    /// split a UTF-8 codepoint), appending an ellipsis when cut. Also strips a
    /// trailing `\r` so CRLF files don't render a stray carriage return.
    fn clip(content: &str) -> String {
        // Strip a trailing CR (CRLF files), then reuse the shared char-safe
        // truncator rather than re-implementing ellipsis logic.
        crate::util::trunc(content.strip_suffix('\r').unwrap_or(content), MAX_LINE_WIDTH)
    }

    /// Right-align a 1-based line number into a fixed-width gutter sized to the
    /// largest line number currently held (min width 3 for visual stability).
    fn gutter(&self, lineno: usize) -> String {
        let width = self.lines.len().max(1).to_string().len().max(3);
        format!("{lineno:>width$}")
    }
}

impl Pane for EditorPane {
    fn id(&self) -> &str {
        "editor"
    }

    fn title(&self) -> String {
        // Show the file name in the rail title; fall back to the full path.
        match self.path.file_name().and_then(|n| n.to_str()) {
            Some(name) => format!("Editor — {name}"),
            None => "Editor".into(),
        }
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header(format!("Editor — {}", self.path.display()))];

        if let Some(err) = &self.last_error {
            blocks.push(Block::Chip { label: "unreadable".into(), tone: Tone::Gated });
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        if self.lines.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "empty file or not loaded yet".into()));
            return blocks;
        }

        // Honor a focus region so the `foo.rs:10-20` label is not a lie.
        let (start, end) = match self.region {
            Some((a, b)) => (
                a.saturating_sub(1).min(self.lines.len()),
                b.min(self.lines.len()),
            ),
            None => (0, self.lines.len()),
        };
        if let Some((a, b)) = self.region {
            blocks.push(Block::KeyVal(
                "range".into(),
                format!("lines {a}–{b} of {}", self.lines.len()),
            ));
        }
        blocks.push(Block::Gap);
        for (offset, line) in self.lines[start..end].iter().enumerate() {
            // gutter column + content column → two-column Row the renderer aligns.
            let lineno = start + offset + 1;
            blocks.push(Block::Row(vec![self.gutter(lineno), Self::clip(line)]));
        }

        if self.truncated {
            blocks.push(Block::Gap);
            blocks.push(Block::Chip {
                label: format!("truncated — showing first {MAX_LINES} lines"),
                tone: Tone::Resting,
            });
        }

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        _daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        // Reads from DISK, not the daemon — the &DaemonClient arg is unused. A
        // sync read is fine at the registry's 2s cadence; wrapping it in the
        // boxed future keeps the object-safe trait signature.
        Box::pin(async move {
            self.load();
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_and_title_reflect_path() {
        let p = EditorPane::new("/etc/hosts");
        assert_eq!(p.id(), "editor");
        assert_eq!(p.title(), "Editor — hosts");
    }

    #[test]
    fn empty_before_load() {
        let p = EditorPane::new("/nonexistent/file");
        let blocks = p.view();
        assert!(matches!(&blocks[0], Block::Header(_)));
        // No rows until refresh runs.
        assert!(!blocks.iter().any(|b| matches!(b, Block::Row(_))));
    }

    #[test]
    fn renders_rows_with_gutter() {
        let mut p = EditorPane::new("/dev/null");
        p.lines = vec!["first".into(), "second".into(), "third".into()];
        let rows: Vec<_> = p
            .view()
            .into_iter()
            .filter_map(|b| if let Block::Row(cols) = b { Some(cols) } else { None })
            .collect();
        assert_eq!(rows.len(), 3);
        // Gutter is right-aligned, min width 3.
        assert_eq!(rows[0][0], "  1");
        assert_eq!(rows[0][1], "first");
        assert_eq!(rows[2][0], "  3");
    }

    #[test]
    fn clip_truncates_long_lines_on_char_boundary() {
        let long = "x".repeat(MAX_LINE_WIDTH + 50);
        let clipped = EditorPane::clip(&long);
        assert_eq!(clipped.chars().count(), MAX_LINE_WIDTH + 1); // + ellipsis
        assert!(clipped.ends_with('…'));
        // Short lines pass through; CRLF carriage return stripped.
        assert_eq!(EditorPane::clip("ok\r"), "ok");
    }

    #[test]
    fn error_state_shows_gated_chip() {
        let mut p = EditorPane::new("/missing");
        p.last_error = Some("No such file".into());
        let blocks = p.view();
        assert!(blocks.iter().any(|b| matches!(b, Block::Chip { tone: Tone::Gated, .. })));
        assert!(!blocks.iter().any(|b| matches!(b, Block::Row(_))));
    }

    #[test]
    fn open_swaps_path_and_clears() {
        let mut p = EditorPane::new("/a");
        p.lines = vec!["stale".into()];
        p.open("/b");
        assert_eq!(p.path(), Path::new("/b"));
        assert!(p.lines.is_empty());
    }

    #[test]
    fn loaded_reads_a_real_file() {
        // Read a file we know exists and is UTF-8: this very source file. The
        // test binary's cwd is the crate root (core/pd-console), so a relative
        // path resolves.
        let p = EditorPane::loaded("src/editor.rs", None);
        // The module doc-comment's first line is the marker below.
        assert!(p.last_error.is_none(), "expected a clean read, got {:?}", p.last_error);
        let rows = p
            .view()
            .into_iter()
            .filter_map(|b| if let Block::Row(cols) = b { Some(cols) } else { None })
            .count();
        assert!(rows > 10, "editor.rs has many lines; got {rows} rows");
    }

    #[test]
    fn missing_file_via_load_is_gated() {
        let p = EditorPane::loaded("/nonexistent/path/to/nowhere.rs", None);
        assert!(p.last_error.is_some());
        assert!(p
            .view()
            .iter()
            .any(|b| matches!(b, Block::Chip { tone: Tone::Gated, .. })));
    }

    #[test]
    fn region_slices_to_range_and_keeps_real_line_numbers() {
        let mut p = EditorPane::new("/x");
        p.lines = (1..=30).map(|i| format!("line{i}")).collect();
        p.region = Some((10, 12));
        let rows: Vec<_> = p
            .view()
            .into_iter()
            .filter_map(|b| if let Block::Row(c) = b { Some(c) } else { None })
            .collect();
        assert_eq!(rows.len(), 3, "region 10..=12 must render exactly 3 lines");
        assert_eq!(rows[0][0].trim(), "10", "gutter keeps the real line number");
        assert_eq!(rows[0][1], "line10");
        assert_eq!(rows[2][1], "line12");
        // The honest range header is present so the label isn't a lie.
        assert!(p.view().iter().any(|b| matches!(b, Block::KeyVal(k, _) if k == "range")));
    }
}
