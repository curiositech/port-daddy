#!/usr/bin/env python3
r"""Tests for scripts/harbor-research/captions_to_margin.py.

stdlib-only, no TeX. The converter decides, per \caption and per \footnote,
whether moving it to the margin would point the reader at the wrong content --
and every one of those decisions is a silent judgement about LaTeX structure
made by regex over a masked string. A misread float boundary does not raise; it
quietly leaves a caption in the text column, or worse, moves one that should
have stayed. The script had no test, so the cases below are the ones where
being wrong is invisible in the output.

Two things are worth stating about what is asserted here.

The carve-outs are asserted as carve-outs. The module docstring is emphatic
that the 7 residual \caption calls in the Book are structural and that a later
pass "finishing the job" is a regression. A test that only checked "everything
converts" would be a licence for exactly that regression, so the longtable and
full-bleed skips are pinned with their reasons.

The corpus assertion is non-vacuous on purpose. The docstring states a measured
end state -- 7 \caption and 54 \pdmargincaption across the eight chapters in
textbook.json. Nothing checked it. A scanner pointed at zero files also reports
zero convertibles, so the test asserts the chapter count and the
\pdmargincaption count as well as the residual.

Run:
    python3 -m unittest discover -s tests/harbor-research
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "harbor-research"))
import captions_to_margin as c2m  # noqa: E402


def convert(text: str) -> str:
    """The whole pipeline over one string: scan, then rewrite."""
    mask = c2m.mask_comments(text)
    return c2m.rewrite(text, c2m.scan_captions(text, mask), c2m.scan_footnotes(text, mask))


def captions(text: str):
    return c2m.scan_captions(text, c2m.mask_comments(text))


def footnotes(text: str):
    return c2m.scan_footnotes(text, c2m.mask_comments(text))


class TestMaskComments(unittest.TestCase):
    def test_the_mask_preserves_length_and_line_numbers(self):
        # Offsets found on the mask address the same characters in the
        # original, so any drift here silently moves every edit.
        text = "a % comment\n\\caption{x}\n"
        mask = c2m.mask_comments(text)
        self.assertEqual(len(mask), len(text))
        self.assertEqual(mask.count("\n"), text.count("\n"))
        self.assertNotIn("comment", mask)

    def test_a_commented_out_caption_is_not_found(self):
        self.assertEqual(captions("\\begin{figure}\n% \\caption{ghost}\n\\end{figure}\n"), [])

    def test_an_escaped_percent_does_not_start_a_comment(self):
        # "\%" is a literal percent; treating it as a comment would blank the
        # rest of the line and hide a real caption.
        found = captions("\\begin{figure}\n\\includegraphics{a}\n\\caption{50\\% of runs}\n\\end{figure}\n")
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["action"], "convert")
        self.assertIn("50", found[0]["text"])


class TestBalancedGroup(unittest.TestCase):
    def test_a_nested_group_is_captured_whole(self):
        inner, end = c2m.balanced_group("{a \\emph{b} c}", 0)
        self.assertEqual(inner, "a \\emph{b} c")
        self.assertEqual(end, 14)

    def test_an_escaped_brace_does_not_close_the_group(self):
        inner, _ = c2m.balanced_group("{a \\{ b}", 0)
        self.assertEqual(inner, "a \\{ b")

    def test_an_unbalanced_group_returns_none_rather_than_guessing(self):
        self.assertIsNone(c2m.balanced_group("{a b", 0))

    def test_an_unbalanced_caption_is_skipped_not_converted(self):
        found = captions("\\begin{figure}\n\\caption{never closed\n\\end{figure}\n")
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["action"], "skip")
        self.assertIn("unbalanced", found[0]["reason"])


class TestEnvironmentStack(unittest.TestCase):
    def test_the_stack_is_outermost_first(self):
        text = "\\begin{figure}\n\\begin{tikzpicture}\nX"
        self.assertEqual(c2m.env_stack_at(text, text.index("X")),
                         ["figure", "tikzpicture"])

    def test_a_closed_environment_leaves_the_stack(self):
        text = "\\begin{figure}\n\\begin{tabular}{l}a\\end{tabular}\nX"
        self.assertEqual(c2m.env_stack_at(text, text.index("X")), ["figure"])

    def test_a_stray_end_for_an_unopened_environment_is_ignored(self):
        # An \end with no \begin must not pop a real enclosing environment;
        # doing so would make a caption look like it sits outside its float.
        text = "\\begin{figure}\n\\end{center}\nX"
        self.assertEqual(c2m.env_stack_at(text, text.index("X")), ["figure"])


class TestFloatDetection(unittest.TestCase):
    def test_a_placement_specifier_is_not_content(self):
        # Without stepping past "[H]" the at-top test sees it as body content
        # and foot-anchors every caption in the Book.
        text = "\\begin{figure}[H]\n\\caption{c}\n\\includegraphics{a}\n\\end{figure}\n"
        found = captions(text)
        self.assertEqual(found[0]["action"], "convert")
        self.assertTrue(found[0]["at_top"])

    def test_a_starred_float_is_still_a_float(self):
        found = captions("\\begin{figure*}\n\\caption{c}\n\\end{figure*}\n")
        self.assertEqual(found[0]["action"], "convert")
        self.assertEqual(found[0]["env"], "figure")

    def test_the_innermost_caption_bearing_environment_wins(self):
        text = ("\\begin{figure}\n\\begin{table}\n\\includegraphics{a}\n"
                "\\caption{c}\n\\end{table}\n\\end{figure}\n")
        self.assertEqual(captions(text)[0]["env"], "table")

    def test_a_caption_outside_any_float_is_skipped(self):
        found = captions("Running prose.\n\\caption{orphan}\n")
        self.assertEqual(found[0]["action"], "skip")
        self.assertIn("outside any caption-bearing environment", found[0]["reason"])

    def test_a_short_title_caption_is_skipped_because_the_slot_means_something_else(self):
        # \pdmargincaption's optional argument is the anchor, not a
        # list-of-floats short title; converting would silently repurpose it.
        found = captions("\\begin{figure}\n\\caption[short]{full}\n\\end{figure}\n")
        self.assertEqual(found[0]["action"], "skip")
        self.assertIn("short title", found[0]["reason"])


class TestTheCarveOuts(unittest.TestCase):
    """The two reasons a caption is allowed to stay in the text column.

    The module docstring calls a later pass that "finishes the job" on these a
    regression, not a completion. Pinned here so it reads as one.
    """

    def test_a_longtable_caption_stays_put(self):
        text = "\\begin{xltabular}{\\textwidth}{ll}\n\\caption{spans pages}\\\\\na & b\n\\end{xltabular}\n"
        found = captions(text)
        self.assertEqual(found[0]["action"], "skip")
        self.assertEqual(found[0]["env"], "xltabular")
        self.assertIn("spans pages", found[0]["reason"])

    def test_every_longtable_family_environment_carves_out(self):
        for env in c2m.LONGTABLE_ENVS:
            with self.subTest(env=env):
                text = f"\\begin{{{env}}}{{\\textwidth}}{{ll}}\n\\caption{{c}}\\\\\n\\end{{{env}}}\n"
                self.assertEqual(captions(text)[0]["action"], "skip")

    def test_a_full_bleed_float_carves_out(self):
        text = ("\\begin{figure}\n\\begin{adjustwidth}{}{-\\marginparwidth}\n"
                "\\includegraphics{a}\n\\end{adjustwidth}\n\\caption{wide}\n\\end{figure}\n")
        found = captions(text)
        self.assertEqual(found[0]["action"], "skip")
        self.assertIn("no margin beside it", found[0]["reason"])

    def test_a_carved_out_caption_is_left_verbatim_by_rewrite(self):
        text = "\\begin{xltabular}{\\textwidth}{ll}\n\\caption{spans pages}\\\\\n\\end{xltabular}\n"
        self.assertEqual(convert(text), text)


class TestThePreambleCheck(unittest.TestCase):
    """at_top decides rename-in-place versus cut-and-move, and it is the whole
    reason the caption is safe: \\pdmargincaption hangs downward from the line
    that issues it, so a caption below its content must be moved, not bent."""

    def test_centering_and_type_size_do_not_count_as_content(self):
        text = "\\begin{figure}\n\\centering\\small\n\\caption{c}\n\\includegraphics{a}\n\\end{figure}\n"
        self.assertTrue(captions(text)[0]["at_top"])

    def test_arraystretch_does_not_count_as_content(self):
        text = "\\begin{table}\n\\renewcommand{\\arraystretch}{1.2}\n\\caption{c}\n\\end{table}\n"
        self.assertTrue(captions(text)[0]["at_top"])

    def test_a_graphic_before_the_caption_does_count_as_content(self):
        text = "\\begin{figure}\n\\includegraphics{a}\n\\caption{c}\n\\end{figure}\n"
        found = captions(text)
        self.assertFalse(found[0]["at_top"])
        self.assertIn("moved to the float's top", found[0]["reason"])

    def test_a_tikzpicture_before_the_caption_does_count_as_content(self):
        text = "\\begin{figure}\n\\begin{tikzpicture}\\end{tikzpicture}\n\\caption{c}\n\\end{figure}\n"
        self.assertFalse(captions(text)[0]["at_top"])


class TestRewrite(unittest.TestCase):
    def test_a_caption_already_at_the_top_is_renamed_in_place(self):
        out = convert("\\begin{figure}\n\\caption{c}\n\\includegraphics{a}\n\\end{figure}\n")
        self.assertEqual(out, "\\begin{figure}\n\\pdmargincaption{c}\n\\includegraphics{a}\n\\end{figure}\n")

    def test_a_caption_below_its_content_is_moved_to_the_top(self):
        out = convert("\\begin{figure}\n\\includegraphics{a}\n\\caption{c}\n\\end{figure}\n")
        self.assertIn("\\pdmargincaption{c}", out)
        # It now precedes the graphic rather than following it.
        self.assertLess(out.index("\\pdmargincaption"), out.index("\\includegraphics"))
        self.assertNotIn("\\caption{", out)

    def test_a_moved_caption_carries_its_label(self):
        # If the \label does not travel, \ref resolves to whatever precedes the
        # caption's new home -- a silently wrong cross-reference.
        out = convert("\\begin{figure}\n\\includegraphics{a}\n\\caption{c}\\label{fig:x}\n\\end{figure}\n")
        self.assertIn("\\pdmargincaption{c}\\label{fig:x}", out)
        self.assertEqual(out.count("\\label{fig:x}"), 1)

    def test_moving_a_caption_leaves_no_blank_line_behind(self):
        # A blank line inside a float ends its paragraph and changes the
        # layout, which is why the cut takes the caption's newline with it.
        out = convert("\\begin{figure}\n\\includegraphics{a}\n\\caption{c}\n\\end{figure}\n")
        self.assertNotIn("\n\n", out)

    def test_two_captions_in_one_file_are_both_converted(self):
        # The edits are applied right to left; if that ordering were wrong the
        # second splice would land at a stale offset.
        text = ("\\begin{figure}\n\\includegraphics{a}\n\\caption{one}\n\\end{figure}\n"
                "\\begin{figure}\n\\includegraphics{b}\n\\caption{two}\n\\end{figure}\n")
        out = convert(text)
        self.assertIn("\\pdmargincaption{one}", out)
        self.assertIn("\\pdmargincaption{two}", out)
        self.assertNotIn("\\caption{", out)

    def test_conversion_is_idempotent(self):
        text = "\\begin{figure}\n\\includegraphics{a}\n\\caption{c}\n\\end{figure}\n"
        once = convert(text)
        self.assertEqual(convert(once), once)


class TestFootnotes(unittest.TestCase):
    def test_a_footnote_in_running_prose_becomes_a_sidenote(self):
        out = convert("The claim holds.\\footnote{Except at $\\delta=0$.}\n")
        self.assertIn("\\pdsidenote{Except at $\\delta=0$.}", out)

    def test_a_footnote_inside_a_table_is_skipped(self):
        # A margin note issued inside a box anchors to the box, not the
        # sentence, and would point the reader at the wrong content.
        found = footnotes("\\begin{tabular}{l}\na\\footnote{note}\n\\end{tabular}\n")
        self.assertEqual(found[0]["action"], "skip")
        self.assertIn("tabular", found[0]["reason"])

    def test_a_footnote_in_a_heading_title_is_skipped(self):
        # A heading title is a moving argument written to the .toc and .aux; a
        # margin device expanded there breaks the build.
        found = footnotes("\\section{A title\\footnote{note}}\n")
        self.assertEqual(found[0]["action"], "skip")
        self.assertIn("moving", found[0]["reason"])

    def test_a_footnote_inside_another_margin_device_is_skipped(self):
        found = footnotes("\\pdsidenote{already a note\\footnote{nested}}\n")
        self.assertEqual(found[0]["action"], "skip")
        self.assertIn("another margin device", found[0]["reason"])

    def test_a_footnote_with_an_explicit_mark_is_skipped(self):
        found = footnotes("prose\\footnote[3]{marked}\n")
        self.assertEqual(found[0]["action"], "skip")
        self.assertIn("explicit mark", found[0]["reason"])

    def test_every_no_margin_environment_blocks_a_footnote(self):
        for env in c2m.NO_MARGIN_ENVS:
            with self.subTest(env=env):
                text = f"\\begin{{{env}}}\na\\footnote{{n}}\n\\end{{{env}}}\n"
                self.assertEqual(footnotes(text)[0]["action"], "skip")


class TestAgainstTheRealCorpus(unittest.TestCase):
    """The measured end state the module docstring asserts, actually measured."""

    def setUp(self):
        self.sources = c2m.default_chapter_sources()

    def test_the_scanner_reaches_the_eight_chapters(self):
        # A scanner pointed at nothing also reports nothing convertible.
        self.assertEqual(len(self.sources), 8)
        total = sum(len(Path(p).read_text(encoding="utf-8")) for p in self.sources)
        self.assertGreater(total, 500_000)

    def test_the_conversion_is_complete_and_the_residual_is_exactly_the_carve_out(self):
        residual = []
        for path in self.sources:
            text, caps, _ = c2m.process(path)
            for c in caps:
                self.assertEqual(
                    c["action"], "skip",
                    f"{path}:{c['line']} is still convertible -- the corpus has drifted "
                    "from the measured end state, or a chapter was edited without a re-run")
                residual.append(c)
        # All 7 residuals are the longtable family. Zero full-bleed, as recorded.
        self.assertEqual(len(residual), 7)
        self.assertTrue(all(r.get("env") in c2m.LONGTABLE_ENVS for r in residual),
                        [r.get("env") for r in residual])

    def test_the_chapters_carry_the_recorded_number_of_margin_captions(self):
        # Pins the other half of the count: 7 residual is only good news if the
        # 54 that converted are still there.
        import re
        total = 0
        for path in self.sources:
            mask = c2m.mask_comments(Path(path).read_text(encoding="utf-8"))
            total += len(re.findall(r"\\pdmargincaption(?![A-Za-z@])", mask))
        self.assertEqual(total, 54)

    def test_re_running_the_converter_over_the_corpus_is_a_no_op(self):
        # The conversion has already been applied; running it again must not
        # move anything. This is what makes --fix safe to re-run.
        for path in self.sources:
            text, caps, fns = c2m.process(path)
            self.assertEqual(c2m.rewrite(text, caps, fns), text, path)


if __name__ == "__main__":
    unittest.main()
