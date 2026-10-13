#!/usr/bin/env python3
"""
SHEAF REPAIR AND 2-COMPLEX EXPERIMENT (CR-4 & CR-5)
====================================================
Extends the Harbor R6 sheaf cohomology results (sheaf_consistency_radius.py)
from passive 1D graph equivocation detection to active 2D simplicial swarm
control and triadic contract legibility.

THEOREMS EVALUATED:
-------------------
CR-4 (bounded energy/cost selection helper):
  For a validated ordinary finite graph-incidence input, the helper scores each
  eligible row by current residual energy divided by its supplied positive finite
  cost. In `sever` mode it removes that row from the modeled completion problem;
  in `reconcile` mode it writes that observed coordinate to zero. It reports its
  mode, selected rows, residual trajectory, remaining residual, and an explicit
  completion or early-stop status. It is a selection heuristic, not a minimum-cut
  algorithm, global optimizer, general beta_1 round theorem, authority decision,
  or assertion that edited observations describe the external world.

THEOREM CR-5 (Simplicial Hodge Decomposition & Swarm Legibility Ratio):
  On a 2-complex X = (V, E, F) representing multi-agent triadic contracts
  (e.g., Producer-Dissenter-Manager review joins, Requester-Worker-Escrow triads),
  the discrete Hodge-Helmholtz theorem yields the orthogonal direct-sum decomposition:
      C^1 = im(delta_0)  (+)  H^1(X; F)  (+)  im(delta_1^*)
  Every observed cochain g admits a unique decomposition:
      g = delta_0 x  +  h  +  delta_1^* psi
  where:
    - delta_0 x in im(delta_0) is the explainable gauge gradient (honest potential difference);
    - h in ker(delta_1) cap ker(delta_0^*) is the harmonic 1-cochain (macro-topological partition cavity);
    - delta_1^* psi in im(delta_1^*) is the triadic local frustration (micro-contract failure).
  The Swarm Legibility Ratio:
      L(g) = ||h||_2^2 / (||h||_2^2 + ||delta_1^* psi||_2^2) in [0, 1]
  distinguishes harmonic from coexact residual energy in this declared complex.
  The constructed A/B examples label their own injections; the ratio alone does
  not identify a field incident as a partition or contract violation.

Deps: numpy, scipy, networkx.
Program seed: 20260917.
"""

import sys
import numpy as np

try:
    import networkx as nx
except ImportError:  # The CR-4/CR-5 fixture functions below do not use it.
    nx = None

SEED = 20260917
D = 5              # Stalk dimension (e.g. capacity, epoch, claim bounds, rejection hash)
TOL = 1e-9
FAILURES = []

def check(cond, label):
    status = "PASS" if cond else "FAIL"
    print(f"    [{status}] {label}")
    if not cond:
        FAILURES.append(label)
    return cond

def orient_edge(e):
    return tuple(sorted(e))

def orient_face(f):
    return tuple(sorted(f))

# --------------------------------------------------------------------------
# 2-Complex Construction (Simplicial Complexes with Triadic Joins)
# --------------------------------------------------------------------------
def make_triangulated_torus_or_cylinder():
    """
    Constructs a 2-complex with a non-contractible 1-cycle (cavity)
    surrounded by filled 2-cells (triangles).
    Models a swarm with local 3-party review joins forming a ring topology.
    """
    # Two concentric 6-cycles with triangulated cylinder between them
    n_ring = 6
    V = list(range(2 * n_ring))
    edges = set()
    faces = set()

    # Inner ring: 0..5, Outer ring: 6..11
    for i in range(n_ring):
        i_next = (i + 1) % n_ring
        o = i + n_ring
        o_next = i_next + n_ring
        
        edges.add(orient_edge((i, i_next)))
        edges.add(orient_edge((o, o_next)))
        edges.add(orient_edge((i, o)))
        edges.add(orient_edge((i, o_next))) # diagonal to form triangles
        
        # Triangles: (i, i_next, o_next) and (i, o, o_next)
        faces.add(orient_face((i, i_next, o_next)))
        faces.add(orient_face((i, o, o_next)))

    return len(V), sorted(edges), sorted(faces)

