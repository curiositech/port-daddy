# Port Daddy JavaScript SDK Reference (v3.13.0)

The `PortDaddy` class provides a programmatic interface to the Port Daddy daemon. Works in Node.js 18+ (uses native `fetch`). Automatically uses Binary IPC for high-frequency operations (heartbeats, pheromone sprays, pub/sub) when the daemon's IPC socket is available, falling back to HTTP.

## Installation

```bash
npm install port-daddy
```

## Import

```js
import { PortDaddy } from 'port-daddy/client'
// or
import PortDaddy from 'port-daddy/client'
```

---

## Constructor

```js
const pd = new PortDaddy(options?)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | string | auto-discovered daemon URL (falls back to `http://localhost:9876`) | Daemon URL |
| `socketPath` | string | `~/.port-daddy/daemon.sock` | Unix socket path (preferred over URL) |
| `agentId` | string | `PORT_DADDY_AGENT` env | Agent ID for tracking |
| `pid` | number | `process.pid` | Process ID for ownership |
| `timeout` | number | 5000 | Request timeout in ms |

The SDK auto-detects the Unix socket at `~/.port-daddy/daemon.sock` and the IPC socket at `~/.port-daddy/daemon.ipc`. Override with `PORT_DADDY_SOCK` and `PORT_DADDY_IPC` env vars.

---

## Services

### `pd.claim(id, options?)`
Claim a port. Returns `{ port, id, existing }`.

| Option | Type | Description |
|--------|------|-------------|
| `port` | number | Preferred port |
| `range` | [min, max] | Port range |
| `expires` | number | TTL in ms |
| `cmd` | string | Owning command |
| `cwd` | string | Working directory |
| `pair` | string | Service to pair with |
| `metadata` | object | Arbitrary metadata |

### `pd.release(id)`
Release a service. Supports glob patterns (`myapp:*`). Returns `{ released, releasedPorts }`.

### `pd.getService(id)`
Get a single service by ID.

### `pd.listServices(options?)`
List services. Options: `pattern`, `status`, `port`. Returns `{ services, count }`.

### `pd.setEndpoint(id, env, url)`
Set an endpoint URL for a service. `env` is one of: `local`, `dev`, `staging`, `prod`.

---

## Messaging

### `pd.publish(channel, payload, options?)`
Publish a message. Options: `sender`, `expires`. Returns `{ id, channel }`.

### `pd.getMessages(channel, options?)`
Get messages. Options: `limit`, `after`. Returns `{ messages, count }`.

### `pd.listChannels()`
List active channels. Returns `{ channels }`.

### `pd.discoverChannels(options?)`
Discover declared channels for the current repo/worktree context. Options: `projectDir`, `query`, `includeObserved`.

### `pd.resolveChannel(name, options?)`
Resolve a logical or aliased channel name to its physical git-sensitive channel. Options: `projectDir`.

### `pd.ensureChannel(name, options?)`
Declare or update a canonical channel. Options: `scope`, `aliases`, `description`, `projectDir`, `metadata`.

### `pd.poll(channel, options?)`
Long-poll for next message. Options: `after`, `timeout` (default 30s). Returns `{ message }`.

### `pd.subscribe(channel)`
Subscribe via SSE. Returns `{ on(event, fn), unsubscribe() }`.

Events: `message`, `error`, `connected`.

```js
const sub = pd.subscribe('builds')
sub.on('message', (data) => console.log(data))
sub.on('error', (err) => console.error(err))
// Later: sub.unsubscribe()
```

### `pd.clearChannel(channel)`
Clear all messages from a channel.

---

## Locks

### `pd.lock(name, options?)`
Acquire a lock. Options: `owner`, `ttl` (default 300000ms), `metadata`. Throws 409 if held.

### `pd.unlock(name, options?)`
Release a lock. Options: `owner`, `force`.

### `pd.checkLock(name)`
Check lock status. Returns `{ locked, owner?, expiresAt? }`.

### `pd.extendLock(name, options?)`
Extend TTL. Options: `owner`, `ttl`.

### `pd.listLocks(options?)`
List locks. Options: `owner`. Returns `{ locks, count }`.

### `pd.withLock(name, fn, options?)`
Execute `fn` while holding lock. Auto-releases on completion or error.

```js
const result = await pd.withLock('deploy', async () => {
  return await deployToProduction()
})
```

