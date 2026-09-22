"""Small analytic witnesses for the September 8 manuscript review.

These are synthetic arithmetic/linear-algebra checks, not deployment evidence,
empirical workload studies, or substitutes for the manuscript's proofs.
"""
import itertools
import math
import unittest
from fractions import Fraction as F
from pathlib import Path
import re

import numpy as np


def probation(gain, discount, caps):
    """Earliest-date optimum under finite caps and a deterrence constraint."""
    capacity = sum(discount**t * cap for t, cap in enumerate(caps))
    if gain > capacity:
        raise ValueError("finite-horizon infeasible")
    remaining = gain
    schedule = []
    for t, cap in enumerate(caps):
        amount = min(cap, remaining / discount**t)
        schedule.append(amount)
        remaining -= discount**t * amount
    return schedule


def greedy_vertex_cost(gain, dh, df, caps):
    return sum(dh**t * x for t, x in enumerate(probation(gain, df, caps)))


class ReviewMathBoundaries(unittest.TestCase):
    def test_recommendations_alone_do_not_make_a_correlated_equilibrium(self):
        # The chapter's (T,T) recommendation: deviating yields 4 rather than 3.
        mu = {(0, 0): F(1)}
        payoffs = [[3, 0], [4, 1]]
        obedience = sum(p * (payoffs[a][b] - payoffs[1][b])
                        for (a, b), p in mu.items() if a == 0)
        self.assertEqual(obedience, -1)

    def test_coarse_obedience_does_not_imply_conditional_obedience(self):
        # RPS, identical recommendations with probability 1/3 each.
        # Before seeing a recommendation every fixed deviation has payoff 0.
        # After seeing one, playing the winning response earns 1 instead of 0.
        payoff = lambda a, b: 0 if a == b else (1 if (a-b) % 3 == 1 else -1)
        mu = {(a, a): F(1, 3) for a in range(3)}
        for deviation in range(3):
            coarse_slack = sum(p * (payoff(a, b) - payoff(deviation, b))
                               for (a, b), p in mu.items())
            self.assertEqual(coarse_slack, 0)
        for recommendation in range(3):
            deviation = (recommendation + 1) % 3
            conditional_slack = sum(
                p * (payoff(a, b) - payoff(deviation, b))
                for (a, b), p in mu.items() if a == recommendation)
            self.assertEqual(conditional_slack, -F(1, 3))

    def test_grim_punishment_limit_is_scoped_to_stated_payoffs(self):
        for discount in (F(1, 10), F(1, 4), F(1, 3)):
            perpetual_loss = 2 * discount / (1 - discount)
            self.assertLessEqual(perpetual_loss, 1)
            for rounds in (1, 3, 10):
                finite_loss = 2 * sum(discount**t for t in range(1, rounds + 1))
                self.assertLess(finite_loss, perpetual_loss)

    def test_cross_chapter_equilibrium_boundaries_survive_regeneration(self):
        root = Path(__file__).resolve().parents[2]
        web = root / 'website-v2/public/whitepaper'
        bonded = (web / 'agent-transactions-whitepaper.tex').read_text()
        federated = (web / 'federated-harbor-whitepaper.tex').read_text()
        for invalid in ("the daemon's authority rests on it",
                        "Cooperation is impossible.",
                        "the crash tolerance it buys"):
            self.assertNotIn(invalid, bonded)
        for invalid in ("turns mutually-suspicious agents into a correlated equilibrium",
                        "the witness log's joint state is common knowledge",
                        "fall back to \\emph{local} correlated equilibrium"):
            self.assertNotIn(invalid, federated)
        self.assertIn("Private delivery alone does not make a signal private.", bonded)
        self.assertIn("not a proved equilibrium fallback", federated)
        self.assertIn(r'\bibitem{halpernmoses1990}', federated)
        self.assertIn(r'\bibitem{farina2024correlated}', federated)

    def test_escalation_monotonicity_alone_is_not_strict_or_an_interior_root(self):
        # Constant b=V=1/2 and delta*w=1 gives an entire interval of zeros.
        self.assertEqual([.5 - (1 - .5) for _ in range(5)], [0] * 5)
        # b(0)<delta*w does not ensure the other endpoint is positive.
        self.assertLess(.25, 1)
        self.assertLess(.25 + .25 - 1, 0)
        # A strictly increasing discontinuous benefit can jump across zero.
        grid = np.linspace(0, 1, 101)
        payoff = grid + (grid >= .5) - 1
        self.assertLess(payoff[0], 0)
        self.assertGreater(payoff[-1], 0)
        self.assertFalse(np.any(payoff == 0))

    def test_atomic_signal_distribution_can_make_debit_band_open(self):
        # All signals are 1/2; b(u)=u, V=0, w=1. With escalation at ties,
        # zero allowed alarm load requires delta>1/2, not delta>=1/2.
        load = lambda debit: int(.5 - debit >= 0)
        self.assertEqual(load(.5), 1)
        self.assertEqual(load(.500001), 0)

    def test_shared_punishment_countdown_matches_deviation_calculation(self):
        countdown = 0
        profiles = []
        for turn in range(5):
            prescribed = ('F', 'F') if countdown else ('T', 'T')
            actual = ('F', 'T') if turn == 0 else prescribed
            profiles.append(actual)
            countdown = 3 if actual != prescribed else max(0, countdown - 1)
        self.assertEqual(profiles, [('F', 'T'), ('F', 'F'), ('F', 'F'),
                                    ('F', 'F'), ('T', 'T')])

    def test_partial_payout_is_not_two_lifecycle_statuses(self):
        recipients, status = [80, 20, 0], [0, 0, 100, 0]
        self.assertEqual(sum(recipients), sum(status))
        self.assertEqual(sum(x != 0 for x in status), 1)
        wrong_status = [0, 0, 80, 20]
        self.assertEqual(sum(wrong_status), 100)
        self.assertFalse(all(x in (0, 100) for x in wrong_status))

    def test_requester_bounty_and_provider_bond_remain_distinct(self):
        # Bob funds 400 bounty; Alice funds 100 bond. Partial work earns 160,
        # the unused 240 returns to Bob, and 60 of Alice's bond is forfeited.
        bob = -400 + 240
        alice = -100 + 40 + 160
        commons = 60
        self.assertEqual((bob, alice, commons), (-160, 100, 60))
        self.assertEqual(bob + alice + commons, 0)

    def test_documented_kani_unwind_matches_source(self):
        root = Path(__file__).resolve().parents[2]
        rust = (root / 'core/harbor-card-rs/src/lib.rs').read_text()
        tex = (root / 'website-v2/public/whitepaper/anchor-protocol-whitepaper.tex').read_text()
        pattern = r'#\[kani::unwind\((\d+)\)\]\s*fn proof_verify_logic_only'
        self.assertEqual(re.search(pattern, rust).group(1),
                         re.search(pattern, tex).group(1))

    def test_market_handoff_has_one_canonical_label(self):
        root = Path(__file__).resolve().parents[2]
        text = (root / 'website-v2/public/whitepaper/spawn-to-person.tex').read_text()
        for label in ('sec:handoff', 'tab:handoff'):
            self.assertEqual(text.count('\\label{' + label + '}'), 1)

    def test_pinned_algorithm_still_validates_header(self):
        root = Path(__file__).resolve().parents[2]
        rust = (root / 'core/harbor-card-rs/src/lib.rs').read_text()
        tex = (root / 'website-v2/public/whitepaper/anchor-protocol-whitepaper.tex').read_text()
        self.assertIn('if header?.alg != SUPPORTED_ALG', rust)
        self.assertIn('pinning is not skipping validation', tex)
        self.assertIn('header.alg != SUPPORTED\\_ALG', tex)
        self.assertNotIn('There is no \\texttt{alg} branch', tex)

    def test_probation_finite_horizon_rejects_infinite_bound_false_positive(self):
        # The former infinite bound is 30, but two dates buy only 19.2.
        with self.assertRaises(ValueError):
            probation(F(20), F(3, 5), [F(12)] * 2)
        self.assertEqual(probation(F(20), F(3, 5), [F(12)] * 3),
                         [F(12), F(12), F(20, 9)])

    def test_probation_zero_and_exact_capacity(self):
        self.assertEqual(probation(F(0), F(1, 2), [F(3)] * 3), [0, 0, 0])
        self.assertEqual(probation(F(21, 4), F(1, 2), [F(3)] * 3), [3, 3, 3])

    def test_probation_greedy_is_unique_among_vertices_even_when_capped(self):
        df, dh = F(3, 5), F(19, 20)
        caps, gain = [F(12)] * 3, F(20)
        winner = tuple(probation(gain, df, caps))
        vertices = set()
        # A vertex on the tight deterrence plane has at most one free variable.
        for free in range(3):
            rest = [t for t in range(3) if t != free]
            for bits in itertools.product((0, 1), repeat=2):
                g = [F(0)] * 3
                for t, bit in zip(rest, bits):
                    g[t] = caps[t] * bit
                g[free] = (gain - sum(df**t * g[t] for t in rest)) / df**free
                if 0 <= g[free] <= caps[free]:
                    vertices.add(tuple(g))
        costs = {g: sum(dh**t * x for t, x in enumerate(g)) for g in vertices}
        self.assertIn(winner, costs)
        self.assertTrue(all(costs[g] > costs[winner] for g in vertices - {winner}))
        self.assertAlmostEqual(float(costs[winner]), 25.4055555556)

    def test_participation_does_not_imply_period_income_floor(self):
        # Positive lifetime surplus can coexist with a negative first-date cash flow.
        net = [-5, 10]
        self.assertGreater(sum(F(9, 10)**t * x for t, x in enumerate(net)), 0)
        self.assertLess(net[0], 0)
        self.assertEqual(probation(F(3), F(1, 2), [F(1), F(5)]), [1, 4])

    def test_service_variance_does_not_multiply_service_mean(self):
        def specialist(r, a, k):
            return 1 / r + k * a / (r * (r - a))
        for r, a in ((1.75, 1), (3, 2), (5, .5)):
            self.assertAlmostEqual(specialist(r, a, 1), 1 / (r - a))
        self.assertAlmostEqual(specialist(1.75, 1, 1), 4 / 3)
        new_crossing = (8 + math.sqrt(124)) / 10
        self.assertAlmostEqual(specialist(new_crossing, 1, 2), 5 / 3)
        self.assertGreater(new_crossing, 1.75)
        self.assertNotAlmostEqual(specialist(1.75, 1, 2), 5 / 3)

    def test_zoom_strict_endpoint_and_dense_failure(self):
        def advantage(d):
            return 1 / (d * (2 * math.ceil(math.log2(1 / d)) + 4))
        self.assertAlmostEqual(advantage(1 / 12), 1)
        self.assertGreater(advantage(.08), 1)
        self.assertLess(advantage(.09), 1)

    def test_three_round_trigger_root_not_reviewer_number(self):
        def f(d):
            return 2 * d**3 + 2 * d**2 + 2 * d - 1
        self.assertLess(f(.34250803), 0)
        self.assertGreater(f(.34250804), 0)
        self.assertLess(f(.3419), -.002)

    def test_trade_three_different_denominators(self):
        a = F(1, 4)
        lost_probability = a - a*a/2
        lost_surplus = a*a/2 - a**3/3
        self.assertEqual(lost_probability, F(7, 32))
        self.assertEqual(lost_probability / F(1, 2), F(7, 16))
        self.assertEqual(lost_surplus / F(1, 6), F(5, 32))

    def test_equal_pairwise_moments_do_not_determine_joint_misses(self):
        panels = [
            np.array([[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]]),
            np.array([[1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1]]),
        ]
        for panel in panels:
            np.testing.assert_allclose(panel.mean(axis=0), [.5] * 3)
            np.testing.assert_allclose(np.corrcoef(panel.T), np.eye(3))
        self.assertEqual(np.mean(np.all(panels[0] == 0, axis=1)), .25)
        self.assertEqual(np.mean(np.all(panels[1] == 0, axis=1)), 0)

    def test_beta_mixture_numbers(self):
        def miss(k):
            return math.prod((.2 + j) / (1 + j) for j in range(k))
        self.assertAlmostEqual(miss(3), .088)
        self.assertAlmostEqual(miss(5), .059136)

    def test_tree_has_positive_gap_but_no_residual(self):
        incidence = np.array([[-1., 1., 0.], [0., -1., 1.]])
        np.testing.assert_allclose(np.linalg.eigvalsh(incidence.T @ incidence),
                                   [0, 1, 3], atol=1e-12)
        projector = np.eye(2) - incidence @ np.linalg.pinv(incidence)
        np.testing.assert_allclose(projector, 0, atol=1e-12)

    def test_residual_bound_needs_projected_kernel_and_operator_norm(self):
        A = np.diag([2., 3.])
        P = np.diag([1., 0.])
        B = P @ A
        invisible = np.array([0., 1.])  # Not in ker(A), but in ker(P A).
        self.assertGreater(np.linalg.norm(A @ invisible), 0)
        self.assertEqual(np.linalg.norm(B @ invisible), 0)
        visible = np.array([1., 0.])
        self.assertGreater(np.linalg.norm(B @ visible), np.linalg.norm(visible))
        self.assertEqual(np.linalg.norm(B @ visible),
                         np.linalg.norm(B, 2) * np.linalg.norm(visible))

    def test_large_signal_does_not_preserve_ranking(self):
        clean = np.array([1., .99, 0.])
        noise = np.array([-.02, .02, .01])
        nu = np.linalg.norm(noise)
        self.assertGreater(clean.max(), 2 * nu)
        self.assertNotEqual(np.argmax(clean), np.argmax(clean + noise))
        self.assertGreater((clean + noise).max(), nu)
        self.assertLessEqual(abs((clean + noise)[2]), nu)
        self.assertLess(clean[0] - clean[1], 2 * nu)

    def test_strict_tower_depth_at_integer_log_boundary(self):
        gain, target, contraction = 8, 1, .5
        old_depth = math.ceil(math.log(gain / target) / math.log(1 / contraction))
        depth = math.floor(math.log(gain / target) / math.log(1 / contraction)) + 1
        self.assertEqual(gain * contraction**old_depth, target)
        self.assertLess(gain * contraction**depth, target)


if __name__ == "__main__":
    unittest.main()
