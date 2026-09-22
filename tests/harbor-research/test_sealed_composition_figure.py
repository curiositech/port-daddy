"""Analytical bound comparison and actual Book typography; not a DP proof."""
from math import expm1, hypot, log, sqrt
import os
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIG = ROOT/'website-v2/public/whitepaper/figures/fig-sealed-composition-crossover.tex'
PDF = Path(os.environ.get('BOOK_COMPOSITION_PDF', ROOT/'.cache/book-composition-20260920/coordination-papers-mega-volume.pdf'))


def advanced(k, eps=.1, delta=1e-6):
    return eps*sqrt(2*k*log(1/delta)) + k*eps*expm1(eps)


def contract(source):
    text = '\n'.join(line.split('%', 1)[0] for line in source.splitlines())
    for phrase in (r'\SGMeasuredFigure{VIII/fig:sealed-composition-crossover}',
                   'release count $k$', r'bound $\varepsilon$',
                   'xtick={0,16,35,48,64}', '{0.1*x}',
                   '{0.1*sqrt(2*x*ln(1000000)) + x*0.1*(exp(0.1)-1)}',
                   'coordinates {(35,3.47789843)}',
                   'draw=pdink,line width=1.05pt', 'draw=pdfocus,line width=1.45pt',
                   r'basic $(\delta=0)$', r"advanced\\$\delta'=10^{-6}$",
                   'Analytical comparison', 'fixed maximum horizon',
                   'queries may adapt', '3.20 versus advanced 3.31',
                   'not uniformly stronger privacy'):
        assert phrase in text, phrase
    for style in ('pd axis label', 'pd direct label', 'pd focus label'):
        assert style + r'/.append style={font=\SGType}' in text, style
    assert text.count(r'\caption{') == text.count(r'\label{fig:sealed-composition-crossover}') == 1
    for forbidden in ('title=', 'spent-budget bound', r'\resizebox', r'\scalebox',
                      r'\tiny', r'\scriptsize', r'\fontsize', 'transform shape',
                      'use as bounding box'):
        assert forbidden not in text, forbidden


def curve_clearance(rect, field, is_advanced):
    """Full-label rectangle to sampled curve edge, including half its stroke.

    Sample every .001 release across the entire domain, not only below the
    label: the nearest point on an oblique curve may lie outside its x span.
    This is a numerical layout check, not a mathematical proof of clearance.
    """
    distances = []
    for n in range(64001):
        k = n/1000
        x = field.x0+k/64*field.width
        value = advanced(k) if is_advanced else .1*k
        y = field.y1-value/7*field.height
        distances.append(hypot(max(rect.x0-x,0.,x-rect.x1),
                               max(rect.y0-y,0.,y-rect.y1)))
    stroke = (1.45 if is_advanced else 1.05)*72/72.27
    return max(0., min(distances)-stroke/2)


class SourceContract(unittest.TestCase):
    def test_source_and_native_styles(self):
        contract(FIG.read_text())

    def test_misleading_mutations_are_rejected(self):
        source = FIG.read_text()
        for old,new in [('coordinates {(35,3.47789843)}', 'coordinates {(32,3.47789843)}'),
                        ('fixed maximum horizon', 'arbitrary stopping time'),
                        ('queries may adapt', 'queries cannot adapt'),
                        ('not uniformly stronger privacy', 'uniformly stronger privacy'),
                        (r"advanced\\$\delta'=10^{-6}$", r'advanced\\$\delta=0$'),
                        ('{0.1*x}', '{0.2*x}'),
                        ('pd axis label/.append style', 'unused style/.append style')]:
            self.assertIn(old, source)
            with self.subTest(change=new), self.assertRaises(AssertionError):
                contract(source.replace(old,new))

    def test_independent_formula_checkpoints(self):
        self.assertAlmostEqual(advanced(32), 3.3100846889, places=9)
        self.assertAlmostEqual(advanced(35), 3.4778984304, places=9)
        self.assertEqual(next(k for k in range(1,65) if advanced(k)<.1*k), 35)
        self.assertGreater(advanced(34), 3.4)