def make_triadic_review_swarm():
    """
    Models a 3-agent review triad (Producer, Dissenter, Manager) connected
    to a downstream settlement node.
    V = {0: Producer, 1: Dissenter, 2: Manager, 3: Downstream Settler}
    Face (0, 1, 2) is the 3-way review join.
    """
    V = [0, 1, 2, 3]
    edges = [
        orient_edge((0, 1)),
        orient_edge((1, 2)),
        orient_edge((0, 2)),
        orient_edge((2, 3))
    ]
    faces = [orient_face((0, 1, 2))]
    return len(V), sorted(edges), sorted(faces)

# --------------------------------------------------------------------------
# Coboundary Operators for 2-Complex
# --------------------------------------------------------------------------
def build_simplicial_coboundaries(n_verts, edges, faces, dim=1):
    """
    Builds delta_0: C^0 -> C^1 and delta_1: C^1 -> C^2.
    For simplicity and exact decomposition, coordinate-wise stalks of dim=1.
    delta_0: |E| x |V|, (delta_0 x)_{uv} = x_u - x_v (for u < v)
    delta_1: |F| x |E|, for face (u,v,w) with u < v < w:
      boundary is + (v,w) - (u,w) + (u,v)
      so (delta_1 g)_{uvw} = g_{uv} + g_{vw} - g_{uw}
    """
    nE = len(edges)
    nV = n_verts
    nF = len(faces)

    edge_map = {e: i for i, e in enumerate(edges)}

    delta_0 = np.zeros((nE, nV))
    for ei, (u, v) in enumerate(edges):
        delta_0[ei, u] = 1.0
        delta_0[ei, v] = -1.0

    delta_1 = np.zeros((nF, nE))
    for fi, (u, v, w) in enumerate(faces):
        # boundary of [u, v, w] is [v, w] - [u, w] + [u, v]
        e_uv = edge_map[orient_edge((u, v))]
        e_vw = edge_map[orient_edge((v, w))]
        e_uw = edge_map[orient_edge((u, w))]

        # Signs respect orientation u < v < w:
        delta_1[fi, e_uv] += 1.0
        delta_1[fi, e_vw] += 1.0
        delta_1[fi, e_uw] -= 1.0

    return delta_0, delta_1

# --------------------------------------------------------------------------
# Hodge-Helmholtz Decomposition on 1-Cochains
# --------------------------------------------------------------------------
def hodge_decomposition_1cochain(delta_0, delta_1, g):
    """
    Computes exact orthogonal decomposition:
        g = delta_0 x  +  h  +  delta_1^* psi
    where:
        delta_0 x in im(delta_0)
        h in ker(delta_1) cap ker(delta_0^*)  (Harmonic 1-cochain = H^1)
        delta_1^* psi in im(delta_1^*)
    """
    # 1. Gradient component: projection onto im(delta_0)
    x_hat, _, _, _ = np.linalg.lstsq(delta_0, g, rcond=None)
    grad_comp = delta_0 @ x_hat

    # 2. Remainder orthogonal to im(delta_0): w = g - delta_0 x
    w = g - grad_comp

    # 3. Curl / triadic frustration component: projection onto im(delta_1^*) = im(delta_1.T)
    if delta_1.shape[0] > 0:
        psi_hat, _, _, _ = np.linalg.lstsq(delta_1.T, w, rcond=None)
        curl_comp = delta_1.T @ psi_hat
    else:
        curl_comp = np.zeros_like(w)

    # 4. Harmonic component (cohomology class):
    h = w - curl_comp

    return grad_comp, h, curl_comp

