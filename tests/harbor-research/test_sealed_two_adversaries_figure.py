"""Paired ledger representation, not differential-privacy implementation proof."""
import os
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIG = ROOT / 'website-v2/public/whitepaper/figures/fig-sealed-two-adversaries.tex'
OWNER = ROOT / 'website-v2/public/whitepaper/sealed-harbor.tex'


def contract(source):
    text = '\n'.join(line.split('%', 1)[0] for line in source.splitlines())
    nodes = {name: (float(x), float(y), body) for name, x, y, body in re.findall(
        r'\\node\[[^]]*\]\s*\((\w+)\)\s*at\s*\(([-.\d]+),([-.\d]+)\)\s*\{(.*?)\};', text, re.S)}
    for stem, y, body in [('ledger', 153, 'ledger'),
                          ('sum', 174, r'$\sigma=\sum_{\Lambda}\varepsilon_i$'),
                          ('bound', 195, r'$\sigma\le\varepsilon_{\max}$')]:
        assert nodes[stem+'L'] == (74, y, body), 'left accounting'
        assert nodes[stem+'R'] == (242, y, body), 'right accounting'
    for name, body in {'honest':'Honest worker', 'malicious':'Malicious worker',
                       'valid':'valid privacy cost', 'declared':'self-declared cost',
                       'observer':'observer', 'worker':'worker', 'chosen':'chosen bits',
                       'cost':r'declared $\varepsilon_i$', 'private':r'$\varepsilon_i$-private',
                       'dp':r'$(\varepsilon_{\max},0)$-DP', 'nodp':'No DP certificate',
                       'capacity':r'$q\cdot b$ bits', 'timing':'before timing',
                       'condition':'valid mechanisms only'}.items():
        assert nodes[name][2] == body, 'role/assumption '+name
    arrows = [''.join(path.split()) for path in re.findall(r'\\draw\[sg/arrow\]\s*(.*?);', text, re.S)]
    assert arrows == ['(94,67)--(111,67)', '(203,67)--(227,67)'], 'no runtime honesty branch'
    assert 'DP needs valid mechanisms and complete mediation;' in text
    assert 'bounds only the specified output channel before timing.' in text
    assert 'The same ledger conserves declared spend, not semantic privacy.' in text
    assert r'\SGMeasuredFigure{VIII/fig:sealed-two-adversaries}' in text
    assert text.count(r'\caption{') == text.count(r'\label{fig:sealed-two-adversaries}') == 1
    for token in (r'\resizebox', r'\scalebox', r'\fontsize', r'\tiny', r'\scriptsize',
                  r'\clip', 'transform shape', 'use as bounding box'):
        assert token not in text, 'native labels'


class SourceContract(unittest.TestCase):
    def test_same_accounting_different_semantic_premises(self):
        contract(FIG.read_text())

    def test_misleading_variants_rejected(self):
        source = FIG.read_text()
        variants = [('{valid privacy cost}', '{any declared cost}'),
                    ('{self-declared cost}', '{verified cost}'),
                    ('{observer}', '{controller}'), ('{worker}', '{ledger mutator}'),
                    ('(94,67)--(111,67)', '(111,67)--(94,67)'),
                    ('(203,67)--(227,67)', '(227,67)--(203,67)'),
                    ('(sumR) at (242,174)', '(sumR) at (244,174)'),
                    (r'(boundR) at (242,195) {$\sigma\le\varepsilon_{\max}$}',
                     r'(boundR) at (242,195) {$\sigma>\varepsilon_{\max}$}'),
                    ('{No DP certificate}', '{DP guaranteed}'),
                    (r'{$q\cdot b$ bits}', r'{$q+b$ bits}'),
                    ('{before timing}', '{all side channels}'),
                    ('and complete mediation;', 'alone;'),
                    ('valid mechanisms only', 'all releases'),
                    ('not semantic privacy.', 'and semantic privacy.')]
        for old, new in variants:
            self.assertIn(old, source)
            with self.subTest(new=new), self.assertRaises(AssertionError):
                contract(source.replace(old, new))
        for extra in (r'\draw[sg/arrow] (74,209)--(242,229);', r'\resizebox{1pt}{!}{x}', r'\caption{x}'):
            with self.subTest(extra=extra), self.assertRaises(AssertionError):
                contract(source+'\n'+extra)

    def test_owner_distinguishes_accounting_from_privacy(self):
        source = ' '.join(OWNER.read_text().split())
        self.assertIn('Accounting consistency and non-leakage are two different properties', source)
        self.assertEqual(source.count(r'$\sigma\le\varepsilon_{\max}$ does not certify differential privacy'), 2)
        self.assertIn('Finite output alphabets and query limits can bound specified observations;', source)
        self.assertIn('they do not bound every host side channel.', source)

    def test_atlas_records_counter_readings(self):
        atlas = (ROOT/'skills/whitepaper-figure-system/references/semantic-figure-atlas.md').read_text()
        row, = [line for line in atlas.splitlines() if line.startswith('| `VIII/fig:sealed-two-adversaries`')]
        for phrase in ('identical ledger records', 'runtime branch on honesty', 'epsilon equated to bits', 'all side channels'):
            self.assertIn(phrase, row)


