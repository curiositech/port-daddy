# Contributing to Port Daddy

Thank you for your interest in contributing to Port Daddy! This guide covers the v3 architecture, development workflow, and conventions you need to know.

## Prerequisites

- Node.js 18+
- npm 9+
- TypeScript 5.x (included in devDependencies)
- macOS or Linux (Windows support via WSL)

## Getting Started

```bash
# Clone the repo
git clone https://github.com/curiositech/port-daddy.git
cd port-daddy

# Install dependencies
npm install

# Start the daemon in development mode
npm run dev

# Run the full test suite (1255 tests across 21 suites)
npm test
```

## Project Structure (v3)

```
port-daddy/
├── server.ts              # Express daemon (main entry)
├── config.json            # Daemon configuration
├── package.json           # ESM project, "type": "module"
├── bin/
│   └── port-daddy-cli.ts  # Unified CLI (subcommands, no separate scripts)
├── lib/
│   ├── services.ts        # Port assignment module
│   ├── locks.ts           # Distributed locks
│   ├── messaging.ts       # Pub/sub messaging
│   ├── agents.ts          # Agent registry
│   ├── activity.ts        # Activity logging
│   ├── webhooks.ts        # Webhook subscriptions
│   ├── identity.ts        # Semantic ID parsing (project:stack:context)
│   ├── detect.ts          # Framework detection (60+ frameworks)
│   ├── config.ts          # .portdaddyrc handling
│   ├── health.ts          # Health check utilities
│   ├── utils.ts           # Common utilities
│   ├── client.ts          # JavaScript SDK (PortDaddy class)
│   ├── orchestrator.ts    # Service orchestrator (topological sort, spawn, health)
│   ├── discover.ts        # Monorepo/workspace service discovery
│   └── log-prefix.ts      # Colored multiplexed log output
├── routes/
│   ├── index.ts           # Route aggregator
│   ├── services.ts        # /claim, /release, /services
│   ├── messaging.ts       # /msg, /subscribe, /channels
│   ├── locks.ts           # /locks
│   ├── agents.ts          # /agents
│   ├── info.ts            # /health, /version, /metrics
│   ├── webhooks.ts        # /webhooks
│   ├── activity.ts        # /activity
│   └── detect-config.ts   # /detect, /init, /config
├── shared/
│   └── types.ts            # Input validation
├── public/
│   └── index.html         # Dashboard UI
├── tests/
│   ├── integration/       # API tests against live daemon
│   │   ├── api.test.js
│   │   ├── cli.test.js
│   │   ├── security.test.js
│   │   └── up-down.test.js
│   ├── unit/              # Unit tests (17 suites, 1042+ tests)
│   └── setup-unit.js      # Unit test setup
├── completions/
│   ├── port-daddy.bash    # Bash completions
│   ├── port-daddy.zsh     # Zsh completions
│   └── port-daddy.fish    # Fish completions
└── install-daemon.ts      # Daemon installer/manager
```

## Architecture

### What Changed from v1 to v3

| Area | v1 | v3 |
|------|----|----|
| CLI | Separate shell scripts (`get-port`, `release-port`, `list-ports`) | Unified `port-daddy` command with subcommands |
| Naming | Flat project names | Semantic identities: `project:stack:context` |
| Routes | All handlers in `server.js` | Modular `routes/` directory |
| Validation | Inline in route handlers | Centralized in `shared/validation.js` |
| SDK | None | `lib/client.js` (PortDaddy class) |
| Config | Just `config.json` | Per-project `.portdaddyrc` with auto-detection |
| Coordination | Port assignment only | Pub/sub, distributed locks, agent registry, webhooks |
| Tests | Integration only | Unit + integration (1255 tests, 21 suites) |
| Completions | Bash only | Bash, zsh, and fish |
| Module system | CommonJS | ESM throughout (`import`/`export`) |
| Language | JavaScript | TypeScript (strict mode) |
| Frameworks | 17 detected | 60+ detected |

### Core Components

**1. Express Daemon** (`server.ts`)
- HTTP API for all port and coordination services
- SQLite database (WAL mode for concurrency)
- Process tracking for automatic cleanup
- Rate limiting (100 req/min per IP, 10 concurrent SSE connections)

**2. Unified CLI** (`bin/port-daddy-cli.ts`)
- Single entry point: `port-daddy <subcommand>`
- Subcommands: `claim`, `release`, `list`, `dev`, `start`, `restart`, `status`, etc.
- Shell completions for bash and zsh

**3. Modular Routes** (`routes/`)
- Each domain gets its own route file
- `routes/index.js` aggregates all routes and mounts them on the Express app
- Route handlers are thin: validate input, call lib module, return response

**4. Library Modules** (`lib/`)
- Each module exports a factory function that accepts dependencies (for testability)
- All state backed by SQLite with parameterized queries
- Modules: services, locks, messaging, agents, activity, webhooks, identity, detect, config, health, utils, client

**5. JavaScript SDK** (`lib/client.ts`)
- `PortDaddy` class for programmatic usage
- Wraps HTTP API with a clean interface
- Importable: `import { PortDaddy } from 'port-daddy/client'`

**6. Shared Validation** (`shared/types.ts`)
- Input validation rules used across routes
- Semantic identity format validation
- Port range and parameter validation

### Key Design Decisions

**Why SQLite?**
- Atomic transactions (no race conditions between agents)
- Single file (easy backup/migration)
- No separate service to manage
- Fast (<10ms queries)
- ACID guarantees

**Why Semantic Identities?**
- `project:stack:context` gives structure to service names
- Enables pattern queries (all services for a project, all frontends, etc.)
- Human-readable and machine-parseable
- Example: `myapp:api:main`, `myapp:frontend:feature-auth`

