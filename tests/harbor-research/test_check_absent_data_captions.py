#!/usr/bin/env python3
r"""Tests for scripts/harbor-research/check_absent_data_captions.py.

stdlib-only, no TeX: the brace-counting caption scanner is fed the shapes a real
caption takes (\ref, \texttt, math, nested braces, an optional short caption,
a commented-out caption), and the finder is fed the caption that once
shipped -- Figure 4.5's "The committed sweep CSV (r1-floor.csv) is not yet
present" -- beside the honest boundary prose the check must leave alone.

That caption is history. The R1 sweep CSV is now committed at
whitepaper/figures/data/r1-floor.csv, the caption states what the measurement
shows, and the CI step runs with no --allow. The corpus test therefore asserts
the corpus is *clean* rather than pinning one known debt.

The mutation tests are the point: a check that cannot be made to fail is not
evidence of anything. So the synthetic fixtures still prove the finder fires on
the shipped phrasing and stays quiet on honest scope prose; a second apology in
an already-excepted file is asserted to still fail; the scanner is asserted to
have actually read the corpus's captions, since a scanner that read nothing
would also report nothing and look just as green; and the paid debt is guarded
from the dishonest fix -- deleting the sentence without committing the data --
by asserting the CSV exists and the figure cites it.

Run:
    python3 -m unittest discover -s tests/harbor-research
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "harbor-research"))
import check_absent_data_captions as cadc  # noqa: E402

REAL = "whitepaper/figures/legible-swarm-readpoverty.tex"


class TestCaptionScanner(unittest.TestCase):
    def test_a_caption_with_nested_braces_ends_at_its_own_close(self):
        text = "\\caption{Bits at \\texttt{m{=}8}, see Thm.~\\ref{thm:x}.}\n\\label{fig:y}\n"
        self.assertEqual([c for _, c in cadc.captions(text)],
                         ["Bits at \\texttt{m{=}8}, see Thm.~\\ref{thm:x}."])

    def test_an_escaped_brace_does_not_close_the_caption(self):
        text = "\\caption{A set \\{1,2\\} of readers.}\n"
        self.assertEqual([c for _, c in cadc.captions(text)], ["A set \\{1,2\\} of readers."])

    def test_an_optional_short_caption_is_skipped(self):
        text = "\\caption[Short]{The long one.}\n"
        self.assertEqual([c for _, c in cadc.captions(text)], ["The long one."])

    def test_a_starred_caption_counts(self):
        self.assertEqual([c for _, c in cadc.captions("\\caption*{Unnumbered.}\n")], ["Unnumbered."])

    def test_a_commented_out_caption_is_not_a_caption(self):
        self.assertEqual(list(cadc.captions("% \\caption{Old draft, not committed.}\n")), [])

    def test_the_line_number_is_the_caption_s_own(self):
        text = "one\ntwo\n\\caption{Three.}\n"
        self.assertEqual([ln for ln, _ in cadc.captions(text)], [3])


class TestFindAbsent(unittest.TestCase):
    def write(self, body):
        # find_absent reports paths relative to the repo root, so the fixture
        # has to live under it; a temp file elsewhere would raise instead.
        fd, name = tempfile.mkstemp(dir=REPO_ROOT, suffix=".tex")
        os.close(fd)
        p = Path(name)
        self.made.append(p)
        p.write_text(body, encoding="utf-8")
        return p

    def setUp(self):
        self.made = []

    def tearDown(self):
        for p in self.made:
            p.unlink(missing_ok=True)

    def test_the_caption_that_shipped_is_reported(self):
        p = self.write("\\caption{At $N{=}60$ the split digest costs 5.98 bits. The "
                       "committed sweep CSV (\\texttt{r1-floor.csv}) is not yet present, "
                       "so the curves are closed-form.}\n")
        found = cadc.find_absent([p])
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0][2], "not yet present")

    def test_honest_boundary_prose_about_scope_is_left_alone(self):
        # The sentence the Book wants in a caption: a limit on what the drawing
        # covers, not an admission that its data is missing.
        p = self.write("\\caption{The sweep does not cover heavy-tailed service, and the "
                       "crossing is not measured outside the exponential model.}\n")
        self.assertEqual(cadc.find_absent([p]), [])

    def test_the_phrase_is_matched_across_a_line_break(self):
        p = self.write("\\caption{The sweep CSV is not yet\npresent, so this is analytic.}\n")
        self.assertEqual(len(cadc.find_absent([p])), 1)

    def test_a_recorded_exception_clears_that_file_and_phrase_only(self):
        p = self.write("\\caption{The CSV is not committed.}\n"
                       "\\caption{The run has not been run.}\n")
        rel = str(p.relative_to(cadc.REPO))
        found = cadc.find_absent([p], allow={f"{rel}:not committed"})
        self.assertEqual([f[2] for f in found], ["has not been run"])


class TestAgainstTheRealCorpus(unittest.TestCase):
    def test_no_caption_in_the_corpus_says_its_data_is_absent(self):
        # This test used to pin exactly one caption (Figure 4.5's "not yet
        # present") as a known, allowed debt. That debt is paid: the R1 sweep
        # CSV is committed at whitepaper/figures/data/r1-floor.csv and the
        # caption now states what the measurement shows. The corpus is clean,
        # the CI step runs with no --allow, and this test holds it there.
        found = cadc.find_absent(cadc.sources())
        self.assertEqual(
            [f"{rel}:{phrase}" for rel, _, phrase, _ in found], [],
            "a figure caption again says its data is absent; commit the data or "
            "rewrite the caption rather than adding an --allow back",
        )

    def test_the_figure_that_carried_the_debt_now_cites_its_data(self):
        # Guard the other half: the caption could be cleaned by deleting the
        # sentence and never committing the CSV, which is the dishonest fix.
        csv = cadc.REPO / "whitepaper" / "figures" / "data" / "r1-floor.csv"
        self.assertTrue(csv.is_file(), f"{csv} is missing; Figure 4.5's overlay has no data")
        self.assertIn("r1-floor.csv", (cadc.REPO / REAL).read_text(encoding="utf-8"))

    def test_the_scanner_actually_reaches_the_corpus_captions(self):
        # A check that read nothing would also report nothing; count what it read.
        total = sum(len(list(cadc.captions(p.read_text(encoding="utf-8"))))
                    for p in cadc.sources())
        self.assertGreater(total, 50, "the caption scanner found almost no captions")


if __name__ == "__main__":
    unittest.main()
