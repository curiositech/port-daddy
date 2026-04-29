---
name: port-daddy-cli
description: "Use Port Daddy to start and coordinate repo work on this machine. Default agent path: `pd status`, `pd briefing`, optional `pd salvage`, `pd begin`, `pd advise`, `pd note`, precise file/port/lock claims as needed, then `pd done`. For roadmap, what-next, recovery-map, or skill/docs drift work, consult live Navigator/Lookout actor surfaces before relying on stale files."
license: FSL-1.1-MIT
allowed-tools: Read,Bash,Grep,Glob
metadata:
  category: Coordination
  tags: [port-daddy, coordination, agents, sessions, actors, skills]
  provenance:
    kind: first-party
    owners: [port-daddy]
  authorship:
    maintainers: [port-daddy]
  mirrors:
    workgroup: /Users/erichowens/coding/workgroup-ai/skills/port-daddy
    user: /Users/erichowens/.agents/skills/port-daddy-cli
---

# Port Daddy CLI

Use this skill as a **coordination runbook**, not as a catalog. The happy path
below is what an agent should do by default. Everything after that is a branch
for a specific need.

## Default Agent Happy Path

Run this sequence for any non-trivial repo task on this computer:

```bash
# 1. Establish live truth before local archaeology.
pd status
pd briefing

# 2. Check crash residue only when the briefing, user, or repo history suggests it.
pd salvage --project <project>

# 3. Start one named work session.
pd begin "<plain-language task>" --identity <project>:<task>
# If a session is already active, inspect it before starting another one:
pd whoami

# 4. Ask Port Daddy what coordination is appropriate before editing.
pd advise <likely-file-or-dir> --task "<plain-language task>"

# 5. Tell other agents what you intend to touch.
pd note "Scope: <task>. Likely files: <paths>. Risks/blockers: <anything important>."

# 6. Claim the smallest real edit surface before mutation.
pd session files add <path>
pd session files add <path> --symbol-path <ClassOrFunction.name>

# 7. If this repo has Coordination Guard enabled, check before commit.
pd guard check --staged

# 8. Do the work, test it, then leave the result and close cleanly.
pd note "Result: <what changed>. Validation: <commands run>. Remaining: <if any>."
pd done "<short outcome>"
```

If you remember only one thing: **status, briefing, begin, advise, note, claim,
work, note, done**.

## Small Decision Table

Use this table when the happy path reveals a specific need:

| Need | Use | Rule of Thumb |
|------|-----|---------------|
| Start or finish work | `pd begin` / `pd done` | One active session per coherent task. |
| Inspect current session | `pd whoami` | Use when context is unclear or `pd begin` reports an active session. |
| Explain scope or handoff | `pd note` | Human-readable truth; use this first. |
| Decide coordination before editing | `pd advise` / `pd preflight` | Ask before risky edits or handoffs. |
| Enforce coordination before commit | `pd guard` | Use `pd guard install --mode enforce` to require an active session plus file claims in any repo. |
| Edit files safely | `pd session files add` | Prefer symbol claims when the target function/class is known. |
| Run a dev server | `pd claim <project>:<service>:<context> -q` | Never hardcode a random port. |
| Exclusive critical section | `pd with-lock <resource> -- <command>` | Use for migrations, promotion, generated artifacts, and non-mergeable work. |
| Crash or abandoned work | `pd salvage --project <project>` / `pd salvage --summary` | Read before restarting work someone may have half-finished; use summary mode when the queue is noisy. |
| Roadmap or what-next truth | `pd actor cartographer` / `pd actor navigator --inbox` | Ask the durable roadmap actor; docs are evidence, not the actor. |
| Skill/docs/API drift | `pd actor lookout --message` | Queue release-surface drift for the durable docs/README/website/Mac-app/skill owner. |
| Machine-readable handoff | `pd tuple out ...` | Use only when another process/agent should query it. |
| Direct message | `pd inbox send` or `pd actor <id> --message` | Use when you know the recipient; use `pd actor <id> --inbox --mark-read` only after the role mail has been processed. |
| Catch up after time away | `pd look` / `pd sitrep` | Read recent activity instead of scraping logs manually. |
| Delegate work | `pd agent`, `pd sortie`, or `pd fleet` | Only after budget/readiness and telemetry policy are clear. |
| Service dependency ready/needed | `pd integration ready` / `pd integration needs` | Use when one service is waiting on another. |
| Local service naming | DNS records through Port Daddy | Use when agents need stable local names instead of copied URLs. |

## Ambient Peer Coordination

The goal is not to make agents talk constantly. The goal is to make useful
coordination emerge from shared facts, then escalate only material
inconsistencies to the operator.

Default behavior for every non-trivial slice:

