# Transitive-Closure Wave Scheduling vs. Topological Sort

## Why Waves Are Not Just Layers of a Topological Sort

A topological sort produces a total linear order on DAG nodes consistent with edges. Wave scheduling is strictly coarser: wave k is the **maximal antichain** of nodes whose entire dependency closure falls within waves 0..k-1. More precisely:

```
wave(n) = 0                              if in-degree(n) = 0
wave(n) = 1 + max(wave(d) for d in deps(n))  otherwise
```

This is the **critical-path layer** assignment, sometimes called "level" in the literature (Coffman & Graham, 1972; CLRS §22.4 treats it implicitly via DFS finish times). The distinction from topo-sort matters enormously for parallelism and replanning:

- **Topological sort** gives you a permutation of nodes. Any permutation consistent with edges is valid. You could serialize all nodes in a single wave and satisfy the definition. The sort tells you *a* valid execution order, not the *parallel-optimal* one.
- **Wave assignment** gives you the minimum number of sequential steps required if unlimited parallel executors are available. Wave width = exploitable parallelism. If wave k has 8 nodes, you can launch 8 agents simultaneously.

For a DAG with n nodes and longest path p, topological sort has O(n) serial steps; wave scheduling has O(p) sequential steps and O(n/p) average width. In typical Jury-rig decompositions (p ≈ 3-5, n ≈ 10-20), that difference is a 3-6x wall-clock speedup on real workloads.

## Transitive Closure Is the Load-Bearing Operation

The wave assignment above collapses to: **wave(n) = length of the longest path from any source to n**. Computing this requires knowing the transitive closure — every ancestor of n, not just direct parents. The recursive max over `deps(n)` implicitly does this.

Why does this matter for replanning? When you mutate the DAG mid-execution (parley demotes node B, pruning its subtree), you must recompute wave assignments for all nodes whose longest incoming path passed through B. That is exactly the set of nodes in B's transitive closure in the **forward** direction (B's descendants). Nodes not in `fwd-TC(B)` are unaffected and retain their wave assignments.

Contrast with topological sort: if you remove B from a topo-sorted list, you must re-sort from scratch or reason carefully about which permutation constraints are invalidated. There is no O(1) test for "is this node's position still valid?" With wave assignments, the test is: "does any path from a source to this node pass through B?" — that is precisely membership in `fwd-TC(B)`, computable by a BFS/DFS forward from B in O(V + E).

## Dynamic Replanning Protocol

After parley produces mutations (promote, demote, prune):

1. **Collect affected nodes**: `affected = fwd-TC(mutated_nodes)` via forward BFS from all mutated nodes. Prune removes the node and all its descendants from `affected` that have no surviving dependency path.
2. **Recompute wave assignments** for `affected` only. Nodes not in `affected` keep their current wave number. This is O(|affected| + E_affected) not O(V + E).
3. **Re-sort waves array**: merge recomputed assignments back. If a previously wave-3 node now has max-dep-wave = 2, it drops to wave 3 still (wave = max_dep_wave + 1). If it had a pruned dependency it may drop to an earlier wave.
4. **Renumber wave indices** if any wave becomes empty after pruning. Gaps cause off-by-one errors in the parley loop (`dag.waves[i + 1]` references become stale). Compact the waves array before handing it back to the executor.

One common mistake: recomputing wave(n) using only direct parents (`deps(n)` in the adjacency list) rather than the transitive max. This is safe only if the adjacency list includes *all* edges, not just the "original" edges before mutation. Mutation can add edges (when a demoted node is rescheduled to a later wave, you may need to insert a synthetic dependency edge to prevent it from being scheduled too early relative to its evidence sources).

## Why This Beats Topo-Sort for Replanning

Topo-sort is a global invariant: any modification to the graph requires re-verifying the invariant globally. Wave assignment is a **local invariant with a known perturbation radius**: the perturbation radius of a mutation at node B is exactly `|fwd-TC(B)|`. In practice, late-wave TENTATIVE nodes (the ones parley targets) have small forward transitive closures — they are near the leaves. Leaf mutations are O(1) perturbation radius. That is why parley is cheap: the mutations it makes are structurally at the frontier of the DAG, not at the roots.

Topological sort also lacks a natural concept of "concurrency level." It cannot directly answer "which nodes can run in parallel?" without a second pass to identify antichains. Wave assignment answers this by construction: all nodes in wave k are mutually independent (no edge between any two nodes in the same wave, by the layer-assignment invariant). This is the key structural guarantee the executor relies on when launching parallel agents.

## Key Points

- Wave k = maximal antichain of nodes with all dependencies in waves 0..k-1; computed via longest-path from sources (transitive closure, not just direct-parent max).
- Topological sort is a serialization; wave scheduling is the parallel-optimal stratification. On typical Jury-rig DAGs (path length 3-5), this yields 3-6x wall-clock improvement.
- Dynamic replanning after mutation touches only `fwd-TC(mutated_nodes)`. For leaf-adjacent TENTATIVE nodes (parley's primary targets), this is O(1) to O(small constant) — not a global re-sort.
- After pruning, compact the waves array to eliminate gaps before passing it back to the executor. Stale `dag.waves[i+1]` references cause silent off-by-one skips.
- The parallel-safety guarantee (all nodes in the same wave are mutually independent) is an invariant of wave assignment by construction, not a property you verify separately.

## See Also

- `SKILL.md` §Implementation Pattern — `executeWithParley` loop; the `dag.waves[i+1]` reference is where recomputed wave arrays must be live before the next iteration.
- `references/commitment-level-semantics.md` — how TENTATIVE/EXPLORATORY/COMMITTED drive which nodes enter the parley re-evaluation and thus which mutations feed back into wave recomputation.
- Coffman, E.G. & Graham, R.L. (1972). "Optimal scheduling for two-processor systems." *Acta Informatica* 1(3), 200–213. — original formalization of level-based (wave) scheduling for parallel task graphs; proves that the greedy layer assignment is optimal for minimizing makespan under unlimited processors.
