#!/usr/bin/env python3
r"""Tests for scripts/harbor-research/check_duplicate_protocols.py.

stdlib-only, no TeX, no repository state: the checker's pure functions are fed
small chapter texts shaped like the case that actually happened -- chapter 6
writing the four-message cross-harbor transfer out as a labelled Protocol and
chapter 8 writing the same four messages out again as a plain enumerate, which
is invisible to the \input check and to the \label check -- together with the
three ways a pair of chapters legitimately is NOT a duplicated ceremony: one
chapter merely names the other's messages in passing, the second copy sits in
the \else branch a standalone paper compiles, or the pair is recorded as a
deliberate exception.

The mutation tests are the point of the file: a check that cannot be made to
fail is not evidence of anything, so each one breaks the source in the single
way the check exists to notice and asserts that it notices.

Run:
    python3 -m unittest discover -s tests/harbor-research
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "harbor-research"))
import check_duplicate_protocols as cdp  # noqa: E402

# Chapter 6 as it stands: a labelled Protocol environment whose items each open
# with the message they define.
CH6 = (
    "\\begin{protocol}[Cross-harbor capability transfer]\\label{prot:xfer}\n"
    "\\begin{enumerate}\n"
    "  \\item Alice's agent $\\to A$: $\\mathsf{xfer\\_req}(C_A, B)$ --- present $C_A$.\n"
    "  \\item $A \\to B$: $\\mathsf{xfer\\_offer}\\langle C_A, R_A\\rangle$ --- an envelope.\n"
    "  \\item $B \\to A$: $\\mathsf{xfer\\_ack}\\langle C_B'\\rangle$ --- the derivative.\n"
    "  \\item $B$ delivers: $\\mathsf{xfer\\_deliver}\\langle C_B'\\rangle$ --- to the agent.\n"
    "\\end{enumerate}\n"
    "\\end{protocol}\n"
)

# Chapter 8 as it stands: the same four steps, no environment, no label.
CH8 = (
    "\\subsection{The four-message ceremony}\n"
    "\\begin{enumerate}[nosep,leftmargin=*]\n"
    "\\item $\\mathsf{xfer\\_req}(C_A, B)$ --- Alice's agent presents $C_A$ to $D_A$.\n"
    "\\item $\\mathsf{xfer\\_offer}\\langle C_A, R_A \\rangle$ --- $D_A$ constructs an envelope.\n"
    "\\item $\\mathsf{xfer\\_ack}\\langle C_B', R_B \\rangle$ --- $D_B$ verifies the signature.\n"
    "\\item $\\mathsf{xfer\\_deliver}\\langle C_B' \\rangle$ --- $D_B$ delivers $C_B'$.\n"
    "\\end{enumerate}\n"
)

SHARED = {"xfer\\_req", "xfer\\_offer", "xfer\\_ack", "xfer\\_deliver"}
KEY = "6:8:xfer_ack,xfer_deliver,xfer_offer,xfer_req"


class TestMessageNames(unittest.TestCase):
    def test_a_snake_case_wire_name_in_a_code_font_is_a_message(self):
        self.assertEqual(
            cdp.message_names("the daemon sends $\\mathsf{xfer\\_req}(C)$ first"),
            {"xfer\\_req"},
        )

    def test_an_ordinary_identifier_without_an_underscore_is_not_a_message(self):
        # \texttt{bwrap}, \texttt{fsync}, \mathsf{sign} and friends are all over
        # the corpus and none of them names a protocol step.
        self.assertEqual(cdp.message_names("\\texttt{bwrap} and $\\mathsf{sign}_R$"), set())

    def test_prose_in_a_normal_font_is_never_a_message(self):
        self.assertEqual(cdp.message_names("the xfer\\_req message"), set())

    def test_a_commented_out_step_is_not_a_step(self):
        self.assertEqual(cdp.step_names("% \\item $\\mathsf{xfer\\_req}(C)$\n"), set())


class TestStepNames(unittest.TestCase):
    def test_a_message_at_the_head_of_an_item_introduces_a_step(self):
        self.assertEqual(cdp.step_names(CH8), SHARED)

    def test_an_optional_item_label_does_not_hide_the_step(self):
        text = "\\item[(2)] $\\mathsf{xfer\\_offer}\\langle C\\rangle$ --- an envelope.\n"
        self.assertEqual(cdp.step_names(text), {"xfer\\_offer"})

    def test_a_message_deep_inside_a_long_item_is_not_introducing_it(self):
        # Referring to another chapter's message from the middle of a paragraph
        # is citation, not restatement, and must not count.
        text = "\\item " + ("padding word " * 20) + "$\\mathsf{xfer\\_offer}\\langle C\\rangle$.\n"
        self.assertEqual(cdp.step_names(text), set())

    def test_only_the_book_branch_of_a_conditional_is_read(self):
        # The twin-source pattern: the Book branch defers to the owning chapter,
        # the \else branch keeps the standalone paper's own steps.
        text = (
            "\\ifpdbook\nThe ceremony is given in \\pdchapref{fh}{The Federated Harbor}.\n"
            "\\else\n" + CH6 + "\\fi\n"
        )
        self.assertEqual(cdp.step_names(text), set())


class TestFindShared(unittest.TestCase):
    def chapters(self, six=CH6, eight=CH8):
        return [(6, "harbor-economy", six), (8, "federated-harbor", eight)]

    def test_the_defect_that_survived_both_sibling_checks_is_reported(self):
        found = cdp.find_shared(self.chapters())
        self.assertEqual(len(found), 1)
        a, a_id, b, b_id, names = found[0]
        self.assertEqual((a, b), (6, 8))
        self.assertEqual(names, SHARED)

    def test_the_allow_key_names_the_pair_and_the_exact_messages(self):
        self.assertEqual(cdp.allow_key(8, 6, SHARED), KEY)

    def test_a_recorded_exception_clears_it(self):
        self.assertEqual(cdp.find_shared(self.chapters(), allow={KEY}), [])

    def test_an_exception_recorded_for_one_message_set_does_not_cover_another(self):
        # A fifth message joining the ceremony is a different duplication and
        # must be looked at again rather than ride the old exception.
        five = CH8.replace(
            "\\end{enumerate}",
            "\\item $\\mathsf{xfer\\_abort}\\langle C\\rangle$ --- withdrawal.\n\\end{enumerate}",
        )
        six = CH6.replace(
            "\\end{enumerate}",
            "\\item $\\mathsf{xfer\\_abort}\\langle C\\rangle$ --- withdrawal.\n\\end{enumerate}",
        )
        self.assertEqual(len(cdp.find_shared(self.chapters(six, five), allow={KEY})), 1)

    def test_two_shared_messages_are_a_mention_and_not_a_restatement(self):
        # The threshold exists so that naming another chapter's messages in a
        # list of requirements does not read as writing the ceremony out.
        mention = (
            "\\begin{itemize}\n"
            "\\item $\\mathsf{xfer\\_req}$ must narrow only.\n"
            "\\item $\\mathsf{xfer\\_ack}$ must verify under $B$'s key alone.\n"
            "\\end{itemize}\n"
        )
        self.assertEqual(cdp.find_shared(self.chapters(mention, CH8)), [])

    def test_a_chapter_that_owns_the_ceremony_alone_is_clean(self):
        deferred = "The ceremony is given in \\pdchapref{fh}{The Federated Harbor}.\n"
        self.assertEqual(cdp.find_shared(self.chapters(deferred, CH8)), [])


class TestAgainstTheRealCorpus(unittest.TestCase):
    """The corpus itself, so the check is measured against the Book and not only
    against fixtures -- and so that fixing the defect cannot leave a check that
    passes for the wrong reason."""

    def corpus(self):
        out = []
        for number, cid, src in cdp.chapters():
            if src.is_file():
                out.append((number, cid, src.read_text(encoding="utf-8")))
        return out

    def test_the_known_duplication_is_the_only_one_in_the_book(self):
        found = cdp.find_shared(self.corpus())
        self.assertEqual(
            [cdp.allow_key(a, b, names) for a, _, b, _, names in found], [KEY],
            "a ceremony is written out twice that the workflow's --allow does not record",
        )

    def test_the_recorded_exception_clears_the_corpus(self):
        self.assertEqual(cdp.find_shared(self.corpus(), allow={KEY}), [])

    def test_a_new_duplicated_ceremony_in_the_corpus_would_fail(self):
        # Mutation: graft a second chapter's copy of an existing ceremony into a
        # chapter that does not have one, and assert the check notices even with
        # the known exception recorded.
        corpus = self.corpus()
        graft = "\n" + CH8.replace("xfer", "handoff") + "\n"
        mutated = [
            (n, cid, text + graft) if n in (1, 4) else (n, cid, text)
            for n, cid, text in corpus
        ]
        found = cdp.find_shared(mutated, allow={KEY})
        self.assertTrue(found, "a ceremony grafted into two chapters was not reported")


if __name__ == "__main__":
    unittest.main()
