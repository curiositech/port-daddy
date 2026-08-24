#!/usr/bin/env python3
"""
CONSISTENCY-RADIUS THEOREM for the completion-residual equivocation detector
(W8 tail — gates Paper 7 "The Cohomology of Equivocation").

The detector under proof is EXACTLY the one validated by sheaf_harness_v2.py
(compendium R6 update, verdict COMMIT): stalks R^D, shared-prefix coordinate
restrictions P_e, coboundary (delta x)_e = P_e(x_u - x_v), three-tier edge
visibility COMPARED / RELAYED / SEVERED, observed disagreement cochain g on
known edges K = C u R only, and the completion residual

    r  =  min_x || g_K - (delta x)|_K ||_2  =  || Pi_K g_K ||_2 ,

Pi_K = orthogonal projector onto im(delta_K)^perp = coker(delta_K), the
observed complex's cocycle space.  Anchors: Robinson consistency radius
(arXiv:1805.08927, Compositionality 2020); Hansen-Ghrist JACT 2019 (harmonic
residual); Sheng et al. CCS 2021 (forensic impossibility = the boundary);
Caru arXiv:1701.00656/1807.04203 (abelianization gap).

==========================================================================
SETTING
==========================================================================
G = (V, E), |V| = n, edges oriented u < v.  Stalk dim D; per-edge prefix
size s_e <= L (<= D); P_e = selection of coordinates 0..s_e-1.  Honest
vertex u holds one state x_u in R^D and reports rho_u^e = P_e x_u on every
incident edge.  An equivocator q reports rho_q^e = P_e(x_q + o_q^e) with a
PER-NEIGHBOR offset o_q^e (the lie).  The analyst holds, for each known
edge, the disagreement g_e = rho_u^e - rho_v^e; severed edges contribute no
data (free blocks).  Writing eps_e = P_e(o_u^e - o_v^e) for the injected
edge perturbation, every execution satisfies

    g_K = (delta x*)_K + eps_K + eta_K            (eta = measurement noise,
                                                   zero in the exact model).

LEMMA 1 (coordinate decomposition; the algebra behind everything below).
Because every P_e is a coordinate-subset selection, row (e, c) of delta_K
has exactly two nonzeros: +1 at (u, c), -1 at (v, c).  Grouping rows and
columns by coordinate c splits delta_K into a direct sum over c = 0..D-1 of
SIGNED GRAPH INCIDENCE matrices B_c of the coordinate subgraphs
G_c = (V, E_c),  E_c = { e in K : s_e > c }.  Hence
  (i)   r^2 = sum_c dist(g^c, im B_c)^2 = sum_c || Proj_{Z(G_c)} g^c ||^2,
        where Z(G_c) = ker(B_c^T) = the CYCLE SPACE (circulations) of G_c;
  (ii)  the residual vector rho = Pi_K g_K vanishes on every bridge of
        every G_c (a circulation nets zero across any 1-edge cut);
  (iii) dim coker(delta_K) = sum_c beta_1(G_c)  (the harness's structural
        self-check identity).
Proof. im(B_c)^perp = ker(B_c^T) is flow conservation at every vertex =
the cycle space; a circulation's value on a bridge equals its net flow
across the cut the bridge induces, which is zero.                    QED

==========================================================================
THEOREM CR-1 (soundness: r is a certified lower bound on the lie)
==========================================================================
(i) [Exactness / honest silence]  r = 0  iff  some global assignment x
    explains every observed disagreement ((delta x)_K = g_K).  In the
    noise-free model, honest executions give g_K = (delta x*)_K, so r = 0
    exactly — for EVERY visibility pattern, including severed blocks and
    cut edges.  Contrapositive: r > 0 PROVES no global section explains
    the compared+relayed data, i.e. someone equivocated.
(ii) [Size of the lie — any number of liars]  Every offset pattern
    consistent with the observed data satisfies
        || eps_K ||_2  >=  r ,
    with equality achieved by the least-squares completion eps^ = Pi_K g_K
    (it explains the data: g_K - eps^ in im delta_K).  So r is the EXACT
    minimum norm of edge-space perturbation any adversary must have
    injected.  In report-offset space: sum of per-report offset norms
    >= ||eps_K|| >= r (triangle ineq.), and total l2 offset >= r/sqrt(2)
    (>= r when at most one endpoint of each edge lies).
    Per-cycle certificate: for every unit circulation z of G_c,
        |<z, g^c>| = |<z, eps^c>| <= ||eps^c||,
    and r^2 = sum over an orthobasis of the cycle spaces of <z_i, g>^2.
    Proof. g_K = (delta x*)_K + eps_K and Pi_K kills im(delta_K), so
    r = ||Pi_K eps_K|| <= ||eps_K|| (orthogonal projection contracts);
    <z, delta x> = 0 gives the certificate.                          QED
(iii) [Single equivocator: the constant c(topology)]  Let q lie on its
    known incident edges with read offsets o (the coordinates c < s_e of
    o_q^e; unread coordinates are invisible in principle).  Then
    eps_K = A_q o where A_q's columns are distinct signed standard basis
    vectors (A_q^T A_q = I), so with M_q = Pi_K A_q ("inject, then project
    to the observed cocycle space"):
        sigma_min+(M_q) * dist(o, ker M_q)  <=  r  <=  dist(o, ker M_q),
    where sigma_min+ is the smallest NONZERO singular value — the promised
    c(topology), the smallest singular value of delta's data-side
    complement restricted to the reachable cocycle space.  ker M_q is the
    in-principle-invisible lie space: it contains (a) the uniform lie
    o_q^e = t for all e (a consistent alternative state — not an
    equivocation), (b) offsets on edges that are bridges of their G_c,
    (c) offsets across severed edges, (d) unread/private coordinates.
    CLOSED FORM for a lie of size s on a single edge e, coordinate c:
        r = |s| * sqrt(1 - R_eff_{G_c}(e)),
    R_eff = effective resistance between e's endpoints in G_c (with e
    present): ||Proj_Z 1_e||^2 = 1 - 1_e^T B(B^T B)^+ B^T 1_e =
    1 - R_eff(e), the edge's complementary leverage score.  On C_n this is
    1 - (n-1)/n = 1/n:  r = |s|/sqrt(n)  — C_6, s = 3: r = 3/sqrt(6) =
    1.2247, the R6 number; on a bridge R_eff = 1: r = 0.             QED
    SINGLE-EQUIVOCATOR CONDITION (located by the sweep below): bound (iii)
    is single-liar.  Two coordinated liars on a common cycle can choose
    individually-detectable offsets whose SUM is a coboundary (a
    consistent counterfactual world): r = 0 with ||eps|| large.  (ii)
    still holds — r never overstates — but r can understate a COALITION's
    lie all the way to zero.  Detection lower bounds are per-equivocator.

==========================================================================
THEOREM CR-2 (localization)
==========================================================================
Noise-free, single equivocator q: the per-edge residual vector
rho = Pi_K eps_K satisfies
    supp(rho)  is contained in  { edges lying on a cycle of some G_c
                                  passing THROUGH q }.
In particular, whenever r > 0 the maximum-residual edge lies on a cycle of
the known graph through the equivocator (equivalently: in a biconnected
block of G_K that contains q and has >= 3 vertices).  This is the
harness's measured 200/200, now a theorem.
Proof. By Lemma 1 work per coordinate.  eps^c = sum_{e inc q} (+-) o^e_c 1_e,
so it suffices to show supp(Proj_Z 1_e) is inside the set of edges sharing
a cycle with e (e = (u,v) incident to q, so such cycles pass through q).
Proj_Z 1_e = 1_e - J^e, where J^e = B L^+ B^T 1_e is the unit electrical
current from u to v (L = B^T B the graph Laplacian): potentials
p = L^+(chi_u - chi_v), J^e_f = p_a - p_b on f = (a, b).  Let f != e carry
J^e_f != 0.  Current is conserved at every vertex except u (source) and v
(sink), and strictly decreases p along every nonzero-current edge; so from
f's lower-potential endpoint, repeatedly following an outgoing
nonzero-current edge strictly descends in p and must terminate at v, and
symmetrically ascends from f's upper endpoint to u.  Strict monotonicity
makes the concatenation a simple u-v path through f; it cannot use
e = (u,v) itself (a strictly monotone u-v path containing edge (u,v) is
that single edge).  Path + e is a cycle through e and f.  Supports of sums
lie in unions of supports; bridges carry no circulation (Lemma 1(ii)). QED
BOUNDED-NOISE VERSION.  With honest per-report noise (g = delta x + eps +
eta):  if  2 ||eta_K||_2 < max_f ||(Pi_K eps_K)_f||,  the argmax-residual
edge still lies on a cycle through q.
Proof. Off-support edges show only ||(Pi eta)_f|| <= ||eta_K||; the clean
top edge still shows >= max_f ||(Pi eps)_f|| - ||eta_K|| > ||eta_K||.  QED
The noise threshold where localization empirically degrades is measured
below and REPORTED as the honest boundary (it is a property of the
signal-to-noise geometry, not a failure of the theorem, whose sufficient
condition is verified to have zero violations).

==========================================================================
THEOREM CR-3 (complexity: one least-squares solve, and it decomposes)
==========================================================================
Computing r exactly is ONE linear least-squares solve on delta_K, which has
<= |E| L rows and exactly 2 nonzeros per row.  By Lemma 1 it splits into
<= L independent SCALAR graph least-squares problems  min_z ||g^c - B_c z||
(graph Laplacian systems L_c z = B_c^T g^c) on the coordinate subgraphs:
  (a) assembly: O(|E| L);
  (b) iterative: conjugate gradients cost O(|E_c|) per matvec, so
      O(|E| L * k(kappa, tol)) total, with k independent of n on
      expander-like graphs (bounded condition number); with SDD Laplacian
      solvers (Spielman-Teng lineage) O~(|E| L log(1/tol)) — linear in the
      least-squares dimension up to logs;
  (c) exact dense fallback: O(L n^3 + |E| L); the harness's full-system
      dense lstsq is O((|E| L)(nD)^2) and is the wasteful option.
COROLLARY (Robinson sup-radius; the assessment's Theorem-3 track).  The
sup-version consistency radius over COMPARED pairs, max_{e in C} ||g_e||,
is one O(|E| L) pass; it is 2x the l-infinity consistency radius of the
compared report assignment (either endpoint's report is >= ||g_e||/2 from
any single edge value) and is zero iff no compared edge witnesses
equivocation.  Bridge to the l2 radius: for any vertex assignment x,
per-edge  ||P_e x_u - rho_u||^2 + ||P_e x_v - rho_v||^2
          >= ||(delta x)_e - g_e||^2 / 2,
so the l2 consistency radius of the two-reports-per-edge assignment is
>= r / sqrt(2):  r > 0 forces a positive Robinson radius, and r is itself
exactly the consistency radius of the quotient (disagreement) assignment
g_K relative to the subspace of globally explainable cochains.
Bach's #P-hardness (J. Symb. Comput. 27(4), 1999) concerns coherent
sheaves on projective space, not finite cellular sheaves over R — this
computation is small linear algebra, stated to preempt the objection.

==========================================================================
WHAT r DOES NOT GIVE (theorem-adjacent boundary; verified where testable)
==========================================================================
- NO ATTRIBUTION (Sheng et al. CCS 2021): a lie o by q toward w on edge
  (q, w) and a lie -o by w toward q produce BIT-IDENTICAL observed data;
  r localizes cycles, signatures attribute.  Demonstrated below.
- VANISHING r IS NOT AN ALL-CLEAR: (a) uniform lies = consistent
  alternative states (ker M_q); (b) coalition cancellation (CR-1(iii)
  condition); (c) severed edges are provably dark, cut edges silent by
  algebra (R6); (d) the abelianization gap (Caru): set-valued log states
  embedded in R can be genuinely inconsistent with vanishing R-residual —
  outside this vector model, cited as the standing external boundary.
- Under noise, honest r concentrates near ||Pi eta|| > 0: soundness "r > 0
  proves a lie" is exact only in the noise-free model; noisy deployments
  need a threshold above the noise floor (measured below).

VERIFICATION PLAN (falsification-first: every claim attacked numerically;
seeded mutation must turn the honest-silence contract red; exit nonzero on
any failure): [1] soundness inequality + achievability, 600 trials;
closed-form c(topology) vs effective resistance; sigma_min+ bounds tight;
adversarial cancellation sweep -> single-equivocator condition.
[2] noise-free localization 200/200 (two blocks topologies + severed
expanders); noise sweep with threshold report + zero violations of the
sufficient condition.  [3] decomposition equality, CG agreement, timing
slopes (CG linear-ish in |E|, dense not).  [4] attribution twins,
severed darkness.  [5] mutation: unmasked-severed r (old D2 bug) must
violate honest silence; no-equivocator control clean.

Deps: numpy, networkx.  Program seed 20260816.
"""
import sys
import time

