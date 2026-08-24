#!/usr/bin/env python3
"""
A4 - Canary Detection Power and the SPRT Leak Test
===================================================
Two claims turn "we have canaries" into a quotable assurance level
(mega-volume thm:cleanroom claim 3, research-ledger item A4):

 (1) POWER. Plant c canaries (unique sentinel spans) uniformly in Derek's
     n-span corpus; the gate's suppressor misses a present canary with
     per-canary false-negative rate beta, independently. A leak carrying k
     canary spans is detected w.p. exactly 1 - beta^k (>= 1 - beta^k as a
     bound when suppression is no worse than independent). A leak of m spans
     carries K ~ Hypergeometric(n, c, m) canaries, so marginal power is
        P(detect | m) = 1 - E[beta^K]  ~=  1 - (1 - (c/n)(1-beta))^m,
     the OPERATING CURVE Pr(detect) = f(leak volume).
 (2) LATENCY. Sequentially, gate outputs form a Bernoulli stream: canary-hit
     rate p0 under the no-leak permutation null, p1 > p0 under exfiltration.
     Wald's SPRT with error targets (alpha, b) stops on average after
        E1[N] = [(1-b) ln((1-b)/alpha) + b ln(b/(1-alpha))] / KL(p1||p0)
     outputs when leaking (analogously E0[N] under the null) - the expected
     time-to-detection, optimal in the Wald-Wolfowitz sense.

This script verifies both against simulation (seed 20260816): exact
hypergeometric power vs Monte Carlo, the binomial approximation's error, the
Wald stopping-time formulas vs simulated SPRT runs (stating the overshoot
caveat: Wald's identities ignore boundary overshoot, so simulated E[N] runs a
little above the approximation and realized error rates below their targets),
the operating curve, and the latency sweep. The independence assumption is
then BROKEN deliberately (an adversary who obtains the canary list with
probability rho strips all of them): measured power falls below 1 - beta^k,
demonstrating that the bound's stated regime - uniform planting unknown to
the adversary - is load-bearing, not decorative.
"""
import numpy as np
from math import lgamma, log, exp

SEED = 20260816
rng = np.random.default_rng(SEED)

def lc(a, b):                      # log C(a,b)
    if b < 0 or b > a: return -np.inf
    return lgamma(a + 1) - lgamma(b + 1) - lgamma(a - b + 1)

# ---------------- (1) power ----------------
n, c, beta = 10000, 100, 0.2

def power_exact(m):
    tot = 0.0
    for k in range(0, min(c, m) + 1):
        lp = lc(c, k) + lc(n - c, m - k) - lc(n, m)
        if lp > -700:
            tot += exp(lp + k * log(beta))
    return 1.0 - tot

def power_binom(m):
    return 1.0 - (1.0 - (c / n) * (1 - beta)) ** m

print('=' * 72)
print('A4 - CANARY POWER + SPRT TIME-TO-DETECTION   (seed', SEED, ')')
print('=' * 72)
print(f'corpus n={n} spans, c={c} canaries (density {c/n:.2%}), per-canary FN beta={beta}')

print('\n=== (1) CONDITIONAL POWER: P(detect | k canaries in leak) = 1 - beta^k ===')
T = 40000
for k in [1, 2, 5]:
    det = (rng.random((T, k)) > beta).any(axis=1).mean()
    an = 1 - beta ** k
    se = np.sqrt(an * (1 - an) / T)
    assert abs(det - an) < 4 * se + 1e-9, (k, det, an)
    print(f'  k={k}:  analytic {an:.5f}   simulated {det:.5f}   [OK]')

print('\n=== (2) OPERATING CURVE: P(detect) = f(leak size m spans) ===')
print(f"  {'m':>6} {'exact (hypergeom)':>18} {'binomial approx':>16} {'simulated':>10}")
T = 20000
for m in [25, 50, 100, 200, 400, 800]:
    ks = rng.hypergeometric(c, n - c, m, size=T)
    det = np.array([(rng.random(k) > beta).any() if k > 0 else False for k in ks]).mean()
    ex, ap = power_exact(m), power_binom(m)
    se = np.sqrt(max(ex * (1 - ex), 1e-9) / T)
    assert abs(det - ex) < 5 * se + 2e-3, (m, det, ex)
    print(f'  {m:>6} {ex:>18.4f} {ap:>16.4f} {det:>10.4f}')
