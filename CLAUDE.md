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
  agents.ts         # Agent registry
  activity.ts       # Activity logging
  webhooks.ts       # Webhook subscriptions
  identity.ts       # Semantic ID parsing
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
routes/
  index.ts          # Route registration
  projects.ts       # /scan, /projects endpoints
  sessions.ts       # /sessions, /notes endpoints
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
  unit/             # Unit tests (19 suites, 1283+ tests)
  integration/      # Integration tests (require live daemon)
docs/
  sdk.md                # Full SDK reference (moved from README)
examples/
  agent-coordination.js  # Multi-agent example
```

## Development

```bash
# Start in development mode
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
| `public/index.html` | ⬜ TODO | Add "Salvage Queue" panel showing dead agents by project |
| `completions/*.{bash,zsh,fish}` | ⬜ TODO | Add `--identity`, `--project`, `--purpose` flags |
| `lib/client.ts` | ⬜ TODO | Add identity/purpose params to register(), salvage filter to SDK |
| `README.md` | ⬜ TODO | Document agent identity and auto-salvage notice |
| `CHANGELOG.md` | ⬜ TODO | Add entry when feature ships |

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
| `/claim/:id` | POST | Claim a port |
| `/release/:id` | DELETE | Release a service |
| `/services` | GET | List services |
| `/services/health` | GET | Health check all services |
| `/services/health/:id` | GET | Health check single service |
| `/locks/:name` | POST/PUT/DELETE | Acquire/extend/release lock |
| `/locks` | GET | List locks |
| `/msg/:channel` | POST/GET/DELETE | Publish/get/clear messages |
| `/channels` | GET | List pub/sub channels |
| `/subscribe/:channel` | GET | SSE subscription |
| `/agents/:id` | POST/DELETE | Register/unregister agent |
| `/agents/:id/heartbeat` | PUT | Agent heartbeat |
| `/webhooks` | POST/GET | Create/list webhooks |
| `/webhooks/events` | GET | List available webhook events |
| `/webhooks/:id` | GET/PUT/DELETE | Get/update/delete webhook |
| `/webhooks/:id/test` | POST | Send test delivery |
| `/webhooks/:id/deliveries` | GET | List webhook deliveries |
| `/sessions` | POST/GET | Start/list sessions |
| `/sessions/:id` | GET/PUT/DELETE | Get/update/delete session |
| `/sessions/:id/notes` | POST/GET | Add/get session notes |
| `/sessions/:id/files` | POST/DELETE/GET | Claim/release/list files |
| `/notes` | POST/GET | Quick note / recent notes |
| `/salvage` | GET | List salvage queue entries |
| `/salvage/pending` | GET | List agents pending salvage |
| `/salvage/claim/:agentId` | POST | Claim dead agent's work |
| `/salvage/complete/:agentId` | POST | Mark salvage complete |
| `/salvage/abandon/:agentId` | POST | Return agent to queue |
| `/salvage/:agentId` | DELETE | Dismiss agent from queue |
| `/resurrection/*` | * | Deprecated aliases for /salvage/* |
| `/changelog` | POST/GET | Add entry / list changelog |
| `/changelog/identities` | GET | List all identities with changelog entries |
| `/tunnel/providers` | GET | Check which tunnel providers are installed |
| `/tunnel/:id` | POST/DELETE/GET | Start/stop/status tunnel for service |
| `/tunnels` | GET | List all active tunnels |
| `/scan` | POST | Deep-scan directory, register project |
| `/projects` | GET | List registered projects |
| `/projects/:id` | GET/DELETE | Get or remove a project |
| `/activity` | GET | Activity log |
| `/activity/summary` | GET | Activity summary by type |
| `/activity/stats` | GET | Activity log statistics |
| `/activity/range` | GET | Activity in time range |
| `/metrics` | GET | Daemon metrics |
| `/config` | GET | Resolved configuration |
| `/ports/active` | GET | List active port assignments |
| `/ports/system` | GET | List system/well-known ports |
| `/ports/cleanup` | POST | Release stale ports |
| `/health` | GET | Daemon health check |
| `/version` | GET | Version and code hash |
