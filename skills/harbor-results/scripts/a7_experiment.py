#!/usr/bin/env python3
"""
A7 v2 — The Information-Floor Falsification Experiment (corrected model)
=======================================================================
The v1 bug (instructive, and exactly what falsification-first catches): I gave the
oracle a PERFECT score vector and only charged bits for tie-resolution. But the
floor charges bits for *identifying which items are load-bearing at all*. So v1's
"violations" were a model/theory mismatch, not a refutation. Fix: the digest is a
literal B-bit message; the operator's opened m-set is a deterministic decode of
that message. Now bits gate identification, exactly as the theorem intends.

Correct model
-------------
A digest scheme is an ENCODER e: (observed features of the swarm) -> {0,1}^B and a
fixed DECODER d: {0,1}^B -> (an m-subset to open). The scheme catches the true
load-bearing set T iff T subseteq d(e(features)). Zero-miss over all placements is
possible iff the 2^B decoded m-subsets cover every k-subset, i.e. iff
    2^B * C(m,k) >= C(N,k)   <=>   B >= B* = log2 C(N,k) - log2 C(m,k).

For a REAL (feature-limited) encoder we must actually build e and d and measure the
empirical miss rate. We implement three encoders:
  - oracle:  sees the true set, encodes the best index it can in B bits
             (partitions the C(N,k) placements into 2^B cover-classes).
  - noisy:   sees noisy features; encodes its top candidates into the B-bit index.
  - random:  ignores features.
The DECODER is a shared, data-independent codebook: 2^B m-subsets chosen to cover
as much placement mass as possible (a randomized cover, which is near-optimal).

This makes B genuinely information-limiting and lets us test whether ANY encoder
dips below the optimal frontier max(0, 1 - 2^B C(m,k)/C(N,k)).
"""

import numpy as np
from math import lgamma
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

rng = np.random.default_rng(20260816)

def log_choose(n, k):
    if k < 0 or k > n:
        return -np.inf
    return (lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1)) / np.log(2)

def floor_bits(N, k, m):
    return log_choose(N, k) - log_choose(m, k)

def optimal_miss(B, N, k, m):
    log_cov = B + log_choose(m, k) - log_choose(N, k)
    return max(0.0, 1.0 - 2.0 ** min(log_cov, 0.0))

def build_codebook(N, m, nbits, size_cap=4096):
    """A data-independent decoder: a list of m-subsets (the 2^B 'flag patterns').
    Randomized cover — each codeword is a random m-subset. Near-optimal for coverage."""
    ncode = int(min(2.0 ** min(nbits, 22), size_cap))
    ncode = max(1, ncode)
    code = [rng.choice(N, size=m, replace=False) for _ in range(ncode)]
    return code

def encode_decode_miss(scheme, N, k, m, B, codebook, trials=3000, phi=0.0):
    """
    Empirical P(miss>=1). The encoder must pick, from the codebook, the codeword
    (m-subset) most likely to contain the true set given its (possibly noisy) view.
    With B bits it may address min(2^B, len(codebook)) codewords. The oracle picks
    the codeword that actually contains T if one is addressable; else its best guess.
    """
    ncode = len(codebook)
    addressable = int(min(2.0 ** min(B, 22), ncode))
    addressable = max(1, addressable)
    cb = codebook[:addressable]
    cb_sets = [set(c.tolist()) for c in cb]
    misses = 0
    for _ in range(trials):
        T = set(rng.choice(N, size=k, replace=False).tolist())

        if scheme == "oracle":
            # pick any addressable codeword that contains T; if none, the one with
            # max overlap (best possible given the budget).
            chosen = None
            best_ov = -1
            for s in cb_sets:
                if T.issubset(s):
                    chosen = s; break
                ov = len(T & s)
                if ov > best_ov:
                    best_ov = ov; best = s
            opened = chosen if chosen is not None else best
        elif scheme == "noisy":
            # noisy features: estimate membership prob per item, score each codeword
            # by summed estimated membership, pick best addressable codeword.
            est = np.zeros(N)
            for i in T: est[i] += 1.0
            est = est + rng.normal(0, 1.0, N)            # SNR ~ 1
            if phi > 0.0:
                corrupt = rng.random(N) < phi
                est[corrupt] = rng.normal(0, 1.0, corrupt.sum())
            scores = [est[list(s)].sum() for s in cb_sets]
            opened = cb_sets[int(np.argmax(scores))]
        elif scheme == "random":
            opened = cb_sets[rng.integers(addressable)]
        else:
            raise ValueError(scheme)

        if not T.issubset(opened):
            misses += 1
    return misses / trials


