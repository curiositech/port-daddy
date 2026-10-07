"""Canary/latency plot source and native Book geometry, not a simulation."""
from math import hypot
import os
from pathlib import Path
import re
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
FIG=ROOT/'website-v2/public/whitepaper/figures/fig-sealed-operating-curve.tex'
PDF=Path(os.environ.get('BOOK_OPERATING_PDF',ROOT/'.cache/book-operating-20260920/coordination-papers-mega-volume.pdf'))


def contract(source):
    text=re.sub(r'(?<!\\)%[^\n]*','',source)
    for phrase in (r'\SGMeasuredFigure{VIII/fig:sealed-operating-curve}',
                   'canaries carried $k$ (integer)', 'conditional detection probability',
                   'outputs to stopping decision $N$', 'xmin=0,xmax=8.5,ymin=0,ymax=1.03',
                   'domain=0:8,samples=9', '{1-0.2^x}', 'coordinates {(3,.992)}',
                   'coordinates {(431.9,1.12) (296.9,2.12)}',
                   'coordinates {(438.1,.88) (359.0,1.88)}',
                   'Wald no-overshoot', 'chapter-reported mean',
                   'reported capped simulation means have no supplied uncertainty',
                   'do not certify error control', r'$p_0=.001$', r'$p_1=.01$',
                   r'$\alpha=.01$', r'$\gamma=.05$'):
        assert phrase in text,phrase
    assert text.count(r'\caption{')==text.count(r'\label{fig:sealed-operating-curve}')==1
    for bad in ('title=', r'\resizebox', r'\scalebox', r'\tiny', r'\scriptsize',
                'transform shape','xbar','error bars'):
        assert bad not in text,bad


def center(d):
    r=d['rect']
    return ((r.x0+r.x1)/2,(r.y0+r.y1)/2)


def rectangle(d):
    import fitz
    r=fitz.Rect(d['rect'])
    half=(d.get('width') or 0)/2
    return r+(-half,-half,half,half)


def mark_gap(circle,square):
    """Actual circle-to-square edge clearance, including BOTH stroke widths."""
    x,y=center(circle)
    r=rectangle(square)
    radius=(circle['rect'].width+(circle.get('width') or 0))/2
    return hypot(max(r.x0-x,0,x-r.x1),max(r.y0-y,0,y-r.y1))-radius


class SourceContract(unittest.TestCase):
    def test_source(self):
        contract(FIG.read_text())

    def test_false_evidence_and_overlap_mutations_rejected(self):
        source=FIG.read_text()
        for old,new in [('reported capped simulation means','measured population expectations'),
                        ('do not certify error control','guarantee error control'),
                        ('coordinates {(438.1,.88) (359.0,1.88)}','coordinates {(438.1,1.12) (359.0,2.12)}'),
                        ('ymin=0,ymax=1.03','ymin=.75,ymax=1.03'),
                        ('{1-0.2^x}','{1-0.1^x}'),
                        ('Wald no-overshoot','exact stopping expectation')]:
            self.assertIn(old,source)
            with self.subTest(change=new),self.assertRaises(AssertionError):
                contract(source.replace(old,new))


