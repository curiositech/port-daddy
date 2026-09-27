# Scalar diffusion: operator contract and limits

For the simple undirected unweighted graph Laplacian, one Jacobi update is
`p_next=(I-alpha*h*L)p`. If `alpha*h*lambda_max(L) <= 2`, the linear update is
spectrally stable. Since `lambda_max(L) <= 2*d_max`, `h <= 1/(alpha*d_max)` is a
sufficient condition when `d_max>0`; a `0.9` multiplier is a conservative choice, not
a theorem about another operator. The equivalent per-node update has non-negative
weights under that sufficient bound.

This does not cover a weighted, directed, normalized, nonlinear, asynchronous, or
in-place update. Those variants must name their matrix/update ordering and have their
own test or analysis. Pure synchronous undirected diffusion preserves total scalar mass;
decay, pruning, clipping, and deposits deliberately violate that invariant.

Hansen and Ghrist develop sheaf-Laplacian opinion dynamics and consistency; it is useful
background for typed local constraints, but it does not validate this pheromone system:
[publisher record](https://epubs.siam.org/doi/10.1137/20M1341088),
[open preprint](https://arxiv.org/abs/2005.12798). Dorigo and Gambardella report an
ant-colony optimization experiment for TSP, not reliable message delivery or a general
coordination guarantee: [technical report PDF](https://iridia.ulb.ac.be/~mdorigo/Published_papers/All_Dorigo_papers/All_Dorigo_papers/DorGam1997tec.pdf).
