#!/usr/bin/env python3
"""Independent closed forms and semantic mutants for the public trigger audit."""
from dataclasses import replace
from fractions import Fraction as F
import unittest

from bonded_trigger_audit import (
    CLAIM_SIGNALING_PAYOFFS, PENALTY_RULES, Reward, audit_public_game, audit_trigger,
    build_trigger_game,
)


class BondedTriggerAuditTests(unittest.TestCase):
    def run_case(self, delta, penalty=F(0), rule="all_false_actions", rounds=3):
        return audit_trigger(delta, rounds, CLAIM_SIGNALING_PAYOFFS, penalty, rule)

    def test_original_unbonded_threshold_and_every_public_state(self):
        self.assertFalse(self.run_case(F(3, 10)).weak_ic)
        report = self.run_case(F(35, 100))
        self.assertTrue(report.weak_ic)
        self.assertTrue(report.strict_action_deterrence)
        self.assertEqual({(d.state, d.player) for d in report.deviations},
                         {(s, p) for s in ("C", "P1", "P2", "P3") for p in (0, 1)})

    def test_weak_equality_is_not_strict_deterrence(self):
        report = self.run_case(F(1, 2), rounds=1)
        self.assertTrue(report.weak_ic)
        self.assertFalse(report.strict_action_deterrence)
        self.assertEqual(report.worst_deviation.gain, 0)

    def test_payment_conventions_change_the_cooperation_verdict(self):
        all_false = self.run_case(F(19, 100), F(1, 2))
        exempt = self.run_case(F(19, 100), F(1, 2), "unprescribed_deviations")
        self.assertTrue(all_false.weak_ic)
        self.assertFalse(exempt.weak_ic)
        self.assertEqual(all_false.deviations[0].gain, -F(164795, 2000000))
        self.assertEqual(exempt.deviations[0].gain, F(17041, 500000))

    def test_cooperation_only_check_misses_off_path_profitable_deviation(self):
        report = self.run_case(F(1, 10), F(2))
        self.assertEqual(report.deviations[0].gain, -F(361, 250))
        self.assertTrue(all(d.gain < 0 for d in report.deviations if d.state == "C"))
        self.assertFalse(report.weak_ic)
        witness = report.worst_deviation
        self.assertEqual(witness.state, "P3")
        self.assertEqual(witness.follow.total_value, -F(83, 75))
        self.assertEqual(witness.deviate.total_value, -F(83, 750))
        self.assertEqual(witness.gain, F(249, 250))

    def test_reviewer_cooperation_only_fine_differs_off_path(self):
        cooperation_only = self.run_case(F(1, 2), F(1, 2), "cooperation_false_only")
        all_deviations = self.run_case(F(1, 2), F(1, 2), "unprescribed_deviations")
        for left, right in zip(cooperation_only.deviations, all_deviations.deviations):
            if left.state == "C":
                self.assertEqual(left.gain, right.gain)
            else:
                self.assertEqual(left.deviate.forfeiture, 0)
                self.assertEqual(right.deviate.forfeiture, F(1, 2))
                self.assertEqual(left.gain - right.gain, F(1, 2))

    def test_obedience_does_not_establish_participation(self):
        # Subtracting the same amount each round preserves incentives, while
        # making continued participation worse than an outside value of zero.
        payoffs = {a: tuple(u - 10 for u in pair)
                   for a, pair in CLAIM_SIGNALING_PAYOFFS.items()}
        report = audit_trigger(F(9, 10), 3, payoffs, F(0), "all_false_actions")
        self.assertTrue(report.weak_ic)
        self.assertEqual(report.values["C"], (F(-70), F(-70)))
        self.assertGreater(F(0), report.values["C"][0])

    def test_zero_discount_stage_dominance_does_not_certify_punishment(self):
        # t=1 makes T weakly dominate F in the all-F-penalty stage game.
        equal = self.run_case(F(0), F(1))
        self.assertTrue(equal.weak_ic)
        self.assertFalse(equal.strict_action_deterrence)
        # t>1 makes T strictly dominate F, so prescribed F is not credible.
        self.assertFalse(self.run_case(F(0), F(2)).weak_ic)
        self.assertTrue(self.run_case(F(0), F(2), "unprescribed_deviations").weak_ic)

    def test_all_state_values_against_independent_geometric_sums(self):
        # Derive from payoff paths, without the implementation's matrix solver.
        checked = 0
        for rounds in (1, 2, 3, 5):
            for delta in (F(0), F(1, 10), F(1, 2), F(9, 10)):
                for penalty in (F(0), F(1, 2), F(1), F(2)):
                    for rule in PENALTY_RULES:
                        report = self.run_case(delta, penalty, rule, rounds)
                        punishment = 1 - penalty if rule == "all_false_actions" else F(1)
                        sucker = -penalty if rule == "unprescribed_deviations" else F(0)
                        cooperation = F(3) / (1 - delta)
                        for dev in report.deviations:
                            r = 0 if dev.state == "C" else int(dev.state[1:])
                            value = punishment * sum(delta**j for j in range(r)) + delta**r * cooperation
                            gain = (1 - penalty - (3 - punishment) *
                                    sum(delta**j for j in range(1, rounds + 1))) if r == 0 else (
                                    sucker - punishment - (3 - punishment) *
                                    sum(delta**j for j in range(r, rounds + 1)))
                            self.assertEqual(dev.follow.total_value, value)
                            self.assertEqual(dev.gain, gain)
                            checked += 1
        self.assertEqual(checked, 1440)

    def test_asymmetric_players_are_evaluated_separately(self):
        payoffs = {("T", "T"): (3, 5), ("T", "F"): (0, 6),
                   ("F", "T"): (4, -1), ("F", "F"): (1, 2)}
        report = audit_trigger(F(1, 2), 2, payoffs, F(1, 2), "all_false_actions")
        for dev in report.deviations:
            c, d, p, s = (3, 4, 1, 0) if dev.player == 0 else (5, 6, 2, -1)
            penalty, delta = F(1, 2), F(1, 2)
            r = 0 if dev.state == "C" else int(dev.state[1:])
            expected = (d - penalty - c - (c - p + penalty) * (delta + delta**2)
                        if r == 0 else s - p + penalty - (c - p + penalty) *
                        sum(delta**j for j in range(r, 3)))
            self.assertEqual(dev.gain, expected)

    def test_reset_to_cooperation_mutant_is_caught(self):
        game = build_trigger_game(3, CLAIM_SIGNALING_PAYOFFS, F(0), "all_false_actions")
        self.assertTrue(audit_public_game(game, F(9, 10)).weak_ic)
        transitions = dict(game.transitions)
        for joint in (("T", "F"), ("F", "T")):
            transitions["P3", joint] = "C"  # Wrong: a deviation earns early pardon.
        mutant = audit_public_game(replace(game, transitions=transitions), F(9, 10))
        self.assertFalse(mutant.weak_ic)
        self.assertEqual(mutant.worst_deviation.gain, F(121, 50))

    def test_double_decrement_mutant_is_caught(self):
        game = build_trigger_game(3, CLAIM_SIGNALING_PAYOFFS, F(0), "all_false_actions")
        self.assertTrue(audit_public_game(game, F(35, 100)).weak_ic)
        transitions = dict(game.transitions)
        for r in range(1, 4):
            transitions[f"P{r}", ("F", "F")] = "C" if r <= 2 else f"P{r-2}"
        mutant = audit_public_game(replace(game, transitions=transitions), F(35, 100))
        self.assertFalse(mutant.weak_ic)
        self.assertEqual(mutant.worst_deviation.gain, F(11, 200))

    def test_omitting_punishment_forfeiture_changes_the_game(self):
        game = build_trigger_game(3, CLAIM_SIGNALING_PAYOFFS, F(1, 2), "all_false_actions")
        self.assertTrue(audit_public_game(game, F(19, 100)).weak_ic)
        rewards = dict(game.rewards)
        for r in range(1, 4):
            rewards[f"P{r}", ("F", "F")] = (Reward(F(1), F(0)),) * 2
        mutant = audit_public_game(replace(game, rewards=rewards), F(19, 100))
        self.assertFalse(mutant.weak_ic)
        self.assertEqual(mutant.deviations[0].gain, F(17041, 500000))

    def test_report_is_exact_and_replayable(self):
        report = self.run_case(F(19, 100), F(1, 2))
        data = report.as_dict()
        self.assertEqual(data["checks"], 8)
        self.assertEqual(data["delta"], "19/100")
        self.assertNotIn("strict_nash", data)
        for deviation in data["deviations"]:
            for choice in ("follow", "deviate"):
                row = deviation[choice]
                self.assertEqual(F(row["net_payoff"]), F(row["base_payoff"]) - F(row["forfeiture"]))
                self.assertEqual(F(row["total_value"]), F(row["net_payoff"]) +
                                 F(data["delta"]) * F(row["continuation_value"]))
            self.assertEqual(F(deviation["gain"]), F(deviation["deviate"]["total_value"]) -
                             F(deviation["follow"]["total_value"]))

    def test_invalid_or_unsupported_inputs_fail_closed(self):
        for delta in (-1, 1, F(11, 10), 0.1, True):
            with self.assertRaises((TypeError, ValueError)):
                self.run_case(delta)
        for rounds in (0, -1, True, F(3)):
            with self.assertRaises(ValueError):
                self.run_case(F(1, 2), rounds=rounds)
        with self.assertRaises(ValueError):
            self.run_case(F(1, 2), F(-1))
        with self.assertRaises(ValueError):
            self.run_case(F(1, 2), rule="unspecified")
        for monitoring in ("private", "delayed", "imperfect_public"):
            with self.assertRaises(ValueError):
                audit_trigger(F(1, 2), 3, CLAIM_SIGNALING_PAYOFFS, F(0),
                              "all_false_actions", monitoring)
        with self.assertRaises(ValueError):
            audit_trigger(F(1, 2), 3, {}, F(0), "all_false_actions")


if __name__ == "__main__":
    unittest.main()
