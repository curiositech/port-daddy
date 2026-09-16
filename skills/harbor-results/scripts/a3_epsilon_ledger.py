#!/usr/bin/env python3
"""
A3 - Epsilon-Conservation for the Clean-Room Release Ledger
============================================================
The clean room's privacy budget is a LEDGER: state = (cumulative spend sigma,
append-only log Lambda of (eps_i, artifact-hash, policy-hash)). The only
spending transition is release(eps_i), which ATOMICALLY appends the record and
adds eps_i to sigma; the gate refuses when sigma + eps_i > eps_max. Claimed
invariants (mega-volume thm:cleanroom claim 2, research-ledger item A3):

  I1 (conservation) : sigma = sum over Lambda of eps_i, always
  I2 (budget, state): sigma <= eps_max, always
  I2'(budget, log)  : sum over Lambda of eps_i <= eps_max, always
                      (the AUDITABLE form: the log is what an auditor reads)

Concurrency is the interesting case: multiple clients race release() calls.
The kernel serializes commits through a single writer, so each release is one
atomic guard+append+add. This script verifies the invariants EXHAUSTIVELY over
every interleaving of concurrent clients' requests (explicit-state BFS), then
runs a randomized deep sweep (seed 20260816), then MUTATION-TESTS the checker:
 (m1) gate-bypass spend-without-append: sigma += eps with no log record;
 (m2) non-atomic append-different-amount: the two halves of the "atomic" step
      disagree (log records eps, sigma += eps-1) - a torn write.
Both must be caught with shortest counterexample traces (BFS = shortest).

DP semantics of the summed eps (imported, [verified] formulas):
  sequential composition: k mechanisms at eps each compose to k*eps
  advanced composition (Dwork-Rothblum-Vadhan FOCS 2010), for any delta' > 0:
      eps' = sqrt(2 k ln(1/delta')) * eps + k * eps * (e^eps - 1)
So sigma <= eps_max certifies (eps_max, 0)-DP by sequential composition, or the
tighter (eps', k*delta + delta')-DP bound when k is large; the script prints
the crossover where advanced accounting starts paying.

Honest caveat, stated up front: conservation governs RECORDED spend. That all
spend is recorded is exactly the complete-mediation assumption - B3/R5's
hypervisor result is the prerequisite, not a nicety.
"""
from collections import deque
import numpy as np

SEED = 20260816

# ---------------- the model ----------------
EPS_MAX = 4
PROGS   = ((2, 2), (1, 2))          # two concurrent clients' intended releases
MUT = dict(spend_no_append=False, append_mismatch=False)

def h(tag, i):                       # deterministic stand-in hashes
    return f"h({tag}{i})"

def transitions(st):
    """Each enabled step = one client's next release() reaching the single
    writer. Guard+append+add is ONE transition (the atomicity the kernel
    provides); interleaving freedom is WHICH client commits next."""
    sigma, lam, pcs = st
    out = []
    for i, prog in enumerate(PROGS):
        pc = pcs[i]
        if pc >= len(prog):
            continue
        eps = prog[pc]
        pcs2 = pcs[:i] + (pc + 1,) + pcs[i+1:]
        if MUT['spend_no_append']:
            if sigma + eps <= EPS_MAX:
                out.append((f"c{i}.release({eps}) [NO APPEND]",
                            (sigma + eps, lam, pcs2)))
            else:
                out.append((f"c{i}.release({eps}) -> DENIED", (sigma, lam, pcs2)))
        elif MUT['append_mismatch']:
            if sigma + eps <= EPS_MAX:   # gate checks sigma, which undercounts
                out.append((f"c{i}.release({eps}) [TORN: log {eps}, sigma +{eps-1}]",
                            (sigma + eps - 1,
                             lam + ((eps, h('a', len(lam)), h('p', len(lam))),),
                             pcs2)))
            else:
                out.append((f"c{i}.release({eps}) -> DENIED", (sigma, lam, pcs2)))
        else:                            # honest atomic release
            if sigma + eps <= EPS_MAX:
                out.append((f"c{i}.release({eps})",
                            (sigma + eps,
                             lam + ((eps, h('a', len(lam)), h('p', len(lam))),),
                             pcs2)))
            else:
                out.append((f"c{i}.release({eps}) -> DENIED", (sigma, lam, pcs2)))
    return out

INVS = {
    'I1 conservation (sigma = sum Lambda)': lambda s: s[0] == sum(r[0] for r in s[1]),
    'I2 budget on state (sigma <= eps_max)': lambda s: s[0] <= EPS_MAX,
    "I2' budget on log (sum Lambda <= eps_max)": lambda s: sum(r[0] for r in s[1]) <= EPS_MAX,
}

def bfs():
    """Exhaustive BFS over ALL interleavings; returns (#states, first violation
    per invariant with its shortest trace)."""
    init = (0, (), (0,) * len(PROGS))
    parent = {init: None}
    dq = deque([init])
    viol = {}
    while dq:
        st = dq.popleft()
        for name, inv in INVS.items():
            if name not in viol and not inv(st):
                viol[name] = st
        for act, st2 in transitions(st):
            if st2 not in parent:
                parent[st2] = (st, act)
                dq.append(st2)
    def trace(st):
        acts = []
        while parent[st] is not None:
            st, act = parent[st]
            acts.append(act)
        return list(reversed(acts))
    return len(parent), {n: (s, trace(s)) for n, s in viol.items()}

