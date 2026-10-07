"""One specified output account: source/Book checks, not a leakage proof."""
import os
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIG = ROOT/'website-v2/public/whitepaper/figures/fig-sealed-residuals-converge.tex'


def contract(source):
    text = '\n'.join(line.split('%', 1)[0] for line in source.splitlines())
    for phrase in (r'\SGMeasuredFigure{VIII/fig:sealed-residuals-converge}',
                   'transformed secret', 'self-declared', 'claimed cost,',
                   r'not a DP\\guarantee', 'free-form output',
                   r'one shared\\output envelope', r'q\ {\rm jobs}\times b\ {\rm bits}',
                   r'specified alphabet\\before timing', 'not three allowances',
                   r'$\varepsilon$ is not bits', 'does not cover unmodeled host side channels'):
        assert phrase in text, phrase
    paths = [''.join(path.split()) for path in
             re.findall(r'\\draw\[sg/arrow\]\s*(.*?);', text, re.S)]
    assert paths == ['(172,151)--(211,151)--(228,132)--(236,132)',
                     '(172,90)--(236,90)',
                     '(172,30)--(211,30)--(228,54)--(236,54)'], 'three routes, one envelope'
    assert text.count('(236,47) rectangle (315,139)') == 1, 'one envelope'
    assert text.count(r'\caption{') == text.count(r'\label{fig:sealed-residuals-converge}') == 1
    for forbidden in (r'\resizebox', r'\scalebox', r'\tiny', r'\scriptsize',
                      r'\fontsize', r'\clip', 'transform shape', 'use as bounding box'):
        assert forbidden not in text, forbidden


class SourceContract(unittest.TestCase):
    def test_alternative_outputs_share_one_account(self):
        contract(FIG.read_text())

    def test_misleading_variants_are_rejected(self):
        source = FIG.read_text()
        for old, new in [('not three allowances', 'three allowances'),
                         (r'not a DP\\guarantee', r'a DP\\guarantee'),
                         (r'q\ {\rm jobs}\times b\ {\rm bits}', r'q+b\ {\rm bits}'),
                         ('before timing', 'all channels'),
                         ('does not cover unmodeled host side channels', 'covers all host side channels'),
                         ('(172,90)--(236,90)', '(236,90)--(172,90)')]:
            self.assertIn(old, source)
            with self.subTest(change=new), self.assertRaises(AssertionError):
                contract(source.replace(old, new))
        with self.assertRaises(AssertionError):
            contract(source + '\n' + r'\resizebox{1pt}{!}{x}')

    def test_atlas_names_the_counter_readings(self):
        atlas = (ROOT/'skills/whitepaper-figure-system/references/semantic-figure-atlas.md').read_text()
        row, = [line for line in atlas.splitlines()
                if line.startswith('| `VIII/fig:sealed-residuals-converge`')]
        for phrase in ('three concrete alternative output artifacts', 'not a DP guarantee',
                       'three additive allowances', 'epsilon equated with bits',
                       'universal bound on host side channels'):
            self.assertIn(phrase, row)


PDF = Path(os.environ.get('BOOK_RESIDUALS_PDF', ROOT/'.cache/book-dp-accounting-20260920/coordination-papers-mega-volume.pdf'))


@unittest.skipUnless(PDF.is_file(), 'integrated Book proof required')
class ActualBook(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import fitz
        sys.path.insert(0, str(ROOT/'scripts/harbor-research'))
        from check_book_label_migration import parse
        cls.doc = fitz.open(PDF)
        label = parse(PDF.with_suffix('.aux').read_bytes())['sealed:fig:sealed-residuals-converge']
        cls.number = label[0]
        cls.page = cls.doc[cls.doc.resolve_names()[label[3]]['page']]

    @classmethod
    def tearDownClass(cls):
        cls.doc.close()

    def test_caption_and_qualifications_are_printed(self):
        text = ' '.join(self.page.get_text().replace('\u2011','-').split())
        for phrase in ('Figure '+self.number+'.', 'transformed secret', 'claimed cost,',
                       'not a DP guarantee', 'free-form output', 'one shared output envelope',
                       'not three allowances', 'before timing', 'unmodeled host side channels'):
            self.assertIn(phrase, text)

    def test_native_font_and_figure_geometry(self):
        from page_overflow import column
        left, right, _ = column(self.page, self.page.number+1)
        spans = [s for b in self.page.get_text('dict')['blocks'] for l in b.get('lines',[])
                 for s in l['spans'] if left <= s['bbox'][0] < right and 'SuisseIntl' in s['font']]
        labels = [s for s in spans if s['text'].strip() in
                  ('laundering', 'transformed secret', 'release', 'self-declared',
                   'claimed cost,', 'not a DP', 'guarantee', 'arbitrary telemetry',
                   'free-form output', 'one shared', 'output envelope')]
        self.assertGreaterEqual(len(labels), 9)
        for span in labels:
            self.assertTrue(8.85 <= span['size'] <= 9.05, span)
            self.assertLessEqual(span['bbox'][2], right+1)
        log = PDF.with_suffix('.log').read_text()
        sizes = re.findall(r'SG-GEOMETRY: VIII/fig:sealed-residuals-converge,width=([.\d]+)pt,height=([.\d]+)p\s*t', log)
        self.assertTrue(sizes, 'native geometry measurement absent')
        for width, height in sizes:
            self.assertAlmostEqual(float(width), 315.8, places=1)
            self.assertAlmostEqual(float(height), 184.348, places=1)


if __name__ == '__main__':
    unittest.main()