- publish scope, assumptions, intended files/symbols, validation, blockers, and
  handoff evidence with `pd note`
- fix bounded Port Daddy dogfood bugs when you discover them; if the fix is too
  large, leave a failing reproduction or exact evidence, a `pd note`, and a
  targeted actor message before switching away
- claim the smallest realistic edit surface; prefer symbol/region claims for
  code when available
- emit tuples only for facts another process or actor should query
- use scoped channels for event notifications, not prose conversations
- use actor inboxes for durable role ownership, especially Navigator,
  Coxswain, Lookout, Harbormaster, Sounder, Signalman, Breaker, Caulker, and
  Quartermaster
- mark durable actor inbox messages read only after their coordination content
  has been incorporated into the roadmap, recovery ledger, or a live handoff
- use pheromones/file heat for ambient contention, not ordinary status updates

Coordination is not just collision avoidance. If another agent's assumptions,
API shape, runtime state, release surface, or product goal changes the meaning
of your work, tell that agent or the relevant durable actor and adjust. A local
workaround for broken coordination is itself dogfood feedback; do not silently
route around it and move on.

Operator-worthy callouts:

- overlapping or stale claims on the same scarce surface
- incompatible UI/UX, roadmap, planning, skill, docs, or product-truth decisions
- implied-goal contradictions, even when no local bug exists
- security, auth, privacy, data-retention, trust-boundary, or API-shape drift
- raw text or unauthenticated endpoints appearing beside work that implies a
  secure authenticated API contract
- live daemon/runtime truth disagreeing with source, docs, or control-plane truth
- sessions marked active while their agent registry bodies are dead or missing
- spawn/budget/readiness signals that would activate too much fleet work

Use the worktree-scoped `coordination:inconsistency` channel for those
operator-worthy conflicts. Routine progress stays in notes. If the daemon cannot
prove live peer bodies, say that directly instead of pretending agents are
coordinating.

Think at the goal/invariant level, not only at the defect level. Example: if
one slice is building an authenticated, secure API, and another slice adds a raw
text API surface, flag the trust-boundary mismatch even if the raw endpoint was
not explicitly requested as secure or insecure. The right question is whether
the work still honors the operator's apparent product and security goals.

## Roadmap, Skill, And Actor Truth

For “what’s next,” roadmap, recovery-state, Cartographer/Navigator, or
skill/docs drift questions, do not answer from memory or from
`.cartographer/status.md` alone. Query the live durable actor surfaces first:

```bash
pd actors --project <project>
pd actor cartographer --project <project>
pd actor navigator --inbox-stats
pd actor navigator --inbox --unread
```

`cartographer` is a compatibility alias for the durable `navigator` actor.
Navigator owns roadmap, recovery-ledger, work-slice, and cartographer-status
truth. Lookout owns docs, README, OpenAPI, SDK/MCP/CLI references, website,
Mac app/FleetBar documentation, skill, and product-truth drift.

Use actor messages when the durable role should update or arbitrate:

```bash
pd actor navigator --message "Roadmap question: <specific evidence needed>"
pd actor lookout --message "Skill/docs drift: <specific release surface>"
```

Mailbox delivery is durable but not an immediate answer. `--message` queues work
to `actor:<id>`; `--wake` only tries to hail a compatible live fleet body if one
exists. If no body responds, combine live Port Daddy state with the authority
documents below and leave a `pd note` explaining the evidence and uncertainty.

Authority order for this repo:

1. Live Port Daddy state: `pd status`, `pd briefing`, `pd actors`, sessions,
   claims, salvage, tuples, and promotion state.
2. Source and tests in the current checkout.
3. `docs/recovery/CURRENT-WORK.md` as the active execution ledger.
4. `.cartographer/README.md` for Navigator policy and patch authority.
5. `.cartographer/status.md` as the long-view projection; it may be stale.
6. Roadmap, plan, and report documents as supporting evidence.

For skill edits, treat this bundle as a release surface. Update
`skills/port-daddy-cli/SKILL.md`, its references, tests, and changelog together,
then mirror the validated result to the workgroup and user-level installed
copies when filesystem permissions allow.

## MCP Equivalents

If you are using MCP tools instead of the CLI, mirror the same order:

1. `begin_session`
2. `coordination_preflight`
3. `add_note`
4. file claim tools or `claim_port` only when needed
5. `end_session_full`

Use `pd_discover` only after the happy path tells you a specialized surface is
needed. Do not begin by browsing every available tool.

## Coordination Rules

- Use **notes** for human-readable scope, decisions, blockers, and validation.
- Use **file claims** for advisory edit ownership. They warn and start a
  conversation; they are not hard locks.
- Use **Coordination Guard** when convention is not enough. `pd guard enable
  --mode enforce && pd guard install` writes a local `.portdaddy/` config and
  pre-commit hook so commits require a live Port Daddy session and matching file
  claims.
