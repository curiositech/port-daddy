# Port Daddy HTTP API Reference (v3.9.0)

Base URL: `http://localhost:9876` by default. If your daemon is running elsewhere, use `pd status` or `PORT_DADDY_URL` to discover the live URL.
Unix Socket: `~/.port-daddy/daemon.sock`
IPC Socket: `~/.port-daddy/daemon.ipc` (binary MessagePack, for high-frequency operations)

Runtime packaging: operator installs are binary-first. The daemon service should
launch `dist/daemon/port-daddy-daemon`; `tsx server.ts` is only allowed when
`PORT_DADDY_ALLOW_SOURCE_DAEMON=1` is set for local development. Binary builds
also serve the generated public sample bundle at `/samples/manifest.json` and
`/samples/files/...`. The single-binary lane (`npm run build:bin`) emits
`dist/port-daddy`, whose CLI can run the MCP stdio server in-process and start
the daemon through a hidden `__daemon` entrypoint. Fleet UI and public samples
are embedded into that executable through a generated asset table, with
external `PORT_DADDY_RESOURCE_DIR/public/...` files still preferred when
present.

All HTTP endpoints accept and return JSON. Rate limited to 100 req/min per IP.

**Transport options:**
- **HTTP** (TCP or Unix socket) — full API, request-response
- **Binary IPC** (Unix domain socket) — MessagePack-encoded, 7-byte header, ~3us latency for fire-and-forget. Supports heartbeats, pheromone sprays, pub/sub publish, claims, locks, sessions. The SDK uses IPC automatically when available; falls back to HTTP.

**CLI-local surfaces that are not HTTP endpoints:**
- `pd ideas list/show` reads `docs/recovery/IDEAS-TROVE.md` directly from the repo. `pd ideas search` federates that local trove with optional `.spark/.spider` residue, repo markdown, and live daemon notes/tuples when available. This surface is intentionally local-first and only uses daemon APIs opportunistically for note/tuple search.

---

## Visual Tasks

### POST /visual-tasks
Submit visual evidence from FleetBar, Port Daddy Scout, or an MCP client and turn
it into a reviewable work item.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | no | Agent brief or bug note. Required when no screenshot or DOM context is supplied. |
| `title` | string | no | Short issue title. |
| `kind` | string | no | `fix`, `bug`, `nit`, `feedback`, or `question`. |
| `projectDir` | string | no | Repo/worktree path used for routing and DOM source hints. |
| `targetAgent` | string | no | Local agent id to notify directly. |
| `image` | object | no | Screenshot evidence, usually `mimeType` plus `dataUrl` or an existing `blobId`. |
| `region` | object | no | Selected rectangle in image or viewport coordinates. |
| `domContext` | object | no | Selectors, XPath, text snippets, bounds, and source hints captured from the page. |
| `routing` | object | no | `assignee`, `openIssue`, `startAgent`, and optional `targetAgent`. |

**Response (201):**
```json
{
  "success": true,
  "issue": { "kind": "port-daddy-work-item", "status": "opened" },
  "screenshot": { "url": "/blob/abc123" }
}
```

---

## Services (Port Management)

### POST /claim
Claim a port for a service.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Semantic identity (`project:stack:context`) |
| `port` | number | no | Preferred port number |
| `range` | [min, max] | no | Port range to search |
| `pid` | number | no | Process ID for ownership tracking |
| `expires` | number | no | TTL in milliseconds |
| `cmd` | string | no | Command that owns the port |
| `cwd` | string | no | Working directory |
| `pair` | string | no | Service to pair with |
| `metadata` | object | no | Arbitrary metadata |

**Response (200):**
```json
{
  "port": 3142,
  "id": "myapp:api:main",
  "existing": false,
  "message": "assigned port 3142"
}
```

### DELETE /release
Release a service and free its port.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Service ID or glob pattern (`myapp:*`) |

**Response (200):**
```json
{
  "released": 1,
  "releasedPorts": [3142]
}
```

### GET /services
List active services.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `pattern` | string | Glob pattern to filter (default: `*`) |
| `status` | string | Filter by status |
| `port` | number | Filter by port number |

**Response (200):**
```json
{
  "services": [
    {
      "id": "myapp:api:main",
      "port": 3142,
      "pid": 12345,
      "status": "assigned",
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ],
  "count": 1
}
```

### GET /services/:id
Get a single service by ID.

### PUT /services/:id/endpoints/:env
Set an endpoint URL for a service.

**Body:** `{ "url": "http://localhost:3142" }`

---

## Messaging (Pub/Sub)

### POST /msg/:channel
Publish a message to a channel.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `payload` | object | yes | Message payload |
| `sender` | string | no | Sender identifier |
| `expires` | number | no | TTL in milliseconds |

**Response (200):**
```json
{ "id": 1, "channel": "builds" }
```

### GET /msg/:channel
Get messages from a channel.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `limit` | number | Max messages (default: 50) |
| `after` | number | Only messages after this ID |

### GET /msg/:channel/subscribe
Subscribe via Server-Sent Events (SSE).

Returns a stream of `data: {...}` events. Max 10 concurrent SSE connections per IP.

### GET /msg/:channel/poll
Long-poll for the next message.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `after` | number | Only messages after this ID |
| `timeout` | number | Poll timeout in ms (default: 30000) |

### DELETE /msg/:channel
Clear all messages from a channel.

### GET /channels
List all active channels.

### GET /channels/discover
Discover declared channels for the current repo/worktree context.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `projectDir` | string | Project/worktree path used to derive git context |
| `q` | string | Optional substring filter over logical name, aliases, description, or physical channel |
| `observed` | boolean | Include undeclared-but-active raw channels in the response |

### GET /channels/resolve/:name
Resolve a logical or aliased channel name to the physical channel for the current repo/worktree context.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `projectDir` | string | Project/worktree path used to derive git context |

**CLI note:** `pd pub`, `pd sub`, `pd watch`, and `pd channels clear` call this endpoint automatically for declared logical channels using the current repo/worktree context. Pass `--raw-channel` in the CLI to bypass resolution and use the literal channel string.

