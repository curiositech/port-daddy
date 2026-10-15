#!/usr/bin/env python3
"""Exact finite witnesses for the Harbor Book's foundations chapter.

These checks exercise the hypotheses and counterexamples in Chapter 0.
They are reproducible examples, not proofs of the general theorems and not
measurements of an operating agent system. No network or runtime is used.
"""
from fractions import Fraction as F
from itertools import permutations, product
from math import comb
import json


def nucleus(probabilities, threshold):
    """Return a stable probability-descending prefix crossing threshold."""
    ordered = sorted(enumerate(probabilities), key=lambda item: (-item[1], item[0]))
    total = F(0)
    result = []
    for index, probability in ordered:
        total += probability
        result.append(index)
        if total >= threshold:
            return tuple(result)
    raise AssertionError("probabilities must reach threshold")


def test_nucleus():
    assert nucleus([F(95, 100), F(5, 100)], F(9, 10)) == (0,)
    assert nucleus([F(6, 10), F(3, 10), F(1, 10)], F(8, 10)) == (0, 1)
    assert nucleus([F(1, 2), F(1, 2)], F(1)) == (0, 1)


def test_hazards():
    # Uniform hazard gives exactly the chapter's upper bound at equality.
    assert (1 - F(1, 10)) ** 3 == F(729, 1000)
    # A safe-only policy survives; stochasticity is no lower bound on risk.
    assert (1 - F(0)) ** 100 == 1
    survival = F(1)
    for t in range(1, 31):
        survival *= 1 - F(1, 2 ** (t + 2))
    assert survival > F(3, 4)
    # Positive dependence is allowed by a history-wise conditional bound.
    # Two safe first-step states carry mass .4 each; the rest fails.
    second_survival = F(2, 5) * F(3, 4) + F(2, 5) * F(1, 2)
    assert second_survival == F(1, 2) <= (1 - F(1, 5)) ** 2


def test_concurrency():
    outcomes, cas_rejections = set(), set()
    valid_schedules = 0
    for schedule in permutations(('Ar', 'Aw', 'Br', 'Bw')):
        if any(schedule.index(a + 'r') > schedule.index(a + 'w') for a in 'AB'):
            continue
        valid_schedules += 1
        value, version, guarded_value, rejected = 0, 0, 0, 0
        reads, versions, guarded_reads = {}, {}, {}
        for agent, operation in schedule:
            if operation == 'r':
                reads[agent], versions[agent] = value, version
                guarded_reads[agent] = guarded_value
            else:
                value = reads[agent] + 1
                if versions[agent] == version:
                    guarded_value = guarded_reads[agent] + 1
                    version += 1
                else:
                    rejected += 1
        outcomes.add(value)
        cas_rejections.add(rejected)
        assert guarded_value + rejected == 2
    assert valid_schedules == 6 and outcomes == {1, 2}
    assert cas_rejections == {0, 1}


def auction_utility(value, bid, rival):
    # Fixed tie policy favors this bidder; zero if the bidder loses.
    return value - rival if bid >= rival else 0


def test_vcg_and_deterrence():
    for value, rival, bid in product(range(11), range(11), range(13)):
        assert auction_utility(value, value, rival) >= auction_utility(value, bid, rival)
    assert auction_utility(10, 9, 5) == auction_utility(10, 10, 5) == 5
    assert (1 - F(1, 10)) * 10 - F(1, 10) * 100 == -1
    # If the gain is retained on detection, the same example only ties.
    assert 10 - F(1, 10) * 100 == 0


def test_aggregation():
    rankings = tuple(permutations('ABC'))
    profiles = tuple(product(rankings, repeat=3))
    signatures = {}
    iia_witness = False
    for profile in profiles:
        scores = {a: sum(2 - r.index(a) for r in profile) for a in 'ABC'}
        order = sorted('ABC', key=lambda a: (-scores[a], a))
        for a, b in permutations('ABC', 2):
            if all(r.index(a) < r.index(b) for r in profile):
                assert order.index(a) < order.index(b)  # Pareto
            signature = (a, b, tuple(r.index(a) < r.index(b) for r in profile))
            social = order.index(a) < order.index(b)
            if signature in signatures and signatures[signature] != social:
                iia_witness = True
            signatures[signature] = social
    assert iia_witness
    cycle = ('ABC', 'BCA', 'CAB')
    assert all(sum(r.index(a) < r.index(b) for r in cycle) == 2
               for a, b in (('A', 'B'), ('B', 'C'), ('C', 'A')))
    unanimous = ('ABC',) * 3
    assert all(sum(r.index(a) < r.index(b) for r in unanimous) == 3
               for a, b in (('A', 'B'), ('B', 'C'), ('A', 'C')))


def test_redundancy():
    q = F(1, 20)
    error = sum(F(comb(5, j)) * q ** j * (1-q) ** (5-j) for j in range(3, 6))
    assert error == F(9265, 8000000) == F('0.001158125')
    # Fully correlated votes inherit a common failure exactly, irrespective of n.
    assert q > error
    # Two perfectly correlated pipeline failures give yield .95, not .95 squared.
    assert 1 - q != (1-q) ** 2


def main():
    checks = [test_nucleus, test_hazards, test_concurrency,
              test_vcg_and_deterrence, test_aggregation, test_redundancy]
    for check in checks:
        check()
    print(json.dumps({'status': 'pass', 'checks': [c.__name__ for c in checks],
                      'scope': 'exact finite witnesses; not a general proof or runtime validation'}, indent=2))


if __name__ == '__main__':
    main()
