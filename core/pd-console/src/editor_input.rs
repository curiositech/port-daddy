//! Renderer-agnostic text-input state for the Harbor Editor.
//!
//! GPUI's platform input bridge speaks UTF-16 ranges, shaped text uses UTF-8
//! byte offsets, and Loro edits use Unicode scalar offsets. This module owns the
//! first two translations and keeps every caret/selection on a grapheme boundary;
//! `EditorPane` performs the final byte -> Loro translation when an edit is
//! accepted by the existing claim guard.

use std::ops::Range;
use unicode_segmentation::UnicodeSegmentation;

/// One replacement prepared by the input model. `range` is a UTF-8 byte range
/// in the buffer text before the replacement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextEdit {
    pub range: Range<usize>,
    pub text: String,
}

/// Selection and composition state for one opened editor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditorInput {
    selected_range: Range<usize>,
    selection_reversed: bool,
    marked_range: Option<Range<usize>>,
    preferred_column: Option<usize>,
}

impl Default for EditorInput {
    fn default() -> Self {
        Self {
            selected_range: 0..0,
            selection_reversed: false,
            marked_range: None,
            preferred_column: None,
        }
    }
}

impl EditorInput {
    pub fn selection(&self) -> Range<usize> {
        self.selected_range.clone()
    }

    pub fn selection_reversed(&self) -> bool {
        self.selection_reversed
    }

    pub fn marked_range(&self) -> Option<Range<usize>> {
        self.marked_range.clone()
    }

    pub fn cursor(&self) -> usize {
        if self.selection_reversed {
            self.selected_range.start
        } else {
            self.selected_range.end
        }
    }

    pub fn anchor(&self) -> usize {
        if self.selection_reversed {
            self.selected_range.end
        } else {
            self.selected_range.start
        }
    }

    /// Clamp stale state after a remote edit. A remote CRDT merge can move or
    /// remove the byte under the local caret; the input bridge must never hand
    /// GPUI an invalid UTF-8 range afterwards.
    pub fn reconcile(&mut self, text: &str) {
        let start = boundary_at_or_before(text, self.selected_range.start.min(text.len()));
        let end = boundary_at_or_before(text, self.selected_range.end.min(text.len()));
        self.selected_range = start.min(end)..start.max(end);
        self.marked_range = self.marked_range.take().map(|range| {
            let start = boundary_at_or_before(text, range.start.min(text.len()));
            let end = boundary_at_or_before(text, range.end.min(text.len()));
            start.min(end)..start.max(end)
        });
    }

    pub fn left(&mut self, text: &str, select: bool) {
        self.reconcile(text);
        let target = if !select && !self.selected_range.is_empty() {
            self.selected_range.start
        } else {
            previous_boundary(text, self.cursor())
        };
        self.move_or_select(target, select);
    }

    pub fn right(&mut self, text: &str, select: bool) {
        self.reconcile(text);
        let target = if !select && !self.selected_range.is_empty() {
            self.selected_range.end
        } else {
            next_boundary(text, self.cursor())
        };
        self.move_or_select(target, select);
    }

    pub fn home(&mut self, text: &str, select: bool) {
        self.reconcile(text);
        let cursor = self.cursor();
        let target = text[..cursor].rfind('\n').map_or(0, |ix| ix + 1);
        self.move_or_select(target, select);
    }

    pub fn end(&mut self, text: &str, select: bool) {
        self.reconcile(text);
        let cursor = self.cursor();
        let target = text[cursor..]
            .find('\n')
            .map_or(text.len(), |ix| cursor + ix);
        self.move_or_select(target, select);
    }

    pub fn vertical(&mut self, text: &str, delta: isize, select: bool) {
        self.reconcile(text);
        let cursor = self.cursor();
        let (line, column) = line_and_grapheme_column(text, cursor);
        let column = self.preferred_column.unwrap_or(column);
        let line_count = text.split('\n').count().max(1);
        let target_line = (line as isize + delta).clamp(0, line_count as isize - 1) as usize;
        let target = byte_for_line_column(text, target_line, column);
        self.move_or_select(target, select);
        self.preferred_column = Some(column);
    }

    pub fn select_all(&mut self, text: &str) {
        self.selected_range = 0..text.len();
        self.selection_reversed = false;
        self.preferred_column = None;
    }

    pub fn move_to_byte(&mut self, text: &str, byte: usize, select: bool) {
        self.reconcile(text);
        let target = boundary_at_or_before(text, byte.min(text.len()));
        self.move_or_select(target, select);
    }

    pub fn backspace_range(&mut self, text: &str) -> Option<Range<usize>> {
        self.reconcile(text);
        if !self.selected_range.is_empty() {
            return Some(self.selected_range.clone());
        }
        let cursor = self.cursor();
        (cursor > 0).then(|| previous_boundary(text, cursor)..cursor)
    }

