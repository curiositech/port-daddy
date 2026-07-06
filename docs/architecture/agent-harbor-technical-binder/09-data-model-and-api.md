# 09 Data Model And API

> **Reconciled by ADR-0095 (v0 contract freeze), fork resolution 5.** This chapter
> predates the ch14 AgentRun naming rule. It now carries an `agent_runs` table, a
> `current_run_id` on `agent_nodes`, a nullable `run_id` on `control_commands`,
> `cost_events`, `skill_grafts`, and `work_receipts`, and moves the per-attempt
> continuation chain to run level (`successor_run_id` / `predecessor_run_id` on
> `agent_runs`); the session-level successor columns are a derived view, not the source of
> truth. `cost_events.timestamp` is renamed `occurred_at` to match the frozen
> `CostAccrualEvent`. Field names and shapes are authoritative in
> `schemas/agent-harbor/v0/`; where prose and schema disagree, the schema wins.

## Rule

If the daemon cannot query it, the operator cannot trust it.

The Harbor app should not scrape scattered notes to infer agent state. It should
read explicit daemon records for Agent Nodes, bodies, sessions, transcripts,
worktrees, controls, memory, claims, skills, and costs.

## Canonical TranscriptEvent

All adapters, imports, compaction packets, and stream renderers use this shape.
Provider-specific fields live inside `payload_json` or `source`.

```json
{
  "eventId": "evt-...",
  "harborId": "harbor-...",
  "sessionId": "session-...",
  "agentNodeId": "agent-...",
  "bodyId": "body-...",
  "turnId": "turn-...",
  "sequence": 42,
  "occurredAt": "2026-06-30T12:00:00.000Z",
  "ingestedAt": "2026-06-30T12:00:00.120Z",
  "schemaVersion": 1,
  "kind": "tool_call",
  "visibility": "operator",
  "source": {"adapter": "claude-code-hook", "offset": "jsonl:8021"},
  "payloadJson": {},
  "payloadBlobRefs": [],
  "parentEventIds": ["evt-parent"],
  "redactionState": "none",
  "retentionPolicyId": "local-default",
  "contentHash": "sha256:...",
  "prevHash": "sha256:..."
}
```

`prevHash` is per session. It gives each session a tamper-evident event chain.
Work Receipts can then commit to the final transcript hash.

## Core tables

`agent_nodes`

```text
id
identity
display_name
class              -- voyager, longshoreman, human, service
role
authority          -- local, team, hosted, remote-worker, observed
compliance_level   -- C0..C6
status             -- active, paused, blocked, stale, complete, retired
created_at
last_heartbeat_at
last_event_at
current_session_id
current_body_id
current_run_id      -- ADR-0095 fork 5: the live AgentRun attempt
memory_scope_id
policy_id
```

`agent_runs` (ADR-0095 fork resolution 5 — one execution attempt by a Body attached to a
node; the node endures, bodies die and are replaced, and continuation lives here)

```text
id
agent_node_id
session_id          -- exactly one session and one transcript stream per run
body_id
plan_id
intent_id
transcript_id
status              -- attaching, running, paused, human-gate, blocked, completed,
                    --   failed, canceled, abandoned, orphaned
started_at
stopped_at
stop_reason
successor_run_id    -- resume creates a successor run; old history is never mutated
predecessor_run_id
receipt_id
```

`agent_bodies`

```text
id
agent_node_id
kind               -- claude-code, codex-cli, cloudflare, ollama, lmstudio, custom
provider
model_tier         -- fast, mid, strong, local, custom
model_name         -- provider-specific, nullable in general UI
launch_mode        -- native, hooked, proxy, observed, unmanaged
pid
remote_endpoint
adapter_version
capabilities_json
started_at
stopped_at
stop_reason
```

`agent_articles`

```text
id
agent_node_id
body_id
harbor_id
articles_version
signature
signed_at
expires_at
revoked_at
```

`capability_leases`

```text
id
agent_node_id
body_id
capability
scope_json
nonce
issued_at
expires_at
revoked_at
last_challenge_at
last_challenge_result
```

`sessions`

```text
id
agent_node_id
body_id
harbor_id
repo_path
worktree_id
branch
base_commit
goal
status
started_at
ended_at
successor_session_id     -- ADR-0095 fork 5: derived view over agent_runs continuation,
predecessor_session_id   --   not the source of truth; run-level linkage is authoritative
```

