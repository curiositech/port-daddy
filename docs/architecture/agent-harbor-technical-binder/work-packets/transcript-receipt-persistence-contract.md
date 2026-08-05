# Transcript And Receipt Persistence Contract

Status: work packet for the Agent Harbor binder.

Scope:
  This packet defines the persistence contract for official Port Daddy Agent
  Nodes. It covers transcript events, transcript fidelity, Work Receipt
  mapping, SQLite and archive requirements, API endpoints, compliance tests,
  and remediation when transcript capture is absent.

Source anchors:

- `03-agent-contract-and-extension-api.md`
- `09-data-model-and-api.md`
- `10-operator-control-panel.md`
- `docs/proposals/official-port-daddy-agent-compliance-plan.md` — authored on `codex/gpui-harness-mux`; will land with that branch (not yet shipped on main)
- `lib/transcripts.ts`
- `lib/transcript-store.ts`
- `lib/transcript-archive.ts`
- `routes/transcripts.ts`
- `routes/agents.ts`
- `routes/agent-roster.ts`
- `routes/agent-cockpit.ts`
- `lib/active-agent-roster.ts`
- `skills/agent-work-receipt-designer/`

## Executive Contract

An official Port Daddy agent is not official unless the daemon can persist,
query, replay, and verify its work.

The minimum official-agent persistence chain is:

1. Agent Node exists before the first model turn.
2. Agent body is joined to exactly one active session and one transcript stream.
3. Every visible turn, tool action, control action, file touch, cost event,
   denial, approval, checkpoint, and stop reason is persisted as an append-only
   transcript event.
4. The transcript has a per-session sequence and hash chain.
5. Large payloads spill to durable blob references with redaction state.
6. Local transcript capture is enabled by default.
7. A finalized run emits a Work Receipt that commits to transcript head hash,
   diff hash, file hash, validation artifacts, costs, risks, rollback point, and
   provenance.
8. A daemon restart can replay the transcript, re-open the receipt, and verify
   the hash commitments.

No transcript, no official agent. The runtime may still be useful, but the
operator surface must label it `observed` or `unmanaged`, disable unsupported
controls, and show remediation.

## Current Bridge State

Current code already has pieces of the contract:

- `fleet_transcripts`, `fleet_transcript_messages`, and
  `fleet_transcript_outputs` in `lib/transcripts.ts` store one operator-facing
  run row plus chronological messages and output artifacts.
- `transcript_events` in `lib/transcript-store.ts` stores append-only
  per-actor/per-turn events for cost, memory, and search style uses.
- `lib/transcript-archive.ts` writes finalized fleet transcripts to an
  append-only JSONL archive under `~/.port-daddy/transcripts/` by default.
- `routes/transcripts.ts` exposes `/transcripts`, `/transcripts/stream`,
  `/transcripts/:id`, write append routes, delete, cost rollup, and archive
  backfill.
- `routes/agent-cockpit.ts` exposes `/agents/:id/stream`, merging agent status,
  tube/control messages, and transcript updates for one spawned agent.
- `routes/agent-roster.ts` and `lib/active-agent-roster.ts` build a roster from
  live agents, active sessions, claims, remote telemetry, and inferred harness
  metadata.

Those are bridge surfaces, not the final official-agent object. The target
contract below makes `TranscriptEvent` the canonical event chain and treats
`fleet_transcripts` as an operator-facing projection until the Agent Node store
fully owns run history.

## Canonical Event Model

`TranscriptEvent` is the append-only fact shape for official agents.
Provider-specific fields live under `payloadJson` or `source`.

```json
{
  "eventId": "evt_...",
  "harborId": "harbor_...",
  "agentNodeId": "agent_...",
  "bodyId": "body_...",
  "sessionId": "session_...",
  "transcriptId": "tx_...",
  "turnId": "turn_...",
  "sequence": 42,
  "occurredAt": "2026-07-03T12:00:00.000Z",
  "ingestedAt": "2026-07-03T12:00:00.120Z",
  "schemaVersion": 1,
  "kind": "tool_result",
  "visibility": "operator",
  "source": {
    "adapter": "codex-cli",
    "offset": "jsonl:12345",
    "idempotencyKey": "codex-cli:session:offset"
  },
  "payloadJson": {},
  "payloadBlobRefs": [],
  "parentEventIds": ["evt_parent"],
  "redactionState": "none",
  "retentionPolicyId": "local-default",
  "contentHash": "sha256:...",
  "prevHash": "sha256:..."
}
```

