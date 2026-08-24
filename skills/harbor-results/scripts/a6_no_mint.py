#!/usr/bin/env python3
"""
A6 - The No-Mint Theorem for Reputation Inheritance
====================================================
Forked/distilled agents and skills inherit their ancestor's evidence as a
DISCOUNTED PRIOR. The safety requirement (research-ledger item A6, closing
the skill-versioning cold-start gap): no sequence of forks, distillations,
merges, or re-derivations may MINT reputation - one witnessed outcome must
never back more aggregate creditable weight than it earned, else a single
episode multiplies into a quorum.

SWEEP FIRST (falsification-first obligation 1). The portfolio's literal
phrasing - per-outcome budgets sum(w) <= 1, inherited prior iota(a) =
gamma * w * value(source), claim "sum of iota over the DAG's CLOSURE <=
witnessed total" - is attacked before proving. It is FALSE AS STATED for
chains when gamma > 1/2: e -> a -> b -> ... at full weight gives
sum_d gamma^d = gamma/(1-gamma) > 1. The budget alone does not conserve;
what conserves is TRANSFER semantics, and the sweep is what forces it into
the open (wrong turn reported, per protocol 5).

THE RESTATEMENT (discount-and-split as transfer). A derivation from sources
S with per-source grant fractions w_p in [0,1], discount gamma in (0,1]:
    the child receives  sum_p gamma * w_p * spendable(p)
    each source p is DEBITED  w_p * spendable(p)        (split = transfer)
Lifetime per-outcome budgets then hold for free (repeated derivations
compound multiplicatively on what REMAINS).

NO-MINT INVARIANT: total concurrently-live spendable reputation across all
nodes never exceeds total witnessed value, and is nonincreasing except when
new outcomes are witnessed (a supermartingale under derivation). This is the
quorum-relevant quantity: what can vote at once. Proof by potential function
in Execution Report #4; here it is swept over randomized fork DAGs (chains,
diamonds, multi-parent merges, re-derivations), then the checker is
MUTATION-TESTED: a copy-full-reputation mutant (children inherit undebited)
must be caught as a detectable mint with quorum multiplication.
"""
import numpy as np

SEED = 20260816
rng = np.random.default_rng(SEED)
MUT = dict(copy_full=False)

# ---------------- the machine ----------------
class Ledger:
    def __init__(self):
        self.spend = []        # spendable value per node
        self.witnessed = 0.0
    def witness(self, q):
        self.spend.append(q)
        self.witnessed += q
        return len(self.spend) - 1
    def derive(self, parents, weights, gamma):
        """One derivation with one or more parents; weights[p] in [0,1] is the
        fraction of p's CURRENT spendable granted to the child."""
        got = 0.0
        for p, w in zip(parents, weights):
            got += gamma * w * self.spend[p]
            if not MUT['copy_full']:
                self.spend[p] -= w * self.spend[p]      # split = transfer
        self.spend.append(got)
        return len(self.spend) - 1
    def total(self):
        return sum(self.spend)

print('=' * 72)
print('A6 - NO-MINT REPUTATION INHERITANCE   (seed', SEED, ')')
print('=' * 72)

# ---------------- (1) sweep-first: the closure-sum phrasing ----------------
print('\n=== (1) SWEEP FIRST: attack the literal closure-sum claim ===')
gamma, q, D = 0.9, 1.0, 3
iotas, val = [], q
for d in range(D):
    val = gamma * val          # full-weight re-derivation chain, budget-legal
    iotas.append(val)
closure = sum(iotas)
print(f'  chain e -> a1 -> a2 -> a3, gamma={gamma}, each hop full budget w=1:')
print(f'  sum of inherited priors over the closure = ' +
      ' + '.join(f'{v:.3f}' for v in iotas) + f' = {closure:.3f} > q = {q}')
assert closure > q
print( '  COUNTEREXAMPLE: per-outcome budgets alone do not conserve the closure')
print( '  sum for gamma > 1/2. The claim must be restated over LIVE spendable')
print( '  value with transfer semantics (wrong turn reported; restatement below).')

