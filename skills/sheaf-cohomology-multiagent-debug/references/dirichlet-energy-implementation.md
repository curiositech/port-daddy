# Dirichlet Energy as Real-Time Disagreement Metric: Implementation Reference

Dirichlet energy `E(x) = xᵀ L_F x = ‖δx‖²` is the canonical scalar summary of how far a
multi-agent state is from consensus. It equals the sum of squared restriction-map
discrepancies across every edge:

```
E(x) = Σ_{e=(u,v)} ‖ F_{u▹e}(x_u) − F_{v▹e}(x_v) ‖²
```

Each term is the squared norm of the coboundary on one edge — the amount by which the two
endpoints' projections into the shared edge stalk disagree. This decomposition is the
feature that makes E useful operationally: it localizes disagreement to specific edges,
not just to the swarm as a whole.

## Computing E from Agent Outputs

Given:
- `delta`: the coboundary matrix built by `build_delta()` (SKILL.md §Implementation,
  shape `(E·d_e, V·d_v)`)
- `x`: concatenated current agent stalk vectors, shape `(V·d_v,)`

```python
def dirichlet_energy(delta, x):
    edge_discrep = delta @ x          # shape (E·d_e,)
    return float(edge_discrep @ edge_discrep)   # scalar, ≥ 0

def per_edge_energy(delta, x, n_edges, d_e):
    edge_discrep = delta @ x
    return [float(edge_discrep[i*d_e:(i+1)*d_e] @
                  edge_discrep[i*d_e:(i+1)*d_e])
            for i in range(n_edges)]
```

If agents expose their stalk vectors directly (common in SOMA's `Agent.state` pattern),
concatenate them in the same vertex ordering used when building `delta`. If agents only
emit scalar summaries, promote to vectors before calling these functions — E is not
defined on scalars unless `d_v = d_e = 1`.

## Thresholds: Healthy Consensus vs. Alert

No single universal threshold exists; E is scale-dependent (scales as `‖x‖²`). Normalize:

```python
def normalized_energy(delta, x):
    norm_sq = float(x @ x)
    if norm_sq < 1e-12:
        return 0.0
    return dirichlet_energy(delta, x) / norm_sq
```

**Operational thresholds for normalized E:**

| `E(x) / ‖x‖²` | Interpretation |
|---|---|
| < 0.01 | Healthy consensus. Diffusion has converged. No action needed. |
| 0.01 – 0.10 | Elevated disagreement. Monitor: may be transient (convergence still in progress) or structural. Run `h1_dim` check (see below). |
| > 0.10 at equilibrium | Alert: structural obstruction likely. `h1_dim > 0` is the definitive test. |

"At equilibrium" is the critical qualifier. Check whether the **rate of change** of E has
dropped below a second threshold (e.g., `|dE/dt| < 1e-4 · E`) before treating a value as
settled. Transient high E during early diffusion is normal.

## Distinguishing Transient from Structural Disagreement

A plateau in E — E is not decreasing and `|dE/dt|` is small — with `E > 0` is the
runtime signature of `h1_dim > 0`. Verify with:

```python
from scipy.linalg import matrix_rank

def h1_dim(delta):
    rank = matrix_rank(delta, tol=1e-9)
    n_edge_dims = delta.shape[0]
    return n_edge_dims - rank
```

If `h1_dim > 0`, the non-zero plateau is permanent regardless of step count or
diffusion coefficient. If `h1_dim == 0`, the plateau is transient: increase α or run
longer — E will eventually reach zero.

## Graph-Laplacian Approximation

When stalks are scalars (`d_v = d_e = 1`) and all restriction maps are the identity
(`R_u = R_v = 1` for all edges), the sheaf Laplacian reduces exactly to the ordinary
graph Laplacian L = D − A. In this regime:

```python
import numpy as np

def graph_laplacian_energy(A, x):
    """A: adjacency matrix (n x n). x: agent scalar values (n,)."""
    degrees = A.sum(axis=1)
    L = np.diag(degrees) - A
    return float(x @ L @ x)
```

Use this as a lightweight proxy for monitoring when you have not yet built the full
sheaf. Its per-edge decomposition is `Σ_{(u,v)∈E} (x_u − x_v)²`. The approximation is
exact under the identity restriction hypothesis and useful as a cheap health metric even
when non-identity restriction maps exist, provided disagreement is small (restriction
maps depart little from identity). For large departures, full `‖δx‖²` is required.

## Practical Monitoring Loop

```python
E_prev = None
plateau_count = 0
PLATEAU_STEPS = 10
PLATEAU_TOL = 1e-4

for step in range(max_steps):
    x = run_diffusion_step(x, L_F, alpha=0.1)
    E = dirichlet_energy(delta, x)
    E_norm = E / max(x @ x, 1e-12)

    if E_prev is not None:
        dE = abs(E - E_prev)
        if dE < PLATEAU_TOL * E:
            plateau_count += 1
        else:
            plateau_count = 0

    if plateau_count >= PLATEAU_STEPS:
        if E_norm > 0.01:
            h1 = h1_dim(delta)
            alert(f"Structural obstruction: h1={h1}, E_norm={E_norm:.4f}",
                  edges=worst_edges(delta, x, n_edges, d_e))
        break
    E_prev = E
```

## Key Points

- E(x) = ‖δx‖² decomposes by edge; always report per-edge energies, not just the scalar total, so the operator sees which agent pair is the conflict locus.
- Normalize by ‖x‖² before thresholding; raw E is scale-sensitive and meaningless without it.
- A plateau with E_norm > 0.01 is the runtime trigger for `h1_dim` computation — the algebraic obstruction check. Do not run `h1_dim` every step; it involves `matrix_rank` and is O(n³).
- When restriction maps are all identity, the graph Laplacian is an exact substitute and dramatically cheaper to build.
- E = 0 at equilibrium guarantees x ∈ H⁰ (global section); this is the only exit criterion worth trusting for confirmed consensus.

## See Also

- `SKILL.md §Core Concepts` — full definition of δ, L_F, H⁰, H¹ and the sheaf diffusion ODE
- `references/obstruction-localization.md` — how to read `null_space(delta.T)` to pinpoint which cycle contains each H¹ obstruction
- Riess & Hale (2025), arXiv:2504.02049 — explicit λ₂(L_F) convergence rate bounds (relevant when E_norm is elevated but `h1_dim == 0`)
