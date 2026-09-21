# Active Cohomological Repair and Triadic Simplicial Sheaves (Theorems CR-4 & CR-5)

This reference documents the formal mathematical foundations, theorems, and proofs for active multi-agent swarm control (CR-4) and higher-order 2-complex triage (CR-5).

---

## 1. Setting and Cellular 2-Complexes

Let $X = (V, E, F)$ be a finite 2-dimensional cell complex (a simplicial complex or regular CW complex) where:
- $V = \{0, \dots, n-1\}$ are 0-cells representing **AgentNodes** and bounded **WorkNodes**.
- $E$ is a set of oriented 1-cells $e = (u, v)$ with $u < v$ representing communication links, dependency edges, or AST claim interfaces.
- $F$ is a set of oriented 2-cells $\tau = (u, v, w)$ with $u < v < w$ representing triadic coordination joins (e.g. Producer-Dissenter-Manager review joins, or Requester-Worker-Escrow triads).

### Cellular Sheaf Structure
To each cell $\sigma \in X$, assign a finite-dimensional vector space $\mathcal{F}(\sigma)$.
For coordinate-wise prefix restrictions (Lemma 1 of `sheaf_consistency_radius.py`), stalks decompose coordinate-wise. For each coordinate $c \in \{0, \dots, D-1\}$, the cellular cochain complex is:
$$0 \longrightarrow C^0(X; \mathbb{R}) \xrightarrow{\delta_0} C^1(X; \mathbb{R}) \xrightarrow{\delta_1} C^2(X; \mathbb{R}) \longrightarrow 0$$

Where:
- $(\delta_0 x)_{uv} = x_u - x_v$ for $u < v$.
- $(\delta_1 g)_{uvw} = g_{uv} + g_{vw} - g_{uw}$ for $u < v < w$.

**Fundamental Simplicial Identity**:
$$\delta_1 \circ \delta_0 = 0$$
*Proof*: For any vertex assignment $x \in C^0$:
$$( (\delta_1 \delta_0) x )_{uvw} = (\delta_0 x)_{uv} + (\delta_0 x)_{vw} - (\delta_0 x)_{uw} = (x_u - x_v) + (x_v - x_w) - (x_u - x_w) = 0. \quad \square$$

---

## 2. Theorem CR-5: Simplicial Hodge Decomposition & The Legibility Ratio

### Theorem Statement
Every observed 1-cochain $g \in C^1(X; \mathbb{R})$ admits a unique, mutually orthogonal decomposition:
$$g = \delta_0 x + h + \delta_1^* \psi$$
where:
1. $\delta_0 x \in \text{im}(\delta_0)$ is the explainable gauge gradient (honest potential differences).
2. $h \in \ker(\delta_1) \cap \ker(\delta_0^*) \cong H^1(X; \mathbb{R})$ is the harmonic 1-cochain (macro-topological partition cavity).
3. $\delta_1^* \psi \in \text{im}(\delta_1^*)$ is the triadic local frustration (micro-contract failure).

### Proof
Consider the discrete Hodge Laplacian on 1-cochains:
$$L_1 = L_1^{\text{down}} + L_1^{\text{up}} = \delta_0 \delta_0^* + \delta_1^* \delta_1$$
By standard Hodge theory for finite cell complexes over $\mathbb{R}$, $L_1$ is a real symmetric, positive semi-definite operator. Its kernel is the harmonic space:
$$\ker(L_1) = \ker(\delta_0^*) \cap \ker(\delta_1) \cong H^1(X; \mathbb{R})$$

Since $C^1$ is a finite-dimensional Hilbert space under the standard Euclidean inner product, the orthogonal complement of $\ker(L_1)$ is $\text{im}(L_1)$:
$$C^1 = \ker(L_1) \oplus \text{im}(L_1)$$
Because $\text{im}(\delta_0) \perp \text{im}(\delta_1^*)$ (since $\langle \delta_0 x, \delta_1^* \psi \rangle = \langle \delta_1 \delta_0 x, \psi \rangle = \langle 0, \psi \rangle = 0$), the image splits orthogonally into:
$$\text{im}(L_1) = \text{im}(\delta_0) \oplus \text{im}(\delta_1^*)$$
Hence:
$$C^1 = \text{im}(\delta_0) \oplus \mathcal{H}^1 \oplus \text{im}(\delta_1^*)$$
The components are computed via standard least-squares projections:
1. $x = \delta_0^+ g \implies \delta_0 x = \delta_0 \delta_0^+ g$.
2. Let $w = g - \delta_0 x$.
3. $\psi = (\delta_1^*)^+ w = (\delta_1^+)^T w \implies \delta_1^* \psi = \delta_1^* (\delta_1^*)^+ w$.
4. $h = w - \delta_1^* \psi$. $\quad \square$

### The Swarm Legibility Ratio
$$\mathcal{L}(g) = \frac{\|h\|_2^2}{\|h\|_2^2 + \|\delta_1^* \psi\|_2^2} \in [0, 1]$$
- When $\mathcal{L}(g) \approx 0$ ($\delta_1 g \neq 0$): The failure is localized to a triadic join (e.g. a review triad produced a circular contradiction).
- When $\mathcal{L}(g) \approx 1$ ($\delta_1 g = 0$): Every triadic contract is satisfied, but there is a non-contractible macro-cavity in the communication topology (e.g. two partitions drifting apart).

---

## 3. Theorem CR-4: Optimal Cohomological Repair

### Problem Formulation
Given an observed cochain $g_K$ with residual $r = \|\Pi_K g_K\|_2 > 0$ and each edge $e \in K$ assigned an intervention cost $w(e) > 0$.
The operator wishes to find an edge subset $S^* \subseteq K$ to reconcile or fence such that:
$$r(K \setminus S^*) = 0 \quad \text{minimizing} \quad \sum_{e \in S^*} w(e)$$

### Theorem Statement
1. The completion residual vector $\rho = \Pi_K g_K$ is a circulation: $B^T \rho = 0$.
2. Reconciling or severing an edge $e$ reduces the rank of the cycle space by at most 1.
3. The greedy algorithm that at each step selects:
   $$e^* = \arg\max_{e \in K_{\text{active}}} \frac{\|\rho_e\|_2^2}{w(e)}$$
   and removes $e^*$ from $K_{\text{active}}$ terminates with $r = 0$ in at most $\beta_1(G_K)$ rounds.

### Proof
Each coordinate circulation $\rho^c \in \ker(B_c^T)$ is supported on a union of cycles in $G_c$.
Dropping edge $e^*$ from the known constraint system $A = \delta_0$ removes row $e^*$, turning $g_{e^*}$ into a free variable.
Since $e^*$ lies on the support of $\rho^c$, removing row $e^*$ destroys at least one independent cycle constraint in $G_c$.
Because the total number of independent cycle constraints in $G_c$ is $\beta_1(G_c) = |E_c| - |V_c| + \text{comps}(G_c)$, at most $\beta_1(G_c)$ edge removals reduce the cycle space to 0 (a spanning forest).
Once all cycles supporting $\rho^c$ are severed, the remaining incidence matrix has trivial cokernel on that component, and the residual on that cycle collapses to 0. $\quad \square$
