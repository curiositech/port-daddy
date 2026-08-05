import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Surface } from '@/components/ui/Surface'
import { Search, ChevronDown } from 'lucide-react'

/* ── Types ──────────────────────────────────────────────────── */

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

interface Endpoint {
  method: HttpMethod
  path: string
  description: string
  group: string
  curl?: string
  requestBody?: string
  responseBody?: string
}

/* ── Method badge colors ────────────────────────────────────── */

const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: 'var(--brand-secondary)',
  POST: 'var(--status-success)',
  PUT: 'var(--brand-accent)',
  DELETE: 'var(--brand-primary)',
}

function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-[var(--surface-raised)] px-2.5 py-0.5 font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-wider shrink-0 shadow-[var(--shadow-pressed)]"
      style={{ color: METHOD_COLOR[method] }}
    >
      {method}
    </span>
  )
}

/* ── Endpoint data ──────────────────────────────────────────── */

const BASE = '$PD_URL'

const API_GROUPS = [
  'Services',
  'Sessions & Notes',
  'Locks',
  'Messaging',
  'Agents',
  'Salvage',
  'DNS',
  'Harbors',
  'Tunnels',
  'Sugar',
  'Pheromone',
  'System',
] as const

const ENDPOINTS: Endpoint[] = [
  // ── Services ─────────────────────────────────────────────────
  {
    group: 'Services',
    method: 'POST',
    path: '/claim',
    description: 'Claim a port with a semantic identity. Same identity always maps to the same port (deterministic hashing).',
    curl: `$ curl -X POST ${BASE}/claim \\
  -H "Content-Type: application/json" \\
  -d '{"id": "myapp:api:main"}'`,
    requestBody: `{
  "id": "myapp:api:main",
  "port": 3000,
  "pid": 12345,
  "cmd": "npm start",
  "cwd": "/home/user/myapp",
  "expires": 3600000,
  "metadata": { "framework": "express" }
}`,
    responseBody: `{
  "success": true,
  "id": "myapp:api:main",
  "port": 9001,
  "existing": false,
  "claimed_at": "2026-03-27T10:00:00.000Z"
}`,
  },
  {
    group: 'Services',
    method: 'DELETE',
    path: '/release',
    description: 'Release a service by ID or release all expired services.',
    curl: `$ curl -X DELETE ${BASE}/release \\
  -H "Content-Type: application/json" \\
  -d '{"id": "myapp:api:main"}'`,
    requestBody: `{
  "id": "myapp:api:main"
}
// Or release expired:
{ "expired": true }`,
    responseBody: `{
  "success": true,
  "released": 1,
  "releasedPorts": [9001]
}`,
  },
  {
    group: 'Services',
    method: 'GET',
    path: '/services',
    description: 'List or search services. Filter by pattern, status, or port.',
    curl: `$ curl "${BASE}/services?pattern=myapp:*&status=active"`,
    responseBody: `{
  "success": true,
  "services": [
    { "id": "myapp:api:main", "port": 9001, "status": "active", ... }
  ],
  "count": 1
}`,
  },
  {
    group: 'Services',
    method: 'GET',
    path: '/services/:id',
    description: 'Get a single service by its identity.',
    responseBody: `{
  "success": true,
  "service": {
    "id": "myapp:api:main",
    "port": 9001,
    "status": "active",
    "pid": 12345,
    "claimed_at": "2026-03-27T10:00:00.000Z"
  }
}`,
  },
  {
    group: 'Services',
    method: 'GET',
    path: '/wait/:id',
    description: 'Block until a service exists or timeout (SSE). Default timeout 30s, max 120s.',
    curl: `$ curl "${BASE}/wait/myapp:api:main?timeout=10000"`,
    responseBody: `{
  "success": true,
  "services": [{ "id": "myapp:api:main", "port": 9001, ... }],
  "resolved": 1,
  "requested": 1,
  "timedOut": false
}`,
  },
  {
    group: 'Services',
    method: 'POST',
    path: '/wait',
    description: 'Block until multiple services exist or timeout.',
    requestBody: `{
  "ids": ["myapp:api:main", "myapp:web:main"],
  "timeout": 30000
}`,
  },

  // ── Sessions & Notes ────────────────────────────────────────
  {
    group: 'Sessions & Notes',
    method: 'POST',
    path: '/sessions',
    description: 'Start a new session with a purpose. Optionally claim files and associate an agent.',
    curl: `$ curl -X POST ${BASE}/sessions \\
  -H "Content-Type: application/json" \\
  -d '{"purpose": "Implementing auth", "agentId": "agent-1", "files": ["src/auth.ts"]}'`,
    requestBody: `{
  "purpose": "Implementing auth",
  "agentId": "agent-1",
  "files": ["src/auth.ts"],
  "force": false,
  "metadata": {}
}`,
    responseBody: `{
  "success": true,
  "id": "sess_abc123",
  "purpose": "Implementing auth",
  "agentId": "agent-1",
  "status": "active"
}`,
  },
  {
    group: 'Sessions & Notes',
    method: 'GET',
    path: '/sessions',
    description: 'List sessions. Filter by status, agent, project, or purpose.',
    curl: `$ curl "${BASE}/sessions?status=active&limit=10"`,
  },
  {
    group: 'Sessions & Notes',
    method: 'GET',
    path: '/sessions/:id',
    description: 'Get session details including notes and file claims.',
  },
  {
    group: 'Sessions & Notes',
    method: 'PUT',
    path: '/sessions/:id',
    description: 'End or abandon a session. Set status to "completed" or "abandoned".',
    requestBody: `{
  "status": "completed",
  "note": "Auth feature complete"
}`,
  },
  {
    group: 'Sessions & Notes',
    method: 'PUT',
    path: '/sessions/:id/phase',
    description: 'Set the current phase of a session (e.g., "planning", "coding", "testing").',
    requestBody: `{ "phase": "testing" }`,
  },
  {
    group: 'Sessions & Notes',
    method: 'DELETE',
    path: '/sessions/:id',
    description: 'Delete a session and cascade-delete all its notes and file claims.',
  },
  {
    group: 'Sessions & Notes',
    method: 'POST',
    path: '/sessions/:id/notes',
    description: 'Compatibility alias for POST /notes with sessionId. Adds an immutable note to a session.',
    requestBody: `{
  "content": "Found a race condition in the auth flow",
  "type": "progress"
}`,
    responseBody: `{
  "success": true,
  "noteId": 42,
  "sessionId": "sess_abc123"
}`,
  },
  {
    group: 'Sessions & Notes',
    method: 'GET',
    path: '/sessions/:id/notes',
    description: 'Get notes for a session. Filter by type, limit, or since timestamp.',
    curl: `$ curl "${BASE}/sessions/sess_abc123/notes?type=progress&limit=10"`,
  },
  {
    group: 'Sessions & Notes',
    method: 'POST',
    path: '/sessions/:id/files',
    description: 'Claim files for a session. Detects conflicts with other sessions unless force=true.',
    requestBody: `{
  "files": ["src/auth.ts", "src/middleware.ts"],
  "force": false
}`,
  },
  {
    group: 'Sessions & Notes',
    method: 'DELETE',
    path: '/sessions/:id/files',
    description: 'Release file claims from a session.',
    requestBody: `{ "files": ["src/auth.ts"] }`,
  },
  {
    group: 'Sessions & Notes',
    method: 'POST',
    path: '/notes',
    description: 'Canonical note write path. Pass sessionId to target a session, or omit it for active-session / quick-note resolution.',
    curl: `$ curl -X POST ${BASE}/notes \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Discovered memory leak in parser", "sessionId": "sess_abc123", "type": "warning"}'`,
    requestBody: `{
  "content": "Discovered memory leak",
  "sessionId": "sess_abc123",
  "agentId": "agent-1",
  "type": "warning"
}`,
  },
  {
    group: 'Sessions & Notes',
    method: 'GET',
    path: '/notes',
    description: 'Recent notes across all sessions. Filter by type, limit, or since timestamp.',
    curl: `$ curl "${BASE}/notes?limit=20&type=progress"`,
  },
  {
    group: 'Sessions & Notes',
    method: 'GET',
    path: '/files',
    description: 'List all active file claims across all sessions.',
  },
  {
    group: 'Sessions & Notes',
    method: 'GET',
    path: '/files/who-owns',
    description: 'Check who owns a specific file path.',
    curl: `$ curl "${BASE}/files/who-owns?path=src/auth.ts"`,
  },

  // ── Locks ───────────────────────────────────────────────────
  {
    group: 'Locks',
    method: 'POST',
    path: '/locks/:name',
    description: 'Acquire a distributed lock with TTL. Returns 409 if already held by another owner.',
    curl: `$ curl -X POST ${BASE}/locks/deploy-gate \\
  -H "Content-Type: application/json" \\
  -d '{"owner": "agent-1", "ttl": 60000}'`,
    requestBody: `{
  "owner": "agent-1",
  "ttl": 60000,
  "metadata": { "reason": "deploying v2" }
}`,
    responseBody: `{
  "success": true,
  "name": "deploy-gate",
  "owner": "agent-1",
  "expiresAt": "2026-03-27T10:01:00.000Z"
}`,
  },
  {
    group: 'Locks',
    method: 'PUT',
    path: '/locks/:name',
    description: 'Extend a lock TTL. Only the current owner can extend.',
    requestBody: `{
  "owner": "agent-1",
  "ttl": 60000
}`,
  },
  {
    group: 'Locks',
    method: 'DELETE',
    path: '/locks/:name',
    description: 'Release a lock. Use force=true to release regardless of ownership.',
    requestBody: `{
  "owner": "agent-1",
  "force": false
}`,
  },
  {
    group: 'Locks',
    method: 'GET',
    path: '/locks/:name',
    description: 'Check the status of a specific lock.',
  },
  {
    group: 'Locks',
    method: 'GET',
    path: '/locks',
    description: 'List all active locks. Optionally filter by owner.',
    curl: `$ curl "${BASE}/locks?owner=agent-1"`,
  },

  // ── Messaging ───────────────────────────────────────────────
  {
    group: 'Messaging',
    method: 'GET',
    path: '/msg',
    description: 'List all pub/sub channels with message counts.',
  },
  {
    group: 'Messaging',
    method: 'POST',
    path: '/msg/:channel',
    description: 'Publish a message to a channel. All subscribers receive it in real-time.',
    curl: `$ curl -X POST ${BASE}/msg/build-results \\
  -H "Content-Type: application/json" \\
  -d '{"payload": {"status": "passed", "tests": 42}, "sender": "ci-agent"}'`,
    requestBody: `{
  "payload": { "status": "passed", "tests": 42 },
  "sender": "ci-agent",
  "expires": 3600000
}`,
    responseBody: `{
  "success": true,
  "id": 7,
  "channel": "build-results"
}`,
  },
  {
    group: 'Messaging',
    method: 'GET',
    path: '/msg/:channel',
    description: 'Get recent messages from a channel. Use limit and after params.',
    curl: `$ curl "${BASE}/msg/build-results?limit=10&after=5"`,
  },
  {
    group: 'Messaging',
    method: 'GET',
    path: '/msg/:channel/poll',
    description: 'Long-poll for the next message. Blocks until a message arrives or timeout.',
    curl: `$ curl "${BASE}/msg/build-results/poll?after=0&timeout=30000"`,
  },
  {
    group: 'Messaging',
    method: 'GET',
    path: '/msg/:channel/subscribe',
    description: 'Subscribe to a channel via Server-Sent Events (SSE). Real-time streaming.',
    curl: `$ curl -N "${BASE}/msg/build-results/subscribe"`,
  },
  {
    group: 'Messaging',
    method: 'DELETE',
    path: '/msg/:channel',
    description: 'Clear all messages from a channel.',
  },
  {
    group: 'Messaging',
    method: 'GET',
    path: '/channels',
    description: 'Alias for GET /msg. Lists all pub/sub channels.',
  },

  // ── Agents ──────────────────────────────────────────────────
  {
    group: 'Agents',
    method: 'POST',
    path: '/agents',
    description: 'Register an agent. Supports semantic identity for project-level coordination.',
    curl: `$ curl -X POST ${BASE}/agents \\
  -H "Content-Type: application/json" \\
  -d '{"id": "agent-1", "identity": "myapp:api", "purpose": "Building auth"}'`,
    requestBody: `{
  "id": "agent-1",
  "name": "Auth Builder",
  "type": "cli",
  "identity": "myapp:api",
  "purpose": "Building auth",
  "worktreeId": "wt-abc",
  "metadata": {},
  "maxServices": 10,
  "maxLocks": 5
}`,
    responseBody: `{
  "success": true,
  "registered": true,
  "agentId": "agent-1",
  "salvageHint": { "count": 2, "project": "myapp" }
}`,
  },
  {
    group: 'Agents',
    method: 'POST',
    path: '/agents/:id/heartbeat',
    description: 'Send a heartbeat to keep the agent alive. Agents go stale after 10 min without heartbeat.',
    curl: `$ curl -X POST ${BASE}/agents/agent-1/heartbeat`,
  },
  {
    group: 'Agents',
    method: 'DELETE',
    path: '/agents/:id',
    description: 'Unregister an agent. Broadcasts departure on the agents channel.',
  },
  {
    group: 'Agents',
    method: 'GET',
    path: '/agents/:id',
    description: 'Get details for a specific agent.',
  },
  {
    group: 'Agents',
    method: 'GET',
    path: '/agents',
    description: 'List all agents. Filter by active, identity prefix, or purpose.',
    curl: `$ curl "${BASE}/agents?active=true&identity=myapp"`,
  },
  {
    group: 'Agents',
    method: 'POST',
    path: '/agents/:id/inbox',
    description: 'Send a message to an agent inbox. Supports hailing unregistered agents.',
    requestBody: `{
  "content": "Please review auth changes",
  "from": "agent-2",
  "type": "request"
}`,
  },
  {
    group: 'Agents',
    method: 'GET',
    path: '/agents/:id/inbox',
    description: 'Read an agent inbox. Filter by unread, limit, or since timestamp.',
    curl: `$ curl "${BASE}/agents/agent-1/inbox?unread=true"`,
  },
  {
    group: 'Agents',
    method: 'PUT',
    path: '/agents/:id/inbox/:messageId/read',
    description: 'Mark a single inbox message as read.',
  },
  {
    group: 'Agents',
    method: 'PUT',
    path: '/agents/:id/inbox/read-all',
    description: 'Mark all inbox messages as read.',
  },
  {
    group: 'Agents',
    method: 'DELETE',
    path: '/agents/:id/inbox',
    description: 'Clear all messages from an agent inbox.',
  },

  // ── Salvage ─────────────────────────────────────────────────
  {
    group: 'Salvage',
    method: 'GET',
    path: '/salvage',
    description: 'List the salvage queue. Shows dead agents whose work can be continued.',
    curl: `$ curl "${BASE}/salvage?project=myapp"`,
    responseBody: `{
  "success": true,
  "agents": [
    {
      "id": "dead-agent-1",
      "purpose": "Building auth",
      "status": "dead",
      "identityProject": "myapp",
      "lastHeartbeat": 1711526400000
    }
  ],
  "count": 1
}`,
  },
  {
    group: 'Salvage',
    method: 'GET',
    path: '/salvage/pending',
    description: 'List agents pending salvage. Filter by project or stack.',
    curl: `$ curl "${BASE}/salvage/pending?project=myapp&stack=api"`,
  },
  {
    group: 'Salvage',
    method: 'POST',
    path: '/salvage/claim/:agentId',
    description: 'Claim a dead agent work for continuation. Returns the agent context and notes.',
  },
  {
    group: 'Salvage',
    method: 'POST',
    path: '/salvage/complete/:agentId',
    description: 'Mark salvage as complete after finishing the dead agent work.',
    requestBody: `{ "newAgentId": "agent-2" }`,
  },
  {
    group: 'Salvage',
    method: 'POST',
    path: '/salvage/abandon/:agentId',
    description: 'Return a claimed agent back to the salvage queue.',
  },
  {
    group: 'Salvage',
    method: 'DELETE',
    path: '/salvage/:agentId',
    description: 'Dismiss an agent from the salvage queue permanently.',
  },
  {
    group: 'Salvage',
    method: 'POST',
    path: '/salvage/reap',
    description: 'Trigger the reaper to move dead agents into the salvage queue.',
  },

  // ── DNS ─────────────────────────────────────────────────────
  {
    group: 'DNS',
    method: 'GET',
    path: '/dns',
    description: 'List all DNS records. Filter by pattern or limit.',
    curl: `$ curl "${BASE}/dns?pattern=myapp*"`,
  },
  {
    group: 'DNS',
    method: 'POST',
    path: '/dns/:id',
    description: 'Register a DNS record mapping an identity to a .local hostname.',
    curl: `$ curl -X POST ${BASE}/dns/myapp:api:main \\
  -H "Content-Type: application/json" \\
  -d '{"port": 9001, "hostname": "myapp-api.local"}'`,
    requestBody: `{
  "port": 9001,
  "hostname": "myapp-api.local"
}`,
    responseBody: `{
  "success": true,
  "identity": "myapp:api:main",
  "hostname": "myapp-api.local",
  "port": 9001
}`,
  },
  {
    group: 'DNS',
    method: 'GET',
    path: '/dns/:id',
    description: 'Get a DNS record by service identity.',
  },
  {
    group: 'DNS',
    method: 'DELETE',
    path: '/dns/:id',
    description: 'Remove a DNS record for a service identity.',
  },
  {
    group: 'DNS',
    method: 'GET',
    path: '/dns/status',
    description: 'Get DNS service status including resolver configuration.',
  },
  {
    group: 'DNS',
    method: 'POST',
    path: '/dns/cleanup',
    description: 'Remove stale DNS records for services that no longer exist.',
  },
  {
    group: 'DNS',
    method: 'POST',
    path: '/dns/setup',
    description: 'Initialize the /etc/hosts managed section for local DNS resolution.',
  },
  {
    group: 'DNS',
    method: 'POST',
    path: '/dns/teardown',
    description: 'Remove the Port Daddy managed section from /etc/hosts.',
  },
  {
    group: 'DNS',
    method: 'POST',
    path: '/dns/sync',
    description: 'Rebuild /etc/hosts entries from the DNS registry.',
  },
  {
    group: 'DNS',
    method: 'GET',
    path: '/dns/resolver',
    description: 'Get resolver configuration status.',
  },

  // ── Harbors ─────────────────────────────────────────────────
  {
    group: 'Harbors',
    method: 'POST',
    path: '/harbors',
    description: 'Create a harbor -- a permission namespace that groups agents by capability.',
    curl: `$ curl -X POST ${BASE}/harbors \\
  -H "Content-Type: application/json" \\
  -d '{"name": "deploy-zone", "capabilities": ["deploy", "rollback"]}'`,
    requestBody: `{
  "name": "deploy-zone",
  "capabilities": ["deploy", "rollback"],
  "channels": ["deploy-status"],
  "agentPatterns": ["deploy-*"],
  "expiresIn": 3600000,
  "metadata": {}
}`,
    responseBody: `{
  "success": true,
  "harbor": {
    "name": "deploy-zone",
    "capabilities": ["deploy", "rollback"],
    "members": [],
    "createdAt": "2026-03-27T10:00:00.000Z"
  }
}`,
  },
  {
    group: 'Harbors',
    method: 'GET',
    path: '/harbors',
    description: 'List all harbors. Optionally filter by pattern.',
    curl: `$ curl "${BASE}/harbors?pattern=deploy*"`,
  },
  {
    group: 'Harbors',
    method: 'GET',
    path: '/harbors/:name',
    description: 'Get details for a specific harbor.',
  },
  {
    group: 'Harbors',
    method: 'DELETE',
    path: '/harbors/:name',
    description: 'Destroy a harbor and remove all memberships.',
  },
  {
    group: 'Harbors',
    method: 'POST',
    path: '/harbors/:name/enter',
    description: 'Agent enters a harbor, gaining its capabilities.',
    requestBody: `{
  "agentId": "agent-1",
  "identity": "myapp:api",
  "capabilities": ["deploy"]
}`,
  },
  {
    group: 'Harbors',
    method: 'POST',
    path: '/harbors/:name/leave',
    description: 'Agent leaves a harbor.',
    requestBody: `{ "agentId": "agent-1" }`,
  },
  {
    group: 'Harbors',
    method: 'GET',
    path: '/harbors/:name/members',
    description: 'List all agents currently in a harbor.',
  },
  {
    group: 'Harbors',
    method: 'GET',
    path: '/harbors/agent/:agentId',
    description: 'List all harbors that a specific agent is currently in.',
  },

  // ── Tunnels ─────────────────────────────────────────────────
  {
    group: 'Tunnels',
    method: 'GET',
    path: '/tunnel/providers',
    description: 'Check which tunnel providers are installed (ngrok, cloudflared, localtunnel).',
    responseBody: `{
  "success": true,
  "providers": {
    "ngrok": true,
    "cloudflared": false,
    "localtunnel": true
  }
}`,
  },
  {
    group: 'Tunnels',
    method: 'POST',
    path: '/tunnel/:id',
    description: 'Start a tunnel for a claimed service. Exposes it via a public URL.',
    curl: `$ curl -X POST ${BASE}/tunnel/myapp:api:main \\
  -H "Content-Type: application/json" \\
  -d '{"provider": "ngrok"}'`,
    requestBody: `{ "provider": "ngrok" }`,
    responseBody: `{
  "success": true,
  "serviceId": "myapp:api:main",
  "provider": "ngrok",
  "url": "https://abc123.ngrok.io"
}`,
  },
  {
    group: 'Tunnels',
    method: 'DELETE',
    path: '/tunnel/:id',
    description: 'Stop a tunnel for a service.',
  },
  {
    group: 'Tunnels',
    method: 'GET',
    path: '/tunnel/:id',
    description: 'Get tunnel status for a specific service.',
  },
  {
    group: 'Tunnels',
    method: 'GET',
    path: '/tunnels',
    description: 'List all active tunnels.',
    responseBody: `{
  "success": true,
  "tunnels": [
    {
      "serviceId": "myapp:api:main",
      "provider": "ngrok",
      "port": 9001,
      "url": "https://abc123.ngrok.io",
      "status": "active"
    }
  ],
  "count": 1
}`,
  },

  // ── Sugar ───────────────────────────────────────────────────
  {
    group: 'Sugar',
    method: 'POST',
    path: '/sugar/begin',
    description: 'Register agent + start session atomically. The recommended way to start work.',
    curl: `$ curl -X POST ${BASE}/sugar/begin \\
  -H "Content-Type: application/json" \\
  -d '{"purpose": "Building auth", "lifecycle": "durable", "identity": "myapp:api", "files": ["src/auth.ts"]}'`,
    requestBody: `{
  "purpose": "Building auth",
  "lifecycle": "durable",
  "identity": "myapp:api",
  "agentId": "agent-1",
  "type": "cli",
  "files": ["src/auth.ts"],
  "force": false,
  "metadata": {}
}`,
    responseBody: `{
  "success": true,
  "agentId": "agent-1",
  "sessionId": "sess_abc123",
  "lifecycle": "durable",
  "salvageHint": { "count": 0 }
}`,
  },
  {
    group: 'Sugar',
    method: 'POST',
    path: '/sugar/done',
    description: 'End session + unregister agent atomically. The recommended way to finish work.',
    curl: `$ curl -X POST ${BASE}/sugar/done \\
  -H "Content-Type: application/json" \\
  -d '{"agentId": "agent-1", "note": "Auth complete", "status": "completed"}'`,
    requestBody: `{
  "agentId": "agent-1",
  "sessionId": "sess_abc123",
  "note": "Auth feature complete",
  "status": "completed"
}`,
    responseBody: `{
  "success": true,
  "agentId": "agent-1",
  "sessionId": "sess_abc123",
  "sessionStatus": "completed",
  "agentUnregistered": true
}`,
  },
  {
    group: 'Sugar',
    method: 'GET',
    path: '/sugar/whoami',
    description: 'Get current agent/session context. Returns the agent identity and active session.',
    curl: `$ curl "${BASE}/sugar/whoami?agentId=agent-1"`,
    responseBody: `{
  "success": true,
  "agent": { "id": "agent-1", "identity": "myapp:api", ... },
  "session": { "id": "sess_abc123", "purpose": "Building auth", ... }
}`,
  },

  // ── Pheromone ───────────────────────────────────────────────
  {
    group: 'Pheromone',
    method: 'POST',
    path: '/pheromone/spray',
    description: 'Set a pheromone value on an entity. Strength decays over time (stigmergic coordination).',
    curl: `$ curl -X POST ${BASE}/pheromone/spray \\
  -H "Content-Type: application/json" \\
  -d '{"table": "services", "id": "myapp:api:main", "key": "hot", "strength": 0.8}'`,
    requestBody: `{
  "table": "services",
  "id": "myapp:api:main",
  "key": "hot",
  "strength": 0.8
}`,
    responseBody: `{
  "success": true,
  "table": "services",
  "id": "myapp:api:main",
  "key": "hot",
  "strength": 0.8,
  "pheromones": { "hot": 0.8 }
}`,
  },
  {
    group: 'Pheromone',
    method: 'GET',
    path: '/pheromone/:table/:id',
    description: 'Read pheromone values for an entity. Applies read-time decay automatically.',
    curl: `$ curl "${BASE}/pheromone/services/myapp:api:main"`,
    responseBody: `{
  "success": true,
  "table": "services",
  "id": "myapp:api:main",
  "pheromones": { "hot": 0.65, "busy": 0.2 }
}`,
  },
  {
    group: 'Pheromone',
    method: 'GET',
    path: '/pheromone',
    description: 'List all non-zero pheromones across all tracked entities.',
  },
  {
    group: 'Pheromone',
    method: 'GET',
    path: '/pheromone/files',
    description: 'File heat map from session file claims. Shows which files are most active.',
    curl: `$ curl "${BASE}/pheromone/files?path=src/&depth=3"`,
    responseBody: `{
  "success": true,
  "files": [
    { "path": "src/auth.ts", "heat": 0.95, "activeClaims": 2, "conflict": true, ... }
  ],
  "directories": [
    { "path": "src/", "heat": 0.95, "fileCount": 5, "conflictCount": 1 }
  ],
  "summary": {
    "totalFiles": 12,
    "activeConflicts": 1,
    "hottestFile": "src/auth.ts",
    "hottestDir": "src/"
  }
}`,
  },

  // ── System ──────────────────────────────────────────────────
  {
    group: 'System',
    method: 'GET',
    path: '/ping',
    description: 'Liveness check. Returns "pong".',
    curl: `$ curl ${BASE}/ping`,
    responseBody: `"pong"`,
  },
  {
    group: 'System',
    method: 'GET',
    path: '/status',
    description: 'Combined health, metrics, and process info.',
    responseBody: `{
  "status": "running",
  "uptime": 86400,
  "version": "3.13.0",
  "codeHash": "a1b2c3d4",
  "services": 5,
  "agents": 3,
  "sessions": 2,
  "locks": 1
}`,
  },
  {
    group: 'System',
    method: 'GET',
    path: '/health',
    description: 'Daemon health check. Returns database connectivity and resource usage.',
  },
  {
    group: 'System',
    method: 'GET',
    path: '/metrics',
    description: 'Daemon metrics: total assignments, releases, errors, uptime.',
  },
  {
    group: 'System',
    method: 'GET',
    path: '/version',
    description: 'Version string and source code hash.',
    curl: `$ curl ${BASE}/version`,
    responseBody: `{
  "version": "3.13.0",
  "codeHash": "a1b2c3d4"
}`,
  },
  {
    group: 'System',
    method: 'GET',
    path: '/config',
    description: 'Resolved daemon configuration (port ranges, TTLs, limits).',
  },
  {
    group: 'System',
    method: 'GET',
    path: '/launch-hints',
    description: 'Context-aware startup hints for agents. Includes uncharted waters detection.',
  },
  {
    group: 'System',
    method: 'GET',
    path: '/ports/active',
    description: 'List all currently active port assignments.',
  },
  {
    group: 'System',
    method: 'GET',
    path: '/ports/system',
    description: 'List well-known system ports (22, 80, 443, etc.).',
  },
  {
    group: 'System',
    method: 'POST',
    path: '/ports/cleanup',
    description: 'Release stale port assignments.',
  },
  {
    group: 'System',
    method: 'GET',
    path: '/dashboard/events',
    description: 'SSE stream for real-time dashboard updates.',
  },
]

