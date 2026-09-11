#!/usr/bin/env python3
"""Fixture-based tests for scripts/harbor-research/check_figure_blockers.py.

stdlib-only (unittest, tempfile, subprocess, json). Each fixture test writes
a small blockers.json under a tempdir and runs the real script against it
with --repo-root (and --as-of, to make expiry deterministic). One test runs
the same checker with no --repo-root override against this repository's own
committed blockers.json.

Run:
    python3 -m unittest discover -s tests/harbor-research
    python3 tests/harbor-research/test_check_figure_blockers.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "harbor-research" / "check_figure_blockers.py"
BLOCKERS_REL = Path("docs/harbor-research/exposition/figures/blockers.json")


def entry(id_: str, checks_failed: list[str], waiver: dict | None) -> dict:
    return {
        "id": id_,
        "fragment": f"whitepaper/figures/{id_}.tex",
        "chapter": 1,
        "checks_failed": checks_failed,
        "first_seen": "2026-09-07",
        "waiver": waiver,
    }


def write_blockers(root: Path, blockers: list[dict]) -> None:
    path = root / BLOCKERS_REL
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(blockers, indent=2), encoding="utf-8")


def run(root: Path, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--repo-root", str(root), "--as-of", "2026-09-07", *extra],
        capture_output=True, text=True,
    )


class TestCheckFigureBlockers(unittest.TestCase):
    def test_committed_blockers_json_is_fully_waived_by_its_triage(self) -> None:
        """This repo's real blockers.json is EXPECTED to fail today -- that
        is the whole point of turning figcheck into a release blocker (see
        this directory's README.md, "Waivers" section). This test pins the current,
        known count so a change in it is a deliberate, reviewed act (a new
        waiver seeded, or a figure actually fixed), not silent drift.

        Every one of the 61 is waived today, and by which rule matters: 23 are
        figures the triage is deleting or turning into tables, so their defects
        will never be fixed and must not block; 38 are figures the triage
        condemned and scheduled, so their defects are a dated backlog. The
        negative controls for both live in the tests below, on fixtures --
        this one only records what the real register says. All 61 expire on
        one date, so the whole backlog comes up for review together."""
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--verbose"],
            capture_output=True, text=True, cwd=REPO_ROOT,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
        self.assertIn("61 waived", result.stdout)
        self.assertIn("0 failure(s)", result.stdout)

    def test_all_waived_and_unexpired_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_blockers(root, [
                entry("fig-a", ["T1"], {"reason": "retired by triage", "expires": "2026-10-31"}),
                entry("fig-b", ["T4"], {"reason": "retired by triage", "expires": "2026-09-07"}),  # expires == as_of: still valid
            ])
            result = run(root)
            self.assertEqual(result.returncode, 0, msg=result.stdout)

    def test_unwaived_entry_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_blockers(root, [entry("fig-a", ["T1"], None)])
            result = run(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("carries no waiver", result.stdout)

    def test_expired_waiver_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_blockers(root, [
                entry("fig-a", ["T1"], {"reason": "retired by triage", "expires": "2026-01-01"}),
            ])
            result = run(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("waiver expired", result.stdout)

    def test_malformed_expiry_date_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_blockers(root, [
                entry("fig-a", ["T1"], {"reason": "oops", "expires": "not-a-date"}),
            ])
            result = run(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("not YYYY-MM-DD", result.stdout)

    def test_duplicate_id_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_blockers(root, [
                entry("fig-a", ["T1"], {"reason": "x", "expires": "2026-10-31"}),
                entry("fig-a", ["T4"], {"reason": "x", "expires": "2026-10-31"}),
            ])
            result = run(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("duplicate blocker id", result.stdout)

    def test_missing_blockers_file_is_fatal(self) -> None:
        with TemporaryDirectory() as tmp:
            result = run(Path(tmp))
            self.assertEqual(result.returncode, 1)
            self.assertIn("does not exist", result.stderr)

    def test_empty_list_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_blockers(root, [])
            result = run(root)
            self.assertEqual(result.returncode, 0, msg=result.stdout)


if __name__ == "__main__":
    unittest.main()