import numpy as np

try:
    import networkx as nx
except ImportError:
    print("networkx required: pip install networkx")
    sys.exit(2)

SEED = 20260816
D = 5            # stalk dim; prefix sizes 2..4, coord 4 always private
SIGMA_EQ = 2.0
TRIALS = 200
TOL_DETECT = 1e-8
TOL_SILENT = 1e-9

FAILURES = []


def check(cond, label):
    print(f"    [{'PASS' if cond else 'FAIL'}] {label}")
    if not cond:
        FAILURES.append(label)
    return cond


# --------------------------------------------------------------------------
# graphs (edges as sorted tuples; orientation (u,v), u < v: (dx)_e = x_u - x_v)
# --------------------------------------------------------------------------
def two_path(n=12):
    k = n // 2
    E = [(i, i + 1) for i in range(k - 1)]
    E += [(k + i, k + i + 1) for i in range(k - 1)]
    E += [(0, k), (k - 1, n - 1)]
    return n, sorted(tuple(sorted(e)) for e in E)


def single_bridge(n=12):
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


def two_cycles(k=6):
    """C_k (0..k-1) -- bridge (k-1,k) -- C_k (k..2k-1): two biconnected
    blocks joined by a cut edge; the localization test with real off-block
    competitor edges (two_path has every edge on its single cycle)."""
    E = [tuple(sorted((i, (i + 1) % k))) for i in range(k)]
    E += [tuple(sorted((k + i, k + (i + 1) % k))) for i in range(k)]
    E += [(k - 1, k)]
    return 2 * k, sorted(E)