def swarm_legibility_ratio(h, curl_comp):
    """
    L(g) = ||h||_2^2 / (||h||_2^2 + ||curl_comp||_2^2)
    L -> 1 : residual energy lies in the modeled harmonic component
    L -> 0 : residual energy lies in the modeled coexact component
    These components alone do not identify an external failure cause.
    """
    norm_h_sq = float(np.sum(h ** 2))
    norm_curl_sq = float(np.sum(curl_comp ** 2))
    denom = norm_h_sq + norm_curl_sq
    if denom < 1e-12:
        return 0.0, norm_h_sq, norm_curl_sq # perfectly consistent
    return norm_h_sq / denom, norm_h_sq, norm_curl_sq

# --------------------------------------------------------------------------
# CR-4 Finite Graph-Incidence Selection Heuristic
# --------------------------------------------------------------------------
def solve_cohomological_repair_greedy(delta_0, edges, g_known, costs=None, mode="sever", tolerance=TOL, score_tolerance=1e-12):
    """Run the CR-4 row-selection heuristic on a validated finite fixture.

    `sever` removes a selected observation row from the *modelled* least-squares
    completion. `reconcile` synthetically writes the selected observation to zero.
    Neither operation verifies an observation, grants authority, or reports an
    external effect. The returned dictionary exposes early stops and residuals so a
    caller cannot mistake a loop exit for completion.
    """
    matrix = np.asarray(delta_0, dtype=float)
    values = np.asarray(g_known, dtype=float).copy()
    if matrix.ndim != 2 or matrix.shape[0] != len(edges):
        raise ValueError("delta_0 must be a two-dimensional row-per-edge incidence matrix")
    if values.ndim != 1 or values.shape[0] != len(edges) or not np.isfinite(values).all():
        raise ValueError("g_known must be a finite value for every edge")
    if mode not in {"sever", "reconcile"}:
        raise ValueError("mode must be 'sever' or 'reconcile'")
    if (not np.isfinite(matrix).all() or not np.isscalar(tolerance)
            or not np.isscalar(score_tolerance) or not np.isfinite(tolerance)
            or not np.isfinite(score_tolerance) or tolerance < 0 or score_tolerance < 0):
        raise ValueError("matrix and tolerances must be finite; tolerances must be nonnegative")
    # The lemma is for a simple graph incidence, not an arbitrary rectangular map.
    normalized_edges = []
    seen = set()
    for row, edge in enumerate(edges):
        if not isinstance(edge, (tuple, list)) or len(edge) != 2:
            raise ValueError("each edge must contain two vertex indices")
        u, v = edge
        if any(isinstance(x, (bool, np.bool_)) or not isinstance(x, (int, np.integer))
               for x in (u, v)) or u == v or min(u, v) < 0 or max(u, v) >= matrix.shape[1]:
            raise ValueError("edge endpoints must be distinct in-range integer indices")
        key = tuple(sorted((int(u), int(v))))
        if key in seen:
            raise ValueError("duplicate or oppositely oriented copies of one edge are unsupported")
        seen.add(key)
        expected = np.zeros(matrix.shape[1])
        expected[u], expected[v] = 1.0, -1.0
        if not np.array_equal(matrix[row], expected):
            raise ValueError("matrix row must match its edge as x_u minus x_v")
        normalized_edges.append((int(u), int(v)))
    edges = normalized_edges
    if costs is None:
        costs = {edge: 1.0 for edge in edges}
    try:
        weight = np.asarray([float(costs[edge]) for edge in edges], dtype=float)
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("costs must provide one numeric cost for every edge") from exc
    if not np.isfinite(weight).all() or np.any(weight <= 0):
        raise ValueError("every cost must be finite and strictly positive")

    active = np.ones(len(edges), dtype=bool)
    selected = []
    trajectory = []

    def residual_for(indices):
        if len(indices) == 0:
            return np.array([], dtype=float)
        try:
            with np.errstate(over="raise", invalid="raise"):
                x_hat, _, _, _ = np.linalg.lstsq(matrix[indices, :], values[indices], rcond=None)
                result = values[indices] - matrix[indices, :] @ x_hat
        except (FloatingPointError, np.linalg.LinAlgError) as exc:
            raise ValueError("least-squares calculation exceeded its numerical domain") from exc
        if not np.isfinite(result).all():
            raise ValueError("least-squares residual is not finite")
        return result

    def residual_norm(residual):
        with np.errstate(over="ignore", invalid="ignore"):
            result = float(np.linalg.norm(residual))
        if not np.isfinite(result):
            raise ValueError("residual norm is not finite; rescale the fixture")
        return result

    indices = np.arange(len(edges))
    residual = residual_for(indices)
    remaining = residual_norm(residual)
    trajectory.append(remaining)
    status = "already-consistent" if remaining <= tolerance else None

    for _ in range(len(edges)):
        if status is not None:
            break
        active_indices = np.flatnonzero(active)
        if len(active_indices) == 0:
            status = "completed" if remaining <= tolerance else "round-limit"
            break
        if mode == "sever":
            active_residual = residual_for(active_indices)
            energies = np.zeros(len(edges), dtype=float)
            with np.errstate(over="ignore", invalid="ignore"):
                energies[active_indices] = active_residual ** 2
        else:
            full_residual = residual_for(indices)
            with np.errstate(over="ignore", invalid="ignore"):
                energies = full_residual ** 2
        ratios = np.zeros(len(edges), dtype=float)
        with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
            ratios[active] = energies[active] / weight[active]
        if not np.isfinite(ratios).all() or not np.isfinite(energies).all():
            raise ValueError("energy/cost score is not finite; rescale the fixture")
        if float(np.max(ratios)) <= score_tolerance:
            status = "early-stop-zero-score"
            break
        chosen_index = int(np.argmax(ratios))
        selected.append(edges[chosen_index])
        active[chosen_index] = False
        if mode == "reconcile":
            values[chosen_index] = 0.0
        if mode == "sever":
            residual = residual_for(np.flatnonzero(active))
        else:
            residual = residual_for(indices)
        remaining = residual_norm(residual)
        trajectory.append(remaining)
        if remaining <= tolerance:
            status = "completed"

    if status is None:
        status = "completed" if remaining <= tolerance else "round-limit"
    return {
        "mode": mode,
        "interventions": selected,
        "residualTrajectory": trajectory,
        "remainingResidual": remaining,
        "status": status,
        "eligibleEdges": [edge for edge, is_active in zip(edges, active) if is_active],
        "retainedEdges": [edge for edge, is_active in zip(edges, active)
                          if mode == "reconcile" or is_active],
        "modeledObservations": [float(value) for value, is_active in zip(values, active)
                                if mode == "reconcile" or is_active],
    }


