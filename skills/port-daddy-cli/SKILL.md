---
name: port-daddy-cli
description: Multi-agent coordination via Port Daddy. Use when starting dev servers, coordinating with other agents, preventing file conflicts, salvaging dead agents' work, or tracking changes. Activate on "port conflict", "claim port", "coordinate agents", "start session", "leave note", "file conflict", "dev server", "salvage", "briefing", "dns".
---

# Port Daddy v3.6 — Multi-Agent Coordination

**Your ports. My rules. Zero conflicts.**

Port Daddy is the authoritative port manager for multi-agent development. Daemon on `localhost:9876`, SQLite-backed, with CLI (`pd`), SDK, and MCP interfaces.

## Quick Start: Sugar Commands

**Use `pd begin` / `pd done` for every session.** These replace the old 3-command ceremony. All commands support positional args, named flags (`--purpose`), short flags (`-P`), and interactive mode (no args in TTY).

```bash
# Interactive mode — just run with no args, get prompted
pd begin

# Positional (backward compatible)
pd begin "Implementing dark mode" --files src/theme.ts src/components/ThemeProvider.tsx

# Named flags (equivalent)
pd begin --purpose "Implementing dark mode" --identity myapp:ui:darkmode

# Short flags
pd begin -P "Implementing dark mode" -i myapp:ui:darkmode

# Add notes as you work
pd note "Created ThemeProvider skeleton"
pd n -c "CSS variables approach chosen" -t decision

# Check your current context
pd whoami

# Finish (ends session + unregisters agent atomically)
pd done "Theme system complete"
pd done --note "Theme system complete" --status completed
```

New to Port Daddy? Run `pd learn` for an interactive tutorial.

If `pd begin` fails, the agent registration is rolled back. If you don't provide `--agent`, an ID is auto-generated. Identity is auto-detected from `package.json` if available.

### Sugar Command Reference

| Command | What it does | Replaces |
|---------|-------------|----------|
| `pd begin [purpose]` | Register agent + start session (`-P`, `-i`, `-t`, `--files`) | `pd agent register` + `pd session start` |
| `pd done [note]` | End session + unregister agent (`-n`, `-s`) | `pd session end` + `pd agent unregister` |
| `pd whoami` | Show current agent/session context | Manual ID tracking |
| `pd with-lock <name> <cmd...>` | Lock + exec + unlock | `pd lock` + run + `pd unlock` |
| `pd n [text]` | Quick note (`-c`, `-t`) | `pd note "text"` |
| `pd u` | Start all services | `pd up` |
| `pd d` | Stop all services | `pd down` |
| `pd learn` | Interactive tutorial | — |

## Before Starting Any Dev Server

```bash
PORT=$(pd claim myproject:frontend -q)
npm run dev -- --port $PORT
```

## Core Workflow

### 1. Check for Dead Agents First

```bash
pd salvage                              # Check for dead agents
pd salvage claim <dead-agent-id>        # Claim dead agent's work
```

Always check salvage at session start — another agent may have died mid-task.

### 2. Check File Ownership Before Editing

```bash
pd who-owns src/auth.ts                # Check who has a file
pd files                               # List all active file claims
```

### 3. Leave Notes as You Work

```bash
pd note "Finished auth module refactor"
pd note "Blocked on design tokens" --type blocker
pd note "Handing off to frontend agent" --type handoff
```

Note types: `progress`, `decision`, `blocker`, `question`, `handoff`, `general`

## Port Management

```bash
pd claim myapp:api              # Claim a port
pd claim myapp -q               # Quiet mode (port number only)
pd find                         # List all services
pd find 'myapp:*'               # Find by pattern
pd release myapp:api            # Release a service
```

## Locks

```bash
pd lock db-migrations           # Acquire lock
pd lock my-lock --ttl 60000     # Lock with 1 minute TTL
pd locks                        # List all locks
pd unlock my-lock               # Release lock

# Run command under lock (auto-releases even on failure/signal)
pd with-lock db-migrations npm run migrate
```

## Integration Signals

Coordinate between agents working on different parts:

```bash
pd integration ready myapp:api "Auth endpoints ready for frontend"
pd integration needs myapp:frontend "Needs API auth endpoints"
pd integration list --project myapp
```

## DNS Records

Map services to friendly `.local` hostnames:

```bash
pd dns register myapp:api --port 3100   # Creates myapp-api.local
pd dns lookup myapp:api                 # Resolve hostname
pd dns list                             # List all records
```

## Briefing

Generate a project intelligence snapshot for new agents:

```bash
pd briefing                    # Write .portdaddy/briefing.md
pd briefing --full             # Include archives + activity.log
pd briefing --json             # JSON output (no disk write)
```

## Semantic Identity Format

`project:stack:context` naming:
- `myapp` — just the project
- `myapp:api` — project + stack
- `myapp:api:feature-auth` — full identity

Wildcards: `myapp:*`, `*:api:*`, `myapp:*:feature-*`

Same identity = same port, every time.

## MCP Tool Mapping

Every CLI command that communicates with the daemon has an MCP equivalent. The table below maps CLI commands to their MCP tool names and calls out differences in naming, parameters, or capability.

### Sugar (Compound Workflows)

| CLI Command | MCP Tool | Notes |
|-------------|----------|-------|
| `pd begin [purpose]` | `begin_session` | Preferred entry point — register + start session atomically |
| `pd done [note]` | `end_session_full` | Preferred exit point — end session + unregister agent atomically |
| `pd whoami` | `whoami` | MCP requires `agent_id` param; CLI reads from `.portdaddy/current.json` |

### Port Management

| CLI Command | MCP Tool | Notes |
|-------------|----------|-------|
| `pd claim <id>` | `claim_port` | CLI param is positional; MCP uses `identity` field |
| `pd release <id>` | `release_port` | MCP adds `expired_only` flag not exposed in CLI |
| `pd find [pattern]` | `list_services` | Same filter semantics; MCP field is `pattern` |
| `pd find <id>` | `get_service` | MCP `get_service` is a distinct tool; CLI uses same `find` command |
| `pd services health` | `health_check` | MCP unifies single-service and all-services into one tool via optional `identity` |

### Sessions and Notes

| CLI Command | MCP Tool | Notes |
|-------------|----------|-------|
| `pd session start` | `start_session` | Low-level; prefer `begin_session` / `pd begin` |
| `pd session end` | `end_session` | Low-level; prefer `end_session_full` / `pd done` |
| `pd session list` | `list_sessions` | MCP `all` boolean maps to CLI `--all` flag |
| `pd session files claim` | `claim_files` | MCP requires explicit `session_id`; CLI infers from context |
| `pd note "text"` | `add_note` | Both support `--type`; MCP `session_id` is optional (quick note) |
| `pd n "text"` | `add_note` | `pd n` is an alias for `pd note` |
| `pd notes` | `list_notes` | MCP `session_id` optional for cross-session view |

### Locks

| CLI Command | MCP Tool | Notes |
|-------------|----------|-------|
| `pd lock <name>` | `acquire_lock` | MCP `name` field maps to CLI positional arg |
| `pd unlock <name>` | `release_lock` | MCP adds `force` flag |
| `pd locks` | `list_locks` | MCP adds `owner` filter |
| `pd with-lock <name> <cmd>` | **No MCP equivalent** | Shell exec under lock; inherently a CLI operation |

### Agents

| CLI Command | MCP Tool | Notes |
|-------------|----------|-------|
| `pd agent register` | `register_agent` | Low-level; prefer `begin_session` |
| `pd agent heartbeat` | `agent_heartbeat` | MCP agents must heartbeat manually; CLI sugar handles this |
| `pd agent list` | `list_agents` | MCP adds `active_only` filter |
| `pd agent unregister` | **No dedicated MCP tool** | Use `end_session_full` which unregisters atomically |

### Salvage (Agent Resurrection)

| CLI Command | MCP Tool | Notes |
|-------------|----------|-------|
| `pd salvage` | `check_salvage` | MCP adds `project` filter; CLI shows all |
| `pd salvage claim <id>` | `claim_salvage` | MCP requires both `dead_agent_id` and `new_agent_id` |

### File Ownership

