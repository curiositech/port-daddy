# Changelog

All notable changes to Port Daddy will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Tunnel integration**: Expose local services to the internet via ngrok, cloudflared, or localtunnel
  - `pd tunnel start <service> --provider cloudflared|ngrok|localtunnel` — start a tunnel
  - `pd tunnel stop <service>` — stop a tunnel
  - `pd tunnel status <service>` — get tunnel status
  - `pd tunnel list` — list all active tunnels
  - `pd tunnel providers` — check which providers are installed
  - API: `POST/DELETE/GET /tunnel/:id`, `GET /tunnels`, `GET /tunnel/providers`
  - SDK: `tunnelStart()`, `tunnelStop()`, `tunnelStatus()`, `tunnelList()`, `tunnelProviders()` methods
  - Shell completions: tunnel subcommands in bash, zsh, fish
- **Context-aware salvage UX**: Agent identity (`--identity project:stack:context`) enables smart filtering
  - `pd agent register --identity myapp:backend:main` — semantic identity for agents
  - Auto-salvage notice: when registering, check for dead agents in the same project and show notice
  - `pd salvage --project myapp` — filter resurrection queue by project (default behavior)
  - `pd salvage --stack api` — further filter by stack
  - `pd salvage --all` — show global queue (requires explicit opt-in, shows warning)
  - SDK: `salvage()`, `salvageClaim()`, `salvageComplete()`, `salvageAbandon()`, `salvageDismiss()` methods
  - Dashboard: Identity column in salvage table
  - Shell completions: `--project`, `--stack`, `--all`, `--limit` flags for salvage; `--identity`, `--purpose`, `--worktree` flags for agent register

## [3.2.0] - 2026-02-23

### Added
- **Sessions & Notes system** (`lib/sessions.ts`): Structured multi-agent coordination replacing flat-file `.CLAUDE_LOCK` / `.CLAUDE_NOTES.md` patterns — session lifecycle (start, end, abandon, remove), immutable append-only notes with types (note/handoff/commit/warning), and advisory file claims with conflict detection
- **Session schema**: `sessions`, `session_files` (with `released_at` audit trail), `session_notes` tables with CASCADE deletion
- **Auto-session**: `quickNote` creates an implicit session for agents that skip explicit `session start`
- **Session garbage collection**: `cleanup(olderThan?, status?)` for removing stale sessions
- **Session HTTP routes** (`routes/sessions.ts`): 11 endpoints — `POST/GET /sessions`, `GET/PUT/DELETE /sessions/:id`, `POST/GET /sessions/:id/notes`, `POST/DELETE /sessions/:id/files`, `POST/GET /notes`
- **Session CLI commands**: `pd session start/end/done/abandon/rm`, `pd session files add/rm`, `pd sessions [--all] [--status] [--files]`, `pd note <content> [--type TYPE]`, `pd notes [session-id] [--limit N] [--type TYPE]` — all with `--quiet/-q` and `--json/-j` output modes
- **Session SDK methods**: 10 new methods on `PortDaddy` class — `startSession`, `endSession`, `abandonSession`, `removeSession`, `note`, `notes`, `sessions`, `sessionDetails`, `claimFiles`, `releaseFiles`
- **SDK type honesty**: 42 typed response interfaces replacing every `Record<string, unknown>` — `ClaimResponse`, `ReleaseResponse`, `LockResponse`, `ServiceEntry`, `AgentDetail`, `WebhookEntry`, `ActivityEntry`, and 8 new session-related interfaces
- Activity logging for `session_start`, `session_end`, `session_note`, `file_claim`, `file_release` events
- 110 new unit tests for sessions module; test suite now at 1283 tests across 19 suites
- **SDK reference doc** (`docs/sdk.md`): full SDK documentation moved out of README into dedicated reference

### Changed
- **README restructured for layered audiences**: Layer 1 (solo devs — stable ports), Layer 2 (teams — orchestration), Layer 3 (agents — sessions, locks, pub/sub). Non-technical summary above the fold. README reduced from 1187 to ~470 lines
- **Sessions & Notes documented** as headline feature with `.CLAUDE_LOCK` comparison table
- **"When NOT to Use Port Daddy" section** added for honest self-selection
- **`pd` alias** prominently documented throughout (previously buried)
- **Colon syntax** explained inline in Quick Start: `myapp:api:main` = project:stack:context
- Shell completions: added `up`, `down`, `diagnose` commands to all 3 completion files (zsh, bash, fish); added `--from`/`--to` flags for `log` command in fish; normalized quiet flag handling in CLI

