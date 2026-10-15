#!/usr/bin/env python3
"""Independent finite witnesses for the Book's admission and attention claims."""
from itertools import combinations, product
from math import isclose

# The implementation and oracle use different representations. The machine tracks
# one pending operation; the oracle derives each effect from the event interval
# since the latest request, with revocation separating valid permits.
events = ('request-a', 'request-b', 'permit-a', 'permit-b', 'deny', 'commit')

def machine(trace, mutant=False):
    pending = None
    authorized = False
    effects = []
    for step, event in enumerate(trace):
        if event.startswith('request-'):
            pending = event[-1]
            authorized = False
        elif event.startswith('permit-') and pending == event[-1]:
            authorized = True
        elif event == 'deny':
            authorized = False
        elif event == 'commit' and pending is not None and (authorized or mutant):
            effects.append((step, pending))
            pending = None
            authorized = False
    return effects

def interval_oracle(trace):
    effects = []
    consumed = -1
    for step, event in enumerate(trace):
        if event != 'commit':
            continue
        requests = [i for i in range(consumed + 1, step)
                    if trace[i].startswith('request-')]
        if not requests:
            continue
        request = requests[-1]
        operation = trace[request][-1]
        revocations = [i for i in range(request + 1, step) if trace[i] == 'deny']
        start = revocations[-1] + 1 if revocations else request + 1
        if 'permit-' + operation in trace[start:step]:
            effects.append((step, operation))
            consumed = step
    return effects

traces = mutant_failures = 0
for trace in product(events, repeat=6):
    expected = interval_oracle(trace)
    assert machine(trace) == expected, trace
    mutant_failures += machine(trace, mutant=True) != expected
    traces += 1
assert traces == 46656 and mutant_failures > 0
assert machine(('request-a', 'permit-b', 'commit')) == []
assert machine(('request-a', 'permit-a', 'request-b', 'commit')) == []
assert machine(('request-a', 'permit-a', 'deny', 'commit')) == []
assert machine(('request-a', 'permit-a', 'commit')) == [(2, 'a')]

# Additive expected-loss allocation; independently enumerate every feasible set.
items=((100,.1,1,5),(12,.8,1,5),(4,.2,2,8))
def total_loss(selected):
    return sum(c+f*(1-a) if i in selected else m*a for i,(m,a,c,f) in enumerate(items))
benefits=[m*a-c-f*(1-a) for m,a,c,f in items]
assert isclose(benefits[0],4.5) and isclose(benefits[1],7.6)
for k in range(len(items)+1):
    choices=[set(c) for n in range(k+1) for c in combinations(range(len(items)),n)]
    selected=set(sorted((i for i,b in enumerate(benefits) if b>0),key=lambda i:benefits[i],reverse=True)[:k])
    assert isclose(total_loss(selected),min(map(total_loss,choices)))
raw_risk_choice=max(range(len(items)),key=lambda i:items[i][0]*items[i][1])
assert raw_risk_choice==0 and total_loss({0})>total_loss({1})
# Unequal indivisible inspection times invalidate ratio-greedy allocation.
# Compare the greedy choice with every feasible subset under the time budget.
timed_items = ((3, 2), (4, 3))  # (net benefit, seconds)
budget = 3
greedy = set()
remaining = budget
for i in sorted(range(len(timed_items)),
                key=lambda i: timed_items[i][0] / timed_items[i][1], reverse=True):
    if timed_items[i][1] <= remaining:
        greedy.add(i)
        remaining -= timed_items[i][1]
feasible = [set(indices) for n in range(len(timed_items) + 1)
            for indices in combinations(range(len(timed_items)), n)
            if sum(timed_items[i][1] for i in indices) <= budget]
value = lambda selected: sum(timed_items[i][0] for i in selected)
assert greedy == {0} and value(greedy) == 3
assert max(map(value, feasible)) == 4
assert value({1}) > value(greedy)
print(f'PASS: {traces} admission traces vs interval oracle; {mutant_failures} premature-admission mutant failures; exact subset allocation for k=0..3, raw-risk counterexample, and unequal-time ratio-greedy counterexample (3 < 4).')
