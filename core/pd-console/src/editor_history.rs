//! Input intent decides undo boundaries; Loro owns the actual operation stacks.
//! No private text snapshots, second undo stack, timers or networking here.

use crate::editor_input::EditorInput;
use std::ops::Range;
use std::time::{Duration, Instant};
use unicode_segmentation::UnicodeSegmentation;

const TYPING_GAP: Duration = Duration::from_millis(750);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InputKind {
    Typing,
    Backspace,
    DeleteForward,
    Composition,
    /// Paste, cut, newline, indentation and programmatic replacements.
    Isolated,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GroupKind {
    Typing,
    Backspace,
    DeleteForward,
    Composition,
}

#[derive(Clone, Debug)]
struct OpenGroup {
    kind: GroupKind,
    caret: usize,
    marked: Option<Range<usize>>,
    at: Instant,
    frontier: Vec<u8>,
    import_generation: u64,
}

#[derive(Default)]
pub struct InputHistory {
    open: Option<OpenGroup>,
}

pub struct GroupPlan {
    pub continue_group: bool,
    pub open_group: bool,
    next: Option<OpenGroup>,
}

impl InputHistory {
    pub fn clear(&mut self) {
        self.open = None;
    }

    /// Pure preflight. Call only after edit/claim validation; commit this plan
    /// only after the corresponding authored replacement has succeeded.
    pub fn plan(
        &self,
        kind: InputKind,
        range: &Range<usize>,
        replacement: &str,
        before: &str,
        input: &EditorInput,
        after_input: &EditorInput,
        at: Instant,
        frontier: &[u8],
        import_generation: u64,
    ) -> GroupPlan {
        let selection = input.selection();
        let marked = input.marked_range();
        let finishing_composition = kind == InputKind::Typing && marked.is_some();
        let composition = kind == InputKind::Composition || finishing_composition;
        let group = if composition {
            Some(GroupKind::Composition)
        } else if selection.is_empty() && marked.is_none() {
            match kind {
                InputKind::Typing
                    if range.is_empty()
                        && range.start == selection.start
                        && replacement.graphemes(true).count() == 1
                        && !replacement.chars().any(char::is_whitespace) =>
                {
                    Some(GroupKind::Typing)
                }
                InputKind::Backspace
                    if replacement.is_empty()
                        && !range.is_empty()
                        && range.end == selection.start
                        && !before[range.clone()].chars().any(char::is_whitespace) =>
                {
                    Some(GroupKind::Backspace)
                }
                InputKind::DeleteForward
                    if replacement.is_empty()
                        && !range.is_empty()
                        && range.start == selection.start
                        && !before[range.clone()].chars().any(char::is_whitespace) =>
                {
                    Some(GroupKind::DeleteForward)
                }
                _ => None,
            }
        } else {
            None
        };
        let continue_group = self.open.as_ref().is_some_and(|previous| {
            let timely = at
                .checked_duration_since(previous.at)
                .is_some_and(|elapsed| elapsed <= TYPING_GAP);
            let adjacent = if composition {
                // A replacement elsewhere cannot inherit another composition.
                marked.as_ref() == Some(range) && previous.marked.as_ref() == Some(range)
            } else {
                selection.is_empty() && selection.start == previous.caret && timely
            };
            Some(previous.kind) == group
                && adjacent
                && previous.frontier == frontier
                && previous.import_generation == import_generation
        });
        let next = group
            .filter(|_| !finishing_composition)
            .map(|kind| OpenGroup {
                kind,
                caret: after_input.cursor(),
                marked: after_input.marked_range(),
                at,
                frontier: Vec::new(),
                import_generation,
            });
        GroupPlan {
            continue_group,
            open_group: group.is_some(),
            next,
        }
    }

    pub fn commit(&mut self, mut plan: GroupPlan, frontier: Vec<u8>) -> bool {
        if let Some(next) = plan.next.as_mut() {
            next.frontier = frontier;
        }
        self.open = plan.next;
        self.open.is_some()
    }
}
