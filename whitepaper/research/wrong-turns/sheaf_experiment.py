"""
SHEAF COMMIT-OR-CUT EXPERIMENT
==============================
Question (from the sheaf assessment): does sheaf cohomology add real power over
O(|E|) pairwise digest comparison for detecting/localizing equivocation in a
federated witness-log system? The decisive test lives in the PARTITION regime,
where pairwise comparison is impossible but cocycle conditions over triangles
still bind (structurally identical to Abramsky-Brandenburger contextuality).

Model
-----
- Gossip graph G (vertices = harbors, edges = peer links actually used).
- Each harbor holds a log state, embedded as a delta-vector in R^d (abelianization
  route (a) from the assessment: differences are well-defined).
- On each edge e={u,v}, u and v have compared on a shared coordinate subspace
  F(e) (the prefix they showed each other). Restriction map F(v)->F(e) is the
  projection onto those shared coordinates.
- HONEST run: all harbors hold projections of ONE global log => a global section
  exists => H^1 should be only the topological beta_1 (cycle rank), NOT equivocation.
- EQUIVOCATION: a signer sends DIFFERENT roots to different neighbors => locally
  the pairwise-compared edges may still agree, but no global section exists.

We build the cellular-sheaf coboundary delta: C^0 = (+)_v F(v) -> C^1 = (+)_e F(e),
compute dim H^0 = dim ker delta, dim H^1 = dim coker delta = |C^1| - rank(delta),
the sheaf Laplacian L1 = delta delta^T, and the minimal-norm harmonic 1-cochain
(support localizes the fault).

PySheaf cannot compute cohomology (maintainers confirm); we hand-roll in numpy.

DECISION GATE
-------------
COMMIT if: (i) dim H^1 net of beta_1 == number of independent equivocations, AND
           (ii) the PARTITION regime yields cohomology-only detection that
                O(|E|) pairwise comparison misses.
CUT if: every equivocation H^1 flags is also flagged by pairwise comparison.
"""

import numpy as np
import networkx as nx
from itertools import combinations

rng = np.random.default_rng(20260816)
np.set_printoptions(precision=3, suppress=True)

D_GLOBAL = 8          # dimension of the "true" global log embedding
EDGE_SHARE = 4        # dimension of the shared prefix subspace on each edge

def build_sheaf(G, harbor_states, edge_bases):
    """
    Assemble the coboundary matrix delta: C^0 -> C^1.
    harbor_states: dict v -> vector in R^{D_GLOBAL}   (the stalk value F(v))
    edge_bases: dict e -> (basis matrix P_e of shape (EDGE_SHARE, D_GLOBAL))
                the shared-coordinate projection used on edge e.
    Restriction v->e is P_e applied to F(v). The coboundary on edge e=(u,v) with
    orientation u<v is  (delta x)_e = P_e x_u - P_e x_v.
    """
    verts = sorted(G.nodes())
    edges = sorted([tuple(sorted(e)) for e in G.edges()])
    vidx = {v: i for i, v in enumerate(verts)}
    nV, nE = len(verts), len(edges)

    # block matrix: rows = edges x EDGE_SHARE, cols = verts x D_GLOBAL
    delta = np.zeros((nE * EDGE_SHARE, nV * D_GLOBAL))
    for ei, (u, v) in enumerate(edges):
        P = edge_bases[(u, v)]
        r0 = ei * EDGE_SHARE
        delta[r0:r0+EDGE_SHARE, vidx[u]*D_GLOBAL:(vidx[u]+1)*D_GLOBAL] += P
        delta[r0:r0+EDGE_SHARE, vidx[v]*D_GLOBAL:(vidx[v]+1)*D_GLOBAL] -= P
    return delta, verts, edges

def cohomology(delta, tol=1e-8):
    """dim H^0 = nullity(delta); dim H^1 = |C^1| - rank(delta)."""
    nE_rows = delta.shape[0]
    if delta.size == 0:
        return 0, 0, 0
    rank = np.linalg.matrix_rank(delta, tol=tol)
    dimH0 = delta.shape[1] - rank          # ker delta
    dimH1 = nE_rows - rank                  # coker delta
    return dimH0, dimH1, rank