Required invariants:

- `eventId` is globally unique.
- `(sessionId, sequence)` is unique and monotonically increasing in daemon
  receive order.
- `occurredAt` is the source timestamp when known; `ingestedAt` is daemon time.
- `source.idempotencyKey` is required for importers, reconnecting streams, and
  remote mirrors.
- `contentHash` hashes the canonical event body excluding `contentHash`.
- `prevHash` is the previous persisted event hash for the same session, or null
  for the first event.
- `sessionId` must be non-null for official events. Historical imports that
  cannot be joined remain `observed` and must not invent a fake session.
- `visibility` is one of `operator`, `agent`, `system`, `private-redacted`,
  `secret-redacted`, or `internal`.
- Private model reasoning is stored only when a provider exposes it and the
  retention policy permits it. Otherwise Port Daddy records visible reasoning
  summaries and tool traces, never fabricated hidden thought.

Required event families:

| Family | Event kinds |
| --- | --- |
| Lifecycle | `agent_registered`, `body_attached`, `session_started`, `heartbeat`, `context_pressure`, `turn_end`, `session_end`, `body_stopped` |
| Conversation | `operator_message`, `system_guidance`, `assistant_delta`, `assistant_message`, `reasoning_summary`, `thinking_exposed` |
| Tool and shell | `tool_call`, `tool_result`, `shell_command`, `stdout_chunk`, `stderr_chunk`, `mcp_call`, `mcp_result` |
| Files and git | `file_read`, `file_write`, `file_diff`, `file_touch`, `git_action`, `commit_created`, `pr_opened`, `check_updated`, `merge_queue_updated` |
| Governance | `tool_preflight`, `tool_denied`, `approval_request`, `approval_result`, `capability_lease_issued`, `capability_lease_revoked` |
| Coordination | `claim_update`, `parley_event`, `blackboard_item`, `inbox_message`, `tube_message`, `skill_graft`, `memory_retrieval` |
| Cost and budget | `cost_accrued`, `budget_warning`, `budget_pause`, `budget_cancelled` |
| Continuation | `checkpoint`, `compaction_packet`, `successor_created`, `continuation_started` |
| Receipts | `receipt_started`, `receipt_completed`, `receipt_verified`, `receipt_failed` |
| Errors | `adapter_error`, `provider_error`, `transcript_gap`, `retention_failure` |

## Body Adapter Normalization

The event model is provider-neutral. Claude Code, Codex, Gemini, Aider,
Cursor/Windsurf, local OpenAI-compatible servers, hosted providers, SDK agents,
observed imports, and fixtures all enter the same chain through a body adapter.

`AgentBody` minimum fields:

```json
{
  "bodyId": "body_...",
  "agentNodeId": "agent_...",
  "adapterKind": "managed-local-cli",
  "provider": "codex",
  "model": "gpt-...",
  "modelTier": "strong",
  "launchMode": "managed",
  "authCustody": "keychain",
  "billingPath": "operator-subscription",
  "dataBoundary": "local-only",
  "capabilities": {
    "streamingTranscript": true,
    "toolCalls": true,
    "toolResults": true,
    "fileEvents": true,
    "costEvents": true,
    "pause": true,
    "interrupt": true,
    "steer": true,
    "checkpoint": false,
    "fork": false,
    "receiptSigning": false
  },
  "expectedFidelity": "T3",
  "hookPack": {
    "kind": "vendor-hooks",
    "version": "2026-07-08",
    "verified": true
  }
}
```

Adapter rules:

- `adapterKind` is one of `managed-local-cli`, `managed-local-server`,
  `hosted-provider`, `custom-sdk-body`, `observed-import`, or `fixture`.
- `launchMode` is one of `managed`, `attached`, `observed`, `imported`, or
  `fixture`.
