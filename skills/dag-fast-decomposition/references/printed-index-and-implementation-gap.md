# Printed index versus implementation: a three-node witness

## Pin and read scope

The inspected [SEA 2023 PDF](https://drops.dagstuhl.de/storage/00lipics/lipics-vol265-sea2023/LIPIcs.SEA.2023.2/LIPIcs.SEA.2023.2.pdf), Algorithm 1 on printed page 2:10, SHA-256 `a62af6321ac242f95f6ccc1455dd1e4096af3034d1fc0fc686a54ee3f49b3c9e`, seeds the own-chain entry at line 7 and tests `t_pos < source.indexes[t_chain]` at line 13. Root opened the actual rendered PDF page. The same combination appears in [arXiv:2404.17954v2](https://arxiv.org/pdf/2404.17954v2), Algorithm 5, printed page 23 (targeted section read, not a new full-paper review).

This finding concerns that literal combination. It does not refute chain-position indexing generally or establish that the authors' experimental code used the printed representation.

## Exact constructed failure

DAG: vertices a,b,c; arcs a→b,b→c. Supplied valid paths: C0=[a,b], C1=[c]. Positions start at zero. Reverse order is c,b,a.

| Step | a row | b row | c row | Operation |
| --- | --- | --- | --- | --- |
| Seed | `[0,∞]` | `[1,∞]` | `[∞,0]` | Own position inserted first |
| Process b→c | `[0,∞]` | `[1,0]` | `[∞,0]` | 0 < infinity, merge |
| Process a→b | `[0,∞]` | `[1,0]` | `[∞,0]` | 1 < 0 is false, skip |

The final query a↝c is false because infinity is not ≤0, despite the two-edge path. No floating-point tolerance, tie rule, cyclic input, invalid cover, or self-query convention explains the result. The supplied cover need not be minimum under the stated source input contract. A four-node minimum-cover version is a→b→c,d→c with cover [a,b],[d,c]; it loses a↝c the same way.

## The author implementation uses another invariant

Read [IndexingScheme.java at commit 1af62b3d379f06c890bba87f4640f8bd1db31305](https://github.com/GiorgosKritikakis/OnGraphHierarchies/blob/1af62b3d379f06c890bba87f4640f8bd1db31305/src/graphhierarchies/transitiveclosure/IndexingScheme.java), file SHA-256 `cfd91becc6c28e449890d456471069e2d33b0b754a7bab2c6ef5c65903a99764`. Its constructor fills all slots with infinity without an early self seed. `update_indices` merges successor rows and explicitly inserts the target's position via `getPosition`. `isReachable` returns true for source==target, otherwise compares the source slot with the target's own-chain **successor slot** using strict `<`. The helper reconstructs a vertex's position from its next same-chain position (minus one), or uses the last chain position when the slot is infinity. This is a strict-successor representation with a different query, not the PDF's self-seeded `≤` representation.

Root translated that local logic and checked it, an all-successor reference recurrence, and a delayed-self-seed variant against exact closure on 75 ordered DAGs (1–4 vertices), all 460 valid supplied chain covers, both original and filtered edges: 42,888 query pairs agreed. The literal printed combination failed on 55 cover cases. These bounded checks are not execution or certification of the complete author Java project, nor an empirical speedup or approximation result.

## Practical repair and claim discipline

The active skill uses the simpler all-successor reference construction, with its explicit `O(kc(|V|+|E|))` bound. A delayed-self-seed conditional variant also passes these finite cases, but it is not silently substituted for the printed algorithm or assigned the source theorem. Preserve separate representation versions and an independent oracle before any optimization. A useful teaching lesson is that a chain already establishes same-chain reachability, but does not mean a source row has inherited a successor's cross-chain information. This is a reproducible source/implementation discrepancy and a candidate exercise, not a scientific novelty claim.