    pub fn delete_range(&mut self, text: &str) -> Option<Range<usize>> {
        self.reconcile(text);
        if !self.selected_range.is_empty() {
            return Some(self.selected_range.clone());
        }
        let cursor = self.cursor();
        (cursor < text.len()).then(|| cursor..next_boundary(text, cursor))
    }

    /// Prepare and commit one platform replacement. `range_utf16` and
    /// `new_selected_range_utf16` are GPUI/macOS ranges; the returned edit is a
    /// UTF-8 byte replacement ready for `EditorPane`.
    pub fn replace(
        &mut self,
        text: &str,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        mark: bool,
        new_selected_range_utf16: Option<Range<usize>>,
    ) -> TextEdit {
        self.reconcile(text);
        let range = range_utf16
            .as_ref()
            .map(|range| range_from_utf16(text, range))
            .or_else(|| self.marked_range.clone())
            .unwrap_or_else(|| self.selected_range.clone());
        let range = boundary_at_or_before(text, range.start)..boundary_at_or_after(text, range.end);
        let inserted_end = range.start + new_text.len();

        self.marked_range = mark.then(|| range.start..inserted_end);
        self.selected_range = if let Some(relative) = new_selected_range_utf16 {
            let relative = range_from_utf16(new_text, &relative);
            range.start + relative.start..range.start + relative.end
        } else {
            inserted_end..inserted_end
        };
        self.selection_reversed = false;
        self.preferred_column = None;

        TextEdit {
            range,
            text: new_text.to_string(),
        }
    }

    pub fn replace_bytes(&mut self, text: &str, range: Range<usize>, new_text: &str) -> TextEdit {
        self.reconcile(text);
        let range = boundary_at_or_before(text, range.start.min(text.len()))
            ..boundary_at_or_before(text, range.end.min(text.len()));
        let inserted_end = range.start + new_text.len();
        self.selected_range = inserted_end..inserted_end;
        self.selection_reversed = false;
        self.marked_range = None;
        self.preferred_column = None;
        TextEdit {
            range,
            text: new_text.to_string(),
        }
    }

    pub fn unmark(&mut self) {
        self.marked_range = None;
    }

    pub fn selection_utf16(&self, text: &str) -> Range<usize> {
        range_to_utf16(text, &self.selected_range)
    }

    pub fn marked_utf16(&self, text: &str) -> Option<Range<usize>> {
        self.marked_range
            .as_ref()
            .map(|range| range_to_utf16(text, range))
    }

    pub fn text_for_utf16_range(
        &self,
        text: &str,
        range_utf16: &Range<usize>,
    ) -> (String, Range<usize>) {
        let range = range_from_utf16(text, range_utf16);
        (
            text[range.clone()].to_string(),
            range_to_utf16(text, &range),
        )
    }

    pub fn byte_range_for_utf16(&self, text: &str, range: &Range<usize>) -> Range<usize> {
        range_from_utf16(text, range)
    }

    pub fn utf16_index_for_line_column(&self, text: &str, line: usize, column: usize) -> usize {
        byte_to_utf16(text, byte_for_line_column(text, line, column))
    }

    /// 1-based line and 0-based grapheme column for the existing presence lane.
    pub fn presence_cursor(&self, text: &str) -> (u32, u32) {
        self.presence_at_byte(text, self.cursor())
    }

    pub fn presence_at_byte(&self, text: &str, byte: usize) -> (u32, u32) {
        let (line, column) = line_and_grapheme_column(text, byte.min(text.len()));
        ((line + 1) as u32, column as u32)
    }

    pub fn presence_anchor(&self, text: &str) -> (u32, u32) {
        let (line, column) = line_and_grapheme_column(text, self.anchor().min(text.len()));
        ((line + 1) as u32, column as u32)
    }

    /// Inclusive 1-based line span covered by the current selection.
    pub fn selection_line_span(&self, text: &str) -> (u32, u32) {
        let start = line_and_grapheme_column(text, self.selected_range.start.min(text.len())).0;
        let end_byte = self.selected_range.end.min(text.len());
        let end = line_and_grapheme_column(text, end_byte).0;
        ((start + 1) as u32, (end + 1) as u32)
    }

    fn move_or_select(&mut self, offset: usize, select: bool) {
        if select {
            self.select_to(offset);
        } else {
            self.selected_range = offset..offset;
            self.selection_reversed = false;
        }
        if !select {
            self.preferred_column = None;
        }
        self.marked_range = None;
    }

    fn select_to(&mut self, offset: usize) {
        if self.selection_reversed {
            self.selected_range.start = offset;
        } else {
            self.selected_range.end = offset;
        }
        if self.selected_range.end < self.selected_range.start {
            self.selection_reversed = !self.selection_reversed;
            self.selected_range = self.selected_range.end..self.selected_range.start;
        }
    }
}

fn boundary_at_or_before(text: &str, offset: usize) -> usize {
    if offset >= text.len() {
        return text.len();
    }
    text.grapheme_indices(true)
        .map(|(ix, _)| ix)
        .take_while(|ix| *ix <= offset)
        .last()
        .unwrap_or(0)
}