### Fixed
- **GC zombie cleanup**: removed dead agents-to-services cleanup path (services lack `agent_id` column); added PID liveness checking via `process.kill(pid, 0)` to `services.cleanup()`; only checks running services (assigned services preserved)
- **Stale agent lock release**: agents that disappear now have their held locks properly released
- **Jest open handle leak**: `unref()` webhook retry timers to prevent Jest worker hang; added `messaging.destroy()` for clean subscriber teardown
- **Shell completions**: `handlePorts()` now distinguishes empty results from API errors
- **6 crash/corruption defects**: operator precedence in `orchestrator.ts` skip-logic; systemic `safeJsonParse` across 13 `JSON.parse` call sites on DB TEXT columns so a single corrupted row no longer crashes the daemon; defensive optional chaining on `SqliteError` in `locks.ts`

## [3.1.0] - 2026-02-22

### Added
- **SDK parity**: methods for every API endpoint — `scan`, `listProjects`, `getProject`, `deleteProject`, webhook CRUD (`get`, `update`, `test`, `deliveries`, `events`), `metrics`, `getConfig`, activity range/summary/stats, service health checks, port listing (active, system)
- **CLI parity**: commands for every API endpoint — `dashboard`, `channels`, `webhook`, `metrics`, `config`, `health`, `ports`; `lock extend` subcommand; `log --from/--to` time-range flags
- **Shell completions** (`completions/`): zsh, bash, and fish completions for all new CLI commands — dashboard, channels, webhook, metrics, config, health, ports, lock extend, log --from/--to
- **Claude Code plugin** (`.claude-plugin/`): agent skill manifest for Claude Code and Vercel AI SDK integration
- **OIDC npm publishing**: GitHub Actions workflow for trusted npm publishing via OpenID Connect (no stored tokens)
- `pd` alias for `port-daddy` CLI binary
- Complete SDK and API reference documentation in README

### Changed
- **CLI syntactic sugar**: single-letter command aliases (`c`=claim, `r`=release, `f`=find, `l`=list, `s`=scan, `p`=projects); `--export` flag on claim prints `export PORT=XXXX` for shell eval; TTY-aware output suppresses decorative text when piped
- UX friction points addressed from product analysis
- README rewritten for clarity — agentic coordination story above the fold, one-liner skill install, Vercel Agent Skill compatibility surfaced
- Dashboard updated to reflect full v3.1 command surface

### Fixed
- CLI binary broken after TypeScript migration (`d62cb92`)
- Package publishable: `dist/` exports, `types` field in package.json, `pd` bin alias
- REST cover art and centered branding header in README

### Removed
- **`detect` and `init` commands**: deprecated in favor of `scan` (which combines detection + registration)

## [3.0.0] - 2026-02-19

### Added
- **TypeScript rewrite**: all 32 source files migrated from `.js` to `.ts` with full type annotations — 18 lib modules, 11 route files, 3 entry points (server, CLI, install-daemon)
- **Framework detection expanded to 58 stacks** (`lib/detect.ts`): added `stackType` property and 36 new framework signatures — Gatsby, Docusaurus, Eleventy, TanStack Start, Koa, Hapi, AdonisJS, Strapi, KeystoneJS, RedwoodJS, Elysia, Blitz.js (Node.js); Streamlit, Gradio, Starlette (Python); Rails, Sinatra with Gemfile parser (Ruby); Laravel, Symfony, WordPress with composer.json parser (PHP); Spring Boot, Quarkus, Micronaut with pom.xml/gradle parser (Java/JVM); Phoenix with mix.exs parser (Elixir); Deno, Fresh (Deno); ASP.NET, Blazor with *.csproj parser (.NET); Expo, Tauri, Electron (Mobile/Desktop); Hugo, Jekyll, Zola (SSGs); Bun, Webpack Dev Server
- **Ephemeral test daemon**: Jest `globalSetup`/`globalTeardown` spawns fresh daemon with temp SQLite DB and temp Unix socket per test run — no dependency on running daemon, fully CI-friendly
- **Unix socket support**: SDK (`lib/client.ts`) and CLI use `http.request` with Unix socket for daemon communication
- `import type` used for type-only imports throughout
- `tsx` runtime replaces `node` in all scripts and test helpers