### POST /channels/ensure
Declare or update a canonical channel.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Logical channel name |
| `scope` | string | no | `branch`, `worktree`, `repo`, or `global` |
| `aliases` | string[] | no | Alternate names that resolve to the same channel |
| `description` | string | no | Human-readable purpose |
| `projectDir` | string | no | Project/worktree path used to derive git context |
| `metadata` | object | no | Optional metadata blob |

---

## Locks (Distributed Locking)

### POST /locks/:name
Acquire a lock.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `owner` | string | yes | Lock owner identifier |
| `ttl` | number | no | Time-to-live in ms (default: 300000) |
| `metadata` | object | no | Arbitrary metadata |

**Response (200):**
```json
{ "success": true, "owner": "agent-1", "expiresAt": 1704067800000 }
```

**Response (409):** Lock already held by another owner.

### DELETE /locks/:name
Release a lock.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `owner` | string | yes | Must match lock owner |
| `force` | boolean | no | Force release regardless of owner |

### PUT /locks/:name
Extend a lock's TTL.

**Body:** `{ "owner": "agent-1", "ttl": 600000 }`

### GET /locks/:name
Check if a lock is held.

### GET /locks
List all locks. Optional query param: `owner`.

---

## Agents (Registry)

### POST /agents
Register an agent.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique agent identifier |
| `name` | string | no | Human-readable name |
| `type` | string | no | Agent type (e.g., 'ci', 'dev', 'sdk') |
| `identity` | string | no | Semantic identity (`project:stack:context`) for context-aware salvage |
| `purpose` | string | no | Human-readable description of what the agent is doing |
| `worktreeId` | string | no | Git worktree identifier |
| `metadata` | object | no | Arbitrary metadata |
| `maxServices` | number | no | Max concurrent services |
| `maxLocks` | number | no | Max concurrent locks |

Response includes `salvageHint` if dead agents exist in the same project.

### POST /agents/:id/heartbeat
Send a heartbeat to keep registration alive.

### DELETE /agents/:id
Unregister an agent.

### GET /agents/:id
Get info about an agent.

### GET /agents
List all agents. Optional query param: `active=true`.

### POST /agents/:id/inbox
Send a message to an agent's inbox. Body: `{ content, from?, type? }`.

### GET /agents/:id/inbox
Read inbox messages. Query: `?unread=true&limit=50`.

### GET /agents/:id/inbox/stats
Inbox stats: total and unread message counts.

### PUT /agents/:id/inbox/read-all
Mark all inbox messages as read.

### DELETE /agents/:id/inbox
Clear all inbox messages.

---

## Webhooks

### POST /webhooks
Register a webhook.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | yes | Webhook URL (validated against private IPs) |
| `events` | string[] | no | Events to subscribe to |
| `secret` | string | no | HMAC signing secret |
| `filterPattern` | string | no | Pattern to filter events |

### GET /webhooks
List webhooks. Optional query param: `active=true`.

### DELETE /webhooks/:id
Delete a webhook.

---

## System

### GET /health
Health check. Returns status, version, uptime, active port count, fleet summary, and consolidated runtime trust state.

```json
{
  "status": "ok",
  "version": "3.8.2",
  "uptime_seconds": 3600,
  "active_ports": 4,
  "pid": 12345,
  "fleet": { "running": true, "projects": 2, "agents": 5, "watchers": 1 }
}
```
`fleet` is `undefined` when the fleet subsystem is not running.
`runtime` summarizes whether the daemon is nominal or degraded without claiming the process is dead.
When a fleet mailbox is busy, individual agent rows can surface `status: "queued"` and `queueDepth` so repeated wakeups are visible as collapsed pending work instead of fresh spawns.

### GET /attest
Honest self-report (ADR-0045). Returns the daemon's loud-fail invariant
attestations — each declared capability with its real runtime state (enforced /
degraded / stubbed) rather than an aggregate "ok". Use it to verify the daemon is
actually doing what it claims, not just that it is up.

```json
{
  "version": "3.17.0",
  "invariants": [
    { "name": "CAP_ESCALATION", "state": "enforced", "engine": "runtime" }
  ],
  "honest": true
}
```

### GET /status
Combined daemon report. Includes build identity, metrics, detailed fleet breakdown, guardian state, and recent daemon history.

```json
{
  "status": "ok",
  "version": "3.8.2",
  "pid": 12345,
  "uptimeSeconds": 3600,
  "uptimeHuman": "1h 0m",
  "daemon": {
    "version": "3.8.2",
    "codeHash": "abc123def456",
    "startedAt": 1711234567890,
    "installDir": "/Users/you/port-daddy-stable",
    "nodeVersion": "v24.1.0"
  },
  "metrics": { "activePorts": 4, "memoryRSS": 52428800 },
  "fleet": {
    "running": true,
    "startedAt": 1711234567890,
    "projects": [
      {
        "name": "my-app",
        "projectDir": "/Users/you/coding/my-app",
        "running": true,
        "agents": [
          { "name": "qa", "type": "triggered", "status": "running", "running": true, "paused": false, "uptime": 3600000, "queueDepth": 0 },
          { "name": "docs", "type": "scheduled", "status": "queued", "running": false, "paused": false, "uptime": 0, "queueDepth": 2 }
        ],
        "watchers": 1,
        "channels": 3,
        "startedAt": 1711234567890
      }
    ],
    "totalAgents": 5,
    "totalWatchers": 1
  },
  "guardians": {
    "supervisor": {
      "state": "launchctl_preferred",
      "summary": "launchctl is the authoritative daemon supervisor on macOS"
    },
    "bosun": {
      "enabled": true,
      "state": "healthy",
      "reason": null,
      "monitoredUrl": "http://localhost:9875/health",
      "binaryExists": true,
      "lastCheckAt": 1711234567999,
      "lastHealthyAt": 1711234567999,
      "lastFailureAt": null,
      "lastResurrectedAt": null,
      "failureCount": 0
    },
    "barnacle": {
      "enabled": true,
      "state": "healthy",
      "reason": null,
      "monitoredUrl": "http://localhost:9875/health",
      "binaryExists": true,
      "lastCheckAt": 1711234567999,
      "lastHealthyAt": 1711234567999,
      "lastFailureAt": null,
      "lastResurrectedAt": null,
      "failureCount": 0
    }
  },
  "history": {
    "lastActivityAt": 1711234567888,
    "recentActivity": [
      {
        "id": 42,
        "timestamp": 1711234567888,
        "type": "SESSION_NOTE",
        "agentId": "spark",
        "targetId": "session-1",
        "summary": "Spark noted a daemon regression"
      }
    ],
    "recentSpend": [
      {
        "id": "cost-1",
        "timestamp": 1711234567899,
        "backend": "codex",
        "model": "gpt-5.3-codex",
        "projectName": "alpha",
        "projectDir": "/Users/you/coding/alpha",
        "costUsd": 0.12,
        "isEstimate": false
      }
    ]
  }
}
```
Queued mailbox entries mean trigger bursts were collapsed behind one busy agent. Treat `queueDepth` as pending wake count, not duplicate work.

