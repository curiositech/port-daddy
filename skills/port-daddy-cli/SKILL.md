---
name: port-daddy-cli
description: "Multi-agent coordination daemon. Ports, sessions, file claims, pub/sub, fleet agents, tuple space, pheromone trails, salvage. Use when coordinating multiple AI agents, claiming ports, starting sessions, leaving notes, spawning background agents, or reading shared state. Works with Claude, OpenAI, Gemini, Ollama — any LLM."
---

## What Port Daddy Does

Port Daddy is a local daemon that coordinates AI agents. It gives every agent its own port, tracks who's working on what, recovers work when agents crash, and runs background fleets that fire on every git commit.

**One install. Zero config. Works with any LLM.**

## Quick Start

```bash
npm install -g port-daddy
pd start                              # Daemon on localhost:9876
pd begin "Building auth module"       # Start session
pd note "JWT validation working"      # Leave breadcrumbs
pd done                               # End session
```

## MCP Tools (Progressive Disclosure)

**Essential (always loaded):**
`begin_session`, `end_session_full`, `whoami`, `claim_port`, `release_port`, `add_note`, `acquire_lock`, `list_services`, `fleet_init`, `swarm_awareness`, `catch_me_up`, `spawn_agent`, `pd_discover`

**Magic tools (high-level, one call does many things):**
- `fleet_init` — Set up background agent fleet in one call
- `swarm_awareness` — Who else is working here? Agents, sessions, files, dead agents
- `catch_me_up` — What happened while I was away? Activity + notes + salvage
- `spawn_agent` — Launch a background AI agent with a task
- `file_heat` — Which files are agents fighting over?
- `talk_to_agent` — Send a DM to a fleet agent by name
- `fleet_status` — What is the fleet doing right now?

**Categories (call `pd_discover` to access):**
magic, session-lifecycle, ports, sessions, notes, locks, messaging, agents, inbox, webhooks, integration, dns, briefing, tunnels, projects, changelog, activity, tuples, system

## Core Concepts

### Semantic Identities: `project:stack:context`

Every service gets a name. The name IS the port — deterministic hashing.

```bash
pd claim myapp:api:main           # Always gets the same port
pd claim myapp:api:feature-auth   # Different port, same project
pd find 'myapp:*'                 # Wildcard query across project
```

### Sessions & Notes

Sessions track what each agent is doing. Notes are immutable — once written, never editable.

```bash
pd begin --identity myapp:api --purpose "Building auth"
pd note "Found SQL injection in token validation"
pd note "Patched. Tests green."
pd done
```

If an agent crashes, its session enters the salvage queue. Another agent claims the work:
```bash
pd salvage --project myapp        # See dead agents
pd salvage claim dead-agent-42    # Pick up their work
```

### File Claims (Advisory)

```bash
pd session files claim src/auth/*.ts
# Another agent tries:
pd session files claim src/auth/login.ts
# → CONFLICT: claimed by agent 'myapp:api'
```

Claims are advisory — they warn, not lock. Hard locks cause deadlocks. Advisory claims cause conversations.

### Pub/Sub Messaging

Agents signal each other through channels:

```bash
# Agent A finishes
pd pub myapp:events "auth-ready"

# Agent B was watching
pd watch myapp:events --exec "npm test"
```

This is how fleet agents chain: QA publishes to `qa:findings`, a notifier reacts.

### Distributed Locks

```bash
pd with-lock deployment -- npm run deploy
# Or manually:
pd lock db-migration --ttl 300
pd unlock db-migration
```

## Fleet: Background Agents

Declare agents in YAML. They fire on git commits, cron schedules, or when other agents publish messages.

```bash
pd fleet init     # Creates pd-fleet.yml + git hook
pd fleet up       # Starts the fleet
git commit -m "fix auth"  # QA, docs, cartographer fire automatically
```

The starter fleet includes: QA, Documentarian, Cartographer, Spark (ideas), Spider (connections).