def exact_integer_consistent(n_verts, edges, observations, removed):
    """Independent integer-potential predicate for the documented CR-4 fixture."""
    if len(edges) != len(observations) or any(
        isinstance(value, (bool, np.bool_)) or not isinstance(value, (int, np.integer))
        for value in observations
    ):
        raise ValueError("integer oracle requires one exact integer observation per edge")
    adjacency = [[] for _ in range(n_verts)]
    for index, ((u, v), value) in enumerate(zip(edges, observations)):
        if index in removed:
            continue
        adjacency[u].append((v, -int(value)))
        adjacency[v].append((u, int(value)))
    potential = {}
    for root in range(n_verts):
        if root in potential:
            continue
        potential[root] = 0
        todo = [root]
        while todo:
            vertex = todo.pop()
            for neighbor, delta in adjacency[vertex]:
                expected = potential[vertex] + delta
                if neighbor in potential:
                    if potential[neighbor] != expected:
                        return None
                else:
                    potential[neighbor] = expected
                    todo.append(neighbor)
    return [potential[index] for index in range(n_verts)]


# --------------------------------------------------------------------------
# Test Suites
# --------------------------------------------------------------------------
def test_simplicial_hodge_decomposition():
    print("=" * 74)
    print("[1] THEOREM CR-5 — Simplicial Hodge Decomposition on 2-Complexes")
    print("=" * 74)

    nV, edges, faces = make_triangulated_torus_or_cylinder()
    d0, d1 = build_simplicial_coboundaries(nV, edges, faces)

    # Structural check: np.dot(d1, d0) == 0 (boundary of boundary is zero)
    d1_d0 = float(np.linalg.norm(np.dot(d1, d0)))
    check(d1_d0 < TOL, "simplicial property holds: delta_1 @ delta_0 == 0 exactly")

    # Generate random 1-cochain
    rng = np.random.default_rng(SEED)
    g = rng.normal(0, 1, len(edges))

    grad, h, curl = hodge_decomposition_1cochain(d0, d1, g)

    # 1. Reconstitution
    reconstructed = grad + h + curl
    recon_err = float(np.linalg.norm(g - reconstructed))
    check(recon_err < TOL, f"exact reconstruction: ||g - (grad + h + curl)|| = {recon_err:.2e} < 1e-9")

    # 2. Pairwise Orthogonality
    dot_grad_h = abs(float(np.dot(grad, h)))
    dot_grad_curl = abs(float(np.dot(grad, curl)))
    dot_h_curl = abs(float(np.dot(h, curl)))
    check(dot_grad_h < TOL and dot_grad_curl < TOL and dot_h_curl < TOL,
          f"exact mutual orthogonality: <grad, h>={dot_grad_h:.1e}, <grad, curl>={dot_grad_curl:.1e}, <h, curl>={dot_h_curl:.1e}")

    # 3. Harmonic properties: d1 h == 0 and d0.T h == 0
    d1_h = float(np.linalg.norm(np.dot(d1, h)))
    d0T_h = float(np.linalg.norm(np.dot(d0.T, h)))
    check(d1_h < TOL and d0T_h < TOL,
          f"h is in ker(delta_1) cap ker(delta_0^T): ||delta_1 h||={d1_h:.1e}, ||delta_0^T h||={d0T_h:.1e}")

