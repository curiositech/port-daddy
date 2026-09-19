---
license: Apache-2.0
name: algebraic-topology-for-agents
description: Formalize and compute algebraic topology, cellular sheaves, coboundary operators, and simplicial Hodge decompositions over multi-agent swarm complexes. Use when representing heterogeneous agent states as stalks, proving consensus invariants, evaluating the completion residual r = ||\Pi_K g_K||_2, or separating micro-contract breaches from macro partition cavities. NOT for generic graph algorithms (BFS/Dijkstra), standard network flow, or purely text-based LLM analysis.
allowed-tools: Read,Write,Edit,Bash,Grep,Glob
argument-hint: '[action: cochain-solve|hodge-decompose|effective-resistance] [complex-dim: 1d|2d]'
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
    - consensus
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: sheaf-cohomology-multiagent-debug
      reason: Concrete diagnostic and active repair engine utilizing these topological primitives
    - skill: coordination-topology-architect
      reason: Determines when simplicial complexes are structurally required over acyclic trees
    - skill: vast-ai-gpu-clusters
      reason: Offloads large-scale Hodge Laplacian sparse matrix solves when local RAM exhausts
    - skill: bostockesque-data-viz
      reason: High-fidelity visual rendering of simplicial complexes and cochain residuals
---

# Algebraic Topology for Multi-Agent Systems: Cellular Sheaves & Hodge Theory

Formal mathematical framework for certifying distributed agent fleet consistency, proving consensus invariants, and localizing coordination conflicts using cellular sheaves and simplicial Hodge theory.

## Philosophy

**Multi-agent fleets are cell complexes, not flat trees.** In distributed coordination, individual agent states (AST leases, commit digests, token budgets) live on vertices, pairwise interactions live on edges, and multi-party review joins live on 2-simplices (triangles). 

Consistency is algebraic exactness: an observed interaction cochain $g_K$ is consistent if and only if it lies in the image of the coboundary operator ($\operatorname{im} \delta_0$). When agents disagree or hallucinate, the coboundary equation cannot be satisfied. Simplicial Hodge theory canonically decomposes this obstruction into mutually orthogonal subspaces:
1. **Gradient ($\operatorname{im} \delta_0$)**: Benign, globally resolvable gauge shifts (clock drift, uniform base path renames).
2. **Harmonic ($\ker L_1$)**: Macro topological cavities (network partitions, communication voids, uncontractible loops).
3. **Curl ($\operatorname{im} \delta_1^*$)**: Micro-contract breaches (broken triadic review invariants, conflicting local AST leases).

---

## When to Use

✅ **Use for**:
- Formalizing agent communication topologies as 1-skeletons and 3-way peer review contracts as 2D simplicial complexes.
- Representing heterogeneous agent states, AST locks, and semantic commitments as algebraic stalks $\mathcal{F}(v) \in \mathbb{R}^D$ and restriction maps $\mathcal{F}_{v \trianglelefteq e}$.
- Computing the completion residual $r(t) = \|\Pi_K g_K(t)\|_2$ to mathematically certify global consistency without centralized aggregation.
- Applying Simplicial Hodge Decomposition to classify anomalies into micro-contract violations vs. macro partition cavities via the Swarm Legibility Ratio $\mathcal{L}(g)$.
- Calculating localized effective resistance $R_{\text{eff}}(e)$ to predict alarm sensitivity to isolated agent hallucinations.

