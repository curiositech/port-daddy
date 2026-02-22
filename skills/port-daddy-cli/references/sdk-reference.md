# Port Daddy JavaScript SDK Reference

The `PortDaddy` class provides a programmatic interface to the Port Daddy daemon. Works in Node.js 18+ (uses native `fetch`).

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
| `url` | string | `http://localhost:9876` | Daemon URL |
| `agentId` | string | `PORT_DADDY_AGENT` env | Agent ID for tracking |
| `pid` | number | `process.pid` | Process ID for ownership |
| `timeout` | number | 5000 | Request timeout in ms |

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
