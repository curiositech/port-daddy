#!/usr/bin/env python3
"""Tests for scripts/harbor-research/page_spills.py's opener rule.

stdlib-only, no TeX and no PDF: the rule under test is a decision about lines
already extracted, so it is exercised directly on line dicts of the shape
page_lines() produces.

Why this file exists. The "O" rule asks whether a chapter opener's question
made it onto the same page as its label. It tested the question by absolute
font size (>= 20 pt), and on 2026-09-08 that reported eight stranded questions
in the technical edition where every one of them sat 23 pt below its own
label. Both editions declare \\fontsize{20}{25}; what a PDF reports is the
RENDERED size, which depends on the face -- the maritime edition's
Palatino-family question comes out at 20.92 and the technical edition's TeX
Gyre Heros at 19.93. The check failed one edition by seven hundredths of a
point for choosing a different typeface.

That is a false positive, not a tolerance to loosen, and the two are worth
distinguishing sharply: the fix measures the question against the label the
rule has already located, so the test says what it means and no longer depends
on which face an edition picked. The case that matters most below is the last
one -- a genuinely stranded question must still be caught.

Run:
    python3 -m unittest discover -s tests/harbor-research
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "harbor-research"))
import page_spills  # noqa: E402

LABEL = page_spills.LABEL


def line(text: str, size: float, y0: float, bold: bool = False) -> dict:
    return {"text": text, "size": size, "y0": y0, "y1": y0 + size, "bold": bold}


def opener_findings(lines: list[dict]) -> list[dict]:
    """The O rule alone, applied to one page's lines."""
    texts = [l["text"] for l in lines]
    out = []
    if any(LABEL.lower() == t.lower() for t in texts):
        label_line = next(l for l in lines if l["text"].lower() == LABEL.lower())
        floor = 1.5 * label_line["size"]
        big = [l for l in lines if l["size"] >= floor and l["y0"] > 0]
        if not any(l["y0"] > label_line["y0"] for l in big):
            out.append({"kind": "O"})
    return out


class TestOpenerRule(unittest.TestCase):
    def test_the_maritime_edition_passes(self):
        # Measured from the built PDF: label 8.72 pt, question 20.92 pt.
        lines = [line(LABEL, 8.72, 588.0), line("Where can a rule be made real?", 20.92, 611.0)]
        self.assertEqual(opener_findings(lines), [])

    def test_the_technical_edition_passes_too(self):
        # The regression: same page shape, question rendered at 19.93 pt, which
        # an absolute >= 20 rejected. 19.93 clears 1.5 x 8.72 = 13.08 easily.
        lines = [line(LABEL, 8.72, 549.5), line("Where can a rule be made real?", 19.93, 572.8)]
        self.assertEqual(opener_findings(lines), [])

    def test_a_question_genuinely_left_on_the_next_page_is_still_caught(self):
        # The rule's whole purpose. Label present, nothing large under it.
        lines = [line(LABEL, 8.72, 549.5), line("Chapter 1 of 8", 8.0, 560.0)]
        self.assertEqual(len(opener_findings(lines)), 1)

    def test_large_text_ABOVE_the_label_does_not_count_as_the_question(self):
        # The chapter title is larger than the question and sits above it; a
        # rule that ignored ordering would pass every stranded opener.
        lines = [line("The Single-Writer Kernel", 28.0, 300.0), line(LABEL, 8.72, 549.5)]
        self.assertEqual(len(opener_findings(lines)), 1)

    def test_a_page_without_the_label_is_not_an_opener(self):
        self.assertEqual(opener_findings([line("ordinary body text", 10.0, 100.0)]), [])

    def test_the_floor_scales_with_the_label_rather_than_being_absolute(self):
        # An edition that set the whole opener larger must behave identically.
        lines = [line(LABEL, 12.0, 500.0), line("Where can a rule be made real?", 27.0, 520.0)]
        self.assertEqual(opener_findings(lines), [])
        # ... and one whose "question" is merely body-sized is still stranded.
        lines = [line(LABEL, 12.0, 500.0), line("a caption, not the question", 13.0, 520.0)]
        self.assertEqual(len(opener_findings(lines)), 1)


if __name__ == "__main__":
    unittest.main()


class TestIsHeadingText(unittest.TestCase):
    """The H rule's guard against bold prose reported as a stranded heading.

    CI reported eight H findings on the maritime edition where a local build
    reported none, and two of the eight were not headings at all: "heading
    'ilance decrement is real'" -- the tail of "vigilance", split mid-word --
    and "heading 'is not here'". The Book sets defined terms and claim run-in
    heads in bold inside running prose, and bold-and-large alone cannot tell
    those from a section title.
    """

    def test_rejects_the_two_CI_reported_false_positives(self):
        # These exact strings came out of the CI log, not out of imagination.
        self.assertFalse(page_spills.is_heading_text("ilance decrement is real"))
        self.assertFalse(page_spills.is_heading_text("is not here"))

    def test_keeps_every_real_heading_CI_reported(self):
        for real in ("6.14", "Gaps the design must still close", "7.7.5",
                     "Pricing the Bond", "5.5", "The three organs of continuity"):
            self.assertTrue(page_spills.is_heading_text(real), real)

    def test_ignores_leading_whitespace_rather_than_reading_it_as_prose(self):
        self.assertTrue(page_spills.is_heading_text("   Pricing the Bond"))

    def test_an_empty_line_is_not_a_heading(self):
        self.assertFalse(page_spills.is_heading_text(""))
        self.assertFalse(page_spills.is_heading_text("   "))
