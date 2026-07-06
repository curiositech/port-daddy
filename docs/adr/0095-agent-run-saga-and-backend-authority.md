# 0095. Agent Run Saga and Backend Authority — the Agent Harbor v0 Contract Freeze

## Status

Proposed — 2026-07-05 (F0 contract freeze; accepted for implementation when this PR merges. Binder ch18 Work Order F0.)

## Context

The Agent Harbor technical binder (docs/architecture/agent-harbor-technical-binder/) is
prose. Chapter 18's build prescription says the binder becomes trustworthy only when each
iteration converts prose into a versioned contract, a test, a proof artifact, and an
append-only decision record. Work Order F0 sends one senior architecture agent to produce
"the minimum executable v0 contract for Agent Harbor" before the C1/C2/C3/C5/C8 fanout,
because more agents before contract freeze will create incompatible schemas and duplicate
state machines.

This ADR is that freeze. It ships with `schemas/agent-harbor/v0/` — eleven versioned JSON
Schemas — and `tests/unit/agent-harbor-contracts.test.js`, which compiles every schema and
validates a fixture instance of each.

Skill lenses applied (grafted per the F0 work order): `work-intake-node-shaping` (seven
topology archetypes, legacy-verb audit), `agent-interchange-formats` (schema-first for
task/control/error payloads; envelope discipline; version fields on every schema),
`cqrs-event-sourcing-architect` (commands decide, queries display, events record;
projections disposable, log sacred), `agent-compliance-conformance` (one canonical ladder
across doc/schema/UI/probe surfaces; negative probes; no self-report levels),
`agent-work-receipt-designer` (nine-section receipt, artifact-backed validation),
`architecture-binder-of-record` (fork resolutions recorded, superseded prose marked),
`api-versioning-strategy` (additive evolution + tolerant reader inside v0; directory-versioned
breaking changes; Deprecation/Sunset discipline), and `sqlite-durable-agent-state`
(one canonical env-pinned DB path; WAL + busy_timeout; verified migrations).

## Decision

### 1. The eleven v0 contracts

`schemas/agent-harbor/v0/` contains, each with a `schema` const discriminator
(`pd.agent-harbor.<name>.v0`) except TranscriptEvent, which is pinned by
`schemaVersion: 1` per binder ch09:

| Schema | Object | Authority |
| --- | --- | --- |
| `work-intent.schema.json` | WorkIntent | The sole runtime launch primitive. Every intake path creates one. |
| `work-plan.schema.json` | WorkPlan | Daemon-owned shape decision: exactly one of seven archetypes. |
| `agent-node.schema.json` | AgentNode | Durable agent identity; compliance level daemon-witnessed. |
| `agent-run.schema.json` | AgentRun | One execution attempt by a Body attached to a node. |
| `transcript-event.schema.json` | TranscriptEvent | Canonical append-only fact; per-session sequence + hash chain. |
| `control-command.schema.json` | ControlCommand | Capability-specific daemon-queued control with honest states. |
| `compliance-probe-result.schema.json` | ComplianceProbeResult | Daemon-witnessed ladder evidence + negative probes. |
| `cost-accrual-event.schema.json` | CostAccrualEvent | Append-only cost fact; partial cost survives abort. |
| `context-envelope.schema.json` | ContextEnvelope | Context window truth + refs actually loaded. |
| `skill-graft.schema.json` | SkillGraft | Visible, auditable skill attachment (Seamanship). |
| `work-receipt.schema.json` | WorkReceipt | Nine-section, artifact-backed, hash-committed trust object. |

Fixture instances live in `schemas/agent-harbor/v0/fixtures/` and are validated by
`tests/unit/agent-harbor-contracts.test.js`.

### 2. The Agent Run Saga

One agent run is a saga over the Work Plan state machine (binder ch14 + the
swarm-invocation packet), not a distributed transaction. Every state transition is a
durable event; every failure state has a compensating path that seals evidence instead of
deleting it:

```text
IntentCaptured -> Planning -> (NeedsScout | PlaceholderWaiting | ApprovalRequired)*
  -> Materializing -> NodesReady -> RunsAttached -> Running
  -> (HumanGate | Blocked | Replanning)* -> ReviewReady -> ReceiptSealing -> ReceiptSealed
```

Saga rules:

- **Forward steps** are commands: capture intent, shape plan, materialize node, attach
  body, deliver control, seal receipt. Each emits a durable success or denial event.
- **Compensations never mutate history.** Cancel, abandon, orphan-takeover, and budget-kill
  all terminate in `ReceiptSealing` — a weak receipt with a high-severity risk is the
  compensation, not row deletion. Resume creates a successor run linked to its predecessor;
  the predecessor's transcript stays append-only.
- **Articles of Agreement attach at Materializing**, before the first model turn. A body
  cannot become official after the fact except as an explicit observed import with a gap
  report.
- **Pivotal invariant (binder ch18 acceptance gate):** restart/reconnect rebuilds all
  visible state from backend truth. Transcript, control, cost, claim, and receipt events
  are append-only; projections are disposable.
- **Idempotency everywhere:** WorkIntent, ControlCommand, CostAccrualEvent, and
  TranscriptEvent `source` all carry idempotency keys. Duplicate keys are no-ops returning
  the prior result — no double-spend, no double-start.

### 3. Backend authority

The daemon is the single writer of runtime truth. Concretely:

- **UI cannot fabricate runtime truth.** Every pane renders projections of durable events.
  "LIVE" requires a heartbeat or transcript events, never a session row alone.
- **Stale projections may display but never authorize.** A control is enabled only when a
  daemon-side capability probe backs it; a stale view renders a stale label and a refresh
  path, with commands disabled.
- **Compliance is daemon-witnessed.** The daemon issues Agent Node ids, signs Articles,
  grants expiring capability leases, and challenges adapters with nonces. A body can
  request capabilities; it cannot declare itself compliant. Self-reported checks cannot
  advance a level past C0 — and this is **enforced, not merely asserted**, by the
  Compliance Witnessing Invariant in §8 (`ComplianceProbeResult.checks[].daemonWitnessed`
  plus a targeted, downgraded negative probe per level).
- **Receipts are generated from persisted events and artifacts**, never from the agent's
  final chat message. `validation.artifactBacked` is true only when every `passed: true`
  test carries a real `exitCode` or `artifactPath`.
- **Storage follows `sqlite-durable-agent-state`:** official rows go through the
  daemon-owned SQLite handle at the canonical path (see fork resolution 3), WAL mode with
  `busy_timeout`, migrations verified by querying the target schema object, single-writer
  topology.

### 4. The five fork resolutions

The binder contradicts itself in five places. This ADR pins each fork; superseded prose
should be patched to reference this section.

**Fork 1 — TranscriptEvent field names: ch09 wins.** The canonical shape uses
`agentNodeId`, `bodyId`, `payloadJson`, `payloadBlobRefs`, `redactionState`,
`retentionPolicyId` (ch09 "Canonical TranscriptEvent", confirmed by the
transcript-receipt persistence packet, which adds optional `transcriptId` and
`source.idempotencyKey` — both adopted). Chapter 03's stream-event variant (`agentId`,
`body`, `blobRefs`, `redaction`, `retention`) is **superseded** and must not appear in new
code; the schema test asserts the canonical names are present and the ch03 names are not.