def test_swarm_legibility_ratio_scenarios():
    print("\n" + "=" * 74)
    print("[2] THEOREM CR-5 — Swarm Legibility Ratio L(g): Macro vs Micro")
    print("=" * 74)

    # --- Scenario A: Micro-Contract / Triadic Frustration ---
    # Producer (0), Dissenter (1), Manager (2) form a review triad.
    # An internal lie is injected on edge (0,1).
    nV, edges, faces = make_triadic_review_swarm()
    d0, d1 = build_simplicial_coboundaries(nV, edges, faces)

    # Honest baseline: g = delta_0 x
    x_true = np.array([1.0, 2.0, 3.0, 4.0])
    g_triad_lie = d0 @ x_true
    # Producer and Dissenter disagree by +5.0 (breaching the 3-party contract)
    e01_idx = edges.index(orient_edge((0, 1)))
    g_triad_lie[e01_idx] += 5.0

    grad_A, h_A, curl_A = hodge_decomposition_1cochain(d0, d1, g_triad_lie)
    L_A, norm_h_A, norm_curl_A = swarm_legibility_ratio(h_A, curl_A)
    print(f"  Scenario A (Triadic Contract Breach):")
    print(f"    ||h||^2 = {norm_h_A:.4f},  ||curl||^2 = {norm_curl_A:.4f}")
    print(f"    Swarm Legibility Ratio L(g) = {L_A:.4f}  (expected ~0.0: micro failure)")
    check(L_A < 0.01 and norm_curl_A > 1.0,
          "Scenario A correctly flagged as LOCAL TRIADIC FRUSTRATION (L ~ 0)")

    # --- Scenario B: Macro-Topological Partition Cavity ---
    # Cylindrical swarm with filled triangles, but an uncontractible cycle winds around.
    nV_B, edges_B, faces_B = make_triangulated_torus_or_cylinder()
    d0_B, d1_B = build_simplicial_coboundaries(nV_B, edges_B, faces_B)

    # Invert orientation around the cylinder hole (pure 1-cocycle)
    # This is in ker(delta_1) because every local triangle sums to 0,
    # but not in im(delta_0) because the loop sum is non-zero!
    # Let's find an exact harmonic 1-cochain
    U, S, Vt = np.linalg.svd(d0_B, full_matrices=True)
    rank0 = int((S > 1e-9).sum())
    # Nullspace of d0_B.T
    coker_d0 = U[:, rank0:]
    # Project into ker(d1_B)
    Ud1, Sd1, Vtd1 = np.linalg.svd(d1_B, full_matrices=True)
    rank1 = int((Sd1 > 1e-9).sum())
    ker_d1 = Vtd1[rank1:, :].T # basis of ker(d1)

    # Overlap space = ker(d1) cap coker(d0)
    H_proj = np.dot(ker_d1, np.dot(ker_d1.T, coker_d0))
    Uh, Sh, _ = np.linalg.svd(H_proj, full_matrices=False)
    pure_harmonic = Uh[:, 0] * 4.0 # a non-trivial macro cavity

    g_macro = d0_B @ np.zeros(nV_B) + pure_harmonic
    grad_B, h_B, curl_B = hodge_decomposition_1cochain(d0_B, d1_B, g_macro)
    L_B, norm_h_B, norm_curl_B = swarm_legibility_ratio(h_B, curl_B)
    print(f"  Scenario B (Macro-Topological Partition Cavity):")
    print(f"    ||h||^2 = {norm_h_B:.4f},  ||curl||^2 = {norm_curl_B:.4f}")
    print(f"    Swarm Legibility Ratio L(g) = {L_B:.4f}  (expected 1.0: macro partition)")
    check(L_B > 0.99 and norm_h_B > 1.0,
          "Scenario B correctly flagged as MACRO-TOPOLOGICAL CAVITY (L ~ 1)")

