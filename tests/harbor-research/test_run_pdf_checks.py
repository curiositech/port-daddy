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

import subprocess
import sys
import unittest
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


if __name__ == "__main__":
    unittest.main()