print('  reading: at this density a 100-span leak is caught 55% of the time,')
print('  an 800-span leak with near-certainty; the curve is the quotable object.')

# ---------------- (2) SPRT ----------------
p0, alpha, b = 0.001, 0.01, 0.05
lnA, lnB = log((1 - b) / alpha), log(b / (1 - alpha))

def wald_EN(p1):
    K1 = p1 * log(p1 / p0) + (1 - p1) * log((1 - p1) / (1 - p0))
    K0 = p0 * log(p1 / p0) + (1 - p0) * log((1 - p1) / (1 - p0))
    E1 = ((1 - b) * lnA + b * lnB) / K1
    E0 = (alpha * lnA + (1 - alpha) * lnB) / K0
    return E1, E0

def sprt_sim(p_true, p1, runs=20000, cap=200000):
    u, d = log(p1 / p0), log((1 - p1) / (1 - p0))
    Ns, hits = np.zeros(runs), np.zeros(runs, dtype=bool)
    for i in range(runs):
        llr, t = 0.0, 0
        while lnB < llr < lnA and t < cap:
            t += 1
            llr += u if rng.random() < p_true else d
        Ns[i], hits[i] = t, llr >= lnA
    return Ns.mean(), hits.mean()

print(f'\n=== (3) SPRT vs permutation null: p0={p0}, targets alpha={alpha}, miss b={b} ===')
p1 = 0.01
E1, E0 = wald_EN(p1)
simN1, det1 = sprt_sim(p1, p1)
simN0, fa0  = sprt_sim(p0, p1)
print(f'  under LEAK  (p1={p1}):  Wald E1[N] = {E1:7.1f}   simulated {simN1:7.1f}   detect rate {det1:.4f}')
print(f'  under NULL  (p0={p0}): Wald E0[N] = {E0:7.1f}   simulated {simN0:7.1f}   false alarm {fa0:.4f}')
assert 0.85 * E1 < simN1 < 1.6 * E1, (simN1, E1)
assert 0.85 * E0 < simN0 < 1.6 * E0, (simN0, E0)
assert 1 - det1 <= 2 * b and fa0 <= 2 * alpha
print( '  Wald identities confirmed to approximation accuracy; realized errors at or')
print(f'  below target (miss {1-det1:.4f} <= {b}, FA {fa0:.4f} <= {alpha}) - overshoot only helps.  [OK]')

print('\n=== (4) LATENCY SWEEP: expected gate outputs until detection ===')
print(f"  {'leak rate p1':>12} {'Wald E1[N]':>11} {'simulated':>10} {'detect':>7}")
for p1 in [0.002, 0.005, 0.01, 0.02, 0.05]:
    E1, _ = wald_EN(p1)
    simN, det = sprt_sim(p1, p1, runs=4000)
    assert 0.8 * E1 < simN < 1.7 * E1
    print(f'  {p1:>12} {E1:>11.1f} {simN:>10.1f} {det:>7.3f}')
print('  reading: a 10x leak intensity cuts time-to-detection ~30x; faint leaks')
print('  are caught too, just slowly - latency, not power, is what fades.')

print('\n=== (5) BOUNDARY: independence broken (adversary knows the canaries) ===')
rho, k = 0.3, 5
T = 40000
stripped = rng.random(T) < rho
det = np.where(stripped, False, (rng.random((T, k)) > beta).any(axis=1)).mean()
bound = 1 - beta ** k
assert det < bound - 0.1
print(f'  adversary obtains the canary list w.p. rho={rho} and strips all of them:')
print(f'  measured power {det:.4f} << 1 - beta^k = {bound:.4f}')
print( '  the 1-beta^k guarantee REQUIRES canaries indistinguishable to the')
print( '  exfiltrator (uniform, secret planting); correlated stripping voids it.')

print('''
READING. Detection power is now a purchasable, quotable quantity: 1 - beta^k
per k-canary leak (exact under independent suppression), the hypergeometric
operating curve Pr(detect) = f(leak size) for a planted density, and - via
Wald's SPRT against the permutation null - the expected number of gate
outputs before a leak of given intensity is called, with realized error
rates at or below their targets. This re-scopes the exfiltration bond to its
honest job (funding detection and response, not unbounded breach damage) and
gives thm:cleanroom claim 3 its executed backing. The stated regime is
load-bearing: secret uniform planting and per-canary independence - an
adversary who can identify canaries strips them and the guarantee voids, so
canary secrecy is part of the security boundary, priced here explicitly.''')