### GET /version
Version info. Returns version string, code hash, uptime, PID.

### GET /metrics
Daemon metrics (ports assigned, messages published, locks held, etc.).

### GET /activity
Activity log. Query params: `limit`, `type`, `agent`.

### POST /ports/cleanup
Trigger cleanup of stale port assignments.

---

## Projects & Scanning

### POST /scan
Deep-scan a directory for frameworks (60+ supported). Registers the project automatically.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes | Directory to scan |
| `dryRun` | boolean | no | Preview without saving |

### GET /projects
List all known Port Daddy projects. The daemon merges explicitly registered roots with durable repo markers such as `pd-fleet.yml`, `.portdaddyrc`, and `.portdaddy/`.

### GET /projects/:id
Get a specific project by ID.

### DELETE /projects/:id
Remove a registered project.

---

## Activity

### GET /activity/range
Get activity log within a time range.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `from` | string | ISO timestamp (start) |
| `to` | string | ISO timestamp (end) |

### GET /activity/summary
Get activity summary. Optional query param: `since` (ISO timestamp).

### GET /activity/stats
Get aggregate activity statistics.

---

## Ports

### GET /ports/active
List all active port assignments.

### GET /ports/system
List system-level port usage (netstat-style).

---

## Health (Per-Service)

### GET /services/health
Health check all registered services.

### GET /services/health/:id
Health check a specific service by ID.

---

## Webhooks (Extended)

### GET /webhooks/:id
Get a specific webhook.

### PUT /webhooks/:id
Update a webhook configuration.

### POST /webhooks/:id/test
Send a test delivery to a webhook.

### GET /webhooks/:id/deliveries
Get delivery log for a webhook.

### GET /webhooks/events
List all available webhook event types.

---

## Salvage (Agent Resurrection)

### GET /salvage/pending
Check for dead agents with unfinished work. Returns agents that died mid-task. Query params: `project`, `stack`, `limit`.

### GET /salvage
List all entries in the salvage queue. Query params: `project`, `stack`, `all`, `limit`.

### POST /salvage/claim/:agentId
Claim a dead agent's session to continue their work.

**Body:** `{ "claimedBy": "new-agent-id" }`

### POST /salvage/complete/:agentId
Mark salvage as complete.

### POST /salvage/abandon/:agentId
Return agent to the salvage queue.

### DELETE /salvage/:agentId
Remove agent from salvage queue (reviewed/dismissed).

### POST /salvage/reap
Trigger the reaper to move dead agents (stale heartbeats) into the salvage queue.

*Note: `/resurrection/*` routes are deprecated aliases for `/salvage/*`.*

### CLI: `pd salvage triage`
Local CLI synthesis over `/salvage/pending` by default, or `/salvage` with `--all`.
Clusters entries into `resume-now`, `verify-dismiss`, `test-noise`,
`no-evidence`, and `archive-later`. Use `--json` to feed future idle-agent
queue pullers; use `--limit <n>` to control printed examples per bucket.

### CLI: `pd salvage next`
Local CLI synthesis over the same salvage endpoints that returns exactly one
bounded queue item for an idle agent. By default it pulls from `resume-now`,
then `archive-later`, and deliberately skips cleanup-only buckets so idle agents
do not spend capacity on low-value dismissal chores unless directed.

Useful flags:
- `--project <name>` and `--stack <name>` scope the queue.
- `--bucket <id>` pulls from one explicit bucket, including cleanup buckets.
- `--claim --agent <id>` claims a claimable item immediately after selection.
- `--json` returns `{ bucket, item, command, claimed, claim, summary }` for
  machine-driven loops.

---

## Notes (Quick Notes)

### POST /notes
Canonical note write path. Add `sessionId` to target a known session, or omit it
to let the daemon resolve active session context / create an implicit quick-note
session.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | yes | Note content |
| `type` | string | no | Note type: progress, decision, blocker, question, handoff, general |
| `agentId` | string | no | Agent ID |
| `sessionId` | string | no | Target session ID |

### POST /sessions/:id/notes
Compatibility alias for `POST /notes` with `sessionId`. Prefer `POST /notes`
for new clients so CLI, SDK, MCP, IPC, and REST all share the same path.

### GET /notes
Get recent notes across all sessions.

**Query params:** `limit`, `type`, `agentId`

---

## Tunnels

### GET /tunnel/providers
Check which tunnel providers are installed (ngrok, cloudflared, localtunnel).

### POST /tunnel/:id
Start a tunnel for a claimed service.

**Body:** `{ "provider": "ngrok" }`

### DELETE /tunnel/:id
Stop a tunnel.

### GET /tunnel/:id
Get tunnel status.

### GET /tunnels
List all active tunnels.

---

## Changelog

### POST /changelog
Add a changelog entry.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `identity` | string | yes | Semantic identity of what changed |
| `summary` | string | yes | One-line summary |
| `type` | string | no | feature, fix, refactor, docs, chore, breaking |
| `description` | string | no | Detailed description (markdown) |

### GET /changelog
List recent changelog entries. Query params: `identity`, `limit`, `format`.

### GET /changelog/identities
List identities with changelog entries.

---

## Wait (Service Readiness)

### GET /wait/:id
Wait for a service to become healthy. Blocks until service responds or timeout.

**Query params:** `timeout` (ms, default 30000)

### POST /wait
Wait for multiple services.

**Body:** `{ "services": ["myapp:api", "myapp:db"], "timeout": 30000 }`

