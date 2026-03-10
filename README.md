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
  <a href="https://github.com/curiositech/port-daddy"><img src="https://img.shields.io/badge/tests-2845%20passing-brightgreen" alt="tests"></a>
  <a href="package.json"><img src="https://img.shields.io/node/v/port-daddy.svg" alt="node"></a>
  <a href="https://github.com/curiositech/port-daddy/tree/main/skills/port-daddy-cli"><img src="https://img.shields.io/badge/AI%20Agents-40%2B%20compatible-blueviolet" alt="AI Agent Skill"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey" alt="platform"></a>
</p>

---

Port Daddy is a local daemon that manages dev server ports, starts your entire stack, and coordinates AI coding agents. It gives every service a stable port that never changes, replaces `docker-compose` for local dev with `pd up`, and provides sessions, notes, locks, and pub/sub messaging so multiple agents can work on the same codebase without stepping on each other.

One daemon. Many projects. Zero port conflicts.

**Jump to:** [Just Want Stable Ports?](#just-want-stable-ports) | [Run Your Whole Stack](#run-your-whole-stack) | [Agent Coordination](#agent-coordination) | [Sessions & Notes](#sessions--notes) | [Changelog](#changelog) | [Local DNS](#local-dns-for-ports) | [Dashboard](#dashboard) | [Sugar Commands](#sugar-commands) | [Parity Coverage](#parity-coverage) | [CLI Reference](#cli-reference) | [API Reference](#api-reference)

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

New to Port Daddy? Run `pd learn` for a 5-minute interactive tutorial that walks you through ports, sessions, and coordination.

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
pd learn                    # interactive tutorial — learn the basics in 5 minutes
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
      "cmd": "npm run dev:api -- --port ${PORT}",
      "healthPath": "/health",
      "env": { "DATABASE_URL": "postgresql://localhost:5432/myapp" }
    },
    "frontend": {
      "cmd": "npm run dev -- --port ${PORT}",
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

Note: No `port` fields — Port Daddy assigns them automatically from the identity hash. See [Sharing Configs](#sharing-configs-with-your-team) for why.

```bash
pd up                       # start everything
pd up --service frontend    # start one service + its dependencies
pd up --branch              # include git branch in identity (myapp:api:feature-auth)
pd up --no-health           # skip health checks for faster startup
```

### Sharing Configs with Your Team

When you commit `.portdaddyrc` to version control, **omit the `port` field**. Port Daddy assigns ports deterministically from the identity hash — `myapp:api` always gets the same port on each machine.

```json
{
  "project": "myapp",
  "services": {
    "api": {
      "cmd": "npm run dev -- --port ${PORT}",
      "healthPath": "/health"
    },
    "frontend": {
      "cmd": "next dev --port ${PORT}",
      "needs": ["api"]
    }
  }
}
```

**Why?** Raw port numbers like `3847` are machine-local. They confuse your teammates ("what is this random port?"). By omitting ports, every developer gets consistent behavior: same identity → same port on their machine.

If you *need* a specific port (e.g., OAuth callbacks to `localhost:3000`), specify it. Otherwise, let Port Daddy handle it.

---

## Agent Coordination

Port Daddy includes built-in primitives for multi-agent and multi-process coordination. No external message broker required. If you only need ports, you can skip this section entirely.

### Quick Start (Agents)

Sugar commands handle the most common workflow -- register, work, finish -- in three commands:

```bash
pd begin "Implementing auth system"     # register agent + start session
pd note "Switched to JWT approach"      # log progress
pd done "Auth complete, tests passing"  # end session + unregister
```

These compose `agent register` + `session start` and `session end` + `agent unregister` atomically. Use `pd whoami` to check your current context.

### Agent Inbox

Every registered agent gets a personal inbox. Any caller can send; only registered agents can receive. Use DMs when you need targeted, persistent messaging rather than broadcast pub/sub.

```bash
# Send a message to another agent
pd inbox send agent-bob "Schema migration ready for your review"

# Read your inbox (unread messages)
pd inbox

# Inbox stats
pd inbox stats

# Mark all messages read
pd inbox read-all

# Clear inbox
pd inbox clear
```

Using the SDK:

```javascript
// Send a direct message
await pd.inboxSend('agent-bob', 'Migrations complete, ready for review', {
  from: 'agent-alice',
  type: 'handoff',
});

// Read unread messages
const { messages } = await pd.inboxList('agent-bob', { unreadOnly: true });
for (const msg of messages) {
  console.log(`[${msg.type}] From ${msg.from ?? 'system'}: ${msg.content}`);
  await pd.inboxMarkRead('agent-bob', msg.id);
}

// Stats and housekeeping
const { total, unread } = await pd.inboxStats('agent-bob');
await pd.inboxClear('agent-bob');
```

**Inbox vs pub/sub:** Use the inbox for targeted, persistent messages between specific agents (handoffs, blockers, task results). Use pub/sub for broadcast signals that any subscriber can hear. Inbox messages survive until read or cleared; pub/sub messages are ephemeral.

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
# Register with semantic identity (project:stack:context) for smart salvage filtering
pd agent register --agent builder-1 --name "API Builder" --type cli \
  --identity myapp:backend:feature-payments \
  --purpose "Building the payment API"

pd agent heartbeat --agent builder-1
pd agents                   # list all active agents
```

Agents that stop sending heartbeats are marked stale (10min) then dead (20min).

When you register, Port Daddy checks for dead agents in the same project and shows an auto-salvage notice:

```
⚓ Registered: builder-1
⚠️  Salvage notice: 2 dead agents in myapp:*:* need recovery.
   Run: pd salvage --project myapp
```

### Agent Resurrection (Salvage)

When an agent dies mid-task, its work isn't lost. Port Daddy captures session state and notes for salvage:

```bash
# See dead agents in your project (context-aware by default)
pd salvage --project myapp

# Sample output:
# ⚓ Salvage Report myapp:*:*
# ────────────────────────────────────────────────────────────
#
# ☠ builder-1 (dead, 15m)
#   Identity: myapp:backend:feature-payments
#   Purpose: Building the payment API
#   Session: session-a1b2c3
#   Notes:
#     - Finished Stripe integration, starting PayPal
#     - Need to handle webhooks for refunds
#   Salvage: pd salvage claim builder-1

# Claim the dead agent's session and continue their work
pd salvage claim builder-1

# See ALL dead agents globally (use sparingly)
pd salvage --all

# Dismiss after review (nothing to recover)
pd salvage dismiss builder-1
```

**Pro tip:** Register with `--identity` and `--purpose` so salvaging agents know what you were doing and which project you were in.

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

## Changelog

Port Daddy maintains a hierarchical changelog that rolls up changes by identity. When you complete meaningful work, record it:

```bash
# Record a change
pd changelog add myapp:api:auth "Added JWT refresh token endpoint" --type feature

# With detailed description
pd changelog add myapp:frontend "Fixed mobile nav overlap" --type fix \
  --description "Nav was overlapping content on iOS Safari viewport"

# List recent changes
pd changelog list

# Filter to a specific identity (includes children)
pd changelog list --identity myapp:api

# Different output formats
pd changelog list --format tree          # hierarchical tree view
pd changelog list --format flat          # simple list
pd changelog list --format keep-a-changelog   # standard changelog format
```

### Hierarchical rollup

Changes roll up automatically:
- `myapp:api:auth` appears under `myapp:api` which appears under `myapp`
- Query `myapp` to see all changes across the entire project
- Query `myapp:api` to see all API changes

### Change types

| Type | When to use |
|------|-------------|
| `feature` | New functionality |
| `fix` | Bug fixes |
| `refactor` | Code restructuring |
| `docs` | Documentation updates |
| `chore` | Maintenance tasks |
| `breaking` | Breaking changes |

### Changelog SDK

The JavaScript SDK exposes the same changelog operations:

```javascript
// Log what was accomplished
await pd.addChangelog({
  identity: 'myapp:api',
  summary: 'Auth complete',
  type: 'feature',
});

// List recent entries
const { entries } = await pd.listChangelog({ limit: 10 });

// Filter by identity and all children
const { entries } = await pd.listChangelogTree('myapp:api');

// All tracked identities
const { identities } = await pd.changelogIdentities();
```

---

## Multi-Agent Patterns

Port Daddy turns independent agents into a coordinated swarm. Here's what becomes possible:

### The War Room

Three agents attack a bug from different angles, sharing discoveries in real-time:

```bash
# Terminal 1: Watch the war room channel
pd sub war-room-bug-123

# Terminal 2-4: Spawn specialist agents (see examples/war-room/)
./historian.sh bug-123 "TypeError: Cannot read property 'id'"
./tracer.sh bug-123 "src/api/users.ts:42"
./scout.sh bug-123 "property 'id' of undefined"
```

What you see:
```
[14:23:01] 📍 [historian] Starting git archaeology
[14:23:02] 📍 [tracer]    Instrumenting src/api/users.ts:42
[14:23:03] 💡 [scout]     Found working pattern in src/api/posts.ts:87
[14:23:04] 💡 [historian] Bug introduced in commit a4f2c1
[14:23:05] 💡 [tracer]    user is undefined with expired session
[14:23:06] 🎯 [scout]     CORRELATION: All findings converge - fix is user?.id
```

**45 seconds to root cause.** A human would take 20+ minutes.

### More Patterns

| Pattern | What It Does |
|---------|--------------|
| **30-Second Architecture Review** | 5 agents review a spec simultaneously (schema, API, security, cost, UX) |
| **Adversarial Hardening** | Attacker agent fuzzes, defender agent patches, code evolves |
| **Living Documentation** | Agents watch file changes, auto-update docs/tests/changelog |
| **Speculative Execution** | Agents build multiple options in parallel while you decide |

See `examples/` for working implementations of each pattern.

### The Key Insight

The bottleneck was never intelligence. It was coordination.

One brilliant agent working alone is like one brilliant human working alone. A swarm of coordinated agents is a hive mind that thinks at the speed of silicon.

---

## Local DNS for Ports

Tired of remembering `localhost:3847`? Use semantic names instead:

```bash
# Claim with DNS registration
pd claim myapp:api --dns
# → Port 3847 claimed
# → Registered: myapp-api.local

curl http://myapp-api.local/health
# Works!
```

Every claimed service can get a `.local` domain:

```bash
pd claim frontend:react --dns    # → frontend-react.local
pd claim backend:graphql --dns   # → backend-graphql.local

# List all DNS registrations
pd dns list
# myapp-api.local       → 127.0.0.1:3847
# frontend-react.local  → 127.0.0.1:3156
# backend-graphql.local → 127.0.0.1:4000
```

**Requirements:**
- **macOS**: Works out of the box (mDNS/Bonjour built-in)
- **Linux**: Install `avahi-daemon` (`apt install avahi-daemon` or equivalent)
- **Windows**: Not supported yet

**Use cases:**
- OAuth callbacks that require consistent URLs
- Microservices that need to discover each other by name
- Documentation and README examples that don't use magic port numbers

---

## Dashboard

Port Daddy includes a full-featured web dashboard at `http://localhost:9876` with 15 panels:

| Panel | What it shows |
|-------|--------------|
| Services | Active port claims with identity, port, DNS status |
| Agents | Registered agents with heartbeat status and liveness |
| Sessions | Active and recent sessions with phase progression |
| Locks | Distributed locks with TTL countdown |
| Messaging | Pub/sub channels with message counts |
| DNS | DNS records and /etc/hosts resolver status |
| Activity | Real-time activity log with filters |
| Salvage | Dead agent resurrection queue by project |
| Integration | Cross-agent readiness signals |
| Briefing | Project briefing summaries |
| Sugar Context | Current begin/done session state |
| Ports | System port overview and conflicts |
| Projects | Registered projects from `pd scan` |
| Health | Service health checks and daemon status |
| Notes | Recent notes timeline across all sessions |

The dashboard uses a glassmorphism dark theme with a collapsible sidebar. Screenshots:

![Dashboard Overview](screenshots/pd1.png)
![Agent & Session Panels](screenshots/pd2.png)
![DNS & Activity Panels](screenshots/pd3.png)
![Messaging & Locks](screenshots/pd4.png)

---

## Session Phases (`session_phases`)

Sessions progress through 6 phases for structured workflow tracking:

| Phase | Meaning |
|-------|---------|
| `setup` | Initial configuration, claiming files |
| `planning` | Reviewing context, deciding approach |
| `implementing` | Writing code |
| `testing` | Running tests, verifying |
| `reviewing` | Code review, final checks |
| `cleanup` | Releasing resources, writing notes |

```bash
pd session phase my-session implementing    # advance to implementing
pd session phase my-session testing         # advance to testing
```

Phases are monotonically increasing -- you can only move forward, not backward.

---

## Region-Level File Claims

File claims can specify exact regions within files using line numbers or symbol names:

```bash
# Claim specific lines
pd session files claim my-session src/auth.ts --start-line 10 --end-line 50

# Claim by symbol name
pd session files claim my-session src/auth.ts --symbol "AuthService"

# Check who owns a region
pd who-owns src/auth.ts --line 25
```

Region claims enable multiple agents to work on the same file without conflicts, as long as their regions don't overlap.

---

## Global File Claims

Check file ownership across all active sessions:

```bash
pd files                    # list all claimed files across sessions
pd who-owns src/auth.ts     # which session owns this file?
```

---

## Integration Signals

Agents can declare readiness and dependencies:

```bash
pd integration ready my-session api     # "I'm done with the API"
pd integration needs my-session api     # "I need the API to be ready"
pd integration list                     # show all signals
```

When an agent marks something as `ready`, any agent waiting on that signal via `needs` is unblocked. This enables coordination without polling.

---

## Briefing System

Get a project-level summary of what's happening:

```bash
pd briefing myapp    # summary of active agents, sessions, signals
```

The briefing includes active sessions, pending salvage, integration signals, and recent notes -- everything a new agent needs to get up to speed.

---

## Agent Liveness & Readiness

Agents send heartbeats to prove they're alive. The adaptive reaper adjusts thresholds based on agent behavior:

- **Stale**: No heartbeat for 10 minutes
- **Dead**: No heartbeat for 20 minutes (enters salvage queue)

Readiness checks verify agents are actually making progress, not just alive:

```bash
pd agent heartbeat --agent my-agent     # send heartbeat
pd agents                               # see liveness status
```

---

## Sugar Commands

Compound operations that combine agent registration + session start in one call:

```bash
pd begin "Building auth system"           # register + start session
pd done "Auth complete, tests passing"    # end session + unregister
pd whoami                                 # show current agent/session context
pd with-lock db-migrations -- npm run migrate  # run command under lock
```

These are the recommended way to start and end work. They handle cleanup automatically.

---

## pd spawn — AI Agent Launcher

Launch AI agents (local or cloud) with Port Daddy coordination auto-wired. All backends automatically register with the daemon, send heartbeats, and enter the salvage queue if they crash.

```bash
# Spawn a local Ollama agent (requires: ollama serve)
pd spawn --backend ollama --model llama3 --identity myapp:coder --purpose "Refactor auth" -- "Fix the login bug in src/auth.ts"

# Spawn using the Claude SDK (NOT the claude CLI — no subprocess overhead)
pd spawn --backend claude --model claude-haiku-4-5-20251001 --identity myapp:reviewer -- "Review PR #42 for security issues"

# Spawn with Aider (git-native coding agent, real subprocess)
pd spawn --backend aider --model gemini/gemini-flash --identity myapp:refactor -- src/auth.ts src/middleware.ts

# Spawn a custom command
pd spawn --backend custom --identity tools:formatter -- "npx prettier --write src/"

# List running spawned agents
pd spawned

# Kill a spawned agent
pd spawn kill <agentId>
```

### Backends

| Backend | Description | Notes |
|---------|-------------|-------|
| `ollama` | Local Ollama daemon | Requires `ollama serve`. HTTP to `localhost:11434`. |
| `claude` | Anthropic SDK direct | Uses `@anthropic-ai/sdk`. Do NOT use `claude` CLI subprocess — 7x token overhead. |
| `gemini` | Google Generative AI | Free tier available. Gemini Flash default. |
| `aider` | Aider subprocess | Git-native, commit-per-step. Stdout captured as PD notes. |
| `custom` | Shell command | Generic wrapper. Task passed as first argument. |

### Auto-wired coordination

Every spawned agent automatically:
- Registers with PD (`pd agent register --identity ... --purpose ...`)
- Starts a session (`pd begin`)
- Sends heartbeats every 30 seconds
- On exit: ends session (`pd done`)
- On crash: enters salvage queue after 10 minutes

```bash
# After spawning, see the agent in the registry
pd agents

# If it crashes, salvage its session
pd salvage
```

---

## pd watch — Ambient Agent Kernel

Run a script whenever a message arrives on a pub/sub channel. The `--exec` script runs as a subprocess with the message available in the environment.

```bash
# Fire a script every time something publishes to "build-results"
pd watch build-results --exec ./handle-build.sh

# The script receives:
#   PD_MESSAGE         — raw message string
#   PD_MESSAGE_CONTENT — parsed content (same as PD_MESSAGE for plain strings)
#   PD_CHANNEL         — channel name
#   PD_TIMESTAMP       — ISO 8601 timestamp

# Example handler
cat handle-build.sh
# #!/bin/bash
# echo "Build event: $PD_MESSAGE_CONTENT"
# if [[ "$PD_MESSAGE_CONTENT" == *"failed"* ]]; then
#   pd pub alerts "Build failed — paging on-call"
# fi

# The watch command auto-reconnects on SSE disconnect (2s backoff)
# Press Ctrl+C to stop watching
```

### Always-on agents

Combine `pd spawn` + `pd watch` for ambient agents that act without human prompting:

```bash
# Publish a message to trigger spawned agents
pd pub code-review '{"pr": 42, "files": ["src/auth.ts"]}'

# An always-on watcher spawns a reviewer agent for each PR event
pd watch code-review --exec ./spawn-reviewer.sh
```

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

## Parity Coverage

Every feature is available across multiple surfaces. This table shows what works where:

| Feature | CLI | SDK | MCP | Dashboard |
|---------|:---:|:---:|:---:|:---------:|
| Claim/release ports | yes | yes | yes | yes |
| List services | yes | yes | yes | yes |
| Health checks | yes | yes | yes | yes |
| Sessions (start/end) | yes | yes | yes | yes |
| Notes (add/list) | yes | yes | yes | yes |
| File claims | yes | yes | yes | yes |
| Sugar (begin/done/whoami) | yes | yes | yes | -- |
| Distributed locks | yes | yes | yes | yes |
| Pub/sub messaging | yes | yes | yes | yes |
| Agent registry | yes | yes | yes | yes |
| Agent heartbeat | yes | yes | yes | -- |
| Salvage/resurrection | yes | yes | yes | -- |
| Changelog | yes | yes | -- | -- |
| Local DNS | yes | yes | yes | -- |
| Tunnels | yes | yes | yes | -- |
| Webhooks | yes | yes | -- | -- |
| Project scanning | yes | yes | yes | yes |
| Orchestration (up/down) | yes | yes | -- | -- |
| Activity log | yes | yes | yes | yes |
| Briefing | yes | -- | yes | -- |
| Integration signals | yes | -- | yes | -- |

**CLI** = `pd` command. **SDK** = `PortDaddy` class ([docs/sdk.md](docs/sdk.md)). **MCP** = AI agent tools (45 tools across 12 categories). **Dashboard** = web UI at `http://localhost:9876`.

---

## CLI Reference

`pd` is the short alias for `port-daddy`. All commands accept `--json/-j` for machine output and `--quiet/-q` for minimal output.

### Sugar Commands (Start Here)

| Command | Description |
|---------|-------------|
| `pd begin <purpose>` | Register agent + start session atomically |
| `pd done [note]` | End session + unregister agent |
| `pd whoami` | Show current agent/session context |
| `pd with-lock <name> -- <cmd>` | Run command while holding a lock |
| `pd learn` | Interactive tutorial (5 minutes) |

Aliases: `pd n` = `pd note`, `pd u` = `pd up`, `pd d` = `pd down`.

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

### Projects

| Command | Description |
|---------|-------------|
| `pd projects` | List all registered projects (alias: `pd p`) |
| `pd projects <id>` | Get project details |
| `pd projects rm <id>` | Remove a project from registry |

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
| `pd session phase <id> <phase>` | Advance session to next phase |
| `pd files` | List all claimed files across sessions |
| `pd who-owns <file>` | Check which session owns a file |

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
| `pd integration ready <session> <signal>` | Declare a signal as ready |
| `pd integration needs <session> <signal>` | Declare a dependency on a signal |
| `pd integration list` | List all integration signals |
| `pd briefing <project>` | Get project briefing summary |

### Agents

| Command | Description |
|---------|-------------|
| `pd agent register` | Register as an agent (`--agent ID --type TYPE --identity project:stack:context --purpose "..."`) |
| `pd agent heartbeat` | Send heartbeat |
| `pd agents` | List all registered agents |
| `pd salvage` | Check for dead agents (`--project`, `--stack`, `--all`, `--limit`) |
| `pd salvage claim <id>` | Claim a dead agent's session |
| `pd salvage complete <old> <new>` | Mark resurrection complete |
| `pd salvage abandon <id>` | Return agent to queue |
| `pd salvage dismiss <id>` | Remove from queue (reviewed) |

### Spawning Agents

| Command | Description |
|---------|-------------|
| `pd spawn -- <task>` | Launch an AI agent (`--backend ollama\|claude\|gemini\|aider\|custom`, `--model`, `--identity`, `--purpose`) |
| `pd spawned` | List active spawned agents |
| `pd spawn kill <id>` | Kill a spawned agent |
| `pd watch <channel>` | Subscribe to channel and run `--exec <script>` on each message |

### Webhooks

| Command | Description |
|---------|-------------|
| `pd webhook add <url>` | Register webhook (`--events claim,release --secret KEY`) |
| `pd webhook list` | List all webhooks |
| `pd webhook get <id>` | Get webhook details |
| `pd webhook update <id>` | Update webhook settings |
| `pd webhook rm <id>` | Remove a webhook |
| `pd webhook test <id>` | Send a test delivery |
| `pd webhooks events` | List available event types |
| `pd webhooks deliveries <id>` | View delivery history |

### Tunnels

| Command | Description |
|---------|-------------|
| `pd tunnel start <id>` | Start a tunnel (`--provider ngrok\|cloudflared\|localtunnel`) |
| `pd tunnel stop <id>` | Stop a tunnel |
| `pd tunnel status <id>` | Get tunnel status |
| `pd tunnel list` | List all active tunnels |
| `pd tunnel providers` | Check which providers are installed |

### Changelog

| Command | Description |
|---------|-------------|
| `pd changelog add <id> <summary>` | Record a change (`--type TYPE --description "..."`) |
| `pd changelog list` | List recent changes |
| `pd changelog list --identity <id>` | Filter to an identity (includes children) |
| `pd changelog list --format tree` | Output as hierarchical tree |

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
| `pd learn` | Interactive tutorial (12 lessons) |
| `pd doctor` | Verify environment and daemon health |

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
POST   /claim                   DELETE /release
GET    /services                GET    /services/health
POST   /sugar/begin             POST   /sugar/done
GET    /sugar/whoami
POST   /sessions                GET    /sessions
GET    /sessions/:id            PUT    /sessions/:id
DELETE /sessions/:id            POST   /sessions/:id/notes
GET    /sessions/:id/notes      POST   /sessions/:id/files
POST   /notes                   GET    /notes
POST   /locks/:name             PUT    /locks/:name
DELETE /locks/:name             GET    /locks
POST   /msg/:channel            GET    /msg/:channel
GET    /msg/:channel/subscribe  GET    /channels
POST   /agents                  GET    /agents
GET    /agents/:id              DELETE /agents/:id
POST   /agents/:id/heartbeat
POST   /agents/:id/inbox        GET    /agents/:id/inbox
GET    /agents/:id/inbox/stats  PUT    /agents/:id/inbox/read-all
DELETE /agents/:id/inbox
GET    /resurrection            GET    /resurrection/pending
POST   /resurrection/claim/:id  POST   /resurrection/reap
POST   /dns                     GET    /dns
GET    /dns/lookup/:hostname    POST   /dns/cleanup
GET    /dns/status
POST   /changelog               GET    /changelog
GET    /changelog/identities
POST   /webhooks                GET    /webhooks/:id
POST   /scan                    GET    /projects
GET    /activity                GET    /activity/range
GET    /ports/active            POST   /ports/cleanup
POST   /tunnel/:id             DELETE /tunnel/:id
GET    /tunnel/:id              GET    /tunnels
GET    /tunnel/providers
GET    /dns                     POST   /dns/:id
GET    /dns/:id                 DELETE /dns/:id
GET    /dns/status              POST   /dns/setup
POST   /dns/teardown            POST   /dns/sync
GET    /dns/resolver            POST   /dns/cleanup
POST   /briefing                GET    /briefing/:project
PUT    /sessions/:id/phase      POST   /sessions/:id/files
DELETE /sessions/:id/files      GET    /sessions/:id/files
GET    /changelog/session/:sessionId
GET    /changelog/agent/:agentId
GET    /changelog/:identity
POST   /sugar/begin             POST   /sugar/done
GET    /sugar/whoami
POST   /agents/:id/inbox        GET    /agents/:id/inbox
DELETE /agents/:id/inbox        GET    /agents/:id/inbox/stats
GET    /wait/:id
```

**Agent Inbox Routes:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/agents/:id/inbox` | POST | Send message to agent inbox |
| `/agents/:id/inbox` | GET | Read inbox (`?unread=true&limit=50`) |
| `/agents/:id/inbox/stats` | GET | Inbox stats (total, unread) |
| `/agents/:id/inbox/read-all` | PUT | Mark all messages read |
| `/agents/:id/inbox` | DELETE | Clear inbox |

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
