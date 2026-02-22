# Port Daddy HTTP API Reference

Base URL: `http://localhost:9876`

All endpoints accept and return JSON. Rate limited to 100 req/min per IP.

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
| `metadata` | object | no | Arbitrary metadata |
| `maxServices` | number | no | Max concurrent services |
| `maxLocks` | number | no | Max concurrent locks |

### POST /agents/:id/heartbeat
Send a heartbeat to keep registration alive.

### DELETE /agents/:id
Unregister an agent.

### GET /agents/:id
Get info about an agent.

### GET /agents
List all agents. Optional query param: `active=true`.

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
Health check. Returns status, version, uptime, active port count.

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
List all registered projects.

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

## Config

### GET /config
Get current daemon configuration. Optional query param: `dir`.
