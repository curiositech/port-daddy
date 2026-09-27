# CO, NO, H3, H3 conc., and path concatenation: retain the paper’s scope

The detailed named heuristics are in Kritikakis–Tollis [arXiv v1 (2022)](https://arxiv.org/html/2212.03945v1): Chain-Order (CO), Node-Order (NO), H3, and integrated H3 conc.; concatenation is Algorithm 3. SEA 2023 is the source for the published filter/index, not the detailed H-method pseudocode. Their outputs and chain counts are inputs to the static index; they are not automatically minimum Dilworth chain partitions.

## Source-grounded comparison protocol

- **CO/NO:** scan in topological order as printed; neither procedure specifies a tie rule when several candidates qualify.
- **H3/H3 conc.:** apply the printed lowest-out-degree predecessor-endpoint choice; expose the source’s forced-successor predicate discrepancy rather than silently changing it.
- **Path concatenation:** begin with a path decomposition, return `(R,P)` from reversed lookup, after every successful or failed lookup remove/mark exhausted regions R outside the witness P before later lookups, retaining the original DAG, and decrease chain count only when an actual endpoint connection is found. A witness path P proves reachability; its interior vertices do not change chain membership.

For a run, record graph family/revision, chosen H procedure, adjacency/topological prerequisites, original path count, each accepted concatenation, final `k_c`, decomposition time, index time, space, and baseline query agreement. Compare H variants on the same graph/query workload; the SEA experiments are generated ER/BA/WS/PB observations, not proof that a heuristic wins on deployment/sensor/agent graphs.

Source: [Kritikakis–Tollis arXiv v1](https://arxiv.org/html/2212.03945v1), §§2–3 and Algorithms 1–5, full body read in B06 research. No general 5–10% optimality or 10–20x claim is retained.

The disjoint exhausted regions are charged once; successful witness traversal contributes `Σ|P|`, bounded by `(kp-kc)ℓ` in the source convention. Include vertex initialization and the starting-cover construction in a concrete end-to-end cost, even on edgeless inputs.
