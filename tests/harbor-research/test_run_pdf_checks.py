#!/usr/bin/env python3
"""Tests for scripts/harbor-research/run_pdf_checks.py -- the one entry
point for every check that reads a rendered PDF.

stdlib-only. Does not render anything (no tectonic here); it checks the
orchestration itself: fails closed with no PDFs, and runs the registered
checks against a real PDF when one is committed to check against (the
type-over-art manifest's own registered plates give it one for free).

Run:
    python3 -m unittest discover -s tests/harbor-research
    python3 tests/harbor-research/test_run_pdf_checks.py
"""
from __future__ import annotations

import os
import subprocess
import sys
import unittest
import unittest.mock
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "harbor-research" / "run_pdf_checks.py"


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )


class TestFailClosed(unittest.TestCase):
    def test_an_empty_directory_fails_rather_than_passing_having_checked_nothing(self):
        with TemporaryDirectory() as tmp:
            result = run("--pdf-dir", tmp)
        self.assertEqual(result.returncode, 1)
        self.assertIn("no PDFs found", result.stdout + result.stderr)

    def test_a_nonexistent_directory_fails_the_same_way(self):
        result = run("--pdf-dir", str(REPO_ROOT / "does" / "not" / "exist"))
        self.assertEqual(result.returncode, 1)

    def test_no_arguments_at_all_fails(self):
        result = run()
        self.assertEqual(result.returncode, 1)


class TestExpectedCount(unittest.TestCase):
    """--expect: the half of the empty-artifact hole the zero case leaves.

    "No PDFs" already failed. "Two of the three editions" did not, and read
    as a pass over whichever edition went missing. These check the count is
    asserted before any checker runs, so a short artifact fails as a short
    artifact rather than as a green run over a subset.
    """

    def test_a_short_count_fails_before_any_check_runs(self):
        with TemporaryDirectory() as tmp:
            for name in ("one.pdf", "two.pdf"):
                (Path(tmp) / name).write_bytes(b"%PDF-1.4\n")  # never opened
            result = run("--pdf-dir", tmp, "--expect", "3")
        self.assertEqual(result.returncode, 1)
        self.assertIn("expected 3 PDF(s) to check, found 2", result.stdout + result.stderr)
        # It must not have reached a checker: a truncated stub would make
        # page_overflow.py fail for its own reasons and hide the real cause.
        self.assertNotIn("page_overflow.py", result.stdout)

    def test_a_long_count_fails_too(self):
        # An edition appearing that the caller does not know about is the
        # same disagreement, and quietly checking it is the same wrong answer.
        with TemporaryDirectory() as tmp:
            for name in ("one.pdf", "two.pdf"):
                (Path(tmp) / name).write_bytes(b"%PDF-1.4\n")
            result = run("--pdf-dir", tmp, "--expect", "1")
        self.assertEqual(result.returncode, 1)
        self.assertIn("found 2", result.stdout + result.stderr)

    def test_zero_pdfs_still_reports_the_empty_case_not_the_count(self):
        with TemporaryDirectory() as tmp:
            result = run("--pdf-dir", tmp, "--expect", "3")
        self.assertEqual(result.returncode, 1)
        self.assertIn("no PDFs found", result.stdout + result.stderr)

    def test_without_expect_the_count_is_not_asserted(self):
        # Local runs over one edition stay possible; only the caller that
        # knows the number says it.
        with TemporaryDirectory() as tmp:
            (Path(tmp) / "one.pdf").write_bytes(b"%PDF-1.4\n")
            result = run("--pdf-dir", tmp)
        self.assertNotIn("expected", result.stderr)