# ------------------------------------------------------------------
# Use a regime where the floor is small enough to sweep fully.
# N=60, k=2, m=8 -> B* = log2 C(60,2) - log2 C(8,2) = log2(1770) - log2(28)
# ------------------------------------------------------------------
N, k, m = 60, 2, 8
Bstar = floor_bits(N, k, m)
Bmax = Bstar + 5
print(f"Regime N={N}, k={k}, m={m}:  B* = {Bstar:.2f} bits")

# big codebook so the budget (not codebook size) is the binding constraint
codebook = build_codebook(N, m, nbits=int(np.ceil(Bmax)) + 2, size_cap=8192)

Bgrid = np.linspace(0, Bmax, 60)
opt = [optimal_miss(B, N, k, m) for B in Bgrid]

Bsched = np.linspace(1, Bmax, 16)
oracle = [encode_decode_miss("oracle", N, k, m, B, codebook, trials=4000) for B in Bsched]
noisy  = [encode_decode_miss("noisy",  N, k, m, B, codebook, trials=4000) for B in Bsched]
randb  = [encode_decode_miss("random", N, k, m, B, codebook, trials=2000) for B in Bsched]

# Panel 2 — adversarial corruption
phis = [0.0, 0.15, 0.35, 0.6]
panel2 = {phi: [encode_decode_miss("noisy", N, k, m, B, codebook, trials=3000, phi=phi)
                for B in Bsched] for phi in phis}