```yaml
# pd-fleet.yml
fleet:
  name: myapp
  harbor: "{project}:fleet"
  agents:
    qa:
      trigger: git:committed
      respawn: true              # Auto-respawn on death
      max_respawns: 3            # Circuit breaker
      backend: claude-cli
      prompt: "Review the last commit for bugs..."
    spark:
      schedule: "*/30 * * * *"
      backend: claude-cli
      prompt: "Propose one improvement..."
```

**Works with any LLM backend:** `claude-cli`, `ollama`, `gemini`, `aider`, `custom` (any shell command).

### Auto-Respawn

Agents with `respawn: true` automatically restart when they die. The fleet engine subscribes to the resurrection channel, claims the dead agent's salvage, and re-spawns with the same config. Circuit breaker stops after `max_respawns` deaths.

## Tuple Space (Shared Swarm Memory)

Agents write typed tuples. Other agents query by pattern. Based on Linda (Gelernter, 1985).

```bash
# Spider writes a discovery
pd tuple out '["connection","trie+pubsub=routing","spider",0.9]' --harbor myapp:fleet

# Spark reads connections with confidence > 0.7
pd tuple rd '["connection","*","*",">0.7"]' --harbor myapp:fleet

# Take (remove) a processed task
pd tuple in '["task","build-auth","pending"]'
```

Pattern matching: exact values, `*` wildcard, `>N`/`<N` numeric, `myapp:*` identity prefixes.

## Pheromone Trails (Ambient Signals)

Agents spray numeric signals (0-1) onto entities. Signals decay over time automatically.

```bash
pd pheromone spray --table services --id myapp:api --key urgency --strength 0.8
pd pheromone sniff --table services --id myapp:api
# → urgency: 0.62 (decayed from 0.8 twenty minutes ago)
```

File heat map shows which files agents are fighting over:
```bash
curl http://localhost:9876/pheromone/files
```

## Dashboard

- **Main:** `http://localhost:9876` — sparklines, fleet cards, heat map, 12 panels
- **Fleet Live:** `http://localhost:9876/fleet-live.html` — real-time fleet monitoring
- **Menu Bar App:** `cd fleet-live-app && ./build.sh` — macOS native

## CLI Quick Reference

| Command | Purpose |
|---------|---------|
| `pd begin` / `pd done` | Start/end session |
| `pd note` / `pd notes` | Write/read notes |
| `pd claim` / `pd release` | Port management |
| `pd find` | Wildcard service search |
| `pd lock` / `pd unlock` | Distributed locks |
| `pd pub` / `pd watch` | Pub/sub messaging |
| `pd fleet init/up/down` | Fleet management |
| `pd spawn` / `pd spawned` | Launch/list agents |
| `pd salvage` | Dead agent recovery |
| `pd tuple out/rd/in` | Shared tuple space |
| `pd pheromone spray/sniff` | Ambient signals |
| `pd status` | Daemon health |

## When to Use What

| Need | Use |
|------|-----|
| Port conflicts | `pd claim myapp:api -q` |
| Multi-file work | `pd begin` + `pd session files claim` |
| Agent-to-agent signaling | `pd pub` + `pd watch` |
| Background automation | `pd fleet init` + `pd fleet up` |
| Shared knowledge | `pd tuple out` / `pd tuple rd` |
| Ambient awareness | `pd pheromone spray` / `pd pheromone sniff` |
| Dead agent recovery | `pd salvage` |
| Critical sections | `pd with-lock` |

## V4 Roadmap (Planned, Not Built)

These features are designed but not yet implemented:
- **Float Plans** — collateralized work contracts with credit escrow
- **Episodic Memory** — `pd memory store/recall/forget` with semantic embeddings
- **Remote Harbors** — cross-machine coordination via Lighthouse discovery
- **Semantic Conflict Prediction** — tree-sitter AST analysis for symbol-level file claims
- **Governance Channels** — agents vote on rule changes (Ostrom Principle 3)

See `docs/V4-UNIFIED-ROADMAP.md` for the full plan with 6 phases and 16 appendix ideas.
