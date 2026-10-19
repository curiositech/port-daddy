# Exact reduction, partial filter, and index are different mechanisms

A directed edge is transitive when another directed path connects the same endpoints. The **exact transitive reduction** of a DAG is a separate object from a reachability index. SEA 2023 gives a linear-time filter that detects a subset `E'_tr ⊆ E_tr`; after removing only that detected subset, `E'_red = E − E'_tr` is a **superset** of the true non-transitive/reduction edges. It retains transitive closure but is not guaranteed to be the exact reduction.

## Filter-to-index procedure

1. Start with a fixed DAG revision, topological order, and supplied path/chain decomposition.
2. For each source and target chain, retain the outgoing edge to that chain’s earliest target; mark its later same-chain outgoing edges detected transitive. For each target and source chain, retain the incoming edge from that chain’s latest source; mark earlier same-chain incoming edges detected transitive.
3. Union those detected edges as `E'_tr` and record `E'_red=E−E'_tr`; do not rename the latter `E_red`.
4. Build the static chain-position index on the documented representation.
5. Verify a declared query set against DFS or closure. If a revision changes arcs or the decomposition, invalidate the filter and index records and rebuild/revalidate.

The [differential fixture](index-and-differential-fixtures.md) includes a graph where a local filter rule leaves a transitive edge, so it cannot be presented as exact reduction.

For the paper’s generated ER/BA/WS/PB experiments at 5k/10k vertices and average degrees 5–160, Tables 3–4 report fractions from .11 to .99. The authors’ “almost all” >85% prose is scoped to particular generated models and degrees; it is neither an 85–95% rule nor a storage guarantee. An edge-list ratio `1/(1-p)` is only a conditional arithmetic comparison and does not quantify `O(k_c|V|)` index memory.

Source: [Kritikakis–Tollis SEA 2023](https://drops.dagstuhl.de/opus/volltexte/2023/18352/pdf/LIPIcs-SEA-2023-2.pdf), §§3–5, full paper read.
