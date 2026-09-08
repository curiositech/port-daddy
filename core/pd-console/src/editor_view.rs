//! Renderer-free geometry for wrapped Harbor Editor views.
//!
//! Logical lines and Loro byte positions remain unchanged. These helpers only
//! map them to fixed-height visual rows for GPUI virtualization and hit tests.

use unicode_segmentation::UnicodeSegmentation;

pub const BLAME_COL_CHARS: f32 = 23.0;

/// Split a logical line into contiguous, grapheme-safe byte ranges. Prefer a
/// whitespace boundary within the available width, but never emit an empty
/// segment and never trim document bytes.
pub fn wrap_byte_ranges(text: &str, max_columns: usize) -> Vec<std::ops::Range<usize>> {
    if text.is_empty() {
        return vec![0..0];
    }
    let max_columns = max_columns.max(1);
    let mut boundaries = text
        .grapheme_indices(true)
        .map(|(byte, _)| byte)
        .collect::<Vec<_>>();
    boundaries.push(text.len());
    let graphemes = boundaries.len() - 1;
    let mut ranges = Vec::new();
    let mut start = 0usize;
    while start < graphemes {
        let hard_end = (start + max_columns).min(graphemes);
        let mut end = hard_end;
        if hard_end < graphemes {
            for candidate in (start + 1..=hard_end).rev() {
                let grapheme = &text[boundaries[candidate - 1]..boundaries[candidate]];
                if grapheme.chars().all(char::is_whitespace) {
                    end = candidate;
                    break;
                }
            }
        }
        if end == start {
            end = (start + 1).min(graphemes);
        }
        ranges.push(boundaries[start]..boundaries[end]);
        start = end;
    }
    ranges
}

pub fn editor_gutter_px(gutter_cols: f32, show_blame: bool) -> f32 {
    2.0 + 6.0
        + gutter_cols * crate::tokens::CODE_CH
        + 8.0
        + 2.0 * crate::tokens::CODE_CH
        + 6.0
        + if show_blame {
            BLAME_COL_CHARS * crate::tokens::CODE_CH + 8.0
        } else {
            0.0
        }
}

pub fn editor_wrap_columns(width: f32, gutter_cols: f32, show_blame: bool) -> usize {
    ((width - editor_gutter_px(gutter_cols, show_blame) - 8.0) / crate::tokens::CODE_CH)
        .floor()
        .max(12.0) as usize
}

pub fn editor_text_layout(
    text: &str,
    width: f32,
    wrap_lines: bool,
    show_blame: bool,
) -> (f32, Option<usize>) {
    let gutter_cols = text.split('\n').count().max(1).to_string().len() as f32;
    let gutter_px = editor_gutter_px(gutter_cols, show_blame);
    let wrap_columns = wrap_lines.then(|| editor_wrap_columns(width, gutter_cols, show_blame));
    (gutter_px, wrap_columns)
}

pub fn editor_hit_position(
    text: &str,
    visual_row: usize,
    segment_column: usize,
    wrap_columns: Option<usize>,
) -> Option<(usize, usize)> {
    let mut row = 0usize;
    for (line_index, line) in text.split('\n').enumerate() {
        let ranges = wrap_columns
            .map(|columns| wrap_byte_ranges(line, columns))
            .unwrap_or_else(|| vec![0..line.len()]);
        for range in ranges {
            if row == visual_row {
                let prefix = line[..range.start].graphemes(true).count();
                let segment_len = line[range].graphemes(true).count();
                return Some((line_index, prefix + segment_column.min(segment_len)));
            }
            row += 1;
        }
    }
    None
}

pub fn editor_visual_position_for_byte(
    text: &str,
    byte: usize,
    wrap_columns: Option<usize>,
) -> (usize, usize) {
    let byte = byte.min(text.len());
    let mut row = 0usize;
    let mut line_start = 0usize;
    for line in text.split('\n') {
        let line_end = line_start + line.len();
        let local = byte.saturating_sub(line_start).min(line.len());
        let ranges = wrap_columns
            .map(|columns| wrap_byte_ranges(line, columns))
            .unwrap_or_else(|| vec![0..line.len()]);
        let final_segment = ranges.len().saturating_sub(1);
        for (segment, range) in ranges.into_iter().enumerate() {
            let contains = local >= range.start
                && (local < range.end || (segment == final_segment && local == range.end));
            if byte <= line_end && contains {
                return (
                    row,
                    line[range.start..local.min(range.end)]
                        .graphemes(true)
                        .count(),
                );
            }
            row += 1;
        }
        line_start = line_end.saturating_add(1);
    }
    (row.saturating_sub(1), 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrapping_is_grapheme_safe_and_preserves_every_byte() {
        let text = "alpha 👨‍👩‍👧‍👦 beta gamma";
        let ranges = wrap_byte_ranges(text, 8);
        let rebuilt = ranges
            .iter()
            .map(|range| &text[range.clone()])
            .collect::<String>();

        assert_eq!(rebuilt, text);
        assert!(ranges.len() > 1);
        for range in ranges {
            assert!(text.is_char_boundary(range.start));
            assert!(text.is_char_boundary(range.end));
        }
    }

    #[test]
    fn wrapped_hit_testing_maps_visual_rows_back_to_logical_text() {
        let text = "abcdefghij\nshort";
        assert_eq!(editor_hit_position(text, 1, 2, Some(4)), Some((0, 6)));
        assert_eq!(editor_hit_position(text, 3, 3, Some(4)), Some((1, 3)));
        assert_eq!(editor_visual_position_for_byte(text, 6, Some(4)), (1, 2));
    }

    #[test]
    fn narrow_layout_keeps_a_minimum_editable_text_width() {
        assert_eq!(editor_wrap_columns(80.0, 4.0, true), 12);
        assert!(editor_gutter_px(4.0, true) > editor_gutter_px(4.0, false));
    }
}
