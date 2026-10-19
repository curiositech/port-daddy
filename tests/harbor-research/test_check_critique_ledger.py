#!/usr/bin/env python3
r"""Tests for the critique ledger's Status vocabulary.

The ledger's whole value is that `Status` is queryable, so the vocabulary is
closed and the checker enforces it. `BLOCKED -- <branch>` was added as a fourth
value for a row whose fix is real and agreed but whose file another branch
owns: it can be neither landed nor declined from here.

The test that matters is the counting one. A blocked row must be counted as
**open**, never as closed -- the failure it exists to prevent is `CA-045`,
which sat at `DONE` for a while over a defect its own Notes documented as live,
so the derived tally reported it as closed and nobody looking at the dashboard
could tell. If `blocked` ever starts adding into `done`, that failure comes
back wearing a new name.

Run:
    python3 -m unittest discover -s tests/harbor-research
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "harbor-research"))
import check_critique_ledger as ccl  # noqa: E402
import check_research_program as crp  # noqa: E402


class TestStatusVocabulary(unittest.TestCase):
    def accepts(self, status):
        errors = []
        ccl.check_status("CA-000", status, "test", errors)
        return not errors

    def test_the_four_values_and_empty_are_accepted(self):
        for s in ["", "DONE abc1234", "DONE #10185", "IN-WAVE-3",
                  "DECLINED -- appreciative remark, no change requested",
                  "BLOCKED -- claude/figures-that-were-missing"]:
            self.assertTrue(self.accepts(s), f"rejected a legal Status: {s!r}")

    def test_blocked_accepts_the_dash_variants_the_others_do(self):
        for dash in ["--", "-", "—", "–"]:
            self.assertTrue(self.accepts(f"BLOCKED {dash} claude/some-branch"))

    def test_blocked_without_a_branch_is_rejected(self):
        """The value is a routing instruction; a bare BLOCKED routes nowhere."""
        self.assertFalse(self.accepts("BLOCKED"))
        self.assertFalse(self.accepts("BLOCKED --"))
        self.assertFalse(self.accepts("BLOCKED -- "))

    def test_a_status_outside_the_vocabulary_is_still_rejected(self):
        # The vocabulary widened by exactly one value, not into a free-text field.
        for s in ["WONTFIX -- no", "PARTIAL", "blocked on something",
                  "DECLINED in part -- half of it"]:
            self.assertFalse(self.accepts(s), f"accepted an illegal Status: {s!r}")


class TestBlockedCountsAsOpen(unittest.TestCase):
    def test_the_derived_tally_never_folds_blocked_into_done(self):
        t = crp.derive_critique_ledger()
        self.assertIn("blocked", t)
        self.assertEqual(
            t["total"],
            t["done"] + t["declined"] + t["inWave"] + t["blocked"] + t["other"],
            "the tally's buckets do not partition the ledger",
        )

    def test_the_real_ledger_carries_blocked_rows_and_they_are_not_done(self):
        """Guards the specific regression: blocked rows silently becoming closed."""
        rows = crp.load(crp.CRITIQUE_LEDGER)
        blocked = [r for r in rows
                   if str(r.get("Status", "")).strip().upper().startswith("BLOCKED")]
        self.assertTrue(blocked, "no BLOCKED rows; this test has lost its subject")
        for r in blocked:
            status = str(r["Status"]).strip()
            self.assertNotIn("DONE", status.upper())
            self.assertRegex(status, r"^BLOCKED\s*(--|-|—|–)\s*claude/\S",
                             f"{r['#']} does not name an owning branch")

    def test_every_blocked_row_says_blocked_not_declined_in_its_notes(self):
        """Declining silently is the thing the ledger exists to prevent."""
        rows = crp.load(crp.CRITIQUE_LEDGER)
        for r in rows:
            if str(r.get("Status", "")).strip().upper().startswith("BLOCKED"):
                self.assertIn("BLOCKED", str(r.get("Notes", "")).upper(),
                              f"{r['#']} is BLOCKED but its Notes do not say so")


if __name__ == "__main__":
    unittest.main()