- Use **symbol claims** for function/class-scoped code edits when the symbol
  index knows the file.
- Use **locks** only for scarce, non-mergeable critical sections.
- Use **tuples** when a fact needs to be machine-readable by other automation.
- Use **inbox/actors** for targeted delivery to a known agent or durable role;
  queued actor mail is coordination evidence, not proof the actor has acted.
- Use **pheromones/file heat** for ambient contention signals, not normal status
  updates.
- Use **agents/sorties/fleets** for delegation, not as a substitute for a clear
  local session.

## Advanced Surfaces

The rest of this file is reference material. Read it only when the happy path or
the decision table points you there. Full API and SDK details live in:

- `references/api-reference.md`
- `references/sdk-reference.md`
- `references/multi-agent-patterns.md`

Useful advanced commands still include `pd say`, `pd look`, `pd actors`,
`pd pheromone`, `pd tuple`, `pd fleet`, `pd agent`, `pd sortie`, `pd graph`,
`pd memory`, and `pd ideas`, but they are **not** the default starting point.

## Core Concepts

### Semantic Identities: `project:stack:context`

Every service gets a semantic name. The name IS the port — deterministic hashing means the same identity always maps to the same port. Identities are indexed in an in-memory **Adaptive Radix Tree** for O(k) lookups (where k is key length), replacing SQL LIKE scans.

```bash
pd claim myapp:api:main           # Always gets port 3142 (or whatever hash gives)
pd claim myapp:api:feature-auth   # Different port, same project
pd find 'myapp:*'                 # Prefix search — resolves through the trie, not SQL
pd find 'myapp:*:main'            # Wildcard — all stacks with context "main"
```

### Sessions & Notes

Sessions track what each agent is doing. Notes are **immutable** — once written, they can never be edited or deleted. This creates an audit trail that agents and humans can trust. Notes are **encrypted at rest** with AES-256-GCM (master key at `~/.port-daddy/master.key`, auto-generated on first boot).

```bash
pd begin --identity myapp:api --purpose "Building auth"
pd note "Found SQL injection in token validation"
pd note "Patched. Tests green."
pd done
```

### Salvage (Dead Agent Recovery)

When an agent crashes, its session enters the salvage queue. Another agent can claim and continue the work:

```bash
pd salvage --project myapp        # See dead agents' context
pd salvage claim dead-agent-42    # Pick up their work
```

**IMPORTANT:** Always check `pd salvage` at the start of a session. You might be able to continue where a crashed agent left off instead of starting from scratch.

### File Claims (Advisory)

```bash
pd session files add src/auth/*.ts
# Another agent tries the same file:
pd session files add src/auth/login.ts
# → CONFLICT: claimed by agent 'myapp:api'
```

Claims are advisory — they warn, don't lock. Hard locks cause deadlocks. Advisory claims cause conversations.
Canonical syntax is `pd session files add|rm`. The older `claim|release` forms are accepted as compatibility aliases, but new docs and examples should use `add|rm`.

For code files, avoid widening coordination to a whole file when the task is naturally function/class scoped. Use `pd session files add src/auth.ts --symbol-path AuthService.refreshToken` when the symbol index knows the target; see `references/api-reference.md` for HTTP/API details. Whole-file `pd session files add` is still the fallback when you do not yet know the symbol or the edit spans the file. `pd lock` is stronger than a claim and belongs on scarce critical sections, generated artifacts, migrations, promotion, and other non-mergeable resources.

### Pub/Sub Messaging

Agents signal each other through channels:

```bash
# Declare a branch-scoped canonical channel for this worktree first
pd channels ensure myapp:events --scope branch --aliases events:db

# Discover declared channels for the current repo/worktree
pd channels discover myapp

# Agent A finishes database setup
pd pub myapp:events "database-ready"

# Agent B can subscribe with the same logical name
pd sub myapp:events
```

Declared channels are git-sensitive by default. `pd pub`, `pd sub`, `pd watch`, and `pd channels clear` now auto-resolve declared logical names against the current worktree. `branch` scope isolates per worktree/feature branch, `worktree` isolates per worktree regardless of branch name churn, `repo` shares across worktrees in the same repo, and `global` is the explicit opt-in escape hatch. Use `--raw-channel` only when you intentionally want to bypass resolution.

### Distributed Locks

For operations that truly must be exclusive:

```bash
pd with-lock deployment -- npm run deploy
# Or manually:
pd lock db-migration --ttl 300
pd unlock db-migration
```

## Binary IPC Protocol (v3.8.3)

High-frequency agent communication over a Unix domain socket with MessagePack encoding. The IPC channel sits alongside the HTTP API — agents that need low-latency communication (heartbeats, pheromone sprays, pub/sub publish) use IPC automatically when the daemon is running.