| CLI Command | MCP Tool | Notes |
|-------------|----------|-------|
| `pd who-owns <path>` | `who_owns_file` | Exact equivalents |
| `pd files` | `list_file_claims` | Global view across all sessions |

### DNS

| CLI Command | MCP Tool | Notes |
|-------------|----------|-------|
| `pd dns register <id> --port N` | `dns_register` | MCP adds optional `hostname` override |
| `pd dns unregister <id>` | `dns_unregister` | Exact equivalents |
| `pd dns list` | `dns_list` | MCP adds `pattern` and `limit` params |
| `pd dns lookup <id>` | `dns_lookup` | Exact equivalents |
| `pd dns cleanup` | `dns_cleanup` | Exact equivalents |
| `pd dns status` | `dns_status` | Exact equivalents |

### Integration Signals

| CLI Command | MCP Tool | Notes |
|-------------|----------|-------|
| `pd integration ready <id> "msg"` | `integration_ready` | MCP field is `description`; CLI uses positional arg |
| `pd integration needs <id> "msg"` | `integration_needs` | Same as above |
| `pd integration list` | `integration_list` | MCP adds `project` filter |

### Messaging

| CLI Command | MCP Tool | Notes |
|-------------|----------|-------|
| `pd pub <channel> <payload>` | `publish_message` | MCP `payload` is a JSON object; CLI accepts a string |
| `pd sub <channel>` | **No MCP equivalent** | SSE subscription is inherently a streaming CLI operation |
| `pd messages <channel>` | `get_messages` | Exact equivalents |

### Briefing

| CLI Command | MCP Tool | Notes |
|-------------|----------|-------|
| `pd briefing` | `briefing_generate` | MCP requires `project_root`; CLI defaults to cwd |
| `pd briefing --json` | `briefing_read` | MCP returns data in-band; CLI writes files to disk |

### Tunnels

| CLI Command | MCP Tool | Notes |
|-------------|----------|-------|
| `pd tunnel start <id>` | `start_tunnel` | MCP adds optional `provider` param |
| `pd tunnel stop <id>` | `stop_tunnel` | Exact equivalents |
| `pd tunnel list` | `list_tunnels` | Exact equivalents |

### Project Scanning

| CLI Command | MCP Tool | Notes |
|-------------|----------|-------|
| `pd scan [dir]` | `scan_project` | MCP adds `dry_run` flag |

### System and Observability

| CLI Command | MCP Tool | Notes |
|-------------|----------|-------|
| `pd status` | `daemon_status` | MCP aggregates health + version + metrics into one call |
| `pd activity` | `activity_log` | MCP adds `type` filter |
| `pd session phase <id> <phase>` | `set_session_phase` | Direct equivalents |

### CLI-Only Commands (No MCP Equivalent)

These commands have no MCP tool because they depend on the local shell environment, TTY interaction, or produce output only meaningful in a terminal:

| CLI Command | Why No MCP Tool |
|-------------|-----------------|
| `pd with-lock <name> <cmd>` | Executes a shell command as a subprocess — inherently a CLI/shell operation |
| `pd sub <channel>` | SSE streaming subscription — requires a persistent terminal connection |
| `pd up` / `pd u` | Orchestrates service start-up using local process management |
| `pd down` / `pd d` | Orchestrates service shutdown using local process management |
| `pd learn` | Interactive TTY tutorial — requires readline input |
| `pd start` | Starts the daemon itself — only meaningful before MCP is available |
| `pd stop` | Stops the daemon — would terminate the MCP server connection |
| `pd completion` | Shell tab-completion install — shell-specific, no daemon involvement |

## Anti-Patterns

**Don't:**
- Use raw port numbers (`--port 3000`) — they collide
- Edit files without running `pd who-owns <path>` first
- Forget to end sessions — stale sessions confuse future agents
- Skip notes — your future self (or another agent) needs context
- Start work without checking `pd salvage` first

**Do:**
- Always claim ports through Port Daddy
- Check `pd salvage` at session start
- Check `pd who-owns <file>` before editing
- Leave notes liberally — they're cheap
- Use integration signals when your work is ready for another agent
- End sessions when done (even if abandoning)
