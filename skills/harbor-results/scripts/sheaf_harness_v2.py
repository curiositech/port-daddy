#!/usr/bin/env python3
"""
SHEAF STATISTICAL HARNESS v2 — rebuild of the broken predecessor
(docs/harbor-research/wrong-turns/sheaf_verdict.py), per HANDOFF §3.3 (wave W8).

AUTOPSY OF THE PREDECESSOR (why v1 produced signal ≡ 0 / nonsense):

 D1 — restriction maps killed coker. Per-edge random orthonormal S×D
      projections make the coboundary δ generically SURJECTIVE once edges are
      plentiful ⇒ coker(δ)=0 ⇒ harmonic space empty ⇒ cohomology signal ≡ 0
      regardless of the data. FIX: restrictions are COORDINATE-SUBSET
      selections (shared-prefix coordinates per edge; coordinate 0 shared on
      every edge). The complex then decomposes per coordinate and
      coker(δ) ≅ ⊕_c H¹(G_c) — cycle space ⊗ shared coords — so it carries
      the cocycle constraints. A structural self-check below computes
      dim coker(δ) and REFUSES to run if it falls below β₁(G).

 D2 — masking applied inconsistently. v1 computed signals from the FULL
      disagreement cochain g, with "hidden" edges' values silently included.
      FIX: the observed cochain contains only edges whose data the analyst
      actually has; truly severed edges contribute NO data and enter the
      algebra as free variables. A masking self-check (mutation Mb) verifies
      that a lie across a severed edge is invisible.

 D3 — wrong detector under partition. FIX: the correct statistic is the
      least-squares COMPLETION residual
          r = min over (x, free blocks) ‖ g_known − (δx)|_known ‖
      i.e. the norm of the projection of the known-edge vector onto the
      orthogonal complement of {(δx)|_known}. r > 0 ⟺ a cocycle obstruction
      is visible from the observed edges alone. On a cut edge the free block
      absorbs everything ⇒ r = 0 always — the honest boundary now falls out
      of the algebra instead of being asserted.

VISIBILITY SEMANTICS (the distinction the wrong turn conflated):
 every edge is exactly one of
   COMPARED — endpoints ran the direct check; the pairwise baseline sees it;
              g_e is known.
   RELAYED  — both endpoints' signed reports reached the analyst by gossip
              around the graph, but the direct check never ran (partition):
              pairwise is blind; g_e is known to the global detector.
   SEVERED  — no data at all: a free block in the completion.
 sheaf_mechanism_proof.py's "uncompared" edge is RELAYED (its harmonic
 projection uses g on that edge); HANDOFF D3's free blocks are SEVERED edges.
 With no severed edges the completion residual reduces exactly to the
 harmonic-projection norm of the mechanism proof (C₆: 1.225, P₆: 0.000 —
 reproduced below by the SAME general detector, no special-casing). A lie
 across a SEVERED cycle edge is provably dark (g_known ≡ 0 ⇒ r = 0): the
 predecessor "detected" it only by reading data it claimed not to have (D2).

PRE-REGISTERED GATES (falsification-first obligation 2 — file pass or CUT;
 operationalizations fixed BEFORE the run):
 COMMIT requires BOTH
  (i)  cohomology-only detections at a nontrivial rate (≥ 10% of trials) in
       partition-on-a-cycle: scenario a1 — split-view equivocator across a
       RELAYED bridge that lies on a cycle; AND
  (ii) residual ≈ 0 (max r < 1e-9) on cut edges (scenario b, severed AND
       relayed arms), and full-visibility detections redundant with pairwise
       (scenario c: cohomology-only = 0).
 CUT if every residual detection across all scenarios is also caught by
 pairwise on compared edges.
 Counting caveat (harbor-results lesson #2): topological β₁ is netted out —
 the detection statistic is the DATA residual (honest data ⇒ r ≡ 0 exactly),
 never dim H¹ of the abstract sheaf; the structural coker dimension is
 printed separately per scenario so no counting claim conflates the two.

MUTATION SUITE (a green harness is unvalidated until seeded bugs turn it red):
 Ma — reintroduce D1 (random orthonormal restrictions): the structural
      self-check must detect coker collapse and refuse.
 Mb — reintroduce D2 (severed edges' g included): the masking self-check must
      flag (severed-arm detection fires where the contract requires silence,
      and its numbers become bit-identical to full visibility).
 Mc — no-equivocator control: ~0 detections on both detectors.

Deps: numpy, networkx. Program seed 20260816. 200 trials per scenario arm.
"""
import sys
import numpy as np

