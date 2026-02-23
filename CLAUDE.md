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