# --------------------------------------------------------------------------
# sheaf structure (identical to sheaf_harness_v2.py)
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


def honest_states(nverts, rng, dim):
    x = np.tile(rng.normal(0, 1, dim), (nverts, 1))
    if dim > 1:
        x[:, dim - 1] = rng.normal(0, 1, nverts)
    return x


def gen_cochain(edges, P, x, liars, rng=None, sigma_noise=0.0):
    """Observed disagreements. liars: {q: {neighbor w: offset in R^D}}.
    Per-report noise N(0, sigma^2 I) on the read coordinates; returns
    (g, eta) with eta the per-edge combined noise (zero if noiseless)."""
    g, eta = {}, {}
    for e in edges:
        u, v = e
        ru = P[e] @ x[u]
        rv = P[e] @ x[v]
        for q, offs in liars.items():
            if u == q and v in offs:
                ru = P[e] @ (x[u] + offs[v])
            if v == q and u in offs:
                rv = P[e] @ (x[v] + offs[u])
        s = P[e].shape[0]
        if sigma_noise > 0.0:
            nu = rng.normal(0, sigma_noise, s)
            nv = rng.normal(0, sigma_noise, s)
            ru, rv = ru + nu, rv + nv
            eta[e] = nu - nv
        else:
            eta[e] = np.zeros(s)
        g[e] = ru - rv
    return g, eta


def eps_vector(edges, P, slices, status, liars):
    """The injected perturbation eps_K, assembled from the generative
    offsets, stacked in known-edge row order (ground truth for CR-1)."""
    known = [e for e in edges if status[e] in ("C", "R")]
    out = []
    for e in known:
        u, v = e
        s = P[e].shape[0]
        contrib = np.zeros(s)
        for q, offs in liars.items():
            if u == q and v in offs:
                contrib += P[e] @ offs[v]
            if v == q and u in offs:
                contrib -= P[e] @ offs[u]
        out.append(contrib)
    return np.concatenate(out) if out else np.zeros(0)


# --------------------------------------------------------------------------
# detectors
# --------------------------------------------------------------------------
def completion_residual(delta, slices, edges, status, g):
    """r = min_x ||g_K - (delta x)|_K||; severed blocks dropped (free)."""
    known = [e for e in edges if status[e] in ("C", "R")]
    if not known:
        return 0.0, {}, np.zeros(0), None
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
    return r, per_edge, resid, A


def residual_by_coordinate(nverts, edges, sizes, status, g, solver="dense"):
    """Lemma 1 route: r^2 = sum_c dist(g^c, im B_c)^2, one scalar graph
    least-squares per coordinate."""
    known = [e for e in edges if status[e] in ("C", "R")]
    total = 0.0
    for c in range(max(sizes.values())):
        Ec = [e for e in known if sizes[e] > c]
        if not Ec:
            continue
        gc = np.array([g[e][c] for e in Ec])
        if solver == "cg":
            rc = graph_ls_residual_cg(nverts, Ec, gc)
        else:
            B = np.zeros((len(Ec), nverts))
            for i, (u, v) in enumerate(Ec):
                B[i, u], B[i, v] = 1.0, -1.0
            z, _, _, _ = np.linalg.lstsq(B, gc, rcond=None)
            rc = float(np.linalg.norm(gc - B @ z))
        total += rc * rc
    return float(np.sqrt(total))


def graph_ls_residual_cg(nverts, edges_c, gc, tol=1e-11, maxit=5000):
    """min_z ||gc - B z|| via CG on the graph Laplacian normal equations.
    B^T gc is orthogonal to ker(L) (constants per component), so singular
    CG is consistent.  O(|E_c|) per iteration."""
    us = np.fromiter((e[0] for e in edges_c), dtype=np.int64)
    vs = np.fromiter((e[1] for e in edges_c), dtype=np.int64)

    def Bmv(z):
        return z[us] - z[vs]

    def Btmv(w):
        out = np.zeros(nverts)
        np.add.at(out, us, w)
        np.add.at(out, vs, -w)
        return out

    b = Btmv(gc)
    z = np.zeros(nverts)
    res = b.copy()
    p = res.copy()
    rs = float(res @ res)
    b0 = np.sqrt(rs) + 1e-300
    for _ in range(maxit):
        if np.sqrt(rs) < tol * b0:
            break
        Lp = Btmv(Bmv(p))
        alpha = rs / float(p @ Lp + 1e-300)
        z += alpha * p
        res -= alpha * Lp
        rs_new = float(res @ res)
        p = res + (rs_new / rs) * p
        rs = rs_new
    return float(np.linalg.norm(gc - Bmv(z)))


def pairwise_detect(edges, status, g, tol=TOL_SILENT):
    return any(status[e] == "C" and np.linalg.norm(g[e]) > tol for e in edges)


# --------------------------------------------------------------------------
# topology helpers
# --------------------------------------------------------------------------
def eff_resistance(nverts, edges, e):
    Lap = np.zeros((nverts, nverts))
    for (u, v) in edges:
        Lap[u, u] += 1
        Lap[v, v] += 1
        Lap[u, v] -= 1
        Lap[v, u] -= 1
    Li = np.linalg.pinv(Lap)
    u, v = e
    return float(Li[u, u] + Li[v, v] - 2 * Li[u, v])


def on_cycle_through(known_edges, f, q):
    """Edge f lies on a cycle through vertex q in the known graph iff f's
    biconnected block contains q and has >= 3 vertices (blocks pairwise
    share at most a cut vertex, so f's block is unique)."""
    G = nx.Graph(known_edges)
    for comp in nx.biconnected_components(G):
        if f[0] in comp and f[1] in comp:
            return (q in comp) and (len(comp) >= 3)
    return False