- `modelTier` is one of `fast`, `mid`, `strong`, `local`, or `custom`.
  Subscription, metered, and local payment differences belong in `billingPath`,
  not in `modelTier`.
- `expectedFidelity` is a promise made before launch; the final run fidelity is
  computed from persisted events and may downgrade.
- A body cannot self-upgrade official status. It can append evidence; the daemon
  computes compliance.
- Provider-private reasoning is optional evidence, never required evidence. If
  unavailable, the adapter records visible messages, tool traces, and summaries
  without inventing hidden thought.
- Tool and shell side effects must route through daemon preflight when the
  adapter claims governed tool authority. Direct, unwitnessed calls are recorded
  as observed and weaken the receipt.
- Fixture and mock bodies are legitimate for UI regression and demos, but their
  events and visual artifacts must carry explicit fixture/mock source labels.

Minimum adapter conformance fixtures:

| Fixture | Must prove |
| --- | --- |
| `managed-local-cli-codex` | CLI launch, event stream, tool result, file touch, stop reason, receipt draft |
| `managed-local-cli-claude` | Same shape as Codex without Claude-only schema assumptions |
| `hosted-provider-openai-compatible` | billing path, upload state, budget cap, transcript events, governed tools |
| `custom-sdk-body` | SDK registration, event append, control ack, partial receipt |
| `observed-import` | imported transcript/log, disabled controls, observed label, weak receipt |
| `fixture-body` | fixture source labels, no production controls, no strong receipt |

Large payload policy:

- Inline `payloadJson` is for structured metadata and small text.
- stdout, stderr, full diffs, screenshots, recordings, and long tool results use
  `payloadBlobRefs`.
- Blob refs must record media type, byte count, content hash, redaction state,
  and storage tier.
- Truncation must preserve original byte count and hash so a receipt can mark
  evidence as partial rather than pretending it is complete.

## Transcript Fidelity Levels

The UI and compliance probe must name the fidelity level honestly.

| Level | Name | What is persisted | Operator label | Compliance effect |
| --- | --- | --- | --- | --- |
| T0 | Inventory only | Agent id, heartbeat, session row, worktree if known | `registered, no transcript` | C0 maximum |
| T1 | Run log | Structured step/status rows, no visible conversation text | `run log` | Observed only |
| T2 | Visible chat | Operator/user messages and assistant messages, no reliable tool result details | `chat transcript` | Weak C1 |
| T3 | Tool-backed transcript | Visible chat, tool calls, tool results, shell commands, stdout/stderr refs, file touches, approvals, denials, costs | `tool-backed transcript` | Minimum for official coding work |
| T4 | Canonical event transcript | T3 plus Agent Node/body/session/worktree joins, event sequence, hash chain, redaction, retention policy, SSE replay, JSONL archive | `verified transcript` | Required for official C1 |
| T5 | Resumable transcript | T4 plus checkpoints, compaction packets, memory/source citations, claims, active commitments, successor metadata, rollback point | `resumable transcript` | Required for C6 |

Rules:

- Do not call T1 step metadata "transcript excerpts." If it only has sequence,
  kind, title, detail, or output length, label it `run log`.
- Final fidelity is computed from evidence actually persisted, not from provider
  brand or launch intent.
- T2 is enough to inspect what was said, but not enough to trust coding work.
- T3 is the minimum for a coding agent to claim artifact-backed work.
- T4 is the minimum for an official Port Daddy agent.
- T5 is required before the UI offers "fork successor from here" as a strong
  resume action.

## Single-Agent Run Projection

`AgentRun` is the read model for rendering one agent from intent to receipt. It
is a projection over `AgentNode`, `AgentBody`, `TranscriptEvent`, control
records, file/diff evidence, cost events, and Work Receipt rows. It is not a
separate ledger.

Minimum projection fields:

