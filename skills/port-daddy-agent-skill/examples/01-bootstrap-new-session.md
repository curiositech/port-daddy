# 01 — Bootstrap a New Session

**Scenario:** You're an agent. You just started. You don't know what's been happening in this repo, what other agents are doing, or whether someone died mid-task.

## The five-call ritual

```bash
# 1. Is the daemon up?
pd status                                 # → "running"  (if not, see 06-debug-daemon-down.md)

# 2. Who am I according to the daemon?
pd whoami                                 # → may return an existing session for this PID

# 3. What's the situation?
pd sitrep --since 60                      # last hour of activity, notes, salvage, spawned agents

# 4. Anyone die in my project?
pd salvage --project "$(basename "$(pwd)")"

# 5. Begin a session — only if whoami didn't return one
pd begin --identity myapp:api:feature-x --purpose "Implement /v2/auth/refresh"
```

## What good output looks like

```text
$ pd sitrep --since 60 --project myapp
Sitrep (last 60 min) for myapp:*
  activity: 14 events  (claims:3 notes:9 spawns:2)
  notes (most recent 5):
    - [decision] Switched JWT lib to jose for ESM support  (2026-04-28 14:01)
    - [progress] /v2/auth/refresh route stub landed       (2026-04-28 13:48)
    ...
  salvage: 0 pending
  spawned: qa (claude-cli, running 4m)
```

If `salvage:` is non-zero, **stop and read `examples/03-salvage-dead-agent.md`** before starting fresh work. You may be able to continue the dead agent's session instead of duplicating effort.

## What to do next

After `pd begin`, before you touch any file:

```bash
# Pre-flight: check coordination overlap on the files you intend to edit
pd session files claim src/auth/refresh.ts src/auth/jwt.ts
```

If a claim returns a conflict:

```text
WARN: src/auth/jwt.ts claimed by agent abc-123 (purpose: "rewrite jose imports")
```

Don't push through. Read `examples/02-two-agents-same-file.md`.

## End of session

```bash
pd note --type handoff "Refresh route + tests done. Open: rate-limit headers, see TODO in refresh.ts:42"
pd done
```

`pd done` releases your file claims, marks your session complete, and unregisters you. The notes survive forever.

## Why this ritual matters

- **`whoami` first** prevents you from starting a duplicate session on the same identity.
- **`sitrep` second** is cheap (one HTTP call) and replaces 4 individual `pd notes / pd salvage / pd activity / pd spawned` calls.
- **`salvage` third** is the dogfooding contract: if there's dead-agent work in your scope, picking it up is more valuable than starting new work.
- **`pd begin` last** because the prior calls may change what you `--purpose`.

The whole ritual is ~1 second. Skipping it costs hours when two agents collide.
