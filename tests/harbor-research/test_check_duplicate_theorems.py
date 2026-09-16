#!/usr/bin/env python3
r"""Tests for scripts/harbor-research/check_duplicate_theorems.py.

stdlib-only, no TeX, no repository state: the checker's pure functions are
fed small chapter texts shaped like the case that actually happened -- two
chapters each opening a pdclaim under \label{thm:fh-escrow-bound}, with
different titles and different wording -- and the two ways such a pair is
legitimately NOT a Book duplicate: the second copy sits in the \else branch a
standalone paper compiles and the Book skips, or the pair is recorded as a
deliberate exception.

Run:
    python3 -m unittest discover -s tests/harbor-research
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "harbor-research"))
import check_duplicate_theorems as cdt  # noqa: E402

CH6 = (
    "\\begin{pdclaim}{Design invariant}{Bounded custody loss, conditional}\n"
    "\\label{thm:fh-escrow-bound}\n"
    "If the ledger is non-bypassable the worst case is the fee.\n"
    "\\end{pdclaim}\n"
    "\\begin{definition}[Float plan]\\label{def:float-plan}\nA signed declaration.\n\\end{definition}\n"
)
CH8 = (
    "\\begin{pdclaim}{Design invariant}{Conditional Escrow Extraction Bound}\n"
    "\\label{thm:fh-escrow-bound}\n"
    "Assume (i)--(iv). Then no allowed transition pays more than $\\phi$.\n"
    "\\end{pdclaim}\n"
    "\\begin{theorem}[Convergence]\\label{thm:fh-conv}\nGossip converges.\n\\end{theorem}\n"
)


class TestTheoremLabels(unittest.TestCase):
    def test_the_statement_label_is_the_first_label_inside_the_environment(self):
        text = (
            "\\begin{theorem}[Main]\\label{thm:main}\n"
            "\\begin{equation}\\label{eq:inside}x=1\\end{equation}\n"
            "\\end{theorem}\n"
        )
        self.assertEqual(cdt.theorem_labels(text), [("thm:main", "theorem")])

    def test_an_unlabelled_statement_is_skipped_not_guessed(self):
        self.assertEqual(cdt.theorem_labels("\\begin{lemma}\nNo label.\n\\end{lemma}\n"), [])

    def test_a_starred_environment_still_counts(self):
        text = "\\begin{remark*}\\label{rem:aside}\nAn aside.\n\\end{remark*}\n"
        self.assertEqual(cdt.theorem_labels(text), [("rem:aside", "remark")])

    def test_a_commented_out_statement_is_not_a_statement(self):
        text = "% \\begin{theorem}\\label{thm:old}\\end{theorem}\n"
        self.assertEqual(cdt.theorem_labels(text), [])

    def test_only_the_book_branch_of_a_conditional_is_read(self):
        # The twin-source pattern: the Book branch refers to another chapter's
        # statement; the \else branch keeps the standalone paper's own copy.
        text = (
            "\\ifpdbook\nDesign Invariant~\\ref{fh:thm:fh-escrow-bound} states the bound.\n"
            "\\else\n" + CH6 + "\\fi\n"
        )
        self.assertEqual(cdt.theorem_labels(text), [])


class TestFindShared(unittest.TestCase):
    def test_the_defect_that_happened_is_reported_by_label_not_title(self):
        shared = cdt.find_shared([(6, "harbor-economy", CH6), (8, "federated-harbor", CH8)])
        self.assertEqual(list(shared), ["thm:fh-escrow-bound"])
        self.assertEqual(
            shared["thm:fh-escrow-bound"],
            [(6, "harbor-economy", "pdclaim"), (8, "federated-harbor", "pdclaim")],
        )

    def test_a_copy_in_the_standalone_branch_is_not_a_book_duplicate(self):
        ch6 = "\\ifpdbook\nSee \\ref{fh:thm:fh-escrow-bound}.\n\\else\n" + CH6 + "\\fi\n"
        self.assertEqual(cdt.find_shared([(6, "he", ch6), (8, "fh", CH8)]), {})

    def test_an_allowed_label_is_not_reported(self):
        shared = cdt.find_shared(
            [(6, "he", CH6), (8, "fh", CH8)], allow={"thm:fh-escrow-bound"}
        )
        self.assertEqual(shared, {})

    def test_the_same_label_twice_in_one_chapter_is_not_a_cross_chapter_share(self):
        # A chapter reusing its own label is a LaTeX "multiply defined" warning
        # for that chapter's build to raise, not a Book duplication.
        shared = cdt.find_shared([(6, "he", CH6 + CH6), (8, "fh", "")])
        self.assertEqual(shared, {})

    def test_different_labels_are_silent(self):
        ch8 = CH8.replace("thm:fh-escrow-bound", "thm:fh-extraction")
        self.assertEqual(cdt.find_shared([(6, "he", CH6), (8, "fh", ch8)]), {})


if __name__ == "__main__":
    unittest.main()