```json
{
  "runId": "run_...",
  "agentNodeId": "agent_...",
  "sessionId": "session_...",
  "status": "running",
  "workIntent": {},
  "body": {},
  "worktree": {},
  "branch": {},
  "fidelity": "T4",
  "liveness": {
    "state": "live",
    "lastHeartbeatAt": "2026-07-08T12:00:00.000Z",
    "lastEventAt": "2026-07-08T12:00:01.000Z",
    "evidence": "heartbeat-and-transcript"
  },
  "timeline": [],
  "workLedger": {
    "filesRead": [],
    "filesChanged": [],
    "commands": [],
    "toolCalls": [],
    "approvals": [],
    "denials": [],
    "validationArtifacts": []
  },
  "controlAffordances": [],
  "receipt": {
    "receiptId": "receipt_...",
    "status": "draft-or-verified-or-failed",
    "transcriptHeadHash": "sha256:...",
    "diffHash": "sha256:...",
    "filesHash": "sha256:...",
    "checkFirstRisk": {}
  },
  "renderClaims": []
}
```

Projection rules:

- `timeline[]` stores render blocks keyed by canonical event ids. Blocks may be
  compacted for display, but each compact block keeps constituent event ids for
  zoom.
- `workLedger` groups facts by reviewer task, not by provider transcript shape.
- `controlAffordances[]` includes disabled controls with daemon reasons. Absence
  of a control is reserved for surfaces that cannot physically render it.
- `renderClaims[]` records every high-level badge or summary claim with the
  event ids, artifact ids, hashes, or receipt rows that justify it.
- "LIVE" requires `liveness.evidence` from heartbeat, transcript event, or
  acknowledged control within the configured freshness window.
- A projection with only T1 step rows must render as `run log`, never as a chat
  transcript.
- Receipt and visual-evidence drawers read manifests from persisted artifacts;
  the UI must distinguish `real`, `fixture`, and `mock`.

Runtime monitor candidates:

| Invariant | Strategy | Violation response |
| --- | --- | --- |
| `EventSequenceMonotonicity` | synchronous per append plus sweep | reject duplicate/out-of-order append; alert on sweep |
| `RunProjectionReferencesOnlyPersistedEvents` | sampled/projection test | mark projection stale, do not render strong proof claims |
| `LiveBadgeRequiresFreshEvidence` | synchronous when status changes | suppress badge, emit compliance finding |
| `ControlEnabledRequiresAdapterCapability` | synchronous on projection/control request | disable control or reject request |
| `ReceiptClaimsMatchHashes` | verify on receipt publish and after restart | fail receipt verification |

## Work Receipt Mapping

The Work Receipt is a typed review object, not a pasted transcript. It must
match the nine-section shape from `agent-work-receipt-designer`:

```json
{
  "identity": {},
  "intent": {},
  "risks": [],
  "validation": {},
  "actions": {},
  "contextUsed": {},
  "rollback": {},
  "spend": {},
  "provenance": {}
}
```

Reviewer order is intentional: identity and intent first, risks and validation
near the top, provenance at the bottom.

Mapping from Port Daddy records:

| Receipt section | Source events and tables | Contract |
| --- | --- | --- |
| `identity` | `agent_nodes`, `agent_bodies`, `sessions`, current `/agents` registry, `fleet_transcripts.spawned_agent_id`, backend/model metadata | Must include agent, backend, sessionId, worktree, body/provider/model when known. `sessionId: null` is a failing receipt for official work. |
| `intent` | Work Intent, Work Plan, Articles, session purpose, scope claims, operator messages | Must state goal, authorized scope, non-goals, and a concrete stop condition. |
| `risks` | compliance probe failures, red/white review, missing artifacts, transcript gaps, manual-verification notes | Must be ranked worst-first. Exactly one high-or-critical item should carry `checkFirst: true`. |
| `validation` | `tool_result`, `shell_command`, CI/check events, screenshot/GIF/recording artifact refs, PR check logs | `artifactBacked` is true only when every `passed: true` test has a real `exitCode` or `artifactPath`. Agent prose is never validation evidence. |
| `actions` | `tool_call`, `tool_result`, `file_write`, `file_diff`, `git_action`, `commit_created`, output artifacts | Must include command exit codes, tool-call counts, files changed, and a diff summary. |
| `contextUsed` | `file_read`, `memory_retrieval`, `skill_graft`, AGENTS/ADR/rule reads, predecessor receipts | Must list files/rules actually consulted, not every file in the repo. |
| `rollback` | `checkpoint`, `base_commit`, `stash`, `snapshot`, predecessor/successor links, feature flag state | Must provide a concrete checkpoint and method. `verified` is true only when rollback was exercised or mechanically checked. |
| `spend` | `cost_events`, transcript token/cost fields, wallet/budget events, wall-clock duration | Must include known token, cost, wall-clock, and budget fields; unknown values stay null/omitted, not guessed. |
| `provenance` | transcript head hash, diff hash, file hash, receipt hash, signature, replay command | Must include a content hash. Sign when the receipt crosses machines, repos, organizations, or PR boundaries. |

