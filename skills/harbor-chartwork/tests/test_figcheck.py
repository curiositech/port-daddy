"""Unit tests for figcheck.py's geometry checks.

Each test builds a tiny synthetic PDF with PyMuPDF's own drawing primitives
(insert_text / draw_rect / draw_line) rather than compiling TeX -- these tests
exercise figcheck's geometry logic in isolation, independent of tectonic.
"""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

import pymupdf

SCRIPT_PATH = Path(__file__).resolve().parent.parent / "scripts" / "figcheck.py"
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


class TestGeometryPrimitives(unittest.TestCase):
    def test_rect_contains(self):
        outer = (0, 0, 100, 100)
        self.assertTrue(figcheck.rect_contains(outer, (10, 10, 90, 90)))
        self.assertFalse(figcheck.rect_contains(outer, (10, 10, 110, 90)))
        # a 1pt poke is absorbed by tolerance
        self.assertTrue(figcheck.rect_contains(outer, (10, 10, 100.5, 90), tol=0.75))

    def test_rect_overlap_area(self):
        a = (0, 0, 10, 10)
        b = (5, 5, 15, 15)
        self.assertAlmostEqual(figcheck.rect_overlap_area(a, b), 25.0)
        c = (20, 20, 30, 30)
        self.assertEqual(figcheck.rect_overlap_area(a, c), 0.0)

    def test_liang_barsky_clip_through_interior(self):
        rect = (10, 10, 20, 20)
        # a line straight through the middle
        clip = figcheck.liang_barsky_clip((0, 15), (30, 15), rect)
        self.assertIsNotNone(clip)
        self.assertGreater(clip[1] - clip[0], 0)

    def test_liang_barsky_clip_is_boundary_inclusive(self):
        # Liang-Barsky clipping is a plain geometric primitive: a line lying
        # exactly along a rect's edge is reported as clipped (boundary
        # inclusive), same as standard clipping algorithms. It does NOT, by
        # itself, distinguish "grazes the edge" from "crosses the interior"
        # -- that distinction is check_t4's job, which shrinks the text bbox
        # inward by LINE_SHRINK_PT before clipping against it (exercised by
        # TestLineTouchingEdgeOnly below, at the check level).
        rect = (10, 10, 20, 20)
        clip = figcheck.liang_barsky_clip((0, 10), (30, 10), rect)
        self.assertIsNotNone(clip)

    def test_liang_barsky_clip_misses_entirely(self):
        rect = (10, 10, 20, 20)
        clip = figcheck.liang_barsky_clip((0, 0), (5, 5), rect)
        self.assertIsNone(clip)


class TestCleanCase(unittest.TestCase):
    """A well-formed figure: no check should fail, and T6/T7 should not even warn."""

    def setUp(self):
        doc = pymupdf.open()
        page = doc.new_page(width=400, height=300)
        # A box that comfortably contains its label.
        page.draw_rect(pymupdf.Rect(40, 30, 220, 70), color=(0, 0, 0), fill=(0.9, 0.9, 0.9), width=1)
        page.insert_text((55, 55), "well contained", fontsize=10, fontname="helv")
        # A second, unrelated label far away -- should not overlap or collide.
        page.insert_text((55, 200), "a separate label", fontsize=10, fontname="helv")
        # A line that runs nowhere near either label.
        page.draw_line((250, 250), (390, 250), color=(0, 0, 0), width=1)
        self.path = save_temp_pdf(doc)

    def tearDown(self):
        Path(self.path).unlink(missing_ok=True)

    def test_all_hard_checks_pass(self):
        report = figcheck.run_figcheck(self.path, min_font_pt=7.0, textwidth_cm=16.3)
        self.assertEqual(report["summary"]["result"], "pass")
        for c in figcheck.HARD_CHECKS:
            self.assertEqual(report["checks"][c]["status"], "pass", msg=f"{c}: {report['checks'][c]['findings']}")