**Key properties:**
- **7-byte header**: `[type:1][conv_id:4][payload_len:2]` + MessagePack payload
- **70-80% bandwidth reduction** vs HTTP JSON
- **~3us latency** for fire-and-forget operations (vs ~200us HTTP)
- **13 FIPA performatives**: INFORM, REQUEST, QUERY_REF, REFUSE, FAILURE, NOT_UNDERSTOOD, SUBSCRIBE, UNSUBSCRIBE, etc.
- **Fire-and-forget**: heartbeats, pheromone sprays, pub/sub publish (conv_id=0)
- **Request-response**: claims, locks, sessions (conv_id for correlation)
- **Pub/sub subscriptions**: with dead-man cleanup on disconnect
- **Auto-reconnect**: client reconnects with subscription replay on socket drop
- **SDK fast paths**: `heartbeat()`, `pheromoneSpray()`, `publish()` auto-use IPC when available

**Socket location:** `~/.port-daddy/daemon.ipc`

**Security hardening:**
- Rate limiting: 500 frames/sec per connection
- Connection limit: 256 max (REFUSE for excess)
- 3-strike protocol violation budget (malformed frames disconnect)
- Backpressure via write queue + drain events
- Lock release on IPC disconnect

You don't need to use IPC directly. The SDK and CLI use it transparently for hot-path operations.

## Fleet: Background Agents (v3.8.3)

Declare agents in YAML. They fire on git commits, promotion review signals, cron schedules, tuple patterns, or pub/sub messages. Auto-respawn on crash with circuit breaker. **As of v3.8.3, fleets run inside the daemon process** — they start automatically on daemon boot and survive terminal close.

**Two modes:**

```bash
# CLI mode — manual, terminal-attached
pd fleet init     # Creates pd-fleet.yml + git hook
pd fleet up       # Starts the fleet (runs until Ctrl+C or pd fleet down)
pd fleet validate # Parses YAML, resolves templates, and checks trigger topology
pd fleet status   # What is the fleet doing?
pd fleet down     # Stop the fleet

# Daemon mode — always-on (automatic)
# Place pd-fleet.yml in a repo with durable Port Daddy markers.
# The daemon auto-discovers known repos on boot and starts the fleet.
PD_URL="${PORT_DADDY_URL:-http://localhost:9876}"  # Use pd status if yours differs
curl "$PD_URL/fleet"              # Global status across all projects
curl "$PD_URL/fleet/my-project"   # Per-project status
curl -XPOST "$PD_URL/fleet/reload"  # Reload after editing pd-fleet.yml
curl "$PD_URL/fleet/events"       # SSE lifecycle stream
```

The starter fleet includes: **QA** (bug hunting), **Documentarian / Lookout** (promotion-time release-surface sync), **Cartographer** (roadmap tracking), **Spark** (idea generation), **Spider** (cross-feature connections).

For Port Daddy's own repo, `./scripts/promote-stable.sh` emits a `promotion:release-surfaces` tuple and pub/sub signal after tests pass and before the stable merge. Documentarian listens there, with singleton/cooldown/dedupe/backoff controls, so README, docs, website docs/tutorials, Mac app/FleetBar install and product copy, SDK/CLI references, OpenAPI/MCP, and this skill are checked at the moment they become operator-facing truth instead of on every low-signal commit.

`pd fleet status` now surfaces backend readiness and sandbox-sensitive local execution hints so users can see install/auth/permission blockers before a fleet run fails.

## `pd agent`: One-Shot Autopilot Delegation

For bounded single-agent work, `pd agent "task text"` now auto-wraps:

- session begin
- spawned execution
- session close

It also prints the resolved runtime up front and can honor explicit runtime flags:

```bash
pd agent "review the last commit for risks"
pd agent "summarize git status" --backend custom
pd agent "investigate auth flow" --backend gemini --tier mid
```

This is the lightest-weight delegation surface. It is for one-shot work, not always-on automation.

## `pd sortie`: Tracked Mission Delegation

`pd sortie` is now a first-class mission surface, not just a plan-doc idea.

Already shipped:

- durable sortie ids
- persisted mission records
- explicit sortie harbors (`project:sortie:<id>`)
- sortie status lookup
- sortie event logs

Current truthful limitation:

- the first shipped slice still runs one coordinating spawned agent underneath
- richer multi-agent approvals, artifact/result pages, and human-in-the-loop controls are still the next layer from `docs/recovery/PD-AGENT-SORTIE-PLAN.md`

Examples:

```bash
pd sortie "Investigate flaky auth tests and summarize the root cause" \
  --backend claude \
  --model claude-haiku-4-5-20251001 \
  --budget 0.75

pd sortie list
pd sortie status sortie-abc123
pd sortie logs sortie-abc123
```

