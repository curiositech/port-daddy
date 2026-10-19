# Topological layers, resource admission, and revision checks

For a directed acyclic graph whose edge `d → n` means “`n` requires `d`,”
compute a dependency layer in any topological order:

\[
L(n)=\begin{cases}0 & \text{when }deps(n)=\varnothing\\
1+\max_{d\in deps(n)}L(d) & \text{otherwise.}\end{cases}
\]

The direct-parent recurrence carries ancestor information through already
computed parent levels. It takes `O(V+E)` after a topological order; it does
not require materializing a transitive closure. Nodes with the same level have
no path between them, but a layer is not necessarily a maximal antichain: a
node at a later level may still be incomparable with a node in an earlier
level.

## Hand check

Let `A` and `B` have no dependencies; `C` depends on `A,B`; `D` depends on
`A`; and `E` depends on `C,D`. The recurrence yields
`L(A)=L(B)=0`, `L(C)=L(D)=1`, and `L(E)=2`. The dependency layers are
`{A,B}`, `{C,D}`, `{E}`. Changing `B` to depend on `A` yields `{A}`, `{B,D}`,
`{C}`, `{E}`. This checks declared precedence only.

Dependency eligibility differs from resource scheduling. If `C` and `D` both
need the same exclusive test environment, they may remain in dependency layer
1 while a resource scheduler serializes them. Conversely, a layer assignment
with unlimited, unit-time workers is a lower-bound-style planning view; it is
not a measured speedup, a duration-optimal schedule, or proof that simultaneous
edits are safe. Attach resource, authority, and side-effect constraints before
admission.

## Mutation/revalidation procedure

1. Preserve revision `r` and its prior outcome records.
2. For a proposed `r+1`, list changed nodes, edges, output contracts, and the
   evidence/rationale that motivated each change.
3. Reject a cycle, a missing producer, or a successor whose required contract
   has been removed or changed without revalidation.
4. Recompute layers on the proposed validated graph. A forward traversal from a
   changed node identifies descendants worth inspecting, but all changed
   interfaces still require contract checks.
5. Join the next layer only to successful, revision-matched outcomes and then
   apply risk, approval, authority, and resource gates.

Negative check: if `scan@r4` was pruned, `inspect-call-sites@r5` cannot retain
its old `scan` input merely because it occupies a later layer. It must receive
a validated replacement producer or remain held/pruned. Likewise an
`outcome@r4` is not relabeled as `r5`; a reuse declaration must state the
current revision binding and evidence provenance.
