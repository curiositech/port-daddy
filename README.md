# ⚓ Port Daddy (v3.13.0)

<p align="center">
  <img src="website-v2/public/img/hero-portdaddy.png" alt="Port Daddy — the harbormaster for your AI agents" width="600">
</p>

<p align="center">
  <strong>Stop your agents from fighting each other.</strong><br />
  Atomic port assignment, session coordination, pub/sub messaging, and agent resurrection — one daemon, zero config.
</p>

<p align="center">
  <a href="https://npmjs.com/package/port-daddy"><img src="https://img.shields.io/npm/v/port-daddy.svg?logo=npm&color=3AADAD" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-FSL--1.1--MIT-blue?color=3AADAD" alt="license"></a>
  <a href="https://github.com/curiositech/port-daddy"><img src="https://img.shields.io/badge/tests-3,700%2B%20passing-brightgreen?logo=jest&color=3AADAD" alt="tests"></a>
  <a href="https://github.com/curiositech/port-daddy/tree/main/skills/port-daddy-agent-skill"><img src="https://img.shields.io/badge/AI%20Agents-40%2B%20compatible-blueviolet?logo=openai&color=3AADAD" alt="AI Agent Skill"></a>
  <a href="http://dashboard.pd.local:3144"><img src="https://img.shields.io/badge/Local--DNS-Active-success?logo=lighthouse&color=3AADAD" alt="Local DNS"></a>
</p>

---

## Overview

**Port Daddy** is a daemon that gives every AI agent its own port, coordinates file access, and recovers work when they crash. One install, zero config.

Examples in this README assume the default local daemon URL `http://localhost:9876`. If your daemon is running on a different port, use `pd status` or set `PORT_DADDY_URL` before copying the HTTP examples.

While individual agents are brilliant, **coordination** is the bottleneck. Port Daddy provides the missing primitives: atomic port assignment, pub/sub messaging, distributed locks, session trails, and agent resurrection.

```bash
# Start working (registers agent + claims port + starts session)
pd begin "Building the auth layer" --identity myapp:api --lifecycle durable

# Log progress, coordinate with other agents
pd note "JWT validation passing all tests"
pd pub api:ready '{"endpoints": ["/login", "/register"]}'

# Done (ends session + releases everything)
pd done "Auth complete"
```

### ⚓ Key Primitives
- **Atomic Port Assignment:** Zero race conditions. Semantic identities (e.g., `myapp:api`) map to stable, deterministic ports.
- **Swarm Radio (Pub/Sub):** Low-latency, SSE-backed messaging for inter-agent signaling using **Maritime Signal Flags**.
- **Agentic Control Plane:** A live 2D/3D dashboard (`*.pd.local`) to visualize active agents, service health, and message traffic.
- **Automatic Salvage:** Captures session state and notes from "zombie" agents that crash mid-task, allowing others to recover their work.
- **Local DNS Resolver:** Access your services at `http://api.pd.local` instead of magic port numbers.
- **Binary IPC:** High-frequency agent communication over Unix domain socket with MessagePack encoding, FIPA-grounded performatives, and 20 documented failure mode mitigations.

---

