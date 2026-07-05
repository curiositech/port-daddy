# Discrete Graph Laplacian and Euler-Stable Diffusion

The pheromone field on the Medium is a 0-cochain: a scalar value p(v) assigned to each node v in graph G = (V, E). Diffusion spreads this field along edges, controlled by the **discrete graph Laplacian** L = D - A, where D is the diagonal degree matrix (D_vv = deg(v)) and A is the adjacency matrix (A_uv = 1 if (u,v) ∈ E).

The continuous heat equation on graphs is dp/dt = -αLp - γp + S(t), where α is the diffusion rate, γ is the decay rate, and S(t) is the source (pheromone deposits). For explicit Euler integration with timestep dt, the update per node v is:

    Δp(v) = α · dt · Σ_{u ~ v} [p(u) - p(v)]

This is exactly the row of -αLp for node v: each edge (u, v) contributes the signed difference, and summing over all neighbors gives the net in-flow. The sign is correct: if neighbors are richer than v, the sum is positive and p(v) rises.

## Euler Stability Condition

Explicit Euler on the heat equation is only stable when the spectral radius of the update operator stays below 1. The largest eigenvalue of L is bounded by 2·d_max (tight for bipartite graphs). The stability condition is therefore:

    α · dt · λ_max(L) < 1  →  dt < 1 / (α · 2·d_max)

In practice, soma uses the empirically conservative bound **dt_max = 0.9 / (α · d_max)** — slightly tighter than the theoretical 1/(α · d_max) derived from per-node analysis — providing a 10% safety margin against numerical blowup on near-bipartite or star topologies.

## How soma/medium.py:349-358 Implements It

The implementation in `Medium.tick()` does three things in sequence:

1. **Compute d_max** (line 343): `max(dict(self.graph.degree()).values())` — a full pass over all nodes. O(|V|).

2. **Clamp dt** (lines 346-347): `dt_eff = min(dt, 0.9 / (self.diffusion_rate * max_degree))`. If the caller passes a large dt (e.g., 1.0) and α = 0.3 on a hub with degree 20, dt_max = 0.9/(0.3·20) = 0.15, so dt_eff = 0.15. The caller's dt is silently clamped; no error is raised.

3. **Compute delta in one pass, apply in a second** (lines 350-361): the `delta` dict accumulates Δp(v) for all v before any p(v) is modified. This is a **synchronous** (Jacobi) update — all nodes see the field state at time t, not a mix of t and t+dt. Applying updates in-place during iteration would give Gauss-Seidel semantics, which changes convergence behavior and breaks determinism when the graph's node iteration order is arbitrary.

The pheromone floor `max(0.0, ...)` on line 361 prevents negative concentrations. This is physically correct (no negative pheromone) but introduces a nonlinearity that slightly breaks the linear heat equation analysis; in practice, this only bites at near-zero concentrations and has no observed stability impact.

The decay term (-γp) and source term (S(t)) are handled separately in other parts of `tick()`, not inside the Laplacian loop. This operator-splitting approach is first-order accurate in dt, which is fine given the already-clamped effective timestep.

## Key Points

- L = D - A; the per-node Laplacian is Σ_{u~v}(p(u) - p(v)), which is exactly what the inner loop accumulates.
- Euler stability requires dt < 1/(α·d_max) from per-node analysis; soma uses 0.9/(α·d_max) for a 10% margin.
- The two-pass (delta then apply) pattern is mandatory for synchronous (Jacobi) semantics — single-pass would give non-deterministic Gauss-Seidel order.
- Silent clamping of dt means callers do not need to know the graph's current d_max; the Medium self-governs stability.
- High-degree hub nodes (stars, dependency hubs) are the binding constraint on dt, not average degree.

## See Also

- `sheaf-laplacian-extension.md` — generalizes L to typed stalks F(σ), where each edge carries a restriction map; the scalar case here is the constant sheaf over R.
- `pheromone-decay-and-sources.md` — the γ decay and S(t) deposit terms that complete the full heat equation.
- Hansen & Ghrist (2021), "Opinion Dynamics on Discourse Sheaves" — convergence proof for sheaf Laplacian diffusion; the scalar graph case is Section 2.
