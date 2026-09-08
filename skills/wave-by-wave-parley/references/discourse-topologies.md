# Discourse Topologies: When Parley, When Independent Work

Six typed topologies describe how agents exchange information or divide labor. Each has a distinct coordination overhead profile, a distinct failure mode, and a natural home in the Jury-rig commitment lifecycle. Choosing the wrong topology for a parley checkpoint is not just inefficient — it corrupts the commitment decision.

## The Six Topologies

**1. Request-Response (RPC)**
One caller, one callee, synchronous round-trip. Latency is O(1) LLM calls. Correct for: evaluating a single TENTATIVE node against a single upstream output when there is no ambiguity about which output is relevant and the re-evaluation is purely factual (e.g., "did wave 1 produce the schema node X needs?"). Wrong for: any situation where the evaluator has priors that differ from the requestor — the single-callee design bakes in one perspective.

**2. Supervisor-Worker**
One coordinator decomposes a job and dispatches subtasks to workers; coordinator aggregates. Overhead: 1 + N calls, serialized at aggregation. This is the default Jury-rig wave topology — the orchestrator is the supervisor, parallel agents are workers. For parley, use supervisor-worker only when the re-evaluation of TENTATIVE nodes requires different information from different completed nodes and those retrievals can be parallelized. Do not use it when the parley itself is the coordination unit — that collapses to request-response.

**3. Fan-Out / Fan-In**
Broadcast a query to N independent agents, collect all N responses, reduce (vote, union, intersection). Overhead: N parallel calls + 1 reducer call. Use for: generating N independent risk re-assessments of the same node and reducing to a consensus severity. Avoid for: parley decisions where the node's input contract is sequential (the outputs must be interpreted in order, not voted on).

**4. Critique-Refine (Adversarial Pair)**
Producer generates a candidate; critic evaluates and returns structured critique; producer revises. Iterations: typically 1-3 rounds. Overhead per round: 2 calls. Use for: promoting a node from TENTATIVE to COMMITTED when the original commitment assessment is contested — the producer argues for promotion, the critic surfaces remaining uncertainty. This matches the Klein RPD formation-break analogy in the SKILL.md directly: the field commander (producer) proposes the next maneuver; the S2 intelligence officer (critic) challenges assumptions. Stop when critic confidence exceeds threshold (e.g., `severity <= medium` for all risks). Do not use critique-refine for pruning decisions — pruning is irreversible and should use debate topology instead.

**5. Debate**
Two or more agents argue opposing positions; a judge (or quorum vote) resolves. Overhead: 2N + 1 calls minimum. Use for: irreversible mutations — pruning a node entirely or demoting COMMITTED to EXPLORATORY (which SKILL.md marks as monotonic downward forbidden, making this the exception path when a wave's outputs have materially changed the problem). Debate provides a defensible audit trail for a decision the operator may later question. Do not use debate for routine TENTATIVE → COMMITTED promotions; the overhead exceeds the epistemic gain.

**6. Blackboard**
Agents post partial results to a shared workspace; other agents read and build on them asynchronously. No fixed turn order. Overhead: unpredictable — agents read/write until convergence or timeout. Closest Jury-rig analogue: the stigmergic medium in SOMA (pheromone traces as blackboard entries). Correct for: multi-wave synthesis problems where wave N+1 nodes depend on partial outputs from multiple wave N agents that complete at different times. Wrong for: synchronous parley checkpoints with a hard wave boundary — the lack of turn order produces non-deterministic parley outcomes. If you find yourself reaching for blackboard at a parley checkpoint, the problem is that the wave boundary is not actually synchronous; reconsider your wave decomposition.

## Parley vs. Independent Work — Decision Rule

Parley (coordinated re-evaluation) is warranted when:
- The upcoming wave has ≥1 TENTATIVE/EXPLORATORY node, **and**
- The completed wave produced evidence that is directly in the dependency chain of those nodes.

The topology for that parley maps to the uncertainty profile:

| Scenario | Topology |
|---|---|
| 1 TENTATIVE node, 1 upstream dependency, factual check | Request-Response |
| 1 TENTATIVE node, contested re-assessment | Critique-Refine |
| N TENTATIVE nodes, independent of each other, need parallel re-assessment | Fan-Out / Fan-In |
| Pruning decision or forced demotion | Debate |
| ESCALATE_TO_HUMAN gate | Supervisor-Worker (orchestrator surfaces to human) |

Independent work (no parley) is warranted when:
- `shouldParley` returns false (all upcoming nodes COMMITTED, premortem is PROCEED).
- In this case, the orchestrator proceeds directly to `executeWaveParallel` — zero extra LLM calls, zero coordination overhead.

The critical mistake is running critique-refine or debate on a node that is already COMMITTED. Commitment is declared closed; re-opening it at a parley checkpoint undermines the monotonic guarantee in SKILL.md and introduces plan instability across waves.

## Key Points
- Topology choice determines LLM call count and latency floor: request-response = 1 call, critique-refine = 2–6 calls, debate = 5+ calls. Budget accordingly before the parley checkpoint fires.
- Fan-out is only appropriate when the N re-assessments are genuinely independent — if any assessor's output should inform another's, use supervisor-worker or blackboard instead.
- Debate is the correct topology for irreversible mutations (prune, forced demotion) because it produces a defensible audit trail; critique-refine is correct for reversible ones (promote, soften severity).
- Blackboard is architecturally incompatible with synchronous wave parley; its asynchronous convergence model belongs to continuous-execution topologies (swarm, stigmergic medium), not scheduled wave checkpoints.
- When all nodes in the upcoming wave are COMMITTED and premortem recommendation is PROCEED, `shouldParley` returns false and zero topology is invoked — this is the common case and must stay O(0) calls.

## See Also
- `SKILL.md` — `shouldParley` implementation and `executeWithParley` loop; the monotonic commitment guarantee.
- `packages/core/src/topologies/swarm.ts` — `executeSwarm`: the reactive blackboard/message-bus topology that contrasts with scheduled DAG parley.
- Klein (1993) RPD model and the formation-break analogy — the tactical decision-cycle maps directly: report in (wave output), reassess (parley), re-issue orders (wave mutation).