Use the delegation surfaces this way:

- `pd spawn` — low-level primitive
- `pd agent` — preferred one-shot single-agent sugar
- `pd sortie` — tracked mission record with harbor + logs + outcome lookup
- `pd fleet` — always-on project automation

Telemetry contract:

- `pd spawn`, `pd agent`, and `pd sortie` are fail-closed on spend telemetry.
- A launch must resolve to a backend/model pair with an exact nonzero rate entry and must return exact token counts before Port Daddy will accept it as a completed operator-facing run.
- The live spawner defaults that enforcement on. Any internal opt-out path now requires explicit HITL confirmation metadata instead of relying on an omitted flag.
- If a backend cannot do that yet, expect readiness and preflight to block it instead of silently estimating.
- Today that means the live operator-facing path is the Claude SDK backend with an exact-rate model entry. The broader backend catalog still exists in source, but it is not the same thing as "launchable right now."

Canonical explanation: `docs/DELEGATION-MODES.md`

## `pd graph` and `pd memory`: Semantic Inspection Surfaces

Use these when recovery or operator work depends on inspecting the new semantic substrates directly:

- `pd graph edges` — inspect durable relationship edges emitted by symbol indexing and merge orchestration
- `pd graph stats` — summarize graph totals for a project
- `pd memory episodes` — inspect promoted handoffs, findings, decisions, blockers, and sortie outcomes
- `pd memory stats` — summarize episodic memory coverage

Examples:

```bash
pd graph edges --scope symbols:file:/Users/you/coding/port-daddy/server.ts
pd graph stats --dir /Users/you/coding/port-daddy
pd memory episodes --project port-daddy --type handoff
pd memory stats --dir /Users/you/coding/port-daddy
```

These are read-only inspection surfaces today. The point is operator truth: if graph/memory is part of the product, it must be inspectable from the CLI and not only via raw daemon routes.

## `pd ideas`: Canonical Ideation Index And Dedupe Surface

Use this when Spark, Spider, or a human operator needs to know whether an idea
is actually new, where it already shows up in repo memory, or whether it only
exists as local residue.

- `pd ideas list` — list curated entries from `docs/recovery/IDEAS-TROVE.md`
- `pd ideas search <query>` — federated search across:
  - canonical trove entries
  - optional local `.spark/.spider` residue
  - recent daemon notes
  - live tuples
  - random `.md` files in the repo
- `pd ideas show <slug>` — inspect one curated idea/family in detail

Examples:

```bash
pd ideas list --status now
pd ideas search "salvage disconnect" --include-raw
pd ideas search "phase 3 parity debt" --sources markdown
pd ideas search "handoff debt" --sources notes,markdown
pd ideas show tuple-driven-fleet
```

This command is still local-first. `list` and `show` read the canonical trove
from the repo. `search` federates local repo truth plus live daemon memory when
available, and degrades cleanly if daemon-backed sources like notes/tuples are
temporarily unavailable. That keeps ideation authority in code-reviewable docs
while making `pd ideas` useful to humans, not just Spark/Spider.

```yaml
# pd-fleet.yml
fleet:
  name: myapp
  harbor: "{project}:fleet"

  limits:
    max_concurrent_spawns: 2        # Max parallel agent runs
    max_spawns_per_hour: 20         # Hourly rate cap (rate limiting)
    budget_usd_per_day: 5           # Daily LLM spend ceiling in USD

  agents:
    qa:
      trigger: git:committed        # React to pub/sub events
      respawn: true                 # Auto-restart on crash
      max_respawns: 3               # Circuit breaker
      backend: ollama
      model: qwen2.5-coder:7b
      prompt: "Review the last commit for bugs..."

    test-hunter:
      trigger: git:committed
      backend: codex
      model: gpt-5.4-mini
      prompt: "Expand test coverage around risky changes..."

    gardener:
      schedule: "*/10 * * * *"      # Or run on a cron schedule
      backend: custom
      prompt: "git status --porcelain"
      on_success: publish git:status  # Chain agents via channels

  channels:
    git:committed:
      description: "Fired after a successful commit"
      consumers: [qa]
```

