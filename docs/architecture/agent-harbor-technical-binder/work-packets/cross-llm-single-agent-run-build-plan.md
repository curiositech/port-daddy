# Cross-LLM Single-Agent Run Build Plan

Status: work packet for turning the cross-LLM Agent Harbor design into buildable slices.

Purpose:
  Ground the new cross-LLM `AgentBody` and single-agent `AgentRun` rendering
  design in the existing Harbor binder, schemas, code, and tests. This packet
  is intentionally narrower than the full milestone roadmap: it answers what to
  build first so one non-Claude and one Claude-shaped body can render through
  the same single-run surface.

## Existing Plan Inventory

The binder already has a strong plan spine. Do not create a parallel roadmap.

| Source | What it already decides | Reuse for this build |
| --- | --- | --- |
| `00-prd-roadmap-and-test-plan.md` | Product commitment, F0/C1/C2/C3/C5/C8 chain, and acceptance criteria. | Keep F0 contract first; make cross-LLM body support part of F0/C2, not a new milestone. |
| `07-milestones-and-work-dag.md` | Milestone order: transcript truth, Agent Node registry, compliance probes, control panel, governance, doctor. | Insert `AgentBody` normalization into M1/M2 and single-run projection into M4. |
| `18-build-prescription-agent-launch-board.md` | Current implementation prescription and work orders. | Treat this packet as a refinement of F0, C1, C2, C3, and C-routes. |
| `10-operator-control-panel.md` | Roster/detail layout, transcript renderer, disabled controls, empty states, proof artifacts. | The single-run view is the detail pane contract, not a separate app. |
| `work-packets/transcript-receipt-persistence-contract.md` | Canonical events, fidelity ladder, receipts, missing-capture remediation. | Add `AgentBody` as the provider-neutral body fact and `AgentRun` as the render projection. |
| `work-packets/product-surface-reality-review.md` | Replacement threshold: one Agent Node from intent to receipt beats raw tools. | Keep the first proof focused on one run, not fleet mythology. |

## Current Executable State

Already present:

- v0 JSON schemas for `WorkIntent`, `WorkPlan`, `AgentNode`, `AgentRun`,
  `TranscriptEvent`, `ControlCommand`, `ComplianceProbeResult`,
  `CostAccrualEvent`, `ContextEnvelope`, `SkillGraft`, and `WorkReceipt`.
- `lib/agent-harbor/event-ledger.ts` with append-only ledger, idempotency,
  transcript sequence uniqueness, and per-session hash-chain enforcement.
- `lib/agent-harbor/projections.ts` with disposable projections for roster,
  transcript timeline, files touched, costs, compliance, and work receipts.
- `routes/agent-harbor.ts` with read routes over projections:
  `/agent-nodes`, `/agent-nodes/:id`, `/agent-nodes/:id/files`,
  `/sessions/:id/events`, `/costs`, `/receipts/:id`,
  `/compliance/:agentNodeId`.
- Unit tests for schema freeze, ledger behavior, projections, routes,
  compliance probes, setup doctor, and governance/tool gates.

Gaps for this specific build:

- `AgentRun.body` is still model-brand-shaped (`claude-code`, `codex-cli`,
  etc.) instead of capability-shaped (`adapterKind`, `launchMode`,
  `capabilities`, `expectedFidelity`, `authCustody`, `billingPath`,
  `dataBoundary`).
- There is no separate `AgentBody` schema or stream type; body facts are nested
  in `AgentRun`, which makes adapter capability evolution awkward.
- Projections expose roster/detail pieces, but there is no single `AgentRun`
  read model that returns header, timeline blocks, work ledger, controls,
  receipt/proof summary, and render-claim evidence links in one shape.
- `routes/agent-harbor.ts` serves node detail and session events, but not a
  first-class `/agent-runs/:id` or `/agent-nodes/:id/runs/:runId` detail shape.
- The existing compliance fixture matrix covers adapter kinds, but it does not
  yet assert the new `AgentBody` capability contract or final-fidelity
  downgrade from expected fidelity.
- `pd-console` can consume roster/detail/timeline truth, but the binder still
  needs one explicit implementation target for the single-agent detail pane.

## Build Strategy

Build the data and proof path before polishing UI.

The minimum compelling proof is:

1. A Codex-like local CLI body and a Claude-like local CLI body both enter as
   `adapterKind: managed-local-cli`.
2. Their provider names differ, but their `AgentBody`, `TranscriptEvent`,
   `AgentRun`, compliance, receipt, and render projection shapes match.
3. A weak/observed import lands in the same UI with disabled controls and an
   honest fidelity downgrade.
4. The run detail page can show exactly why each badge, control, and proof claim
   exists by zooming to event ids, artifacts, hashes, or receipt rows.

## Implementation Slices

### Slice 0 - Contract Delta

Owner:
  F0 contract agent.

Changes:

- Add `schemas/agent-harbor/v0/agent-body.schema.json`.
- Add `agent-body` to the schema-freeze test package.
- Add `agent-body` as an event-ledger stream type, or record body facts as
  `agent-run` facts only if the implementation explicitly chooses not to split
  the stream yet.
- Update `agent-run.schema.json` to reference body capability fields:
  `adapterKind`, `provider`, `model`, `modelTier`, `launchMode`, `authCustody`,
  `billingPath`, `dataBoundary`, `capabilities`, `expectedFidelity`, and
  `hookPack`.
- Preserve tolerant-reader behavior: old `body.kind` fields may still load, but
  new official fixtures should use the capability shape.

Proof:

- Schema tests pass.
- Old fixtures still parse or have an explicit migration fixture.
- Bad enum values fail closed.

### Slice 1 - Ledger And Projection Support

Owner:
  C1 event/projection agent.

Changes:

- Teach `event-ledger.ts` to accept the `agent-body` stream type if Slice 0
  splits it out.
- Add a `harbor_proj_bodies` projection, or fold body fields into
  `harbor_proj_roster` and the run projection with a named tradeoff.
- Add an `AgentRun` projection builder that returns:
  - run header;
  - body metadata;
  - liveness evidence;
  - timeline render blocks with source event ids;
  - work ledger;
  - control affordances with disabled reasons;
  - receipt/proof summary;
  - render claims with proof pointers.
- Add projection freshness metadata to the run projection.

Proof:

- Rebuild from ledger produces the same run projection as incremental replay.
- Duplicate body/run/transcript events are idempotent.
- Stale projection is labeled and cannot authorize controls.
- Every `renderClaims[]` item references persisted event ids, artifacts, hashes,
  or receipt rows.

### Slice 2 - Adapter Capability Matrix

Owner:
  C2 adapter/compliance agent.

Changes:

- Update `lib/agent-harbor/capability-matrix.ts` and adapter fixtures to emit
  the new `AgentBody` capability shape.
- Cover at least:
  - `managed-local-cli` Codex;
  - `managed-local-cli` Claude Code;
  - `hosted-provider` OpenAI-compatible;
  - `custom-sdk-body`;
  - `observed-import`;
  - `fixture`.
- Compute final fidelity from persisted evidence, not provider name or launch
  intent.
- Add downgrade cases:
  - no tool result stream;
  - missing hook pack;
  - observed import;
  - fixture/mock source.

Proof:

- `cross-llm-body-adapter-matrix` fixture validates all body kinds.
- Expected T4 body with missing tool results downgrades to T2/T3 as appropriate.
- Observed imports cannot receive governed controls.

### Slice 3 - Run Read API

Owner:
  C-routes daemon route agent.

Changes:

- Add `GET /agent-runs/:id` or `GET /agent-nodes/:id/runs/:runId`.
- Return the single `AgentRun` projection, not a loose bundle of independent
  tables.
- Include projection freshness metadata and stale-projection names.
- Add cursor-paged timeline expansion for long runs.
- Add proof-pointer expansion for `renderClaims[]`.

Proof:

- Route tests seed a run and assert header, timeline, work ledger, controls,
  receipt summary, and render claims.
- Route tolerates unknown query params and extra payload fields.
- A stale projection returns `projection.stale: true` and never emits enabled
  command affordances from stale data.

### Slice 4 - Single-Agent Detail Pane

Owner:
  C3 `pd-console` GPUI/product agent.

Changes:

- Make the selected Agent Node detail view consume the run projection.
- Render:
  - header;
  - transcript timeline;
  - work ledger;
  - control rail;
  - receipt/proof drawer.
- Render T0/T1/T2/T3/T4/T5, observed, and fixture/mock states distinctly.
- Keep disabled controls visible with daemon reasons.
- Add a first viewport that is never blank: if no run exists, show the exact
  missing source and remediation.

Proof:

- GPUI screenshot for active run, historical run, observed import, missing
  transcript, and fixture/mock.
- Visual-evidence manifests bind artifacts to daemon port, run id, transcript
  head hash, Agent Node id, commit, and source label.

### Slice 5 - Receipt And Proof Drawer

Owner:
  receipt/provenance agent.

Changes:

- Generate a Work Receipt from the same persisted events the run projection
  renders.
- Display risk-to-check-first, validation evidence, transcript head hash,
  diff/file hashes, cost summary, visual-evidence manifests, PR links, replay
  command, and verification status.
- Mark weak receipts for observed or partial-fidelity runs.

Proof:

- Receipt verification passes after daemon restart for a T4 run.
- Self-reported validation remains `artifactBacked: false`.
- Visual artifacts without manifests do not count as proof.

## Recommended First PR Stack

1. Contract/schema PR:
   `agent-body.schema.json`, `agent-run.schema.json` update, fixtures, schema
   tests.
2. Ledger/projection PR:
   body/run projection support plus `renderClaims[]` evidence links.
3. Route PR:
   single-run read endpoint and route tests.
4. Adapter/probe PR:
   matrix fixtures and downgrade logic.
5. UI PR:
   `pd-console` run detail pane reads the run endpoint and renders degraded
   states honestly.
6. Receipt/proof PR:
   proof drawer, receipt generation/verification, and visual manifest gates.

Do not start with Fleet views, mobile, website copy, or broad cloud billing.
Those should wait until the single-run path can prove one local body from intent
to receipt.

## Open Questions

1. Should `AgentBody` be its own stream type now, or remain nested in
   `AgentRun` until two adapters need independent body lifecycle events?
2. Should the run endpoint be `/agent-runs/:id` or scoped under
   `/agent-nodes/:id/runs/:runId`?
3. Should the first UI proof use Codex first, Claude Code first, or both with
   fixture-backed transcript events before wiring the live adapter?
4. What is the first hard compliance bar for "official" in this slice: T3
   tool-backed, or T4 verified event transcript?

Default answers unless overridden:

- Add `AgentBody` as its own schema now, but only split the stream type if the
  body lifecycle needs independent append/replay in Slice 1.
- Add `/agent-runs/:id` for direct links and include `agentNodeId` in the
  response.
- Use Codex and Claude fixtures first, then wire live Codex because it is easier
  to exercise inside the current Codex workspace.
- Treat T3 as useful and T4 as official.