`work_receipts` row contract:

```text
id
agent_node_id
session_id
harbor_id
transcript_head_hash
diff_hash
files_hash
cost_summary_json
provider_summary_json
approval_summary_json
pr_refs_json
receipt_body_json
receipt_body_hash
signature
created_at
verified_at
verification_status
```

The binder's existing `work_receipts` table is the index. The durable receipt
body is the normalized JSON object above. Verification replays the body hash,
the transcript head hash, and the diff/file hashes.

Receipt emission rules:

- Emit `receipt_started` when validation begins.
- Emit `receipt_completed` only after transcript and diff hashes are known.
- Emit `receipt_failed` when transcript capture, validation evidence, rollback,
  or provenance is incomplete.
- A receipt with missing transcript evidence may still exist, but it must be
  marked weak, set `validation.artifactBacked: false` when validation is not
  captured, and include a high-severity risk.

## SQLite And Archive Requirements

Live SQLite database:

- Official agents write through the daemon-owned SQLite handle, never a
  per-agent private database.
- The daemon DB path is resolved by current runtime rules:
  - with `PORT_DADDY_PREFIX`, `server.ts` passes
    `$PORT_DADDY_PREFIX/port-daddy.db`;
  - otherwise `PORT_DADDY_DB` wins if set;
  - otherwise the default is the install/resource root's `port-registry.db`.
- Dev daemon profiles may use isolated runtime dirs. The roster and transcript
  APIs must show which DB/runtime profile produced the row when multiple
  daemons are in play.
- The DB file must be chmod `0600` best-effort on open.
- Tests must not open the production DB. Test DBs must use `:memory:`,
  `PORT_DADDY_TEST_DB`, or a temp-dir path allowed by `lib/db.ts`.

Required pragmas:

```text
PRAGMA journal_mode = WAL
PRAGMA synchronous = NORMAL
PRAGMA wal_autocheckpoint = 200
PRAGMA busy_timeout = 5000
PRAGMA foreign_keys = ON
PRAGMA integrity_check
```

Operational requirements:

- Startup must warn if `journal_mode` is not `wal` or `memory`.
- Periodic cleanup should run `wal_checkpoint(PASSIVE)`.
- Shutdown should run `wal_checkpoint(TRUNCATE)` before closing.
- Backup and berth seeding must use WAL-consistent SQLite backup semantics.
- Receipt verification after restart must read the DB after WAL replay, not from
  stale in-memory projections.

Archive floor:

- Local transcript capture is on by default.
- Finalized transcripts must be written to the JSONL archive unless the runtime
  is intentionally running in degraded privacy mode.
- Current archive default is:

```text
PD_TRANSCRIPT_ARCHIVE_DIR or ~/.port-daddy/transcripts/
transcripts-YYYY-MM-DD.jsonl
```

- Each archived transcript line must be fsync'd by default.
- `PD_TRANSCRIPT_ARCHIVE=off` downgrades official-agent eligibility unless an
  equivalent durable sink is configured and visible in the compliance report.
- Work Receipts need the same retention floor. Until a receipt archive exists,
  receipts must live in SQLite and be attached to PR/CI artifacts or notes when
  the work crosses a review boundary.

Retention and privacy:

- Local capture is default because it powers resume, search, memory, receipt
  verification, and operator trust.
- Cloud sync is separate, encrypted, and opt-in.
- Ambient screen/audio capture is off by default and is not required for this
  contract.
- Disabling local transcript capture is a degraded privacy mode, not a normal
  official-agent state.
