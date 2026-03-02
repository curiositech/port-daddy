---
name: port-daddy-cli
description: Multi-agent coordination via Port Daddy. Use when starting dev servers, coordinating with other agents, preventing file conflicts, salvaging dead agents' work, or tracking changes. Activate on "port conflict", "claim port", "coordinate agents", "start session", "leave note", "file conflict", "dev server", "salvage", "changelog".
---

# Port Daddy — The Authoritative Port Manager

**Your ports. My rules. Zero conflicts.**

Port Daddy eliminates the chaos of multi-agent development. No more port collisions. No more wondering what another agent touched. No more lost context between sessions.

## The Compulsory Registration Pattern

**Every agent session should start with these steps, in order:**

```bash
# 0. Read the project briefing (BEFORE anything else)
#    If .portdaddy/briefing.md exists, read it for project context.
#    Otherwise, generate one:
pd briefing --json            # Get structured project state
# Or read the file directly: cat .portdaddy/briefing.md

# 1. Check if another agent died mid-task (BEFORE starting new work)
pd salvage

# 2. Register yourself (unlocks resurrection if YOU die)
pd agent register --agent claude-$(date +%s) --name "Feature Builder" --type claude-code --identity myapp:api --purpose "Implementing dark mode"

# 3. Start a session with file claims
pd session start "Implementing dark mode" --files src/theme.ts src/components/ThemeProvider.tsx

# 4. Check who owns files you'll touch (BEFORE editing)
pd who-owns src/auth.ts
pd files                        # See all claimed files across all agents

# 5. Send heartbeats every 5 minutes (agents marked stale at 10min, dead at 20min)
pd agent heartbeat --agent <your-id>
```

Registration is the cost of entry to resurrection. If you die, another agent can pick up your work.

**Check before you edit.** Run `pd who-owns <file>` before touching any file. If someone else claimed it, coordinate first.

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

### 2. Sessions Have Phases, Notes Are Immutable

Sessions have a lifecycle with granular phases:
```
status:  active → completed | abandoned
phases:  planning → in_progress → testing → reviewing → completed | abandoned
```

Set your phase as you work:
```bash
pd session phase <session-id> planning      # Designing approach
pd session phase <session-id> in_progress   # Writing code (default)
pd session phase <session-id> testing       # Running/writing tests
pd session phase <session-id> reviewing     # Code review
pd session phase <session-id> completed     # Done (auto-closes session)
```

Notes are append-only. You can never edit or delete a note. They form the permanent record of what happened. If you wrote it, it happened.

**Why phases?** Other agents can see "Agent X is in testing" and know not to push conflicting changes. "Agent Y is in planning" means the code isn't written yet.

### 3. File Claims Are Advisory — But Check First

`pd session files add src/auth.ts` doesn't lock the file. It announces your intent. Other agents see the conflict and can coordinate.

**Before editing any file, always check:**
```bash
pd who-owns src/auth.ts          # Who claimed this file?
pd files                          # Global view of all claimed files
```

If a file is claimed by another session, either:
1. Coordinate via notes: `pd note "Need src/auth.ts — @other-agent please release"`
2. Use integration signals: `pd integration needs myapp:api "Need access to auth module"`
3. Force-claim if urgent: `pd session files add src/auth.ts --force`

**Why?** Hard locks cause deadlocks. Advisory claims cause conversations.

### 4. Integration Signals for Cross-Agent Coordination

When your work is ready for another agent, or when you need something:

```bash
# Signal that your API is ready for the frontend agent
pd integration ready myapp:api "Auth endpoints complete, see /api/v2/auth/*"

# Signal that you need something from another agent
pd integration needs myapp:frontend "Waiting for API auth endpoints from @api-agent"

# See all integration signals
pd integration list
pd integration list --project myapp   # Filter by project
```

Integration signals use pub/sub under the hood (`integration:<project>:ready` / `integration:<project>:needs` channels). Other agents can subscribe to these channels for real-time notifications.

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
**Tier 2 (daemon required):** pub/sub, SSE, webhooks, orchestration (up/down), files, who-owns, integration

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
| Starting any work session | `pd salvage` then `pd session start` |
| Before editing any file | `pd who-owns <path>` |
| Multi-file refactoring | `pd session start` + claim files |
| Changing work phase | `pd session phase <id> testing` |
| Work ready for integration | `pd integration ready <identity> "desc"` |
| Need input from another agent | `pd integration needs <identity> "desc"` |
| Handing off to another agent | `pd note --type handoff` |
| Critical section (deploy, migrate) | `pd lock` |
| Debugging "what happened?" | `pd notes` or `pd sessions` |
| Port conflict | `pd find "*"` to see what's claimed |
| See all active work | `pd files` and `pd sessions --all-worktrees` |

## Anti-Patterns

**Don't:**
- Use raw port numbers (`--port 3000`) — they collide
- Edit files without running `pd who-owns <path>` first
- Forget to end sessions — stale sessions confuse future agents
- Skip notes — your future self (or another agent) needs context
- Start work without checking `pd salvage` first

**Do:**
- Always claim ports through Port Daddy
- Check `pd salvage` at session start (someone may have died mid-task)
- Check `pd who-owns <file>` before editing any file
- Start sessions for non-trivial work and claim your files
- Update your phase as you progress (`pd session phase`)
- Signal readiness with `pd integration ready` when done
- Leave notes liberally — they're cheap
- End sessions when done (even if abandoning)

## Project Briefing (`.portdaddy/`)

Every project can have a `.portdaddy/` directory — a living intelligence layer generated from daemon state. It tells any agent what's happening in this project right now.

```bash
# Generate the briefing (writes .portdaddy/briefing.md + briefing.json)
pd briefing

# Full sync — also archives completed sessions and writes activity.log
pd briefing --full

# JSON to stdout (no file write, good for piping)
pd briefing --json

# Override project detection
pd briefing --project myapp

# View recent project activity
pd history
pd history --limit 50
pd history --agent claude-abc
```

**What's in the briefing:**
- Active sessions and who's working on what
- Active agents and their purposes
- Dead agents needing salvage (with context)
- File ownership map (who claimed which files)
- Recent activity timeline
- Integration signals (ready/needs)
- Active services and ports

**When to use:**
- At session start (step 0) — read `.portdaddy/briefing.md` if it exists
- Before starting new work — understand what's already happening
- After completing work — run `pd briefing --full` to update for the next agent

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
