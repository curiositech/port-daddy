# ⚓ Port Daddy (v3.30.5)

<p align="center">
  <img src="website-v2/public/img/hero-portdaddy.png" alt="Port Daddy — the harbormaster for your AI agents" width="600">
</p>

<p align="center">
  <strong>Stop your agents from fighting each other.</strong><br />
  Atomic port assignment, session coordination, pub/sub messaging, sandboxed agent spawning, and crash salvage — one daemon, zero config.
</p>

<p align="center">
  <a href="https://npmjs.com/package/port-daddy"><img src="https://img.shields.io/npm/v/port-daddy.svg?logo=npm&color=3AADAD" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-FSL--1.1--MIT-blue?color=3AADAD" alt="license"></a>
  <a href="https://github.com/curiositech/port-daddy"><img src="https://img.shields.io/badge/tests-7,300%2B%20passing-brightgreen?logo=jest&color=3AADAD" alt="tests"></a>
  <a href="skills/port-daddy-agent-skill"><img src="https://img.shields.io/badge/MCP%20tools-180-blueviolet?color=3AADAD" alt="MCP tools"></a>
</p>

---

## Overview

**Port Daddy** is a daemon that gives every AI agent its own port, coordinates file access, sandboxes what agents spawn, meters what they spend, and recovers their work when they crash. One install, zero config.

While individual agents are brilliant, **coordination** is the bottleneck. Port Daddy provides the missing primitives: atomic port assignment, sessions with append-only notes, advisory file/symbol claims, distributed locks, pub/sub messaging, budget-bonded spawning, and automatic salvage.

```bash
# Start working (registers agent + claims port + starts session)
pd begin "Building the auth layer" --identity myapp:api --lifecycle durable --roadmap auth-layer

# Log progress, coordinate with other agents
pd note "JWT validation passing all tests"
pd pub api:ready '{"endpoints": ["/login", "/register"]}'

# Done (ends session + releases everything)
pd done "Auth complete"
```

HTTP examples in this README show the preferred local berth at `http://localhost:9876`. Runtime clients do not guess that port: they use an explicit URL, the Unix socket, or the selected daemon's published port file, and fail closed when none exists. If your daemon is elsewhere, FleetBar and `pd status` show the selected endpoint.

### ⚓ Key Primitives