fn boundary_at_or_after(text: &str, offset: usize) -> usize {
    let offset = offset.min(text.len());
    if offset == text.len() || text.grapheme_indices(true).any(|(ix, _)| ix == offset) {
        offset
    } else {
        next_boundary(text, offset)
    }
}

fn previous_boundary(text: &str, offset: usize) -> usize {
    text.grapheme_indices(true)
        .rev()
        .find_map(|(ix, _)| (ix < offset).then_some(ix))
        .unwrap_or(0)
}

fn next_boundary(text: &str, offset: usize) -> usize {
    text.grapheme_indices(true)
        .find_map(|(ix, _)| (ix > offset).then_some(ix))
        .unwrap_or(text.len())
}

fn byte_from_utf16(text: &str, offset: usize) -> usize {
    let mut units = 0;
    for (byte, ch) in text.char_indices() {
        if units >= offset {
            return byte;
        }
        units += ch.len_utf16();
    }
    text.len()
}

fn byte_to_utf16(text: &str, offset: usize) -> usize {
    text[..offset.min(text.len())].encode_utf16().count()
}

fn range_from_utf16(text: &str, range: &Range<usize>) -> Range<usize> {
    byte_from_utf16(text, range.start)..byte_from_utf16(text, range.end)
}

fn range_to_utf16(text: &str, range: &Range<usize>) -> Range<usize> {
    byte_to_utf16(text, range.start)..byte_to_utf16(text, range.end)
}

fn line_and_grapheme_column(text: &str, byte: usize) -> (usize, usize) {
    let byte = boundary_at_or_before(text, byte.min(text.len()));
    let before = &text[..byte];
    let line = before.bytes().filter(|b| *b == b'\n').count();
    let line_start = before.rfind('\n').map_or(0, |ix| ix + 1);
    let column = text[line_start..byte].graphemes(true).count();
    (line, column)
}

fn byte_for_line_column(text: &str, target_line: usize, target_column: usize) -> usize {
    let mut line_start = 0;
    for _ in 0..target_line {
        let Some(next) = text[line_start..].find('\n') else {
            return text.len();
        };
        line_start += next + 1;
    }
    let line_end = text[line_start..]
        .find('\n')
        .map_or(text.len(), |ix| line_start + ix);
    text[line_start..line_end]
        .grapheme_indices(true)
        .nth(target_column)
        .map_or(line_end, |(ix, _)| line_start + ix)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn movement_and_delete_never_split_a_grapheme() {
        let text = "a👨‍👩‍👧‍👦e\u{301}b";
        let mut input = EditorInput::default();
        input.right(text, false);
        assert_eq!(&text[input.cursor()..], "👨‍👩‍👧‍👦e\u{301}b");
        input.right(text, false);
        assert_eq!(&text[input.cursor()..], "e\u{301}b");
        input.right(text, false);
        let range = input.backspace_range(text).expect("one grapheme to erase");
        assert_eq!(&text[range], "e\u{301}");
    }

    #[test]
    fn selection_direction_survives_shift_navigation() {
        let text = "alpha";
        let mut input = EditorInput::default();
        input.right(text, false);
        input.right(text, false);
        input.right(text, true);
        input.right(text, true);
        assert_eq!(input.selection(), 2..4);
        assert!(!input.selection_reversed());
        input.left(text, true);
        input.left(text, true);
        input.left(text, true);
        assert_eq!(input.selection(), 1..2);
        assert!(input.selection_reversed());
    }

    #[test]
    fn utf16_replacement_maps_to_utf8_and_updates_composition() {
        let text = "a😀z";
        let mut input = EditorInput::default();
        // UTF-16 units: a=1, 😀=2, z=1. Replace only the emoji.
        let edit = input.replace(text, Some(1..3), "é", true, Some(1..1));
        assert_eq!(edit.range, 1..5);
        assert_eq!(edit.text, "é");
        assert_eq!(input.marked_range(), Some(1..3));
        assert_eq!(input.selection(), 3..3);
    }

    #[test]
    fn vertical_motion_keeps_a_grapheme_column() {
        let text = "abcdef\nx\n123456";
        let mut input = EditorInput::default();
        for _ in 0..5 {
            input.right(text, false);
        }
        input.vertical(text, 1, false);
        assert_eq!(input.presence_cursor(text), (2, 1));
        input.vertical(text, 1, false);
        assert_eq!(input.presence_cursor(text), (3, 5));
    }

    #[test]
    fn selecting_and_replacing_multiple_lines_reports_presence_span() {
        let text = "one\ntwo\nthree";
        let mut input = EditorInput::default();
        input.select_all(text);
        assert_eq!(input.selection_line_span(text), (1, 3));
        let edit = input.replace_bytes(text, input.selection(), "done");
        assert_eq!(edit.range, 0..text.len());
        assert_eq!(input.selection(), 4..4);
    }
}
