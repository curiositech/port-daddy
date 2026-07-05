# 3-Agent Triangle: Computing H¹ from Pheromone Disagreement Data

Consider three agents A₀, A₁, A₂ on a triangle graph G = (V, E) with:
- V = {0, 1, 2}, E = {(0,1), (1,2), (0,2)}
- Each agent maintains a 2-dimensional stalk: F(v) = ℝ², representing e.g. (belief in task urgency, confidence in route).
- Each edge stalk: F(e) = ℝ², representing the shared "discourse" variable on that link.

**Restriction maps** are the structural claim. Suppose:
- Edge (0,1): A₀ projects via R₀₁ = I₂ (identity); A₁ projects via R₁₀ = [[1,0],[0,-1]] (sign-flip on second coordinate — agents interpret confidence oppositely).
- Edge (1,2): both agents use identity.
- Edge (0,2): both agents use identity.

**Observed pheromone disagreement data** (read from the Medium after convergence):
- Edge (0,1): discrepancy vector d₀₁ = [0.0, 1.8]
- Edge (1,2): discrepancy vector d₁₂ = [0.0, 0.0]
- Edge (0,2): discrepancy vector d₀₂ = [0.0, 0.0]

Only edge (0,1) shows residual discrepancy after 200 diffusion steps.

## Computing the Coboundary Matrix δ

With n_verts=3, d_v=2, n_edges=3, d_e=2, δ has shape (6, 6). Laying out vertex blocks as columns [v0|v1|v2] and edge blocks as rows [e01|e12|e02]:

```
       v0 cols    v1 cols    v2 cols
e01: [ R₀₁      -R₁₀       0      ]    = [ I₂    -[[1,0],[0,-1]]   0  ]
e12: [ 0         R₁₂      -R₂₁    ]    = [ 0      I₂              -I₂ ]
e02: [ R₀₂       0        -R₂₀    ]    = [ I₂     0               -I₂ ]
```

Expanded numerically (with identity matrices written as 1s on diagonals):

```python
import numpy as np

I = np.eye(2)
Flip = np.array([[1, 0], [0, -1]])

delta = np.zeros((6, 6))
# edge (0,1): row-block 0, col-blocks 0,1
delta[0:2, 0:2] =  I       # +R from v0
delta[0:2, 2:4] = -Flip    # -R from v1 (note the sign convention)
# edge (1,2): row-block 1, col-blocks 1,2
delta[2:4, 2:4] =  I
delta[2:4, 4:6] = -I
# edge (0,2): row-block 2, col-blocks 0,2
delta[4:6, 0:2] =  I
delta[4:6, 4:6] = -I
```

## Finding H¹

```python
rank = np.linalg.matrix_rank(delta, tol=1e-9)
# delta is 6×6
h0_dim = 6 - rank   # dim ker(delta): global section space
h1_dim = 6 - rank   # for a graph (no 2-cells): dim Z¹ - rank(delta) = E*d_e - rank
```

For this sheaf, rank(δ) = 4 (verifiable by construction: the flip on edge (0,1) destroys one rank-1 contribution that would have been present with identity maps). Result:

- **h0_dim = 2**: two independent consensus modes (the "urgency" coordinate converges freely; "confidence" on edges (1,2) and (0,2) can still settle — those restriction maps are consistent).
- **h1_dim = 2**: two-dimensional obstruction space. The sign flip on edge (0,1) creates a cycle obstruction that no amount of diffusion resolves.

Formally: the 1-cochain formed by setting d₀₁ = [0, c] for any c ≠ 0, d₁₂ = d₀₂ = 0 is a 1-cocycle not in im(δ). It represents the irreconcilable disagreement: A₀ reads positive confidence, A₁ reads the same state as negative confidence, and no vertex assignment x ∈ C⁰ can explain away the discrepancy because their restriction maps are sign-inconsistent on the second coordinate.

## What the Operator Sees

After running `diagnose(delta, edges, d_e=2, x_current=x_equilibrium)`:

```
{
  "dirichlet_energy": 3.24,      # nonzero at equilibrium — structural, not transient
  "per_edge_energy": [3.24, 0.0, 0.0],
  "worst_edge": (0, 1),
  "worst_energy": 3.24
}
```

The edge (0,1) carries the full residual energy. The operator then calls `obstruction_cycles(delta, edges)` and gets a 6×2 matrix whose nonzero rows fall on the e01 block — confirming the obstruction is local to that edge's restriction map mismatch.

## What the Operator Does

1. **Do not increase diffusion step count or add more agents.** h1_dim = 2 is a topological fact about the restriction maps; it is invariant to dynamics.

2. **Identify the mismatched restriction map.** Here, A₁'s map on edge (0,1) uses Flip where A₀ uses I. The question becomes: is this intentional (agents genuinely have incompatible semantics for "confidence") or a configuration bug?

3. **Resolution options, in order of invasiveness:**
   - **Renegotiate the edge stalk.** Change F(e₀₁) to ℝ¹ (just urgency), dropping the conflicted dimension entirely. Restriction maps reduce to projections onto the first coordinate. H¹ drops to 0.
   - **Align the restriction map.** Change R₁₀ = I. Trivially closes H¹, but only valid if A₁'s confidence semantics really are the same as A₀'s.
   - **Introduce a translation agent on the edge.** Add an intermediary node that applies the semantic transform, splitting edge (0,1) into two edges with consistent restriction maps. Increases V and E but preserves agent autonomy.

4. **Verify the fix.** After modifying the sheaf, recompute rank(δ). h1_dim should fall to 0. Then re-run diffusion from the same initial conditions and confirm Dirichlet energy reaches 0.

## Key Points

- The coboundary matrix δ has shape (E·d_e) × (V·d_v); its rank fully determines both h0 and h1 for graphs (no higher simplices). Build it once, diagnose with it repeatedly.
- h1_dim > 0 is invariant to initial conditions and runtime length. If you observe it, no further simulation will fix the underlying coordination failure.
- Residual per-edge Dirichlet energy at equilibrium is the runtime signal; H¹ dimension is the algebraic certificate. They agree: high energy on edge e at equilibrium ↔ that edge participates in an obstruction cycle.
- The obstruction localization — `null_space(delta.T)` — produces H¹ basis vectors whose support (nonzero rows) names the edges in each irreconcilable cycle. Use this to scope the repair to the minimal subgraph.
- Fixing the sheaf (restriction maps or edge stalk dimension) is always the right repair; fixing the swarm (more agents, faster updates, longer runtime) cannot close a topological gap.

## See Also

- `SKILL.md § Implementation Pattern` — `build_delta`, `cohomology_dims`, `obstruction_cycles` implementations with full type signatures.
- `SKILL.md § Core Concepts` — formal definitions of F, δ, H⁰, H¹, Sheaf Laplacian, and Dirichlet energy.
- Hansen & Ghrist (2021) §3–§4 — proof that sheaf diffusion converges exactly to H⁰, and that any H¹ component in the initial discrepancy persists forever (Theorem 3.4).