---

## Agents

### `pd.register(options?)`
Register as agent. Requires `agentId` in constructor. Options: `name`, `type`, `maxServices`, `maxLocks`, `metadata`.

### `pd.heartbeat()`
Send heartbeat. Requires `agentId`.

### `pd.startHeartbeat(intervalMs?)`
Auto-heartbeat every `intervalMs` (default 60000). Returns `{ stop() }`.

### `pd.unregister()`
Unregister agent.

### `pd.getAgent(id?)`
Get agent info. Defaults to this client's `agentId`.

### `pd.listAgents(options?)`
List agents. Options: `activeOnly`. Returns `{ agents, count }`.

---

## Maritime Actors

Durable maritime actors are stable role identities such as `coxswain`, `gardener`, `qa`/`signalman`, `test-hunter`, `documentarian`/`lookout`, `simplifier`, `cartographer`/`navigator`, `spark`, and `spider`. They can have zero, one, or many live agent bodies attached. Messages target actor mailboxes like `actor:coxswain`, so the work item survives body churn.

### `pd.listActors(options?)`
List actor projections. Options: `project`, `limit`. Returns `{ actors, count }`.

### `pd.getActor(idOrAlias, options?)`
Get one actor by canonical ID or compatibility alias. Options: `project`. For example, `navigator` resolves to `cartographer`.

### `pd.messageActor(idOrAlias, content, options?)`
Send a mailbox message to an actor. Options: `from`, `type`, `project`, `wake`.

Use `wake: true` only when you also want to hail a compatible live fleet body; mailbox delivery does not require a live body.

### `pd.actorInboxList(idOrAlias, options?)`
Read recent messages queued to a durable actor mailbox. Options: `unreadOnly`, `limit`, `since`.

### `pd.actorInboxStats(idOrAlias)`
Read mailbox depth for one durable actor. Returns `{ unread, total, max }`.

```js
await pd.messageActor('navigator', 'Refresh roadmap truth from CURRENT-WORK.md', {
  from: 'agent-123',
  type: 'roadmap.request',
  project: 'port-daddy',
  wake: true,
})
```

---

## Projects

### `pd.scan(dir, options?)`
Deep-scan a directory for frameworks (60+ supported). Options: `dryRun`. Returns project with detected services.

### `pd.listProjects()`
List all registered projects.

### `pd.getProject(id)`
Get a specific project by ID.

### `pd.deleteProject(id)`
Remove a registered project.

---

## Webhooks

### `pd.addWebhook(url, options?)`
Register webhook. Options: `events`, `secret`, `filterPattern`, `metadata`. Returns `{ id }`.

### `pd.listWebhooks(options?)`
List webhooks. Options: `activeOnly`. Returns `{ webhooks, count }`.

### `pd.getWebhook(id)`
Get a specific webhook by ID.

### `pd.updateWebhook(id, options)`
Update webhook configuration. Options: `url`, `events`, `secret`, `filterPattern`, `active`.

### `pd.testWebhook(id)`
Send a test delivery to a webhook.

### `pd.getWebhookDeliveries(id)`
Get delivery log for a webhook.

### `pd.getWebhookEvents()`
List all available webhook event types.

### `pd.removeWebhook(id)`
Delete webhook.

---

## System

### `pd.health()`
Health check. Returns `{ status, version, uptime_seconds, active_ports }`.

### `pd.version()`
Version info. Returns `{ version, codeHash, uptime }`.

### `pd.getActivity(options?)`
Activity log. Options: `limit`, `type`, `agent`. Returns `{ activities, count }`.

### `pd.metrics()`
Get daemon metrics (ports assigned, messages published, locks held, etc.).

### `pd.getConfig(dir?)`
Get resolved daemon configuration. Optional `dir` for project-specific config.

### `pd.getActivityRange(from, to)`
Get activity log within a time range (ISO timestamps).

### `pd.getActivitySummary(since?)`
Get activity summary. Optional `since` (ISO timestamp).

### `pd.getActivityStats()`
Get aggregate activity statistics.

### `pd.listActivePorts()`
List all active port assignments.

### `pd.getSystemPorts()`
List system-level port usage.

### `pd.cleanupPorts()`
Trigger cleanup of stale port assignments. Returns `{ freed, count }`.

### `pd.checkServiceHealth(id)`
Health check a specific service.

