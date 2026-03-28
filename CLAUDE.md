# Port Daddy - Developer Context

## What Is This?

Port Daddy is the authoritative port manager for multi-agent development. It's a daemon running on `localhost:9876` that provides:

- **Atomic port assignment** — No race conditions
- **Sessions & Notes** — Structured multi-agent coordination with immutable audit trails
- **Agent coordination** — Pub/sub messaging and distributed locks
- **Agent registry** — Track active agents with heartbeats
- **Webhooks** — External system integration
- **Activity logging** — Full audit trail

## Architecture

```
server.ts           # Express daemon (main entry point)
lib/
  services.ts       # Port assignment module
  sessions.ts       # Sessions & Notes (agent coordination)
  locks.ts          # Distributed locks
  messaging.ts      # Pub/sub messaging
  agents.ts         # Agent registry with heartbeats
  activity.ts       # Activity logging
  webhooks.ts       # Webhook subscriptions
  identity.ts       # Semantic ID parsing (project:stack:context)
  detect.ts         # Framework detection (60+ frameworks)
  scan.ts           # Deep recursive project scanner
  projects.ts       # Project registry (CRUD against SQLite)
  discover.ts       # Monorepo/workspace discovery
  orchestrator.ts   # Service orchestration (up/down)
  config.ts         # Configuration loading
  health.ts         # Health check utilities
  client.ts         # JavaScript SDK (PortDaddy class)
  log-prefix.ts     # Color-coded log prefixes for orchestrator
  utils.ts          # Common utilities
  db.ts             # SQLite connection + schema helpers
  sugar.ts          # begin/done/whoami high-level operations
  dns.ts            # Local DNS records (.local hostnames)
  harbors.ts        # Harbor grouping for agent coordination
  harbor-tokens.ts  # JWT tokens for harbor membership
  resurrection.ts   # Salvage queue for dead agents
  spawner.ts        # AI agent spawning (ollama/claude/gemini/aider)
  watch.ts          # SSE subscriber with --exec + reconnect loop
  briefing.ts       # Project briefing generation and retrieval
  arbiter.ts        # Invariant enforcement / violation tracking
  changelog.ts      # Daemon-side changelog entries
  tunnel.ts         # Tunnel provider integration (ngrok, cloudflared)
  agent-inbox.ts    # Per-agent message inbox
  correlation.ts    # Request correlation IDs
  fleet-engine.ts   # Declarative fleet YAML agent runner
  note-encryption.ts # Encrypted session notes
  pheromone.ts      # Pheromone trail pub/sub signal system
  request.ts        # HTTP request helpers
  resolver.ts       # DNS resolver configuration
  worktree.ts       # Git worktree utilities
  barnacle-client.ts # Barnacle (external) client integration
  banner.ts         # Startup banner rendering
  maritime.ts       # Maritime-themed label helpers
routes/
  index.ts          # Route aggregator (registers all route modules)
  services.ts       # /claim, /release, /services, /wait endpoints
  sessions.ts       # /sessions, /notes, /files endpoints
  projects.ts       # /scan, /projects endpoints
  agents.ts         # /agents endpoints
  activity.ts       # /activity endpoints
  locks.ts          # /locks endpoints
  messaging.ts      # /msg, /channels endpoints
  webhooks.ts       # /webhooks endpoints
  dns.ts            # /dns endpoints
  harbors.ts        # /harbors endpoints
  resurrection.ts   # /salvage (+ /resurrection deprecated aliases)
  sugar.ts          # /sugar/begin, /sugar/done, /sugar/whoami
  spawn.ts          # /spawn endpoints
  briefing.ts       # /briefing endpoints
  changelog.ts      # /changelog endpoints
  tunnel.ts         # /tunnel, /tunnels endpoints
  orchestrator.ts   # /orchestrator endpoints
  health.ts         # /health endpoint
  config.ts         # /config endpoint
  launch.ts         # /launch-hints endpoint
  info.ts           # /status, /metrics, /version endpoints
  arbiter.ts        # /arbiter endpoints (wired directly in server.ts)
bin/
  port-daddy-cli.ts # CLI entry point
public/
  index.html        # Dashboard UI
completions/
  port-daddy.bash   # Bash tab completion
  port-daddy.zsh    # Zsh tab completion
  port-daddy.fish   # Fish tab completion
tests/
  setup-unit.js     # In-memory SQLite factory for unit tests
  unit/             # Unit tests (47 suites)
  integration/      # Integration tests (require live daemon)
docs/
  sdk.md                # Full SDK reference (moved from README)
examples/
  agent-coordination.js  # Multi-agent example
```