❌ **NOT for**:
- Standard graph search algorithms (BFS, DFS, Dijkstra, Prim's minimum spanning tree).
- Traditional consensus algorithms (Raft, Paxos) that require total ordering and cluster-wide leader election.
- Purely qualitative prompt evaluation lacking typed contracts or algebraic vector spaces.
- Generic network routing or standard TCP socket management.

---

## Decision Points

### Action Branch Selection

```
Query analysis:
├─ Contains "stalk" OR "sheaf" OR "restriction map" → SHEAF-DEFINITION path
├─ Contains "residual" OR "consistency" OR "alarm" → COMPLETION-RESIDUAL path
├─ Contains "hodge" OR "harmonic" OR "curl" → HODGE-DECOMPOSITION path
├─ Contains "effective resistance" OR "sensitivity" → SENSITIVITY path
└─ Contains "tree" OR "blindness" OR "topology" → TOPOLOGY-ANALYSIS path
```

### Complex Topology Selection Tree

```
Agent interaction structure:
├─ Pairwise requests only & no 3-way validation → 1D Graph Complex (Harmonic cycles only; curl is zero)
├─ Code review / 2-agent verification with supervisor → 2D Simplicial Complex (Traps micro curl obstructions)
├─ Heterogeneous vector representations across agents → Cellular Sheaf with non-trivial restriction maps P_e
└─ Pure hierarchy / supervisor-worker dispatch → Degenerate Tree (WARNING: Invariant blind! Pi_tree = 0)
```

### Cohomological Diagnostic Pipeline

```mermaid
flowchart TD
    A[Observed Cochain g_K on Active Channels] --> B[Assemble Incidence Matrix delta_0 & delta_1]
    B --> C[Solve Normal Equations: delta_K^T delta_K x = delta_K^T g_K]
    C --> D[Compute Orthogonal Residual: rho = g_K - delta_K x]
    D --> E[Calculate Scalar Residual: r = ||rho||_2]
    
    E --> F{r < 1e-6?}
    F -->|Yes| G[GLOBAL CONSENSUS: Cochain is exact coboundary]
    F -->|No| H[COORDINATION OBSTRUCTION DETECTED]
    
    H --> I[Compute Simplicial Hodge Decomposition on rho]
    I --> J[Extract Harmonic h in ker L_1 & Curl c in im delta_1^*]
    J --> K["Compute Legibility Ratio: L = ||h||^2 / (||h||^2 + ||c||^2)"]
    
    K -->|L < 0.30| L[MICRO-CONTRACT BREACH: Conflicting AST lock or review disagreement]
    K -->|L > 0.70| M[MACRO CAVITY: Network partition or non-contractible loop]
    K -->|0.30 <= L <= 0.70| N[HYBRID COLLISION: Simultaneous local and global drift]
    
    L --> O[Isolate Contested Edge via ArgMax rho_e]
    M --> P[Bridge Cut-Vertex or Reconnect Partition]
```

---

## Core Invariants & Closed Forms

### 1. The Tree Blindness Invariant ($\Pi_{\text{tree}} \equiv \mathbf{0}$)
In any connected acyclic tree $T = (V, E)$ with $|V|$ vertices and $|E| = |V| - 1$ edges:
$$\operatorname{rank}(\delta_0) = |E| \implies \ker(\delta_0^T) = \{\mathbf{0}\} \implies \Pi_{\text{tree}} = I - \delta_0 (\delta_0^T \delta_0)^{-1} \delta_0^T \equiv \mathbf{0}$$
**Theorem**: A tree topology is mathematically blind to agent disagreements. Any hallucination, AST race, or false report is swallowed as a free gauge transformation $\hat{x}$. Detection of coordinate-free obstructions strictly requires closed cycles ($\beta_1 \ge 1$).

### 2. Closed-Form Effective Resistance Sensitivity (CR-1)
For an isolated agent error or lie of magnitude $s$ on edge $e = (u, v)$:
$$r = |s| \sqrt{1 - R_{\text{eff}}(e)}$$
where $R_{\text{eff}}(e) = (\mathbf{1}_v - \mathbf{1}_u)^T L_K^+ (\mathbf{1}_v - \mathbf{1}_u)$ is the electrical effective resistance across the edge, and $L_K^+$ is the Moore-Penrose pseudo-inverse of the grounded graph Laplacian.

### 3. Simplicial Hodge Orthogonal Decomposition
Any 1-cochain $g \in C^1(X; \mathbb{R})$ over a 2D simplicial complex decomposes uniquely as:
$$g = \underbrace{\delta_0 \phi}_{\text{Gradient}} + \underbrace{h}_{\text{Harmonic}} + \underbrace{\delta_1^* \psi}_{\text{Curl}}$$
where $\delta_0 \phi \in \operatorname{im}(\delta_0)$, $h \in \ker(L_1)$, and $\delta_1^* \psi \in \operatorname{im}(\delta_1^*)$. The subspaces are mutually orthogonal under the standard $L^2$ inner product:
$$\langle \delta_0 \phi, h \rangle = 0, \quad \langle \delta_0 \phi, \delta_1^* \psi \rangle = 0, \quad \langle h, \delta_1^* \psi \rangle = 0$$

### 4. Swarm Legibility Ratio $\mathcal{L}(g)$
Measures the proportion of residual obstruction attributable to macro topological cavities versus localized contract violations:
$$\mathcal{L}(g) = \frac{\|h\|_2^2}{\|h\|_2^2 + \|\delta_1^* \psi\|_2^2}$$

---

## Failure Modes

### Tree Topology Blindness
- **Detection**: Completion residual reads $r(t) = 0.0000$ despite known conflicting outputs between agents.
- **Symptoms**: Silent failures, contradictory code merged into repository, phantom task completions.
- **Fix**: Augment the coordination graph with cross-validation cycles ($\beta_1 \ge 1$) and 2-simplices for peer verification joins.
- **Timeline**: Proven in Port Daddy Harbor Research Program Paper 8 (2026).

### Gauge Gradient Conflation
- **Detection**: High raw differences on edge cochains ($\|g_K\| \gg 0$) while the residual is zero ($r = 0$).
- **Symptoms**: False alarms raised on benign global shifts (e.g. uniform timestamp offsets or global directory renames).
- **Fix**: Discard the raw cochain magnitude; evaluate only the orthogonal projection onto $\ker(\delta_0^T)$ ($r = \|\Pi_K g_K\|_2$).
- **Timeline**: Fundamental theorem of Hodge Helmholtz decomposition.

### Unsigned Boundary Orientation Inversion
- **Detection**: $\delta_1 \delta_0 \ne 0$ in numerical sanity check.
- **Symptoms**: Hodge decomposition yields non-orthogonal components; spurious non-zero residuals on perfectly consistent states.
- **Fix**: Impose a strict global canonical vertex ordering ($v_0 < v_1 < v_2$) on all faces $\tau = [v_0, v_1, v_2]$, defining $\delta_1 [v_0, v_1, v_2] = [v_1, v_2] - [v_0, v_2] + [v_0, v_1]$.
- **Timeline**: Standard simplicial homology boundary rule ($\partial^2 \equiv 0$).

### Singular Matrix Inversion on Degenerate Laplacians
- **Detection**: Numerical solver raises `LinAlgError: Singular matrix` when inverting $\delta_0^T \delta_0$.
- **Symptoms**: Diagnostic crash on startup or when testing disconnected subgraphs.
- **Fix**: Use Moore-Penrose pseudo-inverse (`np.linalg.pinv` / SVD) or ground a reference vertex by deleting one row and column from $L_0$.
- **Timeline**: Classic graph Laplacian nullspace property ($\ker L_0 = \operatorname{span}(\mathbf{1})$ for connected components).

---

## Shibboleths / Anti-Patterns

### Abstract Betti-Number Fallacy
- **Novice**: Computes abstract Betti numbers $\beta_1 = \dim H^1(X)$ without observed cochain data, asserting that $\beta_1 > 0$ indicates a system error.
- **Expert**: $\beta_1$ measures only the topological *capacity* of the network to support circulation. Errors exist only when the observed cochain $g_K$ has a non-zero projection onto that subspace ($r = \|\Pi_K g_K\|_2 > 0$).
- **Timeline**: Corrected in Port Daddy Harbor Research Program Paper 8 (2026).

### Edge-Wise Thresholding Without Orthogonal Projection
- **Novice**: Compares individual edge differentials $|g_e|$ to a static threshold, failing to recognize that large gradient gauge shifts are globally consistent while tiny curl circulations break consensus.
- **Expert**: Orthogonally projects $g_K$ onto $\ker(\delta_K^T)$ to isolate true invariant-violating circulation from benign gauge gradients.
- **Timeline**: Standard in continuum mechanics and cellular sheaf signal processing since 2018.

### Hierarchical Tree Super-Agent Illusion
- **Novice**: Designs agent architectures as strict supervisory trees (e.g., standard LangGraph/CrewAI trees), assuming the supervisor will catch all worker errors.
- **Expert**: Proves algebraically that tree topologies have $\Pi_{\text{tree}} \equiv \mathbf{0}$, meaning worker contradictions are mathematically hidden from topological detection unless closed review cycles are present.
- **Timeline**: Proven in 2026 active cellular sheaf cohomology research.

---

## Worked Examples

### Example 1: Triadic Review Join Inconsistency Detection

**User request**: "Validate consistency across 3 agents: Coder ($v_0$), Reviewer ($v_1$), and Tester ($v_2$) on function `handleAuth`."

**Step 1 - Construct 2-Simplex**:
- Vertices: $V = \{v_0, v_1, v_2\}$.
- Edges: $e_0 = (v_0, v_1)$, $e_1 = (v_1, v_2)$, $e_2 = (v_0, v_2)$.
- Face: $\tau = [v_0, v_1, v_2]$.

**Step 2 - Define Coboundary Operator**:
$$\delta_0 = \begin{bmatrix} -1 & 1 & 0 \\ 0 & -1 & 1 \\ -1 & 0 & 1 \end{bmatrix}, \quad \delta_1 = \begin{bmatrix} 1 & 1 & -1 \end{bmatrix}$$
Check that $\delta_1 \delta_0 = [0, 0, 0]$ (closed chain complex).

**Step 3 - Measure Observed Cochain**:
Coder claims line count 100 on $v_0$. Reviewer reports diff $+10$ ($g_{e_0} = 10$). Tester reports diff $+15$ ($g_{e_1} = 15$). But direct test from Coder to Tester reports diff $+30$ ($g_{e_2} = 30$).
$$g = \begin{bmatrix} 10 \\ 15 \\ 30 \end{bmatrix}$$

**Step 4 - Compute Orthogonal Residual**:
$$\oint_\tau g = g_{e_0} + g_{e_1} - g_{e_2} = 10 + 15 - 30 = -5 \ne 0$$
Projection yields completion residual $r = \| \Pi_K g \|_2 = \frac{5}{\sqrt{3}} \approx 2.8867$. Global consensus fails!

- **What novice would miss**: Checking only pairwise edge thresholds (e.g. $10 < 50$, $15 < 50$, $30 < 50$) and assuming all agents are healthy.
- **What expert catches**: The closed loop circulation $\oint_\tau g = -5$ mathematically proves an irreconcilable contract breach regardless of individual edge magnitudes.

### Example 2: Differentiating Macro Partition from Micro AST Lock Contention

**User request**: "An alarm fired with residual $r = 14.2$. Determine if this is a network partition or a code merge conflict."

**Step 1 - Perform Hodge Decomposition**:
Solve for harmonic component $h \in \ker(L_1)$ and curl component $c = \delta_1^* \psi \in \operatorname{im}(\delta_1^*)$.

**Step 2 - Measure Component Norms**:
Found $\|h\|_2 = 0.81$ and $\|c\|_2 = 14.18$.

**Step 3 - Compute Legibility Ratio**:
$$\mathcal{L}(g) = \frac{\|h\|_2^2}{\|h\|_2^2 + \|c\|_2^2} = \frac{0.81^2}{0.81^2 + 14.18^2} = \frac{0.656}{0.656 + 201.07} \approx 0.00325$$

**Step 4 - Diagnostic Classification**:
$\mathcal{L} = 0.003 \ll 0.30$. The obstruction is $> 99.6\%$ localized curl. 
Conclusion: Not a macro network split; isolate the specific 2-simplex face $\tau$ with maximal circulation curl to identify the conflicting AST symbol lock.

- **What novice would miss**: Restarting the entire network or bouncing servers under the assumption of a connectivity partition.
- **What expert catches**: Low legibility ratio precisely localizes the fault to an overlapping AST edit lease on a single file symbol.

### Example 3: Solving the Coboundary System with Moore-Penrose Pseudo-Inverse

**User request**: "Compute the reconstructed vertex potential $\hat{x}$ and residual $\rho$ for a 5-node swarm with 7 active communication channels."

**Step 1 - Assemble System**:
Given $7 \times 5$ incidence matrix $\delta_0$ and 7-dimensional measurement vector $g_K$.

**Step 2 - Pseudo-Inverse Solve**:
```python
import numpy as np

# Ground vertex 0 to remove gauge freedom, or use pinv
L0 = delta_0.T @ delta_0
x_hat = np.linalg.pinv(delta_0) @ g_K
```

**Step 3 - Residual Projection**:
```python
rho = g_K - delta_0 @ x_hat
r = np.linalg.norm(rho)
```

- **What novice would miss**: Getting numerical instability when inverting $L_0$ due to the zero eigenvalue corresponding to constant potential.
- **What expert catches**: `np.linalg.pinv(delta_0)` finds the minimal-norm least-squares gauge solution directly without manual pivot selection.

---

## Quality Gates

- [ ] `SKILL.md` exists and is under 500 lines.
- [ ] Frontmatter contains required `name` and `description` fields adhering to `[What][When to use] NOT [Exclusions]`.
- [ ] At least 3 temporal anti-patterns using Novice/Expert/Timeline template.
- [ ] All file references in `SKILL.md` actually exist on disk in the skill directory.
- [ ] Pipeline diagram uses valid Mermaid syntax.
- [ ] Standalone test script `examples/triadic-cochain-solve.py` executes cleanly and outputs verification residuals.
- [ ] 5 positive trigger test queries pass.
- [ ] 5 negative trigger test queries pass.

### Activation Test Suite

**Positive Queries (Must Activate)**:
1. "Compute the completion residual r for our multi-agent interaction cochain."
2. "Derive the simplicial Hodge decomposition for a 2D agent complex."
3. "Why does our hierarchical supervisor tree fail to detect agent hallucinations?"
4. "Calculate the effective resistance across this contested agent communication edge."
5. "Implement a cellular sheaf restriction map to verify AST lock consistency."

**Negative Queries (Must NOT Activate)**:
1. "Find the shortest path between two nodes using Dijkstra's algorithm." (Use standard algorithms)
2. "Rent an A100 GPU cluster on Vast.ai." (Use `vast-ai-gpu-clusters`)
3. "Plot an SVG line chart with D3." (Use `bostockesque-data-viz`)
4. "Write a unit test for user password hashing." (Use standard test tools)
5. "Draft marketing copy for our agent framework." (Use `copywrite`)

---

## References & Progressive Disclosure

Read these reference files only when the specific domain context demands deep mathematical derivations or code:

| File | Load When | Why |
|---|---|---|
| `references/simplicial-sheaf-primer.md` | Defining agent complexes, stalks, and coboundary maps | Formal definitions of simplices, stalks, restriction maps, and complexes |
| `references/hodge-decomposition-derivation.md` | Deriving orthogonal projections or solving Hodge Laplacians | Complete mathematical derivations of gradient, harmonic, and curl subspaces |
| `examples/triadic-cochain-solve.py` | Writing or debugging numerical Hodge solvers | Minimal, standalone NumPy implementation on a 3-agent triadic join |

---

## NOT-FOR Boundaries

**This skill should NOT be used for**:
- Standard graph search algorithms (BFS, Dijkstra, max flow).
- Centralized leader-based consensus protocols (Raft, Paxos).
- Non-mathematical qualitative LLM prompt engineering.
- Hardware provisioning or remote cloud GPU orchestration.

**Delegate to these skills instead**:
- For active diagnostic repair and coordination recovery → `sheaf-cohomology-multiagent-debug`
- For choosing coordination topologies (trees vs complexes) → `coordination-topology-architect`
- For provisioning high-throughput GPU clusters for large Laplacians → `vast-ai-gpu-clusters`
- For interactive visual rendering of simplicial telemetry → `bostockesque-data-viz`
