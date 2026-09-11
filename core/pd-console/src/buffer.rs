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
//! therefore always maps to the same replica across reconnects. This mapping is a
//! necessary authorship primitive, not P3.5 recovery authority: it does not let a
//! successor assume a dead actor's verified identity. We mask off `u64::MAX`
//! because Loro reserves it.

use loro::{
    cursor::Side, ExpandType, ExportMode, LoroDoc, LoroText, StyleConfig, StyleConfigMap,
    UndoItemMeta, UndoManager,
};
use std::{cell::RefCell, collections::VecDeque, ops::Range};

/// Loro container name for the file's text. One file = one `LoroDoc` holding one
/// `LoroText` under this key (battle-plan §3).
const TEXT_CONTAINER: &str = "content";

/// The richtext mark key under which we record the authoring replica's PeerID.
/// Loro marks merge with the text and carry per-span attributes, so this is how
/// authorship rides along inside the CRDT itself rather than in a side table that
/// could drift out of sync on merge.
const AUTHOR_MARK: &str = "author";

/// Maximum number of exact incremental receipts retained between consumer
/// drains. Once this boundary is crossed the batch becomes incomplete and the
/// consumer must full-parse the current text instead of applying a truncated
/// incremental sequence.
pub const EDIT_RECEIPT_CAPACITY: usize = 256;

/// Keep the governance ledger exactly as deep as Loro's configured history.
/// This stores only stable claim anchors and replacement shape, never inverse
/// operations; Loro remains the sole undo/redo implementation.
const HISTORY_CAPACITY: usize = 100;

/// A Loro replica id. `u64` per `loro_common::PeerID`; re-aliased here so the
/// public surface does not force callers to depend on the loro crate directly.
pub type PeerId = u64;

/// One UTF-8 point in the buffer, shaped exactly like tree-sitter's position
/// vocabulary: an absolute byte offset plus a zero-based row and byte column.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EditPoint {
    pub byte: usize,
    pub row: usize,
    pub column: usize,
}

/// One text replacement receipt. The three points map directly onto a
/// tree-sitter `InputEdit`; the deleted/inserted text keeps the receipt useful
/// to syntax, blame, and audit consumers without re-reading the old document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditReceipt {
    pub start: EditPoint,
    pub old_end: EditPoint,
    pub new_end: EditPoint,
    pub deleted_text: String,
    pub inserted_text: String,
}

/// One drain of the authoritative mutation receipt stream.
///
/// `complete = true` means `receipts` is the exact ordered sequence since the
/// previous drain (including an exact empty sequence). `complete = false`
/// represents an overflow discontinuity; `receipts` is intentionally empty and
/// consumers must full-parse the current text before accepting later batches.
#[derive(Debug, Clone, PartialEq, Eq)]
#[must_use = "an incomplete receipt batch requires a full parse"]
pub struct ReceiptBatch {
    pub receipts: Vec<EditReceipt>,
    pub complete: bool,
}

impl Default for ReceiptBatch {
    fn default() -> Self {
        Self {
            receipts: Vec::new(),
            complete: true,
        }
    }
}

/// One locally-authored CRDT change ready for the ordinary editor-sync lane.
/// `receipt` is absent only when the operation changed style/history but left
/// the visible text identical.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthoredEdit {
    pub delta: Vec<u8>,
    pub receipt: Option<EditReceipt>,
}

/// The exact visible span and line impact that must clear claim governance
/// before the next undo or redo item is allowed to mutate the document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryGuard {
    pub range: Range<usize>,
    pub replacement_newlines: usize,
}

/// Which peer-local Loro history operation to perform through the governed
/// atomic entry point.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistoryAction {
    Undo,
    Redo,
}

