"""GARP and Afriat's critical cost efficiency index (CCEI).

Observation i is a price vector p_i and a chosen bundle x_i. Write
E[i][j] = p_i . x_j, so E[i][i] is what was spent at observation i.

For an efficiency level e in [0, 1] (Afriat 1972; Varian 1990; Choi, Fisman,
Gale and Kariv 2007):

  x_i R0_e x_j  iff  e * E[i][i] >= E[i][j]     (directly revealed preferred)
  x_i P0_e x_j  iff  e * E[i][i] >  E[i][j]     (strictly)
  R_e           =    transitive closure of R0_e
  GARP_e holds  iff  there is no pair with x_i R_e x_j and x_j P0_e x_i.

CCEI = sup { e : GARP_e holds }. GARP_e is monotone in e (both relations shrink
as e falls), so the supremum is found by bisection over e, each step checking
GARP_e with a transitive closure. `ccei_exact` searches the finite candidate
set {E[i][j] / E[i][i]} instead and is used to test the bisection.
"""
from __future__ import annotations

from typing import Sequence

REL_TOL = 1e-9  # relative tolerance on expenditure comparisons


def expenditure_matrix(prices: Sequence[Sequence[float]],
                       bundles: Sequence[Sequence[float]]) -> list[list[float]]:
    return [[sum(pk * xk for pk, xk in zip(p, x)) for x in bundles] for p in prices]


def _relations(E: list[list[float]], e: float) -> tuple[list[int], list[int]]:
    """Bitmask rows for R0_e and P0_e."""
    n = len(E)
    r0 = [0] * n
    p0 = [0] * n
    for i in range(n):
        own = e * E[i][i]
        tol = REL_TOL * max(E[i][i], 1.0)
        ri = 0
        pi = 0
        for j in range(n):
            if own >= E[i][j] - tol:
                ri |= 1 << j
            if own > E[i][j] + tol:
                pi |= 1 << j
        r0[i] = ri
        p0[i] = pi
    return r0, p0


def transitive_closure(rows: list[int]) -> list[int]:
    """Warshall's algorithm on bitmask rows: rows[i] has bit j iff i R j."""
    n = len(rows)
    closure = list(rows)
    for k in range(n):
        bit = 1 << k
        row_k = closure[k]
        for i in range(n):
            if closure[i] & bit:
                closure[i] |= row_k
    return closure


def garp_violations(E: list[list[float]], e: float = 1.0) -> list[tuple[int, int]]:
    """Pairs (i, j) with x_i R_e x_j and x_j P0_e x_i."""
    r0, p0 = _relations(E, e)
    closure = transitive_closure(r0)
    n = len(E)
    out = []
    for i in range(n):
        row = closure[i]
        for j in range(n):
            if i != j and (row >> j) & 1 and (p0[j] >> i) & 1:
                out.append((i, j))
    return out


def satisfies_garp(E: list[list[float]], e: float = 1.0) -> bool:
    r0, p0 = _relations(E, e)
    closure = transitive_closure(r0)
    n = len(E)
    for i in range(n):
        row = closure[i]
        if not row:
            continue
        for j in range(n):
            if i != j and (row >> j) & 1 and (p0[j] >> i) & 1:
                return False
    return True


def ccei(E: list[list[float]], tol: float = 1e-6) -> float:
    """Afriat's CCEI by bisection over e with a transitive-closure GARP check."""
    if not E:
        return 1.0
    if satisfies_garp(E, 1.0):
        return 1.0
    lo, hi = 0.0, 1.0  # GARP_lo holds, GARP_hi fails
    while hi - lo > tol:
        mid = (lo + hi) / 2
        if satisfies_garp(E, mid):
            lo = mid
        else:
            hi = mid
    return lo


def ccei_exact(E: list[list[float]]) -> float:
    """CCEI from the finite candidate set of expenditure ratios (test oracle).

    GARP_e can change only where e * E[i][i] crosses some E[i][j], so the set
    of failing e is [c, 1] or (c, 1] for a candidate ratio c, and CCEI = c.
    Locate the smallest failing candidate c_f and the candidate c_h below it;
    if GARP holds strictly between them the failing set is closed at c_f,
    otherwise it is open at c_h.
    """
    if not E or satisfies_garp(E, 1.0):
        return 1.0
    n = len(E)
    cands = sorted({E[i][j] / E[i][i] for i in range(n) for j in range(n)
                    if i != j and E[i][i] > 0 and E[i][j] / E[i][i] <= 1.0})
    cands = [0.0] + cands + [1.0]
    lo, hi = 0, len(cands) - 1  # GARP holds at cands[0] = 0, fails at 1.0
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if satisfies_garp(E, cands[mid]):
            lo = mid
        else:
            hi = mid
    c_h, c_f = cands[lo], cands[hi]
    return c_f if satisfies_garp(E, (c_h + c_f) / 2) else c_h