try:
    import networkx as nx
except ImportError:
    print("networkx required: pip install networkx")
    sys.exit(2)

SEED = 20260816
D = 5            # stalk dim; coords 0..3 shareable, coord 4 always private
SIGMA_EQ = 2.0   # equivocation offset scale
TRIALS = 200
TOL_DETECT = 1e-8
TOL_SILENT = 1e-9

# --------------------------------------------------------------------------
# graphs (edges as sorted tuples; orientation (u,v), u < v: (δx)_e = x_u - x_v)
# --------------------------------------------------------------------------
def two_path(n=12):
    """Two path-clusters joined by TWO bridges -> the bridges lie on a cycle."""
    k = n // 2
    E = [(i, i + 1) for i in range(k - 1)]
    E += [(k + i, k + i + 1) for i in range(k - 1)]
    E += [(0, k), (k - 1, n - 1)]
    return n, sorted(tuple(sorted(e)) for e in E)

def single_bridge(n=12):
    """Two cliques joined by ONE bridge -> the bridge is a cut edge."""
    k = n // 2
    E = [(i, j) for i in range(k) for j in range(i + 1, k)]
    E += [(a, b) for a in range(k, n) for b in range(a + 1, n)]
    E += [(k - 1, k)]
    return n, sorted(tuple(sorted(e)) for e in E)

def expander(n=12, seed=0):
    while True:
        G = nx.random_regular_graph(3, n, seed=seed)
        if nx.is_connected(G):
            return n, sorted(tuple(sorted(e)) for e in G.edges())
        seed += 100003

def cycle_edges(n):
    return n, sorted(tuple(sorted((i, (i + 1) % n))) for i in range(n))

def path_edges(n):
    return n, [(i, i + 1) for i in range(n - 1)]

def beta1(nverts, edges):
    parent = list(range(nverts))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    comps = nverts
    for (u, v) in edges:
        ru, rv = find(u), find(v)
        if ru != rv:
            parent[ru] = rv
            comps -= 1
    return len(edges) - nverts + comps

# --------------------------------------------------------------------------
# sheaf structure: coordinate-subset (shared-prefix) restrictions  [D1 fix]
# --------------------------------------------------------------------------
def prefix_restrictions(edges, sizes, dim):
    return {e: np.eye(sizes[e], dim) for e in edges}

def coboundary(nverts, edges, P, dim):
    rows = sum(P[e].shape[0] for e in edges)
    delta = np.zeros((rows, nverts * dim))
    slices = {}
    r0 = 0
    for e in edges:
        u, v = e
        s = P[e].shape[0]
        delta[r0:r0 + s, u * dim:(u + 1) * dim] += P[e]
        delta[r0:r0 + s, v * dim:(v + 1) * dim] -= P[e]
        slices[e] = (r0, r0 + s)
        r0 += s
    return delta, slices

def structural_selfcheck(nverts, edges, P, dim, sizes=None, label="", refuse=True):
    """Anti-D1 gate: dim coker(δ) must be >= β₁(G) (coordinate 0 is shared on
    every edge, so every graph cycle must carry at least one cocycle
    constraint). Random orthonormal restrictions collapse coker to 0 on a
    cyclic graph -> REFUSE. For prefix restrictions, also verify the exact
    decomposition dim coker = Σ_c β₁(G_c)."""
    delta, _ = coboundary(nverts, edges, P, dim)
    rank = np.linalg.matrix_rank(delta, tol=1e-9)
    coker = delta.shape[0] - rank
    b1 = beta1(nverts, edges)
    ok = (coker >= b1)
    decomp = None
    if sizes is not None:
        decomp = 0
        for c in range(dim):
            Ec = [e for e in edges if sizes[e] > c]
            decomp += beta1(nverts, Ec)
        assert coker == decomp, (
            f"prefix-restriction decomposition violated: coker={coker} "
            f"!= sum_c beta1(G_c)={decomp}")
    if not ok and refuse:
        raise RuntimeError(
            f"STRUCTURAL SELF-CHECK REFUSAL [{label}]: dim coker(delta)={coker}"
            f" < beta1(G)={b1} — restriction maps have collapsed the harmonic"
            " space (defect D1). Harness refuses to produce a signal that is"
            " identically zero by construction.")
    return ok, coker, b1, decomp

