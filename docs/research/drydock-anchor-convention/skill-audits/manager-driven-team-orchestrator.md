# Skill audit — `manager-driven-team-orchestrator`

**Independent read-only audit · anchor `6c2c30d74b889b4d8037ce5d43b265bfbf21a686`**

## Verdict

**Supplant in place.** Semantic score: **3.7/10 (D)**; containment readiness:
**0.5/10**. The current bundle is a concise topology sketch, not a safe
orchestration discipline. The manager defines ship criteria, creates roles,
controls rounds, evaluates readiness, and signs off, making it claimant,
adjudicator, and witness.

| Dimension | Score / 10 | Finding |
|---|---:|---|
| Activation | 6 | Good trigger but overclaims execution and misses authority/capacity/dissent audits. |
| Domain expertise | 3 | Useful team/workflow distinction; heuristics are not enforceable rules. |
| Progressive disclosure | 4 | Small core but no deep protocol, schema, or evidence layer. |
| Self-containment | 1 | No scorer, schema, fixture, or complete example. |
| Maintainability | 3 | Non-SemVer changelog and stale contradictory scorecard. |
| Visuals | 5 | One valid flow that omits admission, capacity, dissent, review independence, and termination. |

## Authority findings

- **Manager authority:** manager defines roles and ship condition, mutates roles,
  controls rounds, decides readiness, and closes the team. No independent
  admission or acceptance authority exists.
- **Worker independence:** manager retains “full history”; workers cannot change
  topology and lack durable dissent/escalation.
- **Bounded recursion:** not-ready and replace-role edges loop without maximum
  rounds, births, attempts, depth, deadline, or budget.
- **Dissent:** outputs have manager summaries but no immutable minority report,
  rejected finding, appeal, or non-assent.
- **Capacity:** “fewest roles” is not a reservation or hard ceiling.
- **Births:** manager directly adds roles; no proposal/admission receipt split.
- **Self-review:** manager defines success and certifies it.
- **Witness quality:** manager signs its own summarized history; no independent
  clean-origin, evidence, admission, or review witness is named.

## False-green evidence

Strict structural validation passes and Mermaid syntax passes while the bundle
has no policy-negative fixture. Self-containment passes vacuously because there
are no support assets. The stale hand-maintained scorecard simultaneously says
structurally incomplete and validator passed, and miscounts core artifacts.

Existing quality boxes can all pass while the manager is also reviewer, launches
fifty unreserved workers, permits recursive helpers, loops forever, drops
blocking dissent, changes ship criteria after evidence, or signs its own claim.

## Claims to delete or narrow

- Narrow “plan and run” to **design and audit**.
- Replace “manager decides ready” with manager submits a candidate and an
  identity-disjoint reviewer or acceptance gate decides.
- Manager proposes role changes; admission authority reserves and authorizes.
- Manager schedules only within immutable, pre-admitted bounds.
- Workers cannot mutate topology but can file durable dissent/escalation.
- Replace “full history” with bounded, provenance-linked evidence and dissent.
- One durable state writer owns authoritative state; manager holds a lease.
- Move tool-specific context-fork instructions to an exact integration reference.
- Remove phantom `team-builder` pairing and delete the stale scorecard.

## Replacement boundary

> Design and audit bounded manager-led agent-team plans whose active roles may
> change between evidence-driven rounds. Use after topology selection when the
> plan must prove external capacity admission, independent workers and reviewers,
> hard round/birth/concurrency limits, durable dissent, and manager-independent
> ship approval. NOT for launching agents, choosing topology, fixed workflows,
> peer swarms/blackboards, human personnel management, or manager self-approval.

## Required contract

Authority matrix:

- manager proposes assignments and candidate decisions;
- admission authority reserves capacity and authorizes each birth;
- workers produce attributable evidence and dissent;
- identity-disjoint reviewers issue acceptance findings;
- operator owns stop and escalation.

The closed team-plan schema requires immutable ship criteria, `maxRounds`,
`maxConcurrentWorkers`, `maxTotalBirths`, `maxSpawnDepth`, attempt limits,
deadline, budget/capacity ceiling, clean origins, admission receipts, worker
evidence, dissent records, and independent review receipts.

The deterministic audit must fail on `manager-self-approval`,
`ship-criteria-mutated`, `birth-without-admission`, `capacity-not-reserved`,
`unbounded-rounds`, `recursive-spawn-enabled`, `dissent-not-durable`, and
`claimant-is-evidence-witness`.

## Required bundle

- core under 220 lines with least-privilege tools;
- closed schema, pure auditor, passing fixture, and one negative fixture per
  stable finding;
- authority sequence and bounded lifecycle diagrams;
- three wired anti-patterns: Sovereign Manager, Birth by Prose, Loop Until
  Agreement;
- six positive and six negative activation cases;
- SemVer `v2.0.0` changelog;
- dependent correction to any claim that manager self-steelmanning can certify
  closure;
- no legacy self-approval or direct-birth mode.
