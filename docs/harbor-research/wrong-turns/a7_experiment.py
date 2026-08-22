"""
A7 — The Information-Floor Falsification Experiment
====================================================
Theorem I.6.1 (covering bound): to guarantee ZERO MISS of a hidden load-bearing
set of size k among N artifacts while the operator opens at most m items, a digest
must carry at least

    B* = log2 C(N,k) - log2 C(m,k)   bits.

Equivalently, a digest of B bits can flag at most 2^B distinct m-subsets; each
covers C(m,k) of the C(N,k) possible placements; so the best achievable
zero-miss probability for a B-bit digest under a uniform prior over placements is

    P(catch all k) = min(1, 2^B * C(m,k) / C(N,k)),
    P(miss >= 1)   = max(0, 1 - 2^B * C(m,k) / C(N,k)).

This gives a SHARP, FALSIFIABLE frontier. The experiment:
  Panel 1 — plot the optimal frontier; simulate real digest schemes (greedy
            cover, noisy learned scorer, random) and show every empirical curve
            sits ON or ABOVE the frontier. If any scheme beats it, the
            load-bearing formalization is wrong. That is the falsification test.
  Panel 2 — adversary corrupts a fraction phi of features so load-bearing and
            inert items become indistinguishable; show the effective floor
            inflates (mimicry attack, Solution 6.5*).
  Panel 3 — split-digest (A1): two readers with different load-bearing sets.
            A joint B-bit digest must cover BOTH; show the joint miss rate for
            disjoint vs overlapping reader sets — disjoint forces the SUM of floors.
"""

import numpy as np
from math import lgamma, log2, exp
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

rng = np.random.default_rng(20260816)

# ---------- exact log-space binomials (stable at large N) ----------
def log_choose(n, k):
    if k < 0 or k > n:
        return -np.inf
    return (lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1)) / np.log(2)  # log2 C(n,k)

def floor_bits(N, k, m):
    """Information floor B* = log2 C(N,k) - log2 C(m,k)."""
    return log_choose(N, k) - log_choose(m, k)

def optimal_miss(B, N, k, m):
    """Best achievable P(miss>=1) for a B-bit digest opening m items."""
    log_cov = B + log_choose(m, k) - log_choose(N, k)   # log2 of coverage fraction
    frac = 2.0 ** min(log_cov, 0.0)
    return max(0.0, 1.0 - frac)

# ---------- realistic digest schemes ----------
def simulate_scheme(scheme, N, k, m, B, trials=4000, phi=0.0):
    """
    Returns empirical P(miss>=1). A scheme sees per-item features and must, using
    only B bits of output, induce the operator to open an m-subset. We model the
    B-bit budget as: the scheme can perfectly rank-and-flag only if it can address
    the required subsets. Concretely we implement the schemes at the level of
    'which m items get opened', then the B-bit budget caps how much true-set
    information the flag can encode by quantizing the scheme's score to B bits.
    """
    misses = 0
    # number of distinguishable score levels the digest can encode
    levels = max(1, int(min(2.0 ** min(B, 30), N)))
    for _ in range(trials):
        true_set = rng.choice(N, size=k, replace=False)
        is_lb = np.zeros(N, dtype=bool)
        is_lb[true_set] = True

        if scheme == "oracle":
            # knows the true set; features are perfect
            score = is_lb.astype(float) + rng.normal(0, 1e-6, N)
        elif scheme == "noisy":
            # load-bearing items have higher feature mean, but noisy (signal-to-noise ~1)
            score = is_lb.astype(float) * 1.0 + rng.normal(0, 1.0, N)
        elif scheme == "random":
            score = rng.normal(0, 1.0, N)
        else:
            raise ValueError(scheme)

        # adversary corrupts a fraction phi of items: their score carries no signal
        if phi > 0.0:
            corrupt = rng.random(N) < phi
            score[corrupt] = rng.normal(0, 1.0, corrupt.sum())

        # B-bit budget: quantize scores into `levels` bins; within a bin the digest
        # cannot distinguish, so ties are broken uniformly at random (worst case for
        # zero-miss). This is how a finite-bit digest loses resolution.
        if levels < N:
            ranks = np.argsort(-score)
            quant = np.empty(N)
            binsize = int(np.ceil(N / levels))
            for b in range(levels):
                idx = ranks[b * binsize:(b + 1) * binsize]
                quant[idx] = -b + rng.normal(0, 1e-9, len(idx))
            score = quant

        opened = set(np.argsort(-score)[:m].tolist())
        if not set(true_set.tolist()).issubset(opened):
            misses += 1
    return misses / trials