def liar_matrix(nverts, edges, P, slices, status, q):
    """M_q = Pi_K A_q: columns = residual (cocycle projection) of a unit
    read-offset on each (known incident edge, read coordinate) of q.
    Returns (M, column key list, A_ls)."""
    known = [e for e in edges if status[e] in ("C", "R")]
    delta, _ = coboundary(nverts, edges, P, D)
    rows = np.concatenate([np.arange(*slices[e]) for e in known])
    A_ls = delta[rows, :]
    # row offset of each known edge inside the stacked known vector
    off, r0 = {}, 0
    for e in known:
        off[e] = r0
        r0 += slices[e][1] - slices[e][0]
    cols, keys = [], []
    for e in known:
        if q not in e:
            continue
        sgn = 1.0 if e[0] == q else -1.0
        s = slices[e][1] - slices[e][0]
        for c in range(s):
            w = np.zeros(r0)
            w[off[e] + c] = sgn
            xh, _, _, _ = np.linalg.lstsq(A_ls, w, rcond=None)
            cols.append(w - A_ls @ xh)
            keys.append((e, c))
    M = np.column_stack(cols) if cols else np.zeros((r0, 0))
    return M, keys, A_ls


# --------------------------------------------------------------------------
# [0] setting + closed-form reproduction of the R6 numbers
# --------------------------------------------------------------------------
def section0():
    print("=" * 74)
    print("[0] CLOSED FORM vs the R6 mechanism numbers (CR-1(iii))")
    print("=" * 74)
    n, edges = cycle_edges(6)
    sizes = {e: 1 for e in edges}
    P = prefix_restrictions(edges, sizes, 1)
    delta, slices = coboundary(n, edges, P, 1)
    g, _ = gen_cochain(edges, P, np.zeros((n, 1)), {2: {3: np.array([3.0])}})
    status = {e: "C" for e in edges}
    status[(2, 3)] = "R"
    r, _, _, _ = completion_residual(delta, slices, edges, status, g)
    Reff = eff_resistance(n, edges, (2, 3))
    pred = 3.0 * np.sqrt(1.0 - Reff)
    print(f"  C6 relayed cycle edge, lie 3.0:  r = {r:.6f}   "
          f"|s|*sqrt(1-R_eff) = 3*sqrt(1-{Reff:.4f}) = {pred:.6f}")
    check(abs(r - pred) < 1e-9 and abs(r - 1.224745) < 1e-6,
          "R6 number 1.2247 == closed form |s|*sqrt(1-R_eff), R_eff = 5/6")
    # P6 bridge: R_eff = 1 -> r = 0
    nP, EP = 6, [(i, i + 1) for i in range(5)]
    sizesP = {e: 1 for e in EP}
    PP = prefix_restrictions(EP, sizesP, 1)
    dP, sP = coboundary(nP, EP, PP, 1)
    gP, _ = gen_cochain(EP, PP, np.zeros((nP, 1)), {2: {3: np.array([3.0])}})
    stP = {e: "C" for e in EP}
    stP[(2, 3)] = "R"
    rP, _, _, _ = completion_residual(dP, sP, EP, stP, gP)
    ReffP = eff_resistance(nP, EP, (2, 3))
    print(f"  P6 relayed cut edge,   lie 3.0:  r = {rP:.2e}   "
          f"R_eff = {ReffP:.6f} -> predicted 0")
    check(rP < TOL_SILENT and abs(ReffP - 1.0) < 1e-9,
          "bridge silence == closed form (R_eff = 1)")