# --------------------------------------------------------------------------
# data generation
# --------------------------------------------------------------------------
def honest_states(nverts, rng, dim):
    """Shared truth on shareable coords; last coord private per vertex (never
    compared with prefix sizes <= dim-1) — unshared coords must not leak."""
    x = np.tile(rng.normal(0, 1, dim), (nverts, 1))
    if dim > 1:
        x[:, dim - 1] = rng.normal(0, 1, nverts)
    return x

def observed_cochain(edges, P, x, equivocator, offsets):
    """g_e computed from the endpoints' REPORTS on the edge's shared readout.
    The equivocator's report toward neighbor w carries its per-neighbor
    offset o_{q,w} (offsets differ per neighbor -> they cannot cancel around
    a cycle through q)."""
    g = {}
    for e in edges:
        u, v = e
        ru = P[e] @ x[u]
        rv = P[e] @ x[v]
        if u == equivocator and v in offsets:
            ru = P[e] @ (x[u] + offsets[v])
        if v == equivocator and u in offsets:
            rv = P[e] @ (x[v] + offsets[u])
        g[e] = ru - rv
    return g

# --------------------------------------------------------------------------
# detectors
# --------------------------------------------------------------------------
def completion_residual(delta, slices, edges, status, g):
    """[D2 fix + D3 fix] Least-squares completion residual over the KNOWN
    rows only (COMPARED + RELAYED). SEVERED blocks are free variables; since
    each severed block is wholly unconstrained, minimizing over it is exactly
    dropping its rows. Returns (r, per-known-edge residual norms)."""
    known = [e for e in edges if status[e] in ("C", "R")]
    if not known:
        return 0.0, {}
    rows = np.concatenate([np.arange(*slices[e]) for e in known])
    A = delta[rows, :]
    b = np.concatenate([g[e] for e in known])
    xhat, _, _, _ = np.linalg.lstsq(A, b, rcond=None)
    resid = b - A @ xhat
    r = float(np.linalg.norm(resid))
    per_edge, i0 = {}, 0
    for e in known:
        s = slices[e][1] - slices[e][0]
        per_edge[e] = float(np.linalg.norm(resid[i0:i0 + s]))
        i0 += s
    return r, per_edge

def pairwise_detect(edges, status, g, tol=TOL_SILENT):
    """Baseline: fires iff some COMPARED edge shows a nonzero disagreement."""
    return any(status[e] == "C" and np.linalg.norm(g[e]) > tol for e in edges)

def bucket(coh, pw):
    return ("both" if coh and pw else
            "coh_only" if coh else
            "pw_only" if pw else "neither")

# --------------------------------------------------------------------------
# trial machinery
# --------------------------------------------------------------------------
def run_trial(nverts, edges, status, equivocator, offsets, rng,
              dim=D, sizes=None, want_localization=False):
    if sizes is None:
        sizes = {e: int(rng.integers(2, 5)) for e in edges}
    P = prefix_restrictions(edges, sizes, dim)
    delta, slices = coboundary(nverts, edges, P, dim)
    x = honest_states(nverts, rng, dim)
    g = observed_cochain(edges, P, x, equivocator, offsets)
    r, per_edge = completion_residual(delta, slices, edges, status, g)
    pw = pairwise_detect(edges, status, g)
    coh = r > TOL_DETECT
    loc = None
    if want_localization and coh and per_edge:
        top = max(per_edge, key=per_edge.get)
        Gk = nx.Graph([e for e in edges if status[e] in ("C", "R")])
        on_cycle = top not in set(map(tuple, map(sorted, nx.bridges(Gk)))) \
            if Gk.number_of_edges() else False
        try:
            dist = min(nx.shortest_path_length(Gk, top[0], equivocator),
                       nx.shortest_path_length(Gk, top[1], equivocator))
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            dist = -1
        loc = (top, on_cycle, dist)
    return dict(r=r, coh=coh, pw=pw, bucket=bucket(coh, pw), loc=loc)

