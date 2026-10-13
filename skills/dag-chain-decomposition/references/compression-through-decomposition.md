# Chain-position indexes: representation and a worked table

A chain partition is an order certificate. An index adds a query representation and must name its version. Chen’s **2007 DEXA** abstract reports a chain-decomposition reachability method with `O(bn)` storage and `O(log b)` query; only bibliographic/abstract access was available, so this reference does not reconstruct its implementation. Kritikakis–Tollis **SEA 2023** supplies the array representation below. Its printed self-seed/conditional-merge combination has a reproduced cross-chain propagation discrepancy, so the table here uses the all-successor reference recurrence described explicitly below.

## Constructed static index walk-through

Let the declared chains be `C0=[a,x,b]` and `C1=[c,d]` for arcs `a→x, c→x, x→b, x→d`. Give each vertex a chain/position pair: `a=(C0,0)`, `x=(C0,1)`, `b=(C0,2)`, `c=(C1,0)`, `d=(C1,1)`. For each source vertex `u`, store the lowest chain position reachable in each target chain; use `∞` if none is reachable.

| source `u` | low on C0 | low on C1 | checks |
| --- | ---: | ---: | --- |
| `a` | 0 | 1 | reaches `b` (2) and `d` (1) |
| `c` | 1 | 0 | reaches `x` (1), `b` (2), `d` (1) |
| `x` | 1 | 1 | reaches `b` and `d` |
| `b` | 2 | ∞ | reflexive self-query true; strict wrapper false |
| `d` | ∞ | 1 | reflexive self-query true; strict wrapper false |

Initialize each source with its own chain position; process reverse topological order and merge every outgoing successor row elementwise-min, so information reaches every relevant chain. Do not combine early self-seeding with the printed conditional-skip rule: it can lose cross-chain propagation (a→b→c with cover [a,b],[c]). For query `c→b`, target `b` is `(C0,2)` and `low[c,C0]=1≤2`, so it is reachable. For `b→d`, `low[b,C1]=∞`, so it is not. This is a constructed explanation of the SEA representation, not a claim of dynamic maintenance.

The SEA 2023 construction assumes a static DAG, topologically sorted adjacency lists, and a supplied decomposition. The all-successor reference recurrence costs `O(k_c(|V|+|E|))` including dense initialization and uses `O(k_c|V|)` space. SEA reports an optimized `O(|E_tr|+k_c|E_red|)` bound, which is not a bound for this reference method or proof that the literal printed combination is correct. The O(1) query claim is after construction in the stated array/RAM model. Sources: [Chen 2007 DOI](https://doi.org/10.1007/978-3-540-74469-6_25), abstract access; [Kritikakis–Tollis SEA 2023](https://drops.dagstuhl.de/opus/volltexte/2023/18352/pdf/LIPIcs-SEA-2023-2.pdf), §§3–4 and Appendix A.1, full paper read.
