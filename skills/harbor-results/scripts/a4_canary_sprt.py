#!/usr/bin/env python3
"""
A4 - Canary Detection Power and the SPRT Leak Test
===================================================
Two conditional models connect canary placement to detection and stopping
(mega-volume thm:cleanroom claim 3, research-ledger item A4):

 (1) POWER. Plant c canaries (unique sentinel spans) uniformly in Derek's
     n-span corpus; the gate's suppressor misses a present canary with
     per-canary false-negative rate beta, independently. A leak carrying k
     canary spans is detected w.p. exactly 1 - beta^k. A leak of m spans,
     selected independently of the hidden canary locations,
     carries K ~ Hypergeometric(n, c, m) canaries, so marginal power is
        P(detect | m) = 1 - E[beta^K]  ~=  1 - (1 - (c/n)(1-beta))^m,
     the OPERATING CURVE Pr(detect) = f(leak volume).
 (2) LATENCY. Assume i.i.d. Bernoulli outputs under fixed simple hypotheses:
     rate p0 under the no-leak null, p1 > p0 under exfiltration.
     The nominal targets (alpha, b) give a no-overshoot approximation
        E1[N] ~= [(1-b) ln((1-b)/alpha) + b ln(b/(1-alpha))] / KL(p1||p0)
     to outputs until either stopping decision (analogously E0[N]). Wald's
     identity uses the actual terminal log-likelihood; it does not ignore
     overshoot. SPRT optimality compares tests at their attained errors,
     not automatically at these nominal targets.

This script compares both with simulation (seed 20260816): exact
hypergeometric power vs Monte Carlo, the binomial approximation's error, the
approximate stopping-time formulas vs simulated SPRT runs, the operating
curve, and the latency sweep. The approximate thresholds do not separately
guarantee the nominal error targets. Assertions below allow twice each target;
sample proportions without uncertainty bounds cannot certify error control.
The finite simulation cap is not counted separately: unresolved capped runs
join the non-upper decisions and enter the reported capped means. The
hidden-planting premise is then BROKEN deliberately (an adversary who obtains
the canary list with probability rho strips all of them). Power falls below
the unstripped k-canary benchmark; this does not refute conditional 1-beta^k
power for the canaries actually carried with independent misses.
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
print('A4 - CANARY POWER + SPRT OUTPUTS TO STOPPING DECISION   (seed', SEED, ')')
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
print('  an 800-span leak with high probability under this conditional model.')

# ---------------- (2) SPRT ----------------
p0, alpha, b = 0.001, 0.01, 0.05
lnA, lnB = log((1 - b) / alpha), log(b / (1 - alpha))

# Nominal-error/no-overshoot approximation, not an exact stopping expectation.
def wald_EN(p1):
    K1 = p1 * log(p1 / p0) + (1 - p1) * log((1 - p1) / (1 - p0))
    K0 = p0 * log(p1 / p0) + (1 - p0) * log((1 - p1) / (1 - p0))
    E1 = ((1 - b) * lnA + b * lnB) / K1
    E0 = (alpha * lnA + (1 - alpha) * lnB) / K0
    return E1, E0

# A cap hit is currently mixed with non-upper decisions, not recorded separately.
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

print(f'\n=== (3) SPRT vs fixed Bernoulli null: p0={p0}, targets alpha={alpha}, miss b={b} ===')
p1 = 0.01
E1, E0 = wald_EN(p1)
simN1, det1 = sprt_sim(p1, p1)
simN0, fa0  = sprt_sim(p0, p1)
print(f'  under LEAK  (p1={p1}):  Wald approx {E1:7.1f}   capped mean {simN1:7.1f}   upper-decision fraction {det1:.4f}')
print(f'  under NULL  (p0={p0}): Wald approx {E0:7.1f}   capped mean {simN0:7.1f}   false-alarm fraction {fa0:.4f}')
assert 0.85 * E1 < simN1 < 1.6 * E1, (simN1, E1)
assert 0.85 * E0 < simN0 < 1.6 * E0, (simN0, E0)
assert 1 - det1 <= 2 * b and fa0 <= 2 * alpha
print( '  Broad approximation checks passed; error assertions allow twice nominal targets.')
print(f'  non-upper fraction {1-det1:.4f} (miss target {b}); FA {fa0:.4f} (target {alpha}). No uncertainty bounds or separate cap counts.  [CHECKS PASSED]')

print('\n=== (4) LATENCY SWEEP: approximate and capped mean outputs to either decision ===')
print(f"  {'leak rate p1':>12} {'Wald E1[N]':>11} {'simulated':>10} {'detect':>7}")
for p1 in [0.002, 0.005, 0.01, 0.02, 0.05]:
    E1, _ = wald_EN(p1)
    simN, det = sprt_sim(p1, p1, runs=4000)
    assert 0.8 * E1 < simN < 1.7 * E1
    print(f'  {p1:>12} {E1:>11.1f} {simN:>10.1f} {det:>7.3f}')
print('  reading: compare stopping counts only within the stated simple hypotheses;')
print('  detection fractions and capped means do not certify deployment performance.')

print('\n=== (5) BOUNDARY: independence broken (adversary knows the canaries) ===')
rho, k = 0.3, 5
T = 40000
stripped = rng.random(T) < rho
det = np.where(stripped, False, (rng.random((T, k)) > beta).any(axis=1)).mean()
bound = 1 - beta ** k
assert det < bound - 0.1
print(f'  adversary obtains the canary list w.p. rho={rho} and strips all of them:')
print(f'  measured power {det:.4f} << 1 - beta^k = {bound:.4f}')
print( '  Conditional 1-beta^k applies to canaries actually carried with independent misses.')
print( '  Secret planting and independent leak selection underpin the hypergeometric model; stripping changes that selection.')

print('''
READING. Conditional power is 1 - beta^k under independent suppression.
The hypergeometric operating curve additionally needs uniform hidden planting
and leak selection independent of canary locations. The sequential model
compares nominal-target approximations with capped simulation means and
sample decision fractions. It does not certify the two nominal error rates,
uncensored stopping expectations, or a deployed detector. Calibrate the
model, report cap counts and uncertainty, and validate deployment assumptions
before using these quantities to price detection and response. An adversary
who identifies and strips the canaries invalidates the stated power model.''')
