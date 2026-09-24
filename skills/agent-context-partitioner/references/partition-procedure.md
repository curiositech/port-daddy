# Partition procedure against a supplied inventory

This procedure answers a narrow question: can the listed required context items be assigned to the listed already-admitted targets while preserving declared constraints? It does not discover items, pick a worker count, or start workers. `FEASIBLE` is relative to the exact supplied snapshot and policy.

## Inputs and output

An input inventory needs a stable root digest, a complete item list, provenance/trust and disclosure attributes, token estimates, required capabilities, causal-parent IDs, and an explicit completeness flag. Targets need stable IDs, capability/disclosure scope, capacity evidence, and current status. If discovery or target status is incomplete, return `UNKNOWN`. If every target is known but constraints admit no assignment, return `INFEASIBLE`.

The helper in `algorithms/partition_feasibility.py` is intentionally smaller than the full Context IR proposal validator. It accepts typed Python items and targets; it does not compute digests, authorize transfers, verify real capacity, or establish target identity. The JSON validator handles the separate proposal contract. Never infer that either fixture proves runtime safety.

## Filtering and assignment order

1. Check ID uniqueness and inventory completeness. Missing parent IDs are `UNKNOWN`; cycles are `INFEASIBLE` for this DAG-input contract.
2. Topologically order required items so a parent assignment exists before its child.
3. For each item, filter targets by required capabilities, audience/disclosure compatibility, and remaining capacity. Do not rank before hard filters.
4. If no candidate remains, return `INFEASIBLE` with the item gap.
5. Choose a deterministic candidate: prefer one already assigned to the greatest number of this item's parents, then the lower resulting token use, then lexical target ID.
6. Emit a transfer tuple `(parent_item, source_target, destination_target)` for every dependency crossing targets. In a production proposal, those tuples still require the typed edge and disclosure evidence checked by the JSON validator.
7. Re-run proposal validation against the original root digest. Any mismatch, stale target evidence, or unknown obligation yields `UNKNOWN`/rejection, never a silent fallback.

This greedy choice tends to keep related work together but is not an optimizer: it can make an early assignment that prevents a later one. It returns a concrete infeasibility rather than increasing worker count. A separate authorized planning authority may revise the target inventory; that is outside this skill.

## Worked fixture

Items: `source` (60 tokens) and `review` (50 tokens, parent=`source`). Target `A` has 100 tokens; target `B` has 100. In sorted order the first item is placed on A by the lower-ID tie break. Only B then has enough remaining capacity for `review`, so the result is feasible and includes transfer `(source, A, B)`. Remove target B and the same supplied set is infeasible. Mark the inventory incomplete and the result is unknown instead. These are local deterministic fixtures, not performance claims.

## Semantic traps

- A target being similar to an excluded document does not make the source admissible.
- A capacity number is trusted only to the extent its source and freshness are verified.
- Equal vector dimensions do not mean equal embedding space; this implementation does not use embeddings at all.
- A transfer edge expresses a dependency; it is not itself an authorization to disclose.
- A feasible partition proves coverage only of supplied obligations, not discovery completeness.