**Key features:**
- Works with any LLM backend: `ollama`, `codex`, `claude-cli`, `claude`, `gemini`, `cloudflare`, `aider`, `custom`
- Prefer local-first tiers for always-on fleets: cheap Ollama loops for broad coverage, Codex for higher-signal code work, Claude CLI only when its tool surface is specifically needed
- Template variables (`{project}`) resolve from the YAML context
- `on_success: publish <channel>` chains agents via pub/sub (DAG topology validated at startup)
- `channels.<name>.external_producer` documents channels produced by scripts/hooks outside the fleet so validation stays quiet without pretending an agent owns the source
- Fleet harbor auto-created on start — all agents share a semantic namespace
- Each agent gets full PD coordination: registration, sessions, heartbeats, salvage on crash
- Auto-respawn with `respawn: true` and `max_respawns` circuit breaker
- **Daemon mode**: fleet auto-discovered from known Port Daddy repos on daemon boot; editing `pd-fleet.yml` triggers hot-reload; SIGHUP reloads all fleets
- **Project fleet leases**: daemon-owned fleets are singleton per project across daemons; another daemon may discover the same `pd-fleet.yml`, but it must skip starting that project if a lease is already held
- **Resource limits**: `limits.max_concurrent_spawns` and `limits.max_spawns_per_hour` prevent runaway agents
- **Trigger discipline**: use `cooldown_ms`, `dedupe_window_ms`, and backoff settings for high-signal maintenance agents so repeated commits/promotions collapse instead of spawning a storm
- Lifecycle events published to `fleet:events` channel for dashboard/menu bar subscriptions

Keep the distinction clear:
- `singleton: true` on an agent prevents overlapping runs of that one agent inside a single fleet runner
- project fleet leases prevent two different daemons from both running the same project fleet at once

## Tuple Space: Shared Swarm Memory (v3.8.3)

Agents write typed tuples to a shared space. Other agents query by pattern. Based on Linda (Gelernter, 1985). Harbor-scoped for fleet isolation. TTL for auto-expiry.

```bash
# Spider writes a connection it discovered
pd tuple out '["connection", "trie+pubsub=routing", "spider", 0.9]' --harbor myapp:fleet

# Spark reads all connections with confidence > 0.7
pd tuple rd '["connection", "*", "*", ">0.7"]' --harbor myapp:fleet

# Take (remove) a processed task from the space
pd tuple in '["task", "build-auth", "pending"]'

# Scan all tuples in a harbor
pd tuple scan --harbor myapp:fleet

# Count tuples
pd tuple count --harbor myapp:fleet
```

Pattern matching: exact values, `*` wildcard, `>N`/`<N` numeric comparisons, `myapp:*` semantic identity prefixes.

**HTTP API:**
- `POST /tuples` — write a tuple (body: `{ tuple, harbor?, writtenBy?, ttl? }`)
- `GET /tuples` — read by pattern (query: `pattern`, `harbor`, `limit`)
- `DELETE /tuples` — take (destructive read) by pattern
- `GET /tuples/scan` — list all tuples in a harbor
- `GET /tuples/count` — count tuples

## Pheromone Trails: Ambient Signals (v3.8.3)

Agents spray numeric signals (0-1) onto entities. Signals decay exponentially over time at read, creating ambient awareness without polling.

```bash
# Spray a signal onto a service
pd pheromone spray --table services --id myapp:api --key urgency --strength 0.8

# Sniff pheromone values (applies read-time decay)
pd pheromone sniff --table services --id myapp:api

# View file heat map (which files are most contested)
pd pheromone files

# List all non-zero pheromone trails
pd pheromone list
```

Use cases: file contention detection, agent reputation scoring, hot-path identification, adaptive thresholds.

**HTTP API:**
- `POST /pheromone/spray` — set a pheromone value (body: `{ table, id, key, strength }`)
- `GET /pheromone/:table/:id` — read pheromone values (applies read-time decay)
- `GET /pheromone` — list all non-zero pheromones
- `GET /pheromone/files` — file heat map from session file claims (query: `path`, `depth`)

## The Arbiter: Runtime Invariant Enforcement (v3.8.3)

The Arbiter monitors every state transition against 6 formally-derived invariants from the TLA+ specification:

- **PID squatting** — no process can claim another's port
- **Capability escalation** — agents can't exceed declared capabilities
- **Note monotonicity** — notes are append-only, never deleted
- **Escrow positivity** — encrypted note escrow balances stay positive
- **Lock owner validity** — only the owner can release a lock
- **Heartbeat freshness** — stale agents get reaped

In strict mode, critical violations trigger man-overboard salvage.

```bash
pd arbiter status         # Check rules and violation count
pd arbiter violations     # List recorded violations
```

## Runtime File Locations (v3.8.3)

All runtime files live in `~/.port-daddy/` (not `/tmp/`). This eliminates symlink attacks, survives `/tmp/` cleanup, and keeps permissions user-private (0700 directory).

| File | Purpose |
|------|---------|
| `~/.port-daddy/daemon.sock` | HTTP Unix socket (CLI, SDK, MCP) |
| `~/.port-daddy/daemon.ipc` | Binary IPC socket (agent hot path) |
| `~/.port-daddy/daemon.pid` | PID file |
| `~/.port-daddy/daemon.port` | TCP port file (dashboard discovery) |
| `~/.port-daddy/instances/<profile>/` | Named sidecar daemon runtime dirs (`pd daemon start <profile>`) |
| `~/.port-daddy/master.key` | AES-256-GCM master key for note encryption |
| `~/.port-daddy/ui-preferences.json` | Shared UI preferences (FleetBar menu bar companion) |