---

## Sugar (Compound Commands)

### POST /sugar/begin
Register agent + start session atomically. Rolls back agent registration on failure.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `purpose` | string | yes | What you're working on |
| `lifecycle` | `'durable' | 'ephemeral'` | yes | Explicit session lifecycle. Use `durable` for ordinary agent work contexts; use `ephemeral` only for heartbeat-bound process sessions. |
| `identity` | string | no | Semantic identity (auto-detected from package.json) |
| `agentId` | string | no | Agent ID (auto-generated if not provided) |
| `name` | string | no | Human-readable display name stored beside the technical agent ID |
| `type` | string | no | Agent type (e.g., 'claude-code') |
| `files` | string[] | no | Files to claim |
| `force` | boolean | no | Force file claims even if conflicts |

**Response (200):**
```json
{
  "success": true,
  "agentId": "agent-a1b2c3d4",
  "agentName": "Auth Repair Lead",
  "sessionId": "session-uuid",
  "identity": "myapp:api",
  "purpose": "Implementing auth",
  "lifecycle": "durable",
  "agentRegistered": true,
  "sessionStarted": true,
  "salvageHint": "1 dead agent(s) found in project"
}
```

### POST /sugar/done
End session + unregister agent atomically.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | string | no | Agent ID (or finds by active session) |
| `sessionId` | string | no | Session ID |
| `note` | string | no | Final summary note |
| `status` | string | no | 'completed' (default) or 'abandoned' |

**Response (200):**
```json
{
  "success": true,
  "agentId": "agent-a1b2c3d4",
  "sessionId": "session-uuid",
  "sessionStatus": "completed",
  "agentUnregistered": true
}
```

### GET /sugar/whoami
Show current agent and session context.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `agentId` | string | Agent ID to look up |

**Response (200):**
```json
{
  "success": true,
  "active": true,
  "agentId": "agent-a1b2c3d4",
  "agentName": "Auth Repair Lead",
  "sessionId": "session-uuid",
  "purpose": "Implementing auth",
  "identity": "myapp:api",
  "noteCount": 5,
  "duration": "12m"
}
```

---

## DNS Records

### POST /dns/:identity
Register a DNS record for a service.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `port` | number | yes | Port number |

### GET /dns/lookup/:identity
Resolve a service identity to hostname and port.

### GET /dns
List all DNS records.

### POST /dns/cleanup
Remove stale DNS records.

### GET /dns/status
DNS system status.

---

## Integration Signals

### POST /integration/ready/:identity
Signal that a service is ready for integration.

**Body:** `{ "message": "Auth endpoints ready" }`

### POST /integration/needs/:identity
Signal that a service needs something from another.

**Body:** `{ "message": "Needs auth endpoints from API" }`

### GET /integration
List all integration signals. Optional query: `project`.

---

## Briefing

### POST /briefing/generate
Generate a project briefing snapshot.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `project` | string | no | Project filter |
| `full` | boolean | no | Include archives + activity log |
| `json` | boolean | no | Return JSON instead of writing file |

### GET /briefing
Read the current briefing.

---

## Sessions (Extended)

### PUT /sessions/:id/phase
Set session phase.

**Body:** `{ "phase": "testing" }`

Phases: `planning`, `in_progress`, `testing`, `reviewing`, `completed`, `abandoned`

### POST /sessions/:id/files
Claim whole files or function/class regions for a session. Prefer `regions` with canonical `symbolPath` values for code edits that do not span the whole file.

**Whole-file body:** `{ "files": ["/abs/path/src/auth.ts"] }`

**Region body:** `{ "regions": [{ "path": "/abs/path/src/auth.ts", "symbolPath": "AuthService.refreshToken" }] }`

Use `startLine` and `endLine` only as a fallback when no canonical `symbolPath` exists.

---

## File Claims (Global)

### GET /files
List all active file claims across all sessions. Optional query params: `path`, `symbol`, `symbolPath`, `agent`, `purpose`.

### GET /files/who-owns
Check who owns a path or region. Query params: `path`, `startLine`, `endLine`, `symbolPath`.

---

## Symbols And Conflict Prediction

### POST /symbols/parse
Parse files or a directory into tree-sitter symbols and dependencies.

**Body:** `{ "files": ["/abs/path/src/auth.ts"] }`

**Directory body:** `{ "directory": "/abs/path", "glob": "**/*.ts" }`

### GET /symbols
Search indexed symbols. Query params: `name`, `type`, `file`, `exported`.

### GET /symbols/stats
Read symbol-index counts and latest parse timestamp.

### GET /symbols/file/*
Read all indexed symbols for one absolute file path and whether the index is stale for that file.

### GET /dependencies
Read dependencies from or to a file. Query params: `file`, `direction=from|to`, `symbol`.

### POST /conflicts/predict
Predict direct/dependency/signature conflicts between two sets of symbol claims.

**Body:** `{ "claimsA": [{ "filePath": "/abs/path/src/auth.ts", "symbolPath": "AuthService.refreshToken", "type": "modify" }], "claimsB": [] }`

---

## Advisor / Compass

## Maritime Actors

### GET /actors
List canonical durable maritime actors with projected live evidence from the
agent registry, sessions, and salvage queue. Query params: `project`, `limit`.

### GET /actors/:id
Read one actor by canonical id or alias. `navigator` resolves to
`cartographer`; other canonical actors include `coxswain`, `gardener`, `qa`,
`test-hunter`, `documentarian`, `simplifier`, `spark`, and `spider`.

### GET /actors/:id/inbox
Read recent messages queued to a durable actor mailbox. Query params:
`unread`, `limit`, `since`.

### GET /actors/:id/inbox/stats
Read mailbox depth for one durable actor. Returns unread and total counts.

### PUT /actors/:id/inbox/read-all
Mark all messages in a durable actor mailbox as read. This acknowledges role
mail without deleting durable evidence.

### POST /actors/:id/message
Queue a message to the durable actor mailbox. This writes to the existing inbox
substrate using targets like `actor:navigator`; it does not grant dormant actors
mutation authority.

**Body:** `{ "content": "roadmap item needs evidence", "from": "agent-...", "wake": false }`

