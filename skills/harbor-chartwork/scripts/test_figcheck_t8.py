"""Unit tests for figcheck.py's T8 (caption collision) check. Follows the
same synthetic-PDF-via-pymupdf pattern as
skills/harbor-chartwork/tests/test_figcheck.py."""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

import pymupdf

SCRIPT_PATH = Path(__file__).resolve().parent / "figcheck.py"
spec = importlib.util.spec_from_file_location("figcheck", SCRIPT_PATH)
figcheck = importlib.util.module_from_spec(spec)
sys.modules["figcheck"] = figcheck
spec.loader.exec_module(figcheck)


def save_temp_pdf(doc):
    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp.close()
    doc.save(tmp.name)
    doc.close()
    return tmp.name


class TestCaptionCollisionFromDrawing(unittest.TestCase):
    """A two-line PDF: a "figure" line of artwork text plus a caption line
    ("Figure 1: ..."), with a filled rect drawn so it crosses into the
    caption's own text line -- T8 must fail."""

    def setUp(self):
        doc = pymupdf.open()
        page = doc.new_page(width=400, height=300)
        page.insert_text((50, 50), "artwork label", fontsize=10, fontname="helv")
        page.insert_text((50, 250), "Figure 1: the seven-organ stack.", fontsize=9, fontname="helv")
        # A drawn rect that reaches down into the caption line's bbox.
        page.draw_rect(pymupdf.Rect(40, 200, 300, 253), color=(0, 0, 0), width=1)
        self.path = save_temp_pdf(doc)

    def tearDown(self):
        Path(self.path).unlink(missing_ok=True)

    def test_t8_fails_on_drawing_over_caption(self):
        report = figcheck.run_figcheck(self.path)
        self.assertEqual(report["checks"]["T8"]["status"], "fail")
        self.assertEqual(report["summary"]["result"], "fail")
        self.assertIn("T8", report["summary"]["failed_checks"])
        finding = report["checks"]["T8"]["findings"][0]
        self.assertIn("caption_bbox", finding)
        self.assertIn("bbox", finding)
        self.assertIn("Figure 1", finding["caption_text"])


class TestCaptionCollisionFromText(unittest.TestCase):
    """A figure text span placed so it overlaps the caption line's own
    bbox -- T8 must fail even with no vector drawing involved. (The two
    lines land close enough that pymupdf groups them into one text
    *block* -- exactly why T8 identifies the caption at line, not block,
    granularity: see check_t8's docstring.)"""

    def setUp(self):
        doc = pymupdf.open()
        page = doc.new_page(width=400, height=300)
        page.insert_text((50, 250), "Table 2 revenue by quarter", fontsize=9, fontname="helv")
        # Placed to overlap the caption line's bbox almost exactly.
        page.insert_text((52, 251), "stray figure text", fontsize=9, fontname="helv")
        self.path = save_temp_pdf(doc)

    def tearDown(self):
        Path(self.path).unlink(missing_ok=True)

    def test_t8_fails_on_text_over_caption(self):
        report = figcheck.run_figcheck(self.path)
        self.assertEqual(report["checks"]["T8"]["status"], "fail")
        self.assertEqual(report["summary"]["result"], "fail")


class TestNoCaptionCollision(unittest.TestCase):
    """Artwork and caption kept well apart -- T8 must pass clean."""

    def setUp(self):
        doc = pymupdf.open()
        page = doc.new_page(width=400, height=300)
        page.insert_text((50, 50), "artwork label", fontsize=10, fontname="helv")
        page.draw_rect(pymupdf.Rect(40, 30, 220, 70), color=(0, 0, 0), width=1)
        page.insert_text((50, 250), "Figure 3: a clean render.", fontsize=9, fontname="helv")
        self.path = save_temp_pdf(doc)

    def tearDown(self):
        Path(self.path).unlink(missing_ok=True)

    def test_t8_passes(self):
        report = figcheck.run_figcheck(self.path)
        self.assertEqual(report["checks"]["T8"]["status"], "pass", msg=report["checks"]["T8"]["findings"])
        self.assertEqual(report["summary"]["result"], "pass")


class TestFallbackToLowestBlockWhenNoCaptionPrefix(unittest.TestCase):
    """No block starts with "Figure"/"Table" -- T8 must fall back to the
    lowest text block on the page as the presumed caption, and still catch
    a drawing that crosses into it."""

    def setUp(self):
        doc = pymupdf.open()
        page = doc.new_page(width=400, height=300)
        page.insert_text((50, 50), "artwork label", fontsize=10, fontname="helv")
        page.insert_text((50, 250), "a caption with no prefix", fontsize=9, fontname="helv")
        page.draw_rect(pymupdf.Rect(40, 200, 300, 253), color=(0, 0, 0), width=1)
        self.path = save_temp_pdf(doc)

    def tearDown(self):
        Path(self.path).unlink(missing_ok=True)

    def test_t8_fails_using_fallback_lowest_block(self):
        report = figcheck.run_figcheck(self.path)
        self.assertEqual(report["checks"]["T8"]["status"], "fail")


class TestFindCaptionLinesHelper(unittest.TestCase):
    def test_prefers_figure_table_prefixed_line(self):
        lines = [
            {"block_no": 0, "line_no": 0, "bbox": (0, 0, 10, 10), "text": "some artwork text"},
            {"block_no": 1, "line_no": 0, "bbox": (0, 90, 10, 100), "text": "Figure 4: a caption."},
        ]
        found = figcheck.find_caption_lines(lines)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["text"], "Figure 4: a caption.")

    def test_falls_back_to_lowest_line(self):
        lines = [
            {"block_no": 0, "line_no": 0, "bbox": (0, 0, 10, 10), "text": "top text"},
            {"block_no": 1, "line_no": 0, "bbox": (0, 90, 10, 100), "text": "bottom text, no prefix"},
        ]
        found = figcheck.find_caption_lines(lines)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["text"], "bottom text, no prefix")


if __name__ == "__main__":
    unittest.main()