# ---------------- (2) the restated invariant, swept ----------------
print('\n=== (2) RANDOMIZED SWEEP of the restated invariant (transfer semantics) ===')
TRIALS, MAXOPS = 4000, 14
worst = 0.0
for _ in range(TRIALS):
    L = Ledger()
    L.witness(float(rng.uniform(0.5, 2.0)))
    for _ in range(int(rng.integers(3, MAXOPS))):
        if rng.random() < 0.25:
            L.witness(float(rng.uniform(0.2, 2.0)))
            continue
        before = L.total()
        npar = int(rng.integers(1, min(3, len(L.spend)) + 1))
        parents = rng.choice(len(L.spend), size=npar, replace=False)
        weights = rng.uniform(0, 1, npar)   # independent per-parent grant fractions
        g = float(rng.uniform(0.5, 1.0))
        L.derive(list(parents), list(weights), g)
        assert min(L.spend) >= -1e-12, 'negative spendable'
        assert L.total() <= before + 1e-9, 'supermartingale violated'
        assert L.total() <= L.witnessed + 1e-9, 'NO-MINT violated'
        worst = max(worst, L.total() / L.witnessed)
print(f'  {TRIALS} random DAGs (chains, diamonds, multi-parent merges,')
print(f'  re-derivations), independent per-parent w in [0,1], gamma in [0.5,1]:')
print(f'  0 violations; max live/witnessed ratio observed = {worst:.6f}  [OK]')

# ---------------- (3) mutation: copy-full-reputation ----------------
print('\n=== (3) MUTATION: copy-full-reputation (no debit) must mint ===')
MUT['copy_full'] = True
L = Ledger()
e = L.witness(1.0)
L.derive([e], [1.0], 0.9); L.derive([e], [1.0], 0.9)
minted = L.total()
assert minted > L.witnessed, 'mutant NOT caught'
print(f'  shortest crime (2 ops): witness(q=1) -> fork twice at gamma=0.9:')
print(f'  live total = 1 + 0.9 + 0.9 = {minted:.2f} > witnessed = 1.0   CAUGHT')
Lq = Ledger()
e = Lq.witness(1.0)
for _ in range(8):
    Lq.derive([e], [1.0], 0.9)
factor = Lq.total() / Lq.witnessed
print(f'  quorum multiplication: an 8-way copy-fork of one outcome yields')
print(f"  {factor:.1f}x its witnessed value - one episode now backs {factor:.1f} votes' worth")
print(f'  of reputation; any reputation-weighted quorum with threshold < {factor:.1f}q')
print(f'  is crossable from a single witnessed outcome.')
assert factor > 5
MUT['copy_full'] = False
L = Ledger(); e = L.witness(1.0)
L.derive([e], [0.5], 0.9); L.derive([e], [1.0], 0.9)
assert L.total() <= L.witnessed + 1e-12
print(f'  mutation reverted: same fork pattern under transfer semantics gives')
print(f'  live total {L.total():.3f} <= 1.0 - conservation restored  [OK]')

print('''
READING. The no-mint invariant holds exactly when "split" means TRANSFER:
each derivation debits its source, so a child's discounted prior is paid
for, not photocopied - and then no sequence of forks, merges, chains, or
re-derivation cycles can push total live creditable reputation above total
witnessed value (supermartingale; swept, 0 violations). The sweep earned its
keep twice: it refuted the closure-sum phrasing (gamma > 1/2 chains mint
under budgets-without-debit), forcing the correct statement into the open,
and the copy-full mutant shows exactly what the invariant prevents - an
8.2x quorum multiplication from a single episode. Boundaries: the theorem
conserves the INHERITED PRIOR only (descendants may earn new witnessed value
- that is the point); gamma and the weights are policy choices the theorem
constrains but does not pick; and Sybil-resistance of the witnessed leaves
themselves is the identity layer's job (R7 prices the auditing), not this
theorem's.''')