def offsets_for(style, neighbors, targets, rng):
    """Per-neighbor offset vectors. 'split': lie only toward `targets`
    (split-view across the partition). 'indis': distinct lie toward every
    neighbor."""
    if style == "split":
        return {w: rng.normal(0, SIGMA_EQ, D) for w in targets}
    return {w: rng.normal(0, SIGMA_EQ, D) for w in neighbors}

def tally(results):
    counts = {k: 0 for k in ("coh_only", "both", "pw_only", "neither")}
    rs = []
    for res in results:
        counts[res["bucket"]] += 1
        if res["coh"]:
            rs.append(res["r"])
    mean_r = float(np.mean(rs)) if rs else 0.0
    max_r = max((res["r"] for res in results), default=0.0)
    return counts, mean_r, max_r

def print_table(title, rows):
    print(f"\n  {title}")
    hdr = f"    {'arm':<58} {'coh_only':>8} {'both':>6} {'pw_only':>8} {'neither':>8} {'mean r|det':>11} {'max r':>10}"
    print(hdr)
    print("    " + "-" * (len(hdr) - 4))
    for name, (counts, mean_r, max_r) in rows:
        print(f"    {name:<58} {counts['coh_only']:>8} {counts['both']:>6} "
              f"{counts['pw_only']:>8} {counts['neither']:>8} "
              f"{mean_r:>11.3f} {max_r:>10.2e}")

# --------------------------------------------------------------------------
# d=1 reproduction of sheaf_mechanism_proof.py — SAME detector, no special case
# --------------------------------------------------------------------------
def reproduce_mechanism():
    print("=" * 74)
    print("[0] d=1 REPRODUCTION of sheaf_mechanism_proof.py (C6 vs P6)")
    print("=" * 74)
    # C6, scalar stalks, lie 3.0 across edge (2,3), that edge RELAYED
    n, edges = cycle_edges(6)
    sizes = {e: 1 for e in edges}
    P = prefix_restrictions(edges, sizes, 1)
    delta, slices = coboundary(n, edges, P, 1)
    x = np.zeros((n, 1))
    g = observed_cochain(edges, P, x, 2, {3: np.array([3.0])})
    status = {e: "C" for e in edges}
    status[(2, 3)] = "R"
    r_cyc, _ = completion_residual(delta, slices, edges, status, g)
    pw_cyc = pairwise_detect(edges, status, g)
    print(f"  C6, lie 3.0 on RELAYED cycle edge (2,3): r={r_cyc:.3f} "
          f"pairwise={pw_cyc}  (mechanism proof: 1.225, pairwise blind)")
    assert abs(r_cyc - 3.0 / np.sqrt(6)) < 1e-9 and not pw_cyc, \
        "C6 mechanism NOT reproduced"
    # P6, same lie on the bridge edge (2,3), relayed and severed
    n, edges = path_edges(6)
    sizes = {e: 1 for e in edges}
    P = prefix_restrictions(edges, sizes, 1)
    delta, slices = coboundary(n, edges, P, 1)
    g = observed_cochain(edges, P, np.zeros((n, 1)), 2, {3: np.array([3.0])})
    for mask, lab in (("R", "RELAYED"), ("S", "SEVERED")):
        status = {e: "C" for e in edges}
        status[(2, 3)] = mask
        r_cut, _ = completion_residual(delta, slices, edges, status, g)
        pw_cut = pairwise_detect(edges, status, g)
        print(f"  P6, lie 3.0 on {lab:>7} cut edge (2,3):  r={r_cut:.3f} "
              f"pairwise={pw_cut}  (mechanism proof: 0.000)")
        assert r_cut < TOL_SILENT and not pw_cut, "P6 boundary NOT reproduced"
    print("  -> mechanism reproduced by the general completion-residual "
          "detector: cycle-signal 1.225 > 0, bridge 0.000  [PASS]")

