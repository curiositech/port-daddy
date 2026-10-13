# Finite-poset width and exact certificates

For a finite DAG define `u < v` exactly when a directed path exists from `u` to `v`. A chain is totally ordered by that relation; an antichain is pairwise incomparable. Dilworth’s 1950 theorem says the minimum number of disjoint chains partitioning a finite poset equals its maximum antichain size.

**Procedure.** Compute or query strict reachability; construct left/right vertex copies with an edge for each comparable pair; find a maximum matching; reconstruct chains from matched successors; then produce an equal-size antichain certificate. This is an order cover, not an estimate of personnel, concurrency, cost, or makespan.

**Hand check.** `A→C, B→C, C→D` has chains `{A,C,D}` and `{B}` plus antichain `{A,B}`. The largest topological level can be only a lower-bound witness; it is not an exact width algorithm in arbitrary levelizations.

A concrete negative check is `B→A, C→A, D→C, E→C`. Sink-peeling levels `{A}`, `{B,C}`, `{D,E}` have largest size two, while `{B,D,E}` is an antichain of size three. The independent finite enumeration is retained in `B06/validation/root-order-fixtures`; it is fixture evidence, not a new algorithm or benchmark.

Sources: [Dilworth 1950](https://doi.org/10.2307/1969503), primary scan access described in the B06 research; [Fulkerson 1956](https://resources.mpi-inf.mpg.de/departments/d1/teaching/ss11/graph_theory/DilworthFulkerson.pdf), full matching-proof scan. Accessed 2026-09-24.
