"""Analytic panel comparison and reserved budget, not observed performance."""
from fractions import Fraction as F
import importlib.util
import os
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIGURE = ROOT/'website-v2/public/whitepaper/figures/fig-he-assurance.tex'
CHAPTER = ROOT/'website-v2/public/whitepaper/harbor-economy.tex'


def miss(k, detection=F(3,5), shared=False):
    if type(k) is not int or k < 1 or not 0 < detection < 1:
        raise ValueError('positive integer panel size and probability in (0,1) required')
    return 1-detection if shared else (1-detection)**k


def marks(source):
    required = (r'\SGMeasuredFigure{he-assurance}', 'ymode=log',
                '100*(1-.6)^x', '(axis cs:2,16)', '{40}',
                '1\\% target', 'reviewer count $k$', 'budget units',
                'not realized payout', r'\label{fig:he-assurance}')
    return [s for s in required if s not in source] + [
        'unaligned count scale' for _ in [0]
        if source.count('xmin=.8,xmax=6.25') != 2] + [
        'wrong sampling domain' for _ in [0]
        if source.count('domain=1:6,samples=6') != 3]


class AssuranceFigureTests(unittest.TestCase):
    def test_exact_independent_values_and_integer_threshold(self):
        self.assertEqual([miss(k) for k in range(1,7)],
                         [F(2,5), F(4,25), F(8,125), F(16,625),
                          F(32,3125), F(64,15625)])
        self.assertGreater(miss(5), F(1,100))
        self.assertLess(miss(6), F(1,100))
        self.assertEqual(100*miss(2), 16)
        for k in (0,-1,1.5,True):
            with self.assertRaises(ValueError): miss(k)
        for d in (0,1,-1):
            with self.assertRaises(ValueError): miss(3,d)

    def test_perfect_shared_error_is_one_draw_not_general_correlation(self):
        self.assertEqual([miss(k,shared=True) for k in range(1,7)], [F(2,5)]*6)
        self.assertNotEqual(miss(3), miss(3,shared=True))
        # One explicit joint law, not a fitted or universal correlation curve.
        outcomes = {(0,)*6: F(2,5), (1,)*6: F(3,5)}
        self.assertEqual(sum(p for bits,p in outcomes.items() if not any(bits)), F(2,5))

    def test_budget_does_not_equal_outcome_dependent_payments(self):
        # Fixed synthetic counterexample: three reserved bounty slots, one flaw.
        k,b,carry,d = 3,F(30),F(5),F(3,5)
        budget = k*(b+carry)
        every_successful_report = k*b*d + k*carry
        one_deduplicated_bounty = b*(1-(1-d)**k) + k*carry
        self.assertEqual(budget,105)
        self.assertEqual(every_successful_report,69)
        self.assertEqual(one_deduplicated_bounty,F(1077,25))
        self.assertGreater(budget,every_successful_report)
        self.assertGreater(every_successful_report,one_deduplicated_bounty)

    def test_native_source_contract_and_rejected_semantic_mutants(self):
        source=FIGURE.read_text()
        self.assertEqual(marks(source),[])
        for bad in (source.replace('100*(1-.6)^x','100*(1-.6)'),
                    source.replace('(axis cs:2,16)','(axis cs:2,17)'),
                    source.replace('not realized payout','realized payout'),
                    source.replace('budget units','actual payments'),
                    source.replace('xmin=.8,xmax=6.25','xmin=0,xmax=6.25',1)):
            self.assertTrue(marks(bad))
        for forbidden in (r'\resizebox',r'\scalebox',r'\tiny',r'\scriptsize','transform shape'):
            self.assertNotIn(forbidden,source)
        caption=source.split(r'\caption{',1)[1].split(r'\label{',1)[0]
        self.assertIn('analytic',caption.lower())
        self.assertRegex(source.lower(),r'(conditional on|given) a flaw')

    def test_prose_defines_budget_without_changing_the_honesty_condition(self):
        chapter=CHAPTER.read_text()
        for phrase in ('per reviewer for a fixed flaw', 'planned\nbudget, not realized payout',
                       'duplicate reports settle',r'\rho\, d\, B \;\ge\; G'):
            self.assertIn(phrase,chapter)
        self.assertIn(r'\input{figures/fig-he-assurance}'+'\n'+r'\FloatBarrier',chapter)

    @unittest.skipUnless(os.environ.get('BOOK_ASSURANCE_PDF'),'assembled Book not supplied')
    def test_rendered_axes_fonts_and_theorem_reading_order(self):
        import fitz
        path=Path(os.environ['BOOK_ASSURANCE_PDF'])
        spec=importlib.util.spec_from_file_location('gate',ROOT/'scripts/harbor-research/check_book_label_migration.py')
        gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
        labels=gate.parse(path.with_suffix('.aux').read_bytes())
        with fitz.open(path) as book:
            dest=book.resolve_names()
            p=dest[labels['he:fig:he-assurance'][3]]['page']
            theorem=dest[labels['he:thm:assurance'][3]]['page']
            self.assertLessEqual(p,theorem,'assurance plot interrupts its theorem')
            page=book[p];text=' '.join(page.get_text().split())
            for phrase in ('independent draws','one shared error','budget units','reviewer count',
                           'not realized payout','log','analytic'):
                self.assertIn(phrase,text)
            if p==theorem:
                self.assertLess(page.search_for('reviewer count')[0].y1,
                                page.search_for('Purchased Assurance Bound')[0].y0)
            theorem_text=' '.join(book[theorem].get_text().split())
            self.assertIn('rather than a slogan.',theorem_text,
                          'Purchased Assurance has a stranded framed continuation')
            fonts=' '.join(f[3] for f in page.get_fonts())
            self.assertIn('SuisseIntl',fonts)
            log=path.with_suffix('.log').read_text()
            size=re.findall(r'SG-GEOMETRY: he-assurance,width=([\d.]+)pt,height=([\d.]+)pt',log)
            self.assertEqual(len(size),1)
            self.assertLessEqual(float(size[0][0]),325.21503)


if __name__=='__main__':unittest.main()
