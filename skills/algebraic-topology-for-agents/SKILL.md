---
license: Apache-2.0
name: algebraic-topology-for-agents
description: >-
  Mathematical foundations and algorithmic recipes for applying algebraic topology, cellular sheaves, and simplicial
  Hodge theory to multi-agent systems. Use when formalizing agent state spaces as stalks, evaluating coboundary operators
  \delta_0, \delta_1, computing the Hodge decomposition of communication flows, determining topological consensus invariants,
  or detecting network cavities. NOT for generic graph theory (shortest paths/BFS) or basic network routing.
allowed-tools: Read,Write,Edit,Bash,Grep,Glob
metadata:
  category: Mathematics & Theory
  tags:
    - algebraic-topology
    - cellular-sheaves
    - simplicial-complexes
    - hodge-decomposition
    - cochain-complexes
    - cohomology
    - multi-agent-systems
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: sheaf-cohomology-multiagent-debug
      reason: Concrete diagnostic and active repair engine utilizing these topological primitives
    - skill: coordination-topology-architect
      reason: Determines when simplicial complexes are structurally required over acyclic trees
---

# Algebraic Topology for Multi-Agent Systems

## Mathematical Foundations

### 1. Cellular Sheaves over Simplicial Complexes
A **cellular sheaf** $\mathcal{F}$ over a regular cell complex or simplicial complex $X = (V, E, F)$ consists of:
1. For each cell $\sigma \in X$, an abelian group or vector space $\mathcal{F}(\sigma)$ called the **stalk** over $\sigma$.
2. For each incidence relation $\sigma \trianglelefteq \tau$ (where $\sigma$ is a face of $\tau$), a linear map:
   $$P_{\sigma \trianglelefteq \tau}: \mathcal{F}(\sigma) \to \mathcal{F}(\tau)$$
   called the **restriction map**, satisfying the identity $P_{\sigma \trianglelefteq \sigma} = \text{id}$ and transitivity:
   $$P_{\tau \trianglelefteq \gamma} \circ P_{\sigma \trianglelefteq \tau} = P_{\sigma \trianglelefteq \gamma}$$

In multi-agent systems:
- 0-cells $v \in V$ represent **agents** with private stalk spaces $\mathcal{F}(v) = \mathbb{R}^{D_v}$ (local beliefs, budgets, AST lock leases, commit hashes).
- 1-cells $e = (u, v) \in E$ represent **communication channels / review contracts** with shared interface stalk $\mathcal{F}(e) = \mathbb{R}^{d_e}$.
- 2-cells $\tau = (u, v, w) \in F$ represent **triadic review joins** (e.g. Producer-Critic-Manager contracts).

---

### 2. Cochain Complexes and Coboundary Operators
The space of **$k$-cochains** $C^k(X; \mathcal{F})$ is the direct sum of stalks over all $k$-cells:
$$C^0(X; \mathcal{F}) = \bigoplus_{v \in V} \mathcal{F}(v), \quad C^1(X; \mathcal{F}) = \bigoplus_{e \in E} \mathcal{F}(e), \quad C^2(X; \mathcal{F}) = \bigoplus_{\tau \in F} \mathcal{F}(\tau)$$

The **0-coboundary operator** $\delta_0: C^0 \to C^1$ evaluates local disagreements:
$$(\delta_0 x)_{e=(u,v)} = P_{v \trianglelefteq e} x_v - P_{u \trianglelefteq e} x_u$$

The **1-coboundary operator** $\delta_1: C^1 \to C^2$ evaluates circulation around 2-simplices $\tau = (u, v, w)$ bounded by $e_1 = (u, v)$, $e_2 = (v, w)$, $e_3 = (u, w)$:
$$(\delta_1 g)_{\tau} = g_{e_1} + g_{e_2} - g_{e_3}$$
By topological construction:
$$\delta_1 \circ \delta_0 = 0 \quad (\text{The boundary of a boundary is zero})$$

---

### 3. Simplicial Hodge Decomposition
Any observed communication flow (1-cochain) $g \in C^1(X; \mathcal{F})$ decomposes into three mutually orthogonal subspaces:
$$g = \underbrace{\delta_0 x}_{\text{gauge gradient}} + \underbrace{h}_{\text{harmonic } \in \mathcal{H}^1} + \underbrace{\delta_1^* \psi}_{\text{triadic curl}}$$
where:
1. **$\delta_0 x \in \operatorname{im}(\delta_0)$**: Exact potential difference. Can be eliminated by adjusting agents' local state coordinates.
2. **$\delta_1^* \psi \in \operatorname{im}(\delta_1^*)$**: Triadic curl. Represents local frustration on closed 3-party contracts ($\delta_1 g \neq 0$).
3. **$h \in \mathcal{H}^1 = \ker(\delta_1) \cap \ker(\delta_0^*)$**: Harmonic cochains. Locally consistent on all triangles ($\delta_1 h = 0$), but represents a global circulation around a non-contractible network cavity.

The **Hodge Laplacian** $\Delta_1: C^1 \to C^1$ is:
$$\Delta_1 = \delta_0 \delta_0^* + \delta_1^* \delta_1$$
By Hodge theory, $\dim \mathcal{H}^1 = \dim H^1(X; \mathcal{F})$ (the first cohomology group).

---

### 4. The Completion Residual & Invariant Detection
When edge data $g_K$ is observed on known channels $K \subseteq E$:
$$r = \min_{x} \| g_K - \delta_K x \|_2 = \| \Pi_K g_K \|_2$$
where $\Pi_K = I - \delta_K (\delta_K^T \delta_K)^+ \delta_K^T$.

**Soundness Theorem**: $r > 0 \iff$ no globally consistent agent state assignment exists that satisfies the observed messages.
**Effective Resistance Closed Form**: For an isolated lie of magnitude $s$ on channel $e$:
$$r = |s| \sqrt{1 - R_{\text{eff}}(e)}$$
where $R_{\text{eff}}(e) = (\mathbf{1}_v - \mathbf{1}_u)^T L_K^+ (\mathbf{1}_v - \mathbf{1}_u)$ is the electrical effective resistance of the edge.

---

## The Swarm Legibility Ratio ($\mathcal{L}$)
$$\mathcal{L}(g) = \frac{\|h\|_2^2}{\|h\|_2^2 + \|\delta_1^* \psi\|_2^2} \in [0, 1]$$

```
L(g) = 0.00 --------------------------- L(g) = 0.50 --------------------------- L(g) = 1.00
Micro-Contract Breach                     Hybrid Failure                          Macro Partition
Local triangle violated                  Mixed curl & cavity                      All triangles pass
Action: Re-prompt Critic/Dev             Action: Joint triage                     Action: Bridge sync
```

---

## References & Foundational Literature

1. **Hansen, J. & Ghrist, R. (2019).** "Toward a Spectral Theory of Cellular Sheaves." *Journal of Applied and Computational Topology*, 3(4):315–358.
2. **Bodnar, C. et al. (2022).** "Neural Sheaf Diffusion: A Topological Perspective on Heterophily and Oversmoothing in Graphs." *NeurIPS 2022*.
3. **Ghrist, R. & Riess, H. (2026).** "Cellular Sheaves of Lattices and the Tarski Laplacian for Distributed Optimization."
4. **Curiositech / Port Daddy (2026).** Harbor Research Program Paper 8: "Active Cellular Sheaf Cohomology for Scalable Swarm Verification."
