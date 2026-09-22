"""Figure scope and native-page geometry; not a crash/durability experiment."""
import importlib.util
import os
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'whitepaper/figures/fig-swk-durability-dramatization.tex'


def contract(text):
    drawing = text[text.index(r'\begin{figure}'):]
    for required in ('commit acknowledged', 'claim', '+ note', r'WAL in\\OS cache',
                     'stable storage', 'sync not established', 'WAL / NORMAL',
                     r'Fault at $t_0+5\,\mathrm{ms}$', r'daemon\\killed',
                     r'power\\lost', r'OS/cache\\intact', r'cache\\erased',
                     'record survives', 'record may be lost', 'I1a: Built',
                     'I1b: NotGuar', 'OS and database/WAL state intact',
                     'five-millisecond interval is illustrative'):
        assert required in drawing, required
    for forbidden in (r'\resizebox', r'\scalebox', r'\tiny', r'\scriptsize',
                      r'\fontsize', 'transform shape', 'only at the next checkpoint'):
        assert forbidden not in drawing, forbidden
    assert drawing.count(r'\caption{') == 1
    assert drawing.count(r'\label{fig:swk-durability-dramatization}') == 1
    assert r'\SGMeasuredFigure{swk-durability-dramatization}' in drawing


class DurabilityFigure(unittest.TestCase):
    def test_semantic_contract(self):
        contract(SOURCE.read_text())

    def test_reject_false_certainty_and_shrinking(self):
        source = SOURCE.read_text()
        for before, after in [('record may be lost', 'record is lost'),
                              ('sync not established', 'sync guaranteed'),
                              ('I1b: NotGuar', 'I1b: Built'),
                              ('interval is illustrative', 'interval was measured')]:
            with self.subTest(after=after), self.assertRaises(AssertionError):
                contract(source.replace(before, after))
        with self.assertRaises(AssertionError):
            contract(source + r'\scalebox{.5}{x}')

    @unittest.skipUnless(os.environ.get('BOOK_DURABILITY_PDF'), 'assembled PDF not supplied')
    def test_native_page_labels_and_ink(self):
        import fitz
        path = Path(os.environ['BOOK_DURABILITY_PDF'])
        spec = importlib.util.spec_from_file_location('migration', ROOT / 'scripts/harbor-research/check_book_label_migration.py')
        gate = importlib.util.module_from_spec(spec); spec.loader.exec_module(gate)
        labels = gate.parse(path.with_suffix('.aux').read_bytes())
        sys.path.insert(0, str(ROOT / 'scripts/harbor-research'))
        try:
            from page_overflow import column
        finally:
            sys.path.pop(0)
        with fitz.open(path) as doc:
            index = doc.resolve_names()[labels['swk:fig:swk-durability-dramatization'][3]]['page']
            page = doc[index]; left, right, _ = column(page, index + 1)
            top = page.search_for('commit acknowledged')[0].y0
            bottom = page.search_for('I1b: NotGuar')[0].y1 + 12
            spans = [s for b in page.get_text('dict')['blocks'] if 'lines' in b
                     for line in b['lines'] for s in line['spans']
                     if top <= s['bbox'][1] < bottom and left-1 <= s['bbox'][0] < right]
            self.assertTrue(spans)
            # Math endpoints use the Book math face; ordinary labels use native Suisse.
            for phrase in ('sync not established', 'stable storage', 'Volatile state',
                           'On restart', 'record survives', 'record may be lost'):
                selected = [s for s in spans if phrase in s['text']]
                self.assertEqual(len(selected), 1, phrase)
                self.assertIn('SuisseIntl', selected[0]['font'])
                self.assertTrue(8.6 <= selected[0]['size'] <= 8.9)
            for span in spans:
                self.assertLessEqual(span['bbox'][2], right + 1)
            # No two independent labels may overprint in the actual drawing.
            rects = [fitz.Rect(s['bbox']) for s in spans if s['text'].strip()]
            for i, first in enumerate(rects):
                for second in rects[i+1:]:
                    overlap = first & second
                    self.assertFalse(overlap.width > 1 and overlap.height > 2, (first, second))
            for drawing in page.get_drawings():
                rect = drawing['rect']
                if top <= rect.y0 < bottom:
                    self.assertGreaterEqual(rect.x0, left - 1)
                    self.assertLessEqual(rect.x1, right + 1)
        matches = re.findall(r'SG-GEOMETRY: swk-durability-dramatization,width=([\d.]+)pt,height=([\d.]+)pt', path.with_suffix('.log').read_text())
        self.assertEqual(len(matches), 1)
        width, height = map(float, matches[0])
        self.assertLessEqual(width, 325.21503)
        self.assertLess(height, 275)


if __name__ == '__main__':
    unittest.main()
