#!/usr/bin/env python3
"""Exact one-shot-deviation audit of a specified finite public trigger game.

This is a finite rational calculation, not a Lean/TLAPS proof or a deployed
sanction mechanism. The standard discounted one-shot-deviation principle
connects all-state obedience to SPE only under the stated model assumptions.
There is no claim of universal novelty or strict Nash equilibrium.

Players are two persistent principals with risk-neutral, additive discounted
utility. Forfeitures go to an outside party, never to the opponent. Funding
and replenishment are exogenous and unlimited: finite-bankroll insolvency is
not modeled. T/F are the only actions; participation, exit, identity changes,
coalitions and side payments are outside this game. The illustrative payoff
table is constructed, not measured. An obedience verdict is not an individual-
rationality or participation certificate.
`expected_forfeiture` may equal q*b, but q affects ONLY the current monetary
payment. Actions and the shared countdown are perfectly publicly observed;
q does not gate the punishment trigger. Private/delayed monitoring is rejected.

`all_false_actions` charges every F, including prescribed punishment. In
`unprescribed_deviations`, prescribed punishment F is exempt: the charge is
for any action other than the mode's prescription, including T in punishment.
`cooperation_false_only` is the reviewer-style alternative: it charges F in
cooperation and nothing during punishment. It shares the cooperative-state
cubic with `unprescribed_deviations`, but their off-path gains differ. These
are distinct games, not interchangeable ways to compute one frontier.

The CLI prints exact JSON fractions; a valid non-equilibrium audit still exits
successfully. Use the returned verdict, rather than the process exit code.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from fractions import Fraction
import json
from typing import Mapping

JointAction = tuple[str, str]
Key = tuple[str, JointAction]
PayoffMatrix = Mapping[JointAction, tuple[Fraction, Fraction]]
ACTIONS = ("T", "F")
PENALTY_RULES = ("all_false_actions", "cooperation_false_only", "unprescribed_deviations")
JOINT_ACTIONS = tuple((a, b) for a in ACTIONS for b in ACTIONS)
CLAIM_SIGNALING_PAYOFFS = {
    ("T", "T"): (Fraction(3), Fraction(3)),
    ("T", "F"): (Fraction(0), Fraction(4)),
    ("F", "T"): (Fraction(4), Fraction(0)),
    ("F", "F"): (Fraction(1), Fraction(1)),
}
ASSUMPTIONS = (
    "Two persistent principals; no identity escape; constructed, unmeasured payoffs.",
    "Risk-neutral additive discounted utility; unlimited exogenous replenishment.",
    "No finite-bankroll solvency, outside-option or participation certificate.",
    "Only unilateral T/F deviations; no exit, coalition or side-payment actions.",
    "Forfeiture goes to a third party and is not paid to the opponent.",
    "Perfect public action observation and one shared punishment counter.",
    "Expected forfeiture affects current payment only, not trigger detection.",
    "Finite rational audit; no deployed guarantee or strict-Nash assertion.",
)


def exact(value: Fraction | int) -> Fraction:
    """Reject floats rather than importing their hidden binary rounding."""
    if type(value) not in (int, Fraction):
        raise TypeError("parameters and payoffs must be Fraction or int")
    return Fraction(value)


@dataclass(frozen=True)
class Reward:
    base: Fraction
    forfeiture: Fraction

    @property
    def net(self) -> Fraction:
        return self.base - self.forfeiture


@dataclass(frozen=True)
class PublicGame:
    states: tuple[str, ...]
    prescribed: Mapping[str, JointAction]
    rewards: Mapping[Key, tuple[Reward, Reward]]
    transitions: Mapping[Key, str]
    penalty_rule: str
    monitoring: str = "perfect_public"


@dataclass(frozen=True)
class ActionValue:
    next_state: str
    base_payoff: Fraction
    forfeiture: Fraction
    net_payoff: Fraction
    continuation_value: Fraction
    total_value: Fraction


@dataclass(frozen=True)
class Deviation:
    player: int
    state: str
    prescribed_action: str
    alternative_action: str
    follow: ActionValue
    deviate: ActionValue
    gain: Fraction


@dataclass(frozen=True)
class EquilibriumAudit:
    delta: Fraction
    penalty_rule: str
    values: Mapping[str, tuple[Fraction, Fraction]]
    deviations: tuple[Deviation, ...]

    @property
    def weak_ic(self) -> bool:
        return all(d.gain <= 0 for d in self.deviations)

    @property
    def strict_action_deterrence(self) -> bool:
        return all(d.gain < 0 for d in self.deviations)

    @property
    def worst_deviation(self) -> Deviation:
        return max(self.deviations, key=lambda d: d.gain)

    def as_dict(self) -> dict:
        from dataclasses import asdict

        def encode(obj):
            if isinstance(obj, Fraction):
                return str(obj)
            if isinstance(obj, dict):
                return {key: encode(value) for key, value in obj.items()}
            if isinstance(obj, (tuple, list)):
                return [encode(value) for value in obj]
            return obj

        return encode({
            "delta": self.delta, "penalty_rule": self.penalty_rule,
            "assumptions": ASSUMPTIONS, "weak_ic": self.weak_ic,
            "strict_action_deterrence": self.strict_action_deterrence,
            "values": dict(self.values), "checks": len(self.deviations),
            "worst_deviation": asdict(self.worst_deviation),
            "deviations": [asdict(d) for d in self.deviations],
        })


def build_trigger_game(punishment_rounds: int, stage_payoffs: PayoffMatrix,
                       expected_forfeiture: Fraction, penalty_rule: str,
                       monitoring: str = "perfect_public") -> PublicGame:
    if monitoring != "perfect_public":
        raise ValueError("only perfect_public monitoring is supported")
    if type(punishment_rounds) is not int or punishment_rounds < 1:
        raise ValueError("punishment_rounds must be a positive integer")
    if penalty_rule not in PENALTY_RULES:
        raise ValueError("unknown penalty rule")
    penalty = exact(expected_forfeiture)
    if penalty < 0:
        raise ValueError("expected_forfeiture must be nonnegative")
    if set(stage_payoffs) != set(JOINT_ACTIONS):
        raise ValueError("stage_payoffs must specify all four joint actions")
    payoff = {}
    for joint, pair in stage_payoffs.items():
        if len(pair) != 2:
            raise ValueError("each joint action needs two principal payoffs")
        payoff[joint] = tuple(exact(x) for x in pair)
    states = ("C",) + tuple(f"P{r}" for r in range(1, punishment_rounds + 1))
    prescribed, rewards, transitions = {}, {}, {}
    for r, state in enumerate(states):
        prescription = ("T", "T") if r == 0 else ("F", "F")
        prescribed[state] = prescription
        for joint in JOINT_ACTIONS:
            transitions[state, joint] = (
                states[max(0, r - 1)] if joint == prescription else states[-1]
            )
            if penalty_rule == "all_false_actions":
                charged = tuple(a == "F" for a in joint)
            elif penalty_rule == "cooperation_false_only":
                charged = tuple(r == 0 and a == "F" for a in joint)
            else:
                charged = tuple(a != prescription[i] for i, a in enumerate(joint))
            rewards[state, joint] = tuple(
                Reward(payoff[joint][i], penalty if charged[i] else Fraction(0))
                for i in range(2)
            )
    return PublicGame(states, prescribed, rewards, transitions, penalty_rule, monitoring)


def _solve(matrix: list[list[Fraction]], rhs: list[Fraction]) -> list[Fraction]:
    """Exact Gauss-Jordan elimination; callers construct I - delta P."""
    rows = [list(row) + [value] for row, value in zip(matrix, rhs)]
    n = len(rows)
    for col in range(n):
        pivot = next((r for r in range(col, n) if rows[r][col]), None)
        if pivot is None:
            raise ValueError("singular continuation system")
        rows[col], rows[pivot] = rows[pivot], rows[col]
        divisor = rows[col][col]
        rows[col] = [value / divisor for value in rows[col]]
        for r in range(n):
            if r != col:
                multiplier = rows[r][col]
                rows[r] = [a - multiplier * b for a, b in zip(rows[r], rows[col])]
    return [row[-1] for row in rows]


def audit_public_game(game: PublicGame, delta: Fraction) -> EquilibriumAudit:
    """Audit every state, including states unreachable under cooperative play.

    Separate from the trigger builder so tests can mutate transition semantics
    without changing the value evaluator. At n states, exact elimination uses
    O(n^3) rational operations, followed by 2n unilateral deviation checks.
    """
    delta = exact(delta)
    if not 0 <= delta < 1:
        raise ValueError("delta must satisfy 0 <= delta < 1")
    if game.monitoring != "perfect_public":
        raise ValueError("only perfect_public monitoring is supported")
    states = game.states
    if not states or len(set(states)) != len(states):
        raise ValueError("states must be nonempty and unique")
    keys = {(s, a) for s in states for a in JOINT_ACTIONS}
    if (set(game.prescribed) != set(states) or set(game.transitions) != keys
            or set(game.rewards) != keys):
        raise ValueError("game must define every state and joint action")
    if any(a not in JOINT_ACTIONS for a in game.prescribed.values()):
        raise ValueError("invalid prescribed action")
    if any(s not in states for s in game.transitions.values()):
        raise ValueError("transition has an unknown destination")
    for pair in game.rewards.values():
        if len(pair) != 2 or any(exact(r.forfeiture) < 0 for r in pair):
            raise ValueError("each action needs two rewards with nonnegative forfeitures")
        for reward in pair:
            exact(reward.base)
    index = {s: i for i, s in enumerate(states)}
    matrix = [[Fraction(int(i == j)) for j in range(len(states))]
              for i in range(len(states))]
    for s in states:
        matrix[index[s]][index[game.transitions[s, game.prescribed[s]]]] -= delta
    player_values = [_solve(matrix, [game.rewards[s, game.prescribed[s]][i].net
                                    for s in states]) for i in range(2)]
    values = {s: tuple(v[index[s]] for v in player_values) for s in states}
    deviations = []
    for s in states:
        for i in range(2):
            follow_action = game.prescribed[s]
            alternate = list(follow_action)
            alternate[i] = "F" if follow_action[i] == "T" else "T"

            def evaluate(joint):
                reward = game.rewards[s, joint][i]
                destination = game.transitions[s, joint]
                continuation = values[destination][i]
                return ActionValue(destination, reward.base, reward.forfeiture,
                                   reward.net, continuation, reward.net + delta * continuation)

            follow, deviate = evaluate(follow_action), evaluate(tuple(alternate))
            assert follow.total_value == values[s][i], "Bellman equation mismatch"
            deviations.append(Deviation(i, s, follow_action[i], alternate[i], follow,
                                        deviate, deviate.total_value - follow.total_value))
    return EquilibriumAudit(delta, game.penalty_rule, values, tuple(deviations))


def audit_trigger(delta: Fraction, punishment_rounds: int,
                  stage_payoffs: PayoffMatrix, expected_forfeiture: Fraction,
                  penalty_rule: str, monitoring: str = "perfect_public") -> EquilibriumAudit:
    return audit_public_game(build_trigger_game(punishment_rounds, stage_payoffs,
                             expected_forfeiture, penalty_rule, monitoring), delta)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--delta", type=Fraction, required=True)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--forfeiture", type=Fraction, default=Fraction(0))
    parser.add_argument("--penalty-rule", required=True,
                        choices=PENALTY_RULES)
    args = parser.parse_args()
    report = audit_trigger(args.delta, args.rounds, CLAIM_SIGNALING_PAYOFFS,
                           args.forfeiture, args.penalty_rule)
    print(json.dumps(report.as_dict(), indent=2))


if __name__ == "__main__":
    main()
