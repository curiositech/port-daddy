# Static chain index: representation before optimization

Kritikakis–Tollis [SEA 2023](https://drops.dagstuhl.de/storage/00lipics/lipics-vol265-sea2023/LIPIcs.SEA.2023.2/LIPIcs.SEA.2023.2.pdf) §4 motivates a chain-position representation. Its printed initialization/conditional-merge combination has the [three-node discrepancy](printed-index-and-implementation-gap.md). The following is a straightforward **local reference construction**, not a transcription of that optimized algorithm.

## Complete procedure

1. Check one static DAG revision, its topological order, and a vertex-disjoint reachability-chain cover. Validate every vertex exactly once and each consecutive chain pair by reachability.
2. Store each vertex's chain ID and position. For each vertex allocate `kc` cells at infinity and seed the own-chain cell with its position.
3. Process vertices in reverse topological order. For **every** outgoing successor, replace the row by its elementwise minimum with the successor's completed row. The reference requires no conditional skip and its correctness does not depend on successor iteration order.
4. After all rows are complete, answer reflexive reachability `u↝v` with `low[u,chain(v)] ≤ position(v)`. For strict reachability add `u != v`.
5. Compare the complete query matrix or a declared sample against independent traversal/closure. Store revision and representation version; reject or rebuild after relevant changes.

## Why this recurrence works

For a sink, only its own position is seeded. Every other reachable vertex from u lies beyond some outgoing successor; reverse topological order makes each such successor's row complete. Taking minima over their rows therefore records the earliest reachable position in each chain, plus u itself. Every later member of a chain is reachable from that earliest member by the validated chain property. Conversely, each finite stored position arises from u or a real outgoing path; the representation invents no cross-chain edge. This induction establishes the recurrence under the stated DAG/valid-cover assumptions, separately from finite test coverage.

## Worked table and cost

On arcs `a→x,c→x,x→b,x→d` with `C0=[a,x,b]`, `C1=[c,d]`, completed rows are a=`[0,1]`, x=`[1,1]`, b=`[2,∞]`, c=`[1,0]`, d=`[∞,1]`. Thus c reaches b, b does not reach d, and all self queries are true. The table is constructed, not measured application evidence.

Dense initialization costs `Θ(kc|V|)`; merging all outgoing rows costs `O(kc|E|)`, for total `O(kc(|V|+|E|))` plus cover/preprocessing and `O(kc|V|)` space. A row lookup is O(1) in the array/RAM model. SEA's reported reduced-edge-sensitive bound belongs to its optimized method claim; do not attach it to this baseline. A different strict-successor array/query pair appears in the pinned author source; do not mix representations. No dynamic update or runtime latency is established.