def test_cr4_single_cycle_fixture():
    print("\n" + "=" * 74)
    print("[3] CR-4 — positive single-cycle sever fixture (not an optimizer proof)")
    print("=" * 74)
    n = 12
    k = n // 2
    edges = [(i, i + 1) for i in range(k - 1)]
    edges += [(k + i, k + i + 1) for i in range(k - 1)]
    edges += [(0, k), (k - 1, n - 1)]
    edges = sorted(tuple(sorted(edge)) for edge in edges)
    delta_0, _ = build_simplicial_coboundaries(n, edges, [])
    observations = np.zeros(len(edges))
    observations[edges.index(orient_edge((0, 6)))] = 4.0
    costs = {edge: 5.0 for edge in edges}
    costs[orient_edge((0, 6))] = 1.0
    result = solve_cohomological_repair_greedy(delta_0, edges, observations, costs, mode="sever")
    print(f"  selected rows: {result['interventions']}")
    print(f"  residual trajectory: {[round(value, 4) for value in result['residualTrajectory']]}")
    check(result['status'] == "completed" and result['remainingResidual'] < TOL,
          "single-cycle sever fixture reaches a zero retained-data residual")
    check(result['interventions'] == [orient_edge((0, 6))],
          "fixture selects its supplied low-cost row; no global inference follows")


def test_cr4_counterexamples():
    print("\n" + "=" * 74)
    print("[4] CR-4 — bounded falsifiers of global optimality and reconcile round bound")
    print("=" * 74)
    edges = [(0, 1), (0, 2), (1, 2), (1, 3), (2, 3)]
    observations = np.array([-1, -3, -3, -2, 0], dtype=float)
    costs = {edge: cost for edge, cost in zip(edges, [6, 6, 5, 9, 1])}
    delta_0, _ = build_simplicial_coboundaries(4, edges, [])
    greedy = solve_cohomological_repair_greedy(delta_0, edges, observations, costs, mode="sever")
    candidates = []
    for mask in range(1 << len(edges)):
        removed = {index for index in range(len(edges)) if mask & (1 << index)}
        potential = exact_integer_consistent(4, edges, observations.astype(int), removed)
        if potential is not None:
            candidates.append((sum(costs[edges[index]] for index in removed), removed, potential))
    optimum = min(candidates, key=lambda item: item[0])
    greedy_cost = sum(costs[edge] for edge in greedy['interventions'])
    print(f"  sever heuristic cost={greedy_cost}, exact deletion cost={optimum[0]}, potential={optimum[2]}")
    check(greedy_cost == 6 and optimum[0] == 5 and optimum[2] == [0, 1, 3, 3],
          "five-edge fixture refutes a global minimum-cost claim")

    triangle = [(0, 1), (0, 2), (1, 2)]
    triangle_delta, _ = build_simplicial_coboundaries(3, triangle, [])
    reconcile = solve_cohomological_repair_greedy(
        triangle_delta, triangle, np.array([2, 2, 1], dtype=float),
        {triangle[0]: 1, triangle[1]: 2, triangle[2]: 3}, mode="reconcile")
    print(f"  reconcile rounds={len(reconcile['interventions'])}, beta_1=1, trajectory={reconcile['residualTrajectory']}")
    check(len(reconcile['interventions']) == 3 and reconcile['status'] == "completed",
          "triangle fixture refutes a blanket reconcile-mode beta_1 round bound")


