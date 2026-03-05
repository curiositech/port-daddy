# Changelog

All notable changes to Port Daddy will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.6.0] - 2026-03-03

### Added
- **Named flag alternatives** for all text-accepting commands — no more guessing positional args
  - `pd begin --purpose "text"` / `-P "text"` (also `--identity`/`-i`, `--type`/`-t`, `--agent`/`-a`)
  - `pd done --note "text"` / `-n "text"` (also `--status`/`-s`)
  - `pd note --content "text"` / `-c "text"` (also `--type`/`-t`)
  - `pd pub <ch> --message "text"` / `-m "text"`
  - `pd session start --purpose "text"` / `-P "text"`
  - `pd integration ready <id> --description "text"` / `-d "text"`
- **Interactive mode** — run any sugar command with no args in a TTY and get maritime-themed prompts
  - `pd begin` → wizard for purpose, identity, file claims
  - `pd done` → prompts for final note and status
  - `pd note` / `pd n` → prompts for content and note type
  - Auto-skipped in CI, non-TTY, and `PORT_DADDY_NON_INTERACTIVE` environments
- **`pd learn`** — Interactive tutorial that teaches Port Daddy using real daemon commands (8 lessons)
- **Dynamic port resolution** — CLI reads `/tmp/port-daddy-port` instead of hardcoding port 9876

### Changed
- All positional text args remain backward-compatible — flags are a new alternative, not a replacement
- Shell completions updated in all three shells (bash, zsh, fish) with new flags and `learn` command
- 11 new CLI integration tests for flag alternatives and backward compatibility

## [3.5.0] - 2026-03-02

### Added
- `pd begin` — Register agent + start session in one command (replaces 3-command ceremony)
- `pd done` — End session + unregister agent atomically
- `pd whoami` — Show current agent and session context
- `pd with-lock <name> <cmd>` — Execute command under distributed lock with auto-release
- CLI aliases: `n` (note), `u` (up), `d` (down)
- Sugar REST endpoints: `POST /sugar/begin`, `POST /sugar/done`, `GET /sugar/whoami`
- SDK methods: `pd.begin()`, `pd.done()`, `pd.whoami()`
- MCP tools: `begin_session`, `end_session_full`, `whoami`
- Dashboard redesigned: sidebar navigation, glassmorphism theme, 3 new panels
- Distribution freshness tests (51 tests ensuring all surfaces stay in sync)

### Changed
- Dashboard reduced from 2287 to 371 lines with modern glassmorphism design
- Agent sessions now use `.portdaddy/current.json` for local context tracking

## [3.4.0] - 2026-03-01

### Added
- **Local DNS records** (`lib/dns.ts`): Map service identities to `.local` hostnames for human-friendly URLs
  - `pd dns register myapp:api api.myapp.local` — create a DNS record
  - `pd dns list` — list all records; `pd dns lookup <hostname>` — resolve hostname to port
  - `pd dns cleanup` / `pd dns status` — maintenance commands
  - API: `POST/GET/DELETE /dns`, `GET /dns/lookup/:hostname`, `POST /dns/cleanup`, `GET /dns/status`
  - MCP: `dns_register`, `dns_lookup`, `dns_list`, `dns_cleanup`, `dns_status` tools
  - SDK: `dnsRegister()`, `dnsLookup()`, `dnsList()`, `dnsUnregister()`, `dnsCleanup()`, `dnsStatus()` methods
  - 75 unit tests
- **Briefing system** (`.portdaddy/`): Project-local agent intelligence layer
  - `pd briefing generate` — generate a briefing from project context
  - `pd briefing read` — read the current briefing
  - MCP: `briefing_generate`, `briefing_read` tools
  - 40+ unit tests
- **Session phases**: Track session lifecycle stages (`planning`, `in_progress`, `testing`, `reviewing`, `completed`, `abandoned`)
  - `pd session phase <session-id> <phase>` — set session phase
  - Shell completions in bash, zsh, fish
- **Global file claim view**: See all file claims across all sessions
  - `pd files` — list all claimed files
  - `pd who-owns <file>` — find which session owns a file
- **Integration signals** via pub/sub: Coordinate readiness between agents
  - `pd integration ready <service>` — signal a service is ready
  - `pd integration needs <service>` — request a dependency
  - `pd integration list` — list integration status
- **Parity enforcement** (3 new test suites):
  - `manifest-enforcement.test.js`: bidirectional feature-to-code parity checks
  - `mcp-parity.test.js`: MCP tool-to-manifest route coverage
  - `endpoint-parity.test.js`: CLI/MCP calls-to-server routes with regression guards

### Changed
- **API route consolidation**: `POST /claim` and `DELETE /release` now accept `id` in request body (no longer in URL path) for consistency with `POST /agents`
- **Agent heartbeat**: Route is now `POST /agents/:id/heartbeat` (was incorrectly documented as PUT)
- **Lock extend**: Now cleans expired locks before checking existence (consistent with acquire/check/list)
- **Rate limiter**: Skip rate limiting for Unix socket connections (local-only tool)

### Fixed
- **Daemon resilience — sleep detection**: Detect macOS sleep via timestamp gaps, pause agent reaper during 5-minute grace period to prevent false-positive agent deaths
- **TCP port fallback**: Try ports 9876–9886 if preferred port is busy; write actual port to `/tmp/port-daddy-port` for CLI discovery
- **SQLite integrity**: Verify WAL mode on init, run `PRAGMA integrity_check` on startup, `closeDatabase()` with WAL checkpoint on clean shutdown
- **Duplicate daemon detection**: Socket liveness probe + PID file prevents spawning multiple daemons
- **Non-blocking system ports scan**: Replaced `spawnSync('lsof')` with async background refresh (root cause of daemon freeze when lsof hangs system-wide)
- **Non-fatal TCP listener**: `EADDRINUSE` on port 9876 no longer crashes daemon (socket stays active)
- **Startup self-healing diagnostics**: `pd doctor` — 4 new checks (SQLite integrity, stale socket, PID staleness, stuck lsof processes)
- **MCP bug fixes**: `register_agent` uses `POST /agents` with id in body; `check_salvage` calls `/resurrection/pending`; `claim_salvage` calls `/resurrection/claim/:id`
- **Agent inbox**: `markAllRead` now only updates unread rows (accurate change count)
- **Adversarial integration tests**: Fixed 54 test failures — updated route patterns for v3.4 API, fixed hardcoded assertions, converted direct fetch calls to Unix socket helper, corrected API behavior expectations (idempotent release, lock TTL normalization, agent upsert)

### Tests
- 6 new unit test suites: `resurrection.test.js` (49), `tunnel.test.js` (29), `changelog.test.js` (54), `inbox.test.js` (48), `dns.test.js` (75), `briefing.test.js` (40+)
- 3 new parity enforcement suites
- Total: 1961 tests across 36 suites (all passing)

## [3.3.0] - 2026-02-27

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