# Panel 3 — split-digest joint miss. Two readers, sets A and B each size k.
# Joint task: catch A ∪ B (size up to 2k). Reuse the same machinery with the union.
def joint_miss(N, k, m, B, overlap, codebook, trials=3500):
    ncode = len(codebook); addressable = max(1, int(min(2.0**min(B,22), ncode)))
    cb_sets = [set(c.tolist()) for c in codebook[:addressable]]
    misses = 0
    for _ in range(trials):
        A = set(rng.choice(N, size=k, replace=False).tolist())
        if overlap == "full":
            Bset = set(A)
        elif overlap == "half":
            keep = list(A)[:max(1,k//2)]
            pool = list(set(range(N)) - A)
            Bset = set(keep) | set(rng.choice(pool, size=k-len(keep), replace=False).tolist())
        else:
            pool = list(set(range(N)) - A)
            Bset = set(rng.choice(pool, size=k, replace=False).tolist())
        U = A | Bset
        # oracle joint encoder: best addressable codeword containing U, else max overlap
        chosen=None; best_ov=-1; best=None
        for s in cb_sets:
            if U.issubset(s): chosen=s; break
            ov=len(U&s)
            if ov>best_ov: best_ov=ov; best=s
        opened = chosen if chosen is not None else best
        if not U.issubset(opened): misses += 1
    return misses/trials

overlaps=["full","half","none"]
panel3={ov:[joint_miss(N,k,m,B,ov,codebook,trials=3000) for B in Bsched] for ov in overlaps}
floor_full=floor_bits(N,k,m)
floor_none=floor_bits(N,2*k,m)

# ------------------------------------------------------------------
# FALSIFICATION CHECK
# ------------------------------------------------------------------
print("\n=== FALSIFICATION TEST: does the oracle encoder ever beat the floor? ===")
violations=0
for B,mo in zip(Bsched,oracle):
    lo = optimal_miss(B,N,k,m)
    if mo < lo - 0.04:                      # MC slack
        violations+=1
        print(f"  B={B:.2f}: oracle {mo:.3f} < floor {lo:.3f}  (VIOLATION)")
print(f"  violations: {violations}/{len(Bsched)} -> "
      + ("floor HOLDS (theory survives)" if violations==0 else "floor VIOLATED"))

print("\n=== KEY NUMBERS ===")
print(f"  floor B* (k={k}):                 {floor_full:.2f} bits")
print(f"  floor disjoint readers (2k={2*k}): {floor_none:.2f} bits")
print(f"  split penalty (disjoint - single): {floor_none-floor_full:.2f} bits")
print(f"  ratio:                            {floor_none/floor_full:.2f}x")

# ------------------------------------------------------------------
# RENDER
# ------------------------------------------------------------------
fig, axes = plt.subplots(1, 3, figsize=(16.5, 5.0))
plt.rcParams.update({"font.size": 11})

ax=axes[0]
ax.plot(Bgrid, opt, 'k-', lw=2.4, label='information floor\n$1-2^{B}C(m,k)/C(N,k)$', zorder=5)
ax.plot(Bsched, oracle,'o-',color='#1f6e46',ms=5,lw=1.3,label='oracle encoder (true set known)')
ax.plot(Bsched, noisy, 's-',color='#1e466e',ms=5,lw=1.3,label='noisy encoder (SNR≈1)')
ax.plot(Bsched, randb, '^-',color='#8c1e1e',ms=5,lw=1.3,label='random encoder')
ax.axvline(Bstar,color='gray',ls='--',lw=1.2)
ax.text(Bstar+0.1,0.9,f'$B^\\star$={Bstar:.1f}',rotation=90,va='top',color='gray',fontsize=10)
ax.fill_betweenx([0,1],0,Bstar,color='#8c1e1e',alpha=0.05)
ax.set_xlabel('digest budget $B$ (bits)');ax.set_ylabel('P(miss $\\geq$ 1)')
ax.set_title(f'Panel 1 — the floor bounds every encoder\n$N$={N}, $k$={k}, open $m$={m}',fontsize=11)
ax.legend(fontsize=8.5,loc='upper right');ax.set_ylim(-0.03,1.03);ax.grid(alpha=0.25)

ax=axes[1]
cols=['#1e466e','#2e7d5b','#c78a1e','#8c1e1e']
for phi,c in zip(phis,cols):
    ax.plot(Bsched,panel2[phi],'o-',color=c,ms=4.5,lw=1.4,label=f'$\\phi$={phi:.2f}')
ax.axvline(Bstar,color='gray',ls='--',lw=1.0)
ax.set_xlabel('digest budget $B$ (bits)');ax.set_ylabel('P(miss $\\geq$ 1)')
ax.set_title('Panel 2 — feature corruption $\\phi$\ninflates the effective floor (mimicry)',fontsize=11)
ax.legend(fontsize=9,title='corrupted frac');ax.set_ylim(-0.03,1.03);ax.grid(alpha=0.25)

ax=axes[2]
ax.plot(Bsched,panel3['full'],'o-',color='#1f6e46',ms=5,lw=1.4,label='readers agree (full)')
ax.plot(Bsched,panel3['half'],'s-',color='#c78a1e',ms=5,lw=1.4,label='partial overlap (half)')
ax.plot(Bsched,panel3['none'],'^-',color='#8c1e1e',ms=5,lw=1.4,label='disjoint readers (none)')
ax.axvline(floor_full,color='#1f6e46',ls='--',lw=1.1)
ax.axvline(floor_none,color='#8c1e1e',ls='--',lw=1.1)
ax.text(floor_full+0.1,0.55,f'floor$_k$={floor_full:.1f}',rotation=90,va='center',color='#1f6e46',fontsize=9)
ax.text(floor_none+0.1,0.55,f'floor$_{{2k}}$={floor_none:.1f}',rotation=90,va='center',color='#8c1e1e',fontsize=9)
ax.set_xlabel('joint digest budget $B$ (bits)');ax.set_ylabel('P(joint miss $\\geq$ 1)')
ax.set_title('Panel 3 — split-digest (A1)\ndisjoint readers force the sum of floors',fontsize=11)
ax.legend(fontsize=9);ax.set_ylim(-0.03,1.03);ax.grid(alpha=0.25)

plt.tight_layout()
plt.savefig('a7_figure.png',dpi=150,bbox_inches='tight')
print("\nFigure saved to a7_figure.png")
