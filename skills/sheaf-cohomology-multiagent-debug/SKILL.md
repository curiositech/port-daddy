---
name: sheaf-cohomology-multiagent-debug
version: 0.1.0
description: >
  Diagnose multi-agent coordination failures using sheaf cohomology as a structural
  telemetry primitive. When agents cannot reach consensus despite diffusion, the cause
  is often topological: restriction maps on one or more edges are mutually inconsistent,
  creating a cycle-level obstruction that no amount of additional messaging can dissolve.
  H¹(G,F) ≠ 0 is the formal certificate of this obstruction — it identifies which cycles
  contain irreconcilable disagreements, letting you debug the sheaf (the communication
  structure) rather than the swarm (the agents). This skill provides the conceptual
  framework, a concrete implementation pattern, and decision criteria for when cohomology
  is the right diagnostic vs. when simpler tools suffice.
author: soma-jury_rig-graft
tags: [sheaf-cohomology, multi-agent, coordination, consensus, topology, diagnostics, active-inference, soma]
pairs-with: []
license: Apache-2.0
allowed-tools: Read,Write,Edit,Glob,Grep
metadata:
  provenance:
    kind: imported
    source: workgroup-ai / jury_rig skill library (rehomed 2026-07-04)
---

# Sheaf Cohomology as Multi-Agent Coordination Telemetry

## When to Use

- Agents have been running diffusion / gossip / opinion-update dynamics for many steps and residual disagreement persists despite apparent convergence — you suspect the disagreement is structural, not transient.
- You have a cycle in the agent communication graph and at least one edge where two agents project their private state through **different** restriction maps into a shared discourse space (i.e., they literally interpret the shared variable differently).
- A new agent or communication channel was added and coordination degraded; you need to know whether the topology change introduced a cohomological obstruction.

NOT for:
- Debugging transient disagreement that resolves if you wait longer — that is a convergence-rate problem, diagnosed by the sheaf Fiedler value λ₂(L_F), not by cohomology.
- Keyword-based or heuristic detection of "conflict" in agent messages — this skill requires algebraically specified stalks and restriction maps, not free-text analysis.
- Systems where agents do not share an explicit algebraic state space (e.g., purely language-model ensembles with no vector stalks) — cohomology is not applicable without a defined linear structure.

## Core Concepts

**Cellular sheaf F on graph G = (V, E)**: An assignment of a finite-dimensional real vector space F(v) (the *stalk*) to each vertex, a space F(e) to each edge, and a linear *restriction map* F_{v ▹ e}: F(v) → F(e) for each incidence pair. Stalks encode private agent state; restriction maps encode how each agent projects state into the shared discourse on that edge.

**Coboundary operator δ: C⁰(G;F) → C¹(G;F)**: The fundamental disagreement measurement. For edge e = (u, v):
```
(δx)_e = F_{v ▹ e}(x_v) - F_{u ▹ e}(x_u)
```
δx = 0 on every edge iff x is a *global section* — all agents are perfectly consistent after projection. The coboundary operator encodes the difference in what each agent contributes to the shared discourse on each link.

**H⁰(G;F) = ker(δ)**: The space of global sections — assignments where every adjacent pair is consistent after restriction. dim(H⁰) counts the number of independent consensus modes. H⁰ = {0} means no consensus is topologically reachable from any initial condition. H⁰ is what sheaf diffusion converges toward; ker(L_F) = H⁰.

**H¹(G;F) = Z¹ / im(δ)**: The obstruction group. Z¹ = ker(d₁: C¹ → C²); for graphs with no 2-simplices, Z¹ = C¹ = all of edge-stalk space. im(δ) is the set of edge discrepancies that *can* be explained by some choice of vertex data. H¹ is the quotient — edge discrepancy patterns that cannot be explained by any vertex assignment. **dim(H¹) > 0 means there exist cycles where the restriction maps are mutually inconsistent: settlement is topologically impossible for those configurations regardless of how agents update.**

**Sheaf Laplacian and Dirichlet energy**: L_F = δᵀδ (PSD matrix on C⁰). Dirichlet energy:
```
E(x) = xᵀ L_F x = ||δx||² = Σ_{e=(u,v)} || F_{u▹e}(x_u) - F_{v▹e}(x_v) ||²
```
E(x) = 0 iff x ∈ H⁰. Sheaf diffusion dx/dt = -α L_F x minimizes E(x) and converges to the projection onto H⁰. If E(x) > 0 at equilibrium, the nonzero-energy edges are the diagnostic outputs.

## Implementation Pattern

