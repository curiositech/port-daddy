# Index and differential fixtures

All inputs are constructed finite DAGs. “Baseline” means hand-enumerated closure for the listed graph, not a runtime benchmark.

## Full index initialization and self query

Use topological order `[a,c,s,x,b,d]`, direct arcs `a→x`, `x→b`, `c→x`, `x→d`, `s→x`, `s→b`, and supplied chains `C0=[a,x,b]`, `C1=[c,d]`, `C2=[s]`, with positions starting at 0. Initialize each row to `[∞,∞,∞]`, then seed own-chain position.

| vertex | seeded row `(C0,C1,C2)` | useful propagated result | query checks |
| --- | --- | --- | --- |
| a | `[0,∞,∞]` | `[0,1,∞]` | `a↝a` true; strict `a↝a` false |
| x | `[1,∞,∞]` | `[1,1,∞]` | `x↝b` and `x↝d` true |
| b | `[2,∞,∞]` | `[2,∞,∞]` | `b↝b` true; strict false |
| c | `[∞,0,∞]` | merge x row to `[1,0,∞]` | `c↝b` true because `1≤2`; `c↝c` true |
| d | `[∞,1,∞]` | `[∞,1,∞]` | `b↝d` false |
| s | `[∞,∞,0]` | `[1,1,0]` | `s↝b` and `s↝d` true |

The self rows demonstrate that the source index is reflexive. A strict-query wrapper adds `u != v`; it does not change stored arrays.

## Cross-chain propagation and conditional-skip hazard

The table above is obtained by the all-successor reference recurrence. For s→x, merging x propagates both reachable chains; merging s→b afterward is redundant but valid. The paper's conditional skip seems attractive, but combining it with early own-chain seeding suppresses the essential a→x merge in this very fixture: a then fails to inherit reachability to d. The [smaller three-node witness](printed-index-and-implementation-gap.md) isolates that failure. The expected table must not be used as evidence that the literal printed algorithm computed it.

## Partial filter leaves a transitive edge

Take three vertices `[s,a,t]` and arcs `s→a`, `a→t`, `s→t`. Supply three singleton chains `C0=[s]`, `C1=[a]`, `C2=[t]`, a valid (not minimum) decomposition. For each source, its outgoing targets lie in different chains. For each target, its incoming sources lie in different chains. Both local rules therefore detect zero edges: `E'_tr=∅`. Nevertheless `s→t` is transitive through `s→a→t`; exact reduction would delete it. This fully specified fixture proves that the filter need not be exact for an arbitrary supplied decomposition.

On the same graph with cover `C0=[s]`, `C1=[a,t]`, the outgoing rule keeps `s→a` and detects `s→t`; the remaining arcs retain every reachability answer. Detection depends on the supplied cover. Neither case asserts an experiment ratio or index memory saving.

## Semantic differential cases

- **Deployment:** `build→scan→deploy→verify`, plus `build→deploy`. Index query `build↝verify=true` does not show scan passed or deployment is authorized.
- **Code review:** `parse→typecheck→review`, plus `parse→review`. Index query `parse↝review=true` does not mean review accepted. A result object lacking the approval artifact fails the application semantic check despite a valid reachability answer.
- **Sensor:** `ingest→calibrate→aggregate`, plus `ingest→aggregate`. Filter/index can establish order, never calibration accuracy, sample freshness, or aggregate validity.

These differentials separate a correct structural reachability answer from unsupported application conclusions.
