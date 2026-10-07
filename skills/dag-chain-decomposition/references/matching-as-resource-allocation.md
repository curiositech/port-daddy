# Matching reductions: comparable pairs are not workers

Fulkerson’s reduction has a left and right copy of each poset element. Add `u_L--v_R` iff `u < v` in strict reachability. A matching prevents each vertex having more than one selected predecessor and successor, so its edges reconstruct disjoint chains. If matching size is `m` on `n` vertices, the chain partition has `n-m` chains.

If instead edges are only original DAG arcs, the same formula solves the vertex-disjoint direct-edge path-cover objective. It does not solve the reachability-chain objective. For `a→x, x→b, c→x, x→d`, direct arcs yield three paths, whereas reachability yields two chains.

A task-to-worker assignment needs duration, eligibility, capacity, and timing relations; do not relabel this bipartite matching as resource allocation. Source: [Fulkerson 1956](https://resources.mpi-inf.mpg.de/departments/d1/teaching/ss11/graph_theory/DilworthFulkerson.pdf), full scan, accessed 2026-09-24.
