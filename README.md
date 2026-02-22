# Port Daddy ⚓

<p align="center">
  <img src="https://raw.githubusercontent.com/curiositech/port-daddy/main/assets/port_daddy_cover_art.webp" alt="Port Daddy" width="600">
</p>

<p align="center">
  <strong>Your ports. My rules. Zero conflicts.</strong>
</p>

<p align="center">
  <a href="https://npmjs.com/package/port-daddy"><img src="https://img.shields.io/npm/v/port-daddy.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/port-daddy.svg" alt="license"></a>
  <a href="https://github.com/curiositech/port-daddy"><img src="https://img.shields.io/badge/tests-1169%20passing-brightgreen" alt="tests"></a>
  <a href="package.json"><img src="https://img.shields.io/node/v/port-daddy.svg" alt="node"></a>
  <a href="https://github.com/curiositech/port-daddy/tree/main/skills/port-daddy-cli"><img src="https://img.shields.io/badge/AI%20Agents-40%2B%20compatible-blueviolet" alt="AI Agent Skill"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey" alt="platform"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#javascript-sdk">SDK</a> •
  <a href="#api-reference">API</a> •
  <a href="#credits">Credits</a>
</p>

---

Claim a port. Start your stack. Coordinate your agents. Port Daddy remembers.

```bash
port-daddy claim myapp:frontend    # → port 3100 (same port, every time)
port-daddy claim myapp:api         # → port 3101
port-daddy up                      # Start everything, auto-detected

port-daddy pub build:api '{"status":"ready"}'   # Agent A signals completion
port-daddy sub build:*                          # Agent B listens
port-daddy lock db-migrations                   # Mutual exclusion across agents
```

Port Daddy is the coordination layer for multi-agent development. It runs as a lightweight daemon on `localhost:9876` and gives every service a stable port, starts your whole stack with one command, brokers messages between agents, manages distributed locks, and tracks agent lifecycles — all backed by SQLite for atomic operations and zero race conditions.