class TestRegistry(unittest.TestCase):
    def test_every_registered_check_script_exists(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location("run_pdf_checks", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for script, _ in module.PER_PDF_CHECKS:
            self.assertTrue(Path(script).is_file(), f"missing: {script}")
        for script, _ in module.PER_DIR_CHECKS:
            self.assertTrue(Path(script).is_file(), f"missing: {script}")
        # The registry is the whole point: an empty one would pass every PDF
        # trivially, which is the fail-open this script exists to prevent.
        self.assertGreater(len(module.PER_PDF_CHECKS), 0)
        self.assertGreater(len(module.PER_DIR_CHECKS), 0)


# ── the failure summary: what gets quoted where the red mark is ────────────
#
# Added with the summary itself. The rule under test is the one that makes a
# summary worth having: a check may print rows it does NOT fail on, and
# quoting those beside the ones that caused the red turns the summary back
# into the log it was meant to replace. On the Book today that ratio is one
# real finding to fifty-two advisory ones, which is exactly enough noise to
# hide a line 8 pt off the paper.

sys.path.insert(0, str(REPO_ROOT / "scripts" / "harbor-research"))
import run_pdf_checks  # noqa: E402  (path set immediately above)


class TestSalient(unittest.TestCase):
    def test_quotes_a_finding_and_the_rows_under_it(self):
        picked = run_pdf_checks.salient(
            "-- 1 page/kind rows with loss (ink past the paper edge)\n"
            "p309 text     off-page    8.2 pt  past column 0.0 pt  Exercises 6.20\n"
        )
        self.assertTrue(picked[0].startswith("-- 1 page/kind rows"))
        self.assertIn("p309", picked[1])

    def test_leaves_advisory_rows_out_of_a_failure_summary(self):
        picked = run_pdf_checks.salient(
            "-- 1 page/kind rows with loss (ink past the paper edge)\n"
            "p309 text off-page 8.2 pt\n"
            "-- advisory: 52 pictures set past the column by the safety net\n"
            "p 21 +108.0 pt\n"
            "p 29 + 18.0 pt\n"
        )
        self.assertTrue(any("p309" in line for line in picked))
        self.assertFalse(any("advisory" in line for line in picked))
        self.assertFalse(any("p 21" in line for line in picked))

    def test_a_zero_count_header_is_not_a_finding(self):
        # All-clean output has no finding header at all, so the tail fallback
        # is what answers -- and it must not read "0 collisions" as a finding.
        picked = run_pdf_checks.salient(
            "-- 0 margin-column collisions\n-- 0 page(s) with text below the foot\n"
        )
        self.assertEqual(len(picked), 2)
        self.assertTrue(all(line.startswith("-- 0") for line in picked))

    def test_caps_the_rows_so_one_loud_check_cannot_bury_the_others(self):
        out = "-- 40 page/kind rows with loss\n" + "".join(
            f"p{i} text off-page 1.0 pt\n" for i in range(40)
        )
        picked = run_pdf_checks.salient(out, max_rows=5)
        self.assertEqual(len([p for p in picked if p.strip().startswith("p")]), 5)
        self.assertEqual(picked[-1].strip(), "...")

    def test_falls_back_to_the_tail_for_a_check_that_reports_another_way(self):
        # check_cover_title_band.py uses no "-- N" header. An unrecognized
        # shape is not a reason for the summary to say nothing at all.
        picked = run_pdf_checks.salient(
            "type over art: FAIL\n  - maritime: no built PDF to check\n"
        )
        self.assertIn("type over art: FAIL", picked)


class TestSummarize(unittest.TestCase):
    def test_is_a_no_op_off_a_runner(self):
        # No GITHUB_STEP_SUMMARY locally; writing anywhere would be wrong.
        with unittest.mock.patch.dict("os.environ", {}, clear=False):
            os.environ.pop("GITHUB_STEP_SUMMARY", None)
            run_pdf_checks.summarize([("page_overflow.py", "book.pdf", "-- 1 rows\np1 x\n")])

    def test_appends_rather_than_replacing_an_earlier_step_s_summary(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "summary.md"
            path.write_text("### An earlier step said something\n", encoding="utf-8")
            with unittest.mock.patch.dict("os.environ", {"GITHUB_STEP_SUMMARY": str(path)}):
                run_pdf_checks.summarize(
                    [("page_overflow.py", "book.pdf", "-- 1 rows with loss\np309 text 8.2 pt\n")]
                )
            written = path.read_text(encoding="utf-8")
        self.assertIn("An earlier step said something", written)
        self.assertIn("page_overflow.py", written)
        self.assertIn("p309", written)



if __name__ == "__main__":
    unittest.main()
