# Roadmap Decision Events

Use this reference when implementing storage, daemon routes, API contracts,
pd-console panes, or durable notes for product-roadmap decisions.

## Principle

This is the target event-sourced contract. Today, the selected daemon's local
roadmap/item ledger is the runtime authority and projection source for local
coordination. The remote event ledger becomes shared authority only after its
writer is deployed and an attributable remote read-back proves the cutover.
Operator and agent decisions, constraints, revisions, and proof should already
use this envelope where possible so the current local evidence can be imported
without pretending the remote path is live.

Do not delete old decisions because they became wrong. Append a revision event
that explains what new evidence changed the decision.

## Event Envelope

```json
{
  "id": "rde_01...",
  "type": "RoadmapFocusChosen",
  "source": "port-daddy://agent/product-roadmap-focus",
  "subject": "port-daddy/control-panel",
  "time": "2026-07-02T12:00:00.000Z",
  "actor": "agent-gpui-harness-mux",
  "traceId": "session-...",
  "parentEventIds": [],
  "sourceRef": "source://redacted/source-id",
  "sourceVisibility": "local-private",
  "sourceHash": "sha256:...",
  "retentionClass": "hot",
  "costCenter": "port-daddy/control-plane",
  "limitations": [],
  "schemaVersion": 2,
  "data": {}
}
```

Use CloudEvents-compatible names where practical: `id`, `type`, `source`,
`subject`, `time`, and versioned `data`. `sourceRef` is a canonical/redacted
identifier for the ingested artifact or observation; `sourceHash` binds the
bytes. A raw `file:///` path is local/private provenance and must never be
published remotely. Parent edges, retention,
cost attribution, and known limitations travel with the event instead of living
only in a dashboard tooltip.

## Event Types

`RoadmapCandidateObserved`

```json
{
  "candidateId": "control-panel-live-transcripts",
  "title": "Show live transcripts in pd-console",
  "sourceRefs": ["user-message", "docs/architecture/..."],
  "initialWhy": "Operator cannot trust agents without transcript proof."
}
```

`RoadmapSourceIngested`

```json
{
  "sourceId": "grand-harbor-plan-2026-08-04",
  "sourceRef": "source://operator-plan/grand-harbor/2026-08-04",
  "sourceVisibility": "local-private",
  "sourceHash": "sha256:...",
  "authorship": ["operator"],
  "observedAt": "2026-08-31T12:00:00.000Z",
  "supersedes": [],
  "dependencyIds": [],
  "retentionClass": "hot",
  "costAttribution": {
    "project": "port-daddy",
    "ingestUnits": 1,
    "embeddingSpaceId": "embed-v1:<sha256-of-canonical-space-metadata>"
  },
  "importReceiptId": "receipt_01..."
}
```

`RoadmapConstraintRecorded`

```json
{
  "constraint": "No Claude review for a few days",
  "kind": "budget",
  "severity": "high",
  "expiresAt": "2026-07-05T00:00:00.000Z"
}
```

`RoadmapFocusChosen`

```json
{
  "decisionId": "focus-2026-07-02-control-panel",
  "now": "Transcripted compliant Agent Node in pd-console",
  "whyNow": [
    "Restores operator trust",
    "Creates proof for website",
    "Unlocks compliance tests"
  ],
  "notNow": ["marketplace", "new art", "public harbor"],
  "acceptanceGate": "Local and Cloudflare agents show transcript, model, files, and controls."
}
```

`RoadmapItemDeferred`

```json
{
  "candidateId": "public-harbor-marketplace",
  "reason": "Depends on compliant Agent Node proof.",
  "revisitTrigger": "After pd-console shows three compliant backend lanes."
}
```

`RoadmapFocusRevised`

```json
{
  "previousDecisionId": "focus-2026-07-02-control-panel",
  "newDecisionId": "focus-2026-07-03-setup",
  "newEvidence": "Fresh installs fail before users reach pd-console.",
  "revision": "Move pd setup and doctor ahead of Cloudflare control work."
}
```

`RoadmapProofAttached`

```json
{
  "decisionId": "focus-2026-07-02-control-panel",
  "artifactRefs": [
    "core/pd-console/docs/artifacts/gpui/...",
    "PR #..."
  ],
  "result": "passed"
}
```

`RoadmapProjectionPublished`

```json
{
  "projectionId": "roadmap-graph-01...",
  "eventWatermark": "rde_01...",
  "sourceEventIds": ["rde_01..."],
  "generatedAt": "2026-08-31T12:05:00.000Z",
  "staleAfter": "2026-08-31T12:10:00.000Z",
  "views": ["graph", "table", "text-outline"],
  "limitations": ["cold-tier artifacts require restore before full-text search"],
  "readBackReceiptId": "receipt_02..."
}
```

## Projection Rules

Current focus:
  Latest non-superseded `RoadmapFocusChosen`, amended by later
  `RoadmapFocusRevised` events.

Not-now shelf:
  Active `RoadmapItemDeferred` rows whose revisit trigger has not fired.

Operator reminders:
  Constraints, acceptance gates, and review dates from the current decision.

Agent routing:
  Work chains are generated only from the current focus plus explicitly approved
  prerequisites. Deferred candidates must not spawn background agents.

Graph and accessibility:
  Every rendered node and edge links to the event ids that produced it. Layout
  does not imply causality. Publish staleness and limitation metadata, keyboard
  navigation, readable contrast, and an equivalent table or text outline.

Retention and cost:
  Hot events remain in the interactive search/index path; warm events stay
  durably queryable with a documented latency target; cold events remain
  encrypted and restorable. Tier transitions append receipts. Attribute ingest,
  embedding, storage, retrieval, and egress to source/project/account. A cost
  decision never deletes held evidence or breaks lineage.

Retirement impact:
  Before a source is superseded, archived, or deleted, traverse downstream
  decisions, dependencies, proof, projections, and published references. Append
  the affected ids, preservation decision, and operator/legal/privacy holds.

## Failure Rules

- Duplicate event ids are idempotent and ignored.
- Missing required fields go to a review queue instead of silently dropping.
- Projection handlers must be replay-safe.
- Large artifacts use references, not embedded blobs.
- Never derive current priority from a prose-only note when a decision event exists.
- An import success is not a retirement receipt; downstream impact must be explicit.
- A graph without an accessible non-visual projection fails the publication contract.
- A remote write without remote read-back proves intent, not authority.
- A remote event containing an operator filesystem path fails the privacy boundary.