### `pd.listServiceHealth()`
Health check all registered services.

### `pd.cleanup()`
Trigger stale assignment cleanup. Returns `{ freed, count }`.

### `pd.ping()`
Returns `true` if daemon is reachable, `false` otherwise.

---

## Sugar (Compound Operations)

### `pd.begin(purpose, options)`
Register agent + start session atomically. Recommended entry point for every session.

| Option | Type | Description |
|--------|------|-------------|
| `lifecycle` | `'durable' | 'ephemeral'` | Required. Use `'durable'` for ordinary agent work contexts; use `'ephemeral'` only for heartbeat-bound process sessions. |
| `identity` | string | Semantic identity (auto-detected from package.json) |
| `agentId` | string | Agent ID (auto-generated if not provided) |
| `type` | string | Agent type (e.g., 'claude-code') |
| `files` | string[] | Files to claim |
| `force` | boolean | Force file claims even if conflicts |

Returns `{ success, agentId, sessionId, identity, purpose, lifecycle, salvageHint? }`.

### `pd.done(options?)`
End session + unregister agent atomically.

| Option | Type | Description |
|--------|------|-------------|
| `agentId` | string | Agent ID (or finds by active session) |
| `sessionId` | string | Session ID |
| `note` | string | Final summary note |
| `status` | string | 'completed' (default) or 'abandoned' |

Returns `{ success, agentId, sessionId, sessionStatus, agentUnregistered }`.

### `pd.whoami(agentId?)`
Show current agent and session context.

Returns `{ success, active, agentId?, sessionId?, purpose?, identity?, noteCount?, duration? }`.

### Note admission and history reads

Exact-session note writes require the stored owner's verified credential. Durable
sessions have no lifetime note-count ceiling: ordinary appends admit 60 notes per
rolling 60 seconds per session, with content at most 10240 UTF-8 bytes and type at
most 128 bytes. HTTP 429 `NOTE_RATE_LIMITED` returns `retryAt` (Unix milliseconds),
`retryAfterMs`, and the `Retry-After` seconds header. Read the exact session after
an ambiguous write; appends are not automatically idempotent. HTTP 413
`NOTE_TOO_LARGE` and 503 `NOTE_STORAGE_FAILED` accept no append. Ephemeral
sessions retain their 500-note admission cap. One actual terminal transition
permits a bounded handoff outside burst admission; repeated end calls append
nothing, and specifying a handoff type does not grant that exception.

`GET /sessions/:id/notes` and `GET /notes` accept integer page limits 1–1000
and non-negative safe-integer `since` timestamps in milliseconds (inclusive).
Exact-session pages return the newest matching tail in chronological timestamp/id
order and an exact matching `total`; `count` is only the returned page length.
Global pages also report exact matching totals. With `since`, `beforeSinceTotal`
counts the strictly older notes under the identical base filters, in the same
read snapshot as the page. Memory's Recall/Archival rows share one bounded
request and cutoff; unavailable count metadata is not replaced by page length.
Full session detail keeps its existing complete-history default. This does not
add a cursor API, silently prune history, or establish installed runtime proof.

### Example

```js
const pd = new PortDaddy()

// Start session
const { agentId, sessionId } = await pd.begin('Implementing dark mode', {
  lifecycle: 'durable',
  identity: 'myapp:frontend',
  files: ['src/theme.ts', 'src/components/ThemeProvider.tsx']
})

// Work...
await pd.note('Created ThemeProvider skeleton', { sessionId })

// Check context
const ctx = await pd.whoami(agentId)

// Finish
await pd.done({ agentId, note: 'Theme system complete' })
```

---

## Salvage

### `pd.salvage(options?)`
List salvage queue entries. Options: `project`, `stack`, `all`, `limit`. Returns `{ entries, count }`.

### `pd.salvageClaim(agentId)`
Claim a dead agent's work. Returns `{ success, claimedBy }`.

### `pd.salvageComplete(oldAgentId, newAgentId?)`
Mark salvage as complete.

### `pd.salvageAbandon(agentId)`
Return agent to the salvage queue.

### `pd.salvageDismiss(agentId)`
Remove agent from salvage queue (reviewed/dismissed).

---

## Inbox

### `pd.inboxSend(agentId, content, options?)`
Send a direct message to an agent's inbox. Options: `from`, `type`.