# --------------------------------------------------------------------------
# scenarios
# --------------------------------------------------------------------------
def scenario_two_path():
    n, edges = two_path(12)
    bridge = (0, 6)
    neighbors_q = [1, 6]
    arms = [
        ("a1 split-view lie across RELAYED bridge on the cycle", "split", "R"),
        ("a2 same lie, bridge SEVERED (no data: must be dark)", "split", "S"),
        ("a3 indiscriminate equivocator, bridge RELAYED", "indis", "R"),
    ]
    rows, per_arm = [], {}
    loc_stats = []
    for aid, (name, style, mask) in enumerate(arms):
        results = []
        for t in range(TRIALS):
            rng = np.random.default_rng([SEED, 1, aid, t])
            offsets = offsets_for(style, neighbors_q, [6], rng)
            status = {e: "C" for e in edges}
            status[bridge] = mask
            res = run_trial(n, edges, status, 0, offsets, rng,
                            want_localization=(aid == 0))
            results.append(res)
            if res["loc"]:
                loc_stats.append(res["loc"])
        rows.append((name, tally(results)))
        per_arm[name.split()[0]] = results
    print_table("scenario (a) two_path: two bridges, one uncompared "
                "(partition ON A CYCLE), equivocator at bridge endpoint",
                rows)
    if loc_stats:
        on_cyc = sum(1 for (_, oc, _) in loc_stats if oc)
        dists = [d for (_, _, d) in loc_stats if d >= 0]
        print(f"    localization (a1): max-residual edge on a known-graph "
              f"cycle {on_cyc}/{len(loc_stats)}; mean hops to equivocator "
              f"{np.mean(dists):.2f}" if dists else "")
    return per_arm

def scenario_single_bridge():
    n, edges = single_bridge(12)
    bridge = (5, 6)
    neighbors_q = [0, 1, 2, 3, 4, 6]
    arms = [
        ("b1 split-view lie across SEVERED cut bridge", "split", "S"),
        ("b2 split-view lie across RELAYED cut bridge", "split", "R"),
        ("b3 liveness control: indiscriminate lies, bridge SEVERED", "indis", "S"),
    ]
    rows, per_arm = [], {}
    for aid, (name, style, mask) in enumerate(arms):
        results = []
        for t in range(TRIALS):
            rng = np.random.default_rng([SEED, 2, aid, t])
            offsets = offsets_for(style, neighbors_q, [6], rng)
            status = {e: "C" for e in edges}
            status[bridge] = mask
            results.append(run_trial(n, edges, status, 5, offsets, rng))
        rows.append((name, tally(results)))
        per_arm[name.split()[0]] = results
    print_table("scenario (b) single_bridge: uncompared CUT edge "
                "(the honest boundary — must stay silent)", rows)
    return per_arm

def scenario_full_visibility():
    results = []
    for t in range(TRIALS):
        rng = np.random.default_rng([SEED, 3, 0, t])
        n, edges = expander(12, seed=int(rng.integers(1_000_000_000)))
        q = int(rng.integers(n))
        nbrs = sorted({v for e in edges for v in e if q in e and v != q})
        offsets = offsets_for("indis", nbrs, nbrs, rng)
        status = {e: "C" for e in edges}
        results.append(run_trial(n, edges, status, q, offsets, rng))
    rows = [("c  full visibility, indiscriminate equivocator", tally(results))]
    print_table("scenario (c) full visibility (all edges compared): "
                "cohomology must be redundant", rows)
    return {"c": results}

def scenario_expander_partial():
    arms = [
        ("d1 indiscriminate equivocator, random uncompared edges", "indis"),
        ("d2 partition-straddling: lies only across uncompared edges", "split"),
    ]
    rows, per_arm = [], {}
    for aid, (name, style) in enumerate(arms):
        results = []
        for t in range(TRIALS):
            rng = np.random.default_rng([SEED, 4, aid, t])
            n, edges = expander(12, seed=int(rng.integers(1_000_000_000)))
            m = len(edges)
            picks = rng.choice(m, size=6, replace=False)
            status = {e: "C" for e in edges}
            for i in picks[:3]:
                status[edges[i]] = "S"
            for i in picks[3:]:
                status[edges[i]] = "R"
            if style == "indis":
                q = int(rng.integers(n))
                nbrs = sorted({v for e in edges for v in e
                               if q in e and v != q})
                offsets = offsets_for("indis", nbrs, nbrs, rng)
            else:
                straddlers = sorted({v for e in edges if status[e] != "C"
                                     for v in e})
                q = int(rng.choice(straddlers))
                targets = sorted({v for e in edges for v in e
                                  if q in e and v != q
                                  and status[e] != "C"})
                offsets = offsets_for("split", None, targets, rng)
            results.append(run_trial(n, edges, status, q, offsets, rng))
        rows.append((name, tally(results)))
        per_arm[name.split()[0]] = results
    print_table("scenario (d) 3-regular expander with random uncompared "
                "edges (3 severed + 3 relayed per trial)", rows)
    return per_arm

