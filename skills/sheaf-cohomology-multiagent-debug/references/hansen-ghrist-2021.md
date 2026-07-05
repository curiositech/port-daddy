# Opinion Dynamics on Discourse Sheaves (Hansen & Ghrist 2021)

The paper "Opinion Dynamics on Discourse Sheaves" (Hansen & Ghrist, SIAM J. Applied Math, 2021) gives a rigorous algebraic foundation for why multi-agent disagreement either converges or persists irreconcilably. Every concept maps directly to debuggable system state.

## The Construction

Each agent `i` holds an **opinion vector** `x_i ∈ ℝ^{d_i}`, living in a stalk `F(i)` of a cellular sheaf `F` over a graph `G = (V, E)`. Stalks can have different dimensions — agent `i` may hold opinions on 3 topics, agent `j` on 5. The graph edges encode *who influences whom*.

For each edge `e = (i,j)`, a pair of **restriction maps** `F(i ◁ e) : F(i) → F(e)` and `F(j ◁ e) : F(j) → F(e)` project both endpoints' opinions into a shared **edge stalk** `F(e)`. These restriction maps are the influence weights — they encode not just "how much" but "onto which subspace" agent `i`'s opinion is projected when compared to agent `j`'s.

The **sheaf Laplacian** is:

```
L_F = B^T · diag(F-edge-maps) · B
```

where `B` is the signed incidence matrix of `G`. Concretely, `L_F` acts on the global section space `C^0(F) = ⊕_i F(i)`. The `(i,i)` block is `∑_{e∋i} F(i ◁ e)^T F(i ◁ e)` and the off-diagonal `(i,j)` block is `-F(i ◁ e)^T F(j ◁ e)` for the edge between them. This is exactly the generalized graph Laplacian with matrix-valued weights.

## The Dynamics

Opinion dynamics follow the continuous-time flow:

```
ẋ = -L_F x
```

This drives the system toward the **kernel of L_F**. The kernel is precisely the space of **global sections**: assignments `x` where `F(i ◁ e) x_i = F(j ◁ e) x_j` for every edge `e = (i,j)`. A global section means every agent's projection onto shared discourse agrees with every neighbor's projection — consensus on the shared subspace.

## H¹ and Irreconcilable Disagreement

Here is the critical diagnostic. The **first sheaf cohomology** `H¹(G; F)` measures the obstruction to extending local agreements to a global section.

- `H¹(G; F) = ker(δ¹) / im(δ^0)` where `δ^0` is the coboundary map on 0-cochains (vertex assignments → edge disagreements).
- If `H¹ = 0`: any locally consistent assignment (no edge-wise disagreement) extends to a global section. The system converges to consensus.
- If `H¹ ≠ 0`: there exist disagreement patterns on edges that are locally balanced (every vertex's net influence is zero) but globally non-trivial — they cannot be resolved by any agent update. The cohomology class is the *shape* of the irreconcilable conflict.

In practice: compute `dim(H¹) = dim(ker L_F on 1-cochains) - dim(im δ^0)`. A nonzero dimension means the multi-agent system has a structural deadlock independent of initial conditions or step size.

For the SOMA medium: if agents leave conflicting BELIEF traces that form a non-trivial 1-cocycle, no amount of diffusion resolves the conflict — the sheaf topology forbids it. This is the mathematical reason why the belief market (Week 3) must intervene: markets break the cohomological obstruction by repricing, which is equivalent to deforming the restriction maps.

## Spectral Gap and Convergence Rate

For sheaves where `H^0 = ℝ` (connected graph, consensus-capable), the convergence rate is governed by `λ_2(L_F)`, the second-smallest eigenvalue of the sheaf Laplacian (Fiedler value analog). Larger `λ_2` → faster convergence. The spectral gap depends on both graph topology and the choice of restriction maps. Sparse graphs with weak restriction maps (small operator norms) have slow convergence. This gives a concrete tuning handle: increasing the operator norm of restriction maps speeds consensus at the cost of amplifying disagreements on non-global-section directions.

## Key Points
- Restriction maps are not scalar weights — they are linear maps between vector spaces of potentially different dimensions; debuggable as matrices `F(i ◁ e) ∈ ℝ^{d_e × d_i}`
- `H¹ ≠ 0` is a topological invariant of the sheaf structure, not the initial condition — no iterative solver escapes it
- Convergence to global section (consensus) requires `H^0(G; F) = ℝ^k` for k-dimensional shared consensus; if `H^0` is higher-dimensional, multiple disconnected consensus attractors exist
- The sheaf Laplacian `L_F` is always positive semidefinite; `ker(L_F) = H^0(G; F)` exactly
- In SOMA, mismatched restriction maps between BELIEF and PREFERENCE traces can synthesize artificial `H^1` obstructions — check that trace types project onto compatible subspaces

## See Also
- `riess-hale-2025.md` — Distributed computation of sheaf Laplacian eigenvectors; how agents approximate `λ_2` without global coordination
- `friston-2010.md` — Free energy as an alternative convergence criterion; EFE minimization implicitly deforms restriction maps
- `soma/medium.py` — `sheaf_laplacian()` method; `global_uncertainty_map()` uses `H^0` dimension estimate via rank of `L_F`