### Changed
- **BREAKING**: Node.js 18 dropped (EOL); now tested on Node 20, 22, and 24
- **BREAKING**: All imports are `.ts` source files (NodeNext resolution); consumers must use `dist/` compiled output
- better-sqlite3 upgraded to v12 for Node 24 compatibility
- Security audit findings addressed: expanded SSRF protection (IPv4-mapped IPv6, CGN RFC 6598, multicast, `.local`/`.localhost`/`.internal` hostnames); replaced `as any` casts with bounded `as unknown as Parameters<>` casts; error logging in shutdown catch block
- Flaky rate-limit test stabilized
- Orchestrator daemon requests routed through Unix socket instead of TCP fetch

### Fixed
- `port-daddy down` now uses PID-based orphan cleanup — previous snapshot-diffing approach skipped force-release when daemon was unreachable, root cause of CI flakes on macOS
- `port-daddy down` waits for shutdown and verifies port release before returning
- Process groups killed in up-down tests to prevent orphaned children on Linux
- Up-down test cleanup scoped to own projects only (was interfering with parallel test workers)
- `api.test.js` isolated with in-memory SQLite DB (was sharing file-based DB across parallel Jest workers)

## [2.0.0] - 2025-02-17

### Added
- **Service orchestration**: `port-daddy up` / `port-daddy down` — start your entire stack with dependency ordering, health checks, and colored multiplexed output (like `docker-compose` for local dev)
- **Orchestrator engine** (`lib/orchestrator.js`): Topological sort via Kahn's algorithm, port claiming, env injection, graceful SIGTERM shutdown in reverse dependency order
- **Service discovery** (`lib/discover.js`): Auto-discovers services in monorepos (npm/yarn/pnpm workspaces, lerna) and generates semantic identity suggestions
- **Log prefixer** (`lib/log-prefix.js`): Docker-compose-style colored output — 10-color palette, padded service names, dim stderr
- **Framework auto-detection**: `port-daddy detect` identifies 16 frameworks (Next.js, Vite, Express, FastAPI, Django, Angular, SvelteKit, Remix, Astro, Nuxt, Vue CLI, CRA, Fastify, Hono, NestJS, Flask)
- **Environment diagnostics**: `port-daddy doctor` checks daemon connectivity, port range, `.portdaddyrc` validity, Node.js version, and system port conflicts
- Unified CLI: Single `port-daddy` command with subcommands replacing separate shell scripts
- Semantic identities: `project:stack:context` naming for all services (e.g., `myapp:api:main`)
- JavaScript SDK (`lib/client.js`): Zero-dependency programmatic API for Node.js
- Pub/sub messaging: Real-time inter-service messaging with SSE subscriptions
- Distributed locks: Atomic lock/unlock with TTL and auto-cleanup
- Agent registry: Register, heartbeat, and discover active agents
- Webhooks: Subscribe to events with HMAC-signed payloads
- Activity logging: Full audit trail of all operations
- `.portdaddyrc` project config: Per-project service definitions with `needs` dependency graph, `env` injection, `healthPath`, `noPort` workers
- Dashboard: Dark-themed real-time web UI at `http://localhost:9876`
- Shell completions for bash and zsh
- Input validation with shared validation module
- Rate limiting: 100 req/min per IP, 10 concurrent SSE connections
- SSRF protection on webhook URLs
- 1078 tests across 19 suites (unit + integration)
- GitHub Actions CI across Node 18/20/22 on Ubuntu and macOS

### Changed
- Complete architectural rewrite from monolithic server.js to modular lib/ + routes/
- CLI rewritten from bash wrapper scripts to unified Node.js CLI
- Port assignment now uses semantic identity parsing
- All state in SQLite with WAL mode
- ESM throughout (import/export)

### Removed
- Separate `get-port`, `release-port`, `list-ports` shell scripts (replaced by unified CLI)
- `VERSION` file (version now in package.json)
- `migrations/` directory (schema inline in server.js)

## [1.2.0] - 2025-01-15

### Added
- Security hardening: input validation, rate limiting, parameterized queries
- npm packaging with cross-platform CLI tools
- GitHub Actions CI and release workflows

### Changed
- Improved error handling across all endpoints

## [1.1.0] - 2025-01-10

### Added
- Initial release
- Port assignment via HTTP API
- SQLite-backed persistence
- Process tracking with auto-cleanup
- Basic web dashboard
- Bash CLI tools (`get-port`, `release-port`, `list-ports`)
- macOS launchd daemon installer
