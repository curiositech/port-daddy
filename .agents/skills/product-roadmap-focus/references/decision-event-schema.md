# Roadmap Decision Events

Use this reference when implementing storage, daemon routes, API contracts,
pd-console panes, or durable notes for product-roadmap decisions.

## Principle

Roadmap focus is event-sourced. The operator and agents append decisions,
constraints, revisions, and proof. The current roadmap view is a projection that
can be rebuilt from events.

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
  "schemaVersion": 1,
  "data": {}
}
```

Use CloudEvents-compatible names where practical: `id`, `type`, `source`,
`subject`, `time`, and versioned `data`.

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

## Failure Rules

- Duplicate event ids are idempotent and ignored.
- Missing required fields go to a review queue instead of silently dropping.
- Projection handlers must be replay-safe.
- Large artifacts use references, not embedded blobs.
- Never derive current priority from a prose-only note when a decision event exists.
