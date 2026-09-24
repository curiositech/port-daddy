# B06 three-skill source deepening: planner, dynamic replanner, scheduler

**Scope and integrity.** Research brief for dag-planner, dag-dynamic-replanner, and dag-task-scheduler; no skill, code, Book, or repository edit. Read-only W verified as /Users/erichowens/coding/tmp/agent-skills-expansion-20260924, branch codex/agent-skills-expansion-20260924, linked gitdir /Users/erichowens/coding/port-daddy/.git/worktrees/agent-skills-expansion-20260924, clean status ## codex/agent-skills-expansion-20260924...origin/main. Read all three original SKILL.md files, research/planning-B06.md, planning-B06-three-root-notes.md, planning-B06-three-preimages.json, and AUTHORING-ACCEPTANCE.md. Preimage hashes and full headings are in planning-B06-three-preimages.json.

## Sources actually inspected (2026-09-24)

| Source | Relevant sections and depth | Boundary |
|---|---|---|
| [Python 3.14.7 graphlib](https://docs.python.org/3/library/graphlib.html), TopologicalSorter, prepare, get_ready, done, CycleError | Full relevant API sections. Edge u→v means u before v; a complete topological order iff no directed cycle; ready means all predecessors done; CycleError includes one closed cycle witness; non-cycle-blocked nodes can still be emitted after prepare reports a cycle. | Current Python stdlib behavior, not a universal framework guarantee. |
| [Kahn 1962, “Topological sorting of large networks”](https://doi.org/10.1145/368996.369025), CACM 5(11), 558–562 | Primary bibliographic record/abstract only; article body inaccessible in this pass. | Cite only as historical primary topic anchor; don't attribute a specific witness algorithm/result to it. |
| [Graham 1966, “Bounds for Certain Multiprocessing Anomalies”](https://ia801900.us.archive.org/27/items/bstj45-9-1563/bstj45-9-1563_text.pdf), Bell System Technical Journal 45(9), 1563–1581; [Bell Labs record](https://www.nokia.com/bell-labs/publications-and-media/publications/bounds-for-certain-multiprocessing-anomalies/) | Full 20-page scan/OCR inspected, especially printed pp.1563–64 / PDF pp.0–1 and results introduction at printed p.1567 onward. Model: finite tasks, n identical processors, partial order, fixed processing times; a started task runs without interruption; a fixed linear list is scanned at processor completion and the first unstarted task whose predecessors completed is selected. Gantt/timing diagram represents processor use. | Exact assumptions matter. This source studies anomalies and bounds under its model; it does not establish an optimal schedule for heterogeneous agents or uncertain runtime. |
| [AWS Step Functions state-machine versions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-state-machine-version.html) and [StartExecution API](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html) | Version and StartExecution sections inspected. AWS says numbered versions are immutable snapshots; qualified version ARN runs that version, unqualified ARN uses latest revision. Same name+input idempotency applies to running Standard executions; Express StartExecution is not idempotent. | Product-specific current docs (retrieved/crawled within three weeks; no service release pinned). Not a generic retry guarantee. |
| [Temporal Workflow Definition](https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/workflow/workflow-definition.mdx) and [TypeScript versioning](https://github.com/temporalio/documentation/blob/main/docs/develop/typescript/workflows/versioning.mdx) | Official docs on moving main branch, relevant determinism, command-producing APIs, replay and versioning sections inspected; Temporal describes old/new workflow code paths and keeping command sequence compatible with in-flight histories. | Current docs accessed 2026-09-24; commit/SDK version not pinned. Temporal-specific behavior, not DAG law. |

Three claim classes must remain separate: (1) graph mechanics: hard predecessor readiness, topological ordering and cycle detection; (2) product-specific AWS/Temporal version and replay behavior; (3) proposed local engineering policy: immutable plan snapshots, compare-and-swap revision admission, typed evidence/authority, invalidation and unknown-effect reconciliation. Label (3) as this skill's proposal, not a theorem or framework feature.

Do not encode every resource conflict as a precedence edge. Capacity-one resource contention is a resource constraint or an explicit serialization policy. Optional information is not a hard prerequisite. Approval is a hard gate: the protected external effect remains blocked until an approval artifact and action authority exist. A local draft can proceed while approval is pending only if it is genuinely separated from the gated effect. On a cycle, return a real witness and edge types; never delete the supposedly “weakest” data, resource, approval, or authority edge.

## Hand-checkable constructed example

All durations are constructed integer ticks, not measurements. Two identical non-preemptive slots. Edges mean required predecessors.

| ID | Output/task | Duration | Predecessors | Gate/resource |
|---|---|---:|---|---|
| A | source bundle with provenance | 2 | — | slot |
| B | analysis | 3 | A | slot |
| C | policy review artifact | 2 | A | slot |
| D | release draft | 1 | B,C | slot; no publish |
| E | security scan receipt bound to D digest | 2 | D | slot |
| G | human approval bound to D and E | 1 | C,E | human gate |
| F | publish exactly approved D digest | 1 | G | external effect; authority + reconciliation contract |
| V | verify published version by readback | 1 | F | slot |

Edges: A→B, A→C, B→D, C→D, D→E, C→G, E→G, G→F, F→V. One root happens to be used here; multiple independent roots can be valid.

Feasible work-conserving list schedule:

| Tick | Slot 1 | Slot 2 | Why ready |
|---|---|---|---|
| [0,2) | A | idle | Only root. |
| [2,5) | B | C [2,4), then idle | A done; B and C both ready. |
| [5,6) | D | idle | B and C done. |
| [6,8) | E | idle | D done. |
| [8,9) | G | idle | C and E done; approval must actually be recorded. |
| [9,10) | F | idle | Only after approval and action authority. |
| [10,11) | V | idle | Publish result available for readback. |

Makespan 11; chain A-B-D-E-G-F-V also sums to 11. This establishes only this fixture's feasible schedule/critical path, not general optimality. Barrier waves would wait for all tasks in a batch; a ready queue can launch C while B is running.

**Revision cases.** Positive: V1 has A complete and B running when a scan requirement adds E after D and makes G depend on E and C. Propose V2 against expected V1; keep running B pinned to V1. Validate references, artifact contracts/digest provenance, approval/action authority, cycles, affected descendants and resources; atomically admit only if head is still V1. Reuse completed D only if its recorded inputs/provenance still satisfy V2; else mark stale and regenerate. This is our proposed protocol, motivated by (not specified by) AWS/Temporal versioning.

Negative cycle: proposed F→E while E→G→F remains. Report closed witness E→G→F→E; reject atomically, retain V1, require authorized requirement change. Don't auto-delete an edge.

Negative fallback: a file reader with matching field names does not replace a failed connector unless source, freshness, scope, completeness, meaning and consumer contract all match. Otherwise downstream remains blocked; graph reachability is not input validity.

Unknown timeout: F times out after request may have reached provider. Record outcome unknown, stable operation/idempotency identity, request digest and last response. Do not classify as failure or retry automatically. Reconcile via provider/readback. If success is observed, record receipt; if definitely absent, retry only when provider contract permits and with stable identity; if ambiguous, stay blocked and seek authorized resolution. Plan rollback does not undo the external effect; compensation is separately authorized/evidenced. If G approval is pending, F remains blocked; “assume approval” is never evidence.

## Topic-specific additions and original-heading retention

Retain useful original methods under their original headings; replacing an example with a generic caution is not retention. The exact all-heading source ledger and preimage hashes are in planning-B06-three-preimages.json.

### dag-planner (preimage da3561a0d8a1ad6b4e921b6ff081390e643cb16c39012e50e2e7ac9738868725)

- Decision Points / 1. When to decompose: keep single-step, linear, convergent paths, unclear requirements. Replace fixed node ranges with purpose, outputs, true dependencies, independent work and unresolved assumptions; allow multiple roots.
- 2. Choosing node types by certainty: retain agent, bounded vague/refinement node, human gate, restricted external node. A vague node needs a refinement question/stop condition and is not ready to execute.
- 3. Granularity: keep too coarse/too fine tradeoff; remove one-call/skill-count rules. Split/merge based on outputs, ownership, review boundary, invariants and failure isolation.
- 4. Handling conflicts/dependencies: preserve data, resource, ordering, optional-input categories. Data and approval edges require evidence; resource capacity differs from precedence; optional input does not block.
- 5. Dynamic modification triggers: keep repeated failure, quality gap, coverage gap, unnecessary path, alternative path. Route through versioned replan; removal must preserve consumer contract/authority, not just reachability.
- Failure Modes / Schema Drift: symptom→diagnosis→contract repair, not wave percentage; check schema version and provenance.
- Circular Dependency Trap: preserve diagnosis; replace “break weakest dependency” with a closed cycle witness, typed edges and authorized repair.
- Granularity Explosion: preserve overhead diagnosis/merge option; no node-count multiplier, measure workload.
- Ghost Dependencies: retain shared-state audit; make data/resource contracts explicit, don't serialize every conflict as precedence.
- Wave Starvation: retain diagnosis; identify actual independent paths/frontier; wave ratios don't prove malformed graph.
- Worked Examples / Example 1: retain collect→analyze→recommendations and schemas; show edges, evidence and readiness frontier, no unsupported “expert vs novice.”
- Example 2: retain independent research, convergence and human review; separate shared-file artifacts or declare a resource policy. Remove “presentation before human approval if assume approval”; only an independently scoped draft can proceed. Show full graph.
- Example 3: retain failed quality gate→diagnose→alternative path→compare/synthesize; add plan version, state, contracts and rejection branch; comparison requires common criteria/evidence.
- Quality Gates: retain purpose, schemas, explicit dependencies, cycle check, resources, refinement and human approval policy; remove >3 skills, five-minute, wave ratio and <10× universal thresholds. Gate readiness on evidence.
- NOT-FOR Boundaries / Delegate to: retain execution, validation and skill-selection boundaries; planner still declares its own interfaces.

### dag-dynamic-replanner (preimage 400a2e822010e16c041bb25464f3e50fea56b9fae1828066671c13b552e62639)

- Decision Points / Trigger Analysis: retain node failure, timeout, missing dependency, resource exhaustion, repeated failure as distinct. Timeout can mean unknown outcome; only retry under a safe idempotency contract. Missing producer cannot be bypassed without equivalent provenance/freshness/meaning.
- New Requirement Discovered: retain blocking/non-blocking/conflict choices; proposal is against exact version; don't call a semantic change merely “queued.”
- Resource Constraint Hit: retain memory/time/dependency reasoning, with one consistent capacity snapshot and hard limits. No arbitrary training split/accuracy claim without method and experiment.
- Cascading Failure: retain targeted vs broad diagnosis; remove affected-count thresholds; compute descendants by edge, contract, state; allow multiple roots.
- Modification Strategy Matrix: retain scenario→proposal mapping; retry only when safe, fallback only with compatible evidence, skip only if consumer permits absence, defer under resources, insert prerequisite before gate.
- Failure Modes / Schema Drift: preserve contract check/adapters; schema equality is not provenance, freshness, scope or semantics.
- Cycle Introduction: preserve pre-admission cycle check/rejection; report witness and retain old plan.
- Orphan Creation: preserve dangling references; bridge only with authorized producer and full contract. Reachability alone doesn't prove validity.
- Resource Cascade: preserve recomputation/reject/defer; replace 150% with explicit capacity and reservations; separate resource constraints from precedence.
- State Corruption: preserve running/pending protection; pin run snapshot, specify cancel/drain/effect state; running nodes retain inputs/version.
- Worked Examples / Example 1: preserve build→test→scan→deploy; add V1/V2, digest contract, invalidation, approval and cycle refusal; graph edit doesn't authorize deploy.
- Example 2: preserve connector failure, alternate-source candidate, fan-out, report; replace node count with per-consumer source/provenance/freshness/meaning checks and show incompatible fallback rejection.
- Example 3: preserve memory conflict and defer/serialize option; correct capacity arithmetic. No arbitrary training chunks or guaranteed no accuracy loss.
- Quality Gates: preserve acyclicity, references, resources, contracts, state and history; add compare-and-swap, old-run identity, stale descendant and unknown-effect checks. Remove 120%, 50%, “rollback” guarantee; plan rollback differs from external compensation.
- NOT-FOR Boundaries: retain build, optimization, scheduling, diagnosis, monitoring separations; replan proposes a new version, does not execute/compensate it.

### dag-task-scheduler (preimage 3ab4c6678d07598b9127ecf5da52ac00c21060b8f72900d3ba8d86451ad80aa1)

- DECISION POINTS / 1. Resource Contention: retain CPU/memory/token/slot cases; declare objective, units, capacity, compatibility. Critical path informs deadline analysis, not automatic preemption. Require safe pause/resume contract for preemption.
- 2. Wave Overflow: retain concurrency check; remove 2× cutoff and task filtering. Schedule required work later or report infeasible; distinguish barrier waves from ready queue.
- 3. Priority Conflicts: retain deadline/efficiency/bottleneck/independent considerations; priority never defeats prerequisite or approval. Explain starvation/inversion with declared policy.
- 4. Runtime Adaptation: retain early/late/failure; recompute readiness from observed completion; unknown outcome goes to reconciliation; skip only if consumer allows absent output.
- FAILURE MODES / Wave Overflow: use declared capacity, not 1.5×.
- Resource Starvation: retain under-use diagnosis; idle can be correct due to gate/resource fit. Inspect eligible frontier; remove 30% threshold.
- Priority Inversion: retain blocker-chain finding; correct policy without violating hard dependencies.
- Deadline Miss: retain model-vs-deadline diagnosis; compute all tasks/edges/durations/gates; preempt/add capacity only when model permits.
- Thrashing Schedule: retain repeated-change diagnosis; replace 3/min with an explicitly local observed window.
- WORKED EXAMPLES / Research Pipeline: replace inconsistent eight-task/seven-named-task case with a complete table, all edges, all durations including gather/synthesis, resource-time/Gantt trace and approval gate. Remove unsupported longest-task/critical-path claim.
- QUALITY GATES: retain coverage, precedence, resource, deadline, critical path, policy and variance checks; remove “optimal,” >70% utilization, zero waste, resilient-to-one-failure, ±20% guarantees; schedule is not observed execution.
- NOT-FOR / Delegation: retain structure/execution/monitor/replan/result/error boundaries; handoff schedule makes no runtime claim.

## Diagram brief, Book boundary, validation

Final bundle needs two useful rendered diagrams per skill, semantically inspected per AUTHORING-ACCEPTANCE:
- Planner: (1) typed hard predecessor / optional data / resource capacity / preference / approval classifier and ready frontier; (2) cycle witness, unaffected frontier, authorized repair back to validation; allow multi-root.
- Replanner: (1) expected-version snapshot→reference/contract/provenance/authority/cycle/resource checks→CAS admit Vn+1 or reject, with running node pinned; (2) changed artifact→descendant invalidation/revalidation and unknown effect→reconcile/human hold/authorized compensation.
- Scheduler: (1) evidence+gates→ready→resource reserve→running→observed completion with failed vs unknown outcomes; (2) Gantt for exact table above, with approval-gated publish and “planned, not runtime” label.

planning-B06-three-root-notes.md identifies typed plan revision as existing Book candidate 4; do not rename it as novel. A possible *additional experiment candidate only* is a reproducible comparison of active-plan mutation vs V1/V2 admission with one timed-out external effect and pending approval, measuring stale-descendant count, blocked-vs-eligible decisions, duplicate effects, reconciliation correctness. No manuscript/novelty search or experiment occurred.

No provider/framework execution, parser, tests, Mermaid render, ASCII conversion, or Book search was done. The schedule is constructed and hand-calculated. Final acceptance must verify the actual edited bundle, links/frontmatter, recursively inspect ASCII and render diagrams, recording exact hashes.

