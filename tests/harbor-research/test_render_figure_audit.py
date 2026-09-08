#!/usr/bin/env python3
"""Fixture-based tests for scripts/harbor-research/render_figure_audit.py.

stdlib-only (unittest, tempfile, subprocess, json). Each fixture test builds
a small figcheck/ directory (and, where relevant, a FIGURE-TRIAGE.md) under
a tempdir and runs the real script against it with --repo-root. One test
runs --check against this repository's own committed audit outputs and
expects them to already be fresh (render_figure_audit.py --write must have
been run before committing).

Run:
    python3 -m unittest discover -s tests/harbor-research
    python3 tests/harbor-research/test_render_figure_audit.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "harbor-research" / "render_figure_audit.py"

FIGCHECK_REL = Path("docs/harbor-research/exposition/figures/figcheck")
DIGEST_REL = Path("docs/harbor-research/exposition/figures/FIGURE-AUDIT-DIGEST.md")
FAILURES_REL = Path("docs/harbor-research/exposition/figures/FIGURE-AUDIT-FAILURES.md")
BLOCKERS_REL = Path("docs/harbor-research/exposition/figures/blockers.json")
TRIAGE_REL = Path("docs/harbor-research/exposition/figures/FIGURE-TRIAGE.md")


def record(result: str, failed: list[str] | None = None, warned: list[str] | None = None) -> dict:
    failed = failed or []
    warned = warned or []
    checks = {}
    for code in ("T1", "T2", "T3", "T4", "T5", "T6", "T7"):
        status = "fail" if code in failed else ("warn" if code in warned else "pass")
        checks[code] = {
            "status": status,
            "count": 1 if status != "pass" else 0,
            "findings": (
                [{"check": code, "severity": status, "message": f"{code} example finding"}]
                if status != "pass" else []
            ),
        }
    return {
        "pdf": "/tmp/does-not-matter.pdf",
        "page_count": 1,
        "params": {"min_font_pt": 7.0, "textwidth_cm": 11.43},
        "checks": checks,
        "summary": {"result": result, "failed_checks": failed, "warned_checks": warned},
    }


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def run(repo_root: Path, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--repo-root", str(repo_root), *extra],
        capture_output=True, text=True,
    )


class TestRenderFigureAudit(unittest.TestCase):
    def test_committed_outputs_are_fresh(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--check"],
            capture_output=True, text=True, cwd=REPO_ROOT,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
        self.assertIn("fresh", result.stdout)

    def test_write_then_check_is_clean(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_json(root / FIGCHECK_REL / "fig-swk-alpha.json", record("pass"))
            write_json(root / FIGCHECK_REL / "fig-anchor-beta.json", record("fail", failed=["T4"]))
            self.assertEqual(run(root, "--write").returncode, 0)
            check = run(root, "--check")
            self.assertEqual(check.returncode, 0, msg=check.stdout + check.stderr)

    def test_check_fails_when_digest_is_stale(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_json(root / FIGCHECK_REL / "fig-swk-alpha.json", record("pass"))
            self.assertEqual(run(root, "--write").returncode, 0)
            # Now add a new record without re-running --write: the committed
            # digest no longer reflects every figcheck record.
            write_json(root / FIGCHECK_REL / "fig-anchor-beta.json", record("fail", failed=["T1"]))
            check = run(root, "--check")
            self.assertEqual(check.returncode, 1)
            self.assertIn("STALE", check.stderr)

    def test_check_fails_when_digest_hand_edited(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_json(root / FIGCHECK_REL / "fig-swk-alpha.json", record("pass"))
            self.assertEqual(run(root, "--write").returncode, 0)
            digest_path = root / DIGEST_REL
            digest_path.write_text(digest_path.read_text(encoding="utf-8") + "\nhand-edited\n", encoding="utf-8")
            check = run(root, "--check")
            self.assertEqual(check.returncode, 1)
            self.assertIn(str(DIGEST_REL), check.stderr)

    def test_missing_figcheck_dir_is_fatal(self) -> None:
        with TemporaryDirectory() as tmp:
            result = run(Path(tmp), "--check")
            self.assertEqual(result.returncode, 1)
            self.assertIn("does not exist", result.stderr)

    def test_blockers_json_only_lists_t1_t5_and_sorts_deterministically(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_json(root / FIGCHECK_REL / "fig-zzz-last.json", record("fail", failed=["T2"]))
            write_json(root / FIGCHECK_REL / "fig-aaa-first.json", record("fail", failed=["T1"]))
            write_json(root / FIGCHECK_REL / "fig-only-t7.json", record("fail", warned=["T7"]))  # T7 only -> not a blocker
            self.assertEqual(run(root, "--write").returncode, 0)
            blockers = json.loads((root / BLOCKERS_REL).read_text(encoding="utf-8"))
            ids = [b["id"] for b in blockers]
            self.assertEqual(ids, ["fig-aaa-first", "fig-zzz-last"])

    def test_first_seen_is_kept_from_the_committed_file(self) -> None:
        """A blocker's `first_seen` is a fact about the past, so once written
        it survives a re-render even when nothing on disk could re-derive it.

        This is what keeps the freshness check honest across clone depths.
        The date used to come from `git log --follow`, which answers one thing
        in a full clone and another in the shallow one CI checks out
        (`actions/checkout@v4` defaults to `fetch-depth: 1`, so the commit that
        introduced the figcheck record is not in the clone at all) -- so
        blockers.json rendered as stale on every CI run and fresh on every
        developer's machine. The tempdir here is not a git repository, which
        is the sharper version of the same situation."""
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_json(root / FIGCHECK_REL / "fig-swk-alpha.json", record("fail", failed=["T1"]))
            self.assertEqual(run(root, "--write").returncode, 0)

            blockers_path = root / BLOCKERS_REL
            blockers = json.loads(blockers_path.read_text(encoding="utf-8"))
            blockers[0]["first_seen"] = "2024-01-02"
            blockers_path.write_text(json.dumps(blockers, indent=2) + "\n", encoding="utf-8")

            self.assertEqual(run(root, "--write").returncode, 0)
            rewritten = json.loads(blockers_path.read_text(encoding="utf-8"))
            self.assertEqual(rewritten[0]["first_seen"], "2024-01-02")
            self.assertEqual(run(root, "--check").returncode, 0)

    def test_first_seen_is_recorded_for_a_newly_appearing_blocker(self) -> None:
        """Keeping the old dates must not stop a new blocker from getting one."""
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_json(root / FIGCHECK_REL / "fig-swk-alpha.json", record("fail", failed=["T1"]))
            self.assertEqual(run(root, "--write").returncode, 0)

            write_json(root / FIGCHECK_REL / "fig-anchor-beta.json", record("fail", failed=["T4"]))
            self.assertEqual(run(root, "--write").returncode, 0)
            blockers = json.loads((root / BLOCKERS_REL).read_text(encoding="utf-8"))
            by_id = {b["id"]: b["first_seen"] for b in blockers}
            self.assertEqual(sorted(by_id), ["fig-anchor-beta", "fig-swk-alpha"])
            for stem, seen in by_id.items():
                self.assertRegex(seen, r"^\d{4}-\d{2}-\d{2}$", msg=stem)

    def test_waiver_seeded_only_for_delete_or_table_disposition(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_json(root / FIGCHECK_REL / "fig-anchor-gone.json", record("fail", failed=["T1"]))
            write_json(root / FIGCHECK_REL / "fig-anchor-active.json", record("fail", failed=["T4"]))
            (root / TRIAGE_REL).parent.mkdir(parents=True, exist_ok=True)
            (root / TRIAGE_REL).write_text(
                "# triage\n\n## Chapter 2 — Anchor\n\n"
                "| # | fragment | idea | drawn | role | disposition | spec |\n"
                "|---|---|---|---|---|---|---|\n"
                "| 2.1 | fig-anchor-gone | idea | drawn | carries | delete | spec |\n"
                "| 2.2 | fig-anchor-active | idea | drawn | carries | restyle | spec |\n",
                encoding="utf-8",
            )
            self.assertEqual(run(root, "--write").returncode, 0)
            blockers = {b["id"]: b for b in json.loads((root / BLOCKERS_REL).read_text(encoding="utf-8"))}
            self.assertIsNotNone(blockers["fig-anchor-gone"]["waiver"])
            self.assertEqual(blockers["fig-anchor-gone"]["waiver"]["reason"], "retired by triage")
            self.assertIsNone(blockers["fig-anchor-active"]["waiver"])


if __name__ == "__main__":
    unittest.main()
