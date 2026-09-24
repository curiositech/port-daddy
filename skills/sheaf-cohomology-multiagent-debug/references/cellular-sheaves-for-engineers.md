# Cellular sheaves: finite spaces, maps, and dimensions

## Source boundary

Hanks, Riess, and Hale, [*Distributed Multi-agent Coordination over Cellular Sheaves*](https://arxiv.org/html/2504.02049v2), arXiv:2504.02049v2, was targeted-read on 2026-09-24 in model and optimization sections II–VI. It specifies graph/stalk/map/optimization assumptions and conditional optimization results. Abramsky and Brandenburger, [*The Sheaf-Theoretic Structure of Non-Locality and Contextuality*](https://arxiv.org/html/1102.0264), had full HTML access with §§3–5 targeted. Neither source makes an arbitrary agent report a contextuality, safety, or authorization result.

## A finite model

A cellular sheaf assigns a vector space `F(sigma)` to each cell and a linear restriction map `rho_sigma,tau:F(sigma)->F(tau)` for each face inclusion. The maps compose along inclusions. Cochain spaces are direct sums of stalks by cell dimension. To use a calculation, record all dimensions, maps, orientations, coefficients, and the source of each observed coordinate.

For an oriented edge `e=(u,v)`, a vertex assignment has coboundary

$$ (\delta_0 x)_e=\rho_{v,e}x_v-\rho_{u,e}x_u. $$

For a face `tau`, the next coboundary must map each incident edge stalk into `F(tau)` before the signed sum. Adding heterogeneous edge coordinates without face restrictions is undefined.

```mermaid
flowchart LR
  A[Vertex stalk values] --> B[Restrict to edge stalk]
  B --> C[Signed delta0 edge value]
  C --> D[Restrict each edge value to face stalk]
  D --> E[Signed delta1 face sum]
  E --> F[Check delta1 delta0 equals zero]
```

## Dimensions are model dependent

When `delta1 delta0=0`, compute `dim H1=dim C1-rank(delta0)-rank(delta1)`. For a connected constant scalar graph with no faces, this is `|E|-|V|+1`. It is false in general that arbitrary sheaves have `dim H1 >= beta1*d`: changing stalk dimensions or choosing zero/noninjective restrictions changes ranks. The lower-bound counterexample is given below. Separately, one edge with scalar vertex/edge stalks and both vertex-to-edge maps zero has `delta0=0` and `H1=R`, although the graph has no cycle.

## Observation boundary

Topology and sheaf cohomology describe the selected representation. Independently observed edge reports can be compared to `im(delta0)`; derived edge differences cannot test that comparison. Missing data, data provenance, and effect authority are external to the algebra and must be supplied separately.

## Counterexample to a topology-only lower bound

The zero-map tree above shows that a graph cycle is not necessary for nonzero sheaf cohomology. A different example shows it is not sufficient either: take a triangle graph with scalar stalks, no face, and coboundary rows `(-1,1,0)`, `(0,-1,1)`, `(-2,0,1)`. The last edge has a nonidentity endpoint restriction. This matrix has determinant minus one and rank three. Thus `dim H1=3-3=0`, while the graph cycle rank is one and every stalk has dimension one. This valid graph sheaf directly refutes an arbitrary-sheaf lower bound `dim H1 >= beta1*d`. The constant-coefficient graph identity does not apply to these nonconstant maps.