def harmonic_1cochain(delta, tol=1e-9):
    """Minimal-norm harmonic representative: an element of ker(delta^T) (= ker L1
    restricted to im-orthogonal complement). Returns per-edge energy for localization."""
    # Harmonic 1-cochains = ker(delta^T) intersect (im delta)^perp ; for a graph
    # two-term complex H^1 = coker(delta) so harmonic reps = ker(delta^T).
    dT = delta.T
    # nullspace of delta^T = left nullspace of delta
    u, s, vh = np.linalg.svd(delta, full_matrices=True)
    # left singular vectors with zero singular value span coker(delta) = harmonic H^1
    rank = int((s > tol).sum())
    harm_basis = u[:, rank:]     # columns are harmonic 1-cochains (in C^1)
    return harm_basis

def edge_energy(harm_basis, edges, EDGE_SHARE):
    """Sum of squared harmonic mass on each edge's block -> localization signal."""
    if harm_basis.shape[1] == 0:
        return {e: 0.0 for e in edges}
    # project: total energy per edge across all harmonic basis vectors
    energy = {}
    for ei, e in enumerate(edges):
        block = harm_basis[ei*EDGE_SHARE:(ei+1)*EDGE_SHARE, :]
        energy[e] = float((block**2).sum())
    return energy

def pairwise_detects(G, roots_sent):
    """
    Baseline: O(|E|) pairwise comparison. roots_sent[(u,v)] = the root u showed v
    and roots_sent[(v,u)] = root v showed u. Pairwise comparison on edge {u,v}
    can only compare what BOTH endpoints exchanged ACROSS THAT EDGE. Detection
    fires iff on some edge the two directed roots disagree AND both were exchanged.
    Under partition, edges that were never both-exchanged cannot be compared.
    """
    for (u, v) in G.edges():
        a = roots_sent.get((u, v)); b = roots_sent.get((v, u))
        if a is not None and b is not None and not np.allclose(a, b):
            return True
    return False


# ==================================================================
# Scenario generator
# ==================================================================
def make_scenario(topology, n, equivocators, partition=False, seed=None):
    """
    Returns G, harbor_states, edge_bases, roots_sent, truth.
    - honest harbors: F(v) = P_global (projection of the one true log).
    - equivocator w: sends inconsistent roots; we realize this by making w's stalk
      value INCONSISTENT with the shared subspace agreement on its incident edges,
      i.e. there is no single x_w reconciling all its edges.
    """
    lg = np.random.default_rng(seed)
    if topology == "ring":
        G = nx.cycle_graph(n)
    elif topology == "expander":
        G = nx.random_regular_graph(3, n, seed=int(lg.integers(1e6)))
    elif topology == "hub":
        G = nx.star_graph(n-1)
    elif topology == "two_cluster":
        # two cliques joined by a bridge -> models a partition when bridge cut
        k = n // 2
        G = nx.disjoint_union(nx.complete_graph(k), nx.complete_graph(n-k))
        G.add_edge(k-1, k)   # the bridge
    else:
        raise ValueError(topology)

    # one true global log
    x_true = lg.normal(0, 1, D_GLOBAL)

    # per-edge shared subspace projection (random orthonormal rows)
    edge_bases = {}
    for e in G.edges():
        e = tuple(sorted(e))
        M = lg.normal(0, 1, (EDGE_SHARE, D_GLOBAL))
        # orthonormalize rows
        Q, _ = np.linalg.qr(M.T)
        edge_bases[e] = Q[:, :EDGE_SHARE].T

    # harbor stalk values: honest = x_true; equivocator = perturbed so no global
    # section reconciles its edges
    harbor_states = {v: x_true.copy() for v in G.nodes()}
    roots_sent = {}
    for (u, v) in G.edges():
        roots_sent[(u, v)] = x_true.copy()
        roots_sent[(v, u)] = x_true.copy()

    for w in equivocators:
        # w sends a DIFFERENT root to each neighbor -> inconsistent directed roots
        nbrs = list(G.neighbors(w))
        for i, nb in enumerate(nbrs):
            perturbed = x_true + lg.normal(0, 1.5, D_GLOBAL) * (i + 1)
            roots_sent[(w, nb)] = perturbed
        # w's single stalk cannot match all its edges: pick one, leaving others
        # inconsistent -> this is what makes a global section fail
        harbor_states[w] = x_true + lg.normal(0, 1.5, D_GLOBAL)

    # PARTITION: sever the bridge's comparability. The two sides cannot pairwise-
    # compare across the partition, but the sheaf still has both local sections.
    if partition and topology == "two_cluster":
        k = n // 2
        bridge = tuple(sorted((k-1, k)))
        # the two endpoints did not manage to exchange across the bridge in time
        roots_sent.pop((k-1, k), None)
        roots_sent.pop((k, k-1), None)
        # but the edge (and its cocycle constraint) still exists in the complex

    return G, harbor_states, edge_bases, roots_sent, equivocators