- **Atomic Port Assignment** — zero race conditions. Semantic identities (`myapp:api:main`) map to stable, deterministic ports.
- **Sessions, Notes & Claims** — every work session leaves an append-only trail; file/symbol claims announce edit intent to the rest of the swarm.
- **Swarm Radio (Pub/Sub)** — low-latency SSE-backed channels with Maritime Signal Flags, plus `pd tube` for threaded two-party conversation.
- **Coast Guard Spawning** — agents launched through Port Daddy run in an OS sandbox with secrets scrubbed from their environment and a hard spend cap (ADR-0050).
- **Bonds & Budgets** — every spawn escrows a bond against a project wallet; budget breach is pause-and-ask, not silent overrun.
- **Automatic Salvage** — sessions and notes from crashed ("zombie") agents are preserved and offered to successors.
- **Host Safety (`pd safe`)** — scans the host for plaintext secrets, corrals them into the OS keychain, and guards the staged diff at commit time (ADR-0088).
- **Three Operator Surfaces** — FleetBar (macOS menu bar), Control Center (FleetBar's window), and pd-console (GPU-native operator console).

---

## 🧭 Table of Contents

- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Sessions & the Coordination Loop](#-sessions--the-coordination-loop)
- [CLI Permission Tiers](#-cli-permission-tiers)
- [Command Index](#-command-index)
- [Multi-Agent Coordination](#-multi-agent-coordination)
- [Spawning & Delegation](#-spawning--delegation)
- [Fleet Engine](#-fleet-engine-declarative-agent-orchestration)
- [Bonds, Wallets & Budget Guard](#-bonds-wallets--budget-guard)
- [Security & Host Safety](#-security--host-safety)
- [Daemon Operations](#-daemon-operations)
- [Observability & Cost Tracking](#-observability--cost-tracking)
- [Operator Surfaces](#-operator-surfaces)
- [MCP Server & Agent Skill](#-mcp-server--agent-skill)
- [HTTP API](#-http-api)
- [Configuration](#-configuration)
- [Executable Examples](#-executable-examples)
- [Development & Testing](#-development--testing)
- [Documentation Map](#-documentation-map)
- [Roadmap](#-roadmap)
- [License](#-license)

---

## 📦 Installation

### 1. Requirements

- **OS:** macOS (recommended) or Linux.
- **Runtime:** Node.js v20+ for the CLI and build tooling. The installed daemon runs from the distributed binary when present.

### 2. Install

```bash
# Via Homebrew (macOS)
brew install curiositech/tap/port-daddy

# Via npm
npm install -g port-daddy

# One-command onboarding: daemon + MCP config across editors + FleetBar + init
pd setup
```

`pd setup` detects your installed editors (Claude Code, Claude Desktop, Cursor, Windsurf, Gemini, Cline and friends), writes MCP configuration for each, installs the agent skill and Port Daddy Pilot definitions, starts the daemon under launchd supervision, and offers FleetBar.

Optional signed Mac menu-bar app from the public site:

```bash
curl -LO https://portdaddy.dev/downloads/PortDaddy-FleetBar-macOS-arm64.zip
curl -LO https://portdaddy.dev/downloads/PortDaddy-FleetBar-macOS-arm64.zip.sha256
shasum -a 256 -c PortDaddy-FleetBar-macOS-arm64.zip.sha256
unzip PortDaddy-FleetBar-macOS-arm64.zip
```

### 3. Verify

```bash
pd doctor          # Comprehensive health check (supervision, liveness, DB, drift, optional Bosun context…)
pd doctor --json   # Machine-readable report with per-check severity (ok | warn | critical)
pd doctor --ci     # CI/script mode: no prompts, exits non-zero ONLY on a CRITICAL check
pd attest          # Honest self-report: PASS/FAIL/SKIPPED/UNKNOWN per enforced invariant
pd start           # Start the daemon (binary-first)
pd bench 50        # Run performance benchmarks (target: <1ms latency)
```

`pd doctor` grades every check on a three-tier severity model — `ok`, `warn` (degraded but functional), `critical` (core function broken / daemon unsupervised + down / registry corrupt). Only a **critical** gates the exit code, so `--ci` is safe to wire into a build. The same `severity` is reported by the daemon's `GET /health` and surfaced as an alert state in FleetBar and the pd-console health pane.

`pd attest` (ADR-0045) runs the loud-fail invariant registry — daemon liveness, DB integrity/schema, crypto, brew-hash provenance, and more. "All good" is conjunctive and scoped: green only when every checked invariant passed, and the report always lists what it could NOT verify. Exits non-zero on any critical problem.

`pd start` and `pd install` are binary-first: they refuse to start a source-backed `tsx server.ts` daemon unless `PORT_DADDY_ALLOW_SOURCE_DAEMON=1` is set for a local development session. On a canonical macOS install, launchd is the sole lifecycle owner: `pd start`, `pd restart`, and `pd stop` control `homebrew.mxcl.port-daddy`, wait for one verified generation, and refuse a detached fallback when the launchd job is missing.

Bosun (`pd-bosun`, ADR-0036) is an optional legacy/opt-in watchdog. Since v3.28, supported installs use exactly one lifecycle supervisor — Homebrew launchd on macOS or the installed LaunchAgent/systemd service elsewhere — plus the daemon's own heartbeat writer. The release archives and Homebrew `post_install` deliberately do not install Bosun; `pd doctor` reports its absence as contextual warning, never a critical failure or repair request.

### Staying current

- `pd upgrade` checks the published `latest.json` release feed against your installed version and shows the verified daemon asset; `pd upgrade --apply` runs `brew upgrade port-daddy` for a Homebrew install (ADR-0057 phase 7).
- `pd self-update` is the unattended sibling — an hourly freshness LaunchAgent that keeps the live daemon and GUI current (ADR-0062).

---

## 🚀 Quick Start

### The One-Liner

Stop hardcoding ports in your shell scripts. Use `pd claim`:

```bash
# Claim a stable port for your project
PORT=$(pd claim myapp -q) npm run dev -- --port $PORT
```

### Starting the Stack

Port Daddy scans your project and builds a dependency graph automatically:

```bash
pd scan   # Detects 60+ frameworks and generates .portdaddyrc
pd up     # Starts all services in dependency order with color-coded logs
```

### Find Anything, Fast

All identities (services, agents, sessions, harbors) are indexed in an in-memory Adaptive Radix Tree — lookups are O(k) in key length, not SQL `LIKE` scans:

```bash
pd find 'myapp:*'          # Prefix search — all services under myapp
pd find 'myapp:*:main'     # Wildcard — all stacks with context "main"
pd find 'myapp:api:main'   # Exact lookup
```

---

## 🧵 Sessions & the Coordination Loop

Every unit of agent work is a **session**: begin, leave notes, claim files, finish. The trail is append-only — notes cannot be edited or deleted, which is what makes salvage and audit possible.

### `pd begin` requires an explicit lifecycle

```bash
pd begin "Fix flaky auth tests" --identity myapp:api --lifecycle durable --sidequest "flaky-test triage"
```

`--lifecycle` is **mandatory** and takes exactly two values:

- `durable` — ordinary agent work. The session outlives the process; if the agent dies mid-task, the session stays visible for salvage or takeover.
- `ephemeral` — heartbeat-bound process sessions. When the process stops heartbeating, the session ends with it.

The same requirement applies to `pd session start` and the MCP `begin_session` tool.

After registration, `pd begin` may print up to three semantically matched live
peers. This optional arrival hint has a 75 ms budget, excludes the new agent,
disables reconnect retries, aborts at the total deadline, uses no lexical
fallback, and disappears silently when semantic lookup is slow or unavailable.
It must never turn session admission into a coordination dump.

### Sugar-first Parley cards

In an ordinary capable interactive terminal, `pd begin` (after admission) and
`pd attention` (after its inbox receipt) may surface a bounded Sugar Parley
card. It appears only when the session's recorded purpose has a live,
semantically reviewed peer **and** the canonical claim projection proves a
shared file, symbol, or line-range overlap. Its three human actions are **Work
separately**, **Send note**, and **Resolve together**. The last action convenes
the bounded exchange with its validated parties, surface, and evidence; its
outcome is a typed settlement receipt.

Raw `pd parley` turns and receipts remain available for protocol inspection and
debugging, but they are not the normal agent experience. JSON, quiet, export,
piped, CI, and explicitly non-interactive invocations retain their deterministic
existing output; an interactive `NO_COLOR` terminal receives the same bounded
card as ANSI-free linework.

### `pd begin` charges roadmap rent

Every session must say where it sits on the roadmap — one line, at start, not at PR time. Pass exactly one of:

```bash
pd begin "…" --lifecycle durable --roadmap adr-0090-database-distribution   # link an existing item
pd begin "…" --lifecycle durable --roadmap-new "Rent-at-claim gate"         # create a draft item and link it
pd begin "…" --lifecycle durable --sidequest "one-off CI flake hunt"        # explicit opt-out (min 12 chars)
```

- `--roadmap <slug>` is validated against the daemon's roadmap; unknown slugs get a did-you-mean list of the nearest slugs by prefix.
- `--roadmap-new "<title>"` creates a draft roadmap item (provenance note `genesis-at-begin`) via the roadmap service and links it. If the slug already exists, the session links to the existing item instead of overwriting it.
- `--sidequest "<reason>"` records why the work is off-roadmap.

Without one of the three, non-TTY runs fail with the three options above; a TTY prompts interactively. The link or reason lands on the session record and shows up in `pd whoami` and `pd sessions`. `pd roadmap pop --begin` passes the popped slug through automatically. The MCP `begin_session` tool enforces the same gate: exactly one of `roadmap`, `roadmap_new`, or `sidequest` is required (`ROADMAP_RENT_REQUIRED` otherwise); only the daemon's raw HTTP surface stays lenient in v1.

### The loop

```bash
pd begin "…" --identity myapp:api --lifecycle durable --roadmap <slug>
pd note "Scope: lib/auth.ts. Assumptions: JWT lib stays. Validation: npm test"
pd session files add lib/auth.ts        # advisory claim — announce edit intent
pd add lib/auth.ts                      # claim-aware git add (refuses files held by others)
# …work…
pd done "Auth fixed; tests green"
```

`pd done --no-pr` is only for a genuinely ledger-only session: the worktree
must be clean and `HEAD` must contain no commit absent from every remote ref.
That verifier runs even when the branch itself is fully pushed. Dirty or
unpublished repository work still fails closed; the flag cannot hide an
unpushed change behind a “no artifact” receipt.

Every session progresses through **phases** for swarm visibility: `planning`, `in_progress`, `testing`, `reviewing`, `completed` / `abandoned`.

### Plan and Checklist Enforcement

Every active session requires planning. You can set, show, and check off todo list items:

```bash
pd plan set "- [ ] Implement tests\n- [ ] Update docs"
pd plan show
pd plan check 1        # Check off item 1
pd plan check "docs"   # Check off item by substring matching
```

When completing a session with `pd done`, the daemon checks if there are any unchecked checklist items (`[ ]` or `[-]`) in your plan. If unchecked items exist, `pd done` fails closed with code `PLAN_UNCHECKED_ITEMS`.

To bypass the check and complete a session with remaining incomplete tasks:
```bash
pd done "Complete session" --force-incomplete --reason "Deferred features to next ticket"
```
The reason must be at least 12 characters and will be stamped with `[OPERATOR-OVERRIDE force-incomplete]` in the handoff notes.

### Salvage, takeover & resurrection


When an agent dies (crash, lost connection, context exhaustion) its sessions and notes are preserved. New agents in the same project are notified at registration:

```bash
pd salvage --project myapp         # list dead agents' recoverable work
pd salvage claim dead-agent-99     # inherit a dead agent's session, claims, and notes
pd takeover <old-session-id>       # successor session with recorded lineage
```

`pd session takeover` creates a successor session, records the lineage in append-only notes, releases stale predecessor claims, and reclaims those files when there is no live conflict. `pd session rm` is archival: it releases active claims and writes a tombstone, but never deletes the session, notes, or claim history.

### Say / Look — the consolidated verbs

When you return from a break, or want to tell every other session about a finding:

```bash
# Say — one text, many fan-outs. Defaults to a session note.
pd say "fixed FOUC on hydrate in Hero.tsx" --pin --heat src/Hero.tsx=0.7
#      ^note        ^tuple (cross-session)      ^pheromone heat on the file

pd say "build broken on main, rolling back" --broadcast alerts

# Look — situation report. What happened while I was away?
pd look --since 30        # last 30m synthesis (activity + notes + salvage + spawns)
pd look --heat            # file heat map (pheromone contention)
pd sitrep                 # explicit maritime-voice alias
pd morning                # the overnight dispatch report

# Compass — which coordination primitive should I use before editing?
pd advise lib/sessions.ts --task "fix symbol claim conflict"
pd preflight docs/recovery/CURRENT-WORK.md --tuples
```

Sitrep is a bounded projection, not a database dump. Each collection reports
its limit, returned count, and truncation state; salvage histories and text
fields are capped. `pd sitrep --quiet` asks the daemon for the summary-only
projection so session-start and launcher paths stay small.

`pd advise` / `pd preflight` return deterministic recommendations with evidence and executable actions: session/context integrity, active claims, symbol freshness, stale salvage, declared channels, tuple-worthy facts, and true lock candidates.

### Actors — durable maritime roles

```bash
pd actors --project port-daddy
pd actor cartographer
pd actor navigator --message "roadmap item needs evidence"
pd actor navigator --inbox-stats
```

Durable actor souls (Coxswain, Gardener, QA/Signalman, Test Hunter, Documentarian/Lookout, Simplifier, Cartographer/Navigator, Spark, Spider) persist across agent bodies. `pd actor <id> --message` queues to the durable mailbox without granting a dormant actor live mutation authority.

### Roster — durable named experts

```bash
pd roster list --repo .
pd roster search "dense accessible dashboard typography" --repo .
pd roster create portdaddy-typography-expert --scope repo --remit "Own interface typography" --instructions "Inspect the house visual language first"
pd roster promote <session-id> --episode <handoff-episode-id> --slug portdaddy-typography-expert --remit "Own interface typography" --instructions "Preserve the proven session decisions"
pd roster continue <agent-node-id> --backend cli:codex --mode auto
```

Roster agents are daemon-minted `AgentNode` identities that outlive any body or session. Their meaningful slug is a scoped human alias, profile edits append revisions, and promotion requires a fail-closed sanitized handoff episode bound to the native harness session being promoted. Port Daddy coordination can enrich that handoff but is not required for historical sessions. Expertise lookup fuses BM25 with the shared local MiniLM embedder; any lexical fallback is labeled degraded. Runtime choice does not change the person: `pd roster continue` uses the existing native-or-sanitized-handoff receipt ledger. Stored permissions and triggers are explicitly declarations until a witnessed runtime enforces them. See ADR-0119.

### Coordination Guard (`pd guard`)

`pd guard install` writes merged pre-commit and post-commit hooks that enforce the protocol: an active session plus matching file claims for staged files, checked by `pd guard check --staged`. `pd add` is the claim-aware `git add`. Modes: `advisory`, `warn`, `enforce`.

---

## 🔐 CLI Permission Tiers

Every `pd` command is classified by how much shared state it touches. The tier is rendered in `pd help` next to each verb, and destructive commands prompt for confirmation before doing anything irreversible. The authoritative registry lives in [`cli/permission-tiers.ts`](cli/permission-tiers.ts) — when this README and that file disagree, the file wins.

| Tier | What it means | Examples |
|---|---|---|
| `silent` | Read-only. Safe to run anywhere. | `pd status`, `pd whoami`, `pd notes`, `pd briefing`, `pd sessions`, `pd actors`, `pd roster search`, `pd find`, `pd look`, `pd periscope`, `pd doctor` |
| `notify` | Mutates your own state. Reversible. | `pd note`, `pd begin`, `pd done`, `pd claim`, `pd lock`, `pd takeover`, `pd backup`, `pd cut`, `pd backend`, `pd plan` |
| `approval` | Affects other agents. No data loss. | `pd pub`, `pd spawn`, `pd sortie`, `pd up`, `pd dispatch`, `pd parley`, `pd squid`, `pd harbor create` |
| `destructive` | Releases someone else's resources or removes records. Prompts. | `pd restore`, `pd salvage claim`, `pd fleet panic`, `pd unlock --force` (full list below) |

### Destructive commands

Every entry below prints an impact-specific summary to stderr and prompts for confirmation. Pass `--yes` / `-y` or set `PORT_DADDY_YES=1` to bypass the prompt (the summary still goes to the audit log). In non-interactive mode (no TTY) without `--yes`, the command exits with code 130.

- `pd salvage claim <id>` — takes another agent's session, file claims, and notes
- `pd salvage complete <old> <new>` — finalizes inherited work; queue entry is removed
- `pd salvage abandon <id>` — returns inherited work to the queue
- `pd salvage dismiss <id>` — permanently removes an entry; context is unrecoverable
- `pd session abandon` — marks active session abandoned; other agents may salvage
- `pd release --expired` — releases stale port claims across all projects
- `pd unlock --force` — breaks a lock held by another owner
- `pd ports cleanup` — releases every stale port assignment
- `pd projects rm <id>` — deregisters a project from the registry
- `pd channels clear <name>` — deletes queued messages on a channel
- `pd dns cleanup` — removes stale DNS records across all projects
- `pd agent unregister` — removes an agent; its claims are released
- `pd agent inbox clear` — deletes all messages in the inbox
- `pd harbor destroy <name>` — tears down a harbor and evicts everyone in it
- `pd spawn kill <id>` — terminates a running spawned agent mid-run
- `pd restore <id>` — overwrites the live registry DB from a snapshot
- `pd fleet down` — SIGTERMs the running fleet
- `pd fleet panic --reason "<text>"` — SIGTERMs every running fleet agent (also requires typing `YES`)
- `pd fleet halt [--root <id>]` — Conductor total stop: SIGKILLs a scope and refunds (never slashes) its bonds (ADR-0060)
- `pd fleet pause` / `pd fleet resume` — soft stop / reopen admission for a Conductor scope
- `pd guard install` — writes git hooks; merges existing ones
- `pd guard install-shim` / `uninstall-shim` — alters how `git` behaves system-wide
- `pd guard enable` / `disable` — changes enforcement mode for the whole worktree
- `pd dev down` / `pd dev stop` — SIGTERMs an isolated dev berth while preserving
  its durable ledger; `--purge` / `--reset` additionally deletes that state
- `pd dev gc` — destructively removes dead/orphaned/idle dev-berth state
- `pd daemon stop` / `restart` / `uninstall` (and top-level `pd stop` / `restart` / `uninstall`)
- `pd down` — SIGTERMs the orchestrator and stops every service it manages

### Audit trail

Confirmation decisions are emitted to stderr in a parseable form:

```
destructive: Salvage claim will transfer agent-99's session, file claims, and notes to you. The previous owner loses control of that work.
destructive: confirmation bypassed via --yes / PORT_DADDY_YES
```

This applies whether you confirmed interactively, used `--yes`, or were refused in non-interactive mode.

---

## 🗂 Command Index

The full verb surface, grouped by what you're trying to do. One-liners; run
`pd <verb> --help` for the precise verb page or its documented command family.
A coverage ratchet prevents new verbs from silently falling back to generic
help. Authoritative tiers: [`cli/permission-tiers.ts`](cli/permission-tiers.ts).

**Ports & services** — `claim`/`c`, `release`/`r`, `list`/`l`, `ps`, `services`, `ports`, `url`, `env`, `find`/`f`, `scan`/`s`, `up`/`u`, `down`/`d`, `dns`, `projects`/`p`, `integration`, `wait`, `watch`

**Sessions & notes** — `begin`/`b`, `done`, `note`/`n`, `notes`, `session`, `sessions`, `takeover`, `add`, `say`, `salvage`, `resurrection`, `snapshots`, `who-owns`

**Situational awareness** — `status`, `whoami`/`w`, `look`, `sitrep`, `briefing`, `morning`, `periscope`/`sight`/`scope`, `activity`, `changelog`, `history`, `log`, `advise`/`preflight`/`compass`, `attention`, `nudge`, `swarm`, `actors`/`actor`, `agents`, `roster`, `whois`

The MCP `swarm_awareness` / `active_agent_roster` tools return a **bounded digest** of the roster — compact JSON under a hard character budget, with explicit omission counters when agents, claims, or notes are capped — so a tool result always fits in the calling agent's context window. The full-fidelity roster (complete note bodies, all claims, per-provider squid detail) stays on `GET /agent-roster` for FleetBar and Control Center. This sits under a universal, tool-agnostic backstop: **every** MCP tool result passes through an output governor (`lib/mcp-output-governor.ts`) before it reaches the caller, so no tool — with or without its own digest — can overflow a harness's tool-result cap. Override the budget with `PD_MCP_MAX_OUTPUT_CHARS`.

Session-scoped MCP tools (`add_note`, `list_notes`, `claim_files`, `claim_symbols`, `release_files`, `set_session_phase`, `coordination_preflight`, `whoami`, `end_session_full`) now default `session_id`/`agent_id` to the session this MCP server process attached to via `begin_session` — `session_id` is no longer required on them (`lib/mcp-session-cache.ts`). Because `mcp/server.ts` runs over stdio (one process per client connection), that cache is already correctly scoped without any transport-level session-id header; a caller can still pass an explicit id to act on a different agent's session. This closes the `AMBIGUOUS_ACTIVE_SESSION` trap where an agent's own session id, returned moments earlier by `begin_session`, still had to be re-supplied by hand on every call.

**Messaging** — `pub`/`publish`, `sub`/`subscribe`/`listen`, `broadcast`, `channels`, `tube`, `inbox`, `message`, `quorum`, `parley`

**Locks & shared memory** — `lock`, `unlock`, `locks`, `with-lock`, `tuple`, `pheromone`/`ph`, `graph`, `memory`, `semantic`, `embed`, `skill-graft`, `harbors`, `harbor`

**Spawning & delegation** — `spawn`, `spawned`, `agent`, `sortie`, `dispatch` (né `nightshift`), `review`, `fleet`, `harbormaster`/`hm`, `cockpit`, `backend`, `squid`, `transcripts`/`transcript`, `benchmark`, `coast-guard`/`cg`, `wallet`, `bond`, `popper`, `shipwright`

**Roadmap & ideas** — `roadmap`, `ideas`, `commit` (durable commitments/obligations), `feedback`. `pd roadmap chomp <doc.md…>` ingests any markdown planning doc into roadmap items (headings → project/epic/story/task hierarchy, checklists → tasks, explicit "depends on" → dependencies); the default run is a preview, and `--emit-pr-plan <dir>` performs the write while emitting the doc-removal PR artifacts (regenerated snapshot, work receipt, git-rm list, ready PR body). `pd roadmap import-markdown` remains as the legacy alias that chomps the three canonical curated piles. `pd roadmap search <text>` ranks roadmap items against free text (BM25 → cosine over shared MiniLM embeddings, same cascade as `pd whois`); `pd roadmap reindex` backfills the search index. `pd begin "<purpose>"` calls this automatically and prints ranked candidates when its rent gate would otherwise just reject you for omitting `--roadmap`/`--roadmap-new`/`--sidequest`. `pd roadmap export <slug> --to github|linear|jira` pushes one item to an external tracker (one-way, repeatable; the created issue's URL is recorded back as a typed link on the card).

**Daemon & host** — `start`, `stop`, `restart`, `install`, `uninstall`, `daemon`, `dev`, `use`, `doctor`, `diagnose`, `attest`, `health`, `metrics`, `bench`, `ci-gate`, `backup`, `restore`, `cut`, `upgrade`, `self-update`, `safe`, `secret`, `guard`, `config`, `init`, `setup`, `mcp`, `relay`, `tunnel`, `webhook`/`webhooks`, `version`

**Learning** — `help`, `learn`, `tutorial`, `demo`, `hints`

---

## 📡 Multi-Agent Coordination

Port Daddy is built for the "Wild West" of agentic workflows where agents hail each other ad-hoc.

### Cloud coordination peer (ADR-0092)

An optional per-project relay room federates sessions, append-only notes,
advisory file claims, and project-scoped logical lock leases between local and
cloud daemons. The room is a peer, never the authority: every daemon writes its
own SQLite ledger while offline, keeps a durable outbox, and CRDT-merges after
reconnection. Ports, processes, sockets, and machine-local exclusion remain
local. Each local ledger persists its replica identity beside that outbox, so a
daemon restart cannot strand older operations under a new sync envelope.
Replicated lock leases are shown under coordination-scoped projection names.
Ownership metadata and collision-safe fallback slots prevent them from
overwriting or releasing enforcing machine-local locks, including a lock that
already occupies a projection-shaped name.

The relay exposes an operator-gated grant endpoint and a macaroon-gated sync
endpoint. Grants are scoped to `coordination-sync` plus one project, actor, and
expiry. A deployment enables a daemon peer only when all four settings are
present: `PORT_DADDY_COORDINATION_URL`, `PORT_DADDY_COORDINATION_PROJECT`,
`PORT_DADDY_COORDINATION_ACTOR`, and the managed secret
`PORT_DADDY_COORDINATION_MACAROON`. Partial configuration is reported but does
not prevent the local daemon from starting or accepting local work.
Agents can inspect `coordination_status()` over MCP to distinguish a healthy
room connection from an offline peer with locally queued work; disconnected
never means the local coordination ledger stopped accepting writes.

Cloud sandboxes use the same runtime rather than a mock coordination client:
the executor builds the compiled binary, starts an isolated daemon with its own
`PORT_DADDY_PREFIX`, `PORT_DADDY_DB`, and `PORT_DADDY_SOCK`, waits for health,
and runs `pd begin` before sandbox work. It then waits until the session has
been durably acknowledged by the room and observed through the daemon cursor.
If an explicitly configured remote
daemon is unavailable, the CLI reports that peer as unavailable and never
silently starts a different local daemon or falls back to a local database.

### Swarm Radio (Pub/Sub)

Agents speak over named channels using maritime signals:

```bash
# Declare a canonical channel for this repo/worktree first
pd channels ensure swarm:general --scope branch --aliases general:swarm

# Discover what already exists in the current worktree
pd channels discover swarm

# Subscribe using the logical name — resolved to this worktree's physical channel
pd sub swarm:general

# Publish a "Mayday" signal from another terminal
pd pub swarm:general "Auth service is flatlining" --signal mayday --sender "NAVIGATOR"
```

Declared channels are git-sensitive by default: a branch-scoped channel resolves differently across worktrees, which stops unrelated branches from sharing a coordination bus. `pd pub`, `pd sub`, `pd watch`, and `pd channels clear` all auto-resolve logical names; `--raw-channel` bypasses resolution when you really want the literal string.

### `pd tube` — Conversational Pipe (with History Guard)

For one-line conversations between two agents (or scripts and agents), `pd tube` adds a thin envelope and a per-channel cursor so listeners don't re-emit messages they already processed:

```bash
pd tube agent:notes                      # listen: block until one event, print, exit
pd tube agent:notes --once --json | jq -r '.body'   # one-shot drain, resume from cursor
echo "shipped the fix in abc123" | pd tube agent:notes --send
echo "looks good — merging" | pd tube agent:notes --reply-to=42   # threading
```

History guard lives at `~/.port-daddy/tube-history-<safe-channel>.json`; `--no-history` ignores it, `--since=<id>` overrides it. `--json` for JSON lines, `--raw` for tab-separated, `--tail` for the human-watching loop. Tubes support multi-subscriber fan-out. Tutorial: [`docs/tutorials/pd-tube.md`](docs/tutorials/pd-tube.md).

### `pd parley` — Bounded Multi-Agent Debate

When agents disagree, a parley convenes them: a typed, bounded exchange of positions, critiques, votes, and revisions with a durable outcome — instead of two agents silently overwriting each other.

```bash
pd parley call "Should lib/sessions.ts adopt symbol claims?" --channel parley:arch
pd parley list
pd parley respond <id> --position "yes, with region fallback"
pd parley resolve <id>
```

Parley decisions render in pd-console's Parley pane, including CONVENE/hold economics (ADR-0086).

### Inboxes, Integration & Waiting

```bash
pd inbox watch --agent CAPTAIN                     # stream your inbox live (SSE)
pd inbox send CAPTAIN "Course corrected."          # sent as YOUR session's agent
pd integration ready myapp:api                     # signal the API is up
pd wait myapp:api                                  # block until a service is healthy
pd attention                                       # session-start mailbox aggregator
pd nudge                                           # list pending suggestibility nudges
```

An inbox send is a **credentialed** write (#8877 / ADR-0122). The inbox is an
instruction plane, not a display one: with `wake`, a DM becomes the `- sender:`
line in a spawned agent's prompt. So the daemon verifies who is sending —
`pd begin` captures the credential and `pd` presents it automatically, and a
`from` you did not earn is refused (`403 INBOX_FROM_MISMATCH`) rather than
written down as fact. There was no `--sender` flag on `pd inbox send`; the
sender is your session. Reads, clears and mark-read on another agent's inbox
are still unauthenticated — see the deferral in
[`docs/security/identity-write-boundary-audit.md`](docs/security/identity-write-boundary-audit.md).

### Durable Commitments

`pd commit` records an obligation ("I will fix the flaky test by Friday") that the obligation monitor tracks; `pd commit close` finalizes it, and overdue commitments surface in briefings (ADR-0041).

### Tuple Space (Shared Swarm Memory)

Typed tuples in a shared space, queried by pattern — based on Linda (Gelernter, 1985). Harbor-scoped for fleet isolation, TTL for auto-expiry:

```bash
pd tuple out '["connection", "trie+pubsub=routing", "spider", 0.9]' --harbor myapp:fleet
pd tuple rd '["connection", "*", "*", ">0.7"]' --harbor myapp:fleet
pd tuple in '["task", "build-auth", "pending"]'    # take (remove) a processed task
pd tuple scan --harbor myapp:fleet
```

Pattern matching: exact values, `*` wildcard, `>N`/`<N` numeric comparisons, `myapp:*` identity prefixes.

### Pheromone Trails (Ambient Signals)

Agents spray numeric signals (0–1) onto entities; signals decay at read time, creating ambient awareness:

```bash
pd pheromone spray --table services --id myapp:api --key urgency --strength 0.8
pd pheromone sniff --table services --id myapp:api
pd pheromone list
curl http://localhost:9876/pheromone/files    # file heat map (contention)
```

Use cases: adaptive Arbiter thresholds, file-contention detection, agent reputation, hot-path identification.

### Semantic Graph, Episodic Memory & Embeddings

```bash
pd graph edges --scope symbols:file:/path/to/server.ts   # durable relationship edges
pd graph stats --dir .                                    # graph density per project
pd memory episodes --project myapp --type handoff         # promoted handoffs/findings
pd memory tiers                                           # Core / Recall / Archival mapping (ADR-0035)
pd embed status                                           # shared local embedder (MiniLM) state
pd embed text "salvage a dead agent's session"            # embed ad-hoc text
pd embed prefetch                                         # one-time ~27 MB model download
pd skill-graft "write tests for a flaky fleet trigger"    # preview the local skill guidance a fleet ship would receive
pd skill-graft warm --local-only                          # checkpoint a bounded Tool2Vec batch with loopback Ollama only
pd skill-graft warm --all                                 # explicit full warm; may use the actor-pinned generator backend
# MCP: skill_graft_status() reads coverage without generating or calling an LLM
pd backend adapters --matrix                              # N:N native/handoff mechanics
pd backend adapters --probe                               # local discovery, not runtime proof
pd roster search "SQLite migration recovery" --repo .    # durable expert lookup (hybrid)
```

Search across Port Daddy is **hybrid** — BM25 plus one shared local embedding model (`Xenova/all-MiniLM-L6-v2`, prefetched at install per ADR-0061). Skill Graft's Tool2Vec centroids are reconciled content-hash-by-content-hash across the full user catalog: setup and daemon ticks use only loopback Ollama, never an inherited fleet or cloud backend, while a manual `pd skill-graft warm` may use an explicitly pinned `PD_SKILL_GRAFT_BACKEND`. The SQLite lease and row checkpoints make daemon, setup, and manual callers safe to resume after interruption. `pd doctor` reports current, cold, reconciling, embedder-down, or generator-down coverage. `pd memory tiers` prints the three-tier vocabulary overlay (Core/Recall/Archival) over the same SQLite substrate.

Backend-neutral continuation uses `POST /memory/handoffs` with `{ capsule, tokenBudget?, coordinationSessionId? }`, where `capsule` follows `pd.agent-harbor.handoff-capsule.v0`. The daemon enforces a 2 MiB ingress boundary, allowlists and bounds the capsule fields, preserves every operator turn and durable decision, sheds transcript tail before artifact summaries when a token budget is tight, recursively redacts structured credentials, and then requires a clean external `gitleaks stdin` verdict. Homebrew installs Gitleaks with Port Daddy; other installation paths must place `gitleaks` on `PATH` or set `PD_GITLEAKS_BIN`. Missing scanners, residual findings, or a budget too small for operator context fail closed; only the sanitized capsule is stored as an idempotent handoff episode keyed by source agent and session. Optional coordination-note harvest runs after that durable write and reports a warning rather than discarding a clean capsule when harvest is unavailable. The canonical schema is [`schemas/agent-harbor/v0/handoff-capsule.schema.json`](schemas/agent-harbor/v0/handoff-capsule.schema.json), extending the salvage contract in ADR-0028 without replaying raw provider transcripts.

Same-harness continuation is daemon-witnessed rather than inferred. All four native harnesses require UUID-shaped session identities, preventing option-shaped values from reaching their argv parsers. Claude, Codex, and Gemini require an explicit transcript reference instead of scanning an unbounded harness store; Claude JSONL and Codex `session_meta` must bind the UUID to the canonical workspace, agy must agree across its conversation-keyed brain transcript and exact `last_conversations` workspace mapping, and Gemini must agree across its project registry, project hash, UUID, explicit chat file, and canonical workspace. Evidence is opened once with no-follow semantics, read under fixed byte and entry caps, and bound to file plus workspace device/inode identity. `POST /memory/handoffs/:episodeId/continue` revalidates that witness immediately before spawn, carries the witnessed device/inode into the spawner, checks it again at the final child-process boundary, uses the canonical workspace as the child cwd, sanitizes the outgoing prompt, resolves all backend overrides, and permits native resume only when source and effective target share an adapter family with session-scoped resume support. Claude, Codex, agy, and Gemini then use their native session flags; Codex resume deliberately omits spawn-only `--sandbox` and `-C` flags. The canonical SQLite database atomically accepts each hashed idempotency key and gives every receipt a daemon-generation owner and lease. Startup recovery orphans only expired prior-generation work, accepted-to-running is a compare-and-swap that must succeed before spawn, and `success: true` is returned only after the same owner durably records `completed`; in-flight idempotent retries return HTTP 202 with `success: false` and `pending: true`. The receipt stores only hashes of the prompt and idempotency key. The sanitized prompt still enters the ordinary governed spawn transcript; its unredacted source never does. Read receipts through `GET /memory/continuations/:continuationId` or filter them with `GET /memory/continuations`.

Cross-harness continuation uses the same endpoint and receipt ledger. Choose the concrete runtime with `targetBackend` and set `mode` to `auto`, `native`, or `handoff` (`auto` is the default). Auto mode restores only a compatible session-scoped native family; otherwise it starts a new target session from [`pd.agent-harbor.handoff-successor-brief.v0`](schemas/agent-harbor/v0/handoff-successor-brief.schema.json). The brief carries durable identity and predecessor lineage plus the sanitized objective, every preserved operator turn, decisions, coordination evidence, workspace state, artifacts, and compact recent context. It explicitly treats historical content as data rather than new system/tool authority, is scanned again before acceptance, and never copies the raw provider transcript. Capsule workspace paths are context, never cwd authority: a successor reuses a reverified source workspace witness, or a stateless/history-only source must supply an explicit current `targetWorkdir`; Port Daddy captures that user-owned absolute directory's device/inode identity, binds it into request idempotency, and checks it again before spawn. An explicit target cannot redirect a witnessed session into another checkout. Explicit native mode fails rather than silently switching semantics; explicit handoff mode always creates a successor, even on the same backend family.

Spawner-launched bodies now feed their already-redacted transcript rows into Agent Harbor as real hash-chained conversation evidence. At run finalization the daemon emits a `ContextEnvelope` using the higher of adapter-reported usage and its persisted-transcript estimate. Crossing the compaction threshold builds and immediately revalidates a cited `CompactionPacket`; the packet is projected into the same sanitized handoff episode consumed by `POST /memory/handoffs/:episodeId/continue`, so the existing leased idempotency receipt remains the only successor path. `GET /agent-harbor/context-continuity` projects envelopes, packet head hashes, handoff episode ids, and continuation receipts for FleetBar. The Giant Squid panel shows this proof alongside hook health; it does not turn a self-reported percentage into a green status. The supported Claude `PreCompact` adapter emits that envelope through `POST /agent-harbor/interactive-context-pressure`: it uses the higher of provider-native usage and the daemon estimate, checkpoints `pd plan`, and admits a cited packet only after a session-bound tool-pair coverage receipt. Other interactive providers remain explicitly unsupported rather than simulated.

Harness portability is reported as predicates, not a marketing score. `pd backend adapters --matrix` prints the generated 17×17 native-or-handoff mechanics grid; `--probe` adds side-effect-free binary/help discovery. `GET /harness-adapters/continuation-matrix` and the read-only MCP tool `harness_continuation_matrix` keep those catalog ceilings separate from completed spawn transcripts and continuation receipts, label evidence older than seven days as stale, and leave exact live interaction unverified until a dedicated control receipt exists. Neither discovery nor an agent's self-report earns runtime conformance. The canonical response schema is [`schemas/agent-harbor/v0/harness-continuation-matrix.schema.json`](schemas/agent-harbor/v0/harness-continuation-matrix.schema.json).

The durable roster composes those primitives into long-lived named people. `POST /durable-agents` mints an opaque AgentNode principal with a scoped human alias; `POST /durable-agents/promote` requires a sanitized handoff episode whose source session matches the native harness session being promoted; `GET /durable-agents/search` uses BM25 + the shared MiniLM model with reciprocal-rank fusion; and `pd roster continue` passes that same AgentNode id through the existing continuation receipt ledger while choosing any catalog backend. Profile revisions remain append-only facts. Permission and trigger fields remain visibly declaration-only until a runtime can prove enforcement. The canonical profile contract is [`pd.agent-harbor.durable-agent-profile.v0`](schemas/agent-harbor/v0/durable-agent-profile.schema.json); architecture is ADR-0119.

### Artifact Harvest (Booty)

Artifacts an agent produces (design workups, screenshots, HTML mocks, videos) are durable truth on any branch. `pd booty add` content-addresses files into the blob store and records a provenance row — branch and worktree from git, session and agent identity from the active pd session:

```bash
pd booty add designs/hero.png --roadmap state-plane --note "hero workup v2"
pd booty list --branch claude/feature-x                    # what was harvested where, by whom
```

Re-depositing the same bytes on the same branch is idempotent; the same bytes on a different branch is a new provenance row. The daemon's blob store is authoritative for size and media type.

### The Arbiter (Runtime Invariant Enforcement)

The Arbiter monitors every state transition against formally-derived invariants: PID squatting, capability escalation, note monotonicity, escrow positivity, lock-owner validity, heartbeat freshness.

```bash
curl http://localhost:9876/arbiter/status
curl -X POST http://localhost:9876/arbiter/test-invariant/NOTE_MONOTONICITY   # demo injection
```

In strict mode, critical violations trigger man-overboard salvage.

### Webhooks

`pd webhooks` subscribes external systems to swarm events; the daemon also accepts **inbound** GitHub webhooks at `POST /webhooks/github`, gated by the event-spawn trust substrate (ADR-0093) so a webhook can trigger fleet work without becoming an unauthenticated code-execution path.

---

## 🚁 Spawning & Delegation

### Four delegation modes

Use the right surface for the job (canonical doc: [docs/DELEGATION-MODES.md](docs/DELEGATION-MODES.md)):

- `pd spawn` — the low-level primitive. Explicit backend, identity, budget, task.
- `pd agent` — the preferred single-agent sugar. One bounded task with coordination wrapped around it.
- `pd sortie` — a tracked mission record with a durable id, event log, harbor, and inspectable outcome.
- `pd fleet` — always-on project automation from `pd-fleet.yml`.

```bash
# Preferred single-agent delegation
pd agent "Review the last commit for regressions" \
  --backend claude --tier low --budget 0.35

# Harness lane: preflight + budget ceiling + tier sugar + stable tube in one shape
pd agent harness codex "inspect the queue" --budget 0.50 --tier strong --channel harness:demo

# Tracked mission record with status + logs
pd sortie "Investigate flaky auth tests; summarize root cause" \
  --backend claude --tier low --budget 0.75
pd sortie list
pd sortie status sortie-abc123
pd sortie logs sortie-abc123

# The primitive
pd spawn --backend claude --tier low \
  --budget 0.50 --identity myapp:fixer -- "Summarize the latest auth diff"

pd spawned              # list running/completed agents
pd spawn kill <id>      # terminate a running agent
pd transcripts          # durable agent transcripts (survive DB loss, ADR-0058)
```

### 🔬 Adapter conformance probes — `pd work probe`

The first landing of the Work Intent command family (ADR-0095: WorkIntent is the
sole runtime launch primitive; launch-shaped `pd work` forms refuse until
`pd work start` lands). Probes prove which bodies are **compliant, weak,
observed, or unmanaged** against the frozen compliance ladder — daemon-witnessed,
never self-attested (binder ch18 Work Order C2):

```bash
pd work probe                                     # all adapter kinds × all fixture profiles
pd work probe --adapter claude-code --profile malicious
pd work matrix                                    # capability matrix: mechanical ceilings per body kind
```

Each probe runs one witnessed check per ladder level (C0 Registered … C6
Resumable) plus the five required negative probes (`forged-level` per level,
`direct-mcp-bypass`, `disabled-hook-after-launch`, `forged-heartbeat`,
`observed-to-controlled`). A fired attack that is not downgraded fails the run
loudly — forged compliance cannot ship a badge. Exit is non-zero on any
uncaught forge, so the probe suite gates CI and promotion to a production
Agent Node.

Quiet mode (`-q`) prints raw output to stdout and exits non-zero on failure — perfect for shell scripts.

**Key flags:** `--backend`, `--model`, `--tier`, `--identity`, `--purpose`, `--budget`, `--allowedTools` (claude-cli), `--maxTokens`, `--workdir`, `--timeout`

**Backends in source:** `claude` (SDK), `claude-cli`, `codex`, `gemini`, `cloudflare` (Workers AI), `openai`, `groq`, `deepseek`, `xai`, `ollama`, `lmstudio`, `aider`, `custom`, and CLI-tube backends `cli:claude-code`, `cli:codex`, `cli:agy`, `cli:gemini`, `cli:groq`, `cli:grok`. Operator-facing launches are **fail-closed on telemetry**: metered API backends need exact token counts, an exact nonzero rate, and a persisted exact cost record. Spawn results and transcripts expose requested/effective backend+model provenance plus the override source when preflight or a forced CLI selection changes what actually ran. CLI-tube backends ride the operator's authenticated local CLI and record a flat session estimate; `cli:agy` captures the user prompt plus final stdout/stderr only until agy exposes a documented stream. `pd backend` switches the active provider/model configuration; `pd backend adapters` prints the generated N:N portability contract and `--probe` discovers installed binaries, advertised flags, and declared transcript roots without claiming spawn/resume conformance; `pd benchmark run` compares backends with real (paid) calls.

### 🛡️ The Coast Guard (ADR-0050) — confinement is the default

Every agent spawned through a subprocess backend (`codex`, `claude-cli`, `aider`, `custom`, `cli:*`) runs under the **Coast Guard by default** — no flag needed:

1. **Confine** — an OS sandbox (macOS Seatbelt; Linux Landlock/bubblewrap) **denies** reads to the crown jewels (`~/.ssh`, `~/.aws`, `~/.gnupg`, cloud creds, every `.env`/`.env.local` in `$HOME` and the workdir) while allowing normal work. `cat ~/.ssh/id_ed25519` → *Operation not permitted*.
2. **Broker** — the agent's environment carries **no raw API key**. Every managed provider key *and* every key loaded from your `.env` files is scrubbed from the child env; keys stay in the daemon's sealed cache.
3. **Cap** — outbound API traffic is forced through a local meter with a **hard per-agent request/byte cap**; the over-cap call is refused (`402 Spend Cap Exceeded`).

Each run emits a signed-style **receipt** (`SpawnResult.coastGuard`) recording what was confined, which keys were scrubbed, and the metered egress. Completed receipts remain visible in the daemon's `/spawn` history and FleetBar's compact Recent confinement section; no row appears when a backend has no receipt. `pd coast-guard` (alias `pd cg`) shows local confinement status; opt out per-run with `PD_COAST_GUARD_OFF=1`.

**Coordination keeps working.** Confinement denies secret-file *reads* — not network or process exec. The agent still reaches the daemon, runs the `pd` CLI, and talks to MCP servers (stdio MCP is a child process; loopback HTTP is `NO_PROXY`-exempt so local traffic never burns the spend cap).

**Honest scope (in code + receipt):** this defends the **cooperative case** — runaway spend, leaked-key blast radius, confused deputy, accidental exfiltration. It does **not** defend a truly-malicious same-UID agent (it can `unset HTTPS_PROXY` or read the daemon's memory); that needs the separate-UID broker (ADR-0087). See `tools/coast-guard/README.md` and run the live demo: `npx tsx tools/coast-guard/demo.ts`.

The tube→spawner router also carries **delegation-chain loop detection** (five loop classes), so agents that launch agents cannot silently recurse into a fork bomb; `PD_FLEET_MAX_DEPTH` caps recursion depth.

### Autonomous dev pipeline: dispatch → review

```bash
pd dispatch          # queue/run autonomous dev work across the fleet (formerly `pd nightshift`)
pd morning           # read the overnight dispatch report
pd review <id> --accept    # gate produced work into the tree (merge_policy=review, the default)
pd review <id> --reject
pd dispatch merge-sweep    # manually trigger the auto-merge check (see below)
pd harbormaster      # the coordinating overseer surface (alias: pd hm)
pd cockpit           # mission overview
```

`pd dispatch propose --merge-policy <review|auto|never>` controls what happens once a dispatch produces a PR:

- `review` (default) — the operator runs `pd review <id> --accept` and merges by hand.
- `auto` — Port Daddy merges the PR itself once **all** hold: every required CI check is green, `gh` reports the PR `mergeable` (no conflicts), zero unresolved review threads, and the PR is not a draft. It never force-pushes, never uses `gh pr merge --admin`/`--auto`, and never touches a `review`/`never` dispatch. The daemon sweeps this on an interval (`PD_DISPATCH_AUTOMERGE_POLL_MS`, default 60s); `pd dispatch merge-sweep` and `pd done` also trigger an immediate check. See `lib/dispatch/auto-merge.ts` for the full gate. This is a separate, narrower mechanism from `pd harbormaster`'s operator-approval (`pd review --accept`) merge queue.
- `never` — Port Daddy never merges; the PR sits for a manual close.

### Cloud Fleet — live run receipts

The signed-in website at `/account/runs` is the operator's durable Cloud Fleet
activity surface. It shows a PR review from webhook admission onward, before a
queue consumer or transcript exists, and links into the live receipt at
`/fleet/runs/:id`. Receipts distinguish one logical PR-head generation from its
at-least-once queue delivery attempts and ship transcript steps. They expose
queued, running, retrying, superseded, failed-admission, and terminal states,
plus actual and estimated timestamps; active pages refresh on a bounded cadence
and preserve reduced-motion preferences.

Repeated delivery IDs are idempotent. A successfully enqueued newer head marks
strictly older active generations superseded, and the executor checks that
durable admission row before expensive work. Queue-ahead and expected-time
values are explicitly D1-derived estimates, never a claim about Cloudflare's
internal queue position. Intent-only receipts remain exportable/deletable and
active receipts are never retention-pruned.

FleetBar and the Cloud Fleet pane in `pd-console` read those same
operator-gated receipts from the signed-in account; routine setup does not ask
the operator for relay environment variables. Both surfaces show logical state,
generation, delivery-attempt count, queue-ahead estimates, expected run timing,
failures, and a timestamped durable transcript with a short explanation of each
step. Active FleetBar runs refresh every five seconds, idle runs every twenty,
and failures back off with jitter. The console loads static ship configuration
once and re-reads transcript detail only when `lastProgressAt` changes; a failed
detail read opens a bounded retry circuit instead of multiplying relay traffic.
Per-step ETAs are shown only when the executor actually publishes one.

### Giant Squid — visible controls, invisible project-scoped hooks

`pd squid on` arms the complete harness for the current project. It stages the
three local tentacles, wires every detected agent CLI in its real interactive
scope, registers the exact project root, and adds a visible `◆ PD` identity,
Pilot SessionStart steering, and `/squid` control inside Claude Code:

```bash
pd squid on                 # full harness: Claude, Codex, Gemini, and agy
pd squid status             # state plus bounded recent timing and matrix windows
pd squid status --json      # stable, size-bounded FleetBar/automation contract
pd squid tap                # exact bounded context entering the next turn
pd squid debug status       # sanitized per-session hook timing and deadlines
pd squid off                # disarm this project without breaking other repos
pd hooks install            # hook-only repair surface
```

`pd squid status` and `pd squid debug status` share one diagnostic source.
Status returns at most 25 recent hook steps and 20 recent values per matrix
kind, with total/returned/truncated metadata; every step carries actual start,
expected-by and finish times plus its short description. A large retained
matrix or timeline therefore cannot truncate the JSON contract or queue more
hook work merely because an operator asked what is running. When debug capture
is off, routine status publishes only retained counts and hides archived runtime
session identifiers plus absolute workspace/event paths; use the explicit
`pd squid debug status` surface to inspect the retained diagnostic window.

Claude and Gemini use project config; Codex and agy require user config because
their interactive hook engines do not honor a project-local equivalent. Those
user-level entries are still project-scoped at runtime: the wrapper requires a
fresh daemon heartbeat, a `.portdaddy/` marker, and an exact match in the Squid
project registry. Outside an armed root they no-op. Coordination content stays
bounded: with the SITREP dial off, a healthy no-op turn emits zero bytes and no
status message; the hot path reads bounded local evidence and never waits on
the daemon or launches the full CLI. When an exact-project trace or fleet-wide
control alert is actionable, the coordination envelope is capped at one heading
plus two facts and 512 bytes of context, with a one-second harness deadline.
The end-of-turn SITREP is the deliberate exception (operator doctrine,
2026-08-22): governed by the per-repo `sitrep.endOfTurn` dial (`off` |
`suggest` | `enforce`, default `enforce`; `PD_SITREP` env override wins, then
`agent.config.json` → `.portdaddy/sitrep.json` → `.portdaddy/project.json`),
the prompt hook injects the end-of-turn SITREP table contract each turn — the
harness's visible value surface, riding outside the coordination byte cap.
`suggest` injects the contract as a suggestion; `enforce` marks a turn that
ends without the table incomplete. Scaffold the table with `pd sitrep
--template`. Reinstalling hooks is idempotent and migrates older duplicate
registrations while preserving user-owned hooks. The installed graph is
intentionally only one turn hook plus one direct-edit gate. Opaque shell/exec
tools do not schedule Port Daddy hooks, and no `PostToolUse` process is
installed; session claims and notes are the cumulative outcome record.

Provider configuration always calls the stable user-owned
`~/.port-daddy/bin/pd-hook-*` shims, never a versioned Homebrew Cellar path.
Hooks do not retry. After three consecutive unexpected exits or executions over
250 ms, that hook opens a five-minute fail-open circuit: subsequent calls are
immediate no-ops, the next turn gets one concise remediation notice, and
FleetBar marks Giant Squid `DEGRADED` with the affected hook, reason, timestamps,
and retry time. One half-open probe may recover automatically; FleetBar's
**Repair** button restages and rewires the shims and clears the latch only after
the repair succeeds. Intentional edit denial remains `exit 2` and never counts
against hook health. Portable latency measurement uses the external POSIX
`/usr/bin/time -p -o` interface so dash cannot leak reserved-word timing output
or silently report a slow hook as healthy. If that dependency is unavailable,
the hook fails open, self-disables, and asks for FleetBar Repair.

Hook reliability is treated as an integration contract, with the same evidence
required locally, in CI on macOS and Linux, and from the compiled release:

| Requirement | Bound | Verification evidence |
|---|---:|---|
| HOOK-R1 durable command interface | no `/Cellar/` lifecycle paths | adapter/install unit tests plus `scripts/smoke-squid-release.mjs` |
| HOOK-R2 bounded lifecycle topology | one turn hook, one direct-edit hook, zero post-tool hooks | hook-shape, provider-adapter, and compiled-release tests |
| HOOK-R3 fail-open containment | 3 unhealthy calls; 250 ms; no execution retry | executable wrapper failure/slow/exit-2/missing-timer tests on macOS and Linux |
| HOOK-R4 safe recovery | 5-minute OPEN cooldown; one HALF_OPEN probe | concurrent breaker and probe tests |
| HOOK-R5 operator remediation | `DEGRADED` plus FleetBar Repair | JSON contract and FleetBar store/UI tests |
| HOOK-R6 artifact portability | source tree absent at runtime | compiled CLI release smoke from a staged directory |

The non-diegetic value is explicit in both CLI and FleetBar: fresh coordination
context before a turn and foreign-ownership warning or blocking before a direct
edit. FleetBar's selected-project strip shows
the live state and provider count and exposes Arm, Repair, Disarm, and Inspect
buttons; routine operation does not require the operator to open a terminal.
Inspect opens an opt-in hook timeline grouped by agent session. Every PD TURN
and direct PD EDIT row shows its actual start/finish, one-second expected-by
timestamp, duration, gate outcome, and a short explanation. Overdue rows mean a
start record missed its deadline without a completion record. Capture is off by
default, bounded to 2 MiB of local timing events, and has no fields for argv,
environment snapshots, prompts, tool inputs/results, stdout, or stderr. Agents can use
`pd squid debug on|off|status|clear --json` for the same contract when repairing
the operator surface. PD TRACE rows may remain in retained timelines from older
three-hook installs; new installs never schedule them.

### Giant Squid — Claude-to-Codex bridge

Want Claude-shaped local orchestration while spending against the OpenAI Codex CLI auth already on the machine? `pd squid` serves a small Anthropic-Messages-compatible endpoint on localhost, generates a fresh local token, injects `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` into a launched client, and forwards each request to `codex exec`:

```bash
pd squid codex -- claude --model sonnet
pd squid pro --codex-effort high -- claude --model sonnet
pd squid bridge --codex-model-alias <client-model>=<codex-model> -- claude --model sonnet
pd squid serve --port 8765     # bridge only; prints the token for curl/debugging
```

Two model layers: `--codex-model` / `--codex-effort` / `--codex-config key=value` control the Codex backend; `--codex-model-alias <client=codex>` lets a Claude client keep asking for a Claude model name. Anthropic `thinking.budget_tokens` maps honestly to Codex `model_reasoning_effort`; `thinking` blocks are omitted before prompting Codex; Codex tool calls become Anthropic `tool_use` blocks so Claude-style tool loops continue. The bridge binds loopback-only by default, uses timing-safe token comparison, and caps request bodies (`PD_SQUID_MAX_REQUEST_BYTES`, default 8 MiB). Responses carry a `port_daddy` provenance object. The local Squid PreToolUse hook honors the ADR-0092 `suggestibility` dial (`advisory | warn | enforce`) before file-mutating tools cut into a foreign-locked path. This is an unofficial compatibility layer for local dogfooding — not an official Claude Code auth mode, and not for exposure as a shared remote service.

---

## ⛴ Fleet Engine (Declarative Agent Orchestration)

Declare your background agent fleet in `pd-fleet.yml` — like docker-compose for AI agent swarms. The daemon auto-discovers and starts fleets in known repos on boot; no terminal to keep open.

```yaml
# pd-fleet.yml
fleet:
  name: my-project-dev
  harbor: "{project}:fleet"

  limits:
    max_concurrent_spawns: 2        # At most 2 agents running in parallel
    max_spawns_per_hour: 20         # Rate cap (Ostrom Principle 2)
    budget_usd_per_day: 5           # Settled-spend prelaunch threshold in USD

  agents:
    qa:
      trigger: git:committed          # React to pub/sub events
      backend: claude
      capability: cheap
      prompt: |
        Review the most recent commit. Find bugs. Write tests.

    gardener:
      schedule: "*/10 * * * *"        # Or run on a cron schedule
      run_on_start: false             # true only when boot-time work is intentional
      backend: claude
      capability: cheap
      prompt: "Summarize repo status; suggest the next maintenance action."
      on_success: publish git:status  # Chain agents via channels

  channels:
    git:committed:
      description: "Fired after a successful commit"
      consumers: [qa]
```

**Two fleet modes:**

- **CLI mode** (`pd fleet up`): manual, runs while your terminal is open.
- **Daemon mode** (automatic): the daemon scans known repos on boot (markers: `pd-fleet.yml`, `.portdaddyrc`, `.portdaddy/`) and starts discovered fleets. Survives terminal close, sleep, and daemon restarts (launchd `KeepAlive`). Editing `pd-fleet.yml` hot-reloads.

```bash
pd fleet init       # Create pd-fleet.yml + git post-commit hook
pd fleet up         # Start all agents (foreground)
pd fleet validate   # Parse YAML, resolve templates, dry-run topology checks
pd fleet status     # View running agents
pd fleet down       # Stop all agents

curl http://localhost:9876/fleet                    # Global fleet status
curl -X POST http://localhost:9876/fleet/reload     # Reload configs (same as SIGHUP)
curl http://localhost:9876/fleet/events             # SSE lifecycle stream
curl 'http://localhost:9876/fleet/prompt?project=myapp'   # One-liner for your PS1
curl http://localhost:9876/fleet/models             # Available backends & models
```

Every fleet agent gets full coordination for free: registration, sessions, heartbeats, salvage on crash. Repeated trigger bursts collapse into **queued** work (mailbox semantics — `status: queued`, non-zero `queueDepth`) instead of spawning a fresh agent per wake. Template variables (`{project}`) resolve from YAML context; lifecycle events publish on `fleet:events`. The same fail-closed telemetry policy as manual launches applies. A declaration with `enabled: false` remains inspectable in the source-aware Fleet AST but is omitted from executable runtime config; a present malformed `enabled` value also fails closed to disabled. Scheduled ships default `run_on_start: false` so a daemon restart cannot fan out a whole fleet before `/health` is stable. Fleet accepts `*/N * * * *`, `0 */N * * *`, `M * * * *`, and `M H * * *`; fixed-clock schedules re-arm against host-local wall-clock time. At DST boundaries, local `Date` semantics advance spring-forward gaps and select the earlier fall-back occurrence; this is not a timezone-aware calendar walker. Malformed, unsupported, or calendar-constrained expressions fail closed: Fleet arms neither a timer nor `run_on_start`, emits `agent_failed`, and forecasts zero launches. Ships can opt into native skill guidance with `skill_graft: true`; `pd skill-graft` previews, checkpoint-warms, and reads guarded references from the same local index. Fleet queries never generate missing Tool2Vec rows on their hot path. Red Team declares the registry's high model tier so adversarial security review never inherits a weaker CLI default.

Fleet schema: ADR-0019 (`docs/adr/0019-declarative-fleet-yaml.md`); typed AST + diagnostics: ADR-0026. This repo dogfoods its own fleet — see `pd-fleet.yml` and `docs/fleet/` for the current ship roster and known issues.

---

## 💰 Bonds, Wallets & Budget Guard

Port Daddy escrows virtual USD before each agent spawn and can stop live spawns that breach their daily budget. Spend is observable (cost-tracker); enforcement is separate (bonds). You top up a project wallet; every spawn debits a small bond; clean exits refund it; misbehavior slashes it.

**Spawning requires a daily budget.** Every project must set `usd_per_day` before its first spawn; the daemon refuses unbonded agents. Run `pd wallet budget <project> --usd-per-day 5` during setup. No agent runs without a number to enforce against.

**Budget breach is pause-and-ask, not cliff SIGTERM** (the `budget_guard` feature). At 100% of daily budget, Port Daddy posts a *pending kill* with a 60-second grace window and broadcasts on `budget:pending`. The operator can `raise` (credit the wallet, agent keeps running), `kill` (SIGTERM now), or `grace` (extend, up to twice). The backstop SIGTERM fires at expiry. `pd wallet pending` lists; `pd wallet raise --agent <id> --usd 5` resolves.

Per-launch positive finite `budgetUsd` on `pd spawn` / `POST /spawn` is stricter: once exact spawn telemetry is recorded, a run whose final `telemetry.costUsd` exceeds that cap is finalized as `over_budget` with the transcript and cost preserved for readback.

**Fleet Conductor cost gates (ADR-0060).** Every sortie and reactive spawn routes through one `conductor.launch` chokepoint that reserves against a global ceiling and a per-subtree lineage ceiling *before* admission:

| Env var | Default | Effect |
|---|---|---|
| `PD_FLEET_GLOBAL_CEILING_USD` | `25` | Total aggregate fleet spend cap (`off`/`0` = unbounded, logged loudly) |
| `PD_FLEET_LINEAGE_CEILING_USD` | `5` | Per-subtree (per-root) spend cap stamped on launches without their own |
| `PD_FLEET_DEFAULT_BOND_USD` | `0.01` | Reservation floor so the breaker accrues even on bond-less launches |
| `PD_FLEET_MAX_DEPTH` | `3` | Max recursion depth (agents launching agents) |

Operate the live fleet with `pd fleet halt|pause|resume|inspect|tree`. `halt` is total (SIGKILL + refund); `pause` is soft. `pd fleet panic` is the two-step global kill switch — it **refunds** (never slashes) running bonds, because operator action is not agent misbehavior.

```bash
pd wallet top-up myapp --usd 20
pd bond list --project myapp
curl -X POST http://localhost:9876/bonds/42/slash \
  -H 'Content-Type: application/json' -d '{"portion": 0.5, "reason": "leaked secrets to stdout"}'
```

**What the wallet actually is.** A *governance accounting unit*, not money. When the backend is `claude` (SDK), `codex`, `gemini`, or `cloudflare`, the dollars map to real per-token billing. When it's `claude-cli` (your subscription) or `ollama` (local), marginal cost is ~$0 and bonds become a quota, a kill switch, a priority ordering, and an audit trail. Useful — but don't pretend it's money.

---

## 🔒 Security & Host Safety

### Managed Secrets (`pd secret`)

Provider credentials (Anthropic, Gemini, Cloudflare, ngrok, Voyage, …) live in the OS keychain — encrypted at rest, fail-closed when the keychain is unavailable. Only an explicit allow-list of keys is accepted.

| Command | What it does |
|---------|--------------|
| `pd secret set <KEY>` | Store via a **hidden stdin prompt** — the value never touches `argv`, shell history, or the process table. Pipe-friendly: `echo "$TOKEN" \| pd secret set KEY`. |
| `pd secret list` | Names and status only — never values. |
| `pd secret reveal <KEY> [--copy]` | Print with a warning, or `--copy` to `pbcopy` with a 45s clipboard auto-clear. |
| `pd secret rm <KEY>` | Remove from the keychain. |

HTTP surface (loopback-only): `GET/POST /secrets`, `POST /secrets/:key/reveal`, `DELETE /secrets/:key`.

### Host Safety (`pd safe`, ADR-0088)

The "little sniffer" for your development host:

```bash
pd safe scan                    # read-only posture audit: plaintext secrets, loose perms
pd safe corral <KEY> --apply    # move a plaintext secret into the vault; rewrite the
                                # source line to pd-secret://KEY (dry-run by default,
                                # .bak kept, value round-trip-verified before any write)
pd env exec -- npm run dev      # resolve pd-secret://KEY refs into ONE child process env
pd safe guard --staged          # exit non-zero when a NEW secret is staged
pd safe fix                     # opt-in chmod of crown-jewel permissions
```

`pd safe guard --staged` is wired into this repo's pre-commit hook: fail-open when `pd` is absent, fail-closed when it finds a staged secret. Corralling reduces blast radius (no plaintext at rest) but is honestly **not** confidentiality against a malicious same-UID agent — that needs the separate-UID broker (ADR-0087).

### Note Encryption

Session notes are encrypted at rest with AES-256-GCM. Master key at `~/.port-daddy/master.key` (auto-generated); per-session keys wrapped with it. ProVerif-verified: an attacker with database access cannot learn note content.

### Formal verification

ProVerif models cover the Anchor Protocol (agent identity), anchor attenuation, event-relay secrecy, and note escrow; Kani proofs cover Rust kernel invariants. Two white papers ship at `/whitepaper` on the website: **The Anchor Protocol** (formally verified cryptographic identity for agent swarms) and **The Bonded Commons** (pre-transactional trust infrastructure).

---

## 🏥 Daemon Operations

### System health

```bash
pd status    # Authoritative daemon truth: runtime state, build hash, fleet counts
pd version   # Version, code hash, install dir, PID
pd doctor    # Three-tier health check (see Installation)
pd attest    # Invariant self-report
pd diagnose  # Deeper diagnostics
curl http://127.0.0.1:9876/status   # Full daemon report incl. recent activity and spend
curl http://127.0.0.1:9876/transcripts/compliance  # Transcript backend matrix + live stalled/missing-run HITL issues
curl http://127.0.0.1:9876/transcripts/emergency   # HITL transcript emergency summary across local + cloud writers
```

`launchctl` is the sole canonical process supervisor on macOS. The daemon owns readiness and publishes one generation identity across `/health`, `daemon.pid`, `daemon.port`, its listener, binary hash, and filesystem heartbeat. Bosun is the independent non-agent watchdog: it can ask launchd to replace a dead or wedged generation, but it never spawns one. `pd status`, Doctor, FleetBar, and pd-console are observers of that shared snapshot, not additional supervisors.
`GET /status` and `GET /health` now fold transcript-flow health into `runtime.transcripts`, and surface critical live-run gaps (stalled live stream, missing final transcript) as HITL-tagged runtime reasons.

### Daemon berths (ADR-0084)

Run tiered daemons side by side — a stable daemon for real work, a dev daemon for the branch you're hacking on:

```bash
pd dev up          # start an isolated feature-branch dev daemon
pd dev up --fleet  # also arm its worker for governed WorkIntent launches
pd dev down        # stop a berth; preserve its isolated ledger
pd dev down --purge  # explicit destructive reset
pd dev gc          # destructively reap dead/orphaned/idle berth state
pd use <berth>     # emits a shell snippet for this shell/process (eval it)
```

`pd use` is not a global daemon switch. It points the current shell or launched
process at a berth; FleetBar, Control Center, and pd-console show the
berth/codebase/dev lane they are actually connected to. New berths retain stable
board history but start with an empty executable dispatch queue, so an isolated
worker cannot recover and duplicate stable-daemon work. After bootstrap, the
named berth DB survives ordinary stop/restart and automatic process reaping;
only `--purge`, `--reset`, or explicit `pd dev gc` deletes that cool-bus state.

### Backup & restore (ADR-0037)

Durable, WAL-consistent snapshots of the whole registry DB — gzipped, sha256-verified, integrity-checked, GFS retention:

```bash
pd backup                          # take one now
pd backup list / show / prune
pd backup schedule install         # daily launchd agent
pd restore <id>                    # roll the DB back (destructive tier, prompts)
```

### Cutting a release (`pd cut`)

`pd cut` orchestrates a local release cut — daemon binary, Rust kernel cdylib, FleetBar.app — with honest `signed:false` marking unless `--require-sign` (fail-closed signing, ADR-0057). For Port Daddy itself, the release boundary is the signed-binary cut: tagging `v<version>` triggers `release.yml`, which rebuilds daemon, CLI, and MCP server as signed/notarized binaries (ADR-0028), emits GitHub/Sigstore provenance for each platform archive, and publishes a `latest.json` update feed (version + per-artifact URL + SHA-256 + signed flag). The `curiositech/homebrew-tap` workflow discovers stable releases on a serialized schedule, verifies the tag, dual Batten imprints, archive digests, and v3.30.3+ provenance, then updates the formula without a cross-repository write token.

### Batten down the release (`pd batten`)

`release-artifacts.json` is the declarative manifest of every binary and runtime asset that MUST ship inside a release tarball (`pd`, `port-daddy`, its manifest, the Squid tentacles, `pd-statusline`, and the Pilot SessionStart hook). `pd-bosun` is intentionally absent from v3.28+ single-supervisor archives. `pd batten verify --staged-dir dist` asserts each declared artifact is present, executable where required, and at least its `minBytes` — collecting **every** failure and exiting nonzero with a per-artifact report. The release job then launches the staged `pd` from outside the source tree and proves `pd squid on` writes the canonical Claude, Codex, Gemini, and agy configs plus every identity asset. `pd batten imprint --staged-dir dist --out <file>` sha256s the sealed cargo into a `release-imprint.json` record. Both subcommands are offline (node stdlib only) and never touch the daemon.

### Single-binary distribution

`npm run build:bin` emits `dist/port-daddy` plus a manifest; the binary carries the CLI, the MCP stdio server, and a hidden `__daemon` entrypoint in-process — Fleet UI and public samples are embedded via a generated asset table and smoke-tested at build time. The standalone daemon companion `dist/daemon/port-daddy-daemon` remains for daemon-only installs.

---

## 📈 Observability & Cost Tracking

Three subsystems work together:

- **Counters** — ODS-style bump counters, time-bucketed, flushed to SQLite every 10s, auto-pruned at 30 days. Auto-incremented for spawn/session lifecycle events.
- **Cost Tracker** — per-spawn LLM cost. New daemon-managed launches fail closed instead of recording opaque estimates; historical buckets may contain legacy estimated sessions.
- **Golden Signals** — RED-method metrics in a single endpoint: rate/min, error %, avg duration, cost/hr burn.

```bash
curl http://localhost:9876/metrics/golden
# → { ratePerMin: 1.2, errorPct: 5.0, avgDurationMs: 4200, costPerHour: 0.23 }
curl http://localhost:9876/metrics/cost                       # totals, byProject, byBackend
curl "http://localhost:9876/metrics/cost/budget/myapp?budgetUsdPerDay=10"
curl "http://localhost:9876/metrics/counters?key=spawn.started&groupBy=minute"
curl "http://localhost:9876/metrics/counters/top?key=spawn.started&dim=backend&n=5"
curl http://localhost:9876/metrics/prom                       # Prometheus scrape endpoint
```

`pd metrics` from the CLI; `/metrics.html` serves a Prometheus dashboard.

---

## 🎛️ Operator Surfaces

Port Daddy ships exactly **three** sanctioned operator surfaces (the legacy web dashboard at `/index.html` was retired in 3.24.0 — it is now a minimal landing page that health-checks the daemon and points here):

1. **FleetBar** (`apps/FleetBar/`) — the SwiftUI macOS menu-bar app. Daemon health at a glance, berth chip, cost dashboard, secrets pane, visual task intake, one-click "Open Operator Console". Auto-launched by the daemon.
2. **Control Center** — FleetBar's window. Fleet graph, agents view (configured fleet agents, live registry, spawned runs, salvage ghosts, inbox traffic, sessions/notes, channels, claims), fleet config editing with topology validation.
3. **pd-console** (`core/pd-console/`) — the GPU-native (gpui) mission console. It opens on one full-window Work screen: the operator describes an outcome in plain English; the daemon persists one provider-neutral WorkIntent, admits the governed runtime, and binds the exact launch, agent, model, transcript, worktree, and PR back to that mission. Live work and current PR checks remain attached across restarts. Fleet, Sessions, Health, and other deep-truth views are secondary inspector surfaces, not competing defaults. The persistent PTY drawer remains an emergency shell for the real `pd` CLI, not an internal app adapter. Build via `make` / `make install`; the Homebrew cask ships `pd-console-prod.app`.

The Agent Harbor runtime-refactor target triad centers pd-console as the deep
truth surface, FleetBar as ambient consent/status/re-entry, and Scout as
evidence-backed intake. Those operator clients use the shared daemon contract /
Surface Gateway path. CLI and MCP are automation adapters, not something the
native surfaces shell out to internally.

Visual feedback loop (the `visual_tasks` feature): FleetBar and the `apps/pd-scout-extension` Chrome extension can submit annotated screenshots (`POST /visual-tasks`); the daemon persists the evidence, publishes `visual-feedback`, routes to a local agent or cloud-fleet target, and opens a reviewable work item.

---

## 🤖 MCP Server & Agent Skill

The MCP server exposes **180 tools** across the whole surface — session lifecycle (`begin_session` with the same required `lifecycle` enum, `end_session_full`), ports, notes, locks, messaging, salvage, actors, inboxes, webhooks, DNS, tunnels, sorties, tuples, pheromones, roadmap, commitments, parleys, symbols/conflict prediction, region-scoped editor claims (`claim_region`/`release_region`, agent-neutral), fleet control (bonds/wallets/panic), semantic graph/memory, harbormaster status, and discovery (`pd_discover`) — plus **6 resources** (`port-daddy://skill`, `://services`, `://sessions`, `://agents`, `://locks`, `://tunnels`).

```bash
pd mcp install          # auto-detect Claude Code, Claude Desktop, Cursor, Windsurf,
                        # Gemini, Cline; write MCP config; install the agent skill
                        # + Port Daddy Pilot definitions
pd mcp install --list   # show what would be configured
```

The **agent field manual** ships as a portable skill at [`skills/port-daddy-agent-skill/`](skills/port-daddy-agent-skill/) — mirrored into `.claude/skills/`, `.codex/skills/`, `.agents/skills/`, and `.gemini/extensions/` so every harness sees the same doctrine. `npm run skills:sync` keeps mirrors aligned; CI checks them.

---

## 🌐 HTTP API

The full API contract lives at [`docs/openapi.yaml`](docs/openapi.yaml) — OpenAPI 3.1, **133 paths, 166 operations**, covering everything the CLI and MCP server can do plus SSE streams (`/fleet/events`, inbox watch, channel subscribe). The daemon binds loopback with a DNS-rebinding guard; secret routes are additionally loopback-gated per-route.

The `editor_recovery` Harbor Editor salvage routes are authenticated, fail-closed scaffolding at `POST /editor/recovery/request`, `/prepare`, `/replay`, and `/finalize`; registration does **not** make a usable recovery pipeline. Four external build gates remain unimplemented: the P1 Rust operation-receipt producer, P1B, the canonical Rust Loro recovery adapter, and the P3 same-database released-claim transfer adapter. Daemon scope minting also cannot yet supply the required verified worktree root device/inode witness, and production has no content-hash/parser-generation symbol lease or daemon file-mutation generation authority. The routes therefore remain 503-gated with no CLI/MCP bypass.

The required future finalization contract retains descriptor-bound root/file identity plus both authority leases through the P3 transfer transaction, and transfers the exact file hash, parser/authority generations, and mutation lease/generation into the successor claim tuple. The mutation lease would exclude daemon-authorized writes through commit; an unrelated OS process could still bypass the daemon, so P3 must reject every later edit if the persisted root/file device+inode, content hash, or mutation generation no longer matches. That is detection at the next governed edit, not filesystem-wide prevention. The target transaction also writes canonical editor-owned provenance and its append-only outbox atomically. With no atomically idempotent derived-note sink, the row must stay durably pending with no retry churn and never fall back to `sessions.addNote`; once such a publisher and lifecycle scheduler exist, bounded startup and periodic passes retry the same idempotency key and persist one local publication receipt. These are unimplemented requirements, not behavior the current registered routes provide. The current tables have never shipped on `main`, so reconstruction supports only the exact current schema, not intermediate PR schemas.

```bash
cat docs/openapi.yaml
```

---

## ⚙️ Configuration

### `.portdaddyrc`

Commit this so every developer gets the same deterministic port mapping:

```json
{
  "project": "payment-pro",
  "services": {
    "api": { "cmd": "npm run dev:api -- --port ${PORT}", "healthPath": "/health" },
    "web": { "cmd": "next dev --port ${PORT}", "needs": ["api"] }
  }
}
```

### Environment variables

- `PORT_DADDY_URL` — explicit daemon-address override; otherwise clients use a real Unix socket or the selected daemon's published port and never guess `9876`
- `PORT_DADDY_RANGE_START` — port pool start (default `3100`)
- `PORT_DADDY_YES=1` — bypass destructive-command prompts (audited)
- `PD_COAST_GUARD_OFF=1` — opt a spawn out of confinement
- `PD_FLEET_*` — Conductor cost gates (see Bonds & Budgets)
- `PORT_DADDY_ALLOW_SOURCE_DAEMON=1` — permit a source-backed dev daemon
- `PORT_DADDY_ALLOW_MODEL_DOWNLOAD=1` — opt in to downloading the local embedding model (`Xenova/all-MiniLM-L6-v2`) from huggingface.co at runtime; by default the daemon never phones huggingface.co and, without a cached model, semantic retrieval degrades to the lexical (BM25) path labeled `degraded`. `TRANSFORMERS_OFFLINE=1` always wins and forces offline.

---

## 📖 Executable Examples

| Pattern | Goal |
|---------|------|
| **Leader Election** | Use locks to appoint a single master agent in a worker swarm. (`/examples/leader-election`) |
| **P2P Handshake** | Use inboxes as signaling servers to establish WebRTC tunnels. (`/examples/p2p-webrtc`) |
| **Ephemeral CI Database** | Claim a stable semantic port for a per-run test database. (`/examples/ephemeral-ci-db`) |
| **Agent Topologies** | Publish star, ring, and arbiter topology events into inspectable channels. (`/examples/agent-archetypes`) |

The public site uses **`/examples`** as the single source-backed catalogue. Daemon and single-binary builds publish the same examples under `/samples/manifest.json` and `/samples/files/...`, so tutorial code can be fetched from a binary install.

---

## 🛠️ Development & Testing

### Setup

```bash
git clone https://github.com/curiositech/port-daddy
npm install
npm run dev                    # daemon + website in dev mode
npm run build:daemon
npm run build:bin
```

### Quality gates

We maintain an extreme standard of reliability for the control plane:

- **Test suite:** 7,300+ test cases (Jest + `bun test` for compiled-binary regressions). Zero failures is the norm.
- **Version drift gate:** `package.json` is the sole version authority; `scripts/sync-version.ts` stamps it across every surface (including this README's title) and `scripts/check-version-drift.mjs` fails CI on drift — deep mode also reads versions embedded in built artifacts.
- **README freshness gate:** the pre-commit hook runs `scripts/check-readme-freshness.mjs` — staged changes to the CLI verb registry, MCP tool surface, OpenAPI contract, feature manifest, or fleet topology are blocked unless README.md is updated in the same commit (bypass with `PD_README_OK=1` when the change is genuinely internal). `tests/unit/feature-parity.test.js` additionally enforces that every `docs.readme=true` manifest feature stays mentioned here.
- **Compiled-CLI smoke:** CI hard-fails when the compiled CLI or daemon doesn't actually run.
- **Surface parity:** new CLI verbs must reach API/MCP parity (`npm run parity`).
- **Formal verification:** ProVerif protocol models + Kani proofs for Rust kernel invariants.
- **Benchmarking:** `pd bench` measures atomic commit latency.

### Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Every PR is filled out against [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) and held to the contract in [AGENTS.md](AGENTS.md): an exhaustive summary and a non-trivial test plan (enforced by the `pr-requirements-guard` CI job), screenshots + a GIF/recording for any visual change, surface parity for new CLI verbs, new tests for new code, and a `CHANGELOG.md` entry. A neutral adversarial reviewer runs on every PR and posts a `SHIP / SHIP-AFTER-FIX / DO-NOT-SHIP` verdict.

---

## 🗺 Documentation Map

- [`docs/DELEGATION-MODES.md`](docs/DELEGATION-MODES.md) — spawn vs agent vs sortie vs fleet, and what harbors are
- [`docs/adr/`](docs/adr/) — 90+ architecture decision records; start with 0019 (fleet YAML), 0035 (memory tiers), 0037 (backup), 0045 (attest), 0050 (Coast Guard), 0057 (unified distribution), 0060 (fleet conductor), 0062 (auto-freshness), 0084 (daemon berths), 0088 (host safety), 0093 (event-spawn trust)
- [`docs/patterns/coordination-cookbook.md`](docs/patterns/coordination-cookbook.md) — recipes for common swarm shapes
- [`docs/tutorials/`](docs/tutorials/) — hands-on tutorials (`pd-tube`, PKI relay)
- [`docs/operations/daemon-and-supervision.md`](docs/operations/daemon-and-supervision.md) — launchd, Bosun, supervision integrity
- [`docs/RELEASING.md`](docs/RELEASING.md) / [`docs/VERSIONING.md`](docs/VERSIONING.md) — the release contract
- [`docs/SECURITY_SOUNDNESS.md`](docs/SECURITY_SOUNDNESS.md) — what is and is not defended
- White papers at `/whitepaper` on [portdaddy.dev](https://portdaddy.dev): **The Anchor Protocol**, **The Bonded Commons**

---

## 🗺️ Roadmap

The living roadmap is `pd roadmap` (backed by the daemon) and [`docs/ROADMAP.md`](docs/ROADMAP.md). The V4 arc — the **Code of the Sea** for agents beyond one machine:

- **Trusted Computing Base broker** — separate-UID Rust broker as the enforcement spine (ADR-0087)
- **Database distribution & sync** — "The Harbor": one substrate across machines (ADR-0090)
- **Suggestibility ladder & cloud federation** — a structural dial for how much agents may influence each other, cross-machine (ADR-0092)
- **Event-spawn trust substrate** — a secure middle between external triggers (webhooks, email, calendar) and spawned agents (ADR-0093)
- **Float plans, agent OAuth, Noise-protocol tunnels** — pre-declared intent and encrypted P2P coordination between remote Port Daddy instances

---

## ⚖️ License

**FSL-1.1-MIT** (Functional Source License). Free for development and internal use. See [LICENSE](LICENSE).

Created by **[Erich Owens](https://github.com/erichowens)** at **[curiositech](https://curiositech.ai)**.

---

## ⚓ Support & Contact

- **Issues:** [GitHub Issue Tracker](https://github.com/curiositech/port-daddy/issues)
- **Help:** Run `pd help`, `pd learn`, or `pd tutorial` for the interactive tutorial.
- **Vibe:** Ambitious, CUTE and CHARMING. 🚩