### `pd.inboxList(agentId, options?)`
List inbox messages. Options: `unread`, `limit`.

### `pd.inboxStats(agentId)`
Get inbox stats: total and unread counts.

### `pd.inboxMarkRead(agentId, messageId)`
Mark a single inbox message as read.

### `pd.inboxMarkAllRead(agentId)`
Mark all inbox messages as read.

### `pd.inboxClear(agentId)`
Clear all inbox messages.

### `pd.inboxSubscribe(agentId, options?)`
Subscribe to inbox via SSE. Returns `{ on(event, fn), unsubscribe() }`.

---

## Spawn

### `pd.spawn(spec)`
Launch a background AI agent with full PD coordination.

| Option | Type | Description |
|--------|------|-------------|
| `backend` | string | `ollama`, `claude`, `claude-cli`, `gemini`, `codex`, `aider`, `custom` |
| `task` | string | The prompt/task for the agent |
| `model` | string | Model name override |
| `modelTier` | string | Tier hint: `low`, `mid`, `high` |
| `identity` | string | Semantic identity |
| `budgetUsd` | number | Positive spend ceiling for the launch |
| `purpose` | string | Human-readable task description |
| `allowedTools` | string | Comma-separated tools (claude-cli only) |
| `maxTokens` | number | Max output tokens |
| `workdir` | string | Working directory |
| `timeout` | number | Timeout in ms |

Returns `{ agentId, status }`.

### `pd.listSpawned()`
List active/completed spawned agents. Returns `{ agents }`.

### `pd.killSpawned(agentId)`
Kill a spawned agent. Returns `{ success }`.

---

## Pheromone Trails

### `pd.pheromoneSpray(table, id, key, strength)`
Spray a pheromone signal (0-1) onto an entity. **Uses IPC when available** for ~3us latency.

### `pd.pheromoneSniff(table, id)`
Read pheromone values for an entity. Applies read-time exponential decay. Returns `{ pheromones }`.

### `pd.pheromoneList()`
List all non-zero pheromones across all tracked tables. Returns `{ pheromones }`.

---

## Arbiter

### `pd.arbiterStatus()`
Get Arbiter status: rules, violations count, uptime, strict mode.

### `pd.arbiterViolations(options?)`
List recorded invariant violations. Options: `limit`, `offset`.

### `pd.arbiterTestInvariant(name)`
Inject a test violation (for demos/testing).

---

## Tuple Space

### `pd.tupleOut(tuple, options?)`
Write a tuple to the shared space. Options: `harbor`, `writtenBy`, `ttl`.

```js
await pd.tupleOut(['connection', 'trie+pubsub=routing', 'spider', 0.9], {
  harbor: 'myapp:fleet'
})
```

### `pd.tupleRd(pattern, options?)`
Read tuples matching a pattern (non-destructive). Use `null` for wildcards. Options: `harbor`, `limit`.

```js
const { tuples } = await pd.tupleRd(['connection', null, null], {
  harbor: 'myapp:fleet'
})
```

### `pd.tupleIn(pattern, options?)`
Take (atomically read + remove) tuples matching a pattern. Options: `harbor`, `limit`.

### `pd.tupleScan(harbor?)`
List all tuples, optionally scoped to a harbor.

### `pd.tupleCount(harbor?)`
Count tuples, optionally scoped to a harbor.

---

## IPC Fast Paths

The following methods automatically use the Binary IPC channel when the daemon's IPC socket is available at `~/.port-daddy/daemon.ipc`. No code changes needed — the SDK detects and uses IPC transparently.

| Method | IPC Behavior | Fallback |
|--------|-------------|----------|
| `pd.heartbeat()` | Fire-and-forget (~3us) | HTTP POST |
| `pd.pheromoneSpray()` | Fire-and-forget (~3us) | HTTP POST |
| `pd.publish()` | Fire-and-forget (~3us) | HTTP POST |
| `pd.claim()` | Request-response with conv_id | HTTP POST |
| `pd.lock()` | Request-response with conv_id | HTTP POST |

---

## Error Classes

### `PortDaddyError`
Base error with `status` and `body` properties.

### `ConnectionError`
Thrown when daemon is unreachable. Message includes start instructions.

```js
try {
  await pd.claim('myapp:api')
} catch (err) {
  if (err instanceof ConnectionError) {
    console.log('Start daemon: port-daddy start')
  }
}
```
