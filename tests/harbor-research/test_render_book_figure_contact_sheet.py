#!/usr/bin/env python3
"""Focused tests for render_book_figure_contact_sheet.py.

The fixtures are authored directly with PyMuPDF.  They need neither TeX nor a
chapter/Book build and exercise both QA-results and rendered-media inputs.
"""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import fitz


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "harbor-research" / "render_book_figure_contact_sheet.py"
EDITIONS = ("swiss", "maritime", "technical")


def make_pdf(path: Path, label: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = fitz.open()
    page = doc.new_page(width=504, height=720)
    page.draw_rect(fitz.Rect(80, 90, 424, 330), color=(0.1, 0.2, 0.5), width=2)
    page.insert_text((100, 130), label, fontsize=14, fontname="hebo")
    page.insert_text((100, 165), "Book-scale synthetic figure", fontsize=10, fontname="helv")
    doc.save(path)
    doc.close()


def make_png(path: Path, label: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = fitz.open()
    page = doc.new_page(width=360, height=240)
    page.draw_rect(fitz.Rect(20, 20, 340, 220), color=(0.1, 0.2, 0.5), width=2)
    page.insert_text((42, 90), label, fontsize=18, fontname="hebo")
    page.get_pixmap(dpi=150, alpha=False).save(path)
    doc.close()


def qa_record(
    slug: str,
    edition: str,
    *,
    passed: bool = True,
    failures: list[str] | None = None,
    warnings: list[str] | None = None,
) -> dict:
    return {
        "figure": slug,
        "edition": edition,
        "compiled": True,
        "beauty_fail": [],
        "beauty_warn": warnings or [],
        "figcheck_fail": failures or [],
        "ink_width_in": 4.48,
        "too_wide": False,
        "pass": passed,
    }


def run_script(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )


class BookFigureContactSheetTests(unittest.TestCase):
    def test_qa_roots_become_readable_edition_pages(self) -> None:
        with TemporaryDirectory(dir=REPO_ROOT / ".cache") as tmp:
            root = Path(tmp) / "qa"
            output = Path(tmp) / "review.pdf"
            records = []
            for slug in ("fig-alpha", "fig-beta"):
                for edition in EDITIONS:
                    failed = slug == "fig-beta" and edition == "maritime"
                    records.append(
                        qa_record(
                            slug,
                            edition,
                            passed=not failed,
                            failures=["T4"] if failed else [],
                            warnings=["B2"] if slug == "fig-alpha" and edition == "swiss" else [],
                        )
                    )
                    make_pdf(root / edition / slug / f"{slug}.pdf", f"{slug} / {edition}")
            root.mkdir(parents=True, exist_ok=True)
            (root / "results.json").write_text(json.dumps(records), encoding="utf-8")

            result = run_script(str(root), "--output", str(output))
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertIn("2-page contact sheet", result.stdout)
            self.assertIn("PASS 1 | FAIL 1", result.stdout)

            with fitz.open(output) as review:
                self.assertEqual(review.page_count, 2)
                self.assertAlmostEqual(review[0].rect.width, 17 * 72)
                self.assertAlmostEqual(review[0].rect.height, 11 * 72)
                first = review[0].get_text()
                second = review[1].get_text()
                self.assertIn("fig-alpha", first)
                self.assertIn("SWISS", first)
                self.assertIn("MARITIME", first)
                self.assertIn("TECHNICAL", first)
                self.assertIn("Checks clear | warn B2 | ink 4.48 in", first)
                self.assertIn("DESIGN UNREVIEWED", first)
                self.assertNotIn("FIGURE PASS", first)
                self.assertIn("DESIGN UNREVIEWED", second)
                self.assertIn("Checks failed | fail T4 | ink 4.48 in", second)
                self.assertEqual([item[1] for item in review.get_toc()], ["fig-alpha", "fig-beta"])

    def test_missing_edition_is_explicit_instead_of_dropping_the_figure(self) -> None:
        with TemporaryDirectory(dir=REPO_ROOT / ".cache") as tmp:
            root = Path(tmp) / "qa"
            output = Path(tmp) / "review.pdf"
            record = qa_record("fig-partial", "swiss")
            make_pdf(root / "swiss" / "fig-partial" / "fig-partial.pdf", "partial")
            (root / "results.json").write_text(json.dumps([record]), encoding="utf-8")

            result = run_script(str(root), "--output", str(output))
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertIn("missing panels 2", result.stdout)
            with fitz.open(output) as review:
                text = review[0].get_text()
                self.assertIn("DESIGN UNREVIEWED", text)
                self.assertEqual(text.count("MISSING EDITION ARTIFACT"), 2)

    def test_stale_passing_qa_without_a_render_is_not_reported_as_pass(self) -> None:
        with TemporaryDirectory(dir=REPO_ROOT / ".cache") as tmp:
            root = Path(tmp) / "qa"
            output = Path(tmp) / "review.pdf"
            root.mkdir(parents=True, exist_ok=True)
            records = [qa_record("fig-stale", edition) for edition in EDITIONS]
            (root / "results.json").write_text(json.dumps(records), encoding="utf-8")

            result = run_script(str(root), "--output", str(output))
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertIn("PASS 0 | FAIL 1", result.stdout)
            self.assertIn("missing panels 3", result.stdout)
            with fitz.open(output) as review:
                text = review[0].get_text()
                self.assertIn("DESIGN UNREVIEWED", text)
                self.assertEqual(text.count("MISSING | QA PASS | no rendered artifact"), 3)

    def test_direct_rendered_media_is_accepted_and_marked_unassessed(self) -> None:
        with TemporaryDirectory(dir=REPO_ROOT / ".cache") as tmp:
            root = Path(tmp) / "renders"
            output = Path(tmp) / "review.pdf"
            for edition in EDITIONS:
                make_png(root / edition / "fig-direct" / "fig-direct.png", edition)

            result = run_script(str(root), "--output", str(output))
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertIn("UNASSESSED 1", result.stdout)
            with fitz.open(output) as review:
                text = review[0].get_text()
                self.assertIn("DESIGN UNREVIEWED", text)
                self.assertEqual(text.count("UNASSESSED | rendered artifact only"), 3)

    def test_matching_shared_qa_entry_is_deduplicated(self) -> None:
        with TemporaryDirectory(dir=REPO_ROOT / ".cache") as tmp:
            tmp_path = Path(tmp)
            roots = [tmp_path / "chapter-5", tmp_path / "chapter-6"]
            for root in roots:
                records = []
                for edition in EDITIONS:
                    records.append(qa_record("tab-shared", edition))
                    make_pdf(root / edition / "tab-shared" / "tab-shared.pdf", edition)
                (root / "results.json").write_text(json.dumps(records), encoding="utf-8")
            output = tmp_path / "review.pdf"

            result = run_script(*(str(root) for root in roots), "--output", str(output))
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            with fitz.open(output) as review:
                self.assertEqual(review.page_count, 1)

    def test_conflicting_shared_qa_verdict_is_fatal(self) -> None:
        with TemporaryDirectory(dir=REPO_ROOT / ".cache") as tmp:
            tmp_path = Path(tmp)
            roots = [tmp_path / "left", tmp_path / "right"]
            for index, root in enumerate(roots):
                root.mkdir(parents=True, exist_ok=True)
                record = qa_record("fig-conflict", "swiss", passed=index == 0)
                (root / "results.json").write_text(json.dumps([record]), encoding="utf-8")
            output = tmp_path / "review.pdf"

            result = run_script(*(str(root) for root in roots), "--output", str(output))
            self.assertEqual(result.returncode, 2)
            self.assertIn("conflicting QA verdicts", result.stderr)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