def run_case(topology, n, equivocators, partition=False, seed=0):
    G, states, ebases, roots, truth = make_scenario(topology, n, equivocators, partition, seed)
    delta, verts, edges = build_sheaf(G, states, ebases)
    dimH0, dimH1, rank = cohomology(delta)
    beta1 = G.number_of_edges() - G.number_of_nodes() + nx.number_connected_components(G)
    harm = harmonic_1cochain(delta)
    energy = edge_energy(harm, edges, EDGE_SHARE)
    pw = pairwise_detects(G, roots)

    # localization: which vertices are incident to the top-energy edges?
    if energy and max(energy.values()) > 1e-6:
        thresh = 0.3 * max(energy.values())
        hot_edges = [e for e, en in energy.items() if en > thresh]
        localized = set()
        for (u, v) in hot_edges:
            localized |= {u, v}
    else:
        localized = set()

    return {
        "topology": topology, "n": n, "equivocators": list(equivocators),
        "partition": partition, "dimH0": dimH0, "dimH1": dimH1, "beta1": beta1,
        "H1_net": dimH1,  # for a connected graph with trivial coefficient the topological part enters H^0 side; see note
        "pairwise_detects": pw,
        "cohomology_detects": dimH1 > 0,  # (relative to honest baseline, computed below)
        "localized_vertices": localized,
        "n_edges": G.number_of_edges(),
    }

# ==================================================================
# CALIBRATION: honest baseline (no equivocators) to measure topological H^1
# ==================================================================
print("="*70)
print("CALIBRATION — honest runs (no equivocation): H^1 should be topological only")
print("="*70)
baseline_H1 = {}
for topo, n in [("ring", 8), ("expander", 12), ("hub", 10), ("two_cluster", 10)]:
    res = run_case(topo, n, equivocators=[], partition=False, seed=1)
    baseline_H1[topo] = res["dimH1"]
    print(f"  {topo:12s} n={n:2d}: dim H^0={res['dimH0']:3d}  dim H^1={res['dimH1']:3d}  "
          f"beta1={res['beta1']:2d}  edges={res['n_edges']:2d}")

# ==================================================================
# TEST 1 — counting: does H^1 (net of honest baseline) track # equivocators?
# ==================================================================
print("\n" + "="*70)
print("TEST 1 — counting: H^1 net of baseline vs. number of equivocators")
print("="*70)
for topo, n in [("expander", 12), ("two_cluster", 12)]:
    base = run_case(topo, n, [], partition=False, seed=2)["dimH1"]
    print(f"\n  {topo} (baseline H^1={base}):")
    for neq in [0, 1, 2, 3]:
        eqs = list(rng.choice(n, size=neq, replace=False)) if neq else []
        res = run_case(topo, n, eqs, partition=False, seed=2)
        net = res["dimH1"] - base
        print(f"    {neq} equivocator(s): dim H^1={res['dimH1']:3d}  net={net:+3d}  "
              f"pairwise_detects={res['pairwise_detects']}")

# ==================================================================
# TEST 2 (DECISIVE) — partition: cohomology-only detection?
# ==================================================================
print("\n" + "="*70)
print("TEST 2 (DECISIVE) — partition regime: does cohomology detect what")
print("pairwise comparison CANNOT (because the two sides never compared)?")
print("="*70)
n = 12
base = run_case("two_cluster", n, [], partition=True, seed=3)["dimH1"]
print(f"\n  two_cluster n={n}, bridge severed (partition), baseline H^1={base}")
# Place an equivocator that sends different roots into the two clusters via the bridge
# node, so the inconsistency is ONLY visible across the partition.
for trial in range(4):
    # equivocator is a bridge-adjacent node
    k = n // 2
    equivocator = [k-1]  # the node on one side of the severed bridge
    res = run_case("two_cluster", n, equivocator, partition=True, seed=10+trial)
    net = res["dimH1"] - base
    print(f"    trial {trial}: dim H^1={res['dimH1']:3d}  net={net:+3d}  "
          f"pairwise_detects={res['pairwise_detects']}  "
          f"cohomology_detects={net>0}  localized={sorted(res['localized_vertices'])}")

print("\n" + "="*70)
print("VERDICT LOGIC")
print("="*70)
print("  COMMIT iff: partition trials show net H^1>0 (cohomology detects) while")
print("             pairwise_detects=False (pairwise blind across the partition).")
print("  CUT iff:    whenever net H^1>0, pairwise also detects (cohomology redundant).")
