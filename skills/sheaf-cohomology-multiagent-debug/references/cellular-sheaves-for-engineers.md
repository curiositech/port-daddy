# Cellular Sheaves on Simplicial Complexes: Stalks, Restriction Maps, and Cohomology

A **cellular sheaf F** on a simplicial complex X assigns data to each simplex and ties those assignments together with consistency conditions. On a graph (1-dimensional simplicial complex), X has 0-simplices (vertices V) and 1-simplices (edges E). On a 2-complex, X also has 2-simplices (triangles T). The construction extends inductively, but for multi-agent systems, the graph case covers 90% of applications.

**Stalks.** For each vertex v, F(v) is a finite-dimensional real vector space — the *stalk* at v. For each edge e, F(e) is a stalk at e. F(v) encodes what agent v privately knows; F(e) encodes the shared discourse space on channel (u, v). Stalk dimension is a design choice: if agents track a 3D velocity estimate, d_v = 3. If the shared channel only supports scalar consensus, d_e = 1. There is no requirement that d_v = d_e.

**Restriction maps.** For each incidence pair (v, e) where v is an endpoint of e, the restriction map ρ_{v ▹ e}: F(v) → F(e) is a linear map. It encodes the question: "how does agent v project its private state into the shared discourse on edge e?" Two agents connected by edge e = (u, v) each supply a restriction map — ρ_{u ▹ e} and ρ_{v ▹ e} — and these need not be equal or even have the same structure. They project from potentially different private state spaces into the same shared edge stalk.

**Global sections.** An assignment x ∈ ∏_v F(v) is a *global section* if for every edge e = (u, v):
```
ρ_{u ▹ e}(x_u) = ρ_{v ▹ e}(x_v)
```
Both endpoints project to the same point in F(e). The space of global sections is H⁰(X; F) = ker(δ) where δ: C⁰(X; F) → C¹(X; F) is the coboundary operator. Concretely, for each edge e: (δx)_e = ρ_{u ▹ e}(x_u) − ρ_{v ▹ e}(x_v). dim(H⁰) counts independent consensus modes; dim(H⁰) = 0 means no consistent global assignment exists anywhere in state space — consensus is structurally impossible before agents even start.

**H¹ as obstruction space.** On a pure graph (no triangles), C²(X; F) = 0, so every 1-cochain is automatically a cocycle: Z¹ = C¹. The coboundary image im(δ) ⊆ C¹ is the set of edge discrepancies that are explained by *some* vertex assignment — discrepancies you can zero out by choosing the right x. H¹(X; F) = C¹ / im(δ). A nonzero element of H¹ is an edge-discrepancy pattern that no vertex assignment can explain — a cycle where the restriction maps are mutually incompatible. For a triangle (u, v, w) with edges (u,v), (v,w), (u,w), the Čech condition requires that the three restriction maps compose consistently around the loop; if they do not, that triangle contributes a generator to H¹.

**Computing dimensions from the coboundary matrix.** Build δ as a (|E|·d_e) × (|V|·d_v) block matrix with one block-row per edge e = (u, v): column block u gets +ρ_{u ▹ e}, column block v gets −ρ_{v ▹ e}. Then:
```
dim H⁰ = dim(ker δ) = n_vertex_dims − rank(δ)
dim H¹ = dim(C¹) − rank(δ) = |E|·d_e − rank(δ)   [graphs only]
```
Euler characteristic check: dim(H⁰) − dim(H¹) = n_vertex_dims − |E|·d_e = χ(X) · d (weighted). This provides a consistency check on your matrix construction; if it fails, your block assembly has a sign error or a wrong dimension.

**Extending to 2-simplices.** When X includes triangles, d₁: C¹ → C² enters the picture and Z¹ = ker(d₁) ≠ C¹. For each triangle (u, v, w), d₁ imposes a condition on the three edge stalks: the sum of edge contributions around the boundary must vanish in C²(X; F). This is where sheaf cohomology properly generalizes simplicial cohomology — the boundary conditions on higher simplices enforce that global sections are genuinely compatible across faces, not just pairs of vertices. In practice, 2-simplex conditions arise when three agents have pairwise channels AND a shared three-way meeting space and the projection into the meeting space must be consistent with all three pairwise projections.

**pysheaf API alignment.** In `pysheaf`, stalks are set via `Sheaf.AddSheafCell(id, SheafCell(stalkDim=d))` and restriction maps via `Sheaf.AddCoface(source_id, target_id, Coface(matrix=R))`. `sheaf.cohomology()` returns Betti numbers [b₀, b₁, ...]; b₀ = dim(H⁰), b₁ = dim(H¹). `sheaf.consistencyRadius()` returns the Dirichlet energy norm ||δx||, which is zero iff x is a global section.

## Key Points

- **Stalks encode private state; restriction maps encode projection into shared discourse.** Mismatched projections — where two agents have incommensurable models of what a shared variable means — are precisely what H¹ measures. The sheaf structure makes this algebraically explicit.
- **H⁰ = 0 is a hard impossibility result.** If dim(ker δ) = 0, no consensus state exists anywhere in ∏_v F(v). The fix is to redesign the stalks or restriction maps before any diffusion is attempted.
- **H¹ > 0 is a topological no-go theorem, not a convergence-rate problem.** Adding agents, increasing diffusion rate α, or running longer cannot dissolve an H¹ obstruction. The fix is always to change a restriction map on the obstructed cycle.
- **The Euler characteristic is your sanity check.** χ(X) = |V| − |E| for a graph; dim(H⁰) − dim(H¹) must equal χ(X) × (effective stalk dim). If it does not, your δ matrix has a construction error.
- **H¹ localizes to cycles.** The null space of δᵀ gives H¹ basis vectors; each basis vector has nonzero entries on a specific subset of edges forming a cycle. This pinpoints which communication edges carry the irreconcilable restriction maps.

## See Also

- `SKILL.md §Core Concepts` — coboundary operator δ, sheaf Laplacian L_F = δᵀδ, and the Dirichlet energy diagnostic in the multi-agent debugging context
- `references/sheaf-laplacian-diffusion.md` — convergence rate bounds via λ₂(L_F), Fiedler value interpretation, and the relationship between spectral gap and H⁰ projection speed
- Hansen & Ghrist (2021) arXiv:2005.12798 — Theorem 2.4 (convergence to H⁰) and Corollary 3.1 (H¹ obstruction implies residual Dirichlet energy > 0 at any equilibrium)
