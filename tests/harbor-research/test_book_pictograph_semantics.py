"""Protect the source-owned claims in the September pictograph redraws.

These are semantic/source regressions, not aesthetic approval or deployment proof.
"""
import contextlib
import io
from pathlib import Path
import runpy
import sqlite3
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIGURES = ROOT / 'website-v2/public/whitepaper/figures'


class PictographSemantics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with contextlib.redirect_stdout(io.StringIO()):
            cls.model = runpy.run_path(str(ROOT / 'skills/harbor-results/scripts/c1_noninterference.py'))
        cls.trace = (('D', 'load_data'), ('W', 'read_secret'),
                     ('W', 'submit_to_gate'), ('GE', 'gate_release'))

    def tearDown(self):
        self.model['MUT'].update(leaky_gate=False, bypass=False)

    def test_shown_honest_logs_are_exact(self):
        expected = ((), (), (), (('gate', 0),))
        for secret in (0, 2):
            self.assertEqual(self.model['run'](self.trace, secret)[0], expected)

    def test_raw_secret_negative_control_distinguishes_at_release(self):
        self.model['MUT']['leaky_gate'] = True
        a, b = (self.model['run'](self.trace, s)[0] for s in (0, 2))
        self.assertEqual(a[:3], b[:3])
        self.assertEqual(a[-1], (('gate', 0),))
        self.assertEqual(b[-1], (('gate', 2),))
        self.assertNotEqual(a[-1], b[-1])

    def test_cannot_label_different_parity_as_indistinguishable(self):
        a, b = (self.model['run'](self.trace, s)[0] for s in (0, 1))
        self.assertNotEqual(a[-1], b[-1])

    def test_gate_owner_and_recipient_are_not_conflated(self):
        source = (FIGURES / 'fig-sealed-pillar-pipeline.tex').read_text()
        self.assertTrue(r"Derek authorizes" in source or r"Derek's gate" in source)
        self.assertTrue(r"Erin authorizes" in source or r"Erin's gate" in source)
        self.assertTrue(r'feedback' in source.lower() and r'erin' in source.lower())
        self.assertTrue(r'result' in source.lower() and r'derek' in source.lower())
        self.assertIn('Proposed control flow', source)
        self.assertTrue('public receipt channel is omitted' in source or 'public receipt omitted' in source)

    def test_bitwise_filter_merge_can_lose_both_members(self):
        # One slot per bucket, 000 means empty; both keys have candidate
        # buckets (0,1). Lookup compares the full stored fingerprint.
        a, b = (0b001, 0), (0b010, 0)
        self.assertIn(0b001, a)
        self.assertIn(0b010, b)
        merged = tuple(x | y for x, y in zip(a, b))
        self.assertEqual(merged, (0b011, 0))
        self.assertNotIn(0b001, merged)
        self.assertNotIn(0b010, merged)
        rebuilt = (0b001, 0b010)
        self.assertIn(0b001, rebuilt)
        self.assertIn(0b010, rebuilt)

    def test_duplicate_fingerprints_are_not_declared_invalid(self):
        chapter = (ROOT / 'website-v2/public/whitepaper/anchor-protocol-whitepaper.tex').read_text()
        self.assertNotIn('which no single consistent filter state could have produced', chapter)
        self.assertIn('Duplicate fingerprints are not themselves invalid', chapter)

    def test_serialized_token_attempts_have_one_winner_in_either_order(self):
        # In-memory SQL fixture, not a running Port Daddy service. This checks
        # the figure's simplified predicate, not the deployment/authentication.
        for order in (('A', 'B'), ('B', 'A')):
            with sqlite3.connect(':memory:') as db:
                db.execute('CREATE TABLE token (id TEXT PRIMARY KEY, consumed_at TEXT)')
                db.execute("INSERT INTO token VALUES ('tk', NULL)")
                results = []
                for consumer in order:
                    rows = db.execute('UPDATE token SET consumed_at = ? WHERE id = ? '
                                      'AND consumed_at IS NULL RETURNING id',
                                      (consumer, 'tk')).fetchall()
                    db.commit()
                    results.append(len(rows))
                self.assertEqual(results, [1, 0])
                self.assertEqual(db.execute('SELECT consumed_at FROM token').fetchone()[0], order[0])

    def test_redraws_keep_native_size_and_one_caption(self):
        for name in ('fig-sealed-two-worlds', 'fig-sealed-pillar-pipeline',
                     'fig-anchor-cuckoo-inline', 'fig-magic-link-inline'):
            source = (FIGURES / (name + '.tex')).read_text()
            self.assertTrue(r'\SGMeasuredFigure{' in source and (name in source or name.replace('fig-', 'fig:') in source))
            self.assertEqual(source.count(r'\caption{'), 1)
            for forbidden in (r'\resizebox', r'\scalebox', r'\tiny', r'\scriptsize'):
                self.assertNotIn(forbidden, source)
        comparison = (FIGURES / 'fig-sealed-two-worlds.tex').read_text()
        self.assertIn('depth 7', comparison)
        self.assertIn('Erin\'s visible log', comparison)


if __name__ == '__main__':
    unittest.main()