impl HistoryAction {
    fn is_redo(self) -> bool {
        matches!(self, Self::Redo)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct HistoryGovernanceMetadata {
    deleted_newlines: usize,
    inserted_newlines: usize,
}

impl HistoryGovernanceMetadata {
    fn new(deleted: &str, inserted: &str) -> Self {
        Self {
            deleted_newlines: deleted.bytes().filter(|byte| *byte == b'\n').count(),
            inserted_newlines: inserted.bytes().filter(|byte| *byte == b'\n').count(),
        }
    }

    fn replacement_newlines(&self, redo: bool) -> usize {
        if redo {
            self.inserted_newlines
        } else {
            self.deleted_newlines
        }
    }
}

#[derive(Clone)]
struct HistoryGovernanceItem {
    anchors: UndoItemMeta,
    metadata: HistoryGovernanceMetadata,
    anchors_complete: bool,
}

#[derive(Clone)]
struct PreparedHistoryItem {
    guard: HistoryGuard,
}

struct HistoryGovernanceStacks {
    undo: VecDeque<HistoryGovernanceItem>,
    redo: VecDeque<HistoryGovernanceItem>,
    synchronized: bool,
}

impl Default for HistoryGovernanceStacks {
    fn default() -> Self {
        Self {
            undo: VecDeque::new(),
            redo: VecDeque::new(),
            synchronized: true,
        }
    }
}

impl HistoryGovernanceStacks {
    fn source(&self, action: HistoryAction) -> &VecDeque<HistoryGovernanceItem> {
        match action {
            HistoryAction::Undo => &self.undo,
            HistoryAction::Redo => &self.redo,
        }
    }

    fn record_authored(&mut self, item: HistoryGovernanceItem) {
        self.redo.clear();
        if self.undo.len() == HISTORY_CAPACITY {
            self.undo.pop_front();
        }
        self.undo.push_back(item);
    }

    fn reconcile_after_history(
        &mut self,
        action: HistoryAction,
        popped_source: usize,
        fresh_opposite: Option<HistoryGovernanceItem>,
        undo_count: usize,
        redo_count: usize,
    ) {
        let source = match action {
            HistoryAction::Undo => &mut self.undo,
            HistoryAction::Redo => &mut self.redo,
        };
        for _ in 0..popped_source {
            if source.pop_back().is_none() {
                self.synchronized = false;
                break;
            }
        }
        if let Some(item) = fresh_opposite {
            let opposite = match action {
                HistoryAction::Undo => &mut self.redo,
                HistoryAction::Redo => &mut self.undo,
            };
            opposite.push_back(item);
        }
        if self.undo.len() != undo_count || self.redo.len() != redo_count {
            self.synchronized = false;
        }
    }
}

struct PendingReceipts {
    receipts: VecDeque<EditReceipt>,
    complete: bool,
}

impl Default for PendingReceipts {
    fn default() -> Self {
        Self {
            receipts: VecDeque::new(),
            complete: true,
        }
    }
}

impl PendingReceipts {
    fn push(&mut self, receipt: EditReceipt) {
        if !self.complete {
            return;
        }
        if self.receipts.len() == EDIT_RECEIPT_CAPACITY {
            self.receipts.clear();
            self.complete = false;
            return;
        }
        self.receipts.push_back(receipt);
    }

    fn take(&mut self) -> ReceiptBatch {
        let batch = ReceiptBatch {
            receipts: self.receipts.drain(..).collect(),
            complete: self.complete,
        };
        self.complete = true;
        batch
    }

    #[cfg(test)]
    fn snapshot(&self) -> ReceiptBatch {
        ReceiptBatch {
            receipts: self.receipts.iter().cloned().collect(),
            complete: self.complete,
        }
    }
}

impl EditPoint {
    fn at(text: &str, byte: usize) -> Self {
        debug_assert!(byte <= text.len() && text.is_char_boundary(byte));
        let prefix = &text[..byte];
        let row = prefix.bytes().filter(|b| *b == b'\n').count();
        let column = prefix
            .rfind('\n')
            .map_or(byte, |newline| byte - newline - 1);
        Self { byte, row, column }
    }
}

impl EditReceipt {
    fn replacement(before: &str, range: Range<usize>, replacement: &str) -> Option<Self> {
        let mut after = String::with_capacity(before.len() - range.len() + replacement.len());
        after.push_str(&before[..range.start]);
        after.push_str(replacement);
        after.push_str(&before[range.end..]);
        if after == before {
            return None;
        }

        Some(Self {
            start: EditPoint::at(before, range.start),
            old_end: EditPoint::at(before, range.end),
            new_end: EditPoint::at(&after, range.start + replacement.len()),
            deleted_text: before[range].to_string(),
            inserted_text: replacement.to_string(),
        })
    }

    /// Derive one exact broad replacement by trimming the common UTF-8 prefix
    /// and suffix. This is the initial receipt path for undo/redo and imports;
    /// direct replacements use [`Self::replacement`] and remain fully precise.
    fn between(before: &str, after: &str) -> Option<Self> {
        if before == after {
            return None;
        }

        let mut start = 0;
        for ((before_ix, before_ch), (_, after_ch)) in
            before.char_indices().zip(after.char_indices())
        {
            if before_ch != after_ch {
                break;
            }
            start = before_ix + before_ch.len_utf8();
        }

        let before_tail = &before[start..];
        let after_tail = &after[start..];
        let mut suffix_bytes = 0;
        for (before_ch, after_ch) in before_tail.chars().rev().zip(after_tail.chars().rev()) {
            if before_ch != after_ch {
                break;
            }
            suffix_bytes += before_ch.len_utf8();
        }

        let old_end_byte = before.len() - suffix_bytes;
        let new_end_byte = after.len() - suffix_bytes;
        Some(Self {
            start: EditPoint::at(before, start),
            old_end: EditPoint::at(before, old_end_byte),
            new_end: EditPoint::at(after, new_end_byte),
            deleted_text: before[start..old_end_byte].to_string(),
            inserted_text: after[start..new_end_byte].to_string(),
        })
    }
}

fn byte_offset_for_unicode(text: &str, unicode: usize) -> usize {
    if unicode == text.chars().count() {
        return text.len();
    }
    text.char_indices()
        .nth(unicode)
        .map(|(byte, _)| byte)
        .expect("Unicode offset must fit text")
}

/// Mint a stable Loro `PeerId` from a PD identity string.
///
/// FNV-1a over the identity's bytes — deterministic, dependency-free, and stable
/// across process restarts so a reconnecting actor lands on the *same* replica id.
/// P3.5 recovery must separately prove the abandoned actor and complete typed
/// operation ledger through canonical Rust; callers may not self-assert a dead
/// actor's identity. We clear the top bit's all-ones edge by masking `u64::MAX`,
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
    undo: RefCell<UndoManager>,
    /// Bounded claim-governance metadata aligned with Loro's own bounded
    /// history. Each successful transfer is re-anchored from the resulting
    /// document; no inverse operation or text snapshot is stored here.
    history_governance: RefCell<HistoryGovernanceStacks>,
    /// One ordered receipt stream for every text-changing mutation, including
    /// callers that ignore an `AuthoredEdit` or use a pre-P1A unit return path.
    /// P1B drains this instead of ever reconstructing snapshot diffs.
    pending_receipts: RefCell<PendingReceipts>,
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
        let mut undo = UndoManager::new(&doc);
        // One accepted replacement is one history item, independent of typing
        // cadence. Keep this explicit even though zero is Loro's current default.
        undo.set_merge_interval(0);
        undo.set_max_undo_steps(HISTORY_CAPACITY);
        Self {
            doc,
            text,
            undo: RefCell::new(undo),
            history_governance: RefCell::new(HistoryGovernanceStacks::default()),
            pending_receipts: RefCell::new(PendingReceipts::default()),
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
        // Initial disk seeding establishes the baseline; it is never a user edit.
        buf.undo.borrow().clear();
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
    pub fn insert_authored(&self, pos: usize, s: &str) -> AuthoredEdit {
        self.replace_authored(pos..pos, s)
    }

    /// Replace a Unicode-scalar range with locally-authored text and return only
    /// the newly-created Loro update bytes. The returned delta is the exact op
    /// the live editor broadcasts; it does not resend the file's full history on
    /// every keystroke.
    pub fn replace_authored(&self, range: Range<usize>, s: &str) -> AuthoredEdit {
        let len = self.text.len_unicode();
        assert!(
            range.start <= range.end && range.end <= len,
            "authored replacement range {range:?} must fit Unicode length {len}"
        );
        if range.is_empty() && s.is_empty() {
            return AuthoredEdit {
                delta: Vec::new(),
                receipt: None,
            };
        }

        let before_text = self.text.to_string();
        let byte_range = byte_offset_for_unicode(&before_text, range.start)
            ..byte_offset_for_unicode(&before_text, range.end);
        let receipt = EditReceipt::replacement(&before_text, byte_range.clone(), s);

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

        // Attach governance to what is visible AFTER this replacement. A
        // deletion has no visible span, so one right-biased cursor anchors the
        // insertion point and the metadata retains the planned restoration.
        let governance = HistoryGovernanceMetadata::new(&before_text[byte_range], s);
        let inserted_end = range.start + s.chars().count();
        let item = self.governance_item(governance, range.start..inserted_end);
        let before_undo_count = self.undo.borrow().undo_count();
        self.doc.commit();
        debug_assert_eq!(
            self.undo.borrow().undo_count(),
            (before_undo_count + 1).min(HISTORY_CAPACITY),
            "one accepted replacement must create one Loro undo item"
        );
        self.history_governance.borrow_mut().record_authored(item);

        let delta = self
            .doc
            .export(ExportMode::updates(&before))
            .expect("export authored replacement delta");
        if let Some(receipt) = &receipt {
            self.pending_receipts.borrow_mut().push(receipt.clone());
        }
        AuthoredEdit { delta, receipt }
    }

    fn governance_item(
        &self,
        metadata: HistoryGovernanceMetadata,
        unicode_range: Range<usize>,
    ) -> HistoryGovernanceItem {
        let mut anchors = UndoItemMeta::new();
        let anchors_complete =
            Self::add_governance_cursors(&self.text, &mut anchors, unicode_range);
        HistoryGovernanceItem {
            anchors,
            metadata,
            anchors_complete,
        }
    }

    fn add_governance_cursors(
        text: &LoroText,
        meta: &mut UndoItemMeta,
        unicode_range: Range<usize>,
    ) -> bool {
        meta.cursors.clear();
        let start_side = if unicode_range.is_empty() {
            Side::Right
        } else {
            Side::Left
        };
        let Some(start) = text.get_cursor(unicode_range.start, start_side) else {
            return false;
        };
        meta.add_cursor(&start);
        if !unicode_range.is_empty() {
            let Some(end) = text.get_cursor(unicode_range.end, Side::Right) else {
                meta.cursors.clear();
                return false;
            };
            meta.add_cursor(&end);
        }
        true
    }

    /// Current UTF-8 target range of the next local undo item. Stable Loro
    /// cursors are resolved against the current merged document, so intervening
    /// peer edits shift this range before claim governance inspects it.
    pub fn undo_range(&self) -> std::result::Result<Option<Range<usize>>, String> {
        self.undo_guard()
            .map(|guard| guard.map(|guard| guard.range))
    }

    /// Current UTF-8 target range of the next local redo item.
    pub fn redo_range(&self) -> std::result::Result<Option<Range<usize>>, String> {
        self.redo_guard()
            .map(|guard| guard.map(|guard| guard.range))
    }

    pub fn undo_guard(&self) -> std::result::Result<Option<HistoryGuard>, String> {
        self.history_guard(HistoryAction::Undo)
    }

    pub fn redo_guard(&self) -> std::result::Result<Option<HistoryGuard>, String> {
        self.history_guard(HistoryAction::Redo)
    }

    fn history_guard(
        &self,
        action: HistoryAction,
    ) -> std::result::Result<Option<HistoryGuard>, String> {
        let text = self.text.to_string();
        Ok(self
            .prepare_history(action, &text)?
            .into_iter()
            .next()
            .map(|item| item.guard))
    }

    fn prepare_history(
        &self,
        action: HistoryAction,
        text: &str,
    ) -> std::result::Result<Vec<PreparedHistoryItem>, String> {
        let undo = self.undo.borrow();
        let governance = self.history_governance.borrow();
        if !governance.synchronized
            || governance.undo.len() != undo.undo_count()
            || governance.redo.len() != undo.redo_count()
        {
            return Err("editor history governance is out of sync with Loro history".into());
        }
        let source = governance.source(action);
        if source.is_empty() {
            return Ok(Vec::new());
        }
        let mut prepared = Vec::with_capacity(source.len());
        for item in source.iter().rev() {
            let unicode_range = self.resolve_governance_range(item, text).ok_or_else(|| {
                "editor history metadata has no valid governed text span".to_string()
            })?;
            prepared.push(PreparedHistoryItem {
                guard: HistoryGuard {
                    range: byte_offset_for_unicode(text, unicode_range.start)
                        ..byte_offset_for_unicode(text, unicode_range.end),
                    replacement_newlines: item.metadata.replacement_newlines(action.is_redo()),
                },
            });
        }
        Ok(prepared)
    }

    fn resolve_governance_range(
        &self,
        item: &HistoryGovernanceItem,
        text: &str,
    ) -> Option<Range<usize>> {
        if !item.anchors_complete
            || item.anchors.cursors.is_empty()
            || item.anchors.cursors.len() > 2
        {
            return None;
        }
        let mut unicode = Vec::with_capacity(item.anchors.cursors.len());
        for cursor in &item.anchors.cursors {
            let position = self.doc.get_cursor_pos(&cursor.cursor).ok()?.current.pos;
            unicode.push(position);
        }
        unicode.sort_unstable();
        let unicode_len = text.chars().count();
        if unicode.iter().any(|position| *position > unicode_len) {
            return None;
        }
        let start = *unicode.first()?;
        let end = *unicode.last()?;
        if start > end {
            return None;
        }
        Some(start..end)
    }

    /// Atomically validate and apply one peer-local Loro history item. The
    /// supplied claim validator always runs against the current stable range
    /// before Loro can mutate text, version vectors, stacks, or receipts.
    ///
    /// After success, the opposite governance-stack item is rebuilt by mapping
    /// the preflighted current span through the actual resulting document and
    /// unioning the exact receipt. This deliberately does not reuse Loro's saved
    /// selection, which is not transformed by intervening remote imports.
    pub fn apply_history_governed<F>(
        &self,
        action: HistoryAction,
        mut validate: F,
    ) -> std::result::Result<Option<AuthoredEdit>, String>
    where
        F: FnMut(&str, &HistoryGuard) -> std::result::Result<(), String>,
    {
        // HarborBuffer never checks out historical frontiers or enables
        // detached editing. Reject that impossible state before UndoManager's
        // `perform` can pop an item and discover it is not editable.
        if self.doc.is_detached() {
            return Err("editor history cannot mutate a detached Loro document".into());
        }
        if self.doc.is_shallow() {
            return Err("editor history cannot mutate a shallow Loro document".into());
        }

        let before_text = self.text.to_string();
        let prepared = self.prepare_history(action, &before_text)?;
        if prepared.is_empty() {
            return Ok(None);
        }
        // Loro may discard any number of fully-neutralized items before one
        // effective item is found. Its public API exposes no dry-run seam, so
        // every bounded source item must clear claims before any can be popped.
        for item in &prepared {
            validate(&before_text, &item.guard)?;
        }

        let (before_undo_count, before_redo_count) = {
            let undo = self.undo.borrow();
            (undo.undo_count(), undo.redo_count())
        };
        let captured_delta = std::sync::Arc::new(std::sync::Mutex::new(None));
        let captured_delta_for_callback = captured_delta.clone();
        let subscription = self.doc.subscribe_local_update(Box::new(move |bytes| {
            let mut captured = captured_delta_for_callback
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *captured = Some(bytes.clone());
            true
        }));
        let loro_result = if action.is_redo() {
            self.undo.borrow_mut().redo()
        } else {
            self.undo.borrow_mut().undo()
        };
        self.doc.commit();
        drop(subscription);

        let after_text = self.text.to_string();
        let delta = captured_delta
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
            .unwrap_or_default();
        let receipt = EditReceipt::between(&before_text, &after_text);
        let (after_undo_count, after_redo_count) = {
            let undo = self.undo.borrow();
            (undo.undo_count(), undo.redo_count())
        };
        let (before_source, after_source, before_opposite, after_opposite) = match action {
            HistoryAction::Undo => (
                before_undo_count,
                after_undo_count,
                before_redo_count,
                after_redo_count,
            ),
            HistoryAction::Redo => (
                before_redo_count,
                after_redo_count,
                before_undo_count,
                after_undo_count,
            ),
        };
        let popped_source = before_source.saturating_sub(after_source);
        let pushed_opposite = after_opposite.saturating_sub(before_opposite);
        let fresh_opposite = if pushed_opposite == 1 {
            let executed = popped_source
                .checked_sub(1)
                .and_then(|index| prepared.get(index));
            Some(self.fresh_history_item(
                action,
                executed,
                &before_text,
                &after_text,
                receipt.as_ref(),
            ))
        } else {
            None
        };
        let counts_are_possible = after_source <= before_source
            && after_opposite >= before_opposite
            && pushed_opposite <= 1
            && (pushed_opposite == 0 || popped_source > 0);
        {
            let mut stacks = self.history_governance.borrow_mut();
            stacks.reconcile_after_history(
                action,
                popped_source,
                fresh_opposite,
                after_undo_count,
                after_redo_count,
            );
            if !counts_are_possible || loro_result.is_err() {
                stacks.synchronized = false;
            }
        }
        if let Some(receipt) = &receipt {
            self.pending_receipts.borrow_mut().push(receipt.clone());
        }
        match loro_result {
            Ok(_) if pushed_opposite == 1 || !delta.is_empty() || receipt.is_some() => {
                Ok(Some(AuthoredEdit { delta, receipt }))
            }
            Ok(_) => Ok(None),
            Err(error) if delta.is_empty() && receipt.is_none() => Err(format!(
                "Loro history operation failed before producing an update: {error}"
            )),
            Err(_) => Ok(Some(AuthoredEdit { delta, receipt })),
        }
    }

    fn fresh_history_item(
        &self,
        action: HistoryAction,
        executed: Option<&PreparedHistoryItem>,
        before_text: &str,
        after_text: &str,
        receipt: Option<&EditReceipt>,
    ) -> HistoryGovernanceItem {
        // Preserve the current prefix and suffix around the whole governed
        // span. Unlike a minimal receipt, this retains equal newline/CRLF
        // boundaries, while still expanding or contracting around remote text
        // inside the stable span without using authored-time character counts.
        let mapped_bytes = executed.and_then(|item| {
            let range = &item.guard.range;
            let suffix_len = before_text.len().checked_sub(range.end)?;
            let end = after_text.len().checked_sub(suffix_len)?;
            if range.start <= end
                && after_text.is_char_boundary(range.start)
                && after_text.is_char_boundary(end)
            {
                Some(range.start..end)
            } else {
                None
            }
        });
        let receipt_bytes = receipt.map(|receipt| receipt.start.byte..receipt.new_end.byte);
        let mapped_complete = mapped_bytes.is_some();
        let bytes = match (mapped_bytes, receipt_bytes) {
            (Some(a), Some(b)) => a.start.min(b.start)..a.end.max(b.end),
            (Some(range), None) | (None, Some(range)) => range,
            (None, None) => 0..0,
        };
        let unicode_range =
            after_text[..bytes.start].chars().count()..after_text[..bytes.end].chars().count();
        let before_bytes = executed.map(|item| item.guard.range.clone());
        let metadata = match (action, before_bytes) {
            (HistoryAction::Undo, Some(before)) => {
                HistoryGovernanceMetadata::new(&after_text[bytes.clone()], &before_text[before])
            }
            (HistoryAction::Redo, Some(before)) => {
                HistoryGovernanceMetadata::new(&before_text[before], &after_text[bytes.clone()])
            }
            (_, None) => {
                HistoryGovernanceMetadata::new(&after_text[bytes.clone()], &after_text[bytes])
            }
        };
        let mut item = self.governance_item(metadata, unicode_range);
        if executed.is_none() || !mapped_complete {
            item.anchors_complete = false;
        }
        item
    }

    pub fn can_undo(&self) -> bool {
        self.undo.borrow().can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.undo.borrow().can_redo()
    }

    pub fn undo_count(&self) -> usize {
        self.undo.borrow().undo_count()
    }

    pub fn redo_count(&self) -> usize {
        self.undo.borrow().redo_count()
    }

    /// Append `line` (a single logical line WITHOUT a trailing newline) at the end
    /// of the buffer, authored to this replica. A newline is added so the next
    /// append starts a fresh line. Convenience over `insert_authored` for the
    /// common "agent adds a line" case the merge test exercises.
    pub fn append_line(&self, line: &str) -> AuthoredEdit {
        let end = self.text.len_unicode();
        self.insert_authored(end, &format!("{line}\n"))
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
    /// state + history folded into one blob a fresh or reconnecting
    /// replica imports via [`apply_remote_ops`](Self::apply_remote_ops) to
    /// reconstruct the doc in one shot — no full-history replay. This is the byte
    /// stream that can ride to the content-addressed `/blob` store, so a peer that
    /// missed the live op stream catches up from snapshot+recent-deltas instead of
    /// the whole log. `/blob` is P2 checkpoint transport, not authoritative editor
    /// recovery evidence.
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
        self.apply_remote_ops_with_receipt(export_bytes).map(|_| ())
    }

    /// Import peer operations and return one broad exact text receipt. Loro's
    /// local-only undo manager observes imports as remote diffs, never as local
    /// undo items. Replayed/style-only frames return no fake text receipt.
    pub fn apply_remote_ops_with_receipt(
        &self,
        export_bytes: &[u8],
    ) -> std::result::Result<Option<EditReceipt>, String> {
        let before = self.text.to_string();
        self.doc.import(export_bytes).map_err(|e| format!("{e}"))?;
        self.doc.commit();
        let receipt = EditReceipt::between(&before, &self.text.to_string());
        if let Some(receipt) = &receipt {
            self.pending_receipts.borrow_mut().push(receipt.clone());
        }
        Ok(receipt)
    }

    /// Drain authoritative UTF-8 receipts in mutation order. A complete empty
    /// batch means no text changed. An incomplete empty batch means retention
    /// overflowed and the consumer must full-parse the current text. No-op and
    /// style-only changes never enter this stream.
    pub fn take_edit_receipts(&self) -> ReceiptBatch {
        self.pending_receipts.borrow_mut().take()
    }

    #[cfg(test)]
    pub(crate) fn edit_receipt_batch_snapshot(&self) -> ReceiptBatch {
        self.pending_receipts.borrow().snapshot()
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

    fn apply_history(buffer: &HarborBuffer, action: HistoryAction) -> AuthoredEdit {
        buffer
            .apply_history_governed(action, |_, _| Ok(()))
            .expect("governed history operation succeeds")
            .expect("one governed history item")
    }

    /// A stable PD identity → PeerId mapping: same identity, same id; different
    /// identities, (overwhelmingly) different ids. This underpins the
    /// replica↔identity binding that stable authorship and reconnect depend on.
    #[test]
    fn peer_id_is_stable_and_identity_specific() {
        let human = "port-daddy:console:erich";
        let agent = "port-daddy:editor:refactor-agent";
        assert_eq!(
            peer_id_for_identity(human),
            peer_id_for_identity(human),
            "same identity must mint the same replica id across reconnects"
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
        let edit = human.replace_authored(1..2, "é");
        assert_eq!(human.to_string(), "aéz\n");
        agent.apply_remote_ops(&edit.delta).unwrap();
        assert_eq!(agent.to_string(), human.to_string());

        // The replacement span keeps local authorship after a remote import.
        let spans = human.richtext_spans();
        assert!(spans
            .iter()
            .any(|(text, author)| { text.contains('é') && *author == Some(human.local_peer()) }));
    }

    #[test]
    fn initial_load_and_imported_only_history_are_not_undoable() {
        let dir = scratch_dir();
        let path = dir.join("history-seed.txt");
        std::fs::write(&path, "seeded\n").unwrap();
        let opened = HarborBuffer::open(path.to_str().unwrap(), "port-daddy:console:opened")
            .expect("open seeded file");
        assert!(!opened.can_undo(), "disk seeding is baseline, not history");
        assert_eq!(opened.undo_count(), 0);

        let author = HarborBuffer::empty("port-daddy:editor:remote-author");
        author.replace_authored(0..0, "peer text");
        let importer = HarborBuffer::empty("port-daddy:console:importer");
        importer
            .apply_remote_ops(&author.export_ops())
            .expect("peer history imports");
        assert_eq!(importer.to_string(), "peer text");
        assert!(
            !importer.can_undo(),
            "peer operations never enter local undo"
        );
        assert_eq!(importer.undo_count(), 0);
    }

    #[test]
    fn one_replacement_is_one_undo_item_and_new_edit_clears_redo() {
        let dir = scratch_dir();
        let path = dir.join("single-item.txt");
        std::fs::write(&path, "abc").unwrap();
        let buffer = HarborBuffer::open(path.to_str().unwrap(), "port-daddy:console:history")
            .expect("open history file");

        buffer.replace_authored(1..2, "XYZ");
        assert_eq!(buffer.to_string(), "aXYZc");
        assert_eq!(buffer.undo_count(), 1, "one replacement is one item");
        assert_eq!(buffer.redo_count(), 0);

        let undo = apply_history(&buffer, HistoryAction::Undo);
        assert_eq!(buffer.to_string(), "abc");
        assert_eq!(undo.receipt.as_ref().unwrap().deleted_text, "XYZ");
        assert_eq!(undo.receipt.as_ref().unwrap().inserted_text, "b");
        assert_eq!(buffer.redo_count(), 1);

        let redo = apply_history(&buffer, HistoryAction::Redo);
        assert_eq!(buffer.to_string(), "aXYZc");
        assert_eq!(redo.receipt.as_ref().unwrap().deleted_text, "b");
        assert_eq!(redo.receipt.as_ref().unwrap().inserted_text, "XYZ");

        apply_history(&buffer, HistoryAction::Undo);
        assert!(buffer.can_redo());
        buffer.replace_authored(0..1, "A");
        assert!(!buffer.can_redo(), "new local edit clears redo history");
        assert_eq!(buffer.redo_count(), 0);
    }

    fn history_case(
        name: &str,
        before: &str,
        unicode_range: Range<usize>,
        replacement: &str,
        expected_after: &str,
        expected_undo_range: Range<usize>,
        expected_undo_newlines: usize,
        expected_redo_range: Range<usize>,
        expected_redo_newlines: usize,
    ) {
        let dir = scratch_dir();
        let path = dir.join(format!("history-guard-{name}.txt"));
        std::fs::write(&path, before).unwrap();
        let buffer = HarborBuffer::open(path.to_str().unwrap(), format!("history:{name}"))
            .expect("open history guard fixture");

        buffer.replace_authored(unicode_range, replacement);
        assert_eq!(buffer.to_string(), expected_after, "{name} post-edit text");
        assert_eq!(
            buffer.undo_guard().unwrap(),
            Some(HistoryGuard {
                range: expected_undo_range.clone(),
                replacement_newlines: expected_undo_newlines,
            }),
            "{name} undo governs the post-edit visible span"
        );

        apply_history(&buffer, HistoryAction::Undo);
        assert_eq!(buffer.to_string(), before, "{name} undo text");
        assert_eq!(
            buffer.redo_guard().unwrap(),
            Some(HistoryGuard {
                range: expected_redo_range,
                replacement_newlines: expected_redo_newlines,
            }),
            "{name} redo metadata survives the stack transfer"
        );

        apply_history(&buffer, HistoryAction::Redo);
        assert_eq!(buffer.to_string(), expected_after, "{name} redo text");
        assert_eq!(
            buffer.undo_range().unwrap(),
            Some(expected_undo_range),
            "{name} post-redo span remains governed"
        );
    }

    #[test]
    fn history_guards_use_post_edit_spans_for_beginning_middle_and_multiline_eof_insertions() {
        history_case(
            "begin",
            "middle\n",
            0..0,
            ">>",
            ">>middle\n",
            0..2,
            0,
            0..0,
            0,
        );
        history_case("middle", "abcd\n", 2..2, "X", "abXcd\n", 2..3, 0, 2..2, 0);
        history_case(
            "eof-multiline",
            "one\ntwo",
            7..7,
            "\nthree\nfour",
            "one\ntwo\nthree\nfour",
            7..18,
            0,
            7..7,
            2,
        );
    }

    #[test]
    fn history_guards_cover_newline_replacement_and_pure_deletion_plans() {
        history_case(
            "newline-replacement",
            "one\ntwo\n",
            3..4,
            "\nX\n",
            "one\nX\ntwo\n",
            3..6,
            1,
            3..4,
            2,
        );
        history_case(
            "pure-deletion",
            "one\ntwo\n",
            3..4,
            "",
            "onetwo\n",
            3..3,
            1,
            3..4,
            0,
        );
    }

    #[test]
    fn history_guards_are_utf8_exact_for_crlf_cjk_emoji_and_combining_sequences() {
        history_case(
            "crlf",
            "a\r\nb\r\n",
            1..3,
            "\r\n中\r\n",
            "a\r\n中\r\nb\r\n",
            1..8,
            1,
            1..3,
            2,
        );
        history_case(
            "cjk",
            "甲乙丙\n",
            1..2,
            "日本",
            "甲日本丙\n",
            3..9,
            0,
            3..6,
            0,
        );

        let before = "a👩‍🚀e\u{301}z\n";
        let after = "a🦀o\u{308}z\n";
        history_case(
            "emoji-combining",
            before,
            1..6,
            "🦀o\u{308}",
            after,
            1.."a🦀o\u{308}".len(),
            0,
            1.."a👩‍🚀e\u{301}".len(),
            0,
        );
    }

    #[test]
    fn history_guards_shift_with_remote_edits_before_undo_and_redo() {
        let dir = scratch_dir();
        let path = dir.join("history-remote-shift.txt");
        std::fs::write(&path, "abcd\n").unwrap();
        let local = HarborBuffer::open(path.to_str().unwrap(), "history:local").unwrap();
        local.replace_authored(2..2, "LOCAL");

        let peer = HarborBuffer::empty("history:peer");
        peer.apply_remote_ops(&local.export_ops()).unwrap();
        peer.replace_authored(0..0, "REMOTE\n");
        local.apply_remote_ops(&peer.export_ops()).unwrap();
        let shifted = local.to_string().find("LOCAL").unwrap();
        assert_eq!(local.undo_range().unwrap(), Some(shifted..shifted + 5));

        let undo = apply_history(&local, HistoryAction::Undo);
        peer.apply_remote_ops(&undo.delta).unwrap();
        peer.replace_authored(0..0, "SECOND\n");
        local.apply_remote_ops(&peer.export_ops()).unwrap();
        let insertion_point = local.to_string().find("cd\n").unwrap();
        assert_eq!(
            local.redo_guard().unwrap(),
            Some(HistoryGuard {
                range: insertion_point..insertion_point,
                replacement_newlines: 0,
            })
        );
        let redo = apply_history(&local, HistoryAction::Redo);
        assert!(local.to_string().contains("LOCALcd\n"));
        peer.apply_remote_ops(&redo.delta).unwrap();
        peer.replace_authored(0..0, "THIRD\n");
        local.apply_remote_ops(&peer.export_ops()).unwrap();
        let post_redo_shift = local.to_string().find("LOCAL").unwrap();
        assert_eq!(
            local.undo_range().unwrap(),
            Some(post_redo_shift..post_redo_shift + 5),
            "resurrected undo governance keeps shifting with later peer edits"
        );

        apply_history(&local, HistoryAction::Undo);
        let repeated_redo_point = local.to_string().find("cd\n").unwrap();
        assert_eq!(
            local.redo_range().unwrap(),
            Some(repeated_redo_point..repeated_redo_point),
            "the next redo must be re-anchored after the second undo"
        );
    }

    fn apply_remote_replacement(
        local: &HarborBuffer,
        peer: &HarborBuffer,
        range: Range<usize>,
        replacement: &str,
    ) {
        peer.apply_remote_ops(&local.export_ops())
            .expect("peer imports local state");
        let edit = peer.replace_authored(range, replacement);
        local
            .apply_remote_ops(&edit.delta)
            .expect("local imports peer replacement");
    }

    #[test]
    fn remote_edits_inside_local_insert_survive_repeated_history_cycles() {
        for (name, remote_range, remote_text, after_remote, after_undo, redo_range) in [
            ("replace", 1..2, "X", "AXCq\n", "Xq\n", 0..1),
            (
                "insert-newline",
                1..1,
                "中\n",
                "A中\nBCq\n",
                "中\nq\n",
                0..4,
            ),
        ] {
            let dir = scratch_dir();
            let path = dir.join(format!("history-remote-interior-{name}.txt"));
            std::fs::write(&path, "q\n").unwrap();
            let local = HarborBuffer::open(path.to_str().unwrap(), format!("interior:{name}:A"))
                .expect("open interior fixture");
            local.replace_authored(0..0, "ABC");
            let peer = HarborBuffer::empty(format!("interior:{name}:B"));
            apply_remote_replacement(&local, &peer, remote_range, remote_text);
            assert_eq!(local.to_string(), after_remote);
            let drained = local.take_edit_receipts();
            assert!(drained.complete);

            for cycle in 0..3 {
                let undo = apply_history(&local, HistoryAction::Undo);
                assert_eq!(local.to_string(), after_undo, "{name} undo cycle {cycle}");
                assert_eq!(
                    local.redo_range().unwrap(),
                    Some(redo_range.clone()),
                    "{name} redo is anchored around the preserved peer text"
                );
                assert!(undo.receipt.is_some(), "{name} undo emits a receipt");

                let redo = apply_history(&local, HistoryAction::Redo);
                assert_eq!(local.to_string(), after_remote, "{name} redo cycle {cycle}");
                assert!(redo.receipt.is_some(), "{name} redo emits a receipt");
            }
            let batch = local.take_edit_receipts();
            assert!(batch.complete);
            assert_eq!(batch.receipts.len(), 6);
        }
    }

    #[test]
    fn neutralized_undo_top_preflights_older_item_and_reconciles_every_pop() {
        let dir = scratch_dir();
        let path = dir.join("history-neutralized-undo-top.txt");
        std::fs::write(&path, "older\nneutral\n").unwrap();
        let local = HarborBuffer::open(path.to_str().unwrap(), "neutralized:undo:A").unwrap();
        local.replace_authored(0..0, "OLD-");
        let top = local.to_string().find("neutral").unwrap();
        let top_unicode = local.to_string()[..top].chars().count();
        local.replace_authored(top_unicode..top_unicode, "TOP-");

        let peer = HarborBuffer::empty("neutralized:undo:B");
        peer.apply_remote_ops(&local.export_ops()).unwrap();
        let peer_text = peer.to_string();
        let top_byte = peer_text.find("TOP-").unwrap();
        let top_start = peer_text[..top_byte].chars().count();
        let peer_delete = peer.replace_authored(top_start..top_start + 4, "");
        local.apply_remote_ops(&peer_delete.delta).unwrap();
        assert_eq!(local.to_string(), "OLD-older\nneutral\n");
        assert_eq!((local.undo_count(), local.redo_count()), (2, 0));

        let before_text = local.to_string();
        let before_stamp = local.change_stamp();
        let before_receipts = local.edit_receipt_batch_snapshot();
        let mut preflighted = Vec::new();
        let refusal = local
            .apply_history_governed(HistoryAction::Undo, |text, guard| {
                preflighted.push(guard.range.clone());
                if text[guard.range.clone()].contains("OLD-") {
                    Err("older item claimed".into())
                } else {
                    Ok(())
                }
            })
            .expect_err("older item is checked before neutralized top can pop");
        assert_eq!(refusal, "older item claimed");
        assert_eq!(preflighted.len(), 2, "both possible pops are preflighted");
        assert_eq!(local.to_string(), before_text);
        assert_eq!(local.change_stamp(), before_stamp);
        assert_eq!((local.undo_count(), local.redo_count()), (2, 0));
        assert_eq!(local.edit_receipt_batch_snapshot(), before_receipts);

        apply_history(&local, HistoryAction::Undo);
        assert_eq!(local.to_string(), "older\nneutral\n");
        assert_eq!((local.undo_count(), local.redo_count()), (0, 1));
        let stacks = local.history_governance.borrow();
        assert!(stacks.synchronized);
        assert_eq!((stacks.undo.len(), stacks.redo.len()), (0, 1));
        drop(stacks);
        apply_history(&local, HistoryAction::Redo);
        assert_eq!(local.to_string(), "OLD-older\nneutral\n");
        assert_eq!((local.undo_count(), local.redo_count()), (1, 0));
    }

    #[test]
    fn fully_neutralized_history_is_consumed_without_receipt_or_opposite_item() {
        let local = HarborBuffer::empty("neutralized:only:A");
        local.replace_authored(0..0, "ABC");
        let peer = HarborBuffer::empty("neutralized:only:B");
        peer.apply_remote_ops(&local.export_ops()).unwrap();
        let deletion = peer.replace_authored(0..3, "");
        local.apply_remote_ops(&deletion.delta).unwrap();
        assert_eq!(local.to_string(), "");
        let before_receipts = local.edit_receipt_batch_snapshot();

        let result = local
            .apply_history_governed(HistoryAction::Undo, |_, _| Ok(()))
            .expect("neutralized history is a valid no-op");
        assert!(result.is_none());
        assert_eq!((local.undo_count(), local.redo_count()), (0, 0));
        assert_eq!(local.edit_receipt_batch_snapshot(), before_receipts);
        let stacks = local.history_governance.borrow();
        assert!(stacks.synchronized);
        assert_eq!((stacks.undo.len(), stacks.redo.len()), (0, 0));
    }

    #[test]
    fn neutralized_newline_redo_preflights_older_item_and_reconciles_every_pop() {
        let dir = scratch_dir();
        let path = dir.join("history-neutralized-redo-top.txt");
        std::fs::write(&path, "claim\nvictim\n").unwrap();
        let local = HarborBuffer::open(path.to_str().unwrap(), "neutralized:redo:A").unwrap();
        local.replace_authored(5..6, "");
        let end = local.to_string().chars().count();
        local.replace_authored(end..end, "OLDER");
        apply_history(&local, HistoryAction::Undo);
        apply_history(&local, HistoryAction::Undo);
        assert_eq!(local.to_string(), "claim\nvictim\n");
        assert_eq!((local.undo_count(), local.redo_count()), (0, 2));

        let peer = HarborBuffer::empty("neutralized:redo:B");
        peer.apply_remote_ops(&local.export_ops()).unwrap();
        let peer_delete = peer.replace_authored(5..6, "");
        local.apply_remote_ops(&peer_delete.delta).unwrap();
        assert_eq!(local.to_string(), "claimvictim\n");

        let before_text = local.to_string();
        let before_stamp = local.change_stamp();
        let before_receipts = local.edit_receipt_batch_snapshot();
        let mut calls = 0;
        let refusal = local
            .apply_history_governed(HistoryAction::Redo, |text, guard| {
                calls += 1;
                if guard.range.start == text.len() {
                    Err("older redo claimed".into())
                } else {
                    Ok(())
                }
            })
            .expect_err("older redo is checked before neutralized newline top can pop");
        assert_eq!(refusal, "older redo claimed");
        assert_eq!(calls, 2);
        assert_eq!(local.to_string(), before_text);
        assert_eq!(local.change_stamp(), before_stamp);
        assert_eq!((local.undo_count(), local.redo_count()), (0, 2));
        assert_eq!(local.edit_receipt_batch_snapshot(), before_receipts);

        apply_history(&local, HistoryAction::Redo);
        assert_eq!(local.to_string(), "claimvictim\nOLDER");
        assert_eq!((local.undo_count(), local.redo_count()), (1, 0));
        let stacks = local.history_governance.borrow();
        assert!(stacks.synchronized);
        assert_eq!((stacks.undo.len(), stacks.redo.len()), (1, 0));
    }

    #[test]
    fn governance_capacity_matches_loro_at_one_hundred_and_one_hundred_one_items() {
        for authored in [HISTORY_CAPACITY, HISTORY_CAPACITY + 1] {
            let buffer = HarborBuffer::empty(format!("history:capacity:{authored}"));
            for _ in 0..authored {
                let end = buffer.to_string().chars().count();
                buffer.replace_authored(end..end, "x");
            }
            assert_eq!(buffer.undo_count(), HISTORY_CAPACITY);
            let stacks = buffer.history_governance.borrow();
            assert!(stacks.synchronized);
            assert_eq!(stacks.undo.len(), buffer.undo_count());
            assert_eq!(stacks.redo.len(), buffer.redo_count());
            drop(stacks);

            let mut preflighted = 0;
            buffer
                .apply_history_governed(HistoryAction::Undo, |_, _| {
                    preflighted += 1;
                    Ok(())
                })
                .expect("capacity-bound undo succeeds")
                .expect("capacity-bound top is effective");
            assert_eq!(preflighted, HISTORY_CAPACITY);
            let stacks = buffer.history_governance.borrow();
            assert!(stacks.synchronized);
            assert_eq!(stacks.undo.len(), buffer.undo_count());
            assert_eq!(stacks.redo.len(), buffer.redo_count());
        }
    }

    #[test]
    fn new_local_edit_clears_reanchored_redo_and_sidecar() {
        let buffer = HarborBuffer::empty("history:new-edit-clears-redo");
        buffer.replace_authored(0..0, "ABC");
        apply_history(&buffer, HistoryAction::Undo);
        assert_eq!((buffer.undo_count(), buffer.redo_count()), (0, 1));

        buffer.replace_authored(0..0, "NEW");
        assert_eq!((buffer.undo_count(), buffer.redo_count()), (1, 0));
        assert!(buffer.redo_guard().unwrap().is_none());
        let stacks = buffer.history_governance.borrow();
        assert!(stacks.synchronized);
        assert_eq!((stacks.undo.len(), stacks.redo.len()), (1, 0));
    }

    fn repeated_remote_shift_case(
        name: &str,
        unicode_range: Range<usize>,
        replacement: &str,
        expected_after: &str,
        expected_undo_range: Range<usize>,
        expected_redo_range: Range<usize>,
    ) {
        const BEFORE: &str = "abcd\ntail\n";
        const PREFIX: &str = "REMOTE\n";
        let dir = scratch_dir();
        let path = dir.join(format!("history-repeated-{name}.txt"));
        std::fs::write(&path, BEFORE).unwrap();
        let local = HarborBuffer::open(path.to_str().unwrap(), format!("history:{name}:local"))
            .expect("open repeated-cycle fixture");

        local.replace_authored(unicode_range, replacement);
        apply_history(&local, HistoryAction::Undo);

        let peer = HarborBuffer::empty(format!("history:{name}:peer"));
        peer.apply_remote_ops(&local.export_ops()).unwrap();
        peer.replace_authored(0..0, PREFIX);
        local.apply_remote_ops(&peer.export_ops()).unwrap();

        apply_history(&local, HistoryAction::Redo);
        assert_eq!(local.to_string(), format!("{PREFIX}{expected_after}"));
        assert_eq!(
            local.undo_range().unwrap(),
            Some(expected_undo_range.clone()),
            "{name} redo freshly anchors the next undo"
        );

        apply_history(&local, HistoryAction::Undo);
        assert_eq!(local.to_string(), format!("{PREFIX}{BEFORE}"));
        assert_eq!(
            local.redo_range().unwrap(),
            Some(expected_redo_range.clone()),
            "{name} second undo freshly anchors the next redo"
        );

        apply_history(&local, HistoryAction::Redo);
        assert_eq!(local.to_string(), format!("{PREFIX}{expected_after}"));
        assert_eq!(
            local.undo_range().unwrap(),
            Some(expected_undo_range),
            "{name} repeated redo remains anchored without saved-selection reuse"
        );
    }

    #[test]
    fn repeated_history_cycles_reanchor_insertion_replacement_and_collapsed_deletion() {
        repeated_remote_shift_case("insertion", 2..2, "LOCAL", "abLOCALcd\ntail\n", 9..14, 9..9);
        repeated_remote_shift_case("replacement", 1..3, "XY", "aXYd\ntail\n", 8..10, 8..10);
        repeated_remote_shift_case("deletion", 1..3, "", "ad\ntail\n", 8..8, 8..10);
    }

    #[test]
    fn governed_history_rejection_preserves_all_authoritative_state() {
        let dir = scratch_dir();
        let path = dir.join("history-atomic-rejection.txt");
        std::fs::write(&path, "one\ntwo\n").unwrap();
        let buffer = HarborBuffer::open(path.to_str().unwrap(), "history:atomic-rejection")
            .expect("open atomic rejection fixture");
        buffer.replace_authored(4..4, "LOCAL\n");

        let assert_rejected_without_mutation = |action| {
            let before_text = buffer.to_string();
            let before_state_vv = buffer.change_stamp();
            let before_oplog_vv = buffer.doc.oplog_vv();
            let before_undo_count = buffer.undo_count();
            let before_redo_count = buffer.redo_count();
            let before_receipts = buffer.edit_receipt_batch_snapshot();

            let error = buffer
                .apply_history_governed(action, |_, _| Err("claimed".into()))
                .expect_err("claim validator rejects before Loro history mutation");
            assert_eq!(error, "claimed");
            assert_eq!(buffer.to_string(), before_text);
            assert_eq!(buffer.change_stamp(), before_state_vv);
            assert_eq!(buffer.doc.oplog_vv(), before_oplog_vv);
            assert_eq!(buffer.undo_count(), before_undo_count);
            assert_eq!(buffer.redo_count(), before_redo_count);
            assert_eq!(buffer.edit_receipt_batch_snapshot(), before_receipts);
        };

        assert_rejected_without_mutation(HistoryAction::Undo);
        apply_history(&buffer, HistoryAction::Undo);
        assert_rejected_without_mutation(HistoryAction::Redo);
    }

    #[test]
    fn text_noop_history_transfers_without_fake_receipts() {
        let dir = scratch_dir();
        let path = dir.join("history-text-noop.txt");
        std::fs::write(&path, "same\n").unwrap();
        let buffer = HarborBuffer::open(path.to_str().unwrap(), "history:text-noop")
            .expect("open text-noop history fixture");

        let authored = buffer.replace_authored(0..4, "same");
        assert!(authored.receipt.is_none());
        assert_eq!(buffer.undo_count(), 1);
        assert!(buffer.edit_receipt_batch_snapshot().receipts.is_empty());

        let undo = apply_history(&buffer, HistoryAction::Undo);
        assert!(undo.receipt.is_none());
        assert_eq!((buffer.undo_count(), buffer.redo_count()), (0, 1));
        assert!(buffer.edit_receipt_batch_snapshot().receipts.is_empty());

        let redo = apply_history(&buffer, HistoryAction::Redo);
        assert!(redo.receipt.is_none());
        assert_eq!((buffer.undo_count(), buffer.redo_count()), (1, 0));
        assert!(buffer.edit_receipt_batch_snapshot().receipts.is_empty());
    }

    #[test]
    fn emoji_and_combining_replacement_is_one_undo_item() {
        let dir = scratch_dir();
        let path = dir.join("ime-item.txt");
        std::fs::write(&path, "e\u{301}lan").unwrap();
        let buffer = HarborBuffer::open(path.to_str().unwrap(), "port-daddy:console:ime")
            .expect("open IME file");

        let edit = buffer.replace_authored(0..2, "👩‍🚀");
        assert_eq!(buffer.to_string(), "👩‍🚀lan");
        assert_eq!(buffer.undo_count(), 1);
        let receipt = edit.receipt.expect("text-changing IME receipt");
        assert_eq!(receipt.deleted_text, "e\u{301}");
        assert_eq!(receipt.inserted_text, "👩‍🚀");

        apply_history(&buffer, HistoryAction::Undo);
        assert_eq!(buffer.to_string(), "e\u{301}lan");
        assert!(!buffer.can_undo());
    }

    #[test]
    fn receipt_drain_preserves_local_remote_undo_redo_order() {
        let dir = scratch_dir();
        let path = dir.join("ordered-receipts.txt");
        std::fs::write(&path, "core").unwrap();
        let buffer = HarborBuffer::open(path.to_str().unwrap(), "port-daddy:console:receipt-A")
            .expect("open receipt file");

        buffer.replace_authored(0..0, "A-");
        let peer = HarborBuffer::empty("port-daddy:editor:receipt-B");
        peer.apply_remote_ops(&buffer.export_ops()).unwrap();
        let peer_end = peer.to_string().chars().count();
        peer.replace_authored(peer_end..peer_end, "-B");
        buffer.apply_remote_ops(&peer.export_ops()).unwrap();
        apply_history(&buffer, HistoryAction::Undo);
        apply_history(&buffer, HistoryAction::Redo);

        let batch = buffer.take_edit_receipts();
        assert!(batch.complete);
        let receipts = batch.receipts;
        assert_eq!(receipts.len(), 4);
        assert_eq!(
            receipts
                .iter()
                .map(|receipt| (
                    receipt.deleted_text.as_str(),
                    receipt.inserted_text.as_str()
                ))
                .collect::<Vec<_>>(),
            vec![("", "A-"), ("", "-B"), ("A-", ""), ("", "A-")]
        );
        let empty = buffer.take_edit_receipts();
        assert!(empty.complete);
        assert!(empty.receipts.is_empty(), "drain is exact");
    }

    #[test]
    fn receipt_overflow_is_bounded_and_forces_full_parse() {
        let boundary = HarborBuffer::empty("port-daddy:console:receipt-boundary");
        for _ in 0..EDIT_RECEIPT_CAPACITY {
            let end = boundary.to_string().chars().count();
            boundary.insert_authored(end, "x");
        }
        let exact = boundary.take_edit_receipts();
        assert!(exact.complete);
        assert_eq!(exact.receipts.len(), EDIT_RECEIPT_CAPACITY);

        let buffer = HarborBuffer::empty("port-daddy:console:receipt-overflow");
        for _ in 0..=EDIT_RECEIPT_CAPACITY {
            let end = buffer.to_string().chars().count();
            buffer.insert_authored(end, "x");
        }

        let overflow = buffer.take_edit_receipts();
        assert!(!overflow.complete, "overflow is an explicit discontinuity");
        assert!(
            overflow.receipts.is_empty(),
            "an incomplete batch never exposes a silently truncated sequence"
        );

        let reset = buffer.take_edit_receipts();
        assert!(reset.complete, "draining acknowledges the discontinuity");
        assert!(reset.receipts.is_empty(), "empty exact remains distinct");

        let end = buffer.to_string().chars().count();
        buffer.insert_authored(end, "y");
        let resumed = buffer.take_edit_receipts();
        assert!(resumed.complete);
        assert_eq!(resumed.receipts.len(), 1);
        assert_eq!(resumed.receipts[0].inserted_text, "y");
    }

    #[test]
    fn receipts_cover_ascii_multibyte_newline_whole_document_and_noop() {
        let replace = |identity: &str, initial: &str, range, replacement: &str| {
            let dir = scratch_dir();
            let path = dir.join(format!("{identity}.txt"));
            std::fs::write(&path, initial).unwrap();
            let buffer = HarborBuffer::open(path.to_str().unwrap(), identity).unwrap();
            buffer.replace_authored(range, replacement).receipt
        };

        let ascii = replace("ascii", "abc", 1..2, "XY").unwrap();
        assert_eq!(
            ascii.start,
            EditPoint {
                byte: 1,
                row: 0,
                column: 1
            }
        );
        assert_eq!(
            ascii.old_end,
            EditPoint {
                byte: 2,
                row: 0,
                column: 2
            }
        );
        assert_eq!(
            ascii.new_end,
            EditPoint {
                byte: 3,
                row: 0,
                column: 3
            }
        );
        assert_eq!(
            (ascii.deleted_text.as_str(), ascii.inserted_text.as_str()),
            ("b", "XY")
        );

        let multibyte = replace("multibyte", "a😀z", 1..2, "é").unwrap();
        assert_eq!(multibyte.start.byte, 1);
        assert_eq!(multibyte.old_end.byte, 5);
        assert_eq!(multibyte.new_end.byte, 3);
        assert_eq!(
            (
                multibyte.deleted_text.as_str(),
                multibyte.inserted_text.as_str()
            ),
            ("😀", "é")
        );

        let cjk = replace("cjk", "a漢字", 1..2, "界").unwrap();
        assert_eq!(
            cjk.start,
            EditPoint {
                byte: 1,
                row: 0,
                column: 1
            }
        );
        assert_eq!(
            cjk.old_end,
            EditPoint {
                byte: 4,
                row: 0,
                column: 4
            }
        );
        assert_eq!(cjk.new_end, cjk.old_end);
        assert_eq!(
            (cjk.deleted_text.as_str(), cjk.inserted_text.as_str()),
            ("漢", "界")
        );

        let crlf = replace("crlf", "ab\r\ncd", 2..4, "\r\n界\r\n").unwrap();
        assert_eq!(
            crlf.start,
            EditPoint {
                byte: 2,
                row: 0,
                column: 2
            }
        );
        assert_eq!(
            crlf.old_end,
            EditPoint {
                byte: 4,
                row: 1,
                column: 0
            }
        );
        assert_eq!(
            crlf.new_end,
            EditPoint {
                byte: 9,
                row: 2,
                column: 0
            }
        );

        let after_multibyte = replace("byte-column", "top\né漢x", 6..7, "界").unwrap();
        assert_eq!(
            after_multibyte.start,
            EditPoint {
                byte: 9,
                row: 1,
                column: 5
            },
            "columns remain UTF-8 bytes after multibyte text"
        );
        assert_eq!(
            after_multibyte.old_end,
            EditPoint {
                byte: 10,
                row: 1,
                column: 6
            }
        );
        assert_eq!(
            after_multibyte.new_end,
            EditPoint {
                byte: 12,
                row: 1,
                column: 8
            }
        );

        let newline = replace("newline", "ab\ncd", 2..3, "\nX\n").unwrap();
        assert_eq!(
            newline.start,
            EditPoint {
                byte: 2,
                row: 0,
                column: 2
            }
        );
        assert_eq!(
            newline.old_end,
            EditPoint {
                byte: 3,
                row: 1,
                column: 0
            }
        );
        assert_eq!(
            newline.new_end,
            EditPoint {
                byte: 5,
                row: 2,
                column: 0
            }
        );

        let whole = replace("whole", "abc", 0..3, "😀").unwrap();
        assert_eq!(
            whole.start,
            EditPoint {
                byte: 0,
                row: 0,
                column: 0
            }
        );
        assert_eq!(whole.old_end.byte, 3);
        assert_eq!(whole.new_end.byte, 4);

        assert!(replace("noop", "same", 0..4, "same").is_none());
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

    /// Importing the same ops twice is idempotent (a reconnecting peer may
    /// re-import; the buffer must not duplicate lines). This is a P1/P2 CRDT
    /// property, not proof that the caller is authorized to recover a dead actor.
    #[test]
    fn reimporting_ops_is_idempotent() {
        let a = HarborBuffer::empty("port-daddy:editor:a");
        a.append_line("one");
        let b = HarborBuffer::empty("port-daddy:editor:b");
        let ops = a.export_ops();
        assert!(b.apply_remote_ops_with_receipt(&ops).unwrap().is_some());
        assert!(
            b.apply_remote_ops_with_receipt(&ops).unwrap().is_none(),
            "an idempotent replay must not mint a fake text receipt"
        );
        assert_eq!(
            b.lines().len(),
            1,
            "re-importing identical ops must not duplicate the line"
        );
    }

    /// P2 slice 3 durability: a compacted snapshot reconstructs the whole buffer —
    /// content AND per-line authorship — in one import, exactly what a reconnecting
    /// replica does after fetching a P2 snapshot blob from `/blob`.
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

        // Re-importing the snapshot is idempotent (duplicate-delivery safety).
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
