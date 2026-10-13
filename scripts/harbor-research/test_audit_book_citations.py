"""Constructed counterexamples for citation accounting, not render acceptance."""
import tempfile
from pathlib import Path
import unittest

from audit_book_citations import audit


class CitationAccountingTests(unittest.TestCase):
    def setUp(self):
        cache = Path(__file__).resolve().parents[2] / '.cache'
        cache.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='citation-audit-test-', dir=cache)
        self.addCleanup(self.temp.cleanup)
        self.stem = Path(self.temp.name) / 'book'
        self.log = '''PD-BOOK-CITE-CAPACITY: 592.614pt
PD-MARGIN-REGISTER: id=1,kind=citation, line=12, height=40pt
PD-MARGIN-PLACED: id=1, page=1,top=70pt, height=40pt
PD-BOOK-SOURCE: key=one, form=full
PD-BOOK-CITE-SHARED: occurrence=2
PD-BOOK-CITE-SUMMARY: occurrences=2, sources=1, registered=1
'''
        self.aux = r'''\zref@newlabel{pdm-1}{\posx{1}\posy{2}\abspage{1}}
\pdbookcitationrecord{1}{one}{body}{}
\pdbookcitationrecord{2}{one}{body}{}
'''

    def run_audit(self):
        self.stem.with_suffix('.log').write_text(self.log)
        self.stem.with_suffix('.aux').write_text(self.aux)
        return audit(self.stem)

    def test_shared_note_preserves_both_occurrences(self):
        result = self.run_audit()
        self.assertEqual(result['occurrences'], 2)
        self.assertEqual(result['shared_occurrences'], 1)
        self.assertEqual(result['issues'], [])

    def test_a_lost_occurrence_is_rejected(self):
        self.aux = self.aux.replace(r'\pdbookcitationrecord{2}{one}{body}{}', '')
        self.assertIn('Missing or duplicate shipped citation occurrence.', self.run_audit()['issues'])

    def test_a_trial_that_consumes_first_use_is_rejected(self):
        self.log = self.log.replace('key=one, form=full', 'key=one, form=repeat')
        self.assertTrue(any('exactly one full entry' in str(i) for i in self.run_audit()['issues']))

    def test_an_unplaced_box_is_rejected(self):
        self.log = self.log.replace('PD-MARGIN-PLACED: id=1, page=1,top=70pt, height=40pt', '')
        self.assertTrue(any('missing or duplicate shipped' in str(i) for i in self.run_audit()['issues']))

    def test_capacity_failure_is_not_hidden_by_accounting(self):
        self.log = self.log.replace('height=40pt', 'height=700pt')
        self.assertEqual(len(self.run_audit()['overcapacity_pages']), 1)
        self.assertTrue(self.run_audit()['issues'])

    def test_intermediate_geometry_is_not_accepted(self):
        self.log += 'PD-MARGIN-CONVERGENCE: pending\n'
        self.assertIn('Margin geometry has not converged; rerun before accepting the PDF.',
                      self.run_audit()['issues'])


if __name__ == '__main__':
    unittest.main()