def run_mutation_suite():
    print("\n" + "=" * 74)
    print("[4] FALSIFICATION-FIRST MUTATION SUITE")
    print("=" * 74)

    nV, edges, faces = make_triangulated_torus_or_cylinder()
    d0, d1 = build_simplicial_coboundaries(nV, edges, faces)

    # Mut-1: Local triadic breach must make delta_1 g != 0 and L -> 0
    g_mut1 = np.zeros(len(edges))
    g_mut1[0] = 3.0 # perturb edge 0
    _, h1, curl1 = hodge_decomposition_1cochain(d0, d1, g_mut1)
    L1, _, _ = swarm_legibility_ratio(h1, curl1)
    check(L1 < 0.2, f"Mut-1 CAUGHT: triadic perturbation gave L = {L1:.3f} < 0.2")

    # Mut-2: two triangles share one vertex. A lie in the first triangle
    # has zero residual on the second; changing its data cannot erase the first.
    # The old cylindrical fixture had no off-support edge and raised StopIteration.
    mutant_edges = [(0, 1), (0, 2), (1, 2), (2, 3), (2, 4), (3, 4)]
    mutant_matrix, _ = build_simplicial_coboundaries(5, mutant_edges, [])
    g_mut2 = np.zeros(len(mutant_edges))
    g_mut2[0] = 4.0
    xhat, _, _, _ = np.linalg.lstsq(mutant_matrix, g_mut2, rcond=None)
    initial_residual = g_mut2 - mutant_matrix @ xhat
    off_support = mutant_edges.index((2, 3))
    g_dummy_repaired = g_mut2.copy()
    g_dummy_repaired[off_support] = 99.0
    xhat2, _, _, _ = np.linalg.lstsq(mutant_matrix, g_dummy_repaired, rcond=None)
    new_r = float(np.linalg.norm(g_dummy_repaired - mutant_matrix @ xhat2))
    check(abs(initial_residual[off_support]) < TOL
          and np.linalg.norm(initial_residual) > TOL and new_r > TOL,
          f"Mut-2 CAUGHT: initially off-support edge {mutant_edges[off_support]} was perturbed and residual remains {new_r:.3f} > 0")

def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="Bounded Harbor R6 fixture checks")
    parser.add_argument("--cr4-fixtures", action="store_true", help="run only the small CR-4 fixtures")
    args = parser.parse_args(argv)
    FAILURES.clear()
    print("SHEAF REPAIR AND 2-COMPLEX FIXTURE CHECKS")
    print(f"Seed: {SEED} | Stalk dim: {D}")
    if not args.cr4_fixtures:
        test_simplicial_hodge_decomposition()
        test_swarm_legibility_ratio_scenarios()
    test_cr4_single_cycle_fixture()
    test_cr4_counterexamples()
    if not args.cr4_fixtures:
        run_mutation_suite()
    print("\n" + "=" * 74)
    if FAILURES:
        print(f"RESULT: {len(FAILURES)} FAILED FIXTURE CHECK(S):")
        for failure in FAILURES:
            print("  -", failure)
        return 1
    print("RESULT: fixture checks passed; no global CR-4 optimizer, authority, or field-effect claim follows.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
