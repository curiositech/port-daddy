# Simplicial Complexes & Cellular Sheaves Primer

## 1. Simplicial Complexes as Coordination Topologies

An abstract simplicial complex $X$ on a vertex set $V$ is a collection of finite non-empty subsets of $V$ such that if $\sigma \in X$ and $\tau \subseteq \sigma$, then $\tau \in X$.
- **0-simplices (Vertices $v \in V$)**: Individual autonomous agents.
- **1-simplices (Edges $e = \{u, v\} \in E$)**: Pairwise communication channels or shared AST leases.
- **2-simplices (Triangles $\tau = \{u, v, w\} \in F$)**: Triadic review contracts (e.g. Producer, Dissenter, Manager).

## 2. Cellular Sheaves over Simplicial Complexes

A cellular sheaf $\mathcal{F}$ over $X$ assigns:
- To each simplex $\sigma \in X$, a vector space $\mathcal{F}(\sigma)$ called the stalk over $\sigma$.
- To each face inclusion $\sigma \trianglelefteq \tau$, a linear map $P_{\sigma \trianglelefteq \tau}: \mathcal{F}(\sigma) \to \mathcal{F}(\tau)$ such that:
  1. $P_{\sigma \trianglelefteq \sigma} = \text{id}_{\mathcal{F}(\sigma)}$
  2. If $\sigma \trianglelefteq \tau \trianglelefteq \gamma$, then $P_{\tau \trianglelefteq \gamma} \circ P_{\sigma \trianglelefteq \tau} = P_{\sigma \trianglelefteq \gamma}$.

## 3. Cochain Spaces and Coboundary Operators

- **0-Cochains $C^0(X; \mathcal{F}) = \bigoplus_{v \in V} \mathcal{F}(v)$**: Global state assignments across all agents.
- **1-Cochains $C^1(X; \mathcal{F}) = \bigoplus_{e \in E} \mathcal{F}(e)$**: Observed edge flows, messages, or reported disagreements.
- **2-Cochains $C^2(X; \mathcal{F}) = \bigoplus_{\tau \in F} \mathcal{F}(\tau)$**: Circulations around triadic review joins.

The coboundary maps:
- $\delta_0: C^0 \to C^1$ via $(\delta_0 x)_{e=(u,v)} = P_{v \trianglelefteq e} x_v - P_{u \trianglelefteq e} x_u$.
- $\delta_1: C^1 \to C^2$ via $(\delta_1 g)_{\tau=(u,v,w)} = g_{(u,v)} + g_{(v,w)} - g_{(u,w)}$.

By definition of boundary operators:
$$\delta_1 \circ \delta_0 = 0$$