The actor surface is additive. `/actors` is durable identity and role truth;
`/agents` remains the live body/lease compatibility view until the lease
migration lands.

---

## Advisor / Compass

### GET /advisor
Query-form coordination advice. Query params: `projectRoot`, `project`, `sessionId`, `agentId`, `task`, `files` (comma-separated), `includeChannels`, `includeTupleHints`.

### POST /advisor
Structured coordination preflight for humans, CLI, SDK-style callers, and MCP agents.

**Body:**
```json
{
  "projectRoot": "/abs/path/to/repo",
  "sessionId": "session-...",
  "agentId": "agent-...",
  "task": "change token refresh",
  "files": ["/abs/path/src/auth.ts"],
  "includeChannels": false,
  "includeTupleHints": false
}
```

**Response:** `{ success, summary, input, advice[] }`

Each advice item includes `id`, `category`, `severity`, `title`, `why`, `risk`, `confidence`, `evidence[]`, and `actions[]`. Current deterministic categories are `context`, `claim`, `lock`, `symbol`, `salvage`, `channel`, and `tuple`.

MCP equivalent: `coordination_preflight`.

---

## FleetControl Bonds, Budgets, And Panic

### GET /bonds
List bond escrow rows. Query params: `project`, `state`, `limit`.

### GET /bonds/:id
Read one bond escrow row.

### POST /bonds/:id/slash
Manually slash a bond with an audited reason.

**Body:** `{ "portion": 0.01, "reason": "arbiter violation" }`

### GET /wallets
List project wallets, including `balanceUsd`, `commonsPoolUsd`, and `budgetUsdPerDay`.

### GET /wallets/:project
Read one project wallet plus conservation totals.

### POST /wallets/:project/top-up
Credit governance-accounting USD to a project wallet.

**Body:** `{ "usd": 20 }`

### POST /wallets/:project/budget
Set or clear the daily project budget required before agent spawn.

**Body:** `{ "usdPerDay": 5 }`

### GET /budget/pending
List pending budget-breach kills during the pause-and-ask grace window.

### GET /budget/pending/:agentId
Read one pending budget-breach kill.

### POST /budget/pending/:agentId/resolve
Resolve a pending budget kill with `raise`, `kill`, or `grace`.

**Body:** `{ "action": "raise", "topUpUsd": 5, "newBudgetUsdPerDay": 10 }`

### GET /fleet/panic
Read fleet panic status.

### POST /fleet/panic
Arm the two-step fleet panic kill switch. First call without `confirm`; second call with matching `reason` and `confirm: true`.

**Body:** `{ "reason": "runaway spend", "confirm": true }`

### POST /fleet/unpanic
Clear panic state.

**Body:** `{ "reason": "operator resolved incident" }`

---

## Spawn

### POST /spawn
Spawn an AI run with full PD coordination (registration, sessions, heartbeats, salvage on crash).

This is the delegation primitive. Layer durable issue/work records above spawn rather than introducing another launch verb.

Launches are fail-closed on telemetry. Port Daddy blocks a spawn when the resolved backend/model cannot provide exact token counts plus an exact nonzero model rate for the completed run.
The live spawner defaults that policy on. Internal code may only opt out by attaching explicit HITL confirmation metadata; an omitted flag is not a valid bypass.
At the moment, the operator-facing launchable path is the Claude SDK backend with an exact-rate model entry. The larger backend enum is still documented because those implementations exist in source, but most remain blocked until telemetry parity exists.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `backend` | string | yes | `ollama`, `claude`, `claude-cli`, `gemini`, `cloudflare`, `codex`, `aider`, `custom` |
| `model` | string | no | Model name override |
| `modelTier` | string | no | Tier hint: `low`, `mid`, `high` |
| `identity` | string | yes | Semantic identity (`project:stack:context`) |
| `budgetUsd` | number | yes | Positive spend ceiling for this launch |
| `name` | string | no | Human-readable display name for the spawned agent |
| `purpose` | string | no | Human-readable task description |
| `task` | string | yes | The task/prompt for the agent |
| `allowedTools` | string | no | Comma-separated tool list (claude-cli backend only) |
| `maxTokens` | number | no | Max output tokens |
| `workdir` | string | no | Working directory for the agent |
| `timeout` | number | no | Timeout in milliseconds |

**Response (success):**
- includes normal spawn fields, `name` when available, plus `telemetry: { inputTokens, outputTokens, costUsd, rateMode }`
- `rateMode` is currently `exact` for accepted launches

**Response (precondition failure):**
- HTTP `400`
- `{ "success": false, "code": "PRECONDITION_FAILED", "error": "...", "preflight": { ... } }`
- use `/spawn/preflight` to inspect the blocked backend/model and budget reasons before retrying

### POST /spawn/preflight
Resolve backend/model selection, budget status, and telemetry eligibility without launching a run.

This returns structured attempts and blocked reasons. Use it before `/spawn` when the operator needs to see why a launch is disabled.

### GET /spawn
List active spawned agents.

### DELETE /spawn/:agentId
Kill a spawned agent.

---

## Harbors

### POST /harbors
Create a named harbor (permission namespace).

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Harbor name (e.g. `myapp:security-review`) |
| `capabilities` | string[] | no | Required capabilities for members |
| `channels` | string[] | no | Pub/sub channels scoped to this harbor |
| `expiresIn` | number | no | Expiry in milliseconds |

### GET /harbors
List all active harbors.

### GET /harbors/:name
Get harbor detail including member list.

### DELETE /harbors/:name
Destroy a harbor and remove all members.

### POST /harbors/:name/enter
Agent enters a harbor, declaring capabilities.

**Body:** `{ "agentId": "...", "capabilities": ["code:read"] }`

### POST /harbors/:name/leave
Agent leaves a harbor.

**Body:** `{ "agentId": "..." }`

### GET /harbors/:name/members
List members in a harbor.

### GET /harbors/agent/:agentId
List harbors an agent is currently in.

---

## Arbiter

### GET /arbiter/status
Get Arbiter status: rules, violations count, uptime, strict mode.

### GET /arbiter/violations
List recorded invariant violations. Query params: `limit`, `since`.

### POST /arbiter/test-invariant/:name
Inject a test violation (for demos/testing). Body: `{ agentId }`.

---

## Pheromone

