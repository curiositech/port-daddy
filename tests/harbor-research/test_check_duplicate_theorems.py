#!/usr/bin/env python3
r"""Tests for scripts/harbor-research/check_duplicate_theorems.py.

stdlib-only, no TeX: the checker's pure functions are fed small chapter texts
shaped like the case that actually happened -- two chapters each opening a
pdclaim under \label{thm:fh-escrow-bound}, with different titles and different
wording -- and the two ways such a pair is legitimately NOT a Book duplicate:
the second copy sits in the \else branch a standalone paper compiles and the
Book skips, or the pair is recorded as a deliberate exception.

TestCommandLine covers the half the function-level tests structurally cannot:
that `--allow` is PARSED into the set find_shared receives, and that a detected
duplicate becomes a NONZERO EXIT. That is the behaviour the workflow leans on --
`library-checks.yml` now runs this script with no `--allow` flags at all, and
"the gate is no longer suppressed" is only true if a detection fails the job.
Detection working and the job failing are two different claims.

How the entry point is driven, and the one awkward part, stated plainly:
main() reads the corpus through chapters(), which resolves textbook.json and
every chapter source from module-level constants derived from __file__. There
is no environment variable or flag to point it elsewhere, so a subprocess
cannot be given a synthetic corpus, and the repository's real corpus is (by
this PR's whole point) duplicate-free -- there is no real duplicate left to
drive the failure path with. So the failure path is driven in-process by
substituting cdt.chapters with one that yields real temp files. Everything
downstream of that substitution is the shipped code: argparse, the allow set,
find_shared, the printed report, and the return code. One subprocess test then
pins the process-level wiring (sys.exit(main()) and the real `--allow` spelling)
against the real corpus, which is the exact command the workflow runs.

Run:
    python3 -m unittest discover -s tests/harbor-research
"""
from __future__ import annotations

import contextlib
import io
import subprocess
import sys
import tempfile
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


SCRIPT = REPO_ROOT / "scripts" / "harbor-research" / "check_duplicate_theorems.py"


class TestCommandLine(unittest.TestCase):
    r"""main() as the workflow invokes it: argv in, exit code and report out.

    Each test substitutes cdt.chapters (see the module docstring for why) with
    one yielding real files on disk, so main()'s own is_file()/read_text() path
    runs unchanged. Cleanup restores the chapter reader whether or not the test passes.
    """

    def setUp(self):
        self._real_chapters = cdt.chapters
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.addCleanup(setattr, cdt, "chapters", self._real_chapters)

    def _corpus(self, *chapter_texts):
        """Write (number, id, text) triples to disk and point cdt.chapters at them."""
        entries = []
        for number, cid, text in chapter_texts:
            src = Path(self._tmp.name) / f"{cid}.tex"
            src.write_text(text, encoding="utf-8")
            entries.append((number, cid, src))
        cdt.chapters = lambda: entries

    @staticmethod
    def _run(argv):
        """main(argv) -> (exit code, everything it printed)."""
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = cdt.main(argv)
        return code, buf.getvalue()

    # -- the failure path: a detection must become a nonzero exit -------------

    def test_a_duplicate_with_no_allow_exits_nonzero_and_names_the_label(self):
        self._corpus((6, "harbor-economy", CH6), (8, "federated-harbor", CH8))
        code, out = self._run([])
        self.assertEqual(code, 1, f"a shared label must fail the job; got exit {code}\n{out}")
        self.assertIn("thm:fh-escrow-bound", out)
        # Naming the label alone is not enough to act on: the report has to say
        # which two chapters to go and look at.
        self.assertIn("ch.6 harbor-economy", out)
        self.assertIn("ch.8 federated-harbor", out)

    def test_the_unsuppressed_gate_is_green_on_a_corpus_with_no_duplicate(self):
        # The other side of the same coin: with the labels distinct, the bare
        # command this PR puts into library-checks.yml exits 0.
        self._corpus(
            (6, "harbor-economy", CH6),
            (8, "federated-harbor", CH8.replace("thm:fh-escrow-bound", "thm:fh-extraction")),
        )
        code, out = self._run([])
        self.assertEqual(code, 0, out)
        self.assertIn("(0 allowed)", out)

    # -- the parsing path: --allow must reach the allow set -------------------

    def test_the_allow_flag_is_parsed_into_the_allow_set(self):
        # find_shared already has a test for an allow set passed as a Python
        # kwarg. This is the other half: that the FLAG builds that set.
        self._corpus((6, "harbor-economy", CH6), (8, "federated-harbor", CH8))
        self.assertEqual(self._run([])[0], 1, "precondition: the label is a duplicate")
        code, out = self._run(["--allow", "thm:fh-escrow-bound"])
        self.assertEqual(code, 0, out)
        self.assertIn("(1 allowed)", out)
        self.assertNotIn("printed twice", out)

    def test_allow_is_repeatable_and_each_flag_lands(self):
        # action='append' -- two duplicates need two flags, which is exactly the
        # shape this PR deletes from library-checks.yml.
        ch8 = CH8 + (
            "\\begin{definition}[Float plan]\\label{def:float-plan}\n"
            "A restatement.\n\\end{definition}\n"
        )
        self._corpus((6, "harbor-economy", CH6), (8, "federated-harbor", ch8))
        code, out = self._run([])
        self.assertEqual(code, 1, out)
        self.assertIn("2 statement(s) printed twice", out)

        # One flag suppresses one and leaves the other failing -- the assertion
        # that catches an --allow which blanket-clears instead of filtering.
        code, out = self._run(["--allow", "thm:fh-escrow-bound"])
        self.assertEqual(code, 1, out)
        self.assertIn("def:float-plan", out)
        self.assertNotIn("thm:fh-escrow-bound", out)

        code, out = self._run(
            ["--allow", "thm:fh-escrow-bound", "--allow", "def:float-plan"]
        )
        self.assertEqual(code, 0, out)
        self.assertIn("(2 allowed)", out)

    def test_an_allow_for_some_other_label_does_not_suppress_a_real_duplicate(self):
        self._corpus((6, "harbor-economy", CH6), (8, "federated-harbor", CH8))
        code, out = self._run(["--allow", "thm:not-this-one"])
        self.assertEqual(code, 1, out)
        self.assertIn("thm:fh-escrow-bound", out)

    # -- process-level wiring ------------------------------------------------

    def test_the_script_entry_point_accepts_the_real_corpus_and_allow_flag(self):
        # Exercises the real `--allow` spelling through the successful
        # __main__ path; failure propagation is covered in-process above. Runs against the repository's own corpus, which
        # is the command library-checks.yml now runs; a duplicate landing on
        # main turns this red, which is the point of the gate.
        proc = subprocess.run(
            [sys.executable, str(SCRIPT)],
            capture_output=True, text=True, cwd=str(REPO_ROOT),
        )
        self.assertEqual(
            proc.returncode, 0,
            f"the unsuppressed gate must be green on this branch\n"
            f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}",
        )
        self.assertIn("ok:", proc.stdout)
        self.assertIn("(0 allowed)", proc.stdout)

        # And the flag is still accepted by the shipped entry point.
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "--allow", "thm:fh-escrow-bound"],
            capture_output=True, text=True, cwd=str(REPO_ROOT),
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("(1 allowed)", proc.stdout)


if __name__ == "__main__":
    unittest.main()