- Redaction runs before persistence for bearer tokens, provider keys, private
  keys, env dumps, and known credential shapes.

## API Contract

### Current bridge endpoints

These routes exist today and must remain honest while Agent Node APIs land:

| Endpoint | Role |
| --- | --- |
| `GET /agents` | List local and remote registry agents with filters. |
| `POST /agents` | Register a legacy/bridge agent. |
| `GET /agents/:id` | Get one registry agent, falling back to cloud telemetry when present. |
| `POST /agents/:id/heartbeat` | Update liveness/readiness/progress/context health. |
| `DELETE /agents/:id` | Unregister legacy/bridge agent. |
| `POST /agents/:id/inbox` | Send durable inbox message, optionally waking fleet agent. |
| `GET /agents/:id/inbox` | Read inbox messages. |
| `GET /agents/:id/sent` | Read sent-message receipts. |
| `GET /agents/:id/inbox/stats` | Read inbox totals. |
| `GET /agent-roster` | Active/recent roster projection from agents, sessions, claims, and remote telemetry. |
| `GET /agents/:id/stream` | SSE stream merging status, tube/control, and transcript events. |
| `POST /agents/:id/interrupt` | Soft control signal on `agent:<id>`. |
| `GET /transcripts` | List operator-facing fleet transcripts. |
| `GET /transcripts/cost` | Cost rollup from transcript rows. |
| `GET /transcripts/stream` | SSE stream of transcript start/update/end. |
| `GET /transcripts/:id` | Full fleet transcript with messages and outputs. |
| `POST /transcripts` | Upsert full transcript record. |
| `POST /transcripts/:id/messages` | Append message to fleet transcript. |
| `POST /transcripts/:id/outputs` | Append output artifact. |
| `POST /transcripts/archive/backfill` | Re-archive DB transcript history into JSONL. |
| `DELETE /transcripts/:id` | Destructive operator-gated delete. |

Current bridge rules:

- `/agent-roster` may infer harness identity, but inferred values must expose
  `confidence: "inferred"`.
- `/agents/:id/stream` is a merged stream, not proof of full compliance.
- `/transcripts` is a fleet/run projection and may not contain the full
  canonical event chain.
- A row with `session_id: null` is a known compliance failure for official work.

### Target official endpoints

The Agent Node API owns official truth:

| Endpoint | Contract |
| --- | --- |
| `GET /agent-nodes` | List Agent Nodes with compliance, status, scope, body, session, transcript, and receipt pointers. |
| `POST /agent-nodes` | Create node after Work Plan/Articles, before first model turn. |
| `GET /agent-nodes/:id` | Read one node and latest projections. |
| `PATCH /agent-nodes/:id` | Update daemon-owned status fields only. Bodies cannot self-upgrade compliance. |
| `POST /agent-nodes/:id/retire` | Retire node while preserving transcript and receipts. |
| `POST /agent-nodes/:id/bodies` | Attach a body with provider/model/launch mode/capabilities. |
| `GET /agent-nodes/:id/live` | Live stream summary and control affordances for the active body. |
| `POST /agent-nodes/:id/control` | Queue pause, interrupt, steer, checkpoint, fork, resume, or retire. |
| `GET /agent-nodes/:id/control` | List queued/delivered/acknowledged controls. |
| `POST /control/:id/ack` | Body acknowledges delivered control. |
| `GET /sessions/:id/events` | Replay canonical transcript events. |
| `GET /sessions/:id/stream` | SSE canonical transcript stream with replay cursor support. |
| `POST /sessions/:id/events` | Adapter/importer appends canonical events with idempotency keys. |
| `POST /sessions/:id/receipt` | Finalize or regenerate Work Receipt. |
| `GET /receipts/:id` | Read normalized receipt JSON plus verification status. |
| `POST /receipts/:id/verify` | Verify receipt body hash, transcript head hash, diff hash, file hash, and artifact refs. |
| `POST /tool/preflight` | Daemon checks tool intent before side effects. |
| `POST /tool/result` | Persist tool result and files touched after execution. |
| `GET /tool/calls/:id` | Read one witnessed tool call/result pair. |
| `GET /doctor` | Read harness/transcript/receipt health. |
| `POST /doctor/fix` | Apply safe repair from FleetBar/dashboard/CLI agent surfaces. |

