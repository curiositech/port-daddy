# The Seven Topology Archetypes

Use this when scoring a WorkIntent's signal vector and you're not sure which of the seven
canonical archetypes it resolves to, or when a proposed mapping seems to fit two at once.

Source: `docs/architecture/agent-harbor-technical-binder/work-packets/official-agent-control-plane-synthesis.md`,
"Single Operator Action" — "The planner decides one node, scout, chain, DAG/workgroup,
tournament, ambient watcher, or human gate from coupling, context pressure, skill boundary,
review independence, budget, and operator burden." The list is exhaustive by design: the
operator should never see, or need, an eighth name.

## The six signals

| Signal | Question it answers | Typical values |
| --- | --- | --- |
| `coupling` | How tightly do the sub-steps depend on each other's live output? | `low` / `medium` / `high` |
| `contextPressure` | How much accumulated context must carry forward as the work proceeds? | `low` / `medium` / `high` |
| `skillBoundary` | How many distinct skill domains does the work span? | `single` / `few` / `many` |
| `reviewIndependence` | Does the output need a reviewer separate from the producer(s)? | `shared` / `independent` |
| `budget` | Cost/time envelope before the operator expects a check-in | `small` / `medium` / `large` |
| `operatorBurden` | How much steering/attention will the operator give while it runs? | `low` / `medium` / `high` |

## The seven archetypes

| Archetype | Leans on | Shape |
| --- | --- | --- |
| `node` | single skill boundary, low coupling, small budget, low operator burden | One Agent Node, one Body, one session. The default for a bounded, well-specified change. |
| `scout` | high context pressure, unclear skill boundary, low-to-medium budget | One Agent Node whose job is to reduce ambiguity (research/explore) before a real archetype can be chosen for the follow-on work. |
| `chain` | high coupling, medium-to-high context pressure, single-to-few skill boundary | A sequence of Agent Nodes where each step's output is the next step's required input; no parallelism, ordered handoff. |
| `dag-workgroup` | many skill boundaries, independent review, medium-to-large budget | Multiple Agent Nodes with real parallel branches and explicit dependency edges; independent review lanes per branch. |
| `tournament` | independent review, medium-to-large budget, low coupling between attempts | Multiple Agent Nodes attempt the same WorkIntent independently; a scored pick selects the winner. |
| `ambient-watcher` | low operator burden, low-to-medium context pressure, recurring/background | A long-lived, low-attention Agent Node that reacts to events rather than running once to completion. |
| `human-gate` | high stakes, irreversible action, independent review required by policy not just preference | An Agent Node whose plan is fully formed but whose execution is blocked on an explicit human approval step. |

## Disambiguation heuristics (when two seem to fit)

- **`node` vs `scout`**: if the skill boundary and the definition of "done" are already clear, it's a `node` even if the work itself is exploratory in flavor. `scout` is reserved for WorkIntents where the *shape* of the follow-on work is not yet knowable.
- **`chain` vs `dag-workgroup`**: `chain` has no real parallel branches — every step needs the previous step's output. The moment two branches could run concurrently with independent review, it's a `dag-workgroup`, not a "chain with some parallel steps."
- **`dag-workgroup` vs `tournament`**: a `dag-workgroup` divides the work into different pieces done by different nodes. A `tournament` has multiple nodes doing the *same* piece of work independently so one can be picked. If every node in your "workgroup" was assigned the identical WorkIntent, it's a `tournament`.
- **`ambient-watcher` vs everything else**: the deciding signal is lifecycle shape, not effort. If the Agent Node is expected to still be alive next week reacting to new events, it's an `ambient-watcher` regardless of how small any single reaction is.
- **`human-gate` vs `node`**: a `human-gate` is not "a node where a human happens to review the PR" (that's every node). It's reserved for WorkIntents where the plan cannot execute past a specific point without an explicit approval — the gate is structural, not incidental review.

A WorkIntent that genuinely resolves to two archetypes after applying these heuristics means
the signal vector itself is under-specified — rescore it, don't launch both.
