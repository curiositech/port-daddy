# Port Daddy

<p align="center">
  <img src="https://raw.githubusercontent.com/curiositech/port-daddy/main/assets/port_daddy_cover_art.webp" alt="Port Daddy" width="600">
</p>

<p align="center">
  <strong>Your ports. My rules. Zero conflicts.</strong>
</p>

<p align="center">
  <a href="https://npmjs.com/package/port-daddy"><img src="https://img.shields.io/npm/v/port-daddy.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/port-daddy.svg" alt="license"></a>
  <a href="https://github.com/curiositech/port-daddy"><img src="https://img.shields.io/badge/tests-1283%20passing-brightgreen" alt="tests"></a>
  <a href="package.json"><img src="https://img.shields.io/node/v/port-daddy.svg" alt="node"></a>
  <a href="https://github.com/curiositech/port-daddy/tree/main/skills/port-daddy-cli"><img src="https://img.shields.io/badge/AI%20Agents-40%2B%20compatible-blueviolet" alt="AI Agent Skill"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey" alt="platform"></a>
</p>

---

Port Daddy is a local daemon that manages dev server ports, starts your entire stack, and coordinates AI coding agents. It gives every service a stable port that never changes, replaces `docker-compose` for local dev with `pd up`, and provides sessions, notes, locks, and pub/sub messaging so multiple agents can work on the same codebase without stepping on each other.

One daemon. Many projects. Zero port conflicts.