**Why localhost-only?**
- Port assignment is inherently local
- No remote access needed
- Simpler security model
- No authentication required

## Development Workflow

### Making Changes

1. Create a feature branch from `main`
2. Make your changes (follow the code style below)
3. Write tests -- both unit and integration
4. Run `npm test` and confirm all 1255+ tests pass
5. Commit with clear, descriptive messages
6. Push and open a pull request against `main`

### Adding New Features Checklist

When adding a new capability to Port Daddy, follow this sequence:

1. **Add module** to `lib/` -- export a factory function that takes dependencies
2. **Import and wire up** the module in `server.js`
3. **Add routes** in the `routes/` directory -- create a new file or extend an existing one
4. **Code hash is automatic** -- `server.js` uses dynamic `readdirSync` to hash all source files, so new `lib/` and `routes/` files are included automatically
5. **Add shared validation** in `shared/validation.js` if the feature takes user input
6. **Update the dashboard** in `public/index.html`
7. **Write unit tests** in `tests/unit/` (mock dependencies, no daemon needed)
8. **Write integration tests** in `tests/integration/` (test against live daemon)
9. **Update README.md** with API docs and usage examples
10. **Add SDK methods** to `lib/client.js` so programmatic users get the feature too

## Testing

Port Daddy has 1255 tests across 21 suites, split into two projects configured in `jest.config.js`.

### Running Tests

```bash
# Run everything (unit + integration)
npm test

# Watch mode for rapid iteration
npm run test:watch

# Generate coverage report (target: 90%+)
npm run test:coverage

# CI gate (verifies daemon health, then runs tests)
npm run test:ci
```

### Unit Tests (`tests/unit/`)

- 12 test files, one per `lib/` module
- All dependencies are mocked -- no daemon, no database, no network
- Fast execution
- Great for TDD: write the test first, then implement

```bash
# Run only unit tests
npm test -- --selectProjects unit
```

### Integration Tests (`tests/integration/`)

- 4 test files: `api.test.js`, `cli.test.js`, `security.test.js`, `up-down.test.js`
- Run against an ephemeral daemon (auto-started by Jest globalSetup/globalTeardown)
- Verify real HTTP contracts, CLI behavior, and security controls
- The test harness restarts the daemon with fresh code and verifies the code hash

```bash
# Run only integration tests
npm test -- --selectProjects integration
```

### Writing Tests

- **Unit tests**: Place in `tests/unit/<module-name>.test.js`. Mock the module's dependencies using the factory function pattern. No network calls, no file I/O.
- **Integration tests**: Place in `tests/integration/`. Use real HTTP requests against `localhost:9876`. Clean up any resources you create (ports, locks, agents, etc.) in `afterEach` or `afterAll`.

## Code Style

- **ES Modules** -- `import`/`export`, not `require`/`module.exports`. The project has `"type": "module"` in `package.json`.
- **No semicolons** -- rely on ASI. Be consistent with the existing codebase.
- **2-space indentation** -- no tabs.
- **Descriptive names** -- `assignPortToService` not `assign`, `validateSemanticId` not `validate`.
- **Comments for non-obvious logic** -- especially around SQLite transaction boundaries and race condition handling.
- **Express routes in `routes/` directory** -- keep `server.js` focused on wiring, not business logic.
- **Factory functions with dependency injection** -- every `lib/` module exports a function that takes its dependencies, making testing straightforward.

Example module pattern:

```js
// lib/example.js
export function createExample({ db, logger }) {
  function doSomething(input) {
    logger.info('Doing something', { input })
    // ... use db, return result
  }

  return { doSomething }
}
```

### TypeScript

The entire codebase is TypeScript with strict mode enabled. Key conventions:

- All source files use `.ts` extension
- Imports use `.js` extension (NodeNext module resolution)
- Core types are defined in `shared/types.ts`
- Run `npm run typecheck` to verify types without building
- Run `npm run build` to compile to `dist/`
- Development uses `tsx` for direct TypeScript execution (no build step needed)

## Security Guidelines

- **SSRF Protection**: Webhook URLs are validated against private IP ranges
- **Input Validation**: All user input validated through `shared/types.ts`
- **SQL Injection Prevention**: Parameterized queries throughout -- never interpolate user input into SQL
- **Localhost Binding**: Daemon only listens on `127.0.0.1`
- **Rate Limiting**: 100 requests/min per IP, 10 concurrent SSE connections per IP
- **HMAC Signing**: Webhook payloads are signed so receivers can verify authenticity
- **Process Arguments**: Use `spawnSync` with array args, never shell strings

## Release Process

Port Daddy is published as an npm package. To cut a release:

1. **Update the version** in `package.json` following [semver](https://semver.org/)
2. **Update CHANGELOG.md** with a summary of changes
3. **Run the full test suite**: `npm test` -- all 1255+ tests must pass
4. **Commit the version bump**: `git commit -am "Bump to vX.Y.Z"`
5. **Tag the release**: `git tag vX.Y.Z`
6. **Push**: `git push origin main --tags`
7. **Publish to npm**: `npm publish`
8. **Create a GitHub release** at https://github.com/curiositech/port-daddy/releases with release notes

## Getting Help

- **Issues**: https://github.com/curiositech/port-daddy/issues
- **Discussions**: https://github.com/curiositech/port-daddy/discussions
- **README**: https://github.com/curiositech/port-daddy#readme

## License

By contributing to Port Daddy, you agree that your contributions will be licensed under the [MIT License](https://opensource.org/licenses/MIT), the same license that covers the project.

---

Thank you for helping make Port Daddy better!