Override via environment variables: `PORT_DADDY_SOCK`, `PORT_DADDY_IPC`, `PORT_DADDY_PORT_FILE`.
For an isolated named daemon, use `pd daemon env <profile>` instead of hand-writing
paths; it exports the profile socket, IPC path, DB path, pid file, port file,
and sidecar-safe fleet/FleetBar guards.

## CLI Quick Reference

| Command | Purpose |
|---------|---------|
| **Session Lifecycle** | |
| `pd begin` / `pd done` | Start/end session (agent registration included) |
| `pd whoami` | Current agent and session context |
| `pd note` / `pd notes` | Write/read immutable notes |
| **Port Management** | |
| `pd claim` / `pd release` | Claim/release deterministic ports |
| `pd find` | Wildcard service search (trie-accelerated) |
| **Coordination** | |
| `pd lock` / `pd unlock` | Distributed locks |
| `pd with-lock` | Run command under lock with auto-release |
| `pd pub` / `pd sub` / `pd watch` | Pub/sub messaging |
| `pd session files add` | Advisory file claims |
| `pd advise` / `pd preflight` / `pd compass` | Suggest coordination primitives before editing |
| `pd actors` / `pd actor <id>` | Inspect durable maritime actor souls and live body signals |
| **Fleet & Agents** | |
| `pd fleet init` | Create pd-fleet.yml + git hook |
| `pd fleet up/down/status/validate` | Start/stop/inspect/dry-run the fleet (CLI-attached mode) |
| `pd sortie` / `pd sortie list/status/logs` | Launch and inspect tracked mission records |
| `pd spawn` / `pd spawned` | Launch/list background agents |
| `pd spawn kill` | Kill a spawned agent |
| `pd salvage` | Dead agent recovery |
| **Fleet Daemon HTTP** | |
| `GET /fleet` | Aggregated daemon fleet status (all projects) |
| `GET /fleet/:project` | Status for a specific project's fleet; queued mailbox work appears as `status: queued` with `queueDepth` |
| `POST /fleet/start\|stop\|reload` | Manage daemon-managed fleets |
| `POST /fleet/register` | Register project dir for fleet management |
| `GET /fleet/events` | SSE stream of fleet lifecycle events |
| `GET /fleet/prompt` | One-line fleet status for shell prompt (query: `project`) |
| `GET /fleet/config/:projectRef` | Raw YAML + parsed config + topology validation; prefer URL-encoded `projectDir` |
| `PUT /fleet/config/:projectRef` | Write YAML config, validate, reload fleet; prefer URL-encoded `projectDir` |
| `GET /fleet/models` | Supported backends + model catalog + readiness hints (probes Ollama live) |

Fleet rows are mailbox-driven now: if an agent is already running and more triggers arrive, the daemon collapses them into queued work instead of spawning one run per wake. Treat `status: queued` plus `queueDepth > 0` as pending work, not a missed launch.
| **Swarm Memory** | |
| `pd tuple out/rd/in` | Write/read/take tuples |
| `pd tuple scan/count` | List/count tuples |
| `pd pheromone spray` | Set ambient signal on an entity |
| `pd pheromone sniff` | Read pheromone values (with decay) |
| `pd pheromone list` | List all non-zero pheromones |
| `pd pheromone files` | File heat map |
| `pd ideas list/search/show` | Search the canonical ideation trove plus live repo memory (notes, tuples, markdown) |
| **Observability (HTTP API)** | |
| `GET /metrics/golden` | Fleet health: rate, errors, duration, cost/hr (RED method) |
| `GET /metrics/cost` | Cost summary by project label + backend, with `projectDir` when known; spend history, not live-fleet truth (default: 24h) |
| `GET /metrics/cost/budget/:project` | Budget check — spend vs. ceiling |
| `GET /metrics/counters` | Counter summary or time-bucketed single key |
| `GET /metrics/counters/top` | Top N dimension values for a counter |
| `GET /metrics/cost/recent` | Most recent cost events |
| **System** | |
| `pd setup` | One-command onboarding (daemon + MCP + FleetBar + project init) |
| `pd status` | Daemon truth: runtime state, build hash, fleet counts, guardian status |
| `pd version` | Version and code hash |
| `pd arbiter status` | Invariant enforcement status |
| `pd arbiter violations` | List recorded violations |
| `pd dev start/stop/status` | Isolated dev daemon (port 9877) |
| `pd daemon start/list/status/stop/env <profile>` | Named sidecar daemon profiles under `~/.port-daddy/instances/` |

