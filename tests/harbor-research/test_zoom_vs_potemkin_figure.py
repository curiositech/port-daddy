"""Zoom vs Potemkin figure: source and Book contracts for I/fig:zoom-vs-potemkin."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIG = ROOT / 'whitepaper/figures/legible-swarm-zoom-vs-potemkin.tex'


def contract(source):
    text = '\n'.join(line.split('%', 1)[0] for line in source.splitlines())
    for phrase in (r'\SGMeasuredFigure{I/fig:zoom-vs-potemkin}',
                   'digest as lens', r'total zoom $\zeta$',
                   'PR 123: 3 claims', 'claims',
                   'auth refactor', 'tests pass', '1 critique',
                   'resolves to',
                   r'\texttt{diff a1c\ldots}', r'\texttt{run \#4812}', r'\texttt{comment \#7}',
                   'digest as facade', r'absent zoom ($\zeta = \varnothing$)',
                   'ALL GREEN',
                   r'$\varnothing$', 'no diff', 'no run', 'no note'):
        assert phrase in text, f'Missing phrase: {phrase}'
    
    conduits = re.findall(r'\\draw\[sg/arrow\]\s*(.*?);', text, re.S)
    assert len(conduits) == 6, f'Expected 6 sg/arrow conduits (3 fan-out + 3 down), got {len(conduits)}'
    
    assert text.count(r'\caption{') == text.count(r'\label{fig:zoom-vs-potemkin}') == 1
    
    for forbidden in (r'\resizebox', r'\scalebox', r'\tiny', r'\scriptsize',
                      r'\fontsize', r'\clip', 'transform shape', 'use as bounding box',
                      'pd breach datum', 'pd focus datum', 'pd figure', 'pd bucket'):
        assert forbidden not in text, f'Forbidden construct: {forbidden}'


class ZoomVsPotemkinTests(unittest.TestCase):
    def test_source_contract(self):
        contract(FIG.read_text())

    def test_misleading_mutations_rejected(self):
        source = FIG.read_text()
        for old, new in [('PR 123: 3 claims', 'PR 123: 2 claims'),
                         ('ALL GREEN', 'MOSTLY GREEN'),
                         ('no note', 'note present'),
                         (r'total zoom $\zeta$', 'partial zoom')]:
            self.assertIn(old, source)
            with self.subTest(change=new), self.assertRaises(AssertionError):
                contract(source.replace(old, new))
        with self.assertRaises(AssertionError):
            contract(source + '\n' + r'\resizebox{1pt}{!}{x}')


if __name__ == '__main__':
    unittest.main()