## 🧭 Table of Contents
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [CLI Permission Tiers](#-cli-permission-tiers)
- [Multi-Agent Coordination](#-multi-agent-coordination)
- [The Dashboard (HUD)](#-the-dashboard-hud)
- [Configuration](#-configuration)
- [Executable Examples](#-executable-examples)
- [Development & Testing](#-development--testing)
- [V4 Roadmap: The Wild West](#-v4-roadmap-the-wild-west)
- [License](#-license)

---

## 📦 Installation

### 1. Requirements
- **OS:** macOS (recommended) or Linux.
- **Runtime:** Node.js v20+ for the CLI and build tooling. The installed daemon runs from the distributed `dist/daemon/port-daddy-daemon` executable when that artifact is present.

### 2. Install CLI
```bash
# Via Homebrew (macOS)
brew install curiositech/tap/port-daddy

# Via npm
npm install -g port-daddy

# Optional signed Mac menu-bar app from the public site
curl -LO https://portdaddy.dev/downloads/PortDaddy-FleetBar-macOS-arm64.zip
curl -LO https://portdaddy.dev/downloads/PortDaddy-FleetBar-macOS-arm64.zip.sha256
shasum -a 256 -c PortDaddy-FleetBar-macOS-arm64.zip.sha256
unzip PortDaddy-FleetBar-macOS-arm64.zip
```

### 3. Verify
```bash
pd doctor          # Comprehensive health check (supervision, liveness, DB, drift, bosun…)
pd doctor --json   # Machine-readable report with per-check severity (ok | warn | critical)
pd doctor --ci     # CI/script mode: no prompts, exits non-zero ONLY on a CRITICAL check
pd start           # Start the daemon
pd bench 50        # Run performance benchmarks (Target: <1ms latency)
```

`pd doctor` grades every check on a three-tier severity model — `ok`, `warn`
(degraded but functional), `critical` (core function broken / daemon
unsupervised + down / registry corrupt). Only a **critical** gates the exit
code, so `--ci` is safe to wire into a build without warnings breaking it. The
same `severity` is reported by the daemon's `GET /health` and surfaced as an
alert state in the FleetBar menu bar and the Rust console health pane.

`pd start` and `pd install` are binary-first. They refuse to start a source-backed `tsx server.ts` daemon unless `PORT_DADDY_ALLOW_SOURCE_DAEMON=1` is set for a local development session. Release promotion builds the daemon executable, builds the public sample bundle, installs the binary service, and checks the macOS LaunchAgent did not regress to `tsx server.ts`.

Single-binary distribution is now an explicit build lane, not a vague future promise. `npm run build:bin` emits `dist/port-daddy` plus `dist/port-daddy-manifest.json`; that binary carries the CLI, the MCP stdio server, and a hidden `__daemon` entrypoint in-process instead of shelling through `tsx`. The build also embeds Fleet UI and the generated public samples into the executable through a generated asset table, then smoke-tests `dist/port-daddy __daemon` with an empty `PORT_DADDY_RESOURCE_DIR` by fetching `/health`, `/samples/manifest.json`, and `/fleet-ui/index.html`. The standalone daemon companion at `dist/daemon/port-daddy-daemon` remains available for daemon-only installs.

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

### 🚁 Swarm Coordination
- **pd begin / pd done**: Track **session_phases** (planning, in_progress, etc.).
- **pd demo**: Interactive multi-agent coordination **demo**.
- **pd fleet**: Declarative agent **fleet** from `pd-fleet.yml` — cron/trigger-based agents with pub/sub chaining.
- **pd guard**: Enforce agent coordination before commit — active session plus matching file claims for staged files.
- **pd add**: Claim-aware `git add` — refuses to stage files held by another session.
- **pd snapshots**: List/show/restore snapshots the daemon-side claim watcher captures when a claimed file's bytes change mid-claim.
- **pd backup / pd restore**: Durable, WAL-consistent snapshots of the whole `port-registry.db` (gzipped, sha256-verified, integrity-checked) with GFS retention. `pd backup` takes one now; `pd backup list/show/prune` inspect and trim; `pd backup schedule install` (or `pd backup --install-schedule`) registers a daily launchd agent; `pd restore <id>` rolls the DB back reversibly. See ADR-0037.
- **pd attest**: Honest self-report — runs the loud-fail invariant registry (daemon liveness, DB integrity/schema, crypto, brew-hash provenance, Cartographer up, …) and prints PASS/FAIL/SKIPPED/UNKNOWN per check. "All good" is conjunctive and scoped: green only when every checked critical+warn invariant passed, and the report always lists what it could NOT verify. Exits non-zero on any critical problem (CI/boot-gate friendly). See ADR-0045.
- **pd safe**: Host-safety posture audit (ADR-0088). `pd safe scan` (default, `--json` for the structured report) is a 100% read-only audit of what an agent running as you could reach right now — plaintext secrets at rest (structured key-format regex + entropy, never raw values; findings carry path/line/ruleId/last4 only), world/group-readable crown jewels, unsigned/un-notarized running binaries, unpinned `npx`/`uvx` MCP fetches, and live egress flows — folded into a 0–100 score and a green/amber/red Safe Room state. **green means "cooperative-case sensors clear," NOT sandboxed**; the report footer carries the verbatim Coast Guard honest-limits string. `pd safe baseline accept <id>` triages a finding into the committed `.pd-secrets-baseline.json`; `pd safe fix --auto` is the opt-in, reversible `chmod` of world-readable crown jewels only (recording the prior mode). The `safe_scan` MCP tool exposes the same read-only report to agents. **Corral (Phase B):** `pd safe corral <KEY>` (or `--all`) packs a detected plaintext secret off disk into the Keychain/broker vault and rewrites the source line to a `pd-secret://KEY` reference — DRY-RUN by default (prints the plan), `--apply` to write. Before any rewrite it verifies the resolver round-trips the exact value and keeps a `.bak` under `~/.port-daddy/recovered`, so no plaintext is lost. Resolve corralled refs at run time with `pd env exec -- <cmd>` (the value is injected into the child process env only, never back to disk). `pd safe guard --staged` reuses the scanner against `git diff --staged` (also wired into the pre-commit hook) to stop NEW secrets at the commit/push boundary. **Honest limit:** corralling reduces blast radius (no plaintext at rest, scoped + logged access) — it is not confidentiality against a malicious same-UID agent whose binary satisfies the Keychain ACL (that needs the separate-UID broker, ADR-0087 phase 5).
- **pd status / pd version**: View system **info** and metrics.

### Session Lifecycle
Every work session progress through defined **Phases** for clear swarm visibility:
- `planning`: Scoping the task.
- `in_progress`: Active development.
- `testing`: Verification in progress.
- `reviewing`: Awaiting human or agent approval.
- `completed` / `abandoned`: Final state reached.

---

## 🏥 Diagnostics & Status

### System Health
Monitor the heartbeat of your control plane:
```bash
pd status   # Authoritative daemon truth: runtime state, build hash, fleet counts, guardian status
pd version  # Version, code hash, install dir, PID
curl http://127.0.0.1:9876/status   # Full daemon report including recent activity and spend
```

`launchctl` is the canonical supervisor on macOS. Bosun is the optional non-agent watchdog; the daemon now writes a filesystem heartbeat for it, and the old Barnacle sidecar remains only as a deprecated compatibility implementation name during the V4 rollout.

---

## 🔐 CLI Permission Tiers

Every `pd` command is classified by how much shared state it touches. The tier is rendered in `pd help` next to each verb, and destructive commands prompt for confirmation before doing anything irreversible. The authoritative registry lives in [`cli/permission-tiers.ts`](cli/permission-tiers.ts).

| Tier | What it means | Examples |
|---|---|---|
| `silent` | Read-only. Safe to run anywhere. | `pd status`, `pd whoami`, `pd notes`, `pd briefing`, `pd salvage` (list form), `pd sessions`, `pd actors`, `pd find` |
| `notify` | Mutates your own state. Reversible. | `pd note`, `pd begin`, `pd done`, `pd claim`, `pd lock`, `pd session start`, `pd session takeover`, `pd takeover`, `pd session files add`, `pd agent register` |
| `approval` | Affects other agents. No data loss. | `pd pub`, `pd spawn`, `pd up`, `pd agent inbox send`, `pd harbor create/enter` |
| `destructive` | Releases someone else's resources or removes records. Prompts. | (see list below) |

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
- `pd fleet down` — SIGTERMs the running fleet
- `pd fleet panic --reason "<text>"` — SIGTERMs every running fleet agent (also requires typing `YES`)
- `pd fleet halt [--root <id>]` — Conductor total stop: SIGKILLs a scope and refunds (never slashes) its bonds (ADR-0060)
- `pd fleet pause [--root <id>]` / `pd fleet resume [--root <id>]` — soft stop / reopen admission for a Conductor scope
- `pd fleet inspect <rootId>` / `pd fleet tree <rootId>` — render a Conductor lineage tree
- `pd guard install` — writes git hooks; merges existing ones
- `pd guard install-shim` / `uninstall-shim` — alters how `git` behaves system-wide
- `pd guard enable` / `disable` — changes enforcement mode for the whole worktree
- `pd dev stop` — SIGTERMs the isolated dev daemon
- `pd daemon stop` / `restart` / `uninstall` (and top-level `pd stop` / `restart` / `uninstall`)
- `pd down` — SIGTERMs the orchestrator and stops every service it manages

### Audit trail

Confirmation decisions are emitted to stderr in a parseable form:

```
destructive: Salvage claim will transfer agent-99's session, file claims, and notes to you. The previous owner loses control of that work.
destructive: confirmation bypassed via --yes / PORT_DADDY_YES
```

This applies whether you confirmed interactively, used `--yes`, or were refused in non-interactive mode. Pipe stderr into your shell logs (or a `pd note`) for a clean trail.

---

## 📡 Multi-Agent Coordination

Port Daddy is built for the "Wild West" of agentic workflows where agents hail each other ad-hoc.

### Swarm Radio (Pub/Sub)
Agents speak to each other over named channels using maritime signals:
```bash
# Declare a canonical channel for this repo/worktree first
pd channels ensure swarm:general --scope branch --aliases general:swarm

# Discover what already exists in the current worktree
pd channels discover swarm

# Subscribe using the logical name — the CLI resolves it to the current worktree's physical channel
pd sub swarm:general

# Publish a "Mayday" signal from another terminal
pd pub swarm:general \
  "Auth service is flatlining" \
  --signal mayday \
  --sender "NAVIGATOR"
```

Declared channels are git-sensitive by default. A branch-scoped channel resolves differently across worktrees/feature branches, which stops unrelated branches from accidentally sharing the same coordination bus. `pd pub`, `pd sub`, `pd watch`, and `pd channels clear` all auto-resolve declared logical names against the current worktree. Use `--raw-channel` only when you intentionally want the literal channel string without resolution.

### `pd tube` — Conversational Pipe (with History Guard)

For one-line conversations between two agents (or between scripts and agents), `pd tube` adds a thin envelope and a per-channel cursor so listeners don't re-emit messages they already processed:

```bash
# Listen — block until one event arrives, print the prose crank-handle, then exit
pd tube agent:notes

# One-shot drain (resume from where you left off, then exit)
pd tube agent:notes --once --json | jq -r '.body'

# Send (stdin to EOF)
echo "shipped the fix in commit abc123" | pd tube agent:notes --send

# Reply to a specific message (threading via inReplyTo)
echo "looks good — merging" | pd tube agent:notes --reply-to=42
```

History guard lives at `~/.port-daddy/tube-history-<safe-channel>.json` (atomic via tmp+rename); `--no-history` ignores it; `--since=<id>` overrides it. Use `--json` for JSON lines, `--raw` for tab-separated output, and `--tail` for the old human-watching loop. Composes with `pd pub` / `pd sub` for cases where you want raw fan-out without the envelope. Hands-on tutorial: [`docs/tutorials/pd-tube.md`](docs/tutorials/pd-tube.md).

### Integration & Signaling
Automate agent handoffs using `pd integration` and `pd wait`:
```bash
pd integration ready myapp:api  # Signal that API is ready
pd wait myapp:api               # Block until service becomes healthy
```

### Observation & History
Keep track of swarm state with `pd briefing`, `pd changelog`, and `pd activity`:
```bash
pd briefing    # Get a project-level context summary
pd changelog   # View the hierarchical history of changes
pd activity    # Stream the raw audit trail of all operations
```

### Say / Look (3.8.4) — The Consolidated Verbs
When you return to work after a break, or when you want to tell every other
session about a finding, reach for these two verbs instead of stitching
together `pd note`/`pd tuple`/`pd pheromone`/`pd pub` by hand:

```bash
# Say — one text, many fan-outs. Defaults to a session note.
pd say "fixed flash of unstyled content on hydrate in Hero.tsx" \
       --pin --heat website-v2/src/components/landing/Hero.tsx=0.7
#   ^note              ^tuple (cross-session)   ^pheromone heat on the file

# Also publish on a pub/sub channel:
pd say "build broken on main, rolling back" --broadcast alerts

# Look — situation report. What happened while I was away?
pd look --since 30                 # last 30m synthesis
pd look --heat                     # file heat map (pheromone contention)
pd sitrep                          # explicit maritime-voice alias

# Compass — what coordination primitive should I use before editing?
pd advise lib/sessions.ts --task "fix symbol claim conflict"
pd preflight docs/recovery/CURRENT-WORK.md --tuples

# Actors — durable maritime roles plus live body/session/salvage signals
pd actors --project port-daddy
pd actor cartographer
pd actor navigator --message "roadmap item needs evidence"
pd actor navigator --inbox-stats
```

`pd say` flags compose — `--pin --heat path=0.8 --broadcast alerts` is four
HTTP calls in parallel from a single command. `pd look` returns a four-way
synthesis (activity + notes + salvage queue + spawned agents) with a
one-line `summary` suitable for shell prompts. `pd advise` / `pd preflight`
returns deterministic recommendations with evidence and executable actions:
session/context integrity, active claims, symbol freshness, stale salvage,
declared channels, tuple-worthy facts, and true lock candidates.
`pd actors` shows durable actor souls such as Coxswain, Gardener, QA/Signalman,
Test Hunter, Documentarian/Lookout, Simplifier, Cartographer/Navigator, Spark,
and Spider; `pd actor navigator` resolves to Cartographer for compatibility.
`pd actor <id> --message` queues to the durable actor mailbox without granting a
dormant actor live mutation authority; `--inbox` and `--inbox-stats` expose
queued mailbox state separately from live-body wake status.

### Webhooks & Life Cycles
- **Webhooks:** `pd webhooks` subscribe external systems to swarm events.
- **Phases:** Track work via `planning`, `testing`, and `reviewing` session phases.

### Spawn AI Agents
Launch AI agents with full PD coordination (registration, sessions, heartbeats) baked in:
```bash
# Current operator-facing launchable path: Claude SDK with an exact-rate model
pd spawn \
  --backend claude \
  --model claude-haiku-4-5-20251001 \
  --budget 0.50 \
  --identity myapp:fixer \
  -- "Summarize the latest auth diff"

# Another exact-telemetry Claude run
pd spawn \
  --backend claude \
  --model claude-haiku-4-5-20251001 \
  --budget 0.35 \
  --identity myapp:docs \
  -- "Explain what this function does"

# Spawn runs use preflight internally before launch
pd spawn \
  --backend claude \
  --model claude-haiku-4-5-20251001 \
  --budget 0.35 \
  --identity myapp:explain \
  -- "Explain what changed in the auth flow"

# List running/completed agents
pd spawned

# Kill a running agent
pd spawn kill <agent-id>

# Watch a logical channel and auto-trigger a command
pd watch git:committed --exec 'npm test'
```

#### 🛡️ The Coast Guard (ADR-0050) — confinement is the default

Every agent spawned through a subprocess backend (`codex`, `claude-cli`,
`aider`, `custom`, `cli:*`) runs under the **Coast Guard by default** — no flag
needed:

1. **Confine** — an OS sandbox (macOS Seatbelt; Linux Landlock/bubblewrap)
   **denies** reads to the crown jewels (`~/.ssh`, `~/.aws`, `~/.gnupg`,
   cloud creds, and every `.env` / `.env.local` in `$HOME` and the workdir)
   while allowing normal work. `cat ~/.ssh/id_ed25519` → *Operation not permitted*.
2. **Broker** — the agent's environment carries **no raw API key**. Every
   managed provider key *and* every key loaded from your `.env`/`.env.local`
   (Stripe, database URLs, GitHub tokens — the whole file) is scrubbed from the
   child env; the keys stay in the daemon's sealed cache. `cat .env.local` and
   an env dump both yield nothing usable.
3. **Cap** — outbound API traffic is forced through a local meter with a **hard
   per-agent request/byte cap**; the over-cap call is refused (`402 Spend Cap
   Exceeded`). A runaway agent cannot bankrupt you.

Each run emits a signed-style **receipt** (`SpawnResult.coastGuard`) recording
what was confined, which keys were scrubbed, and the metered egress.

**Coordination keeps working.** Confinement only denies secret-file *reads* — not
network or process exec. The agent still reaches the Port Daddy daemon
(`127.0.0.1:9876`), runs the `pd` CLI (sessions, notes, claims, tube, inbox),
and talks to MCP servers: stdio MCP runs as a child process untouched by the
proxy, and loopback HTTP is exempted via `NO_PROXY` so local MCP/PD traffic
never burns the external-spend cap. The cap meters **outbound provider spend**,
not your coordination bus.

**Honest scope (in code + receipt):** this defends the **cooperative case** —
runaway spend, leaked-key blast radius, confused deputy, accidental
exfiltration. It does **not** defend a truly-malicious same-UID agent (it can
`unset HTTPS_PROXY` or read the daemon's memory); that needs a separate UID / VM
+ forced egress (ADR-0050 phase 4). See `tools/coast-guard/README.md` and run
the live demo: `npx tsx tools/coast-guard/demo.ts`.

Operator-facing launches are fail-closed on telemetry. Port Daddy rejects a launch unless it can attach exact token counts, an exact nonzero rate, and a persisted exact nonzero cost record to the completed run.

Today that means the live launchable path is the Claude SDK backend with an exact-rate model entry. Other backend integrations still exist in source, but they should be treated as blocked until they reach the same telemetry standard.

Internal code paths use the same rule: `createSpawner()` defaults telemetry enforcement on, and any explicit `enforceTelemetryPolicy: false` bypass now requires HITL confirmation metadata instead of relying on an omitted flag.

**Backends in source:** `ollama`, `claude`, `claude-cli`, `gemini`, `cloudflare`, `codex`, `aider`, `custom`

**Key flags:** `--backend`, `--model`, `--tier`, `--identity`, `--purpose`, `--budget`, `--allowedTools` (claude-cli), `--maxTokens`, `--workdir`, `--timeout`

Quiet mode (`-q`) prints raw output to stdout and exits non-zero on failure — perfect for shell scripts:
```bash
local result=$(pd spawn --backend claude --model claude-haiku-4-5-20251001 --budget 0.25 -q -- "Write a commit message for: $diff")
```

### Delegation Modes

Use the right surface for the job:

- `pd spawn` — the delegation primitive. Explicit backend, identity, budget, and task.
- `pd fleet` — always-on project automation from `pd-fleet.yml`.

Canonical operator explanation: [docs/DELEGATION-MODES.md](docs/DELEGATION-MODES.md)

For Port Daddy itself, the release boundary is the signed-binary cut. Tagging `v<version>` and publishing a GitHub Release triggers the `release.yml` workflow, which rebuilds the daemon, CLI, and MCP server as signed/notarized binaries (per [ADR-0028](docs/adr/0028-signed-binary-distribution.md)). The brew tap (`curiositech/homebrew-tap`) is then bumped via the manual `publish.yml` workflow. Documentarian/Lookout reviews README, docs, website docs/tutorials, Mac app/FleetBar install and product copy, SDK/CLI references, OpenAPI/MCP surfaces, and the distributed agent skill around the same tag, since those surfaces become live operator truth at the moment users run `brew upgrade port-daddy`.

Each Release also publishes a `latest.json` update feed (version + per-artifact download URL + SHA-256 + signed flag; schema in [ADR-0057](docs/adr/0057-unified-distribution.md) phase 7). Run `pd upgrade` to check the feed against your installed version and see the verified daemon asset; `pd upgrade --apply` runs `brew upgrade port-daddy` for a Homebrew install (privileged self-replace is deferred to brew by design). This is the interactive sibling of the unattended hourly `pd self-update` freshness LaunchAgent ([ADR-0062](docs/adr/0062-auto-freshness-self-heal.md)).

```bash
# Preferred delegation
pd spawn \
  --backend claude \
  --model claude-haiku-4-5-20251001 \
  --budget 0.35 \
  --identity myapp:review \
  -- "Review the last commit for regressions"
```

Current truthful limitation: delegation uses the spawn primitive. Richer approvals, artifact/result pages, and human-in-the-loop controls should layer on top of spawn rather than introducing another launch verb.

### OpenAPI Specification
Full API spec at `docs/openapi.yaml` (OpenAPI 3.1, 96 paths, 125 operations):
```bash
cat docs/openapi.yaml    # Machine-readable API contract
```

### Agent Inboxes (SSE Watch)
Every agent (or human) can stream their personal inbox live:
```bash
# Stream your inbox in real-time
pd inbox watch --agent CAPTAIN

# Send a DM to the captain
pd inbox send CAPTAIN "Course corrected. Heading 270." --sender "PILOT"
```

### Agent Identity & Auto-Salvage
Register with a semantic identity so Port Daddy can track your project context:
```bash
# Register with identity — enables context-aware salvage
pd agent register --agent build-42 --identity myapp:api --purpose "Building auth module"

# If another agent in myapp:* died, you'll see:
#   ⚠  2 dead agent(s) in myapp:*. Run: pd salvage --project myapp

# View dead agents scoped to your project
pd salvage --project myapp

# Pick up a dead agent's work
pd salvage claim dead-agent-99
```

When an agent dies (crashes, loses connection, context exceeded), its sessions and notes are preserved. New agents in the same project are automatically notified at registration.

Use `pd session takeover <old-session-id> [reason]` (or the shorter `pd takeover <old-session-id> [reason]`) when continuing a stale or predecessor session. It creates a successor session, records the lineage in append-only notes, releases stale predecessor claims, and reclaims those files for the successor when there is no live conflict. `pd session rm <id>` is now archival: it releases active claims and writes a tombstone note, but it does not delete the session, notes, or claim history.

### Distributed Locks
Prevent agents from "stepping on" each other's files or DB migrations:
```bash
pd with-lock db-migrations -- npm run migrate
```

### The Arbiter (Runtime Invariant Enforcement)
The Arbiter monitors every state transition against 6 formally-derived invariants:
```bash
# Check arbiter status
curl http://localhost:9876/arbiter/status

# Inject a test violation (for demos)
curl -X POST http://localhost:9876/arbiter/test-invariant/NOTE_MONOTONICITY
```
Rules: PID squatting, capability escalation, note monotonicity, escrow positivity, lock owner validity, heartbeat freshness. In strict mode, critical violations trigger man-overboard salvage.

### Pheromone Trails (Ambient Signals)
Agents spray numeric signals (0-1) onto entities. Signals decay over time at read, creating ambient awareness:
```bash
# Spray a signal onto a service
pd pheromone spray --table services --id myapp:api --key urgency --strength 0.8

# Sniff pheromone values (applies read-time decay)
pd pheromone sniff --table services --id myapp:api

# View file heat map (which files are most contested)
curl http://localhost:9876/pheromone/files

# List all non-zero pheromone trails
pd pheromone list
```

Use cases: adaptive Arbiter thresholds, file contention detection, agent reputation scoring, hot-path identification.

### Tuple Space (Shared Swarm Memory)
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
```

Pattern matching: exact values, `*` wildcard, `>N`/`<N` numeric comparisons, `myapp:*` semantic identity prefixes.

### Semantic Graph And Episodic Memory
Port Daddy now exposes two operator inspection surfaces over the newer coordination substrate:

- `pd graph` for durable relationship edges emitted by symbol indexing and merge orchestration
- `pd memory` for promoted handoffs, findings, blockers, and spawn outcomes

```bash
# Inspect graph relationships for one indexed file
pd graph edges --scope symbols:file:/Users/you/coding/port-daddy/server.ts

# Summarize graph density for a project
pd graph stats --dir /Users/you/coding/port-daddy

# Review promoted handoffs/findings
pd memory episodes --project port-daddy --type handoff

# Summarize episodic memory coverage
pd memory stats --dir /Users/you/coding/port-daddy
```

These are read surfaces for now. The point is operator truth: if graph/memory is part of the product, it must be inspectable from the CLI and not only via raw daemon routes.

#### Memory Tier Vocabulary (Core / Recall / Archival)

Port Daddy's storage is a three-tier hierarchy borrowed from the Letta-style
agent-architecture literature. `pd memory tiers` prints the current mapping
with live counts; `pd memory tier <construct>` answers "where does this
specific construct live?"; `pd memory summary` rolls up totals per tier.

```bash
pd memory tiers                       # full table + counts
pd memory tier active-file-claims     # → Core
pd memory tier archived-notes         # → Archival
pd memory summary --json              # programmable per-tier totals
```

The mapping and the reasoning behind it are documented in
[ADR-0035](docs/adr/0035-three-tier-memory-vocabulary.md). The substrate is
unchanged; this is a vocabulary overlay over the same SQLite tables.

### Semantic Trie (O(k) Identity Lookups)
Port Daddy indexes all identities (services, agents, sessions, harbors) in an in-memory Adaptive Radix Tree. Lookups are O(k) where k is key length — replacing SQL `LIKE` scans that degrade as the registry grows.

```bash
# These all resolve through the trie, not SQL:
pd find 'myapp:*'              # Prefix search — all services under myapp
pd find 'myapp:*:main'         # Wildcard — all stacks with context "main"
pd find 'myapp:api:main'       # Exact lookup
```

The trie populates from SQLite on daemon startup and stays in sync on every register/claim/release. Harbor bitmask filtering enables O(1) scope checks for harbor membership.

### Fleet Engine (Declarative Agent Orchestration)
Declare your background agent fleet in a `pd-fleet.yml` file — like docker-compose for AI agent swarms. **As of v3.8.3, the Port Daddy daemon auto-discovers and starts your fleet on boot** — no terminal to keep open.

```yaml
# pd-fleet.yml
fleet:
  name: my-project-dev
  harbor: "{project}:fleet"

  limits:
    max_concurrent_spawns: 2        # At most 2 agents running in parallel
    max_spawns_per_hour: 20         # Rate cap (Ostrom Principle 2)
    budget_usd_per_day: 5           # Daily LLM spend ceiling in USD

  agents:
    qa:
      trigger: git:committed          # React to pub/sub events
      backend: claude
      model: claude-haiku-4-5-20251001
      prompt: |
        Review the most recent commit. Find bugs. Write tests.

    test-hunter:
      trigger: git:committed
      backend: claude
      model: claude-haiku-4-5-20251001
      prompt: |
        Run the test suite. Fill the highest-signal coverage gaps.

    gardener:
      schedule: "*/10 * * * *"        # Or run on a cron schedule
      run_on_start: false             # Set true only when boot-time work is intentional
      backend: claude
      model: claude-haiku-4-5-20251001
      prompt: "Summarize the current repo status and suggest the next maintenance action."
      on_success: publish git:status  # Chain agents via channels

  channels:
    git:committed:
      description: "Fired after a successful commit"
      consumers: [qa]
```

**Two fleet modes:**
- **CLI mode** (`pd fleet up`): Manual, runs while your terminal session is open.
- **Daemon mode** (automatic): The Port Daddy daemon scans known Port Daddy repos on boot and starts any discovered `pd-fleet.yml` fleets automatically. Known repos come from durable repo markers such as `pd-fleet.yml`, `.portdaddyrc`, or `.portdaddy/`, plus live runtime state. Survives terminal close, system sleep, and daemon restarts (via launchd `KeepAlive`). Editing `pd-fleet.yml` triggers a hot-reload automatically.

**Adding a new ship.** Append an entry under `fleet.agents:` in
`pd-fleet.yml`, give it an identity (`{project}:fleet:<name>`), a trigger
(`schedule:` cron or `trigger: <channel>`), a backend (`backend: cloudflare`
or `backend: claude-cli` etc.), and a prompt. Run `pd fleet validate` to check
the topology, then hot-reload or `pd fleet up`. See ADR-0019
(`docs/adr/0019-declarative-fleet-yaml.md`) for the canonical schema and
ADR-0026 (`docs/adr/0026-fleet-ast-and-diagnostics.md`) for the typed AST.
Scheduled ships arm their timer on fleet start; by default `run_on_start` is
`false`, so they do not fire during daemon boot. Set `run_on_start: true` only
for ships whose first pass is intentionally part of startup. Keep boot-time work
opt-in so a daemon restart cannot fan out an entire fleet before `/health` is
stable.

**Port Daddy's own fleet.** This repo ships a `pd-fleet.yml` that dogfoods
the engine — `gardener`, `qa`, `test-hunter`, `documentarian`, and
`cartographer` are armed by default; `simplifier`, `spark`, and `spider` are
paused pending more soak time. See `docs/fleet/restart-2026-05-20.md` for the
restart rationale + kill switch, and `docs/fleet/known-issues.md` for the
current rough edges (CWD-anchored CLI state, no subset flag on `pd fleet up`).

```bash
# CLI mode
pd fleet init     # Create pd-fleet.yml + git post-commit hook (first-time setup)
pd fleet up       # Start all agents (foreground, terminal-attached)
pd fleet validate # Parse YAML, resolve templates, and dry-run topology checks
pd fleet status   # View running agents
pd fleet down     # Stop all agents

# Daemon mode (always-on)
curl http://localhost:9876/fleet              # Global fleet status
curl -X POST http://localhost:9876/fleet/reload   # Reload all configs (same as SIGHUP)
curl http://localhost:9876/fleet/events       # SSE stream of lifecycle events

# Fleet config management
curl http://localhost:9876/fleet/config/myapp           # Read YAML + topology validation
curl -X PUT http://localhost:9876/fleet/config/myapp \
  -H 'Content-Type: application/json' \
  -d '{"yaml": "fleet:\n  name: myapp\n  agents: ..."}' # Write + validate + reload

# Shell prompt integration
curl 'http://localhost:9876/fleet/prompt?project=myapp'  # One-line status for PS1

# Available backends & models
curl http://localhost:9876/fleet/models       # Lists ollama, codex, claude-cli, gemini, cloudflare, aider, etc.
```

Each agent gets full PD coordination for free: registration, sessions, heartbeats, and salvage on crash. Fleet YAML can still describe the broader source backend catalog, but the daemon applies the same fail-closed telemetry policy as manual launches. In practice, treat Claude SDK + exact-rate model entries as the currently runnable operator-facing path until the other backends reach telemetry parity. Template variables (`{project}`) resolve from the YAML context. Fleet lifecycle events publish to the `fleet:events` channel for dashboard and menu bar subscriptions.

Fleet commands invoke the installed Port Daddy runtime, so a `pd-fleet.yml` can live in any project repo. It no longer assumes the target repo has Port Daddy source files, `bin/port-daddy-cli.ts`, or a local `tsx` toolchain. Array-style YAML agents also get readable derived names from `name`, `identity`, `prompt`, or backend instead of falling back to `agent-1`.

Agent creation stores a readable display name beside the technical id. `pd begin`, `pd agent`, `/sugar/begin`, `/spawn`, and fleet-triggered spawns can show names like `Auth Repair Lead` or `Run qa` while preserving machine-stable ids such as `agent-2b632b24` for claims, heartbeats, inboxes, and logs.

Fleet status now reflects mailbox semantics: repeated trigger bursts collapse into queued work instead of spawning a fresh agent for every wake. When that happens, agent rows can show `status: queued` and a non-zero `queueDepth` so operators can see pending work instead of mistaking it for a miss.

The daemon-served control plane now has an explicit `Agents` surface alongside the fleet graph. It is the operator view for all agents in a project slice: configured fleet agents, live registry entries, spawned runs, salvage ghosts, inbox traffic, recent sessions/notes, known pub/sub bindings, and active file claims. The `visual_tasks` feature is served by `POST /visual-tasks`: FleetBar can still send an annotated screenshot or control-plane DOM region, and the `apps/pd-scout-extension` Chrome extension captures arbitrary web apps with active-tab screenshots plus optional DOM selectors/XPath/source hints. The daemon persists the screenshot as a blob, publishes `visual-feedback`, routes to a local agent or cloud-fleet target, and opens a reviewable work item from the same evidence.

### Bonds & Budget Guard

Port Daddy escrows virtual USD before each agent spawn and can SIGTERM live spawns that breach their daily budget. Spend is observable (cost-tracker); enforcement is separate (bonds). You top up a project wallet; every spawn debits a small bond; clean exits refund it; misbehavior slashes it. `pd fleet panic` arms a two-step global kill-switch that **refunds** (not slashes) every running bond — operator action is not agent misbehavior.

**Fleet Conductor cost gates (ADR-0060).** The daemon routes every spawn and reactive-orchestrator launch through one `conductor.launch` chokepoint that reserves against a global ceiling and a per-subtree lineage ceiling *before* admission. These are armed at daemon startup and env-overridable:

| Env var | Default | Effect |
|---|---|---|
| `PD_FLEET_GLOBAL_CEILING_USD` | `25` | Total aggregate fleet spend cap (`off`/`0` = unbounded, logged loudly) |
| `PD_FLEET_LINEAGE_CEILING_USD` | `5` | Per-subtree (per-root) spend cap stamped on launches without their own |
| `PD_FLEET_DEFAULT_BOND_USD` | `0.01` | Reservation floor so the breaker accrues even when a launch omits a bond |
| `PD_FLEET_MAX_DEPTH` | `3` | Max recursion depth (agents launching agents) |

Operate the live fleet with `pd fleet halt|pause|resume|inspect|tree` (see Destructive Operations above). `halt` is total (SIGKILL + refund); `pause` is soft (stop admitting, leave agents running).

**What the wallet actually is.** The wallet is a *governance accounting unit*, not money. No payments move; no refunds reach a bank. The "USD" numbers are accounting units denominated against `cost-tracker`'s estimated LLM spend. When the backend is `claude` (SDK → real API), `codex`, `gemini`, or `cloudflare`, those dollars map to real per-token billing. When the backend is `claude-cli` (your Claude Code subscription) or `ollama` (local), per-token marginal cost is ~$0 and bonds become a coordination signal — a quota, a kill-switch, a priority ordering, and an audit trail. Useful, but don't pretend it's money.

**Giant Squid Claude-to-Codex bridge.** If you want Claude-shaped local orchestration while spending against the OpenAI Codex CLI auth already on the machine, run `pd squid codex` or `pd squid bridge`. It serves a small Anthropic Messages-compatible endpoint on localhost, generates a fresh local token unless you set one explicitly, injects `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and `ANTHROPIC_API_KEY` into a launched Claude-compatible client, and forwards each request to `codex exec`. This is an unofficial compatibility layer, not an official Claude Code auth mode.

```bash
pd squid codex -- claude --model claude-sonnet-4-5
pd squid pro --codex-effort high -- claude --model claude-sonnet-4-5
pd squid bridge --codex-model-alias claude-sonnet-4-5=gpt-5.1-codex --codex-effort high -- claude --model claude-sonnet-4-5
pd squid serve --port 8765  # bridge only; prints the generated token for curl/debugging
```

There are two model layers. `--codex-model`, `--codex-effort`, and repeated `--codex-config key=value` control the actual Codex CLI backend. `--codex-model-alias <client=codex>` (or comma-separated `PD_SQUID_MODEL_ALIASES`) lets a Claude client keep asking for `claude-sonnet-4-5` while the bridge runs `codex exec --model gpt-5.1-codex`. If no explicit backend model is set, a request model prefixed with `codex:` is also passed through after stripping the prefix.

The harness lanes are broader than Codex. `pd spawn --backend codex --budget 0.50 --tier strong -- "inspect the queue"` is the launch shape: preflight, budget ceiling, and model-tier sugar together. `pd spawn --backend ollama` keeps work local when an Ollama model is already running; `pd spawn --backend cloudflare --model @cf/qwen/qwen3-30b-a3b-fp8` uses Workers AI when you want cheap remote inference; `pd squid codex` is the Claude-shaped compatibility lane for ChatGPT Pro/Codex CLI. The same notes, claims, budgets, hooks, MCP tools, shared skill, and Port Daddy Pilot definitions wrap each lane. The local Squid PreToolUse hook also honors the ADR-0092 `suggestibility` dial (`advisory | warn | enforce`) before file-mutating tools cut into a foreign-locked path.

Thinking and tools are translated honestly. Anthropic `thinking.budget_tokens` maps to Codex `model_reasoning_effort` (`low`, `medium`, or `high`) unless `--codex-effort` or `--codex-config model_reasoning_effort=...` overrides it. Claude `thinking` and `redacted_thinking` transcript blocks are omitted before prompting Codex so a resumed Claude session does not replay private reasoning into a different backend. Codex JSONL `function_call`/tool-call items become Anthropic `tool_use` blocks so Claude-style tool loops can continue; completed Codex `command_execution` records stay internal provenance and are not replayed as user tools.

The bridge exposes `GET /health`, `POST /v1/messages`, and `POST /v1/messages/count_tokens`. Responses include a `port_daddy` provenance object with the bridge name, backend, request id, optional session id, optional session turn, backend model, and alias used. Session tracking is metadata-only: it counts turns for `session_id`, `conversation_id`, matching metadata fields, or session headers, but it does not store message text. Request bodies are capped by `--max-request-bytes` / `PD_SQUID_MAX_REQUEST_BYTES` (default 8 MiB) before JSON parsing.

Security posture: the bridge binds to loopback by default, generates a fresh
per-run local token by default, rejects non-loopback binds unless a strong token
was set explicitly, compares tokens with a timing-safe check, validates model
aliases from flags/env, and forwards only validated Codex `-c key=value`
overrides. It is meant for local compatibility and dogfooding; do not expose it
as a shared remote service without a stronger auth and sandbox story.

**Spawning requires a daily budget.** Every project must set `usd_per_day` before its first spawn; the daemon refuses unbonded agents. Run `pd wallet budget <project> --usd-per-day 5` during project setup. The no-budget-no-spawn rule is an Ostrom-style monitoring invariant: no agent can run without a number to enforce against.

**Budget breach is pause-and-ask, not cliff SIGTERM.** The manifest feature is `budget_guard`: when a spawn crosses 100% of its project's daily budget, Port Daddy posts a *pending kill* with a 60-second grace window and broadcasts on `budget:pending`. During grace, the operator has three options: `raise` (credit the wallet + optionally bump the budget, agent keeps running), `kill` (skip the wait, fire SIGTERM now), or `grace` (extend the window — up to 2 extensions). If nothing happens, the backstop SIGTERM fires at expiry. List pending kills with `pd wallet pending`; resolve one with `pd wallet raise --agent <id> --usd 5`.

```bash
# Top up and inspect
curl -X POST http://localhost:9876/wallets/myapp/top-up \
  -H 'Content-Type: application/json' -d '{"usd": 20}'
curl 'http://localhost:9876/bonds?project=myapp&state=running'

# Manually slash a misbehaving agent's bond (audited)
curl -X POST http://localhost:9876/bonds/42/slash \
  -H 'Content-Type: application/json' \
  -d '{"portion": 0.5, "reason": "leaked secrets to stdout"}'

# Two-step panic
curl -X POST http://localhost:9876/fleet/panic \
  -H 'Content-Type: application/json' -d '{"reason": "runaway loop"}'
curl -X POST http://localhost:9876/fleet/panic \
  -H 'Content-Type: application/json' \
  -d '{"reason": "runaway loop", "confirm": true}'
curl -X POST http://localhost:9876/fleet/unpanic \
  -H 'Content-Type: application/json' -d '{"reason": "root cause fixed"}'
```

Or via CLI: `pd wallet top-up myapp --usd 20`, `pd bond list --project myapp`, `pd fleet panic --reason "runaway"`.

### Observability & Cost Tracking

Port Daddy tracks operational metrics and LLM spend across your fleet. Three subsystems work together:

**Counters** — ODS-style bump counters with time-bucketed storage. The daemon auto-increments counters for spawn lifecycle events (`spawn.started`, `spawn.failed`, `spawn.completed`, `spawn.duration_ms`), session events, and more. Batched in memory, flushed to SQLite every 10s. Auto-prunes rows older than 30 days.

**Cost Tracker** — Records per-spawn LLM cost. Operator-facing launches are accepted only when Port Daddy can persist exact token counts plus an exact nonzero rate-derived cost record. Historical `/metrics/cost` buckets may still include legacy estimated sessions from older runs, but new daemon-managed launches are supposed to fail closed instead of adding fresh opaque estimates. Budget checks remain project-scoped.

**Golden Signals** — RED method metrics for the spawn system in a single endpoint: rate/min, error%, avg duration, cost/hr burn rate.

```bash
# Golden signals — one-stop health check for your fleet
curl http://localhost:9876/metrics/golden
# → { ratePerMin: 1.2, errorPct: 5.0, avgDurationMs: 4200, costPerHour: 0.23 }

# Cost summary by project (last 24h)
curl http://localhost:9876/metrics/cost
# → { totals: { totalUsd: 2.15, spawns: 43 }, byProject: [...], byBackend: [...] }

# Budget check — explicit ceiling required on every query
curl "http://localhost:9876/metrics/cost/budget/myapp?budgetUsdPerDay=10"

# Counter time series — spawn rate by minute
curl "http://localhost:9876/metrics/counters?key=spawn.started&groupBy=minute"

# Top backends by spawn count
curl "http://localhost:9876/metrics/counters/top?key=spawn.started&dim=backend&n=5"

# Recent cost events (live feed)
curl http://localhost:9876/metrics/cost/recent?limit=20
```

### Note Encryption (Escrow Secrecy)
Session notes are encrypted at rest with AES-256-GCM. Master key stored at `~/.port-daddy/master.key` (auto-generated on first boot). Per-session keys wrapped with the master key. Backward-compatible — existing plaintext notes remain readable. ProVerif-verified: attacker with database access cannot learn note content.

### Managed Secrets (`pd secret`)
Provider credentials (Anthropic, Gemini, Cloudflare, ngrok, Voyage, etc.) live in the OS keychain — encrypted at rest, fail-closed when keychain is unavailable. Only an explicit allow-list of keys is accepted; there is no pattern matching on key names.

| Command | What it does |
|---------|--------------|
| `pd secret set <KEY> [--backend <b>]` | Store a value via a **hidden stdin prompt**. The value is never read from `argv`, so it does not leak into shell history or the process table. Pipe-friendly: `echo "$TOKEN" \| pd secret set KEY`. |
| `pd secret list` | Table of `KEY`, `BACKEND`, `STORAGE`, `ENCRYPTED`, `SET?` — names and status only, never values. |
| `pd secret reveal <KEY> [--copy]` | Print the value (with a one-line warning), or with `--copy` send it to `pbcopy` and auto-clear the clipboard after 45s without printing. |
| `pd secret rm <KEY>` | Remove the value from the keychain. |

HTTP surface (loopback daemon): `GET /secrets`, `POST /secrets`, `POST /secrets/:key/reveal`, `DELETE /secrets/:key`. The reveal route returns plaintext for the FleetBar Copy affordance and is loopback-only (per-route `preHandler` plus the global DNS-rebinding guard); it returns `404` when a key is allow-listed but unset.

### White Papers
Two formal white papers are available at `/whitepaper` on the website:
- **The Anchor Protocol** — Formally verified cryptographic identity for agent swarms (ProVerif + Kani/Rust)
- **The Bonded Commons** — Pre-transactional trust infrastructure: Hobbes, Sen's impossibility, collateralized work contracts

> After updating PDFs under `website-v2/public/whitepaper/`, run `cd website-v2 && npm run fix:whitepaper-metadata` to resync `pages` and `sizeKb` in `src/data/whitePapers.ts`. The check runs in CI via `.github/workflows/whitepaper-metadata.yml` (Ubuntu + poppler) and fails the PR on drift; locally, `cd website-v2 && npm test` exercises the same drift detection (see `src/data/whitePapers.test.ts`).

---

## 🎛️ The Dashboard (HUD)

Access the high-density **Orchestration Control Panel** locally:
- **URL:** `http://dashboard.pd.local:3144`
- **Immersive 3D:** Toggle the **3D Swarm** view to see your agents and services as a spatial force-directed graph.
- **Swarm Radio:** A unified timeline merging infrastructure events, agent notes, and real-time message traffic.

---

## ⚙️ Configuration

### `.portdaddyrc`
Commit this to your repo so every developer gets the same deterministic port mapping.
```json
{
  "project": "payment-pro",
  "services": {
    "api": {
      "cmd": "npm run dev:api -- --port ${PORT}",
      "healthPath": "/health"
    },
    "web": {
      "cmd": "next dev --port ${PORT}",
      "needs": ["api"]
    }
  }
}
```

### Environment Variables
- `PORT_DADDY_URL`: Daemon address (Default: `http://localhost:9876`)
- `PORT_DADDY_RANGE_START`: Port pool start (Default: `3100`)

---

## 📖 Executable Examples

| Pattern | Goal |
|---------|------|
| **Leader Election** | Use locks to appoint a single master agent in a worker swarm. (`/examples/leader-election`) |
| **P2P Handshake** | Use inboxes as signaling servers to establish high-bandwidth WebRTC tunnels. (`/examples/p2p-webrtc`) |
| **Ephemeral CI Database** | Claim a stable semantic port for a per-run test database. (`/examples/ephemeral-ci-db`) |
| **Agent Topologies** | Publish star, ring, and arbiter topology events into inspectable channels. (`/examples/agent-archetypes`) |
| **Agentic Escrow** | Hold lock-backed payouts until an Arbiter agent verifies work quality. *(planned — see `docs/plans/PHONE-INTEGRATION-MASTER-PLAN.md`)* |
| **The Brig** | Automatically isolate or salvage agents who deviate from their manifest. *(planned — see `docs/plans/PHONE-INTEGRATION-MASTER-PLAN.md`)* |

The public site uses **`/examples`** as the single source-backed catalogue for runnable patterns.
Daemon and single-binary builds also publish those promised examples and templates under `/samples/manifest.json` and `/samples/files/...`, so public tutorial code can be fetched from a binary install without treating the source checkout as the runtime asset server.

---

## 🛠️ Development & Testing

### Setup
```bash
git clone https://github.com/curiositech/port-daddy
npm install
npm run dev # Starts daemon and website in dev mode
npm run build:public-samples
npm run build:daemon
npm run build:bin
```

### Quality Gates
We maintain an extreme standard of reliability for the control plane:
- **Test Suite:** 3,700+ passing tests.
- **Formal Verification:** Roadmap includes **ProVerif** modeling for the Anchor Protocol.
- **Benchmarking:** `pd bench` measures atomic commit latency.

### Contributing
Start with [CONTRIBUTING.md](CONTRIBUTING.md). Every PR is filled out against
[`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) and is held to
the contract in [AGENTS.md](AGENTS.md): an exhaustive summary and a non-trivial test
plan (enforced by the `pr-requirements-guard` CI job), screenshots + a GIF/recording
for any visual change, surface parity for new CLI verbs (`npm run parity`), new tests
for new code, and a `CHANGELOG.md` entry. A neutral adversarial reviewer runs on every
PR and posts a `SHIP / SHIP-AFTER-FIX / DO-NOT-SHIP` verdict.

---

## 🗺️ V4 Roadmap: The Wild West

As swarms move beyond local machines, we are building the **Code of the Sea** for agents:
- **Float Plans & Manifests:** Pre-declaration of agent intent and resource needs.
- **Ephemeral FUSE Harbors:** Harbor-specific data storage that shreds upon departure.
- **Agent OAuth:** Cryptographic identity verification for remote P2P coordination.
- **Noise Protocol Tunnels:** Secure, encrypted P2P tunnels between remote Port Daddy instances.

---

## ⚖️ License

**FSL-1.1-MIT** — (Functional Source License).
Free for development and internal use. See [LICENSE](LICENSE) for details.

Created by **[Erichs Owens](https://github.com/erichowens)** at **[curiositech](https://curiositech.ai)**.

---

## ⚓ Support & Contact
- **Issues:** [GitHub Issue Tracker](https://github.com/curiositech/port-daddy/issues)
- **Help:** Run `pd help` or `pd learn` for the interactive tutorial.
- **Vibe:** Ambitious, CUTE and CHARMING. 🚩