**Port management** — [claim/release](#quick-start), [persistent assignment](#semantic-identities), [service orchestration](#service-orchestration), [60+ framework auto-detection](#auto-detection-port-daddy-scan)
**Agent coordination** — [pub/sub messaging](#pubsub-messaging), [distributed locks](#distributed-locks), [agent registry](#agent-registry), [webhooks](#webhooks), [web dashboard](#dashboard)
**Works with your agent** — Ships as a [Vercel Agent Skill](#ai-agent-skill) compatible with Claude Code, Cursor, Windsurf, Cline, Aider, Codex CLI, and [40+ more](https://github.com/vercel-labs/skills#compatible-agents)

---

**Jump to:** [Quick Start](#quick-start) | [Orchestration](#service-orchestration) | [SDK](#javascript-sdk) | [CLI Reference](#cli-reference) | [API Reference](#api-reference) | [Configuration](#configuration) | [Examples](#examples)

---

## The Problem

Every web developer knows "Something is already running on port 3000." Multiply that by microservices (5-10 local servers fighting over ports) and it's a daily friction.

Now add AI coding agents. Multiple autonomous sessions launch dev servers simultaneously, each unaware of the others. No human is watching to resolve collisions. Every port conflict wastes an agent cycle. And agents need more than ports — they need to signal each other when builds finish, take exclusive locks on shared resources like databases, and know which other agents are alive. There's no standard tool for any of this.

Existing tools solve pieces of this. Port Daddy solves the whole thing.

| | [get-port](https://npmjs.com/package/get-port) | [portfinder](https://npmjs.com/package/portfinder) | [kill-port](https://npmjs.com/package/kill-port) | **Port Daddy** |
|---|:---:|:---:|:---:|:---:|
| Find a free port | ✅ | ✅ | — | ✅ |
| Kill port processes | — | — | ✅ | ✅ |
| Persistent assignment (same project → same port) | — | — | — | ✅ |
| Named services (`myapp:api:main`) | — | — | — | ✅ |
| Service orchestration (`up`/`down`) | — | — | — | ✅ |
| Framework auto-detection (60+) | — | — | — | ✅ |
| Multi-process coordination | — | — | — | ✅ |
| Dashboard, webhooks, activity log | — | — | — | ✅ |
| Works as CLI and SDK | Library | Library | CLI | **CLI + SDK + HTTP** |

`get-port` and `portfinder` find a free port and hand it back. No persistence, no naming, no coordination. Next time you run your app, you get a different port. Port Daddy remembers.

---

## Quick Start

```bash
npm install -g port-daddy
port-daddy start
```

That's it. Verify your environment:

```bash
port-daddy doctor              # Checks daemon, ports, Node.js, config
```

Now claim ports:

```bash
port-daddy claim myapp:frontend
# → myapp:frontend → port 3100

port-daddy claim myapp:api
# → myapp:api → port 3101

# Use it with any dev server
PORT=$(port-daddy claim myproject -q) npm run dev -- --port $PORT

# Or use the shorthand alias with --export
eval $(port-daddy c myproject --export) && npm run dev -- --port $PORT
```

Ports persist — `myapp:frontend` always gets port 3100 on this machine, even across restarts.

### Try it in 60 seconds

```bash
npm install -g port-daddy && port-daddy start
port-daddy scan                              # Auto-detect your project
port-daddy up                                # Start everything
# Open http://localhost:9876 for the dashboard
port-daddy down                              # Stop everything
```

### Auto-start on login (optional)

```bash
port-daddy install   # macOS (LaunchAgent) or Linux (systemd)
```

### Scan your project (optional)

```bash
cd your-project/
port-daddy scan
# → Scanning /path/to/your-project...
# → Discovered 3 services:
#     api         Express    :3000
#     web         Next.js    :3001
#     worker      Workers    :8787
# → Saved .portdaddyrc
# → Next: port-daddy up
```

Port Daddy deep-scans your project recursively, detecting 60+ frameworks (Next.js, Vite, Express, FastAPI, Django, Go, Rust, Cloudflare Workers, Docker, and more). It handles monorepos, npm workspaces, and nested services automatically. See [Auto-Detection](#auto-detection-port-daddy-scan) for the full list.

### Install from source

```bash
git clone https://github.com/curiositech/port-daddy.git
cd port-daddy && npm install
port-daddy start
```

---

## Service Orchestration

Start your entire stack with a single command. Port Daddy reads your `.portdaddyrc` (or auto-detects your framework), resolves service dependencies via topological sort, claims ports, injects environment variables, and streams color-coded logs -- like `docker-compose up` for local development.

```bash
# Start everything defined in .portdaddyrc (or auto-detected)
port-daddy up

# Start one service and its dependencies
port-daddy up --service frontend

# Use git branch in the semantic identity (e.g., myapp:api:feature-auth)
port-daddy up --branch

# Skip health checks for faster startup
port-daddy up --no-health

# Graceful shutdown of all services started by `up`
port-daddy down
```

### How `up` works

1. **Detect** -- reads `.portdaddyrc`, or auto-discovers services via framework detection
2. **Sort** -- topological sort on `needs` graph (cycles are caught with a clear error)
3. **Claim** -- requests ports from the daemon atomically
4. **Inject** -- sets `PORT`, `PORT_<SERVICE>`, and any custom `env` vars per service
5. **Spawn** -- launches each service's `cmd` with colored, prefixed log output
6. **Health check** -- polls each service's `healthPath` (configurable timeout)
7. **Signal** -- Ctrl+C sends `SIGTERM` to all children in reverse dependency order

### Example `.portdaddyrc`

```json
{
  "project": "myapp",
  "services": {
    "api": {
      "cmd": "npm run dev:api",
      "port": 3001,
      "healthPath": "/health",
      "env": { "DATABASE_URL": "postgresql://localhost:5432/myapp" }
    },
    "frontend": {
      "cmd": "npm run dev -- --port ${PORT}",
      "port": 3000,
      "healthPath": "/",
      "needs": ["api"]
    },
    "worker": {
      "cmd": "npm run worker",
      "needs": ["api"],
      "noPort": true
    }
  }
}
```

### Environment diagnostics

```bash
# Check your environment for common issues
port-daddy doctor
```

`doctor` verifies: daemon connectivity, port range availability, `.portdaddyrc` validity, Node.js version, and system port conflicts.

---

## Semantic Identities

Port Daddy uses a `project:stack:context` naming scheme that makes your services discoverable:

```
myapp                     # Just the project
myapp:api                 # Project + stack
myapp:api:feature-auth    # Project + stack + context
```

| Part | Purpose | Examples |
|------|---------|----------|
| **project** | Your application | `myapp`, `acme-api`, `todo` |
| **stack** | Component type | `api`, `frontend`, `worker`, `db` |
| **context** | Branch or variant | `main`, `feature-x`, `pr-123`, `staging` |

This unlocks powerful queries:

```bash
# All services for myapp
port-daddy find myapp:*

# All API services across all projects
port-daddy find *:api:*

# Release everything for a feature branch
port-daddy release myapp:*:feature-auth
```

---

## Agent Coordination

Port Daddy includes built-in primitives for multi-process and multi-agent coordination. No external message broker or lock service required.

### Pub/Sub Messaging

Agents and processes publish events and subscribe to channels:

```bash
# Agent A finishes the API
port-daddy pub build:api '{"status":"ready","port":3100}'

# Agent B finishes the frontend
port-daddy pub build:frontend '{"status":"ready","port":3101}'

# Agent C subscribes and waits
port-daddy sub build:*
# [2025-01-15T10:30:00Z] {"status":"ready","port":3100}
# [2025-01-15T10:30:05Z] {"status":"ready","port":3101}
# Now C knows both services are ready for integration tests
```

### Distributed Locks

Prevent conflicting operations across agents and processes:

```bash
# Agent A: Exclusive access to database migrations
port-daddy lock db-migrations
npx prisma migrate dev
port-daddy unlock db-migrations

# Agent B: Waits or fails immediately if lock is held
port-daddy lock db-migrations || echo "Lock held, skipping"
```

### Channel Patterns

| Pattern | Purpose |
|---------|---------|
| `build:<target>` | Build completion events |
| `service:<id>:ready` | Service readiness signals |
| `task:<name>` | Task handoff between agents |
| `errors` | Error broadcasting |
| `heartbeat:<agent>` | Agent health monitoring |

---

## Agent Registry

Agents can formally register with Port Daddy for lifecycle tracking and resource management:

```bash
# Register an agent
port-daddy agent register --agent builder-1 --type cli

# Send heartbeats (keeps agent marked as active)
port-daddy agent heartbeat --agent builder-1

# See all active agents
port-daddy agents

# Check a specific agent
port-daddy agent builder-1
```

### Resource Limits

Each agent can have resource limits enforced:

```json
{
  "maxServices": 50,
  "maxLocks": 20
}
```

When an agent exceeds its limits, further claims and locks are rejected until resources are released.

### Auto-Cleanup

Agents that stop sending heartbeats for 2+ minutes are marked stale. Their services and locks are automatically released, preventing resource leakage from crashed processes.

---

## JavaScript SDK

Port Daddy ships with a built-in client SDK. No REST boilerplate required.

```bash
npm install port-daddy
```

```javascript
import { PortDaddy } from 'port-daddy/client';

const pd = new PortDaddy();

// Claim a port
const { port } = await pd.claim('myapp:api');
console.log(`API running on port ${port}`);

// Release when done
await pd.release('myapp:api');
```

### Services

```javascript
// Request a specific port
const { port } = await pd.claim('myapp:frontend', { port: 3000 });

// Find services by pattern
const { services } = await pd.listServices({ pattern: 'myapp:*' });

// Set endpoint URLs for service discovery
await pd.setEndpoint('myapp:api', 'local', `http://localhost:${port}`);
await pd.setEndpoint('myapp:api', 'prod', 'https://api.myapp.com');

// Release everything for a project
await pd.release('myapp:*');
```

### Pub/Sub Messaging

```javascript
// Publish
await pd.publish('builds', { status: 'complete', artifact: 'dist.tar.gz' });

// Read messages
const { messages } = await pd.getMessages('builds', { limit: 10 });

// Subscribe to real-time updates
const sub = pd.subscribe('deployments');
sub.on('message', (data) => console.log('Deploy event:', data));

// Long-poll for next message
const { message } = await pd.poll('builds');
```

### Distributed Locks

```javascript
// Manual lock/unlock
await pd.lock('db-migrations');
try {
  await runMigrations();
} finally {
  await pd.unlock('db-migrations');
}

// Or use the convenience wrapper
await pd.withLock('deploy-prod', async () => {
  await deployToProduction();
});
```

### Agent Lifecycle

```javascript
const pd = new PortDaddy({ agentId: 'build-agent-1' });

// Register and start heartbeats
await pd.register({ name: 'Build Agent', type: 'ci' });
const hb = pd.startHeartbeat(30000); // Every 30s

// ... do work ...

// Cleanup
hb.stop();
await pd.unregister();
```

### Configuration

```javascript
const pd = new PortDaddy({
  url: 'http://localhost:9876',   // Daemon URL (or set PORT_DADDY_URL env)
  agentId: 'my-agent',           // Agent ID for tracking (or PORT_DADDY_AGENT env)
  pid: process.pid,              // Process ID for ownership
  timeout: 5000,                 // Request timeout in ms
});
```

### Projects

```javascript
// Deep-scan a directory for frameworks
const result = await pd.scan('/path/to/project', { save: true });
console.log(result.frameworks); // ['react', 'express', ...]

// List all registered projects
const { projects } = await pd.listProjects();

// Get project details
const project = await pd.getProject('myproject');

// Remove a project
await pd.deleteProject('myproject');
```

### Webhooks (SDK)

```javascript
// Register a webhook
const { id } = await pd.addWebhook('https://example.com/hook', {
  events: ['claim', 'release'],
  secret: 'my-secret',
});

// List webhooks
const { webhooks } = await pd.listWebhooks();

// Get, update, test, remove
const hook = await pd.getWebhook(id);
await pd.updateWebhook(id, { events: ['claim'], active: false });
await pd.testWebhook(id);
await pd.removeWebhook(id);

// List available events and delivery history
const { events } = await pd.getWebhookEvents();
const deliveries = await pd.getWebhookDeliveries(id);
```

### System & Monitoring

```javascript
// Health, version, metrics
const health = await pd.health();
const ver = await pd.version();
const stats = await pd.metrics();

// Resolved configuration (optionally for a specific directory)
const config = await pd.getConfig('/path/to/project');

// Quick connectivity check
const alive = await pd.ping(); // true | false

// Service health
const allHealth = await pd.listServiceHealth();
const svcHealth = await pd.checkServiceHealth('myapp:api');
```

### Activity & Ports

```javascript
// Activity log
const { activity } = await pd.getActivity({ limit: 50, type: 'claim' });

// Time-range query
const range = await pd.getActivityRange('2025-01-01T00:00:00Z', '2025-01-31T23:59:59Z');

// Summary and stats
const summary = await pd.getActivitySummary('1h'); // since 1 hour ago
const activityStats = await pd.getActivityStats();

// Port management
const activePorts = await pd.listActivePorts();
const systemPorts = await pd.getSystemPorts();
const cleaned = await pd.cleanup(); // remove expired
```

### Extended Lock Operations

```javascript
// Check if a lock exists without acquiring
const lockInfo = await pd.checkLock('db-migrations');

// Extend a lock's TTL
await pd.extendLock('db-migrations', { ttl: 120 });

// Clear a pub/sub channel
await pd.clearChannel('builds');
```

### Error Handling

```javascript
import { PortDaddy, PortDaddyError, ConnectionError } from 'port-daddy/client';

try {
  await pd.claim('myapp:api');
} catch (err) {
  if (err instanceof ConnectionError) {
    console.error('Daemon not running. Start with: port-daddy start');
  } else if (err instanceof PortDaddyError) {
    console.error(`API error (${err.status}): ${err.message}`);
  }
}
```

---

## Webhooks

External systems can subscribe to Port Daddy events via webhooks:

```bash
# Register a webhook
curl -X POST http://localhost:9876/webhooks \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://your-server.com/port-daddy-events",
    "events": ["service.claim", "service.release"],
    "secret": "your-hmac-secret"
  }'
```

### Supported Events

| Event | Payload |
|-------|---------|
| `service.claim` | Service was claimed |
| `service.release` | Service was released |
| `agent.register` | Agent registered |
| `agent.unregister` | Agent unregistered |
| `agent.stale` | Agent went stale |
| `lock.acquire` | Lock was acquired |
| `lock.release` | Lock was released |
| `message.publish` | Message was published |
| `daemon.start` | Daemon started |
| `daemon.stop` | Daemon stopping |

### Payload Verification

Each delivery includes an HMAC-SHA256 signature for verification:

```
X-PortDaddy-Signature: sha256=abc123...
X-PortDaddy-Event: service.claim
X-PortDaddy-Delivery: uuid
X-PortDaddy-Timestamp: 1704000000000
```

Verify in your handler:

```javascript
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  const expected = `sha256=${hmac.digest('hex')}`;
  return signature === expected;
}
```

### Retry & Reliability

- **Automatic retries**: Failed deliveries retry with exponential backoff (1s, 2s, 4s, 8s)
- **Delivery tracking**: View delivery history for any webhook
- **Test endpoint**: Send test payloads to verify webhook setup

---

## Activity Log

Every operation in Port Daddy is logged with full context:

```bash
# View recent activity
port-daddy log

# Or query the API directly
curl http://localhost:9876/activity?limit=20

# Filter by action type
curl http://localhost:9876/activity?action=claim

# Filter by identity
curl http://localhost:9876/activity?targetId=myapp:api
```

### Logged Actions

| Action | Description |
|--------|-------------|
| `claim` | Service port claimed |
| `release` | Service port released |
| `lock_acquire` | Lock acquired |
| `lock_release` | Lock released |
| `publish` | Message published |
| `agent_register` | Agent registered |
| `agent_heartbeat` | Agent heartbeat |
| `agent_unregister` | Agent unregistered |
| `cleanup` | Automatic cleanup |

Each log entry includes:
- Timestamp
- Action type
- Target (service ID, lock name, etc.)
- Actor (agent ID or IP address)
- Metadata (port, message, etc.)

---

## Dashboard

Port Daddy includes a web dashboard at `http://localhost:9876`:

- **Services**: View all claimed ports, release services
- **Locks**: See active locks and their holders
- **Agents**: Monitor registered agents and their health
- **Messages**: Browse pub/sub channels and messages
- **Webhooks**: Manage webhook subscriptions
- **Activity**: Real-time activity log

---

## AI Agent Skill

Port Daddy ships as an [agent skill](https://github.com/curiositech/port-daddy/tree/main/skills/port-daddy-cli) in the [Vercel Labs Agent Skills](https://github.com/vercel-labs/skills) format, compatible with 40+ AI coding agents.

### Install the Skill

```bash
# Claude Code (via npx)
npx skills add curiositech/port-daddy

# Or add directly to your project's .claude/settings.json
```

### What the Skill Provides

When an AI agent has the Port Daddy skill installed, it knows how to:

- **Claim ports** using semantic identities instead of hardcoded numbers
- **Coordinate with other agents** via pub/sub and distributed locks
- **Generate `.portdaddyrc`** configs with `port-daddy scan`
- **Use the SDK** instead of raw HTTP calls
- **Avoid common mistakes** like manual port numbers, flat service names, and polling

The skill includes reference docs for the full [HTTP API](skills/port-daddy-cli/references/api-reference.md), [SDK](skills/port-daddy-cli/references/sdk-reference.md), [.portdaddyrc spec](skills/port-daddy-cli/references/portdaddyrc-spec.md), and [multi-agent coordination patterns](skills/port-daddy-cli/references/multi-agent-patterns.md) -- loaded on-demand, not all at once.

### Compatible Agents

Claude Code, Cursor, Windsurf, Cline, Aider, Continue, Codex CLI, and [many more](https://github.com/vercel-labs/skills#compatible-agents).

---

## CLI Reference

### Service Commands

| Command | Description |
|---------|-------------|
| `port-daddy claim <id>` (alias: `c`) | Claim a port for a service |
| `port-daddy release <id>` (alias: `r`) | Release port(s) by identity or pattern |
| `port-daddy find [pattern]` (alias: `f`) | List services (default: all) |
| `port-daddy url <id>` | Get the URL for a service |
| `port-daddy env [pattern]` | Export as environment variables |
| `port-daddy ps` (alias: `l`) | Alias for `find` |

### Orchestration

| Command | Description |
|---------|-------------|
| `port-daddy up` | Start all services (from `.portdaddyrc` or auto-detected) |
| `port-daddy up --service <name>` | Start one service and its dependencies |
| `port-daddy up --branch` | Include git branch in semantic identity |
| `port-daddy up --no-health` | Skip health checks |
| `port-daddy down` | Graceful shutdown of all running services |

### Agent Coordination

| Command | Description |
|---------|-------------|
| `port-daddy pub <channel> <msg>` | Publish a message |
| `port-daddy sub <channel>` | Subscribe to a channel (real-time) |
| `port-daddy wait <id> [...]` | Wait for service(s) to become healthy |
| `port-daddy lock <name>` | Acquire a distributed lock |
| `port-daddy lock extend <name>` | Extend a lock's TTL |
| `port-daddy unlock <name>` | Release a lock |
| `port-daddy locks` | List all active locks |
| `port-daddy channels` | List pub/sub channels |
| `port-daddy channels clear <ch>` | Clear messages from a channel |
| `port-daddy log` | View activity log |
| `port-daddy log --from/--to` | View activity in a time range |

### Agent Registry

| Command | Description |
|---------|-------------|
| `port-daddy agent register` | Register as an agent |
| `port-daddy agent heartbeat` | Send heartbeat |
| `port-daddy agent unregister` | Unregister agent |
| `port-daddy agent <id>` | Get info about an agent |
| `port-daddy agents` | List all registered agents |

### Project Setup

| Command | Description |
|---------|-------------|
| `port-daddy scan` (alias: `s`) | Deep-scan project, generate `.portdaddyrc`, register with daemon |
| `port-daddy scan --dry-run` | Preview scan results without saving |
| `port-daddy projects` (alias: `p`) | List all registered projects |
| `port-daddy projects rm <name>` | Remove a registered project |
| `port-daddy doctor` | Run environment diagnostics |

### System & Monitoring

| Command | Description |
|---------|-------------|
| `port-daddy dashboard` | Open web dashboard in browser |
| `port-daddy webhook list` | List all webhooks |
| `port-daddy webhook events` | List available webhook events |
| `port-daddy webhook test <id>` | Send test delivery to a webhook |
| `port-daddy webhook update <id>` | Update a webhook |
| `port-daddy webhook rm <id>` | Delete a webhook |
| `port-daddy webhook deliveries <id>` | List webhook deliveries |
| `port-daddy metrics` | Show daemon metrics |
| `port-daddy config` | Show resolved configuration |
| `port-daddy health [id]` | Check service health (all or by ID) |
| `port-daddy ports` | List active port assignments |
| `port-daddy ports cleanup` | Release stale port assignments |
| `port-daddy ports --system` | Show system/well-known ports |

### Daemon Management

| Command | Description |
|---------|-------------|
| `port-daddy start` | Start the daemon |
| `port-daddy stop` | Stop the daemon |
| `port-daddy restart` | Restart the daemon |
| `port-daddy status` | Check if daemon is running |
| `port-daddy install` | Install as system service |
| `port-daddy uninstall` | Remove system service |

### Options

| Option | Description |
|--------|-------------|
| `-p, --port <n>` | Request a specific port |
| `--range <a>-<b>` | Acceptable port range |
| `--expires <dur>` | Auto-release (e.g., `2h`, `30m`, `1d`) |
| `-e, --env <name>` | Environment: local, tunnel, dev, staging, prod |
| `-j, --json` | Output as JSON |
| `-q, --quiet` | Minimal output (just the value) |
| `--timeout <ms>` | Wait timeout (default: 60000) |
| `--ttl <ms>` | Lock time-to-live (default: 300000) |
| `--owner <id>` | Lock owner identifier |
| `--agent <id>` | Agent ID for registration/heartbeat |
| `--type <type>` | Agent type (cli, sdk, mcp) |
| `--export` | Print `export PORT=N` for shell eval (claim only) |
| `--from <ts>` | Start of time range (log, ISO or epoch) |
| `--to <ts>` | End of time range (log, ISO or epoch) |
| `--system` | Show system/well-known ports (ports command) |

### Shell Completions

Tab completion for all commands, subcommands, and flags. Dynamic completions pull live service IDs, lock names, channels, and agent IDs from the running daemon.

**Bash:**

```bash
# Add to ~/.bashrc
source /path/to/port-daddy/completions/port-daddy.bash
```

**Zsh:**

```bash
# Copy to fpath (before compinit in ~/.zshrc)
mkdir -p ~/.zsh/completions
cp /path/to/port-daddy/completions/port-daddy.zsh ~/.zsh/completions/_port-daddy
fpath=(~/.zsh/completions $fpath)
autoload -Uz compinit && compinit
```

**Fish:**

```bash
# Copy to fish completions
cp /path/to/port-daddy/completions/port-daddy.fish ~/.config/fish/completions/
```

---

## API Reference

### Health & Status

```
GET /health          # Health check (for monitoring)
GET /version         # Version and code hash
```

### Services

```
POST   /claim/:id         # Claim a port
DELETE /release/:id       # Release a service
GET    /services          # List all services
GET    /services/:id      # Get service details
```

### Locks

```
POST   /locks/:name       # Acquire a lock
PUT    /locks/:name       # Extend lock TTL
DELETE /locks/:name       # Release a lock
GET    /locks             # List all locks
GET    /locks/:name       # Get lock details
```

### Messages

```
POST   /msg/:channel      # Publish a message
GET    /msg/:channel      # Get channel messages
GET    /subscribe/:channel # SSE subscription
DELETE /msg/:channel      # Clear channel
GET    /channels          # List all channels
```

### Agents

```
POST   /agents/:id        # Register agent
PUT    /agents/:id/heartbeat # Send heartbeat
DELETE /agents/:id        # Unregister agent
GET    /agents            # List all agents
GET    /agents/:id        # Get agent details
```

### Projects

```
POST   /scan             # Deep-scan a directory and register project
GET    /projects         # List all registered projects
GET    /projects/:id     # Get project details
DELETE /projects/:id     # Remove a project
```

### Webhooks

```
POST   /webhooks          # Register webhook
GET    /webhooks          # List webhooks
GET    /webhooks/:id      # Get webhook details
PUT    /webhooks/:id      # Update webhook
DELETE /webhooks/:id      # Delete webhook
POST   /webhooks/:id/test # Send test payload
GET    /webhooks/:id/deliveries # Delivery history
GET    /webhooks/events   # List available events
```

### Activity

```
GET    /activity          # Activity log (?limit=N&type=claim&agent=ID)
GET    /activity/range    # Time-range query (?from=ISO&to=ISO)
GET    /activity/summary  # Summary (?since=1h)
GET    /activity/stats    # Aggregate statistics
```

### System

```
GET    /metrics           # Daemon metrics (uptime, counts, memory)
GET    /config            # Resolved configuration (?dir=/path)
GET    /ports/active      # List active port assignments
GET    /ports/system      # List system ports in use
POST   /ports/cleanup     # Remove expired port assignments
GET    /services/health   # Health of all services
GET    /services/health/:id # Health of a specific service
```

---

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────┐
│           Your Development Environment           │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐         │
│  │ Agent 1 │  │ Agent 2 │  │ Agent 3 │         │
│  └────┬────┘  └────┬────┘  └────┬────┘         │
│       │            │            │               │
│       └────────────┼────────────┘               │
│                    │                            │
│                    ▼                            │
│           ┌───────────────┐                    │
│           │  Port Daddy   │◄─── Webhooks       │
│           │   Daemon      │     to external    │
│           │ (port 9876)   │     systems        │
│           └───────┬───────┘                    │
│                   │                            │
│     ┌─────────────┼─────────────┐              │
│     │      │      │      │      │              │
│     ▼      ▼      ▼      ▼      ▼              │
│  ┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐          │
│  │Ports││Locks││ Pub ││Agent││Activ│          │
│  │     ││     ││ Sub ││ Reg ││ Log │          │
│  └─────┘└─────┘└─────┘└─────┘└─────┘          │
│                                                 │
│     All backed by SQLite (atomic, persistent)  │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Database

Port Daddy uses SQLite for atomic operations:

- No race conditions between concurrent claims
- Survives daemon restarts
- Automatic cleanup of dead processes
- Pattern-based queries via SQL LIKE

### Security Features

- **SSRF Protection**: Webhook URLs cannot target private/internal addresses
- **Rate Limiting**: Connection limits prevent abuse
- **Input Validation**: All inputs validated and sanitized
- **HMAC Signing**: Webhook payloads signed for verification

---

## Configuration

### Project Config (`.portdaddyrc`)

Define your project's services, port ranges, and startup commands in a `.portdaddyrc` file at your project root:

```json
{
  "project": "myapp",
  "portRange": [3000, 3099],
  "services": {
    "frontend": {
      "cmd": "npm run dev -- --port ${PORT}",
      "port": 3000,
      "healthPath": "/",
      "needs": ["api"]
    },
    "api": {
      "cmd": "npm run dev:api",
      "port": 3001,
      "healthPath": "/health",
      "env": {
        "DATABASE_URL": "postgresql://localhost:5432/myapp"
      }
    },
    "worker": {
      "cmd": "npm run worker",
      "needs": ["api"],
      "noPort": true
    }
  }
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `project` | string | Project name (used as service ID prefix) |
| `portRange` | `[min, max]` | Port range reserved for this project |
| `services.<name>.cmd` | string | Dev command (`${PORT}` is replaced with assigned port) |
| `services.<name>.port` | number | Preferred port (next available if taken) |
| `services.<name>.healthPath` | string | Health check path |
| `services.<name>.healthTimeout` | number | Health check timeout in ms (default: 30000) |
| `services.<name>.needs` | string[] | Services that must start first |
| `services.<name>.env` | object | Environment variables for the service |
| `services.<name>.cwd` | string | Working directory (relative to .portdaddyrc) |
| `services.<name>.noPort` | boolean | Service doesn't need a port (e.g., workers) |
| `services.<name>.metadata` | object | Arbitrary metadata |

Config files are searched up the directory tree. Valid names: `.portdaddyrc`, `.portdaddyrc.json`, `portdaddy.config.json`.

### Auto-Detection (`port-daddy scan`)

Port Daddy deep-scans your project and generates a config automatically:

```bash
# Preview what would be generated
port-daddy scan --dry-run

# Scan, save config, and register project
port-daddy scan
```

`scan` walks your directory tree recursively (max depth 5), detects services at every level, handles monorepos and npm workspaces, and registers the project with the daemon for dashboard visibility.

**Supported frameworks (60+):**

| Framework | Default Port | Detection |
|-----------|-------------|-----------|
| Next.js | 3000 | `next.config.*` |
| Nuxt | 3000 | `nuxt.config.*` |
| SvelteKit | 5173 | `svelte.config.js` |
| Remix | 3000 | `remix.config.js` |
| Astro | 4321 | `astro.config.*` |
| Vite | 5173 | `vite.config.*` |
| Angular | 4200 | `angular.json` |
| Create React App | 3000 | `react-scripts` dep |
| Vue CLI | 8080 | `vue.config.js` |
| Express | 3000 | `express` dep |
| Fastify | 3000 | `fastify` dep |
| Hono | 3000 | `hono` dep |
| NestJS | 3000 | `nest-cli.json` |
| http-server | 8080 | `http-server` dep |
| serve | 3000 | `serve` dep |
| FastAPI | 8000 | `requirements.txt` |
| Flask | 5000 | `requirements.txt` |
| Django | 8000 | `manage.py` |
| Cloudflare Workers | 8787 | `wrangler.toml`, `wrangler.json` |
| Docker | 3000 | `Dockerfile`, `compose.yml` |
| Go | 8080 | `go.mod` |
| Rust | 8080 | `Cargo.toml` |

### Daemon Config (`config.json`)

The daemon itself is configured via `config.json` in the Port Daddy installation directory:

```json
{
  "service": { "port": 9876, "host": "localhost" },
  "ports": {
    "range_start": 3100,
    "range_end": 9999,
    "reserved": [8080, 8000, 9876]
  },
  "cleanup": {
    "interval_ms": 300000,
    "stale_threshold_ms": 7200000
  },
  "logging": { "level": "info" },
  "security": {
    "rate_limit": { "window_ms": 60000, "max_requests": 100 }
  }
}
```

**Environment variable overrides:**

```bash
PORT_DADDY_PORT=9999           # Daemon port
PORT_DADDY_RANGE_START=4000    # Port range start
PORT_DADDY_RANGE_END=5000      # Port range end
PORT_DADDY_URL=http://host:9876  # SDK/CLI daemon URL
PORT_DADDY_AGENT=my-agent        # Default agent ID for SDK
```

---

## Examples

### Using with Dev Servers

```bash
# Next.js
PORT=$(port-daddy claim myproject:frontend -q) npm run dev -- --port $PORT

# Vite
PORT=$(port-daddy claim myproject -q) vite --port $PORT

# Express
PORT=$(port-daddy claim myproject:api -q) node server.js
```

### Multi-Agent Build Pipeline

```bash
# Agent A: Build API
port-daddy claim myproject:api
npm run build:api
port-daddy pub build:api '{"status":"complete","port":3100}'

# Agent B: Build Frontend
port-daddy claim myproject:frontend
npm run build:frontend
port-daddy pub build:frontend '{"status":"complete","port":3101}'

# Agent C: Integration Tests (waits for both)
port-daddy sub build:* --json | jq 'select(.status=="complete")' | head -2
npm run test:integration
```

### Bug Fix Handoff

```bash
# Agent A: Reports a bug
port-daddy pub bugs '{"file":"auth.ts","line":42,"desc":"null check missing"}'
port-daddy lock bug-fix-auth

# Agent B: Sees the bug, waits for lock
port-daddy sub bugs
port-daddy lock bug-fix-auth --wait  # Blocks until A releases

# Agent B: Fixes and releases
port-daddy pub bugs '{"file":"auth.ts","status":"fixed"}'
port-daddy unlock bug-fix-auth
```

### File Coordination

```bash
# Agent A: Claims files
port-daddy lock files:src-auth
port-daddy pub files '{"agent":"A","files":["src/auth/*"],"status":"editing"}'

# Agent B: Sees lock, works elsewhere
port-daddy locks --json | jq '.locks[] | select(.name | startswith("files:"))'
# → files:src-auth is locked by A
port-daddy lock files:src-api  # Work on different files

# Agent A: Done
port-daddy pub files '{"agent":"A","files":["src/auth/*"],"status":"done"}'
port-daddy unlock files:src-auth
```

---

## License

MIT -- Created by [Erich Owens](https://github.com/erichowens) at [Curiositech LLC](https://curiositech.ai)
