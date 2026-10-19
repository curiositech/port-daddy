#!/usr/bin/env python3
"""Small independent counterexamples for Chapter 4 and Paper 1 boundaries.

These exact checks falsify several tempting claims. Finite sweeps here are not
proofs of the manuscript's universal statements.
"""

from fractions import Fraction
from itertools import combinations, permutations
from math import comb
import unittest


class LegibilityCorrections(unittest.TestCase):
    def test_cover_probability_bound_can_be_strict(self):
        placements = tuple(combinations(range(4), 2))
        codewords = tuple(combinations(range(4), 3))
        best = max(
            sum(set(critical).issubset(left) or set(critical).issubset(right)
                for critical in placements)
            for left, right in combinations(map(set, codewords), 2)
        )
        self.assertEqual(Fraction(best, len(placements)), Fraction(5, 6))
        counting_upper_bound = min(Fraction(1), Fraction(2 * comb(3, 2), comb(4, 2)))
        self.assertEqual(counting_upper_bound, 1)

    def test_tie_can_share_a_head_but_strict_reversal_cannot(self):
        rankings = tuple(permutations(('a', 'b')))

        def serves(ranking, values):
            return all(sum(values[x] for x in ranking[:m]) ==
                       max(sum(values[x] for x in subset)
                           for subset in combinations(rankings[0], m))
                       for m in (1, 2))

        strict = {'a': 2, 'b': 1}
        tied = {'a': 1, 'b': 1}
        reversed_order = {'a': 1, 'b': 2}
        self.assertTrue(any(serves(r, strict) and serves(r, tied) for r in rankings))
        self.assertFalse(any(serves(r, strict) and serves(r, reversed_order) for r in rankings))

    def test_bayes_probability_threshold_including_degenerate_costs(self):
        for miss in range(5):
            for false_alarm in range(5):
                for attention in range(5):
                    for tenths in range(11):
                        posterior = Fraction(tenths, 10)
                        direct = miss * posterior >= attention + false_alarm * (1 - posterior)
                        if miss + false_alarm:
                            threshold = posterior >= Fraction(attention + false_alarm, miss + false_alarm)
                        else:
                            threshold = attention == 0
                        self.assertEqual(direct, threshold)
                        if miss > attention and posterior < 1:
                            odds = posterior / (1 - posterior)
                            self.assertEqual(direct, odds >= Fraction(attention + false_alarm, miss - attention))

    def test_old_odds_denominator_is_false(self):
        miss, attention, false_alarm, posterior = 10, 1, 1, Fraction(17, 100)
        old_odds = posterior / (1 - posterior) >= Fraction(attention + false_alarm, miss)
        direct = miss * posterior >= attention + false_alarm * (1 - posterior)
        self.assertTrue(old_odds)
        self.assertFalse(direct)

    def test_zoom_equality_is_break_even_for_displayed_bound(self):
        for flags in range(1, 161):
            for critical in range(1, flags + 1):
                levels = 0
                while (1 << levels) * critical < flags:
                    levels += 1
                upper_bound = critical * (2 * levels + 4)
                self.assertEqual(flags > upper_bound, 12 * critical < flags)
                self.assertEqual(flags == upper_bound, 12 * critical == flags)
        self.assertEqual(12, 1 * (2 * 4 + 4))

    def test_split_floor_strictness_and_wrong_numerator_reason(self):
        checked = 0
        for population in range(4, 21):
            for opens in range(2, population):
                for critical in range(1, opens // 2 + 1):
                    single = Fraction(comb(population, critical), comb(opens, critical))
                    union = Fraction(comb(population, 2 * critical), comb(opens, 2 * critical))
                    self.assertGreater(union, single * single)
                    checked += 1
        self.assertGreater(checked, 100)
        self.assertLess(comb(5, 2), comb(5, 1) ** 2)

    def test_escalation_needs_strictness_continuity_and_crossing(self):
        debit = Fraction(1, 20)
        root = debit / (1 + debit)
        payoff = lambda u: u - debit * (1 - u)
        self.assertLess(payoff(root - Fraction(1, 1000)), 0)
        self.assertEqual(payoff(root), 0)
        self.assertGreater(payoff(root + Fraction(1, 1000)), 0)
        # Flat b and V give no unique zero; a jumping V can skip zero.
        self.assertEqual(0, 0 - 0 * (1 - 0))
        jump = lambda u: u - 2 * (1 - int(u >= Fraction(1, 2)))
        self.assertLess(jump(Fraction(499, 1000)), 0)
        self.assertGreater(jump(Fraction(1, 2)), 0)

    def test_miscalibration_direction_against_decision_loss(self):
        threshold = Fraction(6, 105)
        # Overconfident score s=.1 represents true posterior .01.
        score, posterior = Fraction(1, 10), Fraction(1, 100)
        self.assertGreater(score, threshold)  # naive inspection
        self.assertLess(100 * posterior, 1 + 5 * (1 - posterior))
        self.assertLess(posterior, threshold)  # calibrated pass
        # Underconfident score s=.01 represents true posterior .1.
        score, posterior = posterior, score
        self.assertLess(score, threshold)  # naive pass
        self.assertGreater(100 * posterior, 1 + 5 * (1 - posterior))
        self.assertGreater(posterior, threshold)  # calibrated inspection

    def test_corruption_rate_is_not_a_per_run_count(self):
        # Two independent Bernoulli(1/2) corruptions have E[C]=1, but C=2
        # occurs with probability 1/4. A psi*N term cannot replace actual C
        # in a deterministic per-trace inequality.
        outcomes = (0, 1, 1, 2)
        self.assertEqual(Fraction(sum(outcomes), len(outcomes)), 1)
        self.assertGreater(max(outcomes), 1)


if __name__ == "__main__":
    unittest.main()
