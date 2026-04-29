# 04 — Fleet from Zero

**Scenario:** Your project doesn't have background agents. You want QA + cartographer running on every commit.

## Step 1: scaffold

```bash
cd ~/coding/myapp
pd fleet init
```

This creates:

- `pd-fleet.yml` — declarative agent definitions (see `../schemas/pd-fleet.schema.md` for every field).
- `.git/hooks/post-commit` — publishes to `project:<basename>:<hash>:git:committed` after each commit.

The starter file is just enough to be useful. Edit it. The fleet **will not start** until you do — `pd fleet init` is intentionally inert.

## Step 2: validate before starting

```bash
# Schema validation
ajv validate -s ~/.../schemas/pd-fleet.schema.json -d pd-fleet.yml

# OR — the skill ships a one-shot wrapper
~/.claude/skills/port-daddy/scripts/fleet-validate.sh
```

Watch for:

- `fleet.name` must equal `basename(projectDir)`. The post-commit hook publishes to `project:<basename>:...:git:committed`; if the name drifts, every `trigger: git:committed` agent goes silently dormant.
- Each agent needs `backend` and `prompt`.
- Channels referenced in `on_success: publish ...` should be declared under `channels:` (not enforced — but the topology validator warns).

## Step 3: bring it up

The fleet engine has two modes; pick one.

### Mode A — daemon-managed (preferred, v3.8.3+)

```bash
# Tell the daemon to manage this project's fleet
curl -X POST http://localhost:9876/fleet/register \
  -H content-type:application/json \
  -d "{\"projectDir\":\"$(pwd)\"}"

# It auto-starts. To inspect:
curl http://localhost:9876/fleet/$(basename "$(pwd)") | jq
```

The daemon hot-reloads on `pd-fleet.yml` change and survives terminal close.

### Mode B — foreground

```bash
pd fleet up        # blocks; agents inherit your stdout/stderr
```

Useful for development. Ctrl-C stops it.

## Step 4: trigger something

```bash
git commit -m "test fleet"
# Within seconds, fleet agents fire on git:committed.
# Watch the lifecycle stream:
curl -N http://localhost:9876/fleet/events    # SSE
```

## Step 5: see what they did

```bash
pd sitrep                                   # high-level
pd notes --type finding                     # what QA found
pd notes --session $(pd whoami --json | jq -r .session_id)   # your session's notes
pd spawned                                  # are agents still running?
```

## A minimum useful pd-fleet.yml

```yaml
fleet:
  name: myapp                  # MUST equal basename(projectDir)
  harbor: "{project}:fleet"
  limits:
    max_concurrent_spawns: 2
    max_spawns_per_hour: 20
    budget_usd_per_day: 5      # Required if any agent uses cloud LLM

  defaults:
    backend: claude-cli
    model: claude-sonnet-4-6

  agents:
    qa:
      trigger: git:committed
      identity: "{project}:fleet:qa"
      respawn: true
      max_respawns: 3
      allowedTools: "Read,Grep,Glob,Bash(npm test*)"
      prompt: |
        Review the most recent commit. Run npm test if it exists.
        Write a `pd note --type finding` for each bug or smell.
        If clean, write `pd note --type progress "QA clean."` and exit 0.
      on_success: publish qa:clean
      on_failure: publish qa:findings

  channels:
    git:committed:
      description: "Fired by the post-commit hook"
      consumers: [qa]
      external_producer: true
    qa:clean:    { description: "QA passed" }
    qa:findings: { description: "QA found issues" }
```

## Anti-patterns

- **Fleet without `budget_usd_per_day`** when using cloud LLMs. You will wake up to a $200 bill.
- **No `identity` on agents.** Salvage can't filter their dead-agent work; the dashboard can't attribute notes.
- **Multiple agents on the same channel without `dedupe_window_ms`.** Chatty repos spawn duplicates.
- **`fleet.name` drift** when you rename a directory. Re-run `pd fleet init` or fix `name:` by hand.

## When NOT to fleet

- A single agent can do the work in one session. Fleets are for cadence, not power.
- The cost ceiling (`budget_usd_per_day`) is too low for the model you want. Run on local Ollama instead.
- The repo has no tests. QA-on-commit is theater without test signal.
