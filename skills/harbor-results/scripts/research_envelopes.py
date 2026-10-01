#!/usr/bin/env python3
"""Finite checks for research-program-20260930.md; no runtime or external deps.

The proofs live in the research note. These small enumerations are corroboration,
not proofs of deployed behavior or general research novelty. Import has no effects.
"""

from fractions import Fraction
from itertools import combinations, product
import json
from math import comb, log2


ATOMS = ("a", "b")
BOTTOM = "bottom"


def subsets(items):
    """Deterministic subsets of the supplied sequence."""
    items = tuple(items)
    return tuple(frozenset(c) for n in range(len(items) + 1)
                 for c in combinations(items, n))


def require(condition, message):
    """Checks remain enabled under python -O."""
    if not condition:
        raise AssertionError(message)


def horn_closure(facts, rules):
    result = set(facts)
    while True:
        expanded = result | {head for body, head in rules if set(body) <= result}
        if expanded == result:
            return frozenset(result)
        result = expanded


def conflict(facts, rules):
    """Fixed tokens a->O(write,s,[0,1]), b->F(write,s,[0,1])."""
    closed = horn_closure(facts, rules)
    return BOTTOM in closed or set(ATOMS) <= closed


def truth_table_conflict(facts, rules):
    """Independent interpretation oracle; bottom is false in every model.

    Horn consequences are facts true in every satisfying interpretation.
    Unsatisfiable Horn constraints are a conflict in their own right.
    """
    models = [world for world in subsets(ATOMS)
              if set(facts) <= world and all(
                  not set(body) <= world or head in world
                  for body, head in rules)]
    if not models:
        return True
    return all(set(ATOMS) <= world for world in models)


def check_envelopes():
    pool = tuple((body, head)
                 for body in ((), ("a",), ("b",))
                 for head in (*ATOMS, BOTTOM))
    valuations = subsets(ATOMS)
    cases = oracle_cases = 0
    for bits in product((False, True), repeat=len(pool)):
        rules = tuple(rule for rule, include in zip(pool, bits) if include)
        verdicts = {}
        for facts in valuations:
            verdicts[facts] = conflict(facts, rules)
            require(verdicts[facts] == truth_table_conflict(facts, rules),
                    f"Horn oracle disagreement: {facts}, {rules}")
            oracle_cases += 1
        for facts, future in product(valuations, repeat=2):
            maximum = verdicts[facts | future]
            reachable = [verdicts[facts | added]
                         for added in valuations if added <= future]
            require(maximum == any(reachable), "Maximal-fact mismatch")
            cases += 1

    # One event activates both tokens. Current-only admission misses the future.
    rules = ((('event',), 'a'), (('event',), 'b'))
    dormant = [conflict(set(), rules), conflict({'event'}, rules)]
    require(dormant == [False, True], "Dormant witness disappeared")
    require(not dormant[0] and dormant[1], "Current-only mutant not caught")

    # Independent propagation mutant: explicit facts alone miss an indirect clash.
    rules = (((), 'a'), (('a',), 'b'))
    require(conflict(set(), rules), "Expected propagated conflict")
    require(not (set(ATOMS) <= set()), "No-propagation mutant not caught")

    # The maximum must itself be reachable to claim exactness, not just soundness.
    exclusive = [conflict(facts, ()) for facts in
                 (set(), {'a'}, {'b'}, {'a', 'b'})]
    require(exclusive == [False, False, False, True],
            "Exclusive-future overapproximation witness disappeared")
    return {"horn_programs": 512, "independent_oracle_cases": oracle_cases,
            "envelope_cases": cases, "dormant_then_activated": dormant,
            "exclusive_futures_then_union": exclusive,
            "mutants_caught": ["current_facts_only", "omit_horn_propagation",
                               "assume_unreachable_union_is_exact"]}


def maximal_reachable(family):
    """Explicit finite reachable fact sets; no reachability inference here."""
    family = frozenset(map(frozenset, family))
    require(bool(family), "Reachable family must be nonempty")
    return frozenset(facts for facts in family
                     if not any(facts < later for later in family))


