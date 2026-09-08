#!/usr/bin/env python3
"""Fixture-based tests for scripts/harbor-research/check_figure_register.py.

stdlib-only (unittest, tempfile, subprocess). Each fixture test builds a
small, self-contained two-chapter repo under a tempdir (a textbook.json, a
FIGURE-REGISTER.md, a FIGURE-TRIAGE.md, and a `keep` fragment's .tex file)
and runs the real checker against it with --repo-root, so these tests
exercise the actual CLI a developer or CI runs. One test runs the same
checker with no --repo-root override, against this repository's own
committed FIGURE-REGISTER.md/FIGURE-TRIAGE.md, and expects it to pass.

Run:
    python3 -m unittest discover -s tests/harbor-research
    python3 tests/harbor-research/test_check_figure_register.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
CHECKER = REPO_ROOT / "scripts" / "harbor-research" / "check_figure_register.py"


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(content).lstrip("\n"), encoding="utf-8")


REGISTER_HEADER = (
    "| id | section | idea (one sentence) | structure | reader question | "
    "recommended form | existing figure | wave-11 disposition | priority | "
    "data source | notes for the renderer |\n"
    "|---|---|---|---|---|---|---|---|---|---|---|\n"
)

TRIAGE_HEADER = (
    "| # | fragment | page's idea | what is drawn | role | disposition | new kind / spec |\n"
    "|---|---|---|---|---|---|---|\n"
)


def textbook_json() -> str:
    return json.dumps({
        "chapters": [
            {"number": 1, "id": "chone", "title": "Chapter One", "prefix": "c1",
             "source": "whitepaper/chone.tex"},
            {"number": 2, "id": "chtwo", "title": "Chapter Two", "prefix": "c2",
             "source": "whitepaper/chtwo.tex"},
        ],
    })


def register_row(rid: str, structure: str = "temporal", existing: str = "none",
                  disposition: str = "—", priority: str = "must") -> str:
    return (
        f"| {rid} | Intro | Some idea, one sentence. | {structure} | Why? | "
        f"small diagram | {existing} | {disposition} | {priority} | — | note |\n"
    )


def triage_row(idx: str, fragment: str = "—", role: str = "carries",
               disposition: str = "keep") -> str:
    return f"| {idx} | {fragment} | the idea | what is drawn | {role} | {disposition} | spec |\n"


class FixtureRepo:
    """A minimal two-chapter repo the checker can run against via --repo-root."""

    def __init__(self, tmp: Path, register_rows: str, triage_rows: str,
                 include_fragment: bool = True):
        self.root = tmp
        write(tmp / "whitepaper" / "textbook.json", textbook_json())
        write(
            tmp / "docs" / "harbor-research" / "exposition" / "figures" / "FIGURE-REGISTER.md",
            "# Figure register\n\n"
            "## Chapter 1 — Chapter One\n\n" + REGISTER_HEADER + register_rows + "\n"
            "## Chapter 2 — Chapter Two\n\n" + REGISTER_HEADER,
        )
        write(
            tmp / "docs" / "harbor-research" / "exposition" / "figures" / "FIGURE-TRIAGE.md",
            "# Figure triage\n\n"
            "## Chapter 1 — Chapter One\n\n" + TRIAGE_HEADER + triage_rows + "\n"
            "## Chapter 2 — Chapter Two\n\n" + TRIAGE_HEADER,
        )
        if include_fragment:
            write(tmp / "whitepaper" / "figures" / "fig-c1-thing.tex", "% a fragment\n")

    def run(self) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(CHECKER), "--verbose", "--repo-root", str(self.root)],
            capture_output=True, text=True,
        )


class TestCheckFigureRegister(unittest.TestCase):
    def test_committed_data_passes(self) -> None:
        """The real, committed FIGURE-REGISTER.md/FIGURE-TRIAGE.md must pass
        the checker with no fixture involved."""
        result = subprocess.run(
            [sys.executable, str(CHECKER), "--verbose"],
            capture_output=True, text=True, cwd=REPO_ROOT,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
        self.assertIn("0 total failure(s)", result.stdout)

    def test_valid_fixture_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(
                Path(tmp),
                register_row("ch1-01", disposition="keep", existing="fig:c1-thing"),
                triage_row("1.1", fragment="fig-c1-thing", disposition="keep"),
            )
            result = repo.run()
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)

    def test_duplicate_id_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            rows = register_row("ch1-01") + register_row("ch1-01")
            repo = FixtureRepo(Path(tmp), rows, "")
            result = repo.run()
            self.assertEqual(result.returncode, 1)
            self.assertIn("duplicate id 'ch1-01'", result.stdout)

    def test_unknown_structure_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            rows = register_row("ch1-01", structure="spooky")
            repo = FixtureRepo(Path(tmp), rows, "")
            result = repo.run()
            self.assertEqual(result.returncode, 1)
            self.assertIn("unknown structure 'spooky'", result.stdout)

    def test_unknown_priority_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            rows = register_row("ch1-01", priority="urgent")
            repo = FixtureRepo(Path(tmp), rows, "")
            result = repo.run()
            self.assertEqual(result.returncode, 1)
            self.assertIn("unknown priority 'urgent'", result.stdout)

    def test_unknown_disposition_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            rows = register_row("ch1-01", disposition="reticulate")
            repo = FixtureRepo(Path(tmp), rows, "")
            result = repo.run()
            self.assertEqual(result.returncode, 1)
            self.assertIn("unknown wave-11 disposition", result.stdout)

    def test_keep_fragment_missing_on_disk_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(
                Path(tmp),
                register_row("ch1-01"),
                triage_row("1.1", fragment="fig-does-not-exist", disposition="keep"),
                include_fragment=False,
            )
            result = repo.run()
            self.assertEqual(result.returncode, 1)
            self.assertIn("fig-does-not-exist.tex", result.stdout)

    def test_redraw_fragment_missing_on_disk_is_allowed(self) -> None:
        """A redraw/table/delete/add fragment may already be gone -- only
        keep/restyle require the file to still exist."""
        with TemporaryDirectory() as tmp:
            repo = FixtureRepo(
                Path(tmp),
                register_row("ch1-01"),
                triage_row("1.1", fragment="fig-long-gone", disposition="delete"),
                include_fragment=False,
            )
            result = repo.run()
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)

    def test_malformed_row_wrong_column_count_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            bad_row = "| ch1-01 | Intro | idea | temporal | Why? | small diagram | none |\n"
            repo = FixtureRepo(Path(tmp), bad_row, "")
            result = repo.run()
            self.assertEqual(result.returncode, 1)
            self.assertIn("malformed row", result.stdout)

    def test_chapter_number_not_in_textbook_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            # ch9 does not exist in this fixture's two-chapter textbook.json.
            rows = register_row("ch9-01")
            repo = FixtureRepo(Path(tmp), rows, "")
            result = repo.run()
            self.assertEqual(result.returncode, 1)
            self.assertTrue(
                any("chapter 9" in line and "not in" in line for line in result.stdout.split("\n"))
            )


if __name__ == "__main__":
    unittest.main()
