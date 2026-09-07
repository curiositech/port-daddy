#!/usr/bin/env python3
"""Fixture-based tests for skills/tufte-evidence-design/scripts/tufte.py.

stdlib-only (unittest, tempfile, subprocess). Runs the real CLI as a
subprocess against small fixtures under a tempdir, the same pattern as
test_margin_lint.py and test_check_marginalia_sidecars.py.

Run:
    python3 -m unittest discover -s tests/harbor-research
    python3 tests/harbor-research/test_tufte_cli.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
CLI = REPO_ROOT / "skills" / "tufte-evidence-design" / "scripts" / "tufte.py"


def run_cli(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(CLI), *args], capture_output=True, text=True)


def write_all_ink_png(path: Path) -> None:
    """A synthetic PNG with no single dominant color (many equal-sized
    stripes), so ink_audit's auto-detected background is a small minority
    and ink_fraction reads high -- the same construction figcheck's own
    ink-metrics test uses, built directly with PyMuPDF to avoid a Pillow
    dependency in this test."""
    import pymupdf
    doc = pymupdf.open()
    page = doc.new_page(width=200, height=200)
    n = 25
    w = 200 / n
    for i in range(n):
        color = (((i * 37) % 256) / 255.0, ((i * 91) % 256) / 255.0, ((i * 151) % 256) / 255.0)
        page.draw_rect(pymupdf.Rect(i * w, 0, (i + 1) * w, 200), color=color, fill=color, width=0)
    pix = page.get_pixmap()
    pix.save(str(path))
    doc.close()


def write_blank_png(path: Path) -> None:
    import pymupdf
    doc = pymupdf.open()
    page = doc.new_page(width=200, height=200)
    pix = page.get_pixmap()
    pix.save(str(path))
    doc.close()


class TestAuditSubcommand(unittest.TestCase):
    def test_audit_clean_image_exits_zero_even_without_strict(self) -> None:
        with TemporaryDirectory() as tmp:
            png = Path(tmp) / "blank.png"
            write_blank_png(png)
            result = run_cli(["audit", str(png)])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)

    def test_audit_flagged_image_exits_zero_without_strict(self) -> None:
        with TemporaryDirectory() as tmp:
            png = Path(tmp) / "allink.png"
            write_all_ink_png(png)
            result = run_cli(["audit", str(png)])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertIn("high for a data graphic", result.stdout)

    def test_audit_flagged_image_exits_nonzero_with_strict(self) -> None:
        with TemporaryDirectory() as tmp:
            png = Path(tmp) / "allink.png"
            write_all_ink_png(png)
            result = run_cli(["audit", str(png), "--strict"])
            self.assertEqual(result.returncode, 1)

    def test_audit_missing_file_exits_nonzero(self) -> None:
        result = run_cli(["audit", "/no/such/file.png"])
        self.assertEqual(result.returncode, 1)
        self.assertIn("no such file", result.stdout)

    def test_audit_json_output_is_parseable(self) -> None:
        with TemporaryDirectory() as tmp:
            png = Path(tmp) / "blank.png"
            write_blank_png(png)
            result = run_cli(["audit", str(png), "--json"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(len(data), 1)
            self.assertIn("ink_fraction", data[0])


class TestMarginLintSubcommand(unittest.TestCase):
    def test_delegates_to_margin_lint_and_passes_repo_root(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = repo / "ch.tex"
            chapter.write_text(
                "\\section{Intro}\nPlain prose, no margin apparatus.\n",
                encoding="utf-8",
            )
            result = run_cli(["margin-lint", str(chapter), "--repo-root", str(repo)])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertIn("no findings", result.stdout)

    def test_delegates_a_real_violation(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = repo / "ch.tex"
            chapter.write_text(
                "\\section{Intro}\nA claim needs provenance.\\footnote{elsewhere.}\n",
                encoding="utf-8",
            )
            result = run_cli(["margin-lint", str(chapter), "--repo-root", str(repo), "--json"])
            self.assertEqual(result.returncode, 0)  # footnote rule is advisory
            findings = json.loads(result.stdout)
            self.assertEqual(findings[0]["rule"], "no-footnote-in-body")


class TestChecklistSubcommand(unittest.TestCase):
    def test_no_argument_lists_kinds(self) -> None:
        result = run_cli(["checklist"])
        self.assertEqual(result.returncode, 0)
        self.assertIn("sparklines", result.stdout)
        self.assertIn("margin-apparatus", result.stdout)

    def test_sparklines_kind_prints_its_checklist(self) -> None:
        result = run_cli(["checklist", "sparklines"])
        self.assertEqual(result.returncode, 0)
        self.assertIn("word/line-height sized", result.stdout)

    def test_unknown_kind_exits_nonzero(self) -> None:
        result = run_cli(["checklist", "not-a-real-kind-at-all"])
        self.assertEqual(result.returncode, 2)


class TestDecisionTreeSubcommand(unittest.TestCase):
    def test_prints_the_mermaid_flowchart(self) -> None:
        result = run_cli(["decision-tree"])
        self.assertEqual(result.returncode, 0)
        self.assertIn("flowchart TD", result.stdout)
        self.assertIn("critiques-and-limits.md", result.stdout)


class TestUsageErrors(unittest.TestCase):
    def test_no_subcommand_exits_nonzero(self) -> None:
        result = run_cli([])
        self.assertNotEqual(result.returncode, 0)

    def test_unknown_subcommand_exits_nonzero(self) -> None:
        result = run_cli(["not-a-subcommand"])
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