@unittest.skipUnless(PDF.is_file(), 'actual Book proof required')
class ActualBook(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import fitz
        sys.path.insert(0, str(ROOT/'scripts/harbor-research'))
        from check_book_label_migration import parse
        cls.doc = fitz.open(PDF)
        label = parse(PDF.with_suffix('.aux').read_bytes())['sealed:fig:sealed-composition-crossover']
        cls.number = label[0]
        cls.page = cls.doc[cls.doc.resolve_names()[label[3]]['page']]
        fields = [d['rect'] for d in cls.page.get_drawings()
                  if d.get('fill') and min(d['fill'])>.9
                  and abs(d['rect'].width-250*72/72.27)<1
                  and abs(d['rect'].height-150*72/72.27)<1]
        assert len(fields)==1, 'Expected one native analytical plot field'
        cls.field, = fields
        cls.lines = [line for block in cls.page.get_text('dict')['blocks']
                     for line in block.get('lines',[])]
        cls.label_boxes = {}
        for name in ('basic', 'advanced', 'first lower'):
            matches = [l for l in cls.lines
                       if ''.join(s['text'] for s in l['spans']).startswith(name)
                       and l['bbox'][0]>=cls.field.x0-1
                       and l['bbox'][2]<=cls.field.x1+1
                       and cls.field.y0-10<=l['bbox'][1]<cls.field.y1]
            assert len(matches)==1, 'Expected one direct label: '+name
            line, = matches
            rect = fitz.Rect(line['bbox'])
            if name!='basic':
                # Include the mathematical second line, not just its prose word.
                for other in cls.lines:
                    r=fitz.Rect(other['bbox'])
                    if (r.x0>=rect.x0-3 and r.x1<=cls.field.x1+1
                            and r.y0>=line['bbox'][1] and r.y1<=line['bbox'][3]+18):
                        rect |= r
            cls.label_boxes[name] = rect

    @classmethod
    def tearDownClass(cls):
        cls.doc.close()

    def test_printed_scope_and_native_type(self):
        text=' '.join(self.page.get_text().replace('\u2011','-').split())
        for phrase in ('Figure '+self.number+'.', 'Analytical comparison',
                       'fixed maximum horizon', 'queries may adapt',
                       'not uniformly stronger privacy'):
            self.assertIn(phrase,text)
        spans=[s for l in self.lines for s in l['spans']
               if s['text'].strip() in ('basic','advanced','first lower','release count','bound')
               and s['bbox'][2]<=self.field.x1+1
               and self.field.y0-10<=s['bbox'][1]<=self.field.y1+35]
        self.assertGreaterEqual(len(spans),4)
        for span in spans:
            self.assertIn('SuisseIntl',span['font'])
            self.assertTrue(8.85<=span['size']<=9.05,span)

    def test_full_labels_clear_both_curves(self):
        import fitz
        for name,rect in self.label_boxes.items():
            for is_advanced in (False,True):
                with self.subTest(label=name,advanced=is_advanced):
                    self.assertGreater(curve_clearance(rect,self.field,is_advanced),5)
        # Recreate the rejected one-line advanced box from its measured
        # fixture coordinates; translate/scale to the actual Book axis.
        old=fitz.Rect(261.324680,95.372279,348.621626,107.633276)
        old_field=fitz.Rect(105.185196,62.568451,354.254395,212.005417)
        bad=fitz.Rect(self.field.x0+(old.x0-old_field.x0)/old_field.width*self.field.width,
                      self.field.y0+(old.y0-old_field.y0)/old_field.height*self.field.height,
                      self.field.x0+(old.x1-old_field.x0)/old_field.width*self.field.width,
                      self.field.y0+(old.y1-old_field.y0)/old_field.height*self.field.height)
        self.assertEqual(curve_clearance(bad,self.field,False),0)

    def test_tick_not_overprinted_and_geometry_is_native(self):
        ticks=[s for l in self.lines for s in l['spans']
               if s['text'].strip()=='35' and self.field.y1<s['bbox'][1]<self.field.y1+15
               and self.field.x0<s['bbox'][0]<self.field.x1]
        self.assertEqual(len(ticks),1,'35 tick overprinted or absent')
        log=PDF.with_suffix('.log').read_text()
        matches=re.findall(r'SG-GEOMETRY: VIII/fig:sealed-composition-crossover,width=([.\d\s]+)p\s*t,height=([.\d\s]+)p\s*t',log)
        self.assertTrue(matches)
        for width,height in matches:
            self.assertTrue(250<float(''.join(width.split()))<=325.215)
            self.assertTrue(170<float(''.join(height.split()))<210)


if __name__=='__main__':
    unittest.main()