# --------------------------------------------------------------------------
# structural / beta1 report per scenario topology
# --------------------------------------------------------------------------
def beta1_report():
    print("\n  beta1 netting (lesson #2): the detection statistic is the DATA")
    print("  residual (honest data -> r = 0 exactly); the sheaf's structural")
    print("  coker dim below is topology (x) shared-coords and is NEVER used")
    print("  as a detection signal or an equivocator count:")
    rng = np.random.default_rng([SEED, 99])
    for name, (n, edges) in (("two_path", two_path(12)),
                             ("single_bridge", single_bridge(12)),
                             ("expander(seed 0)", expander(12, seed=0))):
        sizes = {e: int(rng.integers(2, 5)) for e in edges}
        P = prefix_restrictions(edges, sizes, D)
        ok, coker, b1, decomp = structural_selfcheck(
            n, edges, P, D, sizes=sizes, label=name)
        print(f"    {name:<18} beta1(G)={b1:<3} dim coker(delta)={coker:<3} "
              f"(= sum_c beta1(G_c)={decomp})  self-check "
              f"{'OK' if ok else 'REFUSED'}")

# --------------------------------------------------------------------------
# mutation suite
# --------------------------------------------------------------------------
def mutation_Ma():
    """Reintroduce D1: random orthonormal S x D restrictions. The structural
    self-check must detect coker collapse and refuse to run."""
    rng = np.random.default_rng([SEED, 5, 0])
    n, edges = expander(12, seed=7)
    S = 3
    P = {}
    for e in edges:
        Q, _ = np.linalg.qr(rng.normal(0, 1, (D, S)))
        P[e] = Q[:, :S].T
    ok, coker, b1, _ = structural_selfcheck(
        n, edges, P, D, label="Ma: random orthonormal", refuse=False)
    if ok:
        return False, "self-check FAILED to refuse (mutation survived)"
    return True, (f"self-check refused: dim coker(delta)={coker} < "
                  f"beta1(G)={b1} — coker collapse (D1) caught")

def mutation_Mb():
    """Reintroduce D2: include severed edges' g as known rows. The masking
    self-check must flag: the severed-cycle arm fires where the contract
    requires darkness, and its numbers become identical to full visibility."""
    n, edges = two_path(12)
    bridge = (0, 6)
    rng = np.random.default_rng([SEED, 5, 1])
    sizes = {e: int(rng.integers(2, 5)) for e in edges}
    P = prefix_restrictions(edges, sizes, D)
    delta, slices = coboundary(n, edges, P, D)
    x = honest_states(n, rng, D)
    g = observed_cochain(edges, P, x, 0, {6: rng.normal(0, SIGMA_EQ, D)})
    status = {e: "C" for e in edges}
    status[bridge] = "S"
    r_honest, _ = completion_residual(delta, slices, edges, status, g)
    # D2 mutant: severed rows silently included (mask ignored)
    status_mut = {e: "C" for e in edges}
    status_mut[bridge] = "R"   # "known" despite claiming severed
    r_mut, _ = completion_residual(delta, slices, edges, status_mut, g)
    r_full, _ = completion_residual(delta, slices, edges,
                                    {e: "C" for e in edges}, g)
    flagged = (r_honest < TOL_SILENT and r_mut > TOL_DETECT
               and abs(r_mut - r_full) < 1e-12)
    detail = (f"honest severed r={r_honest:.2e} (dark, as contracted); "
              f"D2-mutant r={r_mut:.3f} > 0 on data it claims not to have, "
              f"and == full-visibility r={r_full:.3f} (masking is a no-op)")
    return flagged, detail

def mutation_Mc():
    """No-equivocator control: both detectors must stay at ~0 detections."""
    total_coh = total_pw = 0
    for t in range(TRIALS):
        rng = np.random.default_rng([SEED, 5, 2, t])
        n, edges = expander(12, seed=int(rng.integers(1_000_000_000)))
        status = {e: "C" for e in edges}
        res = run_trial(n, edges, status, equivocator=-1, offsets={}, rng=rng)
        total_coh += res["coh"]
        total_pw += res["pw"]
    ok = (total_coh == 0 and total_pw == 0)
    return ok, f"coh detections {total_coh}/{TRIALS}, pairwise {total_pw}/{TRIALS}"

# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def main():
    np.set_printoptions(precision=3, suppress=True)
    print("SHEAF STATISTICAL HARNESS v2   seed", SEED,
          f"  stalk dim D={D}  trials/arm={TRIALS}")
    reproduce_mechanism()

    print("\n" + "=" * 74)
    print("[1] STRUCTURAL SELF-CHECK (anti-D1) + beta1 netting")
    print("=" * 74)
    beta1_report()

    print("\n" + "=" * 74)
    print("[2] STATISTICAL SCENARIOS (200 trials/arm)")
    print("=" * 74)
    a = scenario_two_path()
    b = scenario_single_bridge()
    c = scenario_full_visibility()
    d = scenario_expander_partial()

    print("\n" + "=" * 74)
    print("[3] PRE-REGISTERED GATES")
    print("=" * 74)
    a1 = a["a1"]
    coh_only_a1 = sum(1 for r in a1 if r["bucket"] == "coh_only")
    gate_i = coh_only_a1 >= 0.10 * TRIALS
    print(f"  (i)  cohomology-only in partition-on-a-cycle (a1): "
          f"{coh_only_a1}/{TRIALS}  (need >= {int(0.10 * TRIALS)})  "
          f"-> {'PASS' if gate_i else 'FAIL'}")

    max_r_cut = max(max(r["r"] for r in b["b1"]),
                    max(r["r"] for r in b["b2"]))
    cut_silent = max_r_cut < TOL_SILENT
    coh_only_c = sum(1 for r in c["c"] if r["bucket"] == "coh_only")
    full_redundant = coh_only_c == 0
    gate_ii = cut_silent and full_redundant
    print(f"  (ii) cut-edge residual: max r = {max_r_cut:.2e} over b1+b2 "
          f"(need < {TOL_SILENT:.0e}) -> {'PASS' if cut_silent else 'FAIL'}")
    print(f"       full-visibility redundancy: cohomology-only in (c) = "
          f"{coh_only_c}/{TRIALS} (need 0) -> "
          f"{'PASS' if full_redundant else 'FAIL'}")

    all_results = (a["a1"] + a["a2"] + a["a3"] + b["b1"] + b["b2"] + b["b3"]
                   + c["c"] + d["d1"] + d["d2"])
    coh_dets = [r for r in all_results if r["coh"]]
    cut_condition = all(r["pw"] for r in coh_dets) if coh_dets else True
    print(f"  CUT check: residual detections total {len(coh_dets)}, of which "
          f"pairwise-blind {sum(1 for r in coh_dets if not r['pw'])} "
          f"-> {'CUT condition holds' if cut_condition else 'CUT condition refuted'}")

    verdict = "COMMIT" if (gate_i and gate_ii and not cut_condition) else "CUT"
    print(f"\n  VERDICT: {verdict}")
    if verdict == "COMMIT":
        print("  Scope (exact, honest): the completion residual detects and")
        print("  proves equivocation from RELAYED (reported-but-uncompared)")
        print("  evidence around cycles, where pairwise is blind; on cut")
        print("  edges it is silent by algebra; under full visibility it is")
        print("  redundant with pairwise; across SEVERED edges (no data) it")
        print("  is dark — detection requires the reports, not the check.")

    print("\n" + "=" * 74)
    print("[4] MUTATION SUITE (the harness's certificate)")
    print("=" * 74)
    ok_a, det_a = mutation_Ma()
    print(f"  Ma reintroduce D1 (random orthonormal restrictions): "
          f"{'CAUGHT' if ok_a else 'MISSED'} — {det_a}")
    ok_b, det_b = mutation_Mb()
    print(f"  Mb reintroduce D2 (severed g silently included):      "
          f"{'CAUGHT' if ok_b else 'MISSED'} — {det_b}")
    ok_c, det_c = mutation_Mc()
    print(f"  Mc no-equivocator control:                            "
          f"{'CLEAN' if ok_c else 'DIRTY'} — {det_c}")
    if not (ok_a and ok_b and ok_c):
        print("  !! mutation suite incomplete — harness unvalidated")
        sys.exit(1)
    print("\n  all mutations caught; harness validated.")

if __name__ == "__main__":
    main()