**Jump to:** [Just Want Stable Ports?](#just-want-stable-ports) | [Run Your Whole Stack](#run-your-whole-stack) | [Agent Coordination](#agent-coordination) | [Sessions & Notes](#sessions--notes) | [CLI Reference](#cli-reference) | [API Reference](#api-reference)

---

## Just Want Stable Ports?

```bash
npm install -g port-daddy

pd claim myapp         # --> port 3100 (same port, every time)
pd claim myapp:api     # --> port 3101
pd claim myapp:web     # --> port 3102

pd release myapp:api   # free it
pd release myapp:*     # free them all
```

That's the whole workflow. `pd` is the short alias for `port-daddy` -- use whichever you prefer.

Use it with any dev server:

```bash
PORT=$(pd claim myproject -q) npm run dev -- --port $PORT
```

Ports persist across restarts. `myapp:api` always gets the same port on this machine.

### How naming works

Port Daddy uses `project:stack:context` identifiers. All three parts are optional:

| Identity | Meaning |
|----------|---------|
| `myapp` | Just the project |
| `myapp:api` | Project + stack (component) |
| `myapp:api:feature-auth` | Project + stack + context (branch/variant) |

Wildcards work everywhere: `pd find myapp:*`, `pd release *:api:*`.

### Install and verify

```bash
npm install -g port-daddy
pd start                    # start the daemon (auto-starts on first use too)
pd doctor                   # verify your environment
```

Auto-start on login (optional):

```bash
pd install                  # macOS (LaunchAgent) or Linux (systemd)
```

---

## Run Your Whole Stack

Scan your project. Start everything. One command.

```bash
cd your-project/
pd scan                     # auto-detect frameworks, generate .portdaddyrc
pd up                       # start all services in dependency order
pd down                     # graceful shutdown
```

`pd scan` walks your project recursively, detects 60+ frameworks (Next.js, Vite, Express, FastAPI, Django, Go, Rust, Workers, and more), handles monorepos and workspaces, and writes a `.portdaddyrc` config.

### How `pd up` works

1. Reads `.portdaddyrc` (or auto-discovers services)
2. Topological sort on the `needs` dependency graph
3. Claims ports from the daemon atomically
4. Injects `PORT`, `PORT_<SERVICE>`, and custom `env` vars
5. Spawns each service with color-coded, prefixed log output
6. Health-checks each service (configurable timeout)
7. Ctrl+C sends SIGTERM in reverse dependency order

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

```bash
pd up                       # start everything
pd up --service frontend    # start one service + its dependencies
pd up --branch              # include git branch in identity (myapp:api:feature-auth)
pd up --no-health           # skip health checks for faster startup
```

---

## Agent Coordination

Port Daddy includes built-in primitives for multi-agent and multi-process coordination. No external message broker required.

### Pub/Sub Messaging

```bash
# Agent A signals completion
pd pub build:api '{"status":"ready","port":3100}'

# Agent B listens
pd sub build:*
```

### Distributed Locks

```bash
# Exclusive access to database migrations
pd lock db-migrations
npx prisma migrate dev
pd unlock db-migrations

# Fail immediately if lock is held
pd lock db-migrations || echo "Lock held, skipping"
```

### Agent Registry

```bash
pd agent register --agent builder-1 --type cli
pd agent heartbeat --agent builder-1
pd agents                   # list all active agents
```

Agents that stop sending heartbeats for 2+ minutes are marked stale and their resources are automatically released.

---

## Sessions & Notes

Sessions replace flat-file coordination (`.CLAUDE_LOCK`, `.CLAUDE_NOTES.md`) with a structured, queryable system backed by SQLite. Each session tracks purpose, claimed files, and an append-only timeline of notes.

### Quick start

```bash
pd session start "Implementing OAuth flow" --files src/auth/* src/middleware/auth.ts
pd note "Started Google OAuth integration"
pd note "Switched to PKCE flow for SPAs" --type commit
pd note "Need to coordinate with Agent B on shared middleware" --type handoff

pd notes                    # view timeline across all sessions
pd sessions                 # list active sessions
pd session end "OAuth complete, ready for review"
```

### How it works

**Sessions** are mutable -- they move from `active` to `completed` or `abandoned`.
**Notes** are immutable -- append-only, never edited or deleted individually.
**File claims** are advisory -- they detect conflicts but don't enforce locks (use `pd lock` for enforcement).

```bash
# Session with file claims -- warns if another session claimed the same files
pd session start "Refactoring auth" --files src/auth/*
# --> Warning: src/auth/oauth.ts claimed by session-abc (Implementing OAuth flow)
# --> Use --force to claim anyway

# Quick note without an explicit session (auto-creates one)
pd note "Fixed the null check in auth.ts"

# View notes for a specific session
pd notes session-abc --limit 20 --type commit

# Clean up
pd session done             # alias for "session end" with status=completed
pd session abandon "Wrong approach, starting over"
pd session rm session-abc   # delete entirely (cascades to notes + file claims)
```

### Why this replaces `.CLAUDE_LOCK`

| Flat files | Sessions & Notes |
|------------|-----------------|
| Manual text editing | Structured CLI/SDK/API |
| No conflict detection | Advisory file claims with warnings |
| Stale locks rot | Garbage collection on stale sessions |
| No timeline | Immutable, queryable note history |
| Single file, many writers | Concurrent sessions, atomic operations |

---

## When NOT to Use Port Daddy

Be honest with yourself:

- **One project, one service** -- just hardcode your port. You don't need this.
- **No dev servers** -- if you're writing a library with only tests, there are no ports to manage.
- **Production** -- Port Daddy is a development tool. Use a service mesh, load balancer, or container orchestrator in production.
- **Windows** -- not supported yet. macOS and Linux only.

Port Daddy earns its keep when you have multiple projects, multiple services per project, or multiple agents launching dev servers simultaneously.

---

## JavaScript SDK

The SDK wraps every API endpoint with typed methods. Full reference: **[docs/sdk.md](docs/sdk.md)**

```javascript
import { PortDaddy } from 'port-daddy/client';
const pd = new PortDaddy();

// Ports
const { port } = await pd.claim('myapp:api');
await pd.release('myapp:api');

// Sessions
await pd.startSession({ purpose: 'Auth refactor', files: ['src/auth/*'] });
await pd.note('Switched to JWT');
await pd.endSession('Auth complete');

// Locks
await pd.withLock('db-migrations', async () => {
  await runMigrations();
});

// Pub/Sub
await pd.publish('builds', { status: 'complete' });
const sub = pd.subscribe('builds');
sub.on('message', (data) => console.log(data));
```

---

## AI Agent Skill

Port Daddy ships as a [Claude Code plugin](https://github.com/curiositech/port-daddy/tree/main/.claude-plugin) and a [Vercel Agent Skill](https://github.com/curiositech/port-daddy/tree/main/skills/port-daddy-cli), compatible with 40+ AI coding agents.

### Claude Code

```bash
/plugin marketplace add curiositech/port-daddy
/plugin install port-daddy
```

### Cursor, Windsurf, Cline, Aider, Codex CLI, and more

```bash
npx skills add curiositech/port-daddy
```

The skill teaches agents to claim ports with semantic identities, coordinate via pub/sub and locks, generate `.portdaddyrc` configs, use the SDK, and avoid common mistakes like hardcoded port numbers.

---

## CLI Reference

`pd` is the short alias for `port-daddy`. All commands accept `--json/-j` for machine output and `--quiet/-q` for minimal output.

### Ports & Services

| Command | Description |
|---------|-------------|
| `pd claim <id>` | Claim a port (`-q` for just the number, `--export` for `export PORT=N`) |
| `pd release <id>` | Release port(s) by identity or glob pattern |
| `pd find [pattern]` | List services (default: all) |
| `pd url <id>` | Get the URL for a service |
| `pd env [pattern]` | Export as environment variables |

### Orchestration

| Command | Description |
|---------|-------------|
| `pd up` | Start all services from `.portdaddyrc` or auto-detected |
| `pd up --service <name>` | Start one service and its dependencies |
| `pd down` | Graceful shutdown |
| `pd scan` | Deep-scan project, generate `.portdaddyrc` |
| `pd doctor` | Run environment diagnostics |

### Sessions & Notes

| Command | Description |
|---------|-------------|
| `pd session start <purpose>` | Start a session (`--files f1 f2...`) |
| `pd session end [note]` | End active session (completed) |
| `pd session done [note]` | Alias for end |
| `pd session abandon [note]` | End session as abandoned |
| `pd session rm <id>` | Delete session (cascades) |
| `pd session files add <paths>` | Claim files in active session |
| `pd session files rm <paths>` | Release files |
| `pd sessions` | List active sessions (`--all` for all) |
| `pd note <content>` | Quick note (`--type TYPE`) |
| `pd notes [session-id]` | View notes (`--limit N`, `--type TYPE`) |

### Coordination

| Command | Description |
|---------|-------------|
| `pd pub <channel> <msg>` | Publish a message |
| `pd sub <channel>` | Subscribe (real-time SSE) |
| `pd lock <name>` | Acquire a distributed lock |
| `pd unlock <name>` | Release a lock |
| `pd locks` | List all active locks |
| `pd channels` | List pub/sub channels |
| `pd wait <id> [...]` | Wait for service(s) to become healthy |

### Agents

| Command | Description |
|---------|-------------|
| `pd agent register` | Register as an agent (`--agent ID --type TYPE`) |
| `pd agent heartbeat` | Send heartbeat |
| `pd agents` | List all registered agents |

### System

| Command | Description |
|---------|-------------|
| `pd start` / `pd stop` / `pd restart` | Daemon management |
| `pd status` | Check if daemon is running |
| `pd install` / `pd uninstall` | System service (launchd/systemd) |
| `pd dashboard` | Open web dashboard in browser |
| `pd health [id]` | Health check (all or single service) |
| `pd ports` | Active port assignments (`--system` for well-known) |
| `pd metrics` | Daemon metrics |
| `pd config` | Resolved configuration |
| `pd log` | Activity log (`--from`/`--to` for time ranges) |

### Key Options

| Option | Description |
|--------|-------------|
| `-p, --port <n>` | Request a specific port |
| `--range <a>-<b>` | Acceptable port range |
| `--expires <dur>` | Auto-release (`2h`, `30m`, `1d`) |
| `-j, --json` | JSON output |
| `-q, --quiet` | Minimal output (just the value) |
| `--export` | Print `export PORT=N` for shell eval |
| `--ttl <ms>` | Lock time-to-live |

### Shell Completions

Tab completion for all commands with live service IDs, lock names, and agent IDs from the running daemon.

```bash
# Bash: add to ~/.bashrc
source /path/to/port-daddy/completions/port-daddy.bash

# Zsh: copy to fpath (before compinit)
cp /path/to/port-daddy/completions/port-daddy.zsh ~/.zsh/completions/_port-daddy

# Fish
cp /path/to/port-daddy/completions/port-daddy.fish ~/.config/fish/completions/
```

---

## API Reference

All endpoints are served from the daemon at `http://localhost:9876`.

```
GET    /health                  GET    /version
GET    /metrics                 GET    /config
POST   /claim/:id              DELETE /release/:id
GET    /services                GET    /services/health
POST   /sessions                GET    /sessions
GET    /sessions/:id            PUT    /sessions/:id
DELETE /sessions/:id            POST   /sessions/:id/notes
GET    /sessions/:id/notes      POST   /sessions/:id/files
POST   /notes                   GET    /notes
POST   /locks/:name             PUT    /locks/:name
DELETE /locks/:name             GET    /locks
POST   /msg/:channel            GET    /msg/:channel
GET    /subscribe/:channel      GET    /channels
POST   /agents/:id              GET    /agents
POST   /webhooks                GET    /webhooks/:id
POST   /scan                    GET    /projects
GET    /activity                GET    /activity/range
GET    /ports/active            POST   /ports/cleanup
```

---

## How It Works

Port Daddy runs as a lightweight daemon on `localhost:9876`. All state lives in SQLite -- port assignments, sessions, locks, messages, agent registrations -- so operations are atomic and survive restarts.

```
 CLI (pd)  ──┐
 SDK        ──┼──  Daemon (port 9876)  ──  SQLite
 HTTP API  ──┘         │
                  ┌────┼────┬────┬────┬────┬────┐
                  Ports Locks PubSub Agents Sessions Webhooks
```

The daemon auto-starts on first CLI use. No manual setup required unless you want it running as a system service.

### Configuration

**Project config** (`.portdaddyrc`): per-project service definitions. Generated by `pd scan` or written by hand. Also recognized: `.portdaddyrc.json`, `portdaddy.config.json`. Searched up the directory tree.

**Daemon config** (`config.json`): port ranges, rate limits, cleanup intervals.

**Environment overrides:**

```bash
PORT_DADDY_PORT=9999             # Daemon port
PORT_DADDY_RANGE_START=4000      # Port range start
PORT_DADDY_RANGE_END=5000        # Port range end
PORT_DADDY_URL=http://host:9876  # SDK/CLI daemon URL
PORT_DADDY_AGENT=my-agent        # Default agent ID
```

### Security

- **SSRF protection**: webhook URLs validated against private/internal addresses
- **Rate limiting**: 100 req/min per IP, 10 concurrent SSE connections
- **Input validation**: all inputs validated and sanitized
- **HMAC signing**: webhook payloads signed for verification
- **Parameterized queries**: no SQL injection

### Framework Detection (60+)

`pd scan` detects Next.js, Nuxt, SvelteKit, Remix, Astro, Vite, Angular, Express, Fastify, Hono, NestJS, FastAPI, Flask, Django, Rails, Laravel, Spring Boot, Go, Rust, Cloudflare Workers, Docker, Deno, Expo, Tauri, Electron, and 35+ more.

---

## License

MIT -- Created by [Erich Owens](https://github.com/erichowens) at [Curiositech LLC](https://curiositech.ai)
