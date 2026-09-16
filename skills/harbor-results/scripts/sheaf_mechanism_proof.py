#!/usr/bin/env python3
"""
DIAGNOSIS: what went wrong, and the correct formulation.
The bug: I computed dim H^1(G;F) — a property of the SHEAF (restriction maps),
independent of data. Equivocation is a property of a SPECIFIC observed assignment:
does the observed local data glue to a global section? That is the Cech obstruction
of the OBSERVED COCHAIN, not the cohomology of the abstract sheaf.

Correct object: observed edge-disagreements y in C^1. A global explanation exists
iff y is in im(delta) (a coboundary). The UNEXPLAINABLE part is the projection of y
onto coker(delta) = harmonic space. Pairwise comparison sees y_e directly on
COMPARED edges. The value-add is when an edge is NOT compared (partition) but lies
on a CYCLE: the cocycle condition around the cycle constrains the missing edge, so
the inconsistency is detectable cohomologically though invisible pairwise.

KEY: a cut edge (single bridge) carries NO cycle => NO cocycle constraint => no
value-add. Need the severed edge on a cycle (two parallel paths between clusters).
Demonstrate the mechanism on the smallest clean example: a single cycle C_n where
we remove one edge's direct comparison.
"""
import numpy as np
rng = np.random.default_rng(7)

# Smallest decisive example: a cycle of n harbors, SCALAR log values (d=1).
# Edge {i,i+1} "compares" the difference x_i - x_{i+1} (a 1-dim shared readout).
# Observed edge value g_e = the disagreement each edge reports.
# HONEST: all consistent, exists global x with x_i - x_{i+1} = g_e for all e,
#         which requires sum of g_e around the cycle = 0 (the cocycle condition).
# EQUIVOCATION on a cycle makes sum_e g_e != 0  <=> no global section.
# Coboundary delta: C^0=R^n -> C^1=R^n (one per edge), (delta x)_e = x_i - x_{i+1}.
# im(delta) = {g : sum g_e = 0}. coker(delta) = R (spanned by all-ones) = H^1.
# The harmonic component of observed g = (mean of g) * ones => equals (1/n) sum g_e.
# THIS is the equivocation signal, and it is exactly the cocycle sum.

def cycle_experiment(n, equivocator_edges, compared_mask):
    """
    equivocator_edges: dict edge_index -> injected disagreement (breaks cocycle)
    compared_mask: bool array length n, True if that edge is directly compared
                   (pairwise can see it). Partition => some edges False.
    Returns: pairwise_detects, cohomology_signal (harmonic mass), and whether
             the missing edge lies on the cycle (always true for C_n).
    """
    # observed disagreements: honest edges 0, equivocation edges carry injected value
    g = np.zeros(n)
    for e, val in equivocator_edges.items():
        g[e] = val
    # build coboundary delta (n edges x n vertices)
    delta = np.zeros((n, n))
    for e in range(n):
        i, j = e, (e+1) % n
        delta[e, i] += 1.0
        delta[e, j] -= 1.0
    # harmonic space of C^1 = coker(delta) = left nullspace of delta = span(ones)/... 
    U, s, Vt = np.linalg.svd(delta, full_matrices=True)
    rank = int((s > 1e-9).sum())
    harm = U[:, rank:]                      # columns span coker(delta) = H^1
    # cohomology signal = norm of projection of observed g onto harmonic space
    coh_signal = float(np.linalg.norm(harm.T @ g)) if harm.shape[1] else 0.0

    # pairwise: sees a disagreement only on a COMPARED edge that is nonzero
    pairwise = any((g[e] != 0.0) and compared_mask[e] for e in range(n))

    # the cocycle sum (what cohomology 'sees' even across uncompared edges)
    cocycle_sum = float(g.sum())
    return pairwise, coh_signal, cocycle_sum, rank, harm.shape[1]

print("="*68)
print("CORRECT MECHANISM on a cycle C_n (scalar stalks) — the clean case")
print("="*68)
n = 6
print(f"\nCycle C_{n}: H^1 = coker(delta) has dim {n - (n-1)} = 1 (the all-ones cocycle)\n")

# Case A: single equivocator edge, ALL edges compared (no partition)
pw, coh, cs, rk, h1 = cycle_experiment(n, {2: 3.0}, np.ones(n, bool))
print(f"A) equivocation on edge 2, all compared:   pairwise={pw}  coh_signal={coh:.3f}  "
      f"cocycle_sum={cs:.1f}  (both detect)")

# Case B: PARTITION — the equivocation edge itself is NOT directly compared,
# but it lies on the cycle. Pairwise is blind to it; cohomology sees the cocycle.
mask = np.ones(n, bool); mask[2] = False   # edge 2 not compared (partitioned)
pw, coh, cs, rk, h1 = cycle_experiment(n, {2: 3.0}, mask)
print(f"B) equivocation on edge 2, edge 2 NOT compared (partition):")
print(f"     pairwise={pw}  coh_signal={coh:.3f}  cocycle_sum={cs:.1f}")
print(f"     -> COHOMOLOGY-ONLY DETECTION: {coh>1e-6 and not pw}")

# Case C: equivocation split so NO single edge disagreement, only the SUM around
# the cycle is nonzero (true contextuality: every compared edge looks locally fine).
# Distribute the inconsistency: edges 1 and 4 each carry +1.5, edge 2 (uncompared)
# would need -3 to close the cocycle but is absent -> global section impossible.
mask = np.ones(n, bool); mask[2] = False
pw, coh, cs, rk, h1 = cycle_experiment(n, {1: 1.5, 4: 1.5}, mask)
print(f"C) inconsistency spread on compared edges 1,4 (+1.5 each), edge 2 uncompared:")
print(f"     pairwise (any single compared edge disagrees)={pw}  "
      f"coh_signal={coh:.3f}  cocycle_sum={cs:.1f}")
print(f"     note: pairwise sees edges 1,4 disagree but CANNOT conclude a GLOBAL")
print(f"     inconsistency without edge 2; cohomology's cocycle sum={cs:.1f} proves it.")

print("\n" + "="*68)
print("The mechanism is real. Now: does it survive when the missing edge is a")
print("CUT edge (not on any cycle)? This is the honest failure boundary.")
print("="*68)
# Path graph P_n: remove one edge's comparison. A path has NO cycles => coker=0
# beyond connectivity => no cocycle constraint on the missing edge.
def path_experiment(n, equivocator_edges, compared_mask):
    g = np.zeros(n-1)
    for e, val in equivocator_edges.items(): g[e] = val
    delta = np.zeros((n-1, n))
    for e in range(n-1):
        delta[e, e] += 1.0; delta[e, e+1] -= 1.0
    U, s, Vt = np.linalg.svd(delta, full_matrices=True)
    rank = int((s > 1e-9).sum())
    harm = U[:, rank:]
    coh = float(np.linalg.norm(harm.T @ g)) if harm.shape[1] else 0.0
    pairwise = any((g[e] != 0.0) and compared_mask[e] for e in range(n-1))
    return pairwise, coh, harm.shape[1]

mask = np.ones(n-1, bool); mask[2] = False
pw, coh, h1 = path_experiment(n, {2: 3.0}, mask)
print(f"\nPath P_{n}, equivocation on uncompared CUT edge 2:")
print(f"   pairwise={pw}  coh_signal={coh:.3f}  (H^1 dim={h1})")
print(f"   -> cohomology CANNOT detect across a cut edge: {coh<1e-6}")
print(f"   This is the honest boundary: value-add REQUIRES the missing edge on a cycle.")
