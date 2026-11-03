"""Exercise navigation regressions, including the full rendered Book.

Set BOOK_EXERCISE_PDF to a converged Book with a matching sibling .aux file.
"""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

import fitz

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('book_exercise_navigation',
    ROOT / 'scripts/harbor-research/check_book_exercise_navigation.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
exercise_navigation = checker.exercise_navigation


class ExerciseEvidenceTests(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / '.cache' / 'exercise-navigation-tests'
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(self.temp.cleanup)
        self.pdf = Path(self.temp.name) / 'book.pdf'
        with fitz.open() as doc:
            doc.new_page()
            doc.save(self.pdf)

    def test_missing_aux_does_not_pass(self):
        with self.assertRaises(FileNotFoundError):
            exercise_navigation(self.pdf)

    def test_empty_inventory_and_no_headings_do_not_pass(self):
        self.pdf.with_suffix('.aux').write_text('')
        result = exercise_navigation(self.pdf)
        self.assertTrue(result['issues'])
        self.assertIn('No exercise labels', '\n'.join(result['issues']))
        self.assertIn('No rendered exercise headings', '\n'.join(result['issues']))


@unittest.skipUnless(os.environ.get('BOOK_EXERCISE_PDF'),
                     'Set BOOK_EXERCISE_PDF to a converged Book with sibling AUX')
class RenderedExerciseNavigationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.audit = exercise_navigation(os.environ['BOOK_EXERCISE_PDF'])

    def test_every_exercise_heading_has_one_label(self):
        labels = self.audit['labels']
        self.assertTrue(labels, 'The rendered audit must find exercises')
        numbers = [label['number'] for label in labels]
        self.assertEqual(len(numbers), len(set(numbers)), 'Exercise numbers must be unique')
        self.assertEqual(set(numbers), set(self.audit['headings']))
        self.assertTrue(all(len(rows) == 1 for rows in self.audit['headings'].values()))

    def test_every_exercise_label_and_destination_follow_its_heading(self):
        self.assertFalse(self.audit['issues'], '\n'.join(self.audit['issues']))
        self.assertEqual(len(self.audit['rows']), len(self.audit['labels']))


if __name__ == '__main__':
    unittest.main()
