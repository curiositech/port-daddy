# Derivation of the Simplicial Hodge Decomposition

## 1. Orthogonal Subspace Splitting

The space of 1-cochains $C^1(X; \mathcal{F})$ is an inner product space endowed with standard Euclidean inner product $\langle u, v \rangle = u^T v$ (or edge-weighted inner product $\langle u, v \rangle_W = u^T W v$).

By the Fundamental Theorem of Linear Algebra applied to $\delta_0: C^0 \to C^1$ and $\delta_1: C^1 \to C^2$:
$$C^1 = \operatorname{im}(\delta_0) \oplus \ker(\delta_0^*)$$
Furthermore, because $\operatorname{im}(\delta_0) \subseteq \ker(\delta_1)$ (from $\delta_1 \delta_0 = 0$), the space $\ker(\delta_1)$ decomposes into:
$$\ker(\delta_1) = \operatorname{im}(\delta_0) \oplus \left( \ker(\delta_1) \cap \ker(\delta_0^*) \right)$$

Define the space of **harmonic 1-cochains**:
$$\mathcal{H}^1 = \ker(\delta_1) \cap \ker(\delta_0^*) = \ker(\Delta_1)$$
where $\Delta_1 = \delta_0 \delta_0^* + \delta_1^* \delta_1$ is the 1st Hodge Laplacian.

Taking orthogonal complements gives the **Simplicial Hodge Decomposition**:
$$C^1 = \operatorname{im}(\delta_0) \oplus \mathcal{H}^1 \oplus \operatorname{im}(\delta_1^*)$$

## 2. Solving for the Components

Given any observed 1-cochain $g \in C^1$:
$$g = \underbrace{\delta_0 x}_{\text{gradient}} + \underbrace{h}_{\text{harmonic}} + \underbrace{\delta_1^* \psi}_{\text{curl}}$$

1. **Gradient Component ($\delta_0 x$)**:
   Solve normal equations:
   $$(\delta_0^* \delta_0) x = \delta_0^* g \implies x = (\delta_0^* \delta_0)^+ \delta_0^* g$$
   $$\text{grad} = \delta_0 x$$
   Let residual cochain $w = g - \text{grad} \in \ker(\delta_0^*)$.

2. **Curl Component ($\delta_1^* \psi$)**:
   Solve dual normal equations:
   $$(\delta_1 \delta_1^*) \psi = \delta_1 w \implies \psi = (\delta_1 \delta_1^*)^+ \delta_1 w$$
   $$\text{curl} = \delta_1^* \psi$$

3. **Harmonic Component ($h$)**:
   $$h = w - \text{curl} = g - \text{grad} - \text{curl}$$

4. **Swarm Legibility Ratio ($\mathcal{L}$)**:
   $$\mathcal{L}(g) = \frac{\|h\|_2^2}{\|h\|_2^2 + \|\text{curl}\|_2^2}$$