## Always-On Daemon

The Port Daddy daemon is installed as a launchd service and MUST always be running.
It auto-starts on login. Before any session, verify:

```bash
pd status                          # must show "running"
launchctl list | grep portdaddy    # must show com.portdaddy.daemon
```

If not running: `pd start`. If not installed: `pd install`.

This project dogfoods Port Daddy for all coordination — the daemon being down is a blocker, not a deferral reason.

## Stable Branch Workflow

Port Daddy uses a **two-branch model** to protect the running daemon from development breakage:

```
~/coding/port-daddy/          ← development (main branch)
~/port-daddy-stable/          ← production (stable branch, git worktree)
```

**What runs from stable:**
- The `pd` CLI (npm link'd from `~/port-daddy-stable`)
- The launchd daemon (`com.portdaddy.daemon`)
- The MCP server (`pd mcp`)

**What determines stability:** The test suite. `npm test` must pass (≤1 known failure allowed: up-down PID). The pre-commit hook must not block. The daemon must boot and respond to `pd status`.

**How to promote main → stable:**
```bash
./scripts/promote-stable.sh     # runs tests, merges, reinstalls, restarts daemon
```

**Manual promotion (if script isn't available):**
```bash
cd ~/port-daddy-stable
git merge main --no-edit
npm install
npm link
pd stop && sleep 2
launchctl unload ~/Library/LaunchAgents/com.portdaddy.daemon.plist
launchctl load ~/Library/LaunchAgents/com.portdaddy.daemon.plist
pd status                       # verify running
```

**Rules:**
- NEVER `npm link` from `~/coding/port-daddy` — that bypasses the stability gate
- NEVER modify files in `~/port-daddy-stable` directly — always merge from main
- After breaking changes to the daemon, run `./scripts/promote-stable.sh` before ending the session
- **PROMPT THE USER** when a significant feature is stable and tested: "This looks ready to ship — want me to run `pdship`?" Don't auto-promote. Ask first.
- The stable worktree is a git worktree (not a separate clone) — same repo, shared history

## Development

```bash
# Start in development mode (use when iterating on server.ts — restarts on change)
npm run dev

# Run tests (restarts daemon with fresh code)
npm test

# Check test coverage
npm test -- --coverage

# Type-check without building
npm run typecheck

# Build TypeScript to dist/
npm run build
```

## Key Patterns

### Semantic Identities
All services use `project:stack:context` naming:
- `myapp:api:main` — Main API for myapp
- `myapp:frontend:feature-auth` — Frontend on feature branch

### SQLite-Backed
All state is in SQLite for:
- Atomic operations
- Persistence across restarts
- Pattern-based queries

**Database location**: `<project-root>/port-registry.db` (NOT `~/.port-daddy/`)
- Override with `PORT_DADDY_DB` environment variable
- Test DBs: `port-registry-test.db`, `port-registry-security-test.db`
- Direct SQLite access for debugging:
  ```bash
  sqlite3 /Users/erichowens/coding/port-daddy/port-registry.db
  .tables                           # List all tables
  SELECT * FROM agents;             # View agents
  SELECT * FROM sessions;           # View sessions
  SELECT * FROM session_notes;      # View notes
  SELECT * FROM resurrection_queue; # View salvage queue
  ```

### Sessions & Notes
Sessions provide structured multi-agent coordination:
- **Sessions** are mutable (active → completed/abandoned)
- **Notes** are immutable (append-only, never edited/deleted individually)
- **File claims** are advisory (conflict detection, not enforcement)
- Session deletion CASCADEs to notes and file claims
- `quickNote` creates an implicit session if none exists

### Operation Tiers
- **Tier 1 (no daemon)**: claim, release, find, lock, unlock, status, cleanup, session, note, notes
- **Tier 2 (daemon required)**: pub/sub, SSE, webhooks, agent heartbeats, orchestration (up/down), health checks

### Agent Resurrection (Salvage)

When an agent dies mid-task (crashes, loses connection, context window exceeded), Port Daddy preserves its work for another agent to continue.

**Lifecycle**:
1. Agent registers: `pd agent register --agent <id> --purpose "Task description"`
2. Agent sends heartbeats every 5 min: `pd agent heartbeat --agent <id>`
3. Agent stops heartbeating → marked stale (10 min) → dead (20 min)
4. Dead agents with active sessions enter resurrection queue
5. New agent runs `pd salvage` to see dead agents' context
6. New agent claims: `pd salvage claim <dead-agent-id>`
7. New agent completes work, marks resurrection done

**Demo/debug resurrection**:
```bash
# Register a test agent
pd agent register --agent test-123 --purpose "Testing resurrection"

# Manually mark it dead (backdate heartbeat)
sqlite3 port-registry.db "UPDATE agents SET lastHeartbeat = datetime('now', '-30 minutes') WHERE id = 'test-123'"

# Trigger the reaper to move dead agents to resurrection queue
curl -X POST http://localhost:9876/salvage/reap

# Check salvage queue
pd salvage
```

**Key tables**: `agents`, `resurrection_queue`, `sessions`, `session_notes`

### Rate Limiting
Server has built-in rate limiting:
- 100 requests/minute per IP (HTTP)
- 10 concurrent SSE connections per IP
- Queue size limits for webhooks/messages

## Security Considerations

- **SSRF Protection**: Webhook URLs validated against private IPs
- **Input Validation**: All user input validated
- **SQL Injection**: Parameterized queries throughout
- **HMAC Signing**: Webhook payloads signed for verification

## Testing

Two test tiers:

**Unit tests** (no daemon required):
```bash
# All unit tests
NODE_OPTIONS="--experimental-vm-modules" npx jest tests/unit/ --no-coverage

# Single file
NODE_OPTIONS="--experimental-vm-modules" npx jest tests/unit/scan.test.js
```

**Integration tests** (ephemeral daemon auto-started by Jest):
```bash
# Ephemeral daemon started automatically
npm test

# Specific file
npm test -- tests/integration/cli.test.js
```

## Command Parity Matrix

**This is a living document.** Every new feature MUST be checked against all surfaces before it ships.

When adding ANY new command, endpoint, or operation, verify it exists in ALL of:

| Surface | File(s) | Current Coverage |
|---------|---------|-----------------|
| HTTP API | `routes/*.ts` | 99% |
| CLI | `bin/port-daddy-cli.ts` | 96% |
| SDK | `lib/client.ts` | 90% |
| Dashboard | `public/index.html` | 38% |
| Bash completions | `completions/port-daddy.bash` | 72% |
| Zsh completions | `completions/port-daddy.zsh` | 77% |
| Fish completions | `completions/port-daddy.fish` | 65% |
| README.md | `README.md` | 95% |
| SDK Reference | `docs/sdk.md` | 95% |
| CLAUDE.md | `CLAUDE.md` | varies |
| CHANGELOG.md | `CHANGELOG.md` | must update per release |

**Parity checklist for every new feature:**
1. API route exists and tested
2. CLI command exists with `--quiet/-q` and `--json/-j` flags
3. SDK method exists with typed response interface
4. Shell completions updated in ALL THREE shells (bash, zsh, fish)
5. Dashboard panel added (if applicable)
6. README documents the feature
7. CLAUDE.md API table updated
8. CHANGELOG.md entry added

Fish completions are historically the worst — double-check fish.

## In-Progress Features — Surface Tracking

**Update this section for every feature in progress.**

### pd spawn + pd watch — DONE (v3.6)

| Surface | Status | Notes |
|---------|--------|-------|
| `lib/spawner.ts` | ✅ DONE | createSpawner(), backends: ollama/claude/gemini/aider/custom, 434 lines |
| `lib/watch.ts` | ✅ DONE | SSE subscriber, --exec, reconnect loop, 174 lines |
| `routes/spawn.ts` | ✅ DONE | POST/GET/DELETE /spawn |
| `cli/commands/spawn.ts` | ✅ DONE | pd spawn, pd spawned, pd watch |
| `features.manifest.json` | ✅ DONE | spawn + watch entries added |
| `completions/*.{bash,zsh,fish}` | ✅ DONE | spawn, spawned, watch in all 3 shells |
| `lib/client.ts` | ✅ DONE | spawn(), listSpawned(), killSpawned() + typed interfaces |
| `README.md` | ✅ DONE | pd spawn + pd watch sections added, CLI reference table added |
| `CHANGELOG.md` | ✅ DONE | [Unreleased] entry added |

**CLI syntax:**
```bash
pd spawn --backend ollama --model llama3.2:8b --identity myapp:coder -- "Fix the login bug"
pd spawned                    # list running
pd spawn kill <id>            # stop agent
pd watch build-results --exec './analyze.sh'   # ambient trigger
```

### Uncharted Waters — DONE (v3.7)

| Surface | Status | Notes |
|---------|--------|-------|
| `routes/launch.ts` | ✅ DONE | Added `uncharted_waters: true` field |
| `bin/port-daddy-cli.ts` | ✅ DONE | Compass rose + UNCHARTED WATERS banner in printLaunchHints() |

### Context-Aware Salvage

When an agent dies, other agents in the same project should be notified.

| Surface | Status | Notes |
|---------|--------|-------|
| `lib/agents.ts` | ✅ DONE | Added identity_project/stack/context, worktree_id, purpose columns. `register()` returns salvageHint. `listStale()` filters by identity prefix. |
| `lib/resurrection.ts` | ✅ DONE | Added identity_project/stack/context columns. `pending()` and `list()` filter by project/stack. `countByProject()` for salvage hints. |
| `routes/agents.ts` | ✅ DONE | Accepts identity, worktreeId, purpose. Returns salvageHint. Broadcasts identity to radio. |
| `routes/resurrection.ts` | ✅ DONE | `/salvage/*` as primary routes, `/resurrection/*` as deprecated aliases. |
| `cli/commands/agents.ts` | ✅ DONE | Accepts `--identity`, `--purpose`, `--worktree`. Shows salvageHint notice on register. |
| `cli/commands/resurrection.ts` | ✅ DONE | Uses `/salvage/*` routes. Maritime labels paired with standard terms. |
| `public/index.html` | ✅ DONE | Salvage Queue panel with project grouping, 15s auto-refresh, dead-since timestamps |
| `completions/*.{bash,zsh,fish}` | ✅ DONE | `--identity`, `--purpose`, `--worktree` on agent register; `--project`, `--stack` on salvage |
| `lib/client.ts` | ✅ DONE | RegisterOptions has identity/purpose/worktree; SalvageListOptions has project/stack/all/limit |
| `README.md` | ✅ DONE | Agent Identity & Auto-Salvage section with registration, notice, and claim examples |
| `CHANGELOG.md` | ✅ DONE | Context-Aware Salvage entry added to [Unreleased] |

**Flow:**
1. `pd agent register --identity myapp:api --purpose "Building auth"` → stores identity
2. Server checks for dead agents in `myapp:*` → returns `salvageHint` in response
3. CLI displays: "⚠️ 2 dead agent(s) in myapp:*. Run: pd salvage --project myapp"
4. `pd salvage --project myapp` shows only dead agents in that project
5. Dashboard shows resurrection queue prominently with project grouping

## Adding New Features

1. Add module to `lib/`
2. Export from module and import in `server.ts`
3. Add routes in `routes/` and register in `routes/index.ts`
4. Code hash is automatic — `server.ts` uses dynamic `readdirSync` to hash all source files
5. Update dashboard in `public/index.html`
6. Write unit tests in `tests/unit/` and integration tests in `tests/integration/`
7. Update completions in ALL THREE completion files (`completions/`)
8. Update SDK in `lib/client.ts` with typed interfaces
9. Update README.md
10. Update this file (CLAUDE.md)
11. Add CHANGELOG.md entry
12. **Run the parity checklist above**

## API Endpoints Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| **Services** | | |
| `/claim` | POST | Claim a port (id in request body) |
| `/release` | DELETE | Release a service (id in request body) |
| `/services` | GET | List services |
| `/services/:id` | GET | Get single service |
| `/services/health` | GET | Health check all services |
| `/services/health/:id` | GET | Health check single service |
| `/wait/:id` | GET | SSE — wait for a service to be ready |
| `/wait` | POST | Wait for a service by name |
| **Locks** | | |
| `/locks/:name` | POST/PUT/DELETE | Acquire/extend/release lock |
| `/locks` | GET | List locks |
| **Messaging** | | |
| `/msg` | GET | List all channels |
| `/msg/:channel` | POST/GET/DELETE | Publish/get/clear messages |
| `/msg/:channel/poll` | GET | Long-poll for new messages |
| `/msg/:channel/subscribe` | GET | SSE subscription |
| `/channels` | GET | List pub/sub channels (alias) |
| **Agents** | | |
| `/agents/:id` | POST/DELETE | Register/unregister agent |
| `/agents/:id/heartbeat` | POST | Agent heartbeat |
| **Webhooks** | | |
| `/webhooks` | POST/GET | Create/list webhooks |
| `/webhooks/events` | GET | List available webhook events |
| `/webhooks/:id` | GET/PUT/DELETE | Get/update/delete webhook |
| `/webhooks/:id/test` | POST | Send test delivery |
| `/webhooks/:id/deliveries` | GET | List webhook deliveries |
| **Sessions & Notes** | | |
| `/sessions` | POST/GET | Start/list sessions |
| `/sessions/:id` | GET/PUT/DELETE | Get/update/delete session |
| `/sessions/:id/notes` | POST/GET | Add/get session notes |
| `/sessions/:id/files` | POST/DELETE | Claim/release session files |
| `/notes` | POST/GET | Quick note / recent notes |
| `/files` | GET | List all file claims |
| `/files/who-owns` | GET | Find who owns a given file |
| **Salvage (Resurrection)** | | |
| `/salvage` | GET | List salvage queue entries |
| `/salvage/pending` | GET | List agents pending salvage |
| `/salvage/claim/:agentId` | POST | Claim dead agent's work |
| `/salvage/complete/:agentId` | POST | Mark salvage complete |
| `/salvage/abandon/:agentId` | POST | Return agent to queue |
| `/salvage/:agentId` | DELETE | Dismiss agent from queue |
| `/resurrection/*` | * | Deprecated aliases for /salvage/* |
| **Changelog** | | |
| `/changelog` | POST/GET | Add entry / list changelog |
| `/changelog/identities` | GET | List all identities with changelog entries |
| **Tunnels** | | |
| `/tunnel/providers` | GET | Check which tunnel providers are installed |
| `/tunnel/:id` | POST/DELETE/GET | Start/stop/status tunnel for service |
| `/tunnels` | GET | List all active tunnels |
| **Projects** | | |
| `/scan` | POST | Deep-scan directory, register project |
| `/projects` | GET | List registered projects |
| `/projects/:id` | GET/DELETE | Get or remove a project |
| **Activity** | | |
| `/activity` | GET | Activity log |
| `/activity` | DELETE | Clear activity log |
| `/activity/summary` | GET | Activity summary by type |
| `/activity/stats` | GET | Activity log statistics |
| `/activity/range` | GET | Activity in time range |
| `/activity/timeline` | GET | Activity timeline view |
| `/activity/subscribe` | GET | SSE real-time activity stream |
| **DNS** | | |
| `/dns` | GET | List DNS records |
| `/dns/:id` | POST/GET/DELETE | Create/get/delete DNS record |
| `/dns/status` | GET | DNS service status |
| `/dns/cleanup` | POST | Remove expired DNS records |
| `/dns/setup` | POST | Configure system DNS |
| `/dns/teardown` | POST | Remove system DNS config |
| `/dns/sync` | POST | Sync DNS records to system |
| `/dns/resolver` | GET | Get resolver configuration |
| **Harbors** | | |
| `/harbors` | POST/GET | Create/list harbors |
| `/harbors/:name` | GET/DELETE | Get/delete harbor |
| `/harbors/:name/enter` | POST | Agent enters harbor |
| `/harbors/:name/leave` | POST | Agent leaves harbor |
| `/harbors/:name/members` | GET | List harbor members |
| `/harbors/agent/:agentId` | GET | List harbors for an agent |
| **Orchestrator** | | |
| `/orchestrator/up` | POST | Start orchestrated services |
| `/orchestrator/down` | POST | Stop all services |
| `/orchestrator/status` | GET | Service status |
| `/orchestrator/rules` | GET/POST | Get/set orchestration rules |
| **Sugar** | | |
| `/sugar/begin` | POST | Register agent + start session atomically |
| `/sugar/done` | POST | End session + unregister agent atomically |
| `/sugar/whoami` | GET | Get current agent/session context |
| **Briefing** | | |
| `/briefing` | POST | Create a project briefing |
| `/briefing/:project` | GET | Get project briefing |
| **Spawn** | | |
| `/spawn` | POST/GET | Launch AI agent / list spawned agents |
| `/spawn/:id` | DELETE | Kill a spawned agent |
| **System** | | |
| `/ping` | GET | Liveness check |
| `/status` | GET | Combined health + metrics + process info |
| `/health` | GET | Daemon health check |
| `/metrics` | GET | Daemon metrics |
| `/config` | GET | Resolved configuration |
| `/version` | GET | Version and code hash |
| `/ports/active` | GET | List active port assignments |
| `/ports/system` | GET | List system/well-known ports |
| `/ports/cleanup` | POST | Release stale ports |
| `/launch-hints` | GET | Context-aware startup hints |
| `/dashboard/events` | GET | SSE for real-time dashboard updates |
| **Arbiter** | | |
| `/arbiter/status` | GET | Arbiter status: rules, violations, uptime |
| `/arbiter/violations` | GET | List recorded violations |
| `/arbiter/test-invariant/:name` | POST | Inject test violation (for demos) |
| **Pheromone** | | |
| `/pheromone/spray` | POST | Set a pheromone value on an entity (body: table, id, key, strength 0-1) |
| `/pheromone/:table/:id` | GET | Read pheromone values for entity; applies read-time decay |
| `/pheromone` | GET | List all non-zero pheromones across all tracked tables |
| `/pheromone/files` | GET | File heat map from session file claims (query: path, depth) |