class TestKnownOverlap(unittest.TestCase):
    """Two distinct text lines whose bboxes overlap well past the 5% floor."""

    def setUp(self):
        doc = pymupdf.open()
        page = doc.new_page(width=400, height=300)
        page.insert_text((50, 100), "first label here", fontsize=14, fontname="helv")
        # Placed to land almost exactly on top of the first -- large overlap.
        page.insert_text((52, 102), "second label", fontsize=14, fontname="helv")
        self.path = save_temp_pdf(doc)

    def tearDown(self):
        Path(self.path).unlink(missing_ok=True)

    def test_t3_fails(self):
        report = figcheck.run_figcheck(self.path)
        self.assertEqual(report["checks"]["T3"]["status"], "fail")
        self.assertEqual(report["summary"]["result"], "fail")
        self.assertIn("T3", report["summary"]["failed_checks"])


class TestKnownEscape(unittest.TestCase):
    """A text line placed so it pokes out past its enclosing filled rect."""

    def setUp(self):
        doc = pymupdf.open()
        page = doc.new_page(width=400, height=300)
        page.draw_rect(pymupdf.Rect(40, 30, 130, 55), color=(0, 0, 0), fill=(0.9, 0.9, 0.9), width=1)
        # Text starts inside the box but runs past its right edge by ~19pt,
        # while its bbox center (~x=97) stays well inside the box (x<130) --
        # a moderate, realistic overflow, not one so extreme the text's
        # center itself exits the box (which check_t2 would no longer treat
        # as "inside a rect region" at all).
        page.insert_text((45, 48), "label overflow text", fontsize=13, fontname="helv")
        self.path = save_temp_pdf(doc)

    def tearDown(self):
        Path(self.path).unlink(missing_ok=True)

    def test_t2_fails(self):
        report = figcheck.run_figcheck(self.path)
        self.assertEqual(report["checks"]["T2"]["status"], "fail")
        self.assertEqual(report["summary"]["result"], "fail")
        self.assertIn("T2", report["summary"]["failed_checks"])


class TestTinyFont(unittest.TestCase):
    def setUp(self):
        doc = pymupdf.open()
        page = doc.new_page(width=400, height=300)
        page.insert_text((50, 50), "microscopic", fontsize=4, fontname="helv")
        self.path = save_temp_pdf(doc)

    def tearDown(self):
        Path(self.path).unlink(missing_ok=True)

    def test_t1_fails_below_floor(self):
        report = figcheck.run_figcheck(self.path, min_font_pt=7.0)
        self.assertEqual(report["checks"]["T1"]["status"], "fail")
        self.assertEqual(report["summary"]["result"], "fail")

    def test_t1_passes_with_lower_floor(self):
        report = figcheck.run_figcheck(self.path, min_font_pt=3.0)
        self.assertEqual(report["checks"]["T1"]["status"], "pass")


class TestLineThroughText(unittest.TestCase):
    def setUp(self):
        doc = pymupdf.open()
        page = doc.new_page(width=400, height=300)
        page.insert_text((50, 100), "struck through", fontsize=16, fontname="helv")
        # A horizontal line drawn straight through the middle of the text's
        # vertical extent, spanning well past both ends horizontally.
        page.draw_line((30, 94), (250, 94), color=(0, 0, 0), width=1)
        self.path = save_temp_pdf(doc)

    def tearDown(self):
        Path(self.path).unlink(missing_ok=True)

    def test_t4_fails(self):
        report = figcheck.run_figcheck(self.path)
        self.assertEqual(report["checks"]["T4"]["status"], "fail")
        self.assertEqual(report["summary"]["result"], "fail")


