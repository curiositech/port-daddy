#!/usr/bin/env python3
r"""Fixture-based tests for scripts/harbor-research/check_figcheck_corpus.py.

stdlib-only (unittest, tempfile, subprocess, json). Each test builds a tiny
repository under a tempdir -- a whitepaper/textbook.json, one or two chapter
sources, their figures/ directories, and a figcheck/ directory -- and runs
the real script against it with --repo-root. One test runs the script against
this repository itself and expects the committed records and the live corpus
to agree.

The two mutation tests are the point of the file: a checker that only ever
sees a healthy tree has never been shown to fail, and "validation that checks
shape but not existence" is exactly the defect this script was added to close.

Run:
    python3 -m unittest discover -s tests/harbor-research
    python3 tests/harbor-research/test_check_figcheck_corpus.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "harbor-research" / "check_figcheck_corpus.py"
FIGCHECK_REL = Path("docs/harbor-research/exposition/figures/figcheck")

TIKZ = "\\begin{tikzpicture}\n\\node {x};\n\\end{tikzpicture}\n"


def run(repo_root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--repo-root", str(repo_root), *args],
        capture_output=True, text=True, check=False,
    )


class Fixture:
    """A minimal repository: one chapter, its figures, its figcheck records."""

    def __init__(self, root: Path):
        self.root = root
        self.chapter = Path("whitepaper/ch-one.tex")
        (root / "whitepaper" / "figures").mkdir(parents=True)
        (root / FIGCHECK_REL).mkdir(parents=True)
        (root / "whitepaper" / "textbook.json").write_text(
            json.dumps({"chapters": [{"number": 1, "id": "one", "source": str(self.chapter)}]}),
            encoding="utf-8",
        )
        self.inputs: list[str] = []

    def fragment(self, stem: str, body: str = TIKZ, inputted: bool = True) -> None:
        (self.root / "whitepaper" / "figures" / f"{stem}.tex").write_text(body, encoding="utf-8")
        if inputted:
            self.inputs.append(stem)

    def record(self, stem: str) -> None:
        (self.root / FIGCHECK_REL / f"{stem}.json").write_text(
            json.dumps({"figure": stem, "checks": {}, "summary": {"result": "pass"}}),
            encoding="utf-8",
        )

    def write_chapter(self) -> None:
        lines = ["\\documentclass{article}", "\\begin{document}"]
        lines += ["\\input{figures/%s}" % s for s in self.inputs]
        lines.append("\\end{document}")
        (self.root / self.chapter).write_text("\n".join(lines) + "\n", encoding="utf-8")

    def healthy(self, *stems: str) -> None:
        for stem in stems:
            self.fragment(stem)
            self.record(stem)
        self.write_chapter()


class TestAgreement(unittest.TestCase):
    def test_agreeing_tree_passes(self):
        with TemporaryDirectory() as tmp:
            fx = Fixture(Path(tmp))
            fx.healthy("fig-a", "fig-b")
            res = run(Path(tmp))
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
            self.assertIn("2 live figure fragments", res.stdout)

    def test_record_without_fragment_fails_and_names_it(self):
        with TemporaryDirectory() as tmp:
            fx = Fixture(Path(tmp))
            fx.healthy("fig-a")
            fx.record("fig-ghost")
            res = run(Path(tmp))
            self.assertEqual(res.returncode, 1, res.stdout + res.stderr)
            self.assertIn("fig-ghost", res.stdout)
            self.assertIn("not in the live corpus", res.stdout)

    def test_fragment_without_record_fails_and_names_it(self):
        with TemporaryDirectory() as tmp:
            fx = Fixture(Path(tmp))
            fx.healthy("fig-a")
            fx.fragment("fig-unchecked")
            fx.write_chapter()
            res = run(Path(tmp))
            self.assertEqual(res.returncode, 1, res.stdout + res.stderr)
            self.assertIn("fig-unchecked", res.stdout)
            self.assertIn("no figcheck record", res.stdout)

    def test_both_directions_reported_in_one_run(self):
        with TemporaryDirectory() as tmp:
            fx = Fixture(Path(tmp))
            fx.healthy("fig-a")
            fx.record("fig-ghost")
            fx.fragment("fig-unchecked")
            fx.write_chapter()
            res = run(Path(tmp))
            self.assertEqual(res.returncode, 1)
            self.assertIn("fig-ghost", res.stdout)
            self.assertIn("fig-unchecked", res.stdout)


class TestCorpusRule(unittest.TestCase):
    """REACHED and DRAWS, the two conjuncts, each tested on its own."""

    def test_input_that_draws_nothing_is_excluded(self):
        # A shared macro include (pd-*), a transcript (session-*) and a
        # tabular (tab-*) are all \input by a chapter and open no
        # tikzpicture. None needs a geometry record.
        with TemporaryDirectory() as tmp:
            fx = Fixture(Path(tmp))
            fx.fragment("fig-a")
            fx.record("fig-a")
            fx.fragment("pd-palette", body="\\definecolor{x}{RGB}{0,0,0}\n")
            fx.fragment("session-demo", body="\\begin{verbatim}\n$ ls\n\\end{verbatim}\n")
            fx.fragment("tab-thing", body="\\begin{tabular}{ll}a & b\\\\\\end{tabular}\n")
            fx.write_chapter()
            res = run(Path(tmp))
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
            self.assertIn("1 live figure fragments", res.stdout)

    def test_fragment_no_chapter_inputs_is_an_orphan_not_a_member(self):
        with TemporaryDirectory() as tmp:
            fx = Fixture(Path(tmp))
            fx.healthy("fig-a")
            fx.fragment("fig-dead-weight", inputted=False)
            fx.write_chapter()
            res = run(Path(tmp))
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
            orphans = run(Path(tmp), "--orphans")
            self.assertEqual(orphans.returncode, 0)
            self.assertIn("fig-dead-weight.tex", orphans.stdout)
            self.assertNotIn("fig-a.tex", orphans.stdout)

    def test_corpus_follows_textbook_json_not_a_hard_coded_list(self):
        # Add a second chapter to textbook.json and its figure joins the
        # corpus with no edit to the script.
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            fx = Fixture(root)
            fx.healthy("fig-a")
            (root / "whitepaper" / "two" / "figures").mkdir(parents=True)
            (root / "whitepaper" / "two" / "figures" / "fig-b.tex").write_text(TIKZ, encoding="utf-8")
            (root / "whitepaper" / "two" / "ch-two.tex").write_text(
                "\\begin{document}\\input{figures/fig-b}\\end{document}\n", encoding="utf-8")
            (root / "whitepaper" / "textbook.json").write_text(json.dumps({"chapters": [
                {"number": 1, "id": "one", "source": "whitepaper/ch-one.tex"},
                {"number": 2, "id": "two", "source": "whitepaper/two/ch-two.tex"},
            ]}), encoding="utf-8")
            listing = run(root, "--list")
            self.assertEqual(listing.returncode, 0, listing.stdout + listing.stderr)
            self.assertIn("fig-b", listing.stdout)
            res = run(root)
            self.assertEqual(res.returncode, 1)
            self.assertIn("fig-b", res.stdout)

    def test_missing_chapter_source_is_a_usage_error_not_a_smaller_corpus(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            fx = Fixture(root)
            fx.healthy("fig-a")
            (root / "whitepaper" / "textbook.json").write_text(json.dumps({"chapters": [
                {"number": 1, "id": "one", "source": "whitepaper/ch-one.tex"},
                {"number": 2, "id": "gone", "source": "whitepaper/not-here.tex"},
            ]}), encoding="utf-8")
            res = run(root)
            self.assertEqual(res.returncode, 2, res.stdout + res.stderr)
            self.assertIn("not-here.tex", res.stderr)


class TestJsonMode(unittest.TestCase):
    def test_json_mode_carries_both_directions(self):
        with TemporaryDirectory() as tmp:
            fx = Fixture(Path(tmp))
            fx.healthy("fig-a")
            fx.record("fig-ghost")
            fx.fragment("fig-unchecked")
            fx.write_chapter()
            res = run(Path(tmp), "--json")
            self.assertEqual(res.returncode, 1)
            payload = json.loads(res.stdout)
            self.assertEqual(payload["records_without_fragment"], ["fig-ghost"])
            self.assertEqual(payload["fragments_without_record"], ["fig-unchecked"])
            self.assertEqual(payload["corpus_size"], 2)


class TestThisRepository(unittest.TestCase):
    def test_committed_records_match_the_live_corpus(self):
        res = run(REPO_ROOT)
        self.assertEqual(
            res.returncode, 0,
            "the figcheck records and the live figure corpus disagree:\n" + res.stdout + res.stderr,
        )


if __name__ == "__main__":
    unittest.main()
