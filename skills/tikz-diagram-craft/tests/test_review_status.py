"""Geometric checks cannot grant semantic or reader approval."""
import importlib.util
from pathlib import Path
import unittest

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


if __name__ == '__main__':
    unittest.main()
