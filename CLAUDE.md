# Port Daddy - Developer Context

## What Is This?

Port Daddy is the authoritative port manager for multi-agent development. It's a daemon running on `localhost:9876` that provides:

- **Atomic port assignment** — No race conditions
- **Agent coordination** — Pub/sub messaging and distributed locks
- **Agent registry** — Track active agents with heartbeats
- **Webhooks** — External system integration
- **Activity logging** — Full audit trail

## Architecture

```
server.ts           # Express daemon (main entry point)
lib/
  services.ts       # Port assignment module
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
  unit/             # Unit tests (17 suites, 1042+ tests)
  integration/      # Integration tests (require live daemon)
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

\*\*Integration tests\*\* (ephemeral daemon auto-started by Jest):
```bash
# Ephemeral daemon started automatically
npm test

# Specific file
npm test -- tests/integration/cli.test.js
```

## Adding New Features

1. Add module to `lib/`
2. Export from module and import in `server.js`
3. Add routes in `routes/` and register in `routes/index.js`
4. Code hash is automatic — `server.ts` uses dynamic `readdirSync` to hash all source files
5. Update dashboard in `public/index.html`
6. Write unit tests in `tests/unit/` and integration tests in `tests/integration/`
7. Update completions in `completions/`
8. Update README.md

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
