"""Geometric checks cannot grant semantic or reader approval."""
import importlib.util
from pathlib import Path
import unittest
import tempfile

import fitz

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/book_figure_qa.py'
spec = importlib.util.spec_from_file_location('book_qa', SCRIPT)
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)


class ReviewStatusTests(unittest.TestCase):
    def test_all_checks_clear_still_needs_design_review(self):
        self.assertEqual(qa.mechanical_label({'pass': True}),
                         'Checks clear; design unreviewed')

    def test_warnings_are_not_promoted_to_clear(self):
        self.assertEqual(qa.mechanical_label({'pass': True, 'beauty_warn': ['B2']}),
                         'Checks: warnings; design unreviewed')

    def test_failure_or_missing_cannot_approve(self):
        for result in (None, {'pass': False}, {'compiled': True}):
            self.assertIn('design unreviewed', qa.mechanical_label(result))


class CropInkTests(unittest.TestCase):
    def test_rules_beyond_text_keep_stroke_width_but_exclude_page_furniture(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'rules.pdf'
            output = Path(tmp) / 'rules.png'
            with fitz.open() as doc:
                page = doc.new_page(width=100, height=100)
                page.insert_text((30, 30), 'label', fontsize=8)
                page.draw_line((20, 70), (80, 70), color=(1, 0, 0), width=8)
                page.draw_line((90, 20), (90, 80), color=(0, 0, 1), width=8)
                page.draw_line((0, 5), (100, 5), width=2)  # page furniture
                page.draw_line((0, 0), (.2, .2), width=.1)  # corner speck
                doc.save(source)
                # Painted bounds are (16,16,94,84), with the existing6pt pad.
                expected = page.get_pixmap(dpi=72, clip=fitz.Rect(10, 10, 100, 90))
            qa.crop(source, output, dpi=72)
            actual = fitz.Pixmap(output)
            self.assertEqual((actual.width, actual.height), (90, 80))
            self.assertEqual(actual.samples, expected.samples)


if __name__ == '__main__':
    unittest.main()
