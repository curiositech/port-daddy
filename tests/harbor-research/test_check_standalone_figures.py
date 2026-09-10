#!/usr/bin/env python3
r"""Tests for scripts/harbor-research/check_standalone_figures.py and the
standalone_branch scanner it shares with check_duplicate_figures.py.

stdlib-only, no TeX. The cases are the one that happened -- a Book-side edit
that moved five \input lines out of what the standalone paper compiles -- and
the shapes that must NOT trip it: an \input the Book skips but the paper keeps
(the \else branch), apparatus every chapter loads, a commented-out input, and
a nested conditional inside the branch.

Run:
    python3 -m unittest discover -s tests/harbor-research
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "harbor-research"))
import check_duplicate_figures as cdf  # noqa: E402
import check_standalone_figures as csf  # noqa: E402

TWIN = (
    "\\input{figures/pd-palette}\n"
    "Prose before.\n"
    "\\ifpdbook\n"
    "The ceremony is drawn in \\pdchapref{fh}{The Federated Harbor}.\n"
    "\\else\n"
    "\\input{figures/fig-fh-xfer-ceremony}%\n"
    "The four-message ceremony (Figure~\\ref{fig:fh-xfer})\n"
    "\\fi\n"
    "\\input{figures/fig-he-three-sided}\n"
    "\\begin{figure}[t]\\centering inline\\end{figure}\n"
    "\\begin{table*}[t] wide \\end{table*}\n"
    "% \\input{figures/fig-retired}\n"
)


class TestStandaloneBranch(unittest.TestCase):
    def test_the_two_sides_of_a_conditional_are_complements(self):
        # Whitespace around a branch is kept either way; the words are what
        # matter, so compare the token streams.
        text = "a \\ifpdbook BOOK \\else PAPER \\fi z"
        self.assertEqual(cdf.book_branch(text).split(), ["a", "BOOK", "z"])
        self.assertEqual(cdf.standalone_branch(text).split(), ["a", "PAPER", "z"])

    def test_a_conditional_with_no_else_leaves_the_paper_nothing(self):
        text = "a \\ifpdbook BOOK \\fi z"
        self.assertEqual(cdf.standalone_branch(text).split(), ["a", "z"])

    def test_a_nested_conditional_inside_the_paper_branch_survives_whole(self):
        text = "\\ifpdbook B \\else \\ifnum1=1 one\\else two\\fi \\fi"
        self.assertEqual(cdf.standalone_branch(text).strip(), "\\ifnum1=1 one\\else two\\fi")

    def test_text_outside_any_conditional_is_untouched(self):
        self.assertEqual(cdf.standalone_branch("no conditionals here"), "no conditionals here")


class TestSurvey(unittest.TestCase):
    def test_the_paper_keeps_what_the_book_skips(self):
        got = csf.survey(TWIN, skip={"pd-palette"})
        self.assertEqual(got["inputs"], ["fig-fh-xfer-ceremony", "fig-he-three-sided"])
        self.assertEqual(got["inline_figures"], 1)
        self.assertEqual(got["inline_tables"], 1)

    def test_apparatus_is_not_a_drawing(self):
        self.assertNotIn("pd-palette", csf.survey(TWIN, skip={"pd-palette"})["inputs"])
        self.assertIn("pd-palette", csf.survey(TWIN)["inputs"])

    def test_a_commented_out_input_is_not_a_site(self):
        self.assertNotIn("fig-retired", csf.survey(TWIN)["inputs"])

    def test_the_book_edit_that_happened_removes_the_site_from_the_paper(self):
        # The defective edit: the \input moved into prose that points at
        # another chapter, with no \else to keep it for the paper.
        broken = TWIN.replace(
            "\\ifpdbook\nThe ceremony is drawn in \\pdchapref{fh}{The Federated Harbor}.\n"
            "\\else\n\\input{figures/fig-fh-xfer-ceremony}%\n"
            "The four-message ceremony (Figure~\\ref{fig:fh-xfer})\n\\fi\n",
            "The ceremony is drawn in \\pdchapref{fh}{The Federated Harbor}.\n",
        )
        before = csf.survey(TWIN, skip={"pd-palette"})
        after = csf.survey(broken, skip={"pd-palette"})
        diff = csf.compare(before, after)
        self.assertEqual(len(diff), 1)
        self.assertIn("lost", diff[0])
        self.assertIn("fig-fh-xfer-ceremony", diff[0])


class TestCompare(unittest.TestCase):
    def test_agreement_is_silent(self):
        got = csf.survey(TWIN, skip={"pd-palette"})
        self.assertEqual(csf.compare(got, got), [])

    def test_a_gained_site_is_reported_as_a_stale_record_not_a_loss(self):
        got = csf.survey(TWIN, skip={"pd-palette"})
        more = dict(got, inputs=got["inputs"] + ["fig-new"], inline_tables=got["inline_tables"] + 1)
        diff = csf.compare(got, more)
        self.assertEqual(len(diff), 2)
        self.assertTrue(all(line.startswith("gained") for line in diff))

    def test_a_lost_inline_figure_counts_too(self):
        got = csf.survey(TWIN, skip={"pd-palette"})
        fewer = dict(got, inline_figures=0)
        diff = csf.compare(got, fewer)
        self.assertEqual(len(diff), 1)
        self.assertIn("lost", diff[0])
        self.assertIn("figures", diff[0])


class TestTheCommittedRecord(unittest.TestCase):
    def test_the_record_names_every_chapter_textbook_json_does(self):
        record = json.loads((REPO_ROOT / "whitepaper/standalone-figures.json").read_text(encoding="utf-8"))
        chapter_ids = {cid for _n, cid, _src in cdf.chapters()}
        self.assertEqual(set(record["papers"]), chapter_ids)

    def test_every_recorded_paper_has_at_least_one_figure_site(self):
        # A submission paper with no figures at all would be a regression this
        # check exists to catch, and a row of zeros would pass it silently.
        record = json.loads((REPO_ROOT / "whitepaper/standalone-figures.json").read_text(encoding="utf-8"))
        for cid, row in record["papers"].items():
            self.assertGreater(len(row["inputs"]) + row["inline_figures"] + row["inline_tables"], 0, cid)


if __name__ == "__main__":
    unittest.main()