### POST /pheromone/spray
Set a pheromone value on an entity. Body: `{ table, id, key, strength }` where strength is 0-1.

### GET /pheromone/:table/:id
Read pheromone values for entity. Applies read-time exponential decay.

### GET /pheromone
List all non-zero pheromones across all tracked tables.

### GET /pheromone/files
File heat map from session file claims. Query params: `path` (filter prefix), `depth` (directory rollup depth).

---

## Tuple Space

### POST /tuples
Write a tuple to the tuple space.

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tuple` | array | yes | Tuple values (any JSON array) |
| `harbor` | string | no | Harbor scope for namespace isolation |
| `writtenBy` | string | no | Agent identity that wrote the tuple |
| `ttl` | number | no | Time-to-live in milliseconds |

### GET /tuples
Read tuples matching a pattern (non-destructive).

**Query params:** `pattern` (JSON array with null for wildcards), `harbor`, `limit`.

### DELETE /tuples
Take (consume) tuples matching a pattern (destructive read).

**Query/Body:** Same as GET /tuples.

### GET /tuples/scan
List all tuples, optionally scoped to a harbor.

**Query params:** `harbor`, `limit`.

### GET /tuples/count
Count tuples, optionally scoped to a harbor.

**Query params:** `harbor`.

---

## Semantic Graph

### GET /semantic/resolve
Resolve a free-form phrase into deterministic semantic aliases, then return live evidence from semantic tuples, episodic memory, merge queue entries, and resolver decisions.

**Query params:** `q`/`query` (required), `projectDir`, `project`, `harbor`, `limit`.

Useful operator check: `GET /semantic/resolve?q=design-system%20CSS%20tasks&projectDir=/Users/you/coding/port-daddy`.

### GET /graph/edges
List semantic graph edges.

**Query params:** `projectDir`, `scope`, `sourceType`, `sourceId`, `edgeType`, `targetType`, `targetId`, `query`, `limit`.

### GET /graph/stats
Summarize graph edges for a project.

**Query params:** `projectDir`.

---

## Episodic Memory

### GET /memory/episodes
List episodic memory entries promoted from sessions and spawned runs.

**Query params:** `projectDir`, `project`, `harbor`, `agentId`, `episodeType`, `query`, `limit`.

### GET /memory/stats
Summarize episodic memory for a project.

**Query params:** `projectDir`, `project`.

---

## Fleet

As of v3.8.3, the Port Daddy daemon auto-discovers `pd-fleet.yml` files in known Port Daddy repos on boot and runs fleets as a persistent subsystem. These endpoints manage the daemon-level fleet.

The CLI (`pd fleet up/down/status/validate`) also supports a terminal-attached mode that reads `pd-fleet.yml` directly without the daemon fleet subsystem. `pd fleet validate` is the dry-run path: it parses YAML, resolves templates, checks trigger topology, and exits without spawning agents.

### GET /fleet
Aggregated fleet status across all managed projects.

**Response:**
```json
{
  "success": true,
  "running": true,
  "startedAt": 1711234567890,
  "fleets": [
    {
      "project": "my-app",
      "projectDir": "/Users/you/coding/my-app",
      "agents": [{ "name": "qa", "type": "ollama", "running": true, "uptime": 3600000 }],
      "watchers": 1,
      "channels": 3,
      "startedAt": 1711234567890
    }
  ],
  "totalAgents": 5,
  "totalWatchers": 2
}
```

---

### GET /fleet/:project
Specific project's fleet status by project name.

**Response:** `{ "success": true, "fleet": { ...same shape as fleets[] above... } }`

404 if no fleet running for that project name.

---

### POST /fleet/start
Start all daemon fleets (re-discovers projects), or a specific project.

**Body (optional):** `{ "projectDir": "/path/to/project" }`

Without `projectDir`: starts all fleets, same as daemon boot.
With `projectDir`: starts that project's fleet and begins watching `pd-fleet.yml` for hot-reload.

---

### POST /fleet/stop
Stop all fleets, or a specific project.

**Body (optional):** `{ "projectDir": "/path/to/project" }`

---

### POST /fleet/reload
Re-read all `pd-fleet.yml` configs and restart changed fleets. Equivalent to `SIGHUP`.

**Response:** `{ "success": true, "message": "Fleet daemon reloaded with 3 project(s)", "fleets": ["my-app", "other-app"] }`

---

### POST /fleet/register
Register a project directory for daemon fleet management. Starts the fleet immediately and watches for config changes.

**Body:** `{ "projectDir": "/absolute/path/to/project" }` (required)

Returns 400 if `projectDir` is missing or the project has no `pd-fleet.yml`.

---

### GET /fleet/events
SSE stream of all fleet lifecycle events from the `fleet:events` pub/sub channel.

**Event types:** `agent_started`, `agent_stopped`, `agent_failed`, `fleet_reloaded`, `schedule_fired`, `trigger_fired`

**Event shape:**
```
data: {"type":"agent_started","agent":"qa","identity":"my-app:qa:main","project":"my-app","timestamp":1711234567890}

