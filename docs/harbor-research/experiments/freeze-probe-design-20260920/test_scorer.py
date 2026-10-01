"""Tiny invented scoring fixtures ONLY; no human or coding-agent performance."""
import unittest
from scorer import score_three

C = ('A', 'B', 'C', 'OTHER', 'NONE')


def certain(label):
    return {c: float(c == label) for c in C}


def uniform():
    return {c: 1/len(C) for c in C}


class SyntheticScoringContract(unittest.TestCase):
    def test_correct_three(self):
        r = score_three(C, [certain(x) for x in 'ABC'], list('ABC'))
        self.assertEqual(r['loss'], 0)

    def test_one_wrong_rank_is_not_one_wrong_episode(self):
        r = score_three(C, [certain('B'), certain('B'), certain('C')], list('ABC'))
        self.assertAlmostEqual(r['loss'], 1/3)

    def test_abstention_keeps_denominator(self):
        r = score_three(C, [uniform() for _ in range(3)], ['A','NONE','NONE'], (True,)*3)
        self.assertAlmostEqual(r['loss'], .4)
        self.assertEqual(r['denominator_slots'], 3)
        self.assertEqual(r['abstention_slots'], 3)

    def test_observed_blocked_no_merge_can_be_correct(self):
        r = score_three(C, [certain('NONE')]*3, ['NONE']*3)
        self.assertEqual(r['loss'], 0)
        self.assertEqual(r['known_slots'], 3)

    def test_censoring_is_not_no_merge(self):
        r = score_three(C, [certain(x) for x in 'ABC'], ['A', None, None])
        self.assertIsNone(r['loss'])
        self.assertEqual(r['loss_bounds'], (0, 2/3))
        self.assertEqual(r['denominator_slots'], 3)

    def test_observed_short_sequence_differs_from_censoring(self):
        r = score_three(C, [certain(x) for x in 'ABC'], ['A', 'NONE', 'NONE'])
        self.assertAlmostEqual(r['loss'], 2/3)

    def test_other_can_repeat(self):
        r = score_three(C, [certain('OTHER')]*3, ['OTHER']*3)
        self.assertEqual(r['loss'], 0)

    def test_bad_mass_rejected(self):
        with self.assertRaises(ValueError):
            score_three(C, [{c: 0 for c in C}]*3, list('ABC'))

    def test_nan_rejected(self):
        p = uniform(); p['A'] = float('nan')
        with self.assertRaises(ValueError):
            score_three(C, [p]*3, list('ABC'))

    def test_confident_abstention_rejected(self):
        with self.assertRaises(ValueError):
            score_three(C, [certain('A')]*3, list('ABC'), (True,)*3)

    def test_missing_class_rejected(self):
        with self.assertRaises(ValueError):
            score_three(C, [{'A': 1}]*3, list('ABC'))

    def test_future_label_outside_universe_rejected(self):
        with self.assertRaises(ValueError):
            score_three(C, [uniform()]*3, ['D','NONE','NONE'])

    def test_no_merge_is_terminal(self):
        with self.assertRaises(ValueError):
            score_three(C, [uniform()]*3, ['NONE','B','NONE'])

    def test_duplicate_landing_rejected(self):
        with self.assertRaises(ValueError):
            score_three(C, [uniform()]*3, ['A','A','NONE'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