# ==================================================================
# PANEL 1 — the frontier and real schemes
# ==================================================================
N, k, m = 200, 4, 12
Bmax = floor_bits(N, k, m) + 6
Bgrid = np.linspace(0, Bmax, 40)

opt = [optimal_miss(B, N, k, m) for B in Bgrid]
Bstar = floor_bits(N, k, m)

# simulate real schemes across the bit budget
Bsched = np.linspace(1, Bmax, 14)
noisy = [simulate_scheme("noisy",  N, k, m, B, trials=3000) for B in Bsched]
oracle = [simulate_scheme("oracle", N, k, m, B, trials=3000) for B in Bsched]
randb = [simulate_scheme("random", N, k, m, B, trials=1500) for B in Bsched]

# ==================================================================
# PANEL 2 — adversarial feature corruption inflates the floor
# ==================================================================
phis = [0.0, 0.1, 0.25, 0.5]
Bfix_grid = np.linspace(1, Bmax + 2, 12)
panel2 = {}
for phi in phis:
    panel2[phi] = [simulate_scheme("noisy", N, k, m, B, trials=2500, phi=phi) for B in Bfix_grid]

# ==================================================================
# PANEL 3 — split-digest: joint miss for disjoint vs overlapping readers
# ==================================================================
# Two readers each have a load-bearing set of size k. A joint digest opening m
# items must catch BOTH readers' sets. If the sets are disjoint, the joint task
# is to catch a set of size up to 2k; if identical, size k. We measure the joint
# miss vs digest budget for overlap in {full, half, none}.
def simulate_joint(N, k, m, B, overlap, trials=3000):
    misses = 0
    levels = max(1, int(min(2.0 ** min(B, 30), N)))
    for _ in range(trials):
        setA = rng.choice(N, size=k, replace=False)
        if overlap == "full":
            setB = setA.copy()
        elif overlap == "half":
            keep = setA[:k // 2]
            rest = rng.choice(np.setdiff1d(np.arange(N), setA), size=k - len(keep), replace=False)
            setB = np.concatenate([keep, rest])
        else:  # none
            setB = rng.choice(np.setdiff1d(np.arange(N), setA), size=k, replace=False)
        union = np.union1d(setA, setB)
        is_lb = np.zeros(N, dtype=bool); is_lb[union] = True
        score = is_lb.astype(float) * 1.0 + rng.normal(0, 1.0, N)
        if levels < N:
            ranks = np.argsort(-score); quant = np.empty(N)
            binsize = int(np.ceil(N / levels))
            for b in range(levels):
                idx = ranks[b*binsize:(b+1)*binsize]
                quant[idx] = -b + rng.normal(0, 1e-9, len(idx))
            score = quant
        opened = set(np.argsort(-score)[:m].tolist())
        if not set(union.tolist()).issubset(opened):
            misses += 1
    return misses / trials

overlaps = ["full", "half", "none"]
panel3 = {ov: [simulate_joint(N, k, m, B, ov, trials=2500) for B in Bsched] for ov in overlaps}
# theoretical floors for the union sizes
floor_full = floor_bits(N, k, m)
floor_none = floor_bits(N, 2*k, m)   # disjoint => must catch 2k items

# ==================================================================
# RENDER
# ==================================================================
fig, axes = plt.subplots(1, 3, figsize=(16.5, 5.0))
plt.rcParams.update({"font.size": 11})

# Panel 1
ax = axes[0]
ax.plot(Bgrid, opt, 'k-', lw=2.4, label='information floor\n(best possible B-bit digest)', zorder=5)
ax.plot(Bsched, oracle, 'o-', color='#1f6e46', ms=5, lw=1.3, label='oracle digest (true set known)')
ax.plot(Bsched, noisy,  's-', color='#1e466e', ms=5, lw=1.3, label='noisy learned scorer (SNR≈1)')
ax.plot(Bsched, randb,  '^-', color='#8c1e1e', ms=5, lw=1.3, label='random digest (no signal)')
ax.axvline(Bstar, color='gray', ls='--', lw=1.2)
ax.text(Bstar+0.15, 0.85, f'$B^\\star$={Bstar:.1f} bits', rotation=90, va='top', color='gray', fontsize=10)
ax.fill_betweenx([0,1], 0, Bstar, color='#8c1e1e', alpha=0.05)
ax.set_xlabel('digest budget $B$ (bits)'); ax.set_ylabel('P(miss $\\geq$ 1 load-bearing item)')
ax.set_title(f'Panel 1 — the floor bounds every scheme\n$N$={N}, $k$={k}, operator opens $m$={m}', fontsize=11)
ax.legend(fontsize=8.3, loc='upper right'); ax.set_ylim(-0.03, 1.03); ax.grid(alpha=0.25)

# Panel 2
ax = axes[1]
cols = ['#1e466e', '#2e7d5b', '#c78a1e', '#8c1e1e']
for phi, c in zip(phis, cols):
    ax.plot(Bfix_grid, panel2[phi], 'o-', color=c, ms=4.5, lw=1.4,
            label=f'$\\phi$={phi:.2f} corrupted')
ax.axvline(Bstar, color='gray', ls='--', lw=1.0)
ax.set_xlabel('digest budget $B$ (bits)'); ax.set_ylabel('P(miss $\\geq$ 1)')
ax.set_title('Panel 2 — adversarial feature corruption\ninflates the effective floor (mimicry)', fontsize=11)
ax.legend(fontsize=9, title='fraction $\\phi$'); ax.set_ylim(-0.03, 1.03); ax.grid(alpha=0.25)

# Panel 3
ax = axes[2]
ax.plot(Bsched, panel3['full'], 'o-', color='#1f6e46', ms=5, lw=1.4, label='readers agree (overlap=full)')
ax.plot(Bsched, panel3['half'], 's-', color='#c78a1e', ms=5, lw=1.4, label='partial overlap (half)')
ax.plot(Bsched, panel3['none'], '^-', color='#8c1e1e', ms=5, lw=1.4, label='readers disjoint (overlap=none)')
ax.axvline(floor_full, color='#1f6e46', ls='--', lw=1.1)
ax.axvline(floor_none, color='#8c1e1e', ls='--', lw=1.1)
ax.text(floor_full+0.1, 0.5, f'floor$_k$={floor_full:.1f}', rotation=90, va='center', color='#1f6e46', fontsize=9)
ax.text(floor_none+0.1, 0.5, f'floor$_{{2k}}$={floor_none:.1f}', rotation=90, va='center', color='#8c1e1e', fontsize=9)
ax.set_xlabel('joint digest budget $B$ (bits)'); ax.set_ylabel('P(joint miss $\\geq$ 1)')
ax.set_title('Panel 3 — split-digest (A1): disjoint readers\nforce the sum of floors', fontsize=11)
ax.legend(fontsize=9); ax.set_ylim(-0.03, 1.03); ax.grid(alpha=0.25)

plt.tight_layout()
plt.savefig('/home/claude/a7_figure.png', dpi=150, bbox_inches='tight')
print("Figure saved.")

# ==================================================================
# QUANTITATIVE FALSIFICATION CHECK
# ==================================================================
print("\n=== FALSIFICATION TEST: does any scheme beat the floor? ===")
violations = 0
for B, mo in zip(Bsched, oracle):
    predicted_min = optimal_miss(B, N, k, m)
    # allow small Monte-Carlo slack
    if mo < predicted_min - 0.03:
        violations += 1
        print(f"  VIOLATION at B={B:.1f}: oracle miss {mo:.3f} < floor {predicted_min:.3f}")
print(f"  oracle scheme violations of the floor: {violations} / {len(Bsched)}")
print(f"  -> floor holds: {'YES (theory survives)' if violations==0 else 'NO (theory refuted!)'}")

print("\n=== KEY NUMBERS ===")
print(f"  Panel 1 floor  B* (catch k={k} of N={N}, open m={m}): {Bstar:.2f} bits")
print(f"  Panel 3 floor  disjoint readers (catch 2k={2*k}):      {floor_none:.2f} bits")
print(f"  floor inflation from split (disjoint - single):        {floor_none - floor_full:.2f} bits")
print(f"  ratio floor_2k / floor_k:                              {floor_none/floor_full:.2f}x")

# adversarial: effective floor shift — bits needed to reach miss<=0.1 at each phi
print("\n=== Panel 2: budget needed to reach P(miss)<=0.1 as phi grows ===")
for phi in phis:
    ys = np.array(panel2[phi]); xs = np.array(Bfix_grid)
    below = np.where(ys <= 0.10)[0]
    need = xs[below[0]] if len(below) else float('inf')
    print(f"  phi={phi:.2f}:  B needed ≈ {need if need!=float('inf') else '>range'}"
          + (f" bits" if need!=float('inf') else ""))