PDF = Path(os.environ.get('BOOK_TWO_ADVERSARIES_PDF', ROOT/'.cache/book-sealed-two-adversaries-20260920/coordination-papers-mega-volume.pdf'))


@unittest.skipUnless(PDF.is_file(), 'actual Book proof required')
class ActualBook(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import fitz
        sys.path.insert(0, str(ROOT/'scripts/harbor-research'))
        from check_book_label_migration import parse
        cls.doc = fitz.open(PDF)
        cls.labels = parse(PDF.with_suffix('.aux').read_bytes())
        cls.label = cls.labels['sealed:fig:sealed-two-adversaries']
        cls.index = cls.doc.resolve_names()[cls.label[3]]['page']

    @classmethod
    def tearDownClass(cls):
        cls.doc.close()

    def test_caption_and_conditional_case_labels(self):
        text = ' '.join(self.doc[self.index].get_text().replace('\u2011','-').split())
        for phrase in ('Figure '+self.label[0]+'.', 'Honest worker', 'Malicious worker',
                       'self-declared cost', 'Same accounting in both cases', 'No DP certificate',
                       'valid mechanisms only', 'before timing', 'complete mediation'):
            self.assertIn(phrase, text)

    def test_native_geometry_and_suisse_labels(self):
        page = self.doc[self.index]
        from page_overflow import column
        left, right, _ = column(page, page.number+1)
        top = page.search_for('Honest worker')[0].y0 - 1
        bottom = page.search_for('valid mechanisms only')[0].y1 + 1
        spans = [s for b in page.get_text('dict')['blocks'] for l in b.get('lines',[])
                 for s in l['spans'] if left-1 <= s['bbox'][0] < right and top <= s['bbox'][1] < bottom]
        # TeX uses Suisse for the upright math operator `max` too. Check its
        # script size separately; it is not a shrunk prose label.
        scripts = [s for s in spans if 'SuisseIntl' in s['font'] and s['text'] == 'max']
        self.assertEqual(len(scripts), 3)
        for span in scripts:
            self.assertTrue(7.20 <= span['size'] <= 7.35, span)
        labels = [s for s in spans if 'SuisseIntl' in s['font'] and s['text'] != 'max']
        self.assertGreaterEqual(len(labels), 15)
        for span in labels:
            self.assertTrue(8.85 <= span['size'] <= 9.05, span)
            self.assertLessEqual(span['bbox'][2], right+1)
        log = PDF.with_suffix('.log').read_text()
        sizes = re.findall(r'SG-GEOMETRY: VIII/fig:sealed-two-adversaries,width=([.\d]+)pt,height=([.\d]+)pt',log)
        self.assertTrue(sizes)
        for width,height in sizes:
            self.assertAlmostEqual(float(width),316.85,places=2)
            self.assertAlmostEqual(float(height),287.67297,places=2)

    def test_paired_records_stay_aligned(self):
        log = PDF.with_suffix('.log').read_text()
        nodes = {n:tuple(map(float,(a,b,c,d))) for n,a,b,c,d in re.findall(
            r'TA-NODE: ([^,]+),([-.\d]+)pt,([-.\d]+)pt,([-.\d]+)pt,([-.\d]+)pt',log)}
        for stem in ('ledger','sum','bound'):
            a,b = nodes[stem+'L'],nodes[stem+'R']
            self.assertAlmostEqual(a[1],b[1],places=2)
            self.assertAlmostEqual(a[3],b[3],places=2)
            self.assertAlmostEqual(b[0]-a[0],168,places=2)


if __name__ == '__main__':
    unittest.main()