/* ── Expandable endpoint card ──────────────────────────────── */

function EndpointCard({ endpoint }: { endpoint: Endpoint }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = endpoint.curl || endpoint.requestBody || endpoint.responseBody

  return (
    <Surface depth="raised" radius="xl" padding="sm" className="transition-colors">
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`w-full text-left ${hasDetails ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-start gap-3">
          <MethodBadge method={endpoint.method} />
          <div className="flex-1 min-w-0">
            <code
              className="text-sm font-mono break-all"
              style={{ color: 'var(--text-primary)' }}
            >
              {endpoint.path}
            </code>
            <p
              className="text-sm mt-1 leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              {endpoint.description}
            </p>
          </div>
          {hasDetails && (
            <ChevronDown
              size={16}
              className="shrink-0 mt-1 transition-transform"
              style={{
                color: 'var(--text-muted)',
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              }}
            />
          )}
        </div>
      </button>

      {expanded && hasDetails && (
        <div className="mt-4 space-y-4 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {endpoint.curl && (
            <div>
              <div
                className="text-[length:var(--type-meta-size)] font-semibold uppercase tracking-wide mb-2"
                style={{ color: 'var(--text-muted)' }}
              >
                Example
              </div>
              <CodeBlock language="bash">{endpoint.curl}</CodeBlock>
            </div>
          )}
          {endpoint.requestBody && (
            <div>
              <div
                className="text-[length:var(--type-meta-size)] font-semibold uppercase tracking-wide mb-2"
                style={{ color: 'var(--text-muted)' }}
              >
                Request Body
              </div>
              <CodeBlock language="json">{endpoint.requestBody}</CodeBlock>
            </div>
          )}
          {endpoint.responseBody && (
            <div>
              <div
                className="text-[length:var(--type-meta-size)] font-semibold uppercase tracking-wide mb-2"
                style={{ color: 'var(--text-muted)' }}
              >
                Response
              </div>
              <CodeBlock language="json">{endpoint.responseBody}</CodeBlock>
            </div>
          )}
        </div>
      )}
    </Surface>
  )
}

/* ── Main page ─────────────────────────────────────────────── */

export default function ApiReference() {
  const [search, setSearch] = useState('')
  const [activeGroup, setActiveGroup] = useState<string | null>(null)

  const filtered = ENDPOINTS.filter((ep) => {
    const matchesSearch =
      !search ||
      ep.path.toLowerCase().includes(search.toLowerCase()) ||
      ep.description.toLowerCase().includes(search.toLowerCase()) ||
      ep.method.toLowerCase().includes(search.toLowerCase())
    const matchesGroup = !activeGroup || ep.group === activeGroup
    return matchesSearch && matchesGroup
  })

  // Group endpoints for rendering
  const groupedEndpoints = API_GROUPS.filter((g) =>
    !activeGroup || g === activeGroup
  ).map((group) => ({
    name: group,
    endpoints: filtered.filter((ep) => ep.group === group),
  })).filter((g) => g.endpoints.length > 0)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-4">
        <Badge variant="teal">REST API</Badge>
        <h1
          className="text-4xl font-semibold tracking-tight"
          style={{ color: 'var(--text-primary)' }}
        >
          API Reference
        </h1>
        <p
          className="text-xl leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          The full HTTP API for the Port Daddy background service running on a{' '}
          <code style={{ color: 'var(--brand-primary)' }}>published local endpoint</code>.
          Every endpoint is available without authentication on the local machine.
        </p>
        <p
          className="text-sm p-3 rounded-lg max-w-xl"
          style={{
            color: 'var(--text-muted)',
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          For CLI wrappers see the{' '}
          <a href="/docs/cli" style={{ color: 'var(--brand-primary)' }} className="hover:underline">
            CLI Reference
          </a>
          , for programmatic TypeScript access see the{' '}
          <a href="/docs/sdk" style={{ color: 'var(--brand-primary)' }} className="hover:underline">
            SDK
          </a>
          , or for LLM tool calls see the{' '}
          <a href="/docs/mcp" style={{ color: 'var(--brand-primary)' }} className="hover:underline">
            MCP Reference
          </a>
          .
        </p>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            type="text"
            placeholder="Search endpoints..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg focus:outline-none"
            style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveGroup(null)}
            className="px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            style={
              activeGroup === null
                ? { background: 'var(--brand-primary)', color: 'var(--text-inverse)' }
                : {
                    background: 'var(--surface-raised)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }
            }
          >
            All ({ENDPOINTS.length})
          </button>
          {API_GROUPS.map((group) => {
            const count = ENDPOINTS.filter((e) => e.group === group).length
            return (
              <button
                key={group}
                onClick={() => setActiveGroup(group)}
                className="px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                style={
                  activeGroup === group
                    ? { background: 'var(--brand-primary)', color: 'var(--text-inverse)' }
                    : {
                        background: 'var(--surface-raised)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-subtle)',
                      }
                }
              >
                {group} ({count})
              </button>
            )
          })}
        </div>
      </div>

      {/* Count */}
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Showing {filtered.length} of {ENDPOINTS.length} endpoints
      </p>

      {/* Grouped Endpoints */}
      {groupedEndpoints.map((group) => (
        <div key={group.name} className="space-y-3">
          <div className="flex items-center gap-3">
            <Badge variant="default" size="lg">
              {group.name}
            </Badge>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {group.endpoints.length} endpoint{group.endpoints.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-2">
            {group.endpoints.map((ep, i) => (
              <EndpointCard key={`${ep.method}-${ep.path}-${i}`} endpoint={ep} />
            ))}
          </div>
        </div>
      ))}

      {/* Empty state */}
      {filtered.length === 0 && (
        <Surface depth="flat" radius="xl" padding="lg">
          <p className="text-center" style={{ color: 'var(--text-muted)' }}>
            No endpoints match your search. Try a different term or clear the filter.
          </p>
        </Surface>
      )}

      {/* Quick Reference */}
      <Surface depth="raised" radius="xl" padding="md">
        <h3
          className="font-semibold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Base URL &amp; Conventions
        </h3>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <code style={{ color: 'var(--brand-primary)' }}>PD_URL</code>
            <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
              Published local endpoint for all examples
            </p>
          </div>
          <div>
            <code style={{ color: 'var(--brand-primary)' }}>Content-Type: application/json</code>
            <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
              Required for POST/PUT/DELETE with body
            </p>
          </div>
          <div>
            <code style={{ color: 'var(--brand-primary)' }}>X-Agent-Id: agent-1</code>
            <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
              Optional header to associate requests with an agent
            </p>
          </div>
          <div>
            <code style={{ color: 'var(--brand-primary)' }}>project:stack:context</code>
            <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
              Semantic identity format (e.g., myapp:api:main)
            </p>
          </div>
        </div>
      </Surface>

      {/* Rate Limits */}
      <Surface depth="raised" radius="xl" padding="md">
        <h3
          className="font-semibold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Rate Limits
        </h3>
        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="font-mono font-semibold" style={{ color: 'var(--brand-secondary)' }}>
              100 req/min
            </span>
            <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
              HTTP requests per IP
            </p>
          </div>
          <div>
            <span className="font-mono font-semibold" style={{ color: 'var(--brand-secondary)' }}>
              10 concurrent
            </span>
            <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
              SSE connections per IP
            </p>
          </div>
          <div>
            <span className="font-mono font-semibold" style={{ color: 'var(--brand-secondary)' }}>
              5 min
            </span>
            <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
              SSE connection timeout
            </p>
          </div>
        </div>
      </Surface>
    </div>
  )
}