## Decision Matrix: Which Tool When

| Problem | Solution |
|---------|----------|
| First-time setup (daemon + MCP + FleetBar) | `pd setup` |
| Dev server port conflict | `pd claim myapp:api -q` |
| Need to coordinate with other agents | `pd begin` + `pd session files add` |
| Agent-to-agent signaling | `pd pub` + `pd sub` |
| Event-driven automation on a channel | `pd watch <channel> --exec ...` |
| Direct message to a specific agent | `talk_to_agent` MCP tool or `pd inbox send` |
| Background automation (terminal-attached) | `pd fleet init` + `pd fleet up` |
| Background automation (always-on, survives terminal) | Place `pd-fleet.yml` in a repo with durable Port Daddy markers; daemon auto-starts it |
| Need another daemon beside the canonical one | `pd daemon start <profile> --port <port>`, then `eval "$(pd daemon env <profile>)"` in shells that should target it |
| Reload fleet after editing pd-fleet.yml | `PD_URL="\${PORT_DADDY_URL:-http://localhost:9876}"; curl -XPOST "$PD_URL/fleet/reload"` or `kill -HUP <daemon-pid>` |
| Share knowledge across agents | `pd tuple out` / `pd tuple rd` |
| Check whether Spark/Spider or the repo already had this idea | `pd ideas search "query" --include-raw` |
| Track "hotness" of resources | `pd pheromone spray` / `sniff` |
| See file contention at a glance | `file_heat` MCP tool or `pd pheromone files` |
| Crashed agent left work behind | `pd salvage` |
| Exclusive operations (deploys, migrations) | `pd with-lock` |
| What happened while I was away? | `catch_me_up` MCP tool |
| Who else is working right now? | `swarm_awareness` MCP tool |
| Check for invariant violations | `pd arbiter status` |
| How much are my fleet agents costing? | `PD_URL="\${PORT_DADDY_URL:-http://localhost:9876}"; curl "$PD_URL/metrics/cost"` |
| Is a project over budget? | `PD_URL="\${PORT_DADDY_URL:-http://localhost:9876}"; curl "$PD_URL/metrics/cost/budget/myapp?budgetUsdPerDay=5"` |
| Fleet health at a glance (RED signals) | `PD_URL="\${PORT_DADDY_URL:-http://localhost:9876}"; curl "$PD_URL/metrics/golden"` |
| Top backends by spawn count | `PD_URL="\${PORT_DADDY_URL:-http://localhost:9876}"; curl "$PD_URL/metrics/counters/top?key=spawn.started&dim=backend"` |
| Show fleet status in shell prompt | `PD_URL="\${PORT_DADDY_URL:-http://localhost:9876}"; curl "$PD_URL/fleet/prompt?project=myapp"` |
| Read/edit fleet config via API | `GET /fleet/config/<urlencoded-projectDir>` or `PUT /fleet/config/<urlencoded-projectDir>` with `{ "yaml": "..." }` |
| What LLM backends are available? | `PD_URL="\${PORT_DADDY_URL:-http://localhost:9876}"; curl "$PD_URL/fleet/models"` |

## Delegation Reference

If you are choosing between launch surfaces, use `docs/DELEGATION-MODES.md` as the source of truth. It explains when to use `pd spawn`, `pd agent`, `pd sortie`, `pd fleet`, and how harbors fit in.

## Common Issues

### Port Daddy daemon not running
**Symptom:** `Connection refused` on any pd command
**Fix:** `pd start` or `pd install` (installs as launchd service, auto-starts on login)

### Port already claimed
**Symptom:** You get a port but it's the "wrong" one
**This is correct behavior.** Same identity = same port, always. If you need a different port, use a different identity context: `myapp:api:feature-x` instead of `myapp:api:main`.

### Session already active
**Symptom:** `pd begin` says a session exists
**Fix:** Call `pd whoami` to see the current session. Either `pd done` the old one or continue working in it.

### File claim conflicts
**Symptom:** Another agent claimed files you need
**Fix:** This is the system working. Check `pd swarm_awareness` to see who owns what. Coordinate via `pd pub` or work on different files.

### IPC connection failures
**Symptom:** IPC-related errors in logs
**Fix:** The SDK falls back to HTTP automatically. IPC is an optimization, not a requirement. Check that `~/.port-daddy/daemon.ipc` exists and has correct permissions (should be user-only, created by the daemon).

## For More Details

Consult `references/api-reference.md` for the full HTTP API (93+ endpoints).
Consult `references/sdk-reference.md` for the JavaScript SDK.
Consult `references/multi-agent-patterns.md` for advanced coordination patterns (leader election, pipeline stages, etc.).
