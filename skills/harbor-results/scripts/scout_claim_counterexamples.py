#!/usr/bin/env python3
"""Exact falsifiers for three claims proposed by the November 6 literature scout.

These constructed examples refute overbroad interpretations. They are neither
agent measurements nor a novelty claim, and do not refute the cited primary
papers. Direct execution checks both counterexamples and bounded positive cases.
"""
from fractions import Fraction as Q
from itertools import permutations


def partitions(n, largest=None):
    if n == 0:
        yield ()
        return
    for first in range(min(n, n if largest is None else largest), 0, -1):
        for rest in partitions(n - first, first):
            yield (first,) + rest


def check_lineage():
    # One principal, original balance 2, two authenticated children. Each
    # source unit is debited once; discount loses 1/5 of the total balance.
    utility = lambda x: min(x, Q(1))
    initial, children = Q(2), (Q(9, 10), Q(9, 10))
    assert sum(children) <= initial
    assert sum(map(utility, children)) == Q(9, 5) > utility(initial) == 1
    assert utility(sum(children)) == utility(initial)  # principal aggregation
    # Positive scope: nondecreasing superadditive U with U(0)=0 suffices.
    # Finite integer partitions with discounted rational balances check two
    # representative utilities; the general argument is recorded in the note.
    cases = 0
    for n in range(1, 13):
        for parts in partitions(n):
            for discount in (Q(0), Q(1, 2), Q(9, 10), Q(1)):
                balances = [discount * x for x in parts]
                for f in (lambda x: x, lambda x: x*x):
                    assert sum(f(x) for x in balances) <= f(Q(n))
                    cases += 1
    return {'bounded_positive_cases': cases,
            'conserved_balance': str(sum(children)),
            'unsplit_payoff': str(utility(initial)),
            'split_payoff': str(sum(map(utility, children)))}


def check_digest():
    # Exact observation X in {0,1,2,3}; digest says which pair contains X.
    worlds = tuple(range(4))
    digest = lambda x: x // 2
    cells = [{x for x in worlds if digest(x) == d} for d in range(2)]
    assert all(len(cell) == 2 for cell in cells)
    assert all(x in cells[digest(x)] for x in worlds)  # zero-miss opening
    # Different 0-1 decision: guess X. A digest-based decision can choose one
    # representative per pair, so at most two of four uniform worlds succeed.
    best_correct = sum(max(sum(x == action for x in cell) for action in worlds)
                       for cell in cells)
    digest_risk = 1 - Q(best_correct, len(worlds))
    assert digest_risk == Q(1, 2)
    assert Q(0) < digest_risk  # full observation guesses X without error
    return {'worlds': 4, 'digest_cells': 2, 'zero_miss_opening_loss': '0',
            'full_guess_risk': '0', 'digest_guess_risk': str(digest_risk)}


def check_composition():
    # Two separately correct reservation procedures read one shared unit and
    # later grant a reservation. Each actor in isolation grants at most one.
    # Parallel interleaving can admit two because check-and-reserve is not atomic.
    events = ('a.read', 'a.grant', 'b.read', 'b.grant')
    examined, violating, witness = 0, 0, None
    for schedule in permutations(events):
        if any(schedule.index(a+'.read') > schedule.index(a+'.grant') for a in ('a', 'b')):
            continue
        free, reservations, saw = 1, [], {}
        for event in schedule:
            actor, action = event.split('.')
            if action == 'read':
                saw[actor] = free
            elif saw[actor] > 0:
                reservations.append(actor)
                free = saw[actor] - 1
        examined += 1
        if len(reservations) > 1:
            violating += 1
            witness = witness or schedule
    assert (examined, violating) == (6, 4)
    # Atomic reserve preserves the shared budget in either actor ordering.
    for order in permutations(('a', 'b')):
        free, reservations = 1, []
        for actor in order:
            if free > 0:
                free -= 1
                reservations.append(actor)
        assert len(reservations) <= 1 and free + len(reservations) == 1
    return {'schedules': examined, 'violating_schedules': violating,
            'witness': witness, 'atomic_orders_checked': 2}


if __name__ == '__main__':
    import json
    print(json.dumps({'D14': check_lineage(), 'D8': check_digest(),
                      'D29': check_composition()}, indent=2))