**Fork 2 — Compliance ladder: seven levels, C0..C6, per ch03.** C0 Registered,
C1 Transcripted, C2 Governed, C3 Suggestible, C4 Controllable, C5 Cooperative,
C6 Resumable. The older six-level proposal (from the pre-binder compliance plan) is
**superseded**. The control-plane synthesis packet's freeze table is adopted verbatim,
including its required predicates (C1 requires T4 verified transcript; C6 requires T5).
Doc, schema, UI, and probe surfaces must declare this identical ladder — drift across
surfaces is a stop-rule violation, and no numeric C badge ships from any surface that
disagrees with `agent-node.schema.json` / `compliance-probe-result.schema.json`.
Every non-base level is daemon-witnessable: `forged-level` is the universal per-level
negative probe (instantiated once per level via `targetLevel`), so C1, C3, C5, and C6 are
each falsifiable, not only the gateway levels the four specialized probes cover. The
enforcement that a level is never granted by self-report is **fork resolution's teeth in
§8**, not prose alone.

**Fork 3 — Canonical DB path: `port-registry.db` per `lib/db.ts`.** Resolution order is
(1) `PORT_DADDY_PREFIX` → `$PORT_DADDY_PREFIX/port-daddy.db` as passed by `server.ts`,
(2) `PORT_DADDY_DB` env var, (3) default `<resolved-root>/port-registry.db` — exactly as
implemented by `lib/db.ts` and consolidated by `db-consolidate` (ADR-0090/0044 lineage).
Chapter 02's mention of `daemon.db` is **corrected**: no such file is canonical, and no
Agent Harbor table may be created in a fragment DB. Official rows live in the one
canonical DB family (including `-wal`/`-shm`).

**Fork 4 — Legacy launch verbs: intake metadata + compatibility aliases only.**
`spawn`, `dispatch`, `sortie`, `conjure`, and `nightshift` are **not runtime concepts**.
WorkIntent is the sole runtime primitive; the verbs survive only as
`source.kind: "compat"` + `source.legacyVerb` annotations and as CLI aliases that create a
WorkIntent (spawn → `startPolicy: "immediate"`, dispatch/nightshift → `"queued"`,
sortie → a WorkPlan whose shape is `dag-workgroup`, conjure → console-sourced intent).
No verb owns a session, transcript, budget, compliance probe, UI pane, or state machine.
A body that starts without a WorkIntent + WorkPlan chain is an unmanaged import, never an
official agent.

**Fork 5 — the AgentRun dimension and where continuation lives: run-level, per ch14.**
Chapter 09's data model, written before the ch14 naming rule was settled, has no
`agent_runs` table and hangs the per-attempt continuation chain off the `sessions` table
(`successor_session_id` / `predecessor_session_id`). Chapter 14's naming rule and the
swarm-invocation packet make **AgentRun** — "one execution attempt by a Body attached to a
node" — the first-class per-attempt unit: the node endures, bodies die and are replaced,
and each attempt is a run joined to exactly one session and one transcript stream. This ADR
resolves the fork in ch14's favor and **ch09 is patched** (see Consequences) to (1) add the
`agent_runs` table, (2) carry `current_run_id` on `agent_nodes`, (3) add a nullable
`run_id` foreign key to `control_commands`, `cost_events`, `skill_grafts`, and
`work_receipts` — matching the `runId` already frozen on those schemas — and (4) relocate
continuation: **resume creates a successor _run_** (`successor_run_id` /
`predecessor_run_id` on `agent_runs`), and the session-level successor columns become a
derived convenience view over run linkage, not the source of truth. `transcript_events`
stay session-keyed by design — a transcript stream is per session, and a run maps to exactly
one session — so no `run_id` column is added there. This is the one fork where the schemas,
not the doc, were already correct; the fix is to make ch09 agree with the frozen contract,
which is exactly what the freeze's cross-surface-drift tripwire demands.

### 5. Command / query / event boundary

