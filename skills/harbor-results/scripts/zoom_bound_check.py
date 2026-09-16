#!/usr/bin/env python3
"""Numeric check of the zoom-advantage theorem for Paper 1.

Theorem (halving zoom bound): adaptive halving group-splitting identifies all
k positives among F flagged items in at most

    Q(F,k) <= 2*k*ceil(log2(F/k)) + 4*k   group queries   (and always <= 2F-1),

versus F flat opens. Proof: charging argument (see paper). This script:
  (1) re-implements the exact halving algorithm from b1_frontier.py;
  (2) checks the bound on the measured b1 point (F=2500, k=10) and against the
      compendium numbers (measured 15.3x advantage => ~163 opens; ideal
      k*log2(F/k) = 79.7);
  (3) sweeps random and adversarial (evenly-spread) placements over many (F,k)
      and asserts the bound is never violated;
  (4) reports the empirical constant vs the ideal k*log2(F/k) (the ~2x
      practical overhead the paper quotes).
Seed 20260816 (house convention).
"""
import numpy as np
from math import log2, ceil

rng = np.random.default_rng(20260816)


def adaptive_group_queries(load_set, flagged):
    """Identical algorithm to skills/harbor-results/scripts/b1_frontier.py."""
    flagged = sorted(flagged)
    opens = 0
    stack = [flagged]
    while stack:
        grp = stack.pop()
        opens += 1
        if not any(i in load_set for i in grp):
            continue
        if len(grp) == 1:
            continue
        mid = len(grp) // 2
        stack.append(grp[:mid])
        stack.append(grp[mid:])
    return opens


def bound(F, k):
    if k == 0:
        return 1
    return 2 * k * ceil(log2(max(F / k, 1.0))) + 4 * k


def check(F, k, load, tag):
    flagged = list(range(F))
    q = adaptive_group_queries(set(load), flagged)
    b = bound(F, k)
    ok = q <= b and q <= 2 * F - 1
    print(f"  {tag:24s} F={F:6d} k={k:3d}  queries={q:5d}  bound={b:5d}  "
          f"ideal k*log2(F/k)={k*log2(F/k):7.1f}  {'OK' if ok else 'VIOLATION'}")
    assert ok, f"BOUND VIOLATED at F={F}, k={k}, tag={tag}: {q} > {b}"
    return q


print("(1) The measured b1_frontier.py point: F=2500, k=10")
F, k = 2500, 10
qs = []
for _ in range(150):
    load = rng.choice(F, size=k, replace=False)
    qs.append(adaptive_group_queries(set(load.tolist()), list(range(F))))
mean_q = float(np.mean(qs))
ideal = k * log2(F / k)
print(f"  mean adaptive queries      = {mean_q:.1f}   (compendium: ~163-164, 15.3x vs flat)")
print(f"  flat opens                 = {F}")
print(f"  measured advantage         = {F/mean_q:.1f}x   (compendium: 15.3x)")
print(f"  ideal k*log2(F/k)          = {ideal:.1f}  (compendium: 79.7)")
print(f"  theorem bound 2k*ceil(log2(F/k))+4k = {bound(F,k)}")
print(f"  max observed queries       = {max(qs)}")
assert bound(F, k) >= max(qs), "bound must dominate every observed run"
assert bound(F, k) >= 2 * ideal, "bound must be >= 2*ideal + O(k) sanity"
assert abs(F / mean_q - 15.3) < 1.0, "should reproduce the measured ~15.3x"
print(f"  empirical overhead vs ideal = {mean_q/ideal:.2f}x  (paper quotes ~2x)")

print("\n(2) Sweep: random placements")
for F in [16, 100, 250, 1000, 1500, 2500, 5000]:
    for k in [1, 2, 5, 10, 20, 50]:
        if k > F:
            continue
        worst = 0
        for _ in range(60):
            load = rng.choice(F, size=k, replace=False).tolist()
            q = adaptive_group_queries(set(load), list(range(F)))
            worst = max(worst, q)
        b = bound(F, k)
        assert worst <= b, f"VIOLATION F={F} k={k}: {worst} > {b}"
print("  all random placements within bound: OK")

print("\n(3) Adversarial placements (worst cases for the tree)")
for F in [64, 250, 1000, 2500, 4096]:
    for k in [1, 2, 8, 10, 32]:
        if k > F:
            continue
        # evenly spread positives -> maximally many positive subtrees
        spread = [int(i * F / k) for i in range(k)]
        check(F, k, spread, "evenly-spread")
        # clustered positives -> deep shared path then fan-out
        cluster = list(range(k))
        check(F, k, cluster, "clustered")

print("\n(4) Dense-flag boundary (lesson #3): k close to F -> zoom loses")
for F, k in [(100, 60), (100, 90)]:
    flagged = list(range(F))
    load = rng.choice(F, size=k, replace=False).tolist()
    q = adaptive_group_queries(set(load), flagged)
    print(f"  F={F} k={k}: adaptive={q} vs flat={F}  "
          f"({'zoom LOSES' if q > F else 'zoom wins'}; bound still holds: {q} <= {min(bound(F,k), 2*F-1)})")
    assert q <= 2 * F - 1

print("\n(5) Tightness of the leading constant: F=4096, k=32 evenly spread")
F, k = 4096, 32
spread = [int(i * F / k) for i in range(k)]
q = adaptive_group_queries(set(spread), list(range(F)))
exact = 2 * k * int(log2(F / k)) + 2 * k - 1
print(f"  queries = {q}, predicted 2k*log2(F/k)+2k-1 = {exact}")
assert q == exact, "tightness configuration must land exactly on 2k*log2(F/k)+2k-1"

print("\nALL CHECKS PASS: Q <= 2k*ceil(log2(F/k)) + 4k on every tested instance;")
print(f"bound ({bound(2500,10)} at F=2500,k=10) dominates the measured ~163 opens; overhead ~2x ideal.")
