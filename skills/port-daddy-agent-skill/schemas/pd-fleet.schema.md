# `pd-fleet.yml` — Human Schema

Companion to `pd-fleet.schema.json`. Same fields, with rationale.

## Top-level shape

```yaml
fleet:
  name: <string>          # MUST equal basename(projectDir). See below.
  harbor: "{project}:fleet"
  limits: { ... }         # spawn quotas
  agents: { ... }         # map of agent name -> agent
  watchers: { ... }       # optional
  channels: { ... }       # optional, used by topology validator
  defaults:               # optional fallbacks for backend/model
    backend: ollama
    model: qwen2.5-coder:7b
```

## `fleet.name`

The post-commit hook publishes to `project:<basename>:<hash>:git:committed`. `lib/fleet-channels.ts` derives the slug from `fleet.name`. **If `fleet.name` ≠ `basename(projectDir)`, every `trigger: git:committed` agent goes silently dormant.** Validate with:

```bash
basename "$(pwd)"   # must match fleet.name
```

## `fleet.harbor`

A semantic identity (see `semantic-identity.md`). Agents that share a harbor see each other's tuple space and have a shared registration namespace. `{project}` is substituted from `fleet.name`. Conventional value: `{project}:fleet`.

## `fleet.limits`

Enforced by `FleetRunner` *before* spawning. If the spawn would exceed any limit, the trigger is dropped (with a fleet event).

| Field | Default | Effect when exceeded |
|---|---|---|
| `max_concurrent_spawns` | unlimited | Trigger silently dropped until a running agent exits. |
| `max_spawns_per_hour` | unlimited | Trigger silently dropped, sliding-hour window. |
| `budget_usd_per_day` | unlimited | Trigger silently dropped once cost-tracker shows day spend ≥ ceiling. Useful when running cloud LLMs. |

Tune for your own wallet. Local Ollama agents can run without limits; cloud-backed agents should *always* set `budget_usd_per_day`.

## `fleet.agents.<name>` — the workhorse

Each agent has exactly one role. The fields below describe **when** the agent runs, **what** it runs, and **what happens after**.

### When it runs

Agents fire when ANY of these is true:

| Field | Cadence |
|---|---|
| `schedule: "*/10 * * * *"` | Cron tick. |
| `trigger: <channel>` | Pub/sub message arrives on `<channel>`. |
| `triggerTuple: ["task", "*", "pending"]` | Tuple matching this pattern lands in the harbor. |

You can mix them. If you set none, the agent is reachable only via manual `pd spawn`.

### What it runs

| Field | Required | Notes |
|---|---|---|
| `backend` | yes | One of `ollama`, `claude`, `claude-cli`, `codex`, `gemini`, `aider`, `custom`. |
| `model` | when supported | Pin it. `claude-3-5-sonnet`, `qwen2.5-coder:7b`, etc. Predictable cost > "best available". |
| `prompt` | yes | For LLM backends, the user message. For `custom`, the shell command. |
| `allowedTools` | optional | Claude-CLI tool allowlist: `Read,Grep,Bash(npm test*)`. |
| `worktree` | optional | If `true`, the spawner creates a git worktree and runs the agent there. |
| `timeout` | optional | Seconds before SIGKILL. |
| `singleton` | optional | Prevents double-spawn. |
| `respawn` | optional | If true and the agent dies, fleet restarts it (subject to `max_respawns`). |

### What happens after

| Field | Effect |
|---|---|
| `on_success: publish <channel>` | On exit 0, publish to `<channel>`. Chains agents into pipelines. |
| `on_failure: publish <channel>` | On non-zero exit, publish to `<channel>`. |
| `identity: "{project}:fleet:qa"` | Registers the agent under this PD identity. Required for salvage to find its work. |

### Backoff & dedupe

For chatty triggers (commits in a busy repo, frequent pub/sub), set:

```yaml
cooldown_ms: 30000          # min gap between activations
dedupe_window_ms: 5000      # collapse identical triggers within this window
backoff_base_ms: 1000
backoff_max_ms: 60000
backoff_multiplier: 2
```

## `fleet.watchers.<name>`

Lighter-weight than agents. A watcher subscribes to a channel and runs a shell `exec` directly — no LLM. Use for build hooks, notifications, file syncing.

## `fleet.channels.<name>`

Optional but **strongly recommended** when you have ≥3 agents. The topology validator (`validateTopology` in `lib/fleet-engine.ts`) walks the channel graph at startup and emits warnings when:

- A channel has no producer (no `on_success: publish` writes to it, no `external_producer`).
- A channel has no consumer (no agent has it as `trigger`, no watcher subscribes).
- A cycle exists in the publish graph.

Declaring `channels` makes those warnings actionable.

```yaml
channels:
  git:committed:
    description: "Fired by the post-commit git hook"
    consumers: [qa, documentarian]
    external_producer: true        # produced by the git hook, not a fleet agent
```

## Worked Minimum Fleet

```yaml
fleet:
  name: myapp
  harbor: "{project}:fleet"
  limits:
    max_concurrent_spawns: 2
    budget_usd_per_day: 5
  agents:
    qa:
      trigger: git:committed
      backend: ollama
      model: qwen2.5-coder:7b
      identity: "{project}:fleet:qa"
      respawn: true
      max_respawns: 3
      prompt: "Review the last commit for bugs. If clean, say CLEAN."
      on_success: publish qa:clean
      on_failure: publish qa:findings
  channels:
    git:committed:
      description: "Post-commit hook"
      consumers: [qa]
      external_producer: true
    qa:clean: { description: "QA passed" }
    qa:findings: { description: "QA found issues" }
```

## Validation

```bash
# Schema-validate (requires `ajv-cli` or similar):
ajv validate -s schemas/pd-fleet.schema.json -d pd-fleet.yml

# Topology-validate (uses the daemon's own validator):
curl http://localhost:9876/fleet/config/$(basename "$(pwd)")
```

The skill ships `scripts/fleet-validate.sh` that does both.