Target endpoint rules:

- `POST /sessions/:id/events` is append-only. Corrections are new events with
  parent links, not mutations.
- SSE streams must emit a replay cursor and tolerate reconnect without duplicate
  visible blocks.
- Control commands are separate records but render into the transcript timeline.
- Receipts must be generated from persisted events and artifacts, not from the
  agent's final chat response.

## Compliance Tests

Required automated fixtures:

1. `official-node-before-turn`
   - Launch canary through Work Intent.
   - Verify Agent Node, body, session, transcript id, worktree, and retention
     policy exist before first model turn.
2. `cross-llm-body-adapter-matrix`
   - Render and validate managed local CLI, hosted provider, custom SDK body,
     observed import, and fixture bodies.
   - Verify the same `AgentBody`, `TranscriptEvent`, `AgentRun`, and receipt
     shapes work without Claude-only assumptions.
3. `non-null-session-join`
   - Start a spawner-backed run.
   - Verify every transcript row/event for that run has non-null `sessionId`.
   - If a historical import cannot join, verify it stays observed.
4. `canonical-event-schema`
   - Emit operator, assistant, tool call, tool result, shell, file, denial,
     approval, cost, checkpoint, and end events.
   - Validate required fields, unknown-field tolerance, sequence monotonicity,
     idempotent retry, and hash chain.
5. `single-agent-run-projection`
   - Project one run from persisted events into header, timeline, work ledger,
     control affordances, receipt, and render claims.
   - Verify every summary claim zooms to event ids, artifacts, hashes, or
     receipt rows in at most two steps.
6. `wal-and-path`
   - Open a throwaway DB through `initDatabase`.
   - Verify path guard, `journal_mode`, `busy_timeout`, `foreign_keys`, and
     checkpoint behavior.
7. `jsonl-retention`
   - Finalize a transcript.
   - Verify a day-partitioned JSONL line exists, is parseable, includes full
     messages/outputs, and survives DB deletion in the fixture.
8. `redaction-before-persistence`
   - Feed bearer token, GitHub token, OpenAI/Anthropic key, private key, and env
     dump examples.
   - Verify stored transcript and archive contain redacted values and metadata.
9. `artifact-backed-validation`
   - Run one passing command with exit code, one claimed pass without output,
     and one truncated log.
   - Verify receipt marks only captured evidence as `passed: true` and sets
     `artifactBacked: false` for self-reported validation.
10. `receipt-verifies-hashes`
   - Complete a canary diff.
   - Generate receipt.
   - Restart daemon.
   - Verify transcript head hash, diff hash, file hash, receipt body hash, PR
     refs, and replay command.
11. `stream-replay-dedupe`
   - Connect to `/sessions/:id/stream`, disconnect, reconnect from cursor.
   - Verify replay does not duplicate completed tool blocks or lose terminal
     status changes.
12. `missing-capture-downgrade`
    - Disable hooks/archive or launch unmanaged provider.
    - Verify the node cannot claim official C1/T4, UI says what is missing, and
      receipt carries a high-severity transcript risk.
13. `provider-no-private-reasoning`
    - Use a provider that exposes only visible messages.
    - Verify the transcript does not fabricate hidden reasoning and labels any
      summary as visible/operator-provided.
14. `operator-control-panel-honesty`
    - Render active, historical, stale, observed, and non-compliant states.
    - Verify "LIVE" requires heartbeat or transcript events, and T1 run logs are
      not labeled transcript excerpts.

Manual/review gates:

- Visual artifacts for `pd-console` or dashboard changes must show real
  transcript events, tool details, files, controls, and remediation states.
- A PR touching this contract's implementation cannot merge with an unanswered
  bot/human review finding about transcript loss, receipt evidence, or privacy.

## Remediation When Transcript Capture Is Absent

Absence is not a blank state. It is a compliance finding.