# --------------------------------------------------------------------------
# [1] THEOREM CR-1
# --------------------------------------------------------------------------
def section1():
    print("\n" + "=" * 74)
    print("[1] THEOREM CR-1 — soundness / size of the lie")
    print("=" * 74)

    # -- 1a soundness inequality + achievability, 600 trials, 3 topologies
    print("\n  1a. r <= ||eps_K|| (any liar set), min-norm explanation "
          "achieves r  [200 trials x 3 topologies]")
    viol = 0
    ach_viol = 0
    slacks = []
    for arm in range(3):
        for t in range(TRIALS):
            rng = np.random.default_rng([SEED, 11, arm, t])
            if arm == 0:
                n, edges = two_path(12)
                status = {e: "C" for e in edges}
                status[(0, 6)] = "R"
                q, targets = 0, [6]
            elif arm == 1:
                n, edges = single_bridge(12)
                status = {e: "C" for e in edges}
                status[(5, 6)] = "R"
                q, targets = 5, [6]
            else:
                n, edges = expander(12, seed=int(rng.integers(1 << 30)))
                status = {e: "C" for e in edges}
                m = len(edges)
                picks = rng.choice(m, size=6, replace=False)
                for i in picks[:3]:
                    status[edges[i]] = "S"
                for i in picks[3:]:
                    status[edges[i]] = "R"
                q = int(rng.integers(n))
                targets = sorted({v for e in edges for v in e
                                  if q in e and v != q})
            sizes = {e: int(rng.integers(2, 5)) for e in edges}
            P = prefix_restrictions(edges, sizes, D)
            delta, slices = coboundary(n, edges, P, D)
            x = honest_states(n, rng, D)
            liars = {q: {w: rng.normal(0, SIGMA_EQ, D) for w in targets}}
            g, _ = gen_cochain(edges, P, x, liars)
            r, _, resid, A = completion_residual(delta, slices, edges,
                                                 status, g)
            eps = eps_vector(edges, P, slices, status, liars)
            if r > np.linalg.norm(eps) + 1e-9:
                viol += 1
            slacks.append(np.linalg.norm(eps) - r)
            # achievability: resid = Pi g explains data (A^T resid = 0)
            if A is not None and np.linalg.norm(A.T @ resid) > 1e-7:
                ach_viol += 1
    print(f"      inequality violations: {viol}/600   "
          f"min slack ||eps||-r = {min(slacks):.3e}   "
          f"median slack = {np.median(slacks):.3f}")
    check(viol == 0, "soundness r <= ||eps_K||: 0/600 violations")
    check(ach_viol == 0, "achievability: A^T (Pi g) == 0 (min-norm "
                         "explanation exists with norm exactly r), 600/600")

    # -- 1b closed-form constant vs effective resistance
    print("\n  1b. single-edge lie: r == |s| * sqrt(1 - R_eff(e))")
    ok_cn = True
    for n in range(4, 13):
        _, edges = cycle_edges(n)
        sizes = {e: 1 for e in edges}
        P = prefix_restrictions(edges, sizes, 1)
        delta, slices = coboundary(n, edges, P, 1)
        e0 = edges[0]
        g, _ = gen_cochain(edges, P, np.zeros((n, 1)),
                           {e0[0]: {e0[1]: np.array([1.7])}})
        status = {e: "C" for e in edges}
        status[e0] = "R"
        r, _, _, _ = completion_residual(delta, slices, edges, status, g)
        ok_cn &= abs(r - 1.7 / np.sqrt(n)) < 1e-9
    check(ok_cn, "C_n family n=4..12: r = |s|/sqrt(n) exactly "
                 "(c(C_n) = 1/sqrt(n))")
    bad = 0
    for t in range(TRIALS):
        rng = np.random.default_rng([SEED, 12, t])
        while True:
            G = nx.gnp_random_graph(10, 0.35,
                                    seed=int(rng.integers(1 << 30)))
            if nx.is_connected(G) and G.number_of_edges() >= 10:
                break
        edges = sorted(tuple(sorted(e)) for e in G.edges())
        n = 10
        e0 = edges[int(rng.integers(len(edges)))]
        s = float(rng.normal(0, SIGMA_EQ))
        sizes = {e: 1 for e in edges}
        P = prefix_restrictions(edges, sizes, 1)
        delta, slices = coboundary(n, edges, P, 1)
        g, _ = gen_cochain(edges, P, np.zeros((n, 1)),
                           {e0[0]: {e0[1]: np.array([s])}})
        status = {e: "C" for e in edges}
        status[e0] = "R"
        r, _, _, _ = completion_residual(delta, slices, edges, status, g)
        pred = abs(s) * np.sqrt(max(0.0, 1.0 - eff_resistance(n, edges, e0)))
        if abs(r - pred) > 1e-8:
            bad += 1
    check(bad == 0, f"random G(10,.35), random edge (bridges included): "
                    f"|r - pred| < 1e-8 in {TRIALS}/{TRIALS}")

    # -- 1c sigma_min+ bound (vector stalks, single equivocator)
    print("\n  1c. sigma_min+(Pi_K A_q) * ||o_perp|| <= r <= ||o_perp||  "
          "(c(topology) as smallest nonzero singular value)")
    rng = np.random.default_rng([SEED, 13])
    n, edges = two_path(12)
    status = {e: "C" for e in edges}
    status[(0, 6)] = "R"
    q = 0
    sizes = {e: int(rng.integers(2, 5)) for e in edges}
    P = prefix_restrictions(edges, sizes, D)
    delta, slices = coboundary(n, edges, P, D)
    M, keys, _ = liar_matrix(n, edges, P, slices, status, q)
    U, S, Vt = np.linalg.svd(M, full_matrices=True)
    smax = S[0]
    nz = S[S > 1e-10 * smax]
    smin = float(nz[-1])
    kerdim = M.shape[1] - len(nz)
    Vker = Vt[len(nz):, :]          # kernel basis (rows)
    print(f"      q = 0 on two_path; read-offset dim {M.shape[1]}, "
          f"sigma_max = {smax:.4f}, sigma_min+ = {smin:.4f}, "
          f"dim ker = {kerdim}")
    bad_lo = bad_hi = 0
    for t in range(TRIALS):
        rt = np.random.default_rng([SEED, 13, t])
        o = rt.normal(0, SIGMA_EQ, M.shape[1])
        o_perp = o - Vker.T @ (Vker @ o) if kerdim else o
        # generative run with these offsets
        offs = {}
        for (e, c), val in zip(keys, o):
            w = e[1] if e[0] == q else e[0]
            offs.setdefault(w, np.zeros(D))[c] = val
        x = honest_states(n, rt, D)
        g, _ = gen_cochain(edges, P, x, {q: offs})
        r, _, _, _ = completion_residual(delta, slices, edges, status, g)
        no = np.linalg.norm(o_perp)
        if r < smin * no - 1e-8:
            bad_lo += 1
        if r > no + 1e-8:
            bad_hi += 1
    check(bad_lo == 0 and bad_hi == 0,
          f"both bounds hold in {TRIALS}/{TRIALS} random offset draws")
    # adversarial tightness: o = least-detectable non-kernel direction
    o = 3.0 * Vt[len(nz) - 1, :]
    offs = {}
    for (e, c), val in zip(keys, o):
        w = e[1] if e[0] == q else e[0]
        offs.setdefault(w, np.zeros(D))[c] = val
    g, _ = gen_cochain(edges, P, honest_states(n, rng, D), {q: offs})
    r, _, _, _ = completion_residual(delta, slices, edges, status, g)
    check(abs(r - 3.0 * smin) < 1e-8,
          f"adversarial offset along v_min: r = {r:.6f} = 3*sigma_min+ "
          f"= {3 * smin:.6f} (lower bound TIGHT)")
    if kerdim:
        o = 5.0 * Vker[0, :]
        offs = {}
        for (e, c), val in zip(keys, o):
            w = e[1] if e[0] == q else e[0]
            offs.setdefault(w, np.zeros(D))[c] = val
        g, _ = gen_cochain(edges, P, honest_states(n, rng, D), {q: offs})
        r, _, _, _ = completion_residual(delta, slices, edges, status, g)
        check(r < TOL_SILENT,
              f"kernel offset ||o|| = 5 (uniform lie = consistent "
              f"alternative state): r = {r:.1e} — invisible in principle, "
              f"correctly NOT an equivocation")

    # -- 1d adversarial cancellation sweep -> single-equivocator condition
    print("\n  1d. SWEEP: coalition cancellation attacks the single-liar "
          "bound  [200 trials]")
    n, edges = cycle_edges(8)
    sizes = {e: 1 for e in edges}
    P = prefix_restrictions(edges, sizes, 1)
    delta, slices = coboundary(n, edges, P, 1)
    status = {e: "C" for e in edges}
    status[(1, 2)] = "R"
    status[(5, 6)] = "R"
    max_joint, min_solo = 0.0, np.inf
    for t in range(TRIALS):
        rng = np.random.default_rng([SEED, 14, t])
        s = float(rng.normal(0, SIGMA_EQ)) + 3.0  # bounded away from 0
        x = honest_states(n, rng, 1)
        # each liar alone: detectable at exactly |s|/sqrt(8)
        g1, _ = gen_cochain(edges, P, x, {1: {2: np.array([s])}})
        r1, _, _, _ = completion_residual(delta, slices, edges, status, g1)
        # coalition: q2's offset tuned to cancel q1's around the cycle
        g2, _ = gen_cochain(edges, P, x, {1: {2: np.array([s])},
                                          5: {6: np.array([-s])}})
        r2, _, _, _ = completion_residual(delta, slices, edges, status, g2)
        max_joint = max(max_joint, r2)
        min_solo = min(min_solo, r1)
    print(f"      each liar alone: min r = {min_solo:.4f} "
          f"(= |s|/sqrt(8), detectable);  coalition: max r = "
          f"{max_joint:.2e} with ||eps|| ~ |s|*sqrt(2)")
    check(max_joint < TOL_SILENT and min_solo > 0.5,
          "cancellation CONFIRMED: two coordinated liars on a common cycle "
          "drive r to 0 — CR-1(iii) detection bound is SINGLE-EQUIVOCATOR; "
          "CR-1(ii) survives (r never overstates)")


