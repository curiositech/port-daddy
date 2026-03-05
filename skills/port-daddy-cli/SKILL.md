---
name: port-daddy-cli
description: Multi-agent coordination via Port Daddy. Use when starting dev servers, coordinating with other agents, preventing file conflicts, salvaging dead agents' work, or tracking changes. Activate on "port conflict", "claim port", "coordinate agents", "start session", "leave note", "file conflict", "dev server", "salvage", "changelog".
---

## Quick Start

1. `pd begin "what I'm working on"` — registers you + starts session
2. `pd note "progress update"` — log notes as you work
3. `pd done` — wraps up session + unregisters

## CLI to MCP Tool Mapping

When using Port Daddy via MCP (e.g. Claude Code with the port-daddy MCP server), use the MCP tool names below instead of CLI commands. The behavior is identical.

| CLI Command | MCP Tool | Tier |
|-------------|----------|------|
| `pd begin` | `begin_session` | Essential |
| `pd done` | `end_session_full` | Essential |
| `pd whoami` | `whoami` | Essential |
| `pd note` | `add_note` | Essential |
| `pd claim` | `claim_port` | Essential |
| `pd release` | `release_port` | Essential |
| `pd salvage` | `check_salvage` | Essential |
| `pd session start` | `start_session` | Standard |
| `pd session end` / `pd session done` | `end_session` | Standard |
| `pd sessions` | `list_sessions` | Standard |
| `pd notes` | `list_notes` | Standard |
| `pd session files add` | `claim_files` | Standard |
| `pd agent register` | `register_agent` | Standard |
| `pd agent heartbeat` | `agent_heartbeat` | Standard |
| `pd agents` | `list_agents` | Standard |
| `pd salvage claim` | `claim_salvage` | Standard |
| `pd lock` | `acquire_lock` | Standard |
| `pd unlock` | `release_lock` | Standard |
| `pd locks` | `list_locks` | Standard |
| `pd find` | `list_services` | Standard |
| `pd health` | `health_check` | Standard |
| `pd status` | `daemon_status` | Standard |
| `pd pub` | `publish_message` | Advanced |
| `pd sub` (polling) | `get_messages` | Advanced |
| `pd tunnel start` | `start_tunnel` | Advanced |
| `pd tunnel stop` | `stop_tunnel` | Advanced |
| `pd tunnel list` | `list_tunnels` | Advanced |
| `pd scan` | `scan_project` | Advanced |
| `pd log` | `activity_log` | Advanced |

# Port Daddy — The Authoritative Port Manager

**Your ports. My rules. Zero conflicts.**

Port Daddy eliminates the chaos of multi-agent development. No more port collisions. No more wondering what another agent touched. No more lost context between sessions.

## The Compulsory Registration Pattern

**Every agent session should start with registration.** This unlocks resurrection:

```bash
# At session start - register yourself
pd agent register --agent claude-$(date +%s) --name "Feature Builder" --type claude-code --purpose "Implementing dark mode"

# Send heartbeats every 5 minutes (agents marked stale at 10min, dead at 20min)
pd agent heartbeat --agent <your-id>

# Check if another agent died mid-task (do this BEFORE starting new work)
pd salvage
```

Registration is the cost of entry to resurrection. If you die, another agent can pick up your work.

## Quick Reference

```bash
# Ports
pd claim myapp:api:main          # Get a stable port (always same for this identity)
pd claim myapp -q                # Quiet mode — just the port number
pd find "myapp:*"                # Find all myapp services
pd release myapp:api:main        # Release when done

# Sessions (multi-agent coordination)
pd session start "Implementing dark mode" --files src/theme.ts src/components/ThemeProvider.tsx
pd note "Created ThemeProvider skeleton, CSS variables approach"
pd note "Blocked on design tokens — need @design-agent input" --type handoff
pd session done "Dark mode complete, tested in Chrome/Safari"

# File conflicts
pd session files add src/api/auth.ts    # Claim a file mid-session
pd sessions --files                      # See who has what files

# Locks (critical sections)
pd lock deployment --owner agent-1 --ttl 300
pd unlock deployment --owner agent-1
```

