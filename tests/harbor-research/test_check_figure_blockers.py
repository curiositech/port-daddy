#!/usr/bin/env python3
"""Fixture-based tests for scripts/harbor-research/check_figure_blockers.py.

stdlib-only (unittest, tempfile, subprocess, json). Each fixture test writes
a small blockers.json under a tempdir and runs the real script against it
with --repo-root (and --as-of, to make expiry deterministic). Two tests run
the same checker against this repository's committed blockers.json, once at
its triage snapshot date and once immediately after its waivers expire.

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
        "fragment": f"book/figures/{id_}.tex",
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
    def test_committed_blockers_json_matches_its_triage(self) -> None:
        """This repo's blockers.json carried these entries at its triage date --
        that is the whole point of turning figcheck into a release blocker (see
        this directory's README.md, "Waivers" section). This test pins the
        current, known counts so a change in them is a deliberate, reviewed act
        (a new waiver seeded, or a figure actually fixed), not silent drift.

        The counts moved on 2026-09-14, when the records were re-derived
        against the live \\input-derived corpus instead of the corpus of an
        earlier wave: 61 entries became 21. Twenty-seven records described
        fragments no chapter ships any more and were deleted outright, and of
        the 52 that survived, 22 figures had been redrawn clean since their
        record was written -- their entries went with them.

        Of the 21 that remain, 20 are waived as figures the Wave 11 triage
        condemned and scheduled, so their defects are a dated backlog rather
        than news, and all 20 expire on one date so the backlog comes up for
        review together. One is NOT waived and must stay that way:
        fig-stp-deterrence-regime is triaged `keep` on a note that reads
        "figcheck clean", and the fresh compile finds a drawn line through a
        label (T4). A `keep` that is no longer clean is exactly the thing this
        gate exists to surface, so it blocks until the figure or the triage row
        is corrected -- which is a chapter-source edit, and a later wave's work.
        The negative controls for both waiver rules live in the tests below, on
        fixtures; this one only records what the real register says.

        The count moved again on 2026-09-15 (PR #10191): renaming bare
        hhink/hhamber colours to the pd-prefixed rule/direct-label styles in
        fig-anchor-card-lifecycle and fig-swk-controllability-quadrant pulled
        both into the figure-gate's Book-preamble compile scope for the first
        time, surfacing two more pre-existing Wave 11 backlog defects (2.7
        restyle, T2/T3; 1.10 redraw, T4) that the corpus had simply never
        measured before. Their figcheck/*.json records were regenerated
        against that compile and both are waived on the same Wave 11 terms as
        the other 20, so 21/20 became 23/22; fig-stp-deterrence-regime is
        still the one figure that stays unwaived."""
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--verbose", "--as-of", "2026-09-15"],
            capture_output=True, text=True, cwd=REPO_ROOT,
        )
        self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)
        self.assertIn("23 total, 22 waived, 1 failure(s)", result.stdout)
        self.assertIn("fig-stp-deterrence-regime", result.stdout)

    def test_committed_triage_waivers_expire_without_renewal(self) -> None:
        """The snapshot test must not hide the real register's expiry boundary.

        All 22 dated waivers expire on October 31. On November 1 none counts
        as valid, while the separately unwaived deterrence figure still fails.
        The production checker retains its default of today's date.
        """
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--verbose", "--as-of", "2026-11-01"],
            capture_output=True, text=True, cwd=REPO_ROOT,
        )
        self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)
        self.assertIn("23 total, 0 waived, 23 failure(s)", result.stdout)
        self.assertEqual(result.stdout.count("waiver expired 2026-10-31"), 22)
        self.assertIn("'fig-stp-deterrence-regime' fails ['T4'] and carries no waiver", result.stdout)

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