# --------------------------------------------------------------------------
# [2] THEOREM CR-2
# --------------------------------------------------------------------------
def loc_trial(n, edges, status, sizes, q, targets, rng, sigma_noise=0.0):
    P = prefix_restrictions(edges, sizes, D)
    delta, slices = coboundary(n, edges, P, D)
    x = honest_states(n, rng, D)
    liars = {q: {w: rng.normal(0, SIGMA_EQ, D) for w in targets}}
    g, eta = gen_cochain(edges, P, x, liars, rng=rng,
                         sigma_noise=sigma_noise)
    r, per_edge, _, _ = completion_residual(delta, slices, edges, status, g)
    known = [e for e in edges if status[e] in ("C", "R")]
    if r <= TOL_DETECT or not per_edge:
        return None
    top = max(per_edge, key=per_edge.get)
    success = on_cycle_through(known, top, q)
    # sufficient-condition bookkeeping (CR-2 bounded-noise)
    suff = None
    if sigma_noise > 0.0:
        _, per_eps, _, _ = completion_residual(
            delta, slices, edges, status, _eps_as_g(edges, P, liars))
        eta_norm = np.sqrt(sum(float(eta[e] @ eta[e]) for e in known))
        suff = 2.0 * eta_norm < max(per_eps.values())
    return success, suff, r


def _eps_as_g(edges, P, liars):
    """Recast the generative eps as a g-style dict for Pi eps."""
    g = {}
    for e in edges:
        u, v = e
        s = P[e].shape[0]
        contrib = np.zeros(s)
        for q, offs in liars.items():
            if u == q and v in offs:
                contrib += P[e] @ offs[v]
            if v == q and u in offs:
                contrib -= P[e] @ offs[u]
        g[e] = contrib
    return g


def section2():
    print("\n" + "=" * 74)
    print("[2] THEOREM CR-2 — localization")
    print("=" * 74)

    print("\n  2a. noise-free: max-residual edge on a cycle THROUGH the "
          "equivocator (biconnected block test)")
    # arm 1: two_cycles — real off-block competitor edges
    n, edges = two_cycles(6)
    status = {e: "C" for e in edges}
    status[(2, 3)] = "R"
    succ = tot = 0
    for t in range(TRIALS):
        rng = np.random.default_rng([SEED, 21, t])
        sizes = {e: int(rng.integers(2, 5)) for e in edges}
        out = loc_trial(n, edges, status, sizes, 2, [3], rng)
        if out is not None:
            tot += 1
            succ += out[0]
    check(succ == tot and tot >= 0.9 * TRIALS,
          f"two_cycles (liar in block A, block B competing): "
          f"{succ}/{tot} detected trials localize")
    # arm 2: severed expanders (blocks nontrivial after severing)
    succ = tot = 0
    for t in range(TRIALS):
        rng = np.random.default_rng([SEED, 22, t])
        n, edges = expander(12, seed=int(rng.integers(1 << 30)))
        m = len(edges)
        picks = rng.choice(m, size=6, replace=False)
        status = {e: "C" for e in edges}
        for i in picks[:3]:
            status[edges[i]] = "S"
        for i in picks[3:]:
            status[edges[i]] = "R"
        straddlers = sorted({v for e in edges if status[e] != "C"
                             for v in e})
        q = int(rng.choice(straddlers))
        targets = sorted({v for e in edges for v in e
                          if q in e and v != q and status[e] != "C"})
        sizes = {e: int(rng.integers(2, 5)) for e in edges}
        out = loc_trial(n, edges, status, sizes, q, targets, rng)
        if out is not None:
            tot += 1
            succ += out[0]
    check(succ == tot,
          f"severed expanders (partition-straddling liar): "
          f"{succ}/{tot} detected trials localize (dark trials excluded)")
    print("      (two_path a1's 200/200 in the harness is the degenerate "
          "case: every known edge lies on its single cycle)")

    print("\n  2b. bounded noise: sufficient condition "
          "2||eta|| < max_f ||(Pi eps)_f||, and the measured threshold")
    n, edges = two_cycles(6)
    status = {e: "C" for e in edges}
    status[(2, 3)] = "R"
    grid = [0.02, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6]
    suff_viol = 0
    rates = []
    honest_r = []
    for sig in grid:
        succ = tot = 0
        hon = []
        for t in range(TRIALS):
            rng = np.random.default_rng([SEED, 23, int(sig * 1000), t])
            sizes = {e: int(rng.integers(2, 5)) for e in edges}
            out = loc_trial(n, edges, status, sizes, 2, [3], rng,
                            sigma_noise=sig)
            if out is not None:
                tot += 1
                success, suff, _ = out
                succ += success
                if suff and not success:
                    suff_viol += 1
            # honest arm at same noise: r floor for threshold calibration
            rng2 = np.random.default_rng([SEED, 24, int(sig * 1000), t])
            P = prefix_restrictions(edges, sizes, D)
            delta, slices = coboundary(n, edges, P, D)
            xh = honest_states(n, rng2, D)
            gh, _ = gen_cochain(edges, P, xh, {}, rng=rng2,
                                sigma_noise=sig)
            rh, _, _, _ = completion_residual(delta, slices, edges,
                                              status, gh)
            hon.append(rh)
        rates.append(succ / max(tot, 1))
        honest_r.append(float(np.mean(hon)))
        print(f"      sigma_noise/sigma_eq = {sig / SIGMA_EQ:5.3f}:  "
              f"localization {succ}/{tot} = {succ / max(tot, 1):5.1%}   "
              f"honest-arm mean r = {np.mean(hon):.3f}")
    check(suff_viol == 0,
          "sufficient condition: 0 localization failures among trials "
          "satisfying 2||eta|| < max_f ||(Pi eps)_f||")
    thr95 = next((grid[i] for i in range(len(grid)) if rates[i] < 0.95),
                 None)
    thr50 = next((grid[i] for i in range(len(grid)) if rates[i] < 0.50),
                 None)
    print(f"      HONEST BOUNDARY: localization first drops below 95% at "
          f"sigma_noise/sigma_eq ~ "
          f"{'>' + str(grid[-1] / SIGMA_EQ) if thr95 is None else f'{thr95 / SIGMA_EQ:.3f}'}"
          f", below 50% at "
          f"{'beyond grid' if thr50 is None else f'{thr50 / SIGMA_EQ:.3f}'}"
          f"; and the honest-arm r floor above shows soundness "
          f"'r > 0 => lie' needs a noise-floor threshold once eta != 0")
    check(rates[0] >= 0.99,
          "low-noise regime (sigma ratio 0.01) localizes >= 99%")