## Core Philosophy

### 1. Identity Convention: `project:stack:context`

Every service gets a semantic identity. Port Daddy hashes this to a stable port.

| Identity | Port | Use Case |
|----------|------|----------|
| `myapp:api:main` | 9234 | Main API server |
| `myapp:api:feature-auth` | 9847 | Feature branch API |
| `myapp:frontend` | 9156 | Frontend dev server |
| `myapp:db:test` | 9523 | Test database |

**Same identity = same port, every time.** No more "what port was that on?"

### 2. Sessions Are Mutable, Notes Are Immutable

Sessions have a lifecycle:
```
active → completed
active → abandoned
```

Notes are append-only. You can never edit or delete a note. They form the permanent record of what happened. If you wrote it, it happened.

**Why?** When debugging "what went wrong?", you need the full timeline. Edited notes lie.

### 3. File Claims Are Advisory

`pd session files add src/auth.ts` doesn't lock the file. It announces your intent. Other agents see the conflict and can coordinate.

**Why?** Hard locks cause deadlocks. Advisory claims cause conversations.

## Workflows

### Starting a Dev Server

```bash
# 1. Claim your port
PORT=$(pd claim myproject:api -q)

# 2. Start with that port
npm run dev -- --port $PORT

# Or export for the whole shell
eval $(pd claim myproject:api --export)
npm run dev  # Uses $PORT automatically
```

### Multi-Agent Coordination

**Agent A** (starting work):
```bash
pd session start "Refactoring auth system" --files src/auth/*.ts
pd note "Splitting monolithic auth.ts into separate modules"
```

**Agent B** (checking before touching auth):
```bash
pd sessions --files
# Output:
# session-a1b2 (active, 12m) - Refactoring auth system
#   Files: src/auth/*.ts
#   Notes: 1

# Sees conflict, coordinates:
pd note "Need to touch src/auth/types.ts — coordinating with @agent-a"
```

**Agent A** (completing):
```bash
pd note "Auth refactor done: auth.ts → login.ts, session.ts, types.ts"
pd session done "Refactored auth into 3 modules, all tests passing"
```

### Leaving Breadcrumbs

Notes support inline markup for cross-referencing:

```bash
pd note "Fixed CORS bug in #file:server.ts:142"
pd note "Handing off to @agent-frontend for UI integration" --type handoff
pd note "Committed: abc123 - CORS headers for API gateway" --type commit
pd note "WARNING: Don't touch auth until tests stabilized" --type warning
```

### Critical Sections with Locks

```bash
# Only one agent can deploy at a time
pd lock deployment --owner $(hostname) --ttl 300

# Do the deployment...
npm run deploy

# Release
pd unlock deployment --owner agent-1
```

Locks auto-expire after TTL (default 60s). Use `--wait` to block until available:

```bash
pd lock deployment --owner agent-1 --wait --timeout 30000
```

## Direct Mode (No Daemon)

Core operations work without the daemon running:

```bash
# These work even if daemon is down (direct SQLite)
pd claim myapp -q
pd session start "Quick fix"
pd note "Fixed the thing"
pd session done
```

**Tier 1 (no daemon):** claim, release, find, lock, unlock, session, note, notes, status
**Tier 2 (daemon required):** pub/sub, SSE, webhooks, orchestration (up/down)

## Dashboard

Open `http://localhost:9876` for a visual overview of:
- Active services and their ports
- Running sessions and file claims
- Recent notes timeline
- Lock status

## When to Use Port Daddy

| Situation | Action |
|-----------|--------|
| Starting any dev server | `pd claim <identity> -q` |
| Multi-file refactoring | `pd session start` + claim files |
| Handing off to another agent | `pd note --type handoff` |
| Critical section (deploy, migrate) | `pd lock` |
| Debugging "what happened?" | `pd notes` or `pd sessions` |
| Port conflict | `pd find "*"` to see what's claimed |

