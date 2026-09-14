---
name: drydock-program-architecture
description: >-
  Designs, reconciles, and reviews an end-to-end Drydock program for safely staging
  agent runtimes: immutable worktree provenance, disposable VM containment, typed
  effect brokerage, global body accounting, resurrection, subscription-capacity
  economics, context compaction, operator control, evidence, and promotion. Use when
  several Drydock contracts must compose into one architecture, implementation
  hypertree, diagram set, or release plan. NOT for launching Port Daddy, running an
  untrusted subject, replacing focused containment/resurrection/capacity audits, or
  treating a design packet as runtime authority.
license: Apache-2.0
allowed-tools: Read,Write,Edit,Grep,Glob,Bash(node:*)
metadata:
  category: Infrastructure & DevOps
  tags:
    - drydock
    - program-architecture
    - agent-lifecycle
    - virtualization
    - capacity-economics
    - context-control
    - operator-experience
    - evidence
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: sandboxed-adversarial-test-harness
      reason: Owns containment, typed effects, adversarial scenarios, and promotion verdicts.
    - skill: agent-resurrection-and-body-continuity
      reason: Owns identity, fencing, capsule, and successor-body decisions.
    - skill: context-economics-for-agent-swarms
      reason: Owns native-unit capacity evidence, forecasting, compaction, and preemption.
    - skill: agent-visual-evidence-manifest
      reason: Turns host-observed facts into reviewable operator artifacts.
  io-contract:
    kind: deliverable
    consumes:
      - kind: operator-intent-and-halts
        format: markdown
      - kind: repository-and-runtime-evidence
        format: markdown
      - kind: focused-contracts
        format: markdown-or-json
    produces:
      - kind: drydock-architecture-packet
        format: markdown
      - kind: implementation-hypertree
        format: json
      - kind: diagram-and-proof-atlas
        format: markdown
---

# Drydock Program Architecture

Drydock is the proving ground between “we wrote a safety mechanism” and “this
agent runtime may touch a machine, network, credential, repository, provider, or
budget.” Use this skill to join the focused contracts without erasing their
separate authorities.

## Halt Gate

A design, schema, fixture, or diagram is not a run lease. If the operator has
halted Port Daddy or any subject runtime, remain at static tier T0:

- inspect source and immutable evidence;
- edit documents, schemas, validators, fixtures, and inert UI artifacts;
- run only ordinary source validators that cannot start the subject;
- do not invoke the halted CLI, daemon, apps, hooks, agents, providers, or MCP;
- label dynamic gates `BLOCKED` or `NOT_PROVISIONED`, never PASS.

Stop immediately if the requested work requires a dynamic observation that the
halt forbids. Preserve the missing proof as a named gate.

## What This Skill Owns

This skill owns composition. It answers:

1. Which component owns each authority?
2. Which focused contract is normative for each decision?
3. How do identity, bodies, capacity, context, effects, evidence, and operator
   control meet without circular trust?
4. In what order may the implementation be built and promoted?
5. Which diagrams and receipts let another engineer audit the answer?

It does not duplicate or overrule the focused skills. Load them at the decision
boundaries below.

| Decision | Normative skill | Required artifact |
|---|---|---|
| Host/guest containment, brokered I/O, hostile tests | `sandboxed-adversarial-test-harness` | Drydock review and tier verdict |
| Missing, dead, resumed, or cross-backend body | `agent-resurrection-and-body-continuity` | Schema-valid resurrection plan |
| Subscription allowance, context pressure, compaction | `context-economics-for-agent-swarms` | Schema-valid capacity evidence |
| Operator-visible proof | `agent-visual-evidence-manifest` | Evidence manifest with zoom paths |

## Stable Vocabulary

- **AgentNode:** durable actor identity and obligations. Not a provider session.
- **Run:** one admitted attempt against one bounded work node.
- **Body generation:** replaceable VM/process/backend embodiment of an AgentNode.
- **Witness:** host-observed process/VM identity, including generation and fence.
- **Capsule:** verified plan, evidence, context, effects, and capability inputs for
  continuation. It is not a credential bundle.
- **CapacityVector:** native provider allowance windows plus confidence and reset
  horizons. It is not a fabricated dollar total.
- **Effect ticket:** one attenuated, typed, lease-bound operation. It is not a raw
  secret or general network socket.
- **Receipt:** append-only claim from a named witness class. A signature proves
  authorship, not the truth of the signed claim.
- **Promotion:** a new authority grant for one exact digest and tier. It is not a
  property inherited from a similar build.

## Architecture Invariants

Every packet must preserve all of these:

1. The canonical checkout is a clean, read-only projection of live
   `origin/main`; work occurs only in fresh linked worktrees or guest-local
   copies derived from an exact commit.
2. At most one body generation can hold effect authority for an AgentNode.
3. One external admission writer reserves global and scoped capacity before any
   asynchronous launch.
4. The subject cannot reach host mounts, ambient sockets, credentials, network,
   providers, or GitHub except through enumerated typed channels.