Every user action maps to exactly one column (ch18 acceptance gate: "every user action
maps to command, query, or event"):

| Surface action | Kind | Contract object | Notes |
| --- | --- | --- | --- |
| Start work / legacy verb alias | Command | WorkIntent | Idempotency key required; duplicate is a no-op. |
| Approve / simplify / expand plan | Command | WorkPlan gate | Emits durable approval or denial event. |
| Materialize node, attach body | Command | AgentNode, AgentRun | Articles attach before first turn. |
| Pause / interrupt / steer / checkpoint / resume / retire / fork / kill | Command | ControlCommand | Capability-specific; `unsupported` is an honest terminal status. |
| Tool preflight decision | Command | (tool gate envelope, C5 slice) | allow / deny / require-approval / rewrite; denial is a durable event. |
| Run compliance probe | Command | ComplianceProbeResult | Result is an event-backed record, not a mutation of the node. |
| Graft a skill | Command | SkillGraft | Recorded with reason; emits `skill_graft` transcript event. |
| Seal / verify receipt | Command | WorkReceipt | Verify replays hashes; emits `receipt_verified` / `receipt_failed`. |
| Roster, detail pane, files touched, costs, plan shape | Query | projections | Disposable; rebuildable from events; stale-labeled. |
| Live stream / replay | Query | TranscriptEvent stream | SSE with replay cursor; reconnect must not duplicate blocks. |
| Everything that happened | Event | TranscriptEvent, CostAccrualEvent, ControlCommand status transitions, ComplianceProbeResult, SkillGraft, receipt lifecycle | Append-only, sequenced, idempotent, hash-chained where sessioned. |

### 6. Versioning and tolerant-reader policy

Per `api-versioning-strategy` and `agent-interchange-formats`:

- **Directory-versioned contracts.** `schemas/agent-harbor/v0/` is the v0 tree. A breaking
  change (removing/renaming a required field, narrowing an enum consumers depend on,
  changing a discriminator) creates `schemas/agent-harbor/v1/` — never an in-place edit.
- **Additive evolution inside v0.** New optional fields, new enum values on open enums,
  and new event kinds ship without a version bump. `TranscriptEvent.kind` is deliberately
  an open string; consumers must switch on known kinds and ignore unknown ones.
- **Tolerant reader is mandatory.** Every v0 schema sets `additionalProperties: true`.
  Readers must ignore unknown fields, tolerate unknown event kinds, and treat an unknown
  `schema` discriminator suffix (e.g. `.v1`) as "not mine", not an error to crash on.
  Writers must never rely on a reader dropping a field for correctness.
- **Every payload self-identifies.** `schema` const (or `schemaVersion` for
  TranscriptEvent) is required, so mixed-version streams and archives stay parseable.
- **Deprecation discipline.** When v1 exists, v0 writers get a deprecation window with an
  announced sunset date (RFC 9745/8594 style headers on HTTP surfaces); v0 readers are
  supported until per-version telemetry shows zero traffic, never deleted on a hunch.

### 7. Migration list for legacy launch paths

Ordered; each step keeps the old surface as an honest bridge until parity is proven
(binder ch09 + ch14 migration plans):

1. Land this v0 schema package + fixtures + tests (this PR).
2. Introduce WorkIntent/WorkPlan records in the daemon; every launch source calls
   WorkIntentService first.
3. `POST /spawn` and `pd spawn` create-or-reference a WorkIntent, WorkPlan, AgentNode, and
   AgentRun before calling the spawner; `source.legacyVerb: "spawn"` recorded.
   `/spawn/preflight` becomes an adapter behind work preflight.
4. `pd dispatch` / `pd nightshift` become queued-intent aliases
   (`startPolicy: "queued"`); dispatch state becomes a projection.
5. `pd sortie` maps to a planned workgroup: sortie packets become WorkPlan node specs with
   claims, gates, and a merge owner — or the alias refuses and proposes a scout.
6. `conjure` remains a console affordance that creates a console-sourced WorkIntent; no
   conjure-specific runtime state.
7. `pd agent` / `/agents` stay registry/control surfaces over AgentNode + AgentRun
   projections; launch-shaped forms keep refusing and pointing at the one command family.
8. Backfill existing sessions into weak Agent Nodes; historical runs without provable tool
   control are marked `observed`. No invented session joins.
9. Teach `pd-console` to read Agent Node APIs first; `/agents`, `/agent-roster`, and
   `/transcripts` become compatibility projections.
10. Deprecation copy on every alias points at `pd work start`; aliases are removed from
    operator UI once parity is proven, then deleted after a sunset window.

The exit test (ch14): a new body is impossible to start without either a
WorkIntent + WorkPlan chain or an explicit unmanaged-import reason.

### 8. The Compliance Witnessing Invariant (normative)

The freeze's headline promise — "compliance is daemon-witnessed, never self-attested" —
must be a machine-checkable part of the contract, not prose a reader could ignore. The
draft-2020-12 keyword subset the schemas commit to cannot express a cross-field,
array-quantified rule, so a schema-valid `ComplianceProbeResult` could otherwise assert
`complianceLevel: "C6"` with `negativeProbes: []` and every `checks[].daemonWitnessed:
false`. That gap is closed here and enforced by
`schemas/agent-harbor/v0/compliance-invariants.mjs` (a frozen contract artifact gated by
`tests/unit/agent-harbor-contracts.test.js`). Every consumer — the TypeScript daemon, the
Rust `pd-console`, external custom agents — MUST implement this identical predicate:

- **Per-level witness.** A level `Lk` (order ≥ 1) is *witnessed* only when BOTH hold:
  (a) some `checks[]` entry gates it with daemon-observed positive evidence
  (`level == Lk`, `daemonWitnessed: true`, `passed: true`); AND (b) some `negativeProbes[]`
  entry targets it (`targetLevel == Lk`), is `present: true`, and — if it `fired` — was
  `downgraded: true`. An absent `downgraded` is never read as `true` (fail-closed).
- **`witnessedLevel`** is the highest level for which *every* level beneath it is witnessed
  (a gap caps the grant — no skip-grants). It is recomputable from `checks` +
  `negativeProbes`; a `witnessedLevel` field that disagrees with the recomputation is a
  drift violation.
- **`complianceLevel` MUST NOT exceed `witnessedLevel`.** A probe that over-claims is
  INVALID — this is the `level-advances-on-self-report` stop rule made executable.
- **Node linkage.** An `AgentNode.complianceLevel > C0` MUST carry a `complianceProbeId`
  referencing a witness-valid probe whose `witnessedLevel ≥` the node's level. A
  free-standing node level with no witnessing probe is self-attested and rejected.
- **Every level is falsifiable.** Because `forged-level` is instantiated per level via
  `targetLevel`, C1, C3, C5, and C6 are each daemon-witnessable, closing the "only C0/C2/C4
  have a negative probe" gap. The four specialized probes (`direct-mcp-bypass`,
  `disabled-hook-after-launch`, `forged-heartbeat`, `observed-to-controlled`) are
  additional targeted attacks on the governance and liveness gates, not the only witnesses.