## Anti-Patterns

**Don't:**
- Use raw port numbers (`--port 3000`) — they collide
- Edit files without checking `pd sessions --files`
- Forget to end sessions — stale sessions confuse future agents
- Skip notes — your future self (or another agent) needs context

**Do:**
- Always claim ports through Port Daddy
- Start sessions for non-trivial work
- Leave notes liberally — they're cheap
- End sessions when done (even if abandoning)

## Worktree-Aware Development

Port Daddy tracks which git worktree you're in. Sessions automatically scope to the worktree:

```bash
# Main worktree
cd ~/coding/myproject
pd session start "Feature A"  # session-a1b2 in main worktree

# Chaos testing worktree
cd ~/coding/myproject-chaos
pd session start "Breaking things"  # session-c3d4 in chaos worktree

# See all sessions across worktrees
pd sessions --all-worktrees
```

### Multi-Daemon Development

For developing Port Daddy itself:

```bash
# Production daemon (your daily driver)
pd claim port-daddy:daemon:prod      # → 9876

# Development daemon (testing changes)  
cd ~/coding/port-daddy
PORT=$(pd claim port-daddy:daemon:dev -q)  # → 9877
npm run dev -- --port $PORT

# Chaos daemon (adversarial testing)
cd ~/coding/port-daddy-chaos  
PORT=$(pd claim port-daddy:daemon:chaos -q)  # → 9878
npm run dev -- --port $PORT
```

## Local DNS for Ports (Experimental)

Instead of remembering `localhost:9234`, use semantic names:

```bash
# Register a DNS name for your service
pd claim myapp:api --dns
# Now accessible at: http://myapp-api.local

# Works with any claimed service
pd claim frontend:react --dns
# → http://frontend-react.local

# List DNS registrations
pd dns list
# myapp-api.local      → 127.0.0.1:9234
# frontend-react.local → 127.0.0.1:9156
```

**Requirements:** macOS (uses mDNS/Bonjour), or Linux with avahi-daemon.

## Agent Resurrection (Salvage)

When an agent dies mid-task, its work isn't lost. Port Daddy captures session state and notes:

```bash
# At session start, check if someone died with unfinished work
pd salvage

# Sample output:
# Dead agent: builder-1 (died 15 minutes ago)
#   Purpose: Building the payment API
#   Session: session-a1b2c3 (active, 3 notes)
#   Last note: "Finished Stripe integration, starting PayPal"
#   Files: src/payments/stripe.ts, src/payments/paypal.ts

# Claim the dead agent's session and continue their work
pd salvage --claim builder-1

# Clear salvage queue after you've reviewed it
pd salvage --clear
```

**Always check salvage before starting new work.** Someone might have died mid-task.

## Changelog (Hierarchical Change Tracking)

Record meaningful changes with identity-based rollup:

```bash
# Record a change
pd changelog add myapp:api:auth "Added JWT refresh token endpoint" --type feature

# With detailed description
pd changelog add myapp:frontend "Fixed mobile nav overlap" --type fix \
  --description "Nav was overlapping content on iOS Safari viewport"

# List recent changes
pd changelog list

# Filter by identity (includes children)
pd changelog list --identity myapp:api

# Different formats
pd changelog list --format tree
pd changelog list --format keep-a-changelog
```

Changes roll up hierarchically:
- `myapp:api:auth` appears under `myapp:api` which appears under `myapp`
- Query `myapp` to see all changes across the entire project

### Change Types

| Type | When to use |
|------|-------------|
| `feature` | New functionality |
| `fix` | Bug fixes |
| `refactor` | Code restructuring |
| `docs` | Documentation updates |
| `chore` | Maintenance tasks |
| `breaking` | Breaking changes |