5. Unknown body, effect, capacity, provenance, or teardown state fails closed.
6. Dollars, subscription native units, compute, context, and concurrency remain
   separate conserved ledgers; a zero marginal price never means zero scarcity.
7. A successor gets newly compiled capabilities and a verified capsule, never a
   copied credential, hidden context directory, or inherited PID identity.
8. Every dynamic claim names its external witness, exact artifact digests, and
   replay or inspection path.
9. Operator Stop, fence, and spend denial remain outside the guest and provider
   session.
10. No single agent, daemon, UI, or guest both requests, authorizes, executes,
    and certifies the same consequential transition.

## Composition Procedure

### 1. Freeze the exact proposition

Write one falsifiable sentence naming subject digests, adversary, tier, bounded
effects, native capacity, lifecycle outcome, and external witnesses. Replace
“safe,” “contained,” and “resumable” with observable limits.

Record the current operator halt, current repository commit, target platform,
and every fact that is unavailable. Use the state labels `SHIPPED`, `PARTIAL`,
`TARGET`, `DEFERRED`, `REJECTED`, and `UNKNOWN`; never blur planned joins into
implemented joins.

### 2. Build the authority ledger

For every component, list:

- authority it may hold;
- authority it must never hold;
- durable records it writes;
- external facts it observes;
- process and release boundary;
- failure mode and fail-closed terminal state.

At minimum include the operator surface, command verifier, controller, lifecycle
ledger, capacity broker, effect broker, cognition compiler, VM adapter, reaper,
guest driver, subject, body, and evidence projection. Load
`references/architecture-decisions.md` when assigning components or languages.

### 3. Seal provenance before execution design

Define exact identities for source commit/tree, worktree derivation, guest image,
controller build, test bundle, scenario, policy, price/capacity observations,
tools, skills, prompts, and output quarantine. The host controller must reject:

- canonical/main checkout paths;
- dirty or wrong-remote sources;
- mutable branch names without resolved commit/tree identities;
- unsealed setup scripts, package hooks, test configs, or transforms;
- output that attempts to overwrite input or bypass review worktrees.

### 4. Compose the three focused contracts

Run the contracts in this order:

1. **Capacity:** prove there is one bounded reservation or deny launch.
2. **Resurrection:** establish AgentNode, predecessor generation, fence, capsule,
   and allowed successor shape.
3. **Containment:** prove the exact body can execute only at the approved tier.

If any focused contract returns `UNKNOWN`, `BLOCKED`, `QUARANTINED`,
`INCOMPLETE`, or `UNCERTAIN`, the integrated packet cannot say ready. Preserve
the original verdict and explain which downstream nodes remain unreachable.

### 5. Design cognition without making it authority

Partition cognition into narrow compilers:

- **Intent shaper:** turns operator language into a proposed WorkIntent.
- **Architect:** grows a versioned hypertree and keeps fog nodes non-executable.
- **Context steward:** compacts evidence and prepares a cited capsule.
- **Promptwright:** translates trusted and untrusted context for one backend.
- **Capability compiler:** emits EXACT, EQUIVALENT, NARROWED, OMITTED, or
  BLOCKED mappings for tools, MCPs, skills, hooks, prompts, and permissions.

None of these may launch, reserve, expose credentials, or declare its own output
accepted. Ad hoc work defaults ephemeral and isolated; durability is an explicit
promotion based on recurring obligation, continuity value, or operator choice.

### 6. Account globally before launch

The lifecycle ledger must reserve before birth and reconcile before reopening
after any controller crash. Include global, repo, project, provider, ancestry,
identity, and operator scopes. Initial automatic birth retries and recursive
child depth are zero.

Every body has a generation, lease, fencing token, backend session handle,
VM/process witness, heartbeat deadline, and teardown state. A PID alone proves
nothing. Breakers survive process restart and calendar reset; only a separate
authorized reset transition may reopen them.

### 7. Preserve economic and context truth

Model each scarce thing in its native unit. For subscriptions capture observed
remaining percentage/units, window, reset time, auth mode, shared bucket,
freshness, parser provenance, confidence, reserve, burn forecast, and unresolved
attempt hold. Keep a separate cash/credit ledger.

Before an atomic action, predict whether the action plus checkpoint tail fits.
If not, stop at a safe boundary, seal and verify a capsule, then compact,
hibernate, or rebody. Never split a tool request from its result or summarize an
unreconciled side effect as complete.

### 8. Draw the proof, not decoration

Load `references/diagram-atlas.md` and select every view needed by the risk:

- context/trust topology for boundary claims;
- sequence diagrams for admission, cold birth, stop, and resurrection races;
- state diagrams for lifecycle, effects, and context;
- ER diagram for identity and receipt cardinality;
- flowcharts for provenance, capacity, and capability decisions;
- implementation DAG for delivery dependencies;
- operator journey for human control and zoom paths.

Each diagram must state what it proves and what it does not. Diagrams never
substitute for schemas, tests, or runtime evidence.

