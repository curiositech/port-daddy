#!/usr/bin/env python3
"""Smoke tests for audit_skill_bundle.py.

stdlib-only (unittest). Runs the auditor as a subprocess against synthetic
skill bundles built in a tempdir, then asserts on the JSON it emits. We test
behaviour through the public CLI surface — that's what every consumer
(pre-commit hook, CI, webpage prebuild) actually uses.

Run:
    python3 -m unittest skills/skill-hygiene/tests/test_audit_skill_bundle.py
"""

from __future__ import annotations

import json
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUDITOR = HERE.parent / "scripts" / "audit_skill_bundle.py"


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(content).lstrip("\n"), encoding="utf-8")


def run_audit(bundle: Path) -> tuple[int, dict]:
    result = subprocess.run(
        ["python3", str(AUDITOR), str(bundle), "--json"],
        capture_output=True, text=True,
    )
    return result.returncode, json.loads(result.stdout)


class TestAuditor(unittest.TestCase):

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.bundle = Path(self.tmp.name) / "test-skill"
        self.bundle.mkdir()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _skill_md(self, body: str = "") -> str:
        return (
            "---\nname: test-skill\ndescription: t\n---\n\n# Test Skill\n" + body
        )

    def test_clean_bundle_passes(self) -> None:
        write(self.bundle / "SKILL.md", self._skill_md())
        rc, report = run_audit(self.bundle)
        self.assertEqual(rc, 0)
        self.assertTrue(report["ok"])
        self.assertEqual(report["orphans"], [])

    def test_orphan_doc_is_flagged(self) -> None:
        write(self.bundle / "SKILL.md", self._skill_md())
        write(self.bundle / "references" / "INDEX.md",
              "# References\n\n| File | When |\n|---|---|\n")
        write(self.bundle / "references" / "alpha.md", "# Alpha")
        write(self.bundle / "references" / "beta.md", "# Beta")
        rc, report = run_audit(self.bundle)
        self.assertEqual(rc, 1)
        # Both refs are orphans because INDEX.md doesn't mention either.
        self.assertIn("references/alpha.md", report["orphans"])
        self.assertIn("references/beta.md", report["orphans"])

    def test_indexed_doc_is_not_orphan(self) -> None:
        write(self.bundle / "SKILL.md", self._skill_md(
            "\nSee `references/INDEX.md` for the deep dives.\n"))
        write(self.bundle / "references" / "INDEX.md",
              "# References\n\n- [alpha.md](alpha.md): you need alpha.\n")
        write(self.bundle / "references" / "alpha.md", "# Alpha")
        rc, report = run_audit(self.bundle)
        self.assertEqual(rc, 0, msg=str(report))

    def test_broken_link_with_typo_suggestion(self) -> None:
        write(self.bundle / "SKILL.md", self._skill_md(
            "\nSee [the alpha](references/alfa.md) and [INDEX](references/INDEX.md).\n"))
        write(self.bundle / "references" / "INDEX.md",
              "# References\n\n- [alpha.md](alpha.md): you need alpha.\n")
        write(self.bundle / "references" / "alpha.md", "# Alpha")
        rc, report = run_audit(self.bundle)
        self.assertEqual(rc, 1)
        self.assertEqual(len(report["broken_links"]), 1)
        broken = report["broken_links"][0]
        self.assertEqual(broken["target"], "references/alfa.md")
        self.assertIn("alpha.md", broken["suggestions"])

    def test_placeholder_link_is_not_broken(self) -> None:
        # `[text](path)` used as a markdown-syntax demo should not be flagged.
        write(self.bundle / "SKILL.md", self._skill_md(
            "\nWe parse inline `[text](path)` links and reference `[text][label]` form.\n"))
        rc, report = run_audit(self.bundle)
        self.assertEqual(rc, 0)
        self.assertEqual(report["broken_links"], [])

    def test_missing_index_warning_when_skill_md_inlines(self) -> None:
        # SKILL.md names both files directly — no INDEX needed (warning, not fail).
        write(self.bundle / "SKILL.md", self._skill_md(
            "\nSee `references/alpha.md` and `references/beta.md`.\n"))
        write(self.bundle / "references" / "alpha.md", "# Alpha")
        write(self.bundle / "references" / "beta.md", "# Beta")
        rc, report = run_audit(self.bundle)
        self.assertEqual(rc, 0, msg=str(report))
        self.assertIn("references", report["missing_indexes_warning"])
        self.assertNotIn("references", report["missing_indexes_failure"])

    def test_missing_index_failure_when_files_unreferenced(self) -> None:
        write(self.bundle / "SKILL.md", self._skill_md())
        write(self.bundle / "references" / "alpha.md", "# Alpha")
        write(self.bundle / "references" / "beta.md", "# Beta")
        rc, report = run_audit(self.bundle)
        self.assertEqual(rc, 1)
        self.assertIn("references", report["missing_indexes_failure"])

    def test_ghost_entry_detected(self) -> None:
        write(self.bundle / "SKILL.md", self._skill_md())
        write(self.bundle / "references" / "INDEX.md", textwrap.dedent("""
            # References

            | File | When |
            |---|---|
            | `alpha.md` | always |
            | `gone.md` | never |
        """).strip())
        write(self.bundle / "references" / "alpha.md", "# Alpha")
        rc, report = run_audit(self.bundle)
        self.assertEqual(rc, 1)
        # gone.md is in INDEX but missing from disk anywhere in bundle.
        found = False
        for d in report["drift"]:
            if "ghost_entries" in d and "gone.md" in d["ghost_entries"]:
                found = True
        self.assertTrue(found, msg=f"expected gone.md ghost in {report['drift']}")

    def test_assets_are_not_orphans(self) -> None:
        write(self.bundle / "SKILL.md", self._skill_md(
            "\nSee `references/alpha.md`.\n"))
        write(self.bundle / "references" / "alpha.md",
              "# Alpha\n\n![diagram](alpha.svg)")
        # SVG asset — should not be flagged as orphan even though no INDEX
        # explicitly lists it.
        (self.bundle / "references" / "alpha.svg").write_bytes(b"<svg/>")
        rc, report = run_audit(self.bundle)
        self.assertEqual(rc, 0, msg=str(report))
        self.assertNotIn("references/alpha.svg", report["orphans"])

    def test_no_skill_md_returns_exit_2(self) -> None:
        empty = Path(self.tmp.name) / "empty"
        empty.mkdir()
        result = subprocess.run(
            ["python3", str(AUDITOR), str(empty), "--json"],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