data: {"type":"agent_failed","agent":"qa","project":"my-app","timestamp":1711234567890,"error":"Exit code 1"}
```

Heartbeat comment (`: heartbeat`) sent every 30s to detect dead connections.

---

### GET /fleet/prompt
One-line fleet status string for shell prompt integration (PS1, starship, etc.).

**Query parameters:**
- `project` (required) — Project name to get status for
- `since` — Unix timestamp; only include events after this time

**Response:**
```json
{ "success": true, "line": "qa:idle gardener:running spark:cooldown" }
```

Returns a compact string summarizing agent states for the given project. Designed to be embedded in shell prompts without line breaks.

---

### GET /fleet/config/:projectRef
Retrieve the raw YAML, parsed config, and topology validation for a project's fleet.

`projectRef` accepts a URL-encoded project directory, a registered project root path, or a unique project id. Prefer the URL-encoded `projectDir`, because logical project names may be ambiguous across multiple checkouts.

**Response:**
```json
{
  "success": true,
  "yaml": "fleet:\n  name: myapp\n  ...",
  "path": "/Users/you/coding/myapp/pd-fleet.yml",
  "projectDir": "/Users/you/coding/myapp",
  "parsed": { "fleet": { "name": "myapp", "agents": { ... } } },
  "topology": { "valid": true, "warnings": [], "cycles": [] }
}
```

Returns 404 if the project is not registered or has no `pd-fleet.yml`.

---

### PUT /fleet/config/:projectRef
Write new YAML config, validate it, and reload the fleet.

**Body:** `{ "yaml": "fleet:\n  name: myapp\n  ..." }` (required, must be valid YAML object)

**Response:**
```json
{
  "success": true,
  "topology": { "valid": true, "warnings": [], "cycles": [] },
  "warnings": [],
  "cycles": []
}
```

Returns 400 if `yaml` is missing, not a string, or fails YAML parsing. The fleet is reloaded automatically after a successful write.

---

### GET /fleet/models
List available backends, model choices, readiness, and whether each backend is launchable. `launchable: true` means the daemon can prove the backend is setup and ready; manual-check backends stay visible for setup but must not power agents yet.

**Response:**
```json
{
  "success": true,
  "backends": [
    {
      "id": "cloudflare",
      "name": "Cloudflare Workers AI",
      "models": ["@cf/zai-org/glm-4.7-flash", "@cf/qwen/qwen3-30b-a3b-fp8", "@cf/moonshotai/kimi-k2.6"],
      "launchable": true,
      "readinessStatus": "ready"
    },
    {
      "id": "codex",
      "name": "OpenAI Codex CLI",
      "models": ["gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.4"],
      "launchable": false,
      "readinessStatus": "manual_check"
    }
  ]
}
```

The catalog can list backend implementations that are not currently launchable. Use `launchable` and `readinessStatus` for runtime selection.

---

### GET /setup/overview
Return local onboarding posture for Fleet Control Center. This route exposes install paths, daemon mode, LaunchAgent details, the setup command shape, available setup actions, and a short-lived setup capability token. It is restricted to loopback callers.

**Response:**
```json
{
  "success": true,
  "version": "3.14.0",
  "codeHash": "abc123",
  "setupToken": "process-local-capability",
  "installDir": "/Users/you/coding/port-daddy",
  "daemon": {
    "mode": "binary",
    "launchAgentExists": true,
    "summary": "The installed daemon LaunchAgent appears to run a binary."
  },
  "setupCommand": {
    "label": "pd setup",
    "command": "pd",
    "baseArgs": ["setup"]
  },
  "actions": [
    { "id": "status", "label": "Check setup status", "mutates": false },
    { "id": "fleetbar", "label": "Install FleetBar", "mutates": true }
  ]
}
```

Returns 403 for non-loopback callers.

---

### POST /setup/run
Run a guarded local setup action from Fleet Control Center. Read-only `status` does not require confirmation or a token. Mutating actions (`full`, `mcp-skills`, `fleetbar`, `project-init`) require both GUI confirmation and the current `setupToken` from `GET /setup/overview`.

**Body:**
```json
{
  "action": "mcp-skills",
  "confirmed": true,
  "setupToken": "process-local-capability",
  "projectDir": "/Users/you/coding/myapp"
}
```

**Response:**
```json
{
  "success": true,
  "action": "mcp-skills",
  "command": "pd",
  "args": ["setup", "--no-daemon", "--no-fleetbar", "--no-init"],
  "cwd": "/Users/you/coding/port-daddy",
  "exitCode": 0,
  "timedOut": false,
  "stdout": "setup ok\n",
  "stderr": ""
}
```

Returns 400 for unknown actions, missing GUI confirmation on mutating actions, or `project-init` without a valid project directory. Returns 403 for non-loopback callers or missing/stale setup tokens on mutating actions.

---

### POST /fleet/config/:project/runtime
Bulk-apply one setup-ready backend/model to fleet agents without hand-editing YAML. The route rejects any backend whose readiness is not `ready`.

**Request:**
```json
{
  "backend": "cloudflare",
  "model": "@cf/qwen/qwen3-30b-a3b-fp8",
  "agentNames": ["qa", "spider"],
  "clearFallbacks": true,
  "skipCustomAgents": true
}
```

Omit `agentNames` to update every non-`custom` agent. `custom` command agents are skipped by default unless you explicitly target them by name or set `skipCustomAgents: false`. Use `modelTier` instead of `model` when a backend ladder is preferred. `clearFallbacks` defaults to `false`; pass `true` when you want the route to remove fallback runtime chains.

**Response:**
```json
{
  "success": true,
  "backend": "cloudflare",
  "model": "@cf/qwen/qwen3-30b-a3b-fp8",
  "modelTier": null,
  "updatedAgents": ["qa", "spider"],
  "skippedAgents": ["gardener"],
  "clearFallbacks": true
}
```

---

## Managed Secrets

Keychain-backed provider credential store. Values are encrypted at rest in the
OS keychain (macOS Keychain) and the store fails closed when keychain is
unavailable. Only an explicit allow-list of provider keys is accepted. This
generalizes the older `POST /fleet/backend-secrets` route; both write paths
share the same implementation.

### GET /secrets
List every allow-listed key with its storage status. Names and status ONLY —
never values.

**Response:**
```json
{
  "success": true,
  "secrets": [
    { "key": "ANTHROPIC_API_KEY", "backend": "claude", "storage": "keychain", "encryptedAtRest": true, "set": true },
    { "key": "GEMINI_API_KEY", "backend": "gemini", "storage": "keychain", "encryptedAtRest": true, "set": false }
  ]
}
```

---

### POST /secrets
Store a provider secret. The key is validated against the allow-list. The
response NEVER echoes the value.

**Body:**
```json
{ "key": "ANTHROPIC_API_KEY", "value": "sk-ant-...", "backend": "claude" }
```

**Response:**
```json
{ "success": true, "key": "ANTHROPIC_API_KEY", "encryptedAtRest": true, "storage": "keychain" }
```

Returns 400 for an unknown key (with an `allowedKeys` list) or an empty value;
503 when keychain storage is unavailable (fail-closed).

---

### POST /secrets/:key/reveal
Return a secret's plaintext value. This is the one sensitive read on the
secrets surface — it exists for the FleetBar "Copy" affordance. It is
loopback-only (per-route `preHandler` plus the global DNS-rebinding guard) and
returns 404 when the key is allow-listed but unset.

**Response:**
```json
{ "success": true, "key": "ANTHROPIC_API_KEY", "value": "sk-ant-..." }
```

Returns 403 for non-loopback callers, 404 when unset, 400 for an unknown key.

---

### DELETE /secrets/:key
Remove a secret from the keychain and the in-process cache. Idempotent.

**Response:**
```json
{ "success": true, "key": "ANTHROPIC_API_KEY", "removed": true }
```

---

## Observability (Counters, Cost Tracking, Golden Signals)

As of v3.8.3, Port Daddy records operational metrics (counters) and LLM cost events automatically. These endpoints expose that data for dashboards, budget alerts, and fleet health monitoring.

### GET /metrics/counters
Summary of all counter keys (last 24h default), or time-bucketed results for a single key.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `key` | string | Filter to one counter key (e.g. `spawn.started`). Returns time-bucketed results. |
| `since` | number | Seconds in the past (default: 86400 = 24h) |
| `groupBy` | string | `minute` (default) or `hour` — bucket granularity (only when `key` is set) |

**Response (summary, no key):**
```json
{
  "since": 1711234567890,
  "counters": [
    { "key": "spawn.started", "total": 42, "perHour": 1.75 },
    { "key": "spawn.completed", "total": 38, "perHour": 1.58 }
  ]
}
```

**Response (single key):**
```json
{
  "key": "spawn.started",
  "since": 1711234567890,
  "groupBy": "hour",
  "results": [
    { "key": "spawn.started", "dims": { "backend": "claude-cli" }, "bucket": 1711234800000, "value": 5 }
  ]
}
```

### GET /metrics/counters/top
Top N dimension values for a counter key (e.g. "top 10 backends by spawn count").

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `key` | string | **Required.** Counter key (e.g. `spawn.started`) |
| `dim` | string | **Required.** Dimension name (e.g. `backend`, `project`) |
| `n` | number | Max results (default: 10, max: 100) |
| `since` | number | Seconds in the past |

**Response (200):**
```json
{
  "key": "spawn.started",
  "dim": "backend",
  "results": [
    { "value": "claude-cli", "count": 28 },
    { "value": "ollama", "count": 14 }
  ]
}
```

### GET /metrics/golden
Four golden signals for the spawn system (RED method). Single-endpoint fleet health check.

**Response (200):**
```json
{
  "ratePerMin": 1.4,
  "errorPct": 2.5,
  "avgDurationMs": 45000,
  "costPerHour": 0.12,
  "window": { "rateWindowSecs": 300, "metricWindowSecs": 3600 },
  "counts": { "started": 42, "completed": 38, "failed": 1 }
}
```

| Signal | Meaning |
|--------|---------|
| `ratePerMin` | Spawns per minute (5-min window, extrapolated) |
| `errorPct` | Failed + killed spawns as % of started (1h window) |
| `avgDurationMs` | Average spawn duration in ms (1h window, completed only) |
| `costPerHour` | USD burn rate from cost tracker (1h window) |

### GET /metrics/cost
Cost summary by project label and backend. This is spend history, not live-fleet truth; use `GET /fleet` for current fleets. Rows include `projectDir` when the runtime recorded it.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `since` | number | Seconds in the past (default: 86400 = 24h) |
| `project` | string | Filter to one project name |

**Response (200):**
```json
{
  "since": 1711234567890,
  "periodSecs": 86400,
  "totals": { "totalUsd": 1.234, "spawnCount": 42, "estimatedCount": 10 },
  "byProject": [
    {
      "projectName": "port-daddy",
      "projectDir": "/Users/erichowens/coding/port-daddy",
      "totalUsd": 0.85,
      "spawnCount": 30,
      "estimatedCount": 8,
      "topModel": "claude-cli"
    }
  ],
  "byBackend": [
    { "backend": "claude-cli", "totalUsd": 0.85, "count": 30 }
  ]
}
```

### GET /metrics/cost/recent
Most recent cost events (useful for live cost feeds).

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `limit` | number | Max events (default: 50, max: 200) |

**Response (200):**
```json
{
  "events": [
    {
      "id": "a1b2c3d4e5f6g7h8",
      "ts": 1711234567890,
      "backend": "codex",
      "model": "gpt-5.4-mini",
      "projectName": "port-daddy",
      "projectDir": "/Users/erichowens/coding/port-daddy",
      "identity": "port-daddy:qa:main",
      "spawnId": "spawn-abc123",
      "inputTokens": null,
      "outputTokens": null,
      "costUsd": 0.05,
      "isEstimate": true
    }
  ]
}
```

### GET /metrics/cost/budget/:project
Check a project's spend against a budget ceiling.

**Path params:** `project` — project name

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `budgetUsdPerDay` | number | Required budget ceiling in USD per day |
| `since` | number | Window in seconds (default: 86400 = 24h) |

**Response (200):**
```json
{
  "project": "port-daddy",
  "budgetUsdPerDay": 10,
  "spentUsd": 1.23,
  "remainingUsd": 8.77,
  "percentUsed": 12.3,
  "overBudget": false
}
```

---

## Dashboard Events

### GET /dashboard/events
SSE stream of real-time dashboard updates. Falls back to 15s polling.

---

## Config

### GET /config
Get current daemon configuration. Optional query param: `dir`.

---

## Host Safety (ADR-0088)

### GET /safe/scan
Read-only host-safety posture audit. Runs the same scan as `pd safe scan` and the `safe_scan` MCP tool: secrets-at-rest, crown-jewel file permissions, binary trust, egress snapshot, and MCP supply-chain inventory. Optional query param `allow` is a comma-separated host allowlist for the egress check.

Always returns `200` — the report carries its own verdict (callers gate on `report.state`, not HTTP status, exactly like `GET /attest`).

**Response (200):**
```json
{
  "success": true,
  "report": {
    "state": "ok",
    "score": 100,
    "findings": []
  }
}
```

---

## Backend

### GET /harness-adapters/continuation-matrix
Read the honest N:N harness matrix. Returns catalog mechanics separately from fresh/stale daemon-witnessed spawn, live-control, native-resume, and handoff evidence; never a scalar compliance badge.