### 9. Compile an executable hypertree

Start from `examples/drydock-resurrection-hypertree.json` and validate it with:

```text
node scripts/validate-drydock-resurrection-hypertree.mjs examples/drydock-resurrection-hypertree.json
```

Every executable node needs immutable inputs, owner role, worker lifetime,
skills, outputs, dependencies, acceptance gates, and failure terminal. Fog nodes
may gather evidence or questions but may not launch. Every launcher must depend
transitively on global spawn breakers and capacity admission.

### 10. Produce operator and reviewer surfaces

Operator views are projections over typed records, never parallel authority.
Every aggregate must zoom within two actions to its session, body witness,
worktree diff, command/test output, claim, transcript, capacity observation, or
receipt. Show honest `STARTING`, `STALE`, `OFFLINE`, `UNKNOWN`, `FENCED`, and
`QUARANTINED` states.

Provide one calm edge signal for meaningful new activity, then a stable live
state; honor reduced motion. Expose start-one-worker, inspect, pause, stop,
cancel, resume, switch backend, capacity, permissions, MCP/skill fitting,
artifact, PR, and mobile-join journeys as scripted real-product states.

### 11. Define the proof ladder and release boundary

Use `references/delivery-and-proof.md`. Advance only from static contracts to
fake deterministic guest, replay guest, separately approved provider canary,
fixture worker, crew, and federation. A higher tier requires a new grant. Hosted
CI may prove source behavior; it cannot prove local hypervisor, credential
custody, provider billing, or operator pixel truth without the matching witness.

## Anti-Patterns

| Who is fooled | Temptation | Correction |
|---|---|---|
| Novice | “A clean path check protects main.” | Make main absent from the guest and reject its inode/path identity outside the subject. |
| Novice | “PID 418 is the same agent.” | Resolve AgentNode, body generation, platform handle, and process start witness. |
| Expert | “The ledger caps spend.” | Prove provider-side custody or label only protocol authority bounded. |
| Expert | “We can expose 139 tools but hide most schemas.” | Compile a phase-scoped capability pack; schema visibility is not authorization. |
| Timeline | “Retry after 500 ms” fixes crash storms. | Persist reservation, ancestry, breaker, and reconciliation state before adding backoff. |
| Timeline | “The next model can read the transcript.” | Fence the predecessor, reconcile effects, verify a capsule, and recompile capabilities first. |
| Product | “Green CI means Drydock is ready.” | Name the exact witness each claim still lacks and keep the tier blocked. |

## Output Contract

Use `templates/architecture-packet.md`. A complete packet contains:

- exact proposition, state labels, and halt status;
- authority/component ledger and trust topology;
- immutable provenance manifest and canonical-checkout exclusion proof;
- capacity evidence and reservation logic;
- resurrection plan and body/accounting model;
- context/capability translation report;
- implementation hypertree and critical path;
- selected diagram atlas views with proof limits;
- scenario/fault matrix, witness-labeled receipts, and residual risks;
- operator journeys and two-action zoom paths;
- tier verdict and next permitted action.

## Quality Gates

Before calling the packet complete:

1. Validate the skill bundle, self-containment, and Mermaid structure; run
   `node scripts/audit-drydock-program-skill.mjs` for the integrated contract.
2. Validate hypertree JSON against `schemas/drydock-resurrection-hypertree.schema.json`
   and the semantic validator.
3. Run positive and negative activation cases in `tests/activation.md`.
4. Prove every local source link in `references/knowledge-map.md` exists.
5. Confirm no canonical checkout or raw credential appears in an executable input.
6. Confirm every launch node is gated by admission, capacity, and persistent
   breakers.
7. Confirm every PASS claim names an exact tier, digest, and external witness.
8. Have a skeptical reviewer argue safety, liveness, economics, usability, and
   evidence independently.

## Bundle Index

Load only what the current decision requires:

- `references/INDEX.md` — progressive-disclosure routing for the full knowledge corpus.
- `references/knowledge-map.md` — corpus map, authority, and exact loading triggers.
- `references/architecture-decisions.md` — component/process/language placement.
- `references/diagram-atlas.md` — comprehensive decision and proof diagrams.
- `references/delivery-and-proof.md` — staged implementation and promotion gates.
- `examples/drydock-resurrection-hypertree.json` — 30-node machine plan.
- `examples/INDEX.md` — example and executable-plan routing.
- `schemas/drydock-resurrection-hypertree.schema.json` — structural contract.
- `scripts/validate-drydock-resurrection-hypertree.mjs` — semantic DAG/digest checks.
- `scripts/audit-drydock-program-skill.mjs` — bundle, links, diagrams, routing, and moved-source audit.
- `scripts/INDEX.md` — validator loading and invocation map.
- `templates/architecture-packet.md` — final deliverable shape.
- `examples/expected-output.md` — concise worked packet.
- `tests/activation.md` — positive and negative skill-routing cases.
- `agents/openai.yaml` — portable agent-card metadata and default prompt.