print('=' * 72)
print('A3 - EPSILON-CONSERVATION OF THE RELEASE LEDGER')
print('=' * 72)
print(f'model: eps_max={EPS_MAX}, concurrent clients with programs {PROGS},')
print( '       every release atomic through the single writer; ALL interleavings.')

n, viol = bfs()
print(f'\n=== (1) EXHAUSTIVE INTERLEAVING CHECK (honest ledger) ===')
print(f'  reachable states: {n}')
assert not viol, f"invariant violated in honest model: {viol}"
print(f'  I1, I2, I2\' hold in every reachable state under every interleaving  [OK]')

# randomized deep sweep beyond the exhaustive instance
rng = np.random.default_rng(SEED)
TRIALS = 2000
for _ in range(TRIALS):
    progs = tuple(tuple(int(rng.integers(1, 4)) for _ in range(int(rng.integers(1, 5))))
                  for _ in range(3))
    emax = int(rng.integers(3, 9))
    sigma, lam, pcs = 0, [], [0] * len(progs)
    while any(pcs[i] < len(progs[i]) for i in range(len(progs))):
        live = [i for i in range(len(progs)) if pcs[i] < len(progs[i])]
        i = int(rng.choice(live))
        eps = progs[i][pcs[i]]
        if sigma + eps <= emax:
            sigma += eps
            lam.append(eps)
        pcs[i] += 1
        assert sigma == sum(lam) and sigma <= emax and sum(lam) <= emax
print(f'\n=== (2) RANDOMIZED SWEEP (seed {SEED}) ===')
print(f'  {TRIALS} random (programs, eps_max, interleaving) instances: 0 violations  [OK]')

print('\n=== (3) MUTATION SUITE ===')
MUT['spend_no_append'] = True
n1, viol1 = bfs()
MUT['spend_no_append'] = False
assert 'I1 conservation (sigma = sum Lambda)' in viol1, "m1 NOT caught"
st, tr = viol1['I1 conservation (sigma = sum Lambda)']
print(f'  [m1 gate-bypass: spend without append]  caught: I1 in {len(tr)} step(s)')
print(f'      shortest crime: ' + ' -> '.join(tr) + f'  => sigma={st[0]}, sum(Lambda)={sum(r[0] for r in st[1])}')

MUT['append_mismatch'] = True
n2, viol2 = bfs()
MUT['append_mismatch'] = False
assert 'I1 conservation (sigma = sum Lambda)' in viol2, "m2 NOT caught (I1)"
st, tr = viol2['I1 conservation (sigma = sum Lambda)']
print(f'  [m2 torn write: append eps, add eps-1]  caught: I1 in {len(tr)} step(s)')
print(f'      shortest crime: ' + ' -> '.join(tr) + f'  => sigma={st[0]}, sum(Lambda)={sum(r[0] for r in st[1])}')
key2 = "I2' budget on log (sum Lambda <= eps_max)"
assert key2 in viol2, "m2 NOT caught (I2' budget breach)"
st, tr = viol2[key2]
print(f'      and the CONTRACT crime: the undercounting sigma lets the gate admit')
print(f'      recorded spend past the budget - I2\' breached in {len(tr)} steps:')
print(f'      ' + ' -> '.join(tr))
print(f'      => sum(Lambda) = {sum(r[0] for r in st[1])} > eps_max = {EPS_MAX}  (auditable over-spend)')

nr, violr = bfs()
assert not violr and nr == n
print(f'  mutations reverted: all invariants restored, {nr} states  [OK]')

print('\n=== (4) DP COMPOSITION: what the conserved sum MEANS ===')
dp = 1e-6   # delta'
print(f"  {'k':>5} {'eps':>6} {'basic k*eps':>12} {'advanced (DRV FOCS 2010)':>25}")
rows = [(8, 0.5), (32, 0.1), (128, 0.05)]
vals = {}
for k, e in rows:
    adv = np.sqrt(2 * k * np.log(1 / dp)) * e + k * e * (np.expm1(e))
    vals[(k, e)] = (k * e, adv)
    print(f"  {k:>5} {e:>6.2f} {k*e:>12.2f} {adv:>25.2f}")
assert vals[(8, 0.5)][1] > vals[(8, 0.5)][0],   "advanced should NOT pay at small k"
assert vals[(128, 0.05)][1] < vals[(128, 0.05)][0], "advanced should pay at large k"
print('  reading: below the crossover, quote sigma <= eps_max via sequential')
print('  composition (exact, delta-free); for long engagements (k large), the')
print('  same conserved ledger certifies the sqrt(k)-scaled advanced bound.')

print('''
READING. The ledger conserves: in every reachable state under every
interleaving of concurrent releases, sigma equals the log's sum and never
exceeds eps_max - proved exhaustively on the small model and by induction in
general (Execution Report #4), with the concurrent case reduced to the
sequential one by the kernel's single-writer serialization. Both canonical
breaks of atomicity are caught with shortest traces, and the torn write's
deeper crime is exhibited: an undercounting sigma silently admits recorded
spend past the budget, so the ATOMIC pairing of append and add is what makes
the budget promise auditable. What the conserved sum buys is DP composition:
sequential composition makes sigma <= eps_max an (eps_max, 0)-DP certificate;
advanced composition tightens it for long engagements. Conservation governs
RECORDED spend only - complete mediation (every release passes the gate) is
B3/R5's controllability result, the stated prerequisite.''')
