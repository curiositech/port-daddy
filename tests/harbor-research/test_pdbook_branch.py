#!/usr/bin/env python3
r"""Tests for the \ifpdbook branch scanner in
scripts/harbor-research/check_duplicate_figures.py.

These four cases were the first class of tests/harbor-research/test_check_
standalone_figures.py, which went with check_standalone_figures.py when the
per-chapter PDFs were retired. The scanner did not go with it: the duplicate
checks still depend on it. `book_branch` is what check_duplicate_figures.py and
check_duplicate_theorems.py actually count -- an \input or a \label sitting in
the \else branch is not in the Book and must not be counted as a Book duplicate
-- so the scanner needs coverage on its own, and this is it.

`standalone_branch` is the other side of the same scanner. Nothing compiles
that side any more, so the complement case below is what keeps the two halves
honest about each other.

stdlib-only, no TeX.

Run:
    python3 -m unittest discover -s tests/harbor-research
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "harbor-research"))
import check_duplicate_figures as cdf  # noqa: E402


class TestPdbookBranch(unittest.TestCase):
    def test_the_two_sides_of_a_conditional_are_complements(self):
        # Whitespace around a branch is kept either way; the words are what
        # matter, so compare the token streams.
        text = "a \\ifpdbook BOOK \\else PAPER \\fi z"
        self.assertEqual(cdf.book_branch(text).split(), ["a", "BOOK", "z"])
        self.assertEqual(cdf.standalone_branch(text).split(), ["a", "PAPER", "z"])

    def test_a_conditional_with_no_else_leaves_the_other_side_nothing(self):
        text = "a \\ifpdbook BOOK \\fi z"
        self.assertEqual(cdf.standalone_branch(text).split(), ["a", "z"])
        self.assertEqual(cdf.book_branch(text).split(), ["a", "BOOK", "z"])

    def test_a_nested_conditional_inside_a_branch_survives_whole(self):
        text = "\\ifpdbook B \\else \\ifnum1=1 one\\else two\\fi \\fi"
        self.assertEqual(cdf.standalone_branch(text).strip(), "\\ifnum1=1 one\\else two\\fi")

    def test_text_outside_any_conditional_is_untouched(self):
        self.assertEqual(cdf.standalone_branch("no conditionals here"), "no conditionals here")
        self.assertEqual(cdf.book_branch("no conditionals here"), "no conditionals here")


if __name__ == "__main__":
    unittest.main()