@unittest.skipUnless(PDF.is_file(),'actual Book proof required')
class ActualBook(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import fitz
        sys.path.insert(0,str(ROOT/'scripts/harbor-research'))
        from check_book_label_migration import parse
        cls.doc=fitz.open(PDF)
        label=parse(PDF.with_suffix('.aux').read_bytes())['sealed:fig:sealed-operating-curve']
        cls.page=cls.doc[cls.doc.resolve_names()[label[3]]['page']]
        cls.lines=[l for b in cls.page.get_text('dict')['blocks'] for l in b.get('lines',[])]
        draws=cls.page.get_drawings()
        # The six lower x ticks identify the actual axis, independently of
        # page number, caption position, or the sidecar's coordinate fixtures.
        ticks=[d for d in draws if len(d['items'])==6 and
               all(i[0]=='l' and abs(i[1].x-i[2].x)<.01 and 2<i[1].y-i[2].y<4 for i in d['items'])]
        assert len(ticks)==1,'Expected one lower six-tick axis'
        points=sorted(i[1].x for i in ticks[0]['items'])
        cls.x0,cls.x500=points[0],points[-1]
        cls.axis_y=sum(p.y for i in ticks[0]['items'] for p in i[1:])/12
        yticks=[d for d in draws if len(d['items'])==2 and all(
            i[0]=='l' and abs(i[1].y-i[2].y)<.01 and 2<i[2].x-i[1].x<4
            and abs((i[1].x+i[2].x)/2-cls.x0)<.1 for i in d['items'])]
        assert len(yticks)==1,'Expected two condition ticks'
        cls.y2,cls.y1=sorted(i[1].y for i in yticks[0]['items'])
        marks=[d for d in draws if 4<d['rect'].width<5 and 4<d['rect'].height<5
               and cls.y2-10<d['rect'].y0<cls.y1+10 and d['rect'].x0>cls.x0]
        cls.circles=sorted([d for d in marks if all(i[0]=='c' for i in d['items'])],key=lambda d:d['rect'].y0)
        cls.squares=sorted([d for d in marks if len(d['items'])==1 and d['items'][0][0]=='re'],key=lambda d:d['rect'].y0)
        assert len(cls.circles)==len(cls.squares)==2,'Expected two open-circle/filled-square pairs'

    @classmethod
    def tearDownClass(cls):
        cls.doc.close()

    def test_actual_mark_x_values_and_stroke_aware_separation(self):
        import fitz
        for circle,square,expected in zip(self.circles,self.squares,[(296.9,359.0),(431.9,438.1)]):
            for mark,value in zip((circle,square),expected):
                x,_=center(mark)
                self.assertAlmostEqual((x-self.x0)/(self.x500-self.x0)*500,value,delta=.03)
            self.assertGreater(mark_gap(circle,square),1.5,'Stroke-aware marker clearance too small')
        # Same true x values with no vertical dodge must be rejected.
        circle,square=self.circles[1],dict(self.squares[1])
        dy=center(circle)[1]-center(square)[1]
        square['rect']=fitz.Rect(square['rect'])+(0,dy,0,dy)
        self.assertLess(mark_gap(circle,square),0)

    def test_native_prose_and_complete_numeric_labels_clear_marks(self):
        import fitz
        spans=[s for l in self.lines for s in l['spans']
               if s['text'].replace('\u2011','-') in (
                   'conditional detection probability','canaries carried','under null','under leak',
                   'outputs to stopping decision','Wald no-overshoot','chapter-reported mean')]
        self.assertEqual(len(spans),7)
        for s in spans:
            self.assertIn('SuisseIntl',s['font'])
            self.assertTrue(8.85<=s['size']<=9.05,s)
        for value in ('296.9','359.0','431.9','438.1'):
            rows=[l for l in self.lines if ''.join(s['text'] for s in l['spans']).replace(' ','')==value
                  and l['bbox'][2]<self.x500+10 and self.y2-25<l['bbox'][1]<self.axis_y]
            self.assertEqual(len(rows),1,'Expected one complete numeric label: '+value)
            r=fitz.Rect(rows[0]['bbox'])
            for mark in self.circles+self.squares:
                self.assertTrue(not r.intersects(rectangle(mark)), 'Label touches a marker: '+value)

    def test_actual_scope_and_native_geometry(self):
        text=' '.join(re.sub(r'(?<=\w)-\n(?=\w)','',self.page.get_text().replace('\u2011','-')).split())
        for phrase in ('conditional detection', 'reported capped simulation means',
                       'no supplied uncertainty', 'do not certify error control'):
            self.assertTrue(phrase in text,'Missing printed qualification: '+phrase)
        matches=re.findall(r'SG-GEOMETRY: VIII/fig:sealed-operating-curve,width=([.\d\s]+)p\s*t,height=([.\d\s]+)p\s*t',PDF.with_suffix('.log').read_text())
        self.assertTrue(matches)
        for w,h in matches:
            self.assertTrue(300<float(''.join(w.split()))<=325.215)
            self.assertTrue(290<float(''.join(h.split()))<320)


if __name__=='__main__':
    unittest.main()