class TestLineTouchingEdgeOnly(unittest.TestCase):
    """A line that runs along just under the text's baseline (touching the
    bbox's bottom edge, not crossing its interior) must NOT trip T4."""

    def setUp(self):
        doc = pymupdf.open()
        page = doc.new_page(width=400, height=300)
        page.insert_text((50, 100), "underlined-ish", fontsize=12, fontname="helv")
        td_probe = page.get_text("dict")
        line_bbox = None
        for b in td_probe["blocks"]:
            if b["type"] == 0:
                line_bbox = b["lines"][0]["bbox"]
        # Draw a rule exactly along the bottom edge of the measured bbox.
        y = line_bbox[3]
        page.draw_line((20, y), (300, y), color=(0, 0, 0), width=0.5)
        self.path = save_temp_pdf(doc)

    def tearDown(self):
        Path(self.path).unlink(missing_ok=True)

    def test_t4_passes_for_edge_graze(self):
        report = figcheck.run_figcheck(self.path)
        self.assertEqual(report["checks"]["T4"]["status"], "pass", msg=report["checks"]["T4"]["findings"])


class TestOutsideMediaBox(unittest.TestCase):
    def setUp(self):
        doc = pymupdf.open()
        page = doc.new_page(width=200, height=200)
        page.insert_text((-40, 50), "off the left edge", fontsize=10, fontname="helv")
        self.path = save_temp_pdf(doc)

    def tearDown(self):
        Path(self.path).unlink(missing_ok=True)

    def test_t5_fails(self):
        report = figcheck.run_figcheck(self.path)
        self.assertEqual(report["checks"]["T5"]["status"], "fail")
        self.assertEqual(report["summary"]["result"], "fail")


class TestDeadCanvasWarns(unittest.TestCase):
    def setUp(self):
        doc = pymupdf.open()
        page = doc.new_page(width=1000, height=1000)
        page.insert_text((10, 20), "tiny corner", fontsize=8, fontname="helv")
        self.path = save_temp_pdf(doc)

    def tearDown(self):
        Path(self.path).unlink(missing_ok=True)

    def test_t6_warns_but_does_not_fail_build(self):
        report = figcheck.run_figcheck(self.path)
        self.assertEqual(report["checks"]["T6"]["status"], "warn")
        self.assertIn("T6", report["summary"]["warned_checks"])
        # T6 is warn-only: it must never be the reason the overall result fails.
        self.assertNotIn("T6", figcheck.HARD_CHECKS)


class TestWideContentWarns(unittest.TestCase):
    def setUp(self):
        doc = pymupdf.open()
        page = doc.new_page(width=900, height=200)
        page.draw_line((10, 100), (880, 100), color=(0, 0, 0), width=1)
        self.path = save_temp_pdf(doc)

    def tearDown(self):
        Path(self.path).unlink(missing_ok=True)

    def test_t7_warns_when_wider_than_textwidth(self):
        # 880-10 = 870pt =~ 30.7cm, comfortably over a 16.3cm textwidth.
        report = figcheck.run_figcheck(self.path, textwidth_cm=16.3)
        self.assertEqual(report["checks"]["T7"]["status"], "warn")
        self.assertNotIn("T7", figcheck.HARD_CHECKS)


class TestCLI(unittest.TestCase):
    def setUp(self):
        doc = pymupdf.open()
        page = doc.new_page(width=400, height=300)
        page.insert_text((50, 50), "fine", fontsize=10, fontname="helv")
        self.path = save_temp_pdf(doc)
        self.out_dir = tempfile.mkdtemp()

    def tearDown(self):
        Path(self.path).unlink(missing_ok=True)

    def test_main_writes_json_and_md_and_exits_zero(self):
        json_path = str(Path(self.out_dir) / "out.json")
        md_path = str(Path(self.out_dir) / "out.md")
        status = figcheck.main([self.path, "--json", json_path, "--md", md_path])
        self.assertEqual(status, 0)
        self.assertTrue(Path(json_path).is_file())
        self.assertTrue(Path(md_path).is_file())
        self.assertIn("figcheck", Path(md_path).read_text())

    def test_main_nonzero_exit_on_missing_file(self):
        status = figcheck.main(["/no/such/file.pdf"])
        self.assertEqual(status, 2)


if __name__ == "__main__":
    unittest.main()