# --------------------------------------------------------------------------
# [3] THEOREM CR-3
# --------------------------------------------------------------------------
def section3():
    print("\n" + "=" * 74)
    print("[3] THEOREM CR-3 — one least-squares solve; decomposition; "
          "timing")
    print("=" * 74)

    print("\n  3a. Lemma 1 decomposition: full-system dense r == "
          "sqrt(sum_c r_c^2) == CG  [50 trials]")
    worst_dc = worst_cg = 0.0
    for t in range(50):
        rng = np.random.default_rng([SEED, 31, t])
        n, edges = expander(12, seed=int(rng.integers(1 << 30)))
        m = len(edges)
        picks = rng.choice(m, size=6, replace=False)
        status = {e: "C" for e in edges}
        for i in picks[:3]:
            status[edges[i]] = "S"
        for i in picks[3:]:
            status[edges[i]] = "R"
        q = int(rng.integers(n))
        targets = sorted({v for e in edges for v in e if q in e and v != q})
        sizes = {e: int(rng.integers(2, 5)) for e in edges}
        P = prefix_restrictions(edges, sizes, D)
        delta, slices = coboundary(n, edges, P, D)
        x = honest_states(n, rng, D)
        liars = {q: {w: rng.normal(0, SIGMA_EQ, D) for w in targets}}
        g, _ = gen_cochain(edges, P, x, liars)
        r_full, _, _, _ = completion_residual(delta, slices, edges,
                                              status, g)
        r_dc = residual_by_coordinate(n, edges, sizes, status, g, "dense")
        r_cg = residual_by_coordinate(n, edges, sizes, status, g, "cg")
        worst_dc = max(worst_dc, abs(r_full - r_dc))
        worst_cg = max(worst_cg, abs(r_full - r_cg))
    check(worst_dc < 1e-9,
          f"per-coordinate dense == full dense (max gap {worst_dc:.1e})")
    check(worst_cg < 1e-6,
          f"CG Laplacian route == full dense (max gap {worst_cg:.1e})")

    print("\n  3b. timing: CG route vs |E| (3-regular expanders, D=5, "
          "prefixes 2-4)")
    ns_cg = [128, 256, 512, 1024, 2048]
    t_cg, m_cg = [], []
    for n in ns_cg:
        rng = np.random.default_rng([SEED, 32, n])
        _, edges = expander(n, seed=7)
        sizes = {e: int(rng.integers(2, 5)) for e in edges}
        status = {e: "C" for e in edges}
        P = prefix_restrictions(edges, sizes, D)
        x = honest_states(n, rng, D)
        q = 0
        targets = sorted({v for e in edges for v in e if q in e and v != q})
        liars = {q: {w: rng.normal(0, SIGMA_EQ, D) for w in targets}}
        g, _ = gen_cochain(edges, P, x, liars)
        reps = []
        for _ in range(5):
            t0 = time.perf_counter()
            residual_by_coordinate(n, edges, sizes, status, g, "cg")
            reps.append(time.perf_counter() - t0)
        t_cg.append(float(np.median(reps)))
        m_cg.append(len(edges))
        print(f"      n = {n:5d}  |E| = {len(edges):5d}  "
              f"CG time = {t_cg[-1] * 1e3:8.2f} ms")
    slope_cg = float(np.polyfit(np.log(m_cg), np.log(t_cg), 1)[0])
    ns_de = [24, 48, 96]
    t_de = []
    for n in ns_de:
        rng = np.random.default_rng([SEED, 33, n])
        _, edges = expander(n, seed=7)
        sizes = {e: int(rng.integers(2, 5)) for e in edges}
        status = {e: "C" for e in edges}
        P = prefix_restrictions(edges, sizes, D)
        delta, slices = coboundary(n, edges, P, D)
        x = honest_states(n, rng, D)
        g, _ = gen_cochain(edges, P, x, {})
        reps = []
        for _ in range(3):
            t0 = time.perf_counter()
            completion_residual(delta, slices, edges, status, g)
            reps.append(time.perf_counter() - t0)
        t_de.append(float(np.median(reps)))
    slope_de = float(np.polyfit(
        np.log([3 * n // 2 for n in ns_de]), np.log(t_de), 1)[0])
    print(f"      log-log slope vs |E|:  CG route {slope_cg:.2f}  "
          f"(linear-ish; expander kappa bounded)   full dense "
          f"{slope_de:.2f} (superlinear, the wasteful option)")
    check(slope_cg < 1.6, f"CG slope {slope_cg:.2f} < 1.6 — O(|E|*L*k) "
                          f"as claimed (k n-independent on expanders)")
    check(slope_de > slope_cg + 0.5,
          f"dense full-system slope {slope_de:.2f} clearly superlinear "
          f"(the decomposition is what buys linearity)")

    print("\n  3c. Robinson sup-radius corollary: one O(|E|*L) pass")
    rng = np.random.default_rng([SEED, 34])
    n, edges = two_path(12)
    sizes = {e: int(rng.integers(2, 5)) for e in edges}
    status = {e: "C" for e in edges}
    status[(0, 6)] = "R"
    P = prefix_restrictions(edges, sizes, D)
    delta, slices = coboundary(n, edges, P, D)
    x = honest_states(n, rng, D)
    liars = {0: {1: rng.normal(0, SIGMA_EQ, D)}}   # lie on a COMPARED edge
    g, _ = gen_cochain(edges, P, x, liars)
    supR = max(np.linalg.norm(g[e]) for e in edges if status[e] == "C")
    gh, _ = gen_cochain(edges, P, x, {})
    supH = max(np.linalg.norm(gh[e]) for e in edges if status[e] == "C")
    check(supH < TOL_SILENT and supR > TOL_DETECT,
          f"max_e ||g_e|| over compared pairs: honest {supH:.1e} = 0, "
          f"lied {supR:.3f} > 0 — zero iff no witnessed equivocation")
    # l2 bridge r <= sqrt(2) * fuse-radius, on the relayed-lie config
    liars = {0: {6: rng.normal(0, SIGMA_EQ, D)}}
    g, _ = gen_cochain(edges, P, x, liars)
    r, _, _, _ = completion_residual(delta, slices, edges, status, g)
    # fuse LS: min_x sum_{e,w} ||P_e x_w - rho_w^e||^2 over known edges
    known = [e for e in edges if status[e] in ("C", "R")]
    rowsF, rhsF = [], []
    for e in known:
        u, v = e
        s = sizes[e]
        ru = P[e] @ x[u]
        rv = P[e] @ x[v]
        for q, offs in liars.items():
            if u == q and v in offs:
                ru = P[e] @ (x[u] + offs[v])
            if v == q and u in offs:
                rv = P[e] @ (x[v] + offs[u])
        for (w, rep) in ((u, ru), (v, rv)):
            blk = np.zeros((s, n * D))
            blk[:, w * D:(w + 1) * D] = P[e]
            rowsF.append(blk)
            rhsF.append(rep)
    AF = np.vstack(rowsF)
    bF = np.concatenate(rhsF)
    xf, _, _, _ = np.linalg.lstsq(AF, bF, rcond=None)
    fuse = float(np.linalg.norm(bF - AF @ xf))
    check(r <= np.sqrt(2) * fuse + 1e-9,
          f"l2 bridge: r = {r:.4f} <= sqrt(2) * fuse-radius = "
          f"{np.sqrt(2) * fuse:.4f} (r > 0 forces positive Robinson "
          f"consistency radius)")


# --------------------------------------------------------------------------
# [4] boundary demonstrations
# --------------------------------------------------------------------------
def section4():
    print("\n" + "=" * 74)
    print("[4] WHAT r DOES NOT GIVE (boundary, demonstrated where "
          "testable)")
    print("=" * 74)
    rng = np.random.default_rng([SEED, 41])
    n, edges = two_path(12)
    sizes = {e: int(rng.integers(2, 5)) for e in edges}
    P = prefix_restrictions(edges, sizes, D)
    x = honest_states(n, rng, D)
    o = rng.normal(0, SIGMA_EQ, D)
    gA, _ = gen_cochain(edges, P, x, {0: {6: o}})     # q=0 lies toward 6
    gB, _ = gen_cochain(edges, P, x, {6: {0: -o}})    # 6 lies toward 0
    same = all(np.array_equal(gA[e], gB[e]) for e in edges)
    check(same, "attribution: liar q=0 (+o toward 6) and liar 6 (-o toward "
                "0) produce BIT-IDENTICAL observed data — r cannot name "
                "the signer (Sheng et al. CCS'21 forensic gap; signatures "
                "attribute, cohomology localizes)")
    delta, slices = coboundary(n, edges, P, D)
    status = {e: "C" for e in edges}
    status[(0, 6)] = "S"
    g, _ = gen_cochain(edges, P, x, {0: {6: o}})
    r, _, _, _ = completion_residual(delta, slices, edges, status, g)
    check(r < TOL_SILENT,
          f"severed darkness: same lie across a SEVERED edge, r = {r:.1e} "
          f"— detection needs the reports, not the check (R6 contract)")
    print("    [NOTE] Caru abelianization gap: vanishing r over R is not "
          "an all-clear for set-valued log states (arXiv:1701.00656, "
          "1807.04203) — external boundary, outside this vector model.")


# --------------------------------------------------------------------------
# [5] mutation suite
# --------------------------------------------------------------------------
def section5():
    print("\n" + "=" * 74)
    print("[5] MUTATION SUITE — the theorem checks' certificate")
    print("=" * 74)
    # M1: recompute r WITHOUT masking severed blocks (old D2 bug):
    # must violate honest-silence (fires on data it claims not to have).
    rng = np.random.default_rng([SEED, 51])
    n, edges = two_path(12)
    bridge = (0, 6)
    sizes = {e: int(rng.integers(2, 5)) for e in edges}
    P = prefix_restrictions(edges, sizes, D)
    delta, slices = coboundary(n, edges, P, D)
    x = honest_states(n, rng, D)
    g, _ = gen_cochain(edges, P, x, {0: {6: rng.normal(0, SIGMA_EQ, D)}})
    status = {e: "C" for e in edges}
    status[bridge] = "S"
    r_contract, _, _, _ = completion_residual(delta, slices, edges,
                                              status, g)
    status_mut = dict(status)
    status_mut[bridge] = "R"    # D2 mutant: severed rows silently included
    r_mut, _, _, _ = completion_residual(delta, slices, edges,
                                         status_mut, g)
    r_full, _, _, _ = completion_residual(delta, slices, edges,
                                          {e: "C" for e in edges}, g)
    caught = (r_contract < TOL_SILENT and r_mut > TOL_DETECT
              and abs(r_mut - r_full) < 1e-12)
    check(caught,
          f"D2 mutant CAUGHT: contract r = {r_contract:.1e} (dark), "
          f"unmasked mutant r = {r_mut:.3f} > 0 == full-visibility "
          f"{r_full:.3f} — honest-silence property violated by the "
          f"mutant exactly as the theorem predicts (CR-1(i) requires "
          f"the free block)")
    # M2: no-equivocator control across mixed visibility
    worst = 0.0
    for t in range(TRIALS):
        rng = np.random.default_rng([SEED, 52, t])
        n, edges = expander(12, seed=int(rng.integers(1 << 30)))
        m = len(edges)
        picks = rng.choice(m, size=6, replace=False)
        status = {e: "C" for e in edges}
        for i in picks[:3]:
            status[edges[i]] = "S"
        for i in picks[3:]:
            status[edges[i]] = "R"
        sizes = {e: int(rng.integers(2, 5)) for e in edges}
        P = prefix_restrictions(edges, sizes, D)
        delta, slices = coboundary(n, edges, P, D)
        x = honest_states(n, rng, D)
        g, _ = gen_cochain(edges, P, x, {})
        r, _, _, _ = completion_residual(delta, slices, edges, status, g)
        worst = max(worst, r)
    check(worst < TOL_SILENT,
          f"no-equivocator control: max r = {worst:.1e} over "
          f"{TRIALS} mixed-visibility trials (honest => r == 0 exactly, "
          f"CR-1(i))")


def main():
    np.set_printoptions(precision=3, suppress=True)
    print("CONSISTENCY-RADIUS THEOREM VERIFIER   seed", SEED,
          f"  stalk dim D={D}  trials/arm={TRIALS}")
    print("detector under proof: completion residual r of "
          "sheaf_harness_v2.py (R6 update, COMMIT)")
    section0()
    section1()
    section2()
    section3()
    section4()
    section5()
    print("\n" + "=" * 74)
    if FAILURES:
        print(f"RESULT: {len(FAILURES)} FAILED CHECK(S):")
        for f in FAILURES:
            print("  -", f)
        sys.exit(1)
    print("RESULT: all checks passed — CR-1 (soundness + c(topology)), "
          "CR-2\n(localization, noise-free exact + bounded-noise "
          "sufficient condition),\nCR-3 (decomposed least-squares, "
          "linear-ish CG scaling) verified;\nboundaries demonstrated; "
          "mutation suite red where required.")
    sys.exit(0)


if __name__ == "__main__":
    main()