## Open questions (minor, non-blocking)

Recorded here per the F0 revision so they are not lost; neither blocks the freeze.

- **Cost event time-field name.** ch09 `cost_events` named the event-time column
  `timestamp`; `CostAccrualEvent` uses `occurredAt`, harmonizing to the TranscriptEvent
  event-time convention (`occurredAt` for source time, `ingestedAt` for daemon time). This
  ADR adopts `occurredAt` as canonical and **patches ch09** to rename the column
  (Consequences), so a projection keyed on the old `timestamp` name will not silently drop
  the field. Open question: whether to also expose a read-only `timestamp` alias during the
  ch09→schema migration window.
- **`payload_json` casing across objects.** Both `TranscriptEvent.payloadJson` and
  `ControlCommand.payload` derive from a `*_json` column but differ in suffix.
  `TranscriptEvent.payloadJson` is frozen by fork resolution 1 (ch09 canonical names) and
  carries mixed metadata + small text; `ControlCommand.payload` is a typed, kind-specific
  command-argument object, so the divergence is intentional rather than an accident — but it
  does complicate a uniform Zod/DB-projection generator. Open question for a v0.x additive
  pass: settle a single convention (likely `payloadJson` everywhere) without a v1 break.

## Implementation Matrix

<!-- ADR-0043: one row per phase; the Roadmap slug is the stable join key into
     roadmap_items. Phase F0 is delivered by the PR that lands this ADR; the
     C-wave phases are the binder ch18 work orders this contract freeze gates. -->

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| F0 | agent-harbor-f0-contract-freeze | now | — | v0 contract freeze: this ADR + eleven schemas/fixtures + compliance-invariants.mjs + contract tests |
| C1 | agent-harbor-c1-event-ledger | backlog | agent-harbor-f0-contract-freeze | Event ledger and projections (append-only event store, roster/transcript/cost/compliance/receipt projections, replay rules) |
| C2 | agent-harbor-c2-compliance-probes | backlog | agent-harbor-f0-contract-freeze | Adapter compliance probes: witness which bodies are compliant, weak, observed, or unmanaged |
| C3 | agent-harbor-c3-operator-control-panel | backlog | agent-harbor-f0-contract-freeze | Operator control panel: Agent Node roster and detail view in pd-console |
| C5 | agent-harbor-c5-governance-tool-gates | backlog | agent-harbor-f0-contract-freeze | Governance and tool gates: destructive-git blocking + human approval before risky actions |
| C8 | agent-harbor-c8-setup-doctor-remediation | backlog | agent-harbor-f0-contract-freeze | Setup and doctor remediation: installable, repairable harness without command walls |
| C-routes | agent-harbor-daemon-routes | now | agent-harbor-c1-event-ledger | Daemon HTTP route layer (binder ch09 read API over C1's projections: roster, detail join, SSE/paged transcript timeline, files, costs, receipt verification, compliance). Closes I0 Contradiction 1 — the route triangle C3/C8 assumed but no chain owned |

## Consequences

- C1 (event ledger), C2 (adapter probes), C3 (control panel), C5 (governance), and C8
  (setup/doctor) can now fan out against one contract instead of inventing five.
- Binder chapters 02, 03, **09**, and the pre-binder compliance plan need patches marking
  their superseded variants as resolved by this ADR (Architect-of-Record sweep). **Chapter
  09 is patched in this PR** (fork resolution 5): the `agent_runs` table is added,
  `current_run_id` joins `agent_nodes`, a nullable `run_id` joins `control_commands`,
  `cost_events`, `skill_grafts`, and `work_receipts`, `cost_events.timestamp` is renamed to
  `occurred_at`, and the continuation chain moves to run level. Chapters 02/03 and the
  compliance plan remain follow-up sweeps.
- Compliance is enforced, not asserted: `compliance-invariants.mjs` is the normative
  witnessing predicate (§8); a self-attested level now fails CI, not just review.
- The schema test suite is the drift tripwire: any surface that redefines the ladder, the
  TranscriptEvent field names, the archetype set, or grants a compliance level with no
  daemon-witnessed probe chain fails `tests/unit/agent-harbor-contracts.test.js` review.
- v0 deliberately excludes: GPUI implementation, adapter code, cloud/billing, Harbor
  Editor transport, and the tool-gate envelope (C5 owns that schema next, referencing this
  saga).

## Alternatives considered

- **Zod-first contracts in `lib/`.** Rejected for v0: JSON Schema files are
  language-neutral (Rust `pd-console`, TypeScript daemon, and external custom agents all
  consume them), diffable in PRs, and testable without adding a runtime dependency. A
  generated Zod layer can wrap them later.
- **One mega-schema with `oneOf`.** Rejected: per-object files keep ownership boundaries
  (and future v1 bumps) independent, matching the disjoint-write-surface rule for the
  implementation fanout.
- **Adopting ch03's TranscriptEvent shape instead of ch09's.** Rejected: ch09 is the data
  model chapter, the persistence packet already builds on its names, and the ch09 names
  carry the join fields (`agentNodeId`, `bodyId`) that the official-agent predicates need.