```python
import numpy as np
from scipy.linalg import null_space

# --- 1. Specify the sheaf ---
# For a graph with V vertices (stalk dim d_v each) and E edges (stalk dim d_e each):
# Vertex state: x ∈ R^(V * d_v)   (concatenated stalk vectors)
# Edge state:   C1 ∈ R^(E * d_e)

# For each edge e = (u, v), define:
#   R_u: (d_e x d_v) restriction map from u's stalk to e's stalk
#   R_v: (d_e x d_v) restriction map from v's stalk to e's stalk

# --- 2. Build coboundary matrix delta ---
# Shape: (E * d_e) x (V * d_v)
# One block-row per edge. For edge e = (u, v):
#   delta[e_block, u_block] = +R_u
#   delta[e_block, v_block] = -R_v
#   all other blocks = 0

def build_delta(edges, restriction_maps, n_verts, d_v, d_e):
    n_edges = len(edges)
    delta = np.zeros((n_edges * d_e, n_verts * d_v))
    for i, (u, v) in enumerate(edges):
        R_u, R_v = restriction_maps[(u, v)]
        delta[i*d_e:(i+1)*d_e, u*d_v:(u+1)*d_v] =  R_u
        delta[i*d_e:(i+1)*d_e, v*d_v:(v+1)*d_v] = -R_v
    return delta

# --- 3. Compute sheaf Laplacian ---
def sheaf_laplacian(delta):
    return delta.T @ delta   # (V*d_v) x (V*d_v), PSD

# --- 4. Cohomology dimensions ---
def cohomology_dims(delta):
    n_vertex_dims = delta.shape[1]
    n_edge_dims   = delta.shape[0]
    rank = np.linalg.matrix_rank(delta, tol=1e-9)
    h0_dim = n_vertex_dims - rank   # dim ker(delta)
    h1_dim = n_edge_dims - rank     # for graphs: dim Z1 - dim im(delta) = E*d_e - rank
    return h0_dim, h1_dim

# --- 5. Diagnose current agent state ---
def diagnose(delta, edges, d_e, x_current):
    edge_discrepancies = delta @ x_current    # (E*d_e,)
    per_edge_energy = []
    for i in range(len(edges)):
        d = edge_discrepancies[i*d_e:(i+1)*d_e]
        per_edge_energy.append(float(d @ d))
    dirichlet_energy = sum(per_edge_energy)
    worst_edge_idx   = int(np.argmax(per_edge_energy))
    return {
        "dirichlet_energy": dirichlet_energy,
        "per_edge_energy":  per_edge_energy,
        "worst_edge":       edges[worst_edge_idx],
        "worst_energy":     per_edge_energy[worst_edge_idx],
    }

# --- 6. Decision tree ---
# h0_dim == 0  →  No consensus is topologically reachable. Redesign stalks or restriction maps.
# h1_dim == 0  →  Consensus is reachable; slow convergence is a rate problem (check λ₂).
# h1_dim > 0   →  Structural obstruction. Identify the cycle(s): find null_space(delta.T)
#                  to get the H¹ cocycles. Each basis vector localizes to a cycle.
# dirichlet_energy plateaus > 0 at equilibrium  →  Same as h1_dim > 0 in practice.
# worst_edge has high energy at equilibrium  →  That edge's restriction maps are the conflict locus.

# --- 7. Localize the obstruction ---
def obstruction_cycles(delta, edges):
    # Rows of null_space(delta.T) are H1 cocycles — they identify conflicting edge sets
    ns = null_space(delta.T, rcond=1e-9)   # columns are basis for H1
    return ns   # nonzero rows indicate which edges participate in obstructions
```

**Operator interpretation of outputs:**
- `h0_dim`: number of independent consensus modes. If 0, no consensus is possible.
- `h1_dim`: number of topological obstructions. If > 0, some cycles have irreconcilable restriction maps.
- `dirichlet_energy` at equilibrium: if nonzero, disagreement is structural, not transient.
- `per_edge_energy` at equilibrium: large values pinpoint the conflicted edges.
- `obstruction_cycles`: H¹ basis vectors localize which cycles contain each obstruction.

**Fix the sheaf, not the swarm:** When h1_dim > 0, the remedy is not more agents, faster diffusion, or longer runtime. The remedy is to modify a restriction map on the conflicted cycle — change what one agent projects into the shared discourse space on that edge — until the cycle becomes consistent (H¹ drops to 0).

## Key References

1. **Hansen, J. & Ghrist, R. (2021).** "Opinion Dynamics on Discourse Sheaves." *SIAM Journal on Applied Mathematics*, 81(5), 2033–2060. arXiv:2005.12798. Foundational paper: defines discourse sheaves, proves convergence of sheaf diffusion to ker(L_F) = H⁰, introduces H¹ as the formal obstruction to consensus. The proof that non-trivial H¹ implies residual disagreement is unavoidable regardless of initial conditions.

2. **Riess, H. & Hale, M. (2025).** "Distributed Multi-agent Coordination over Cellular Sheaves." arXiv:2504.02049. Extends to nonlinear sheaf diffusion with delay bounds; provides Algorithm 1 (ADMM-based distributed solve); frames Dirichlet energy as the coordination cost metric. Convergence proofs include explicit λ₂(L_F) rate bounds.

3. **Ayzenberg, A. et al. (2026).** "Selective Adaptation of Beliefs and Communication on Cellular Sheaves." arXiv:2601.22431. Most precise formulation of H¹ obstruction classes for bounded consensus; introduces selective rigidity and the boundary map ∂: H⁰(stubborn subgraph) → H¹(remaining sheaf) as a diagnostic tool for locating the failure to specific agent subpopulations.

4. **kb1dds/pysheaf** (github.com/kb1dds/pysheaf). The primary open-source Python library for cellular sheaf cohomology. `Sheaf.cohomology()`, `Sheaf.cobetti()`, `Sheaf.consistencyRadius()`. Takes stalks as numpy arrays and restriction maps as functions. Use when you want algebraically exact cohomology computations rather than the rank-based approximation above.
