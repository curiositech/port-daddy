"""Capacity ledger figure: source and Book contracts for VIII/fig:sealed-leakage-ledger."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIG = ROOT / 'website-v2/public/whitepaper/figures/fig-sealed-leakage-ledger.tex'


def contract(source):
    text = '\n'.join(line.split('%', 1)[0] for line in source.splitlines())
    for phrase in (r'\SGMeasuredFigure{VIII/fig:sealed-leakage-ledger}',
                   'fixed status channel', 'scheduled timing slots',
                   r'12{,}800', r'+317', r'13{,}117',
                   'capacity ledger', 'one contract balance',
                   'bits of capacity'):
        assert phrase in text, phrase
    arrows = re.findall(r'\\draw\[sg/arrow\]\s*(.*?);', text, re.S)
    assert len(arrows) == 2, 'two conduit arrows into ledger'
    assert text.count(r'\caption{') == text.count(r'\label{fig:sealed-leakage-ledger}') == 1
    for forbidden in (r'\resizebox', r'\scalebox', r'\tiny', r'\scriptsize',
                      r'\fontsize', r'\clip', 'transform shape', 'use as bounding box',
                      'pd bucket', 'pd focus state', 'pd warn state'):
        assert forbidden not in text, forbidden


class SealedLeakageLedgerTests(unittest.TestCase):
    def test_source_contract(self):
        contract(FIG.read_text())

    def test_misleading_mutations_rejected(self):
        source = FIG.read_text()
        for old, new in [(r'13{,}117', r'12{,}800'),
                         ('capacity ledger', 'waterfall account'),
                         (r'+317', r'-317')]:
            self.assertIn(old, source)
            with self.subTest(change=new), self.assertRaises(AssertionError):
                contract(source.replace(old, new))
        with self.assertRaises(AssertionError):
            contract(source + '\n' + r'\resizebox{1pt}{!}{x}')


if __name__ == '__main__':
    unittest.main()
