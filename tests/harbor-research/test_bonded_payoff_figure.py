"""Exact analytic geometry and archived trace; not a fresh TLC or market run."""
from fractions import Fraction as F
import os
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIGURE = ROOT / 'website-v2/public/whitepaper/figures/fig-bc-delta-threshold.tex'
TRACE = ROOT / 'proofs/economics/claim_signaling_delta30.run.log'


def finite(d):
    return 1 - 2 * (d + d*d + d*d*d)


def grim(d):
    return 1 - 2*d/(1-d)


def trace_gain(text):
    state = text.split('State 6:')[1].split('10 states generated')[0]
    actual = int(re.search(r'actualScore = \[A \|-> (\d+)', state)[1])
    follow = int(re.search(r'followScore = \[A \|-> (\d+)', state)[1])
    if '/\\ round = 4' not in state or '/\\ punishCountdown = 0' not in state:
        raise ValueError('not the completed punishment window')
    return F(actual-follow, 100**4)


class BondedPayoffTests(unittest.TestCase):
    def test_finite_endpoints_and_worked_point_exactly(self):
        self.assertEqual([finite(F(0)), finite(F(1)), finite(F(3,10)), finite(F(9,10))],
                         [1, -5, F(83,500), -F(1939,500)])
        for a,b in zip(range(100),range(1,101)):
            self.assertGreater(finite(F(a,100)), finite(F(b,100)))

    def test_distinct_roots_and_grim_domain(self):
        self.assertEqual(grim(F(1,3)),0)
        self.assertGreater(finite(F('0.342508031367')),0)
        self.assertLess(finite(F('0.342508031369')),0)
        self.assertGreater(finite(F(1,3)),0)
        with self.assertRaises(ZeroDivisionError):
            grim(F(1))
        self.assertEqual(grim(F(63,83)), -F(53,10))

    def test_archive_gain_matches_model_not_a_simulated_series(self):
        text=TRACE.read_text()
        self.assertIn('Invariant NoUnilateralDeviationPositive is violated',text)
        self.assertEqual(trace_gain(text),finite(F(3,10)))
        cfg=(ROOT/'proofs/economics/claim_signaling_delta30.cfg').read_text()
        for field in ('DeltaNum = 30','DeltaDen = 100','Horizon = 4','PunishmentRounds = 3'):
            self.assertIn(field,cfg)
        model=(ROOT/'proofs/economics/claim_signaling.tla').read_text()
        self.assertIn('ASSUME Horizon = 4',model)
        self.assertIn('dd * dd * dd * dd',model)

    def test_trace_lies_and_partial_windows_rejected(self):
        text=TRACE.read_text()
        for false in (text.replace('441700000','441600000'),
                      text.replace('425100000','425200000')):
            self.assertNotEqual(trace_gain(false),finite(F(3,10)))
        with self.assertRaises(ValueError):
            trace_gain(text.replace('/\\ round = 4','/\\ round = 3'))

    def test_native_source_geometry_and_unique_witness_symbol(self):
        s=FIGURE.read_text()
        for field in (r'\SGMeasuredFigure{bc-delta-threshold}',
                      'domain=0:1,samples=121', 'domain=0:0.7590361446',
                      '{38+244*\\x}', '{100-28*(1-2*(\\x+\\x*\\x+\\x*\\x*\\x))}',
                      'no value at $1$', 'not a measured payoff series',
                      'zero gain at $\\delta^*_3\\approx.342508$',
                      'zero gain at $\\delta^*_\\infty=1/3$'):
            self.assertIn(field,s)
        self.assertEqual(s.count(' rectangle '),1)
        self.assertIn('(109.2,93.352) rectangle (113.2,97.352)',s)
        self.assertEqual((F('109.2')+F('113.2'))/2,38+244*F(3,10))
        self.assertEqual((F('93.352')+F('97.352'))/2,100-28*finite(F(3,10)))
        self.assertIn('(257.6,208.584) circle',s)
        self.assertEqual(F('208.584'),100-28*finite(F(9,10)))
        for bad in (r'\tiny',r'\scriptsize',r'\resizebox',r'\scalebox'):
            self.assertNotIn(bad,s)

    def test_sparkline_keeps_finite_local_role(self):
        spark=(FIGURE.parent/'spark-bonded-deviation.tex').read_text()
        self.assertIn('domain=0:1',spark)
        self.assertNotIn('TLC',spark)
        self.assertNotIn('grim',spark)
        chapter=(FIGURE.parents[1]/'agent-transactions-whitepaper.tex').read_text()
        self.assertEqual(chapter.count(r'\input{figures/spark-bonded-deviation}'),1)
        self.assertEqual(chapter.count(r'\input{figures/fig-bc-delta-threshold}'),1)
        after=chapter.split(r'\input{figures/fig-bc-delta-threshold}')[1]
        self.assertLess(after.index(r'\FloatBarrier'),after.index(r'\input{figures/session-bc-delta30}'))

    @unittest.skipUnless(os.environ.get('BOOK_BONDED_PDF'),'assembled Book not supplied')
    def test_actual_page_has_full_axes_and_model_limit(self):
        import fitz
        with fitz.open(os.environ['BOOK_BONDED_PDF']) as doc:
            pages=[p for p in doc if 'zero gain at' in p.get_text() and 'Grim trigger' in p.get_text()]
            self.assertEqual(len(pages),1)
            text=' '.join(pages[0].get_text().replace('\u2011','-').split())
            for part in ('Net deviation gain','stage-game payoff units','Discount factor',
                         'TLC:','no value at 1','archived four-round','not a measured payoff'):
                self.assertIn(part,text)

    @unittest.skipUnless(os.environ.get('BOOK_BONDED_PDF'),'assembled Book not supplied')
    def test_figure_does_not_interrupt_recorded_terminal(self):
        import fitz
        with fitz.open(os.environ['BOOK_BONDED_PDF']) as doc:
            plot=next(p for p in doc if 'zero gain at' in p.get_text() and 'Grim trigger' in p.get_text())
            start=next(p for p in doc if 'java -cp tla2tools.jar tlc2.TLC -config' in p.get_text())
            self.assertGreaterEqual(start.number,plot.number)
            if start.number==plot.number:
                command=start.search_for('java -cp tla2tools.jar tlc2.TLC -config')[0]
                last=plot.search_for('Grim continues')[0]
                self.assertGreater(command.y0,last.y1)


if __name__=='__main__':
    unittest.main()