def check_reachable_families():
    """Exhaustive independent-oracle sweep before stating the finite-family lemma."""
    atoms = ('a', 'b', 'c')
    valuations = subsets(atoms)
    pool = tuple((body, head)
                 for body in ((), ('c',), ('a', 'b'))
                 for head in ('a', 'b', BOTTOM))
    programs = families = oracle_cases = 0
    for bits in product((False, True), repeat=len(pool)):
        rules = tuple(rule for rule, enabled in zip(pool, bits) if enabled)
        verdict = {}
        for facts in valuations:
            verdict[facts] = conflict(facts, rules)
            # The truth-table oracle ranges over all three factual atoms;
            # unlike truth_table_conflict, it does not reuse the decision code.
            models = [world for world in valuations
                      if facts <= world and all(
                          not set(body) <= world or head in world
                          for body, head in rules)]
            independent = not models or all({'a', 'b'} <= world for world in models)
            require(verdict[facts] == independent,
                    f"Three-atom oracle disagreement: {facts}, {rules}")
            oracle_cases += 1
        for mask in range(1, 1 << len(valuations)):
            family = frozenset(valuations[i] for i in range(len(valuations))
                               if mask & (1 << i))
            maximal = maximal_reachable(family)
            require(any(verdict[f] for f in family) ==
                    any(verdict[f] for f in maximal),
                    f"Maximal-family mismatch: {family}, {rules}")
            families += 1
        programs += 1

    dormant_rules = ((('c',), 'a'), (('c',), 'b'))
    current_only = (frozenset(), frozenset({'c'}))
    require(not conflict(current_only[0], dormant_rules)
            and conflict(current_only[1], dormant_rules),
            "Current-only admission mutant survived")
    exclusive = (frozenset(), frozenset({'a'}), frozenset({'b'}))
    require(not any(conflict(f, ()) for f in exclusive)
            and conflict(frozenset().union(*exclusive), ()),
            "Unreachable-union shortcut mutant survived")
    return {'horn_programs': programs, 'reachable_families': families,
            'independent_oracle_cases': oracle_cases,
            'universe_atoms': list(atoms),
            'mutants_caught': ['current_facts_only', 'unreachable_union_shortcut']}


def respects_parity(payload_map):
    return all(payload_map[x] % 2 == payload_map[y] % 2
               for x, y in product(range(4), repeat=2) if x % 2 == y % 2)


def factors_through_parity(payload_map):
    return any(all(payload_map[x] % 2 == h[x % 2] for x in range(4))
               for h in product(range(2), repeat=2))


def check_payloads():
    safe = leaking = 0
    for payload_map in product(range(4), repeat=4):
        equivalent = respects_parity(payload_map)
        require(equivalent == factors_through_parity(payload_map),
                f"Factorization mismatch: {payload_map}")
        safe += int(equivalent)
        leaking += int(not equivalent)
    attack = tuple(s // 2 for s in range(4))
    require(not respects_parity(attack), "Payload laundering mutant not caught")
    require(attack[0] % 2 != attack[2] % 2,
            "Expected equal-parity distinguishing witness")
    # The one-bit-only mutant accepts all 256 maps, including this leaking map.
    require(all(value % 2 in (0, 1) for value in attack),
            "Expected bit-budget mutant to admit the attack")
    require((safe, leaking) == (64, 192), "Unexpected finite payload counts")
    return {"maps": safe + leaking, "safe": safe, "leaking": leaking,
            "witness_secrets": [0, 2], "witness_payloads": [0, 1],
            "mutant_caught": "one_bit_budget_implies_permitted_release"}


def check_split_floors(max_n=60):
    count = 0
    for n in range(3, max_n + 1):
        for opened in range(2, n):
            for k in range(1, opened // 2 + 1):
                single = Fraction(comb(n, k), comb(opened, k))
                joint = Fraction(comb(n, 2 * k), comb(opened, 2 * k))
                require(joint > single * single, "Split-floor inequality failed")
                require(comb(n, 2 * k) < comb(n, k) ** 2,
                        "Numerator inequality witness failed")
                count += 1
    # Smallest counterexample to the stated numerator-superadditivity explanation.
    require(comb(3, 2) < comb(3, 1) ** 2, "Wrong-reason mutant not caught")
    return {"exact_triples": count, "max_n": max_n,
            "example_single_bits": log2(Fraction(comb(60, 2), comb(8, 2))),
            "example_joint_bits": log2(Fraction(comb(60, 4), comb(8, 4))),
            "sequence_ratios": {
                str(k): log2(2*k+1) / (2*log2(Fraction(2*k+1, k+1)))
                for k in (1, 10, 100, 1000)},
            "mutant_caught": "numerator_log_binomial_superadditivity"}


def check_weighted_buyout():
    weights = (Fraction(9, 10), Fraction(1, 10))
    capture = Fraction(1, 5)
    gain, price = 100, 10
    values = {}
    for bought in subsets(range(2)):
        value = gain*(1-capture*sum(w for i, w in enumerate(weights)
                                   if i not in bought))-price*len(bought)
        # Independent expectation over which single clique is sampled.
        by_draw = sum(w * (gain if i in bought else gain*(1-capture))
                      for i, w in enumerate(weights))-price*len(bought)
        require(value == by_draw, "Weighted expected-payoff mismatch")
        values[bought] = value
    require(values[frozenset({0})] == 88 and max(values.values()) == 88,
            "Expected partial-buyout optimum")
    require(values[frozenset({0})] > max(values[frozenset()],
                                       values[frozenset({0, 1})]),
            "All-or-nothing extension mutant not caught")
    return {"payoffs": {','.join(map(str, sorted(s))) or 'none': int(v)
                        for s, v in values.items()},
            "mutant_caught": "equal_weight_conclusion_for_unequal_weights"}


def run_checks():
    return {"scope": "finite synthetic model checks; proofs in research note",
            "envelopes": check_envelopes(),
            "reachable_families": check_reachable_families(),
            "payloads": check_payloads(),
            "split_floors": check_split_floors(),
            "weighted_buyout": check_weighted_buyout()}


if __name__ == "__main__":
    print(json.dumps(run_checks(), indent=2, sort_keys=True))