| Failure | Detection | Downgrade | Remediation |
| --- | --- | --- | --- |
| No Agent Node | Process/session exists with no node binding | `unmanaged` | Create Work Intent/Agent Node, relaunch or attach as observed. |
| No session join | Transcript has `session_id: null` or event has null `sessionId` | Not official | Patch launch order or backfill explicit join from active context, cwd, timestamp, and launch id. Do not invent joins for ambiguous history. |
| No transcript module | `/transcripts` returns not wired or spawner lacks transcript dependency | Block official launch | Wire transcript module before launch; existing run stays non-compliant. |
| Archive disabled | `PD_TRANSCRIPT_ARCHIVE=off` and no equivalent sink | Degraded privacy mode | Show privacy impact and require explicit degraded-mode acknowledgment; configure durable local or approved external sink for official work. |
| Path not writable | DB or archive dir cannot be opened/chmod/fsync'd | Block or observed | FleetBar/dashboard Doctor repairs permissions or lets operator choose a supported local path. |
| WAL not active | `journal_mode` not `wal` or `memory` | Warning, then block high-volume official runs | Doctor repair, restart daemon, re-run probe. |
| Hook pack absent/stale | Provider launch lacks trusted hooks/metadata | Observed or weak C1 | Install/refresh hook pack from FleetBar/dashboard and relaunch through Work Intent. |
| MCP/tool bypass | Tool calls do not route through gateway/preflight | Not governed | Refresh MCP config, PATH shims, and capability leases; mark direct calls in transcript. |
| Provider has no stream | Backend cannot expose messages/tools in real time | Observed or T1/T2 | Use observed import mode, supported adapter, or Port Daddy-owned loop. |
| Tool result missing | Tool call has no paired result/exit/artifact | Receipt weak | Mark validation manual/partial and add risk. Do not set `artifactBacked: true`. |
| Redaction failure | Secret-shaped value persists unredacted | Critical | Quarantine affected event/blob, rotate exposed secret, emit remediation receipt, and repair redactor before official launch resumes. |

Operator copy pattern:

```text
This agent is registered, but no verified transcript stream is connected.
It can be observed, but it is not an official Port Daddy agent yet.
Fix: open Doctor, repair the hook/transcript path, then relaunch or attach as a
new Agent Node. Existing history will remain labeled observed unless the daemon
can prove the session join.
```

Receipt behavior during absence:

- Generate a weak receipt only if useful for audit.
- Include `risks[0]` with severity `high` or `critical`.
- Set `validation.artifactBacked` according to captured evidence, usually
  `false`.
- Include `manualVerification` that says exactly what evidence is missing.
- Do not let the weak receipt satisfy merge gates for official-agent work.

## Build Order

1. Freeze this contract in the binder.
2. Add `AgentBody` and adapter capability schema plus matrix fixtures.
3. Add a canonical `TranscriptEvent` schema and validation fixture.
4. Add the single-agent `AgentRun` projection and render-claim evidence links.
5. Patch current spawner transcript/session joins so `session_id` is non-null.
6. Make `fleet_transcripts` project into canonical events for current runs.
7. Add Work Receipt body persistence and verification.
8. Add compliance probes for Codex, Claude Code, and one hosted/custom-body
   canary.
9. Teach `pd-console`/dashboard to show fidelity level, transcript gaps,
   receipt verification, and remediation.
10. Mirror Cloudflare run steps into canonical events without calling T1 logs
   transcript excerpts.
11. Promote Agent Node APIs to source of truth and leave `/agents`,
   `/agent-roster`, and `/transcripts` as compatibility projections.

## Open Decisions

1. Receipt archive path:
   Should Work Receipts get a sibling append-only archive under
   `~/.port-daddy/receipts/`, or should they be stored only in SQLite plus PR/CI
   artifacts until cloud sync exists?
2. Signature bar:
   Should local-only receipts require per-agent ed25519 signatures immediately,
   or only content hashes until receipts cross machines or organizations?
3. T3 versus T4 launch gate:
   Should the daemon allow a coding body to start with T3 and upgrade to T4
   during the first turn, or require T4 before the first model token?
4. Degraded privacy mode:
   Should disabling local transcript capture fully block official coding agents,
   or allow a short-lived operator-approved session that cannot produce a strong
   receipt?
