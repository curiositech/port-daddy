# Drydock Knowledge Map

Use this map to load the smallest authoritative slice. Do not read the whole
corpus by default: the three design volumes exceed 5,000 lines and intentionally
separate different trust questions.

## Canonical design volumes

| Question | Load | Authority and limits |
|---|---|---|
| How can arbitrary Port Daddy code run without host, network, credential, Git, or spend escape? | `references/controlled-agent-simulation.md` | Full containment, broker, Trial Basin, fault, receipt, and test-suite proposal. Static design only. |
| How are bodies admitted, witnessed, stopped, reaped, resumed, and shown to the operator? | `references/agent-lifecycle-and-operator-control.md` | Lifecycle and operator-control proposal. Does not itself prove VM or provider behavior. |
| How do resurrection, subscription capacity, context compaction, tools, prompts, hypertrees, and operator journeys join? | `references/resurrection-capacity-and-context-control.md` | Integrating research/design volume. It distinguishes confidence from implementation truth. |
| Which component/process/language owns each authority? | `references/architecture-decisions.md` | Compact decision ledger derived from the volumes and focused skills. |
| Which visual proves which relationship? | `references/diagram-atlas.md` | Diagram collection with proof and non-proof notes. |
| What can be built and promoted in what order? | `references/delivery-and-proof.md` | Delivery stages, witness classes, and release gates. |
| How are live hypertree execution, low-cost review, manager scrutiny, bounded rework, and three operator clients composed? | `references/hypertree-execution-observatory.md` | Static T0 execution contract and delivery design. It does not claim a running scheduler, reviewer, or UI. |

## Normative focused skills

These are peers, not excerpts hidden inside this skill:

| Contract | Skill | Load when |
|---|---|---|
| Hostile execution and effect containment | `sandboxed-adversarial-test-harness` | Any code, test, daemon, tool, network, provider, or credential could execute. |
| Identity and body continuity | `agent-resurrection-and-body-continuity` | A body is missing, stale, dead, hibernated, resumed, or moved between backends. |
| Capacity and context economics | `context-economics-for-agent-swarms` | A subscription, model budget, compaction, preemption, or context forecast is involved. |
| Durable local state | `sqlite-durable-agent-state` | Choosing writer discipline, crash transactions, schema, recovery, or compaction. |
| Effect capabilities | `mcp-trust-broker` | Admitting tools/MCPs or translating capabilities across bodies. |
| Spawn safety | `fleet-event-spawn-trust` and `circuit-breakers-and-retries` | Designing birth, retries, ancestry, breaker persistence, or reaping. |
| Operator evidence | `agent-visual-evidence-manifest` and `agent-work-receipt-designer` | Designing proof cards, visual artifacts, receipts, or zoom paths. |

## Machine artifacts

| Artifact | Purpose | Verification |
|---|---|---|
| `examples/drydock-resurrection-hypertree.json` | Thirty-node architecture and delivery graph | JSON Schema plus semantic validator |
| `schemas/drydock-resurrection-hypertree.schema.json` | Closed structural contract | Draft 2020-12 validator |
| `scripts/validate-drydock-resurrection-hypertree.mjs` | Uniqueness, DAG, critical path, launcher gates, digest | Node 22+ |
| `examples/hypertree-execution.review-loop.json` | One intentionally subpar attempt followed by named rework and independently approved completion | JSON Schema plus semantic execution validator |
| `schemas/hypertree-execution.schema.json` | Closed event, review, limit, and client-binding envelope | Draft 2020-12 validator |
| `scripts/validate-hypertree-execution.mjs` | Exact plan binding, event chain, role separation, review budgets, bounded rework, and deterministic projection | Node 22+ |
| `templates/architecture-packet.md` | Reviewer-facing output skeleton | Human and skill audit |
| `tests/activation.md` | Routing boundary | Five positive and five negative cases |

## Repository evidence anchors

Load only the anchor needed to verify a claim; source presence is not deployed
truth.

| Domain | Primary repository anchors |
|---|---|
| Runtime halt and restart authority | root `AGENTS.md`, `docs/adr/0138-distress-register-emergency-broadcast.md` |
| Drydock governance | `docs/adr/0140-provable-action-adjudication-contract.md` |
| Process spawning and confinement | `lib/spawner.ts`, `lib/coast-guard.ts`, `lib/coast-guard/` |
| Dispatch worktree provenance | `lib/dispatch/runner.ts`, `lib/dispatch/spawn-adapter.ts` |
| Resurrection and fleet lifecycle | `lib/resurrection.ts`, `lib/fleet-engine.ts`, relevant routes and tests |
| Durable state | registry schema/migrations and `sqlite-durable-agent-state` skill |
| Relay and remote projection | `apps/relay/`, `lib/relay-client.ts`, `docs/adr/0049-relay-architecture.md` |
| Operator surfaces | `core/pd-console/`, `apps/FleetBar/`, `docs/design/drydock-operator-journeys/index.html` |
| Security implementation boundary | `docs/adr/0120-rust-kernel-boundary.md` |

Paths can drift. Resolve them against the exact commit before citing them and
record missing anchors as evidence gaps rather than inventing replacements.

## Truth-state discipline

| State | Meaning |
|---|---|
| SHIPPED | Merged source plus the runtime or artifact witness required by the claim |
| PARTIAL | A bounded foundation exists, but a named join or witness is missing |
| TARGET | Accepted design with implementation and proof still owed |
| DEFERRED | Intentionally postponed behind a named dependency or authority gate |
| REJECTED | Considered and ruled out with rationale |
| UNKNOWN | Evidence is absent, stale, conflicting, or from the wrong witness |

Do not convert UNKNOWN into PARTIAL merely because the design is plausible.

## Corpus coverage rule

When changing a cross-cutting invariant, search all three volumes, the three
focused skills, the hypertree, and this map for the concept. Reconcile conflicts
in one change. When changing only a focused mechanism, load its owning skill and
the one integrating section that consumes its output.
