# ADR-0019: Declarative Fleet Configuration (pd-fleet.yml)

## Status: PROPOSED

## Context

Port Daddy's fleet agents are currently 1,384 lines of imperative zsh scripts. Each agent is a separate shell file that manually:
- Calls `curl` to register with the daemon
- Runs `claude -p` directly (bypassing `pd spawn`)
- Manages its own lifecycle (register, heartbeat, shutdown)
- Hardcodes paths, thresholds, and channel names
- Contains both configuration (what to do) and implementation (how to do it)

This has problems:
1. **Can't scan it** — you have to read 95 lines of shell to understand what the Git Gardener does
2. **Can't share it** — each project would need to copy/paste and modify scripts
3. **Doesn't dogfood** — fleet scripts call `claude -p` instead of `pd spawn`
4. **Can't version it** — changing behavior means editing code, not config
5. **Can't compose it** — you can't mix agents from different projects

Docker Compose solved this exact problem for containers. Port Daddy should solve it for agents.

## Decision

Introduce `pd-fleet.yml` — a declarative YAML file that defines background agents, watchers, and their coordination topology. The `pd fleet` command reads this file and manages the lifecycle.

## The Schema

```yaml
# pd-fleet.yml — Declarative agent fleet configuration
# Place in project root alongside .portdaddyrc

fleet:
  name: port-daddy-dev     # Fleet identity (shows up in pd fleet status)

  # ─── Services ──────────────────────────────────────────────
  # Long-running dev servers managed by pd up/down.
  # Same as .portdaddyrc services, but can be defined here too.
  services:
    api:
      dev: "npm run dev:api"
      port: auto
      health: /health
    frontend:
      dev: "npm run dev:web"
      port: auto
      needs: [api]

  # ─── Agents ────────────────────────────────────────────────
  # Background AI agents. Each becomes a `pd spawn` invocation.
  # Port Daddy handles registration, heartbeats, and salvage.
  agents:

    gardener:
      schedule: "*/10 * * * *"      # cron syntax — every 10 min
      run_on_start: false           # opt in only if daemon boot should fire it
      backend: claude
      prompt: |
        Check for uncommitted changes in {project_dir}.
        If changes exist and total diff < 2000 lines, generate a
        conventional commit message and commit. Stage only source
        files (lib/, routes/, server.ts, tests/).
        Never stage .env files or binaries.
      on_success: publish git:committed
      identity: "{project}:fleet:gardener"

    qa:
      trigger: git:committed        # fires when this channel gets a message
      backend: claude
      worktree: true                 # runs in an isolated worktree
      prompt: |
        Adversarial review of the latest commit.
        Read every changed file. For each change, find inputs that
        would break it. Write a test that exposes each bug found.
        If no bugs: say CLEAN.
      on_success: publish qa:clean
      on_failure: publish qa:findings
      identity: "{project}:fleet:qa"

    test-hunter:
      trigger: git:committed
      backend: claude
      prompt: |
        Run test coverage. Find modules below 50% line coverage.
        For each gap, write meaningful tests that exercise real
        code paths (not trivial/tautological tests).
      identity: "{project}:fleet:test-hunter"

    documentarian:
      trigger: git:committed
      backend: claude
      prompt: |
        Read the actual code. Check if CLAUDE.md, README.md, and
        features.manifest.json match reality. If they diverge,
        fix the docs to match the code. Code is truth.
      identity: "{project}:fleet:documentarian"

    simplifier:
      trigger: git:committed
      backend: claude
      worktree: true
      prompt: |
        Review recently changed files for unnecessary complexity.
        Simplify WITHOUT changing behavior. Prefer removing code
        over adding code. Run tests to verify.
      identity: "{project}:fleet:simplifier"

    research:
      trigger: research:request     # on-demand via pd pub
      backend: claude
      prompt: |
        Research the topic from the message payload.
        Search the web, read docs, synthesize findings.
        Save report to research/ directory.
      on_success: publish research:results
      identity: "{project}:fleet:research"

    spark:
      schedule: "*/30 * * * *"      # every 30 min
      run_on_start: false
      backend: claude
      prompt: |
        You are Spark, the idea engine. Observe the codebase,
        commission research, synthesize ideas, pitch proposals.
        Save ideas to .spark/ideas/ with concrete API sketches.
      on_success: publish spark:idea
      singleton: true               # only one instance ever
      identity: "{project}:fleet:spark"

  # ─── Watchers ──────────────────────────────────────────────
  # Lightweight event reactions (no AI needed).
  # These are pure shell — for when you just need a script to run.
  watchers:

    notify-on-findings:
      trigger: qa:findings
      exec: "echo 'QA found bugs!' | pd note --type warning"

    auto-promote:
      trigger: git:committed
      condition: "count > 5"        # after 5 commits in this session
      exec: "pdship"
      confirm: true                 # ask before running

  # ─── Channels ──────────────────────────────────────────────
  # Declare the pub/sub topology so it's visible and documentable.
  channels:
    git:committed:
      description: "Fired after a successful commit"
      consumers: [qa, test-hunter, documentarian, simplifier]

    git:check:
      description: "Cron heartbeat for gardener"
      consumers: [gardener]

    qa:findings:
      description: "QA adversary found bugs"
      consumers: [notify-on-findings]

    spark:idea:
      description: "Spark generated a new idea"

    research:request:
      description: "Topic for the research scout"
      consumers: [research]

    fleet:error:
      description: "Agent failure reports"
```

## Template Variables

The YAML supports template variables that are resolved at runtime:

| Variable | Resolves to |
|----------|------------|
| `{project}` | Project name from `.portdaddyrc` or directory name |
| `{project_dir}` | Absolute path to the project root |
| `{message}` | The pub/sub message payload that triggered this agent |
| `{sha}` | Current git HEAD short SHA |
| `{branch}` | Current git branch name |
| `{changed_files}` | Files changed in the latest commit |

## Agent Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `trigger` | string | * | Channel to subscribe to (mutually exclusive with `schedule`) |
| `schedule` | string | * | Supported cron subset: `*/N * * * *`, `0 */N * * *`, `M * * * *`, or `M H * * *` (mutually exclusive with `trigger`). Fixed clocks use the host's local `Date`: DST gaps advance by the gap and folds select the earlier occurrence; this is not timezone-aware calendar walking. |
| `backend` | string | yes | `claude`, `ollama`, `gemini`, `aider`, `custom` |
| `prompt` | string | yes | The task for the AI agent (supports template vars) |
| `enabled` | bool | no | Set `false` to keep a declaration inspectable but omit it from executable runtime config (default: true; malformed values fail closed to disabled) |
| `run_on_start` | bool | no | For scheduled agents only: fire once when the fleet starts (default: false) |
| `worktree` | bool | no | Run in an isolated git worktree (default: false) |
| `singleton` | bool | no | Only one instance allowed at a time (default: false) |
| `identity` | string | no | PD identity (default: `{project}:fleet:{name}`) |
| `on_success` | string | no | Action on success (`publish <channel>`, `exec <cmd>`) |
| `on_failure` | string | no | Action on failure |
| `model` | string | no | Override model for this agent |
| `timeout` | string | no | Max runtime (`5m`, `30m`, `2h`) |
| `env` | map | no | Extra environment variables |
| `confirm` | bool | no | Ask human before running (default: false) |

## CLI Integration

```bash
pd fleet up                    # Read pd-fleet.yml, start all agents + watchers
pd fleet down                  # Stop everything
pd fleet status                # Show fleet from YAML with live state
pd fleet validate              # Check pd-fleet.yml syntax and resolve templates
pd fleet run gardener          # Run a specific agent once (ignoring trigger/schedule)
pd fleet logs spark            # Tail logs for a specific agent
pd fleet ideas                 # Spark's idea notebook
```

## How `pd fleet up` works

1. Read `pd-fleet.yml` from project root (or `--config <path>`)
2. Validate schema, resolve template variables
3. Omit every `enabled: false` (or malformed-enabled) declaration before runtime projection; for each remaining `schedule` agent, register a cron-like loop via `pd spawn` and fire immediately only when `run_on_start: true`
4. For each `trigger` agent: register a `pd watch` subscriber
5. For each `watcher`: register a lightweight `pd watch --exec`
6. Register the Dock Master as a meta-agent that monitors all the above
7. Publish `fleet:started` with the fleet topology

## What this replaces

| Before (1,384 lines of shell) | After (YAML + engine) |
|------|------|
| `fleet/git-gardener.sh` (95 lines, historical removed script) <!-- cite-exempt --> | 8 lines of YAML |
| `fleet/qa-adversary.sh` (90 lines, historical removed script) <!-- cite-exempt --> | 10 lines of YAML |
| `fleet/spark.sh` (223 lines, historical removed script) <!-- cite-exempt --> | 10 lines of YAML |
| `fleet/common.sh` (201 lines, historical removed script) <!-- cite-exempt --> | Built into `pd fleet` engine |
| `fleet/dock-master.sh` (119 lines, historical removed script) <!-- cite-exempt --> | Built into `pd fleet` engine |
| `fleet/pd-fleet.sh` (220 lines, historical removed script) <!-- cite-exempt --> | Built into `pd fleet` CLI |

Total: **1,384 lines of shell → ~80 lines of YAML + a proper engine in `lib/fleet-engine.ts`**

## What doesn't change

- `pd spawn` remains the execution primitive — fleet agents are syntactic sugar over it
- `pd watch` remains the event subscription primitive
- Pub/sub channels, sessions, notes, salvage — all existing infrastructure stays
- Any project can still use raw `pd spawn` and `pd watch` without YAML

## Why not just extend .portdaddyrc?

`.portdaddyrc` describes the *project's services* (what runs, on what ports). `pd-fleet.yml` describes the *development workflow* (what agents help you build). They're separate concerns:

- `.portdaddyrc` → "my project has an API and a frontend"
- `pd-fleet.yml` → "I want a QA adversary and an auto-committer helping me build it"

A team might share `.portdaddyrc` but have different fleet configs per developer. Or a fleet config might apply across multiple projects.

## Migration path

1. Build the YAML parser and `lib/fleet-engine.ts` engine
2. Keep existing shell scripts as fallback
3. Add `pd fleet init` to generate a starter `pd-fleet.yml` from existing fleet scripts
4. Deprecate individual shell scripts once the engine is stable

## For other projects

Any project can create a `pd-fleet.yml`:

```yaml
# A typical web app's fleet
fleet:
  name: my-saas-app
  agents:
    gardener:
      schedule: "*/15 * * * *"
      backend: claude
      prompt: "Auto-commit uncommitted changes with good messages"
    qa:
      trigger: git:committed
      backend: claude
      worktree: true
      prompt: "Find bugs in the latest commit"
```

That's it. Two agents, eight lines each. `pd fleet up` in any project directory reads the local YAML and starts the fleet.

## Open questions

1. Should agents inherit from a base template? (e.g., `extends: gardener-base`)
2. Should fleet configs be composable? (e.g., `includes: [common-fleet.yml]`)
3. Should the YAML live in `.portdaddyrc` as a `fleet:` section, or be a separate file?
4. How do fleet agents interact across projects? (e.g., Spark in project A commissions Research Scout in project B)