`repositories`

```text
id
host              -- local, github, gitlab, bitbucket, filesystem, custom
owner
name
canonical_remote
default_branch
local_root
harbor_id
created_at
updated_at
```

`transcript_events`

```text
id
harbor_id
session_id
agent_node_id
body_id
turn_id
sequence
occurred_at
ingested_at
schema_version
kind
visibility
source_json
payload_json
payload_blob_refs_json
parent_event_ids_json
redaction_state
retention_policy_id
content_hash
prev_hash
```

`tool_calls`

```text
id
session_id
agent_node_id
event_id
tool_name
intent
risk
decision          -- allow, deny, approval_required, rewritten
started_at
ended_at
exit_code
stdout_blob_ref
stderr_blob_ref
files_touched_json
```

`worktrees`

```text
id
repo_id
repo_path
worktree_path
branch
base_commit
owner_agent_node_id
sandbox_level
created_at
cleanup_state
```

Registry scope contract:

```json
{
  "repoId": "curiositech/port-daddy",
  "repoRoot": "/Users/me/coding/port-daddy",
  "worktreeId": "wt-console-harness",
  "worktreeRoot": "/Users/me/coding/tmp/port-daddy-console-harness",
  "branch": "codex/console-harness",
  "identityProject": "port-daddy",
  "identityStack": "contrib",
  "identityContext": "console-harness",
  "lane": "local",
  "isolation": "linked-worktree"
}
```

Every registry row and roster projection should be able to answer which repo an
agent works for, which worktree or remote filesystem it is bound to, which branch
that implies, and whether it is local, Cloudflare, remote, observed, or custom.
`lane` is runtime placement. `isolation` is the safety boundary. A row without
this scope is not operator-legible and should fail the compliance probe or be
labeled `observed`.

`file_touches`

```text
id
session_id
agent_node_id
path
absolute_path
kind              -- read, write, delete, create, rename
symbol_path
start_line
end_line
event_id
timestamp
```

`claims`

```text
id
harbor_id
agent_node_id
session_id
path
symbol_path
start_line
end_line
intent            -- read, modify, add-child, add-sibling, delete, rename
status
expires_at
created_at
released_at
```

`control_commands`

```text
id
agent_node_id
session_id
run_id            -- ADR-0095 fork 5: nullable AgentRun linkage
kind              -- pause, interrupt, steer, checkpoint, resume, retire, fork, kill
payload_json
requested_by
status            -- queued, delivered, acknowledged, failed, expired, unsupported
created_at
delivered_at
acknowledged_at
```

`memory_episodes`

```text
id
harbor_id
agent_node_id
session_id
title
summary
importance
valid_from
valid_to
embedding_ref
source_event_ids_json
source_artifact_refs_json
created_at
```

`skill_cards`

```text
id
scope             -- private, repo, team, public, global
name
version
path
description
author
review_status
permissions_json
provenance_json
created_at
revoked_at
```

`skill_grafts`

```text
id
agent_node_id
session_id
run_id            -- ADR-0095 fork 5: nullable AgentRun linkage
skill_card_id
level             -- light, reference, full, tool, team
reason
expires_at
source_event_id
outcome
created_at
```

`blackboard_items`

```text
id
harbor_id
kind              -- blocker, contradiction, parley, file-heat, ci, decision
title
body
severity
status
source_refs_json
confidence
supersedes_item_id
writer_policy
created_by
created_at
updated_at
expires_at
```

`work_receipts`

```text
id
agent_node_id
session_id
run_id            -- ADR-0095 fork 5: nullable AgentRun linkage
harbor_id
transcript_head_hash
diff_hash
files_hash
cost_summary_json
provider_summary_json
approval_summary_json
pr_refs_json
signature
created_at
```

`cost_events`

```text
id
agent_node_id
session_id
run_id            -- ADR-0095 fork 5: nullable AgentRun linkage
provider
meter             -- tokens, seconds, storage, relay, custom
quantity
estimated_cost_usd
actual_cost_usd
budget_id
occurred_at       -- ADR-0095: renamed from timestamp to match CostAccrualEvent.occurredAt
```

## Endpoint shape

The app, CLI, plugins, and mobile clients should use one API family.

Agent registry:

```text
GET  /agent-nodes
POST /agent-nodes
GET  /agent-nodes/:id
PATCH /agent-nodes/:id
POST /agent-nodes/:id/retire

Current bridge endpoints:

GET  /agents?identity=<project>&worktree=<worktree-id>
GET  /agent-roster?project=<project>&worktree=<worktree-id>
```

Bodies and launch:

```text
POST /agent-nodes/:id/bodies
POST /agents/launch
POST /agents/attach
POST /agents/probe

Current bridge endpoints:

POST /spawn/preflight
POST /spawn { "dryRun": true }
POST /spawn
```

Streams:

```text
GET  /sessions/:id/events
GET  /sessions/:id/stream
POST /sessions/:id/events
GET  /agent-nodes/:id/live
```

Controls:

```text
POST /agent-nodes/:id/control
GET  /agent-nodes/:id/control
POST /control/:id/ack
```

Tools and guard:

```text
POST /tool/preflight
POST /tool/result
GET  /tool/calls/:id
```

Claims and conflict:

```text
GET  /claims
POST /claims
POST /claims/check
POST /conflicts/predict
POST /parley
```

Memory and search:

```text
POST /transcripts/search
POST /memory/search
POST /memory/episodes
GET  /blackboard
POST /blackboard
```

Skills:

```text
POST /skills/search
POST /skills/graft
POST /skills/propose
POST /skills/validate
```

Worktrees and files:

```text
GET  /worktrees
POST /worktrees
GET  /files/preview?path=
GET  /files/symbols?path=
GET  /diffs/:sessionId
```

Doctor:

```text
GET  /doctor
POST /doctor/fix
GET  /doctor/hooks
GET  /doctor/mcp
```

Receipts:

```text
POST /sessions/:id/receipt
GET  /receipts/:id
POST /receipts/:id/verify
```

## Event ordering

Transcript events need stable ordering even when remote streams reconnect.

Use:

- daemon receive sequence for local order;
- provider event id where available;
- `occurredAt` from source plus daemon `ingestedAt`;
- source adapter plus offset for replay;
- parent event ids for derived summaries;
- idempotency key for retries;
- blob refs for large payloads.

The UI should tolerate late events but mark them as late-arriving if they change
the visible transcript order.

## Stream protocol

Live streams should use SSE first because the daemon already has SSE patterns.
WebSocket can be added for bidirectional low-latency control.

SSE event example:

```text
event: transcript
id: evt-123
data: {"kind":"assistant_delta","sequence":42,"payload":{"text":"..."}}
```

Control commands should be separate from transcript events but rendered into the
timeline when relevant.

## File previews

The app should never show only relative paths when the daemon knows the repo.

File preview endpoint should:

- resolve repo root plus relative path;
- reject paths outside granted roots;
- return file text or safe binary metadata;
- return syntax language and tree-sitter parse status;
- return symbol ranges and claims;
- return diff hunks for session.

This enables the native app to open actual text with highlighting instead of
making the user infer from clipped paths.

## Search index

Search should index:

- transcript event text;
- tool names and commands;
- file paths and symbol paths;
- note summaries;
- PR numbers and comments;
- error messages;
- memory episodes;
- skill names and outcomes;
- blackboard items.

Search results must show source type, timestamp, agent, session, and preview.
Clicking a result opens the transcript at the event or the file at the symbol.

## Migration from current state

Near-term migration:

1. Keep current sessions and notes tables.
2. Add Agent Node records as a join layer.
3. Backfill existing sessions into weak Agent Nodes.
4. Add transcript events without deleting old notes.
5. Mark historical runs as observed if tool control is unknown.
6. Teach `pd-console` to read Agent Node APIs first.
7. Move all legacy launch commands, compatibility bridges, cloud launchers,
   hooks, and custom API launchers behind one Work Intent and Work Plan service.
   They may keep aliases temporarily, but they must not own separate runtime
   state.

This avoids pretending old sessions were more compliant than they were.

## Tests

Required test fixtures:

- compliant fake agent;
- registered-only fake agent;
- stream-only observed agent;
- denied destructive git tool call;
- interrupted active stream;
- late remote event;
- missing hook remediation;
- file preview path traversal rejection;
- transcript search result opens source;
- successor run inherits predecessor packet (ADR-0095 fork 5: continuation is run-level);
- Work Receipt verifies transcript and diff hash.
