# Delegation Modes And Harbors

Last updated: 2026-04-07

This document is the canonical explanation of how Port Daddy's delegation surfaces differ today.

If the README, skill docs, UI copy, or recovery notes disagree with this file, this file wins until those surfaces are updated.

## The Short Version

- `pd spawn` is the primitive.
- `pd agent` is the preferred single-agent sugar over `pd spawn`.
- `pd sortie` is now a first-class mission record and CLI surface, but only its first slice is shipped.
- `pd fleet` is always-on project automation from `pd-fleet.yml`.
- `harbor`s are the coordination namespace and should be compulsory for fleets and sorties.

## Do We Have Commands For Sortie Outcomes?

Yes, but only as a first slice.

There are now shipped `pd sortie list`, `pd sortie status <id>`, and `pd sortie logs <id>` commands backed by persisted sortie records.

What still does **not** exist yet:

- `pd sortie approve`
- `pd sortie cancel`
- `pd sortie results` as a separate convenience command
- rich multi-agent execution under the hood
- human-in-the-loop controls and approval queues
- dedicated sortie visualizations in the CLI

Current truthful ways to inspect sortie work:

```bash
# First-class sortie records
pd sortie list
pd sortie status <id>
pd sortie logs <id>

# Active and recent sessions
pd sessions --all-worktrees

# Project-level summary, notes, recent files, and agent context
pd briefing --project my-project

# Raw timeline of audit events
pd activity --range 8h

# Session notes when you know the session id
pd notes --session <session-id>
```

And there are still useful lower-level supporting commands:

```bash
pd spawned
pd briefing --project my-project
pd activity --range 8h
pd notes --session <session-id>
```

## The Five Surfaces

| Surface | What it is | When to use it | What it should feel like |
|---------|------------|----------------|---------------------------|
| `pd spawn` | Low-level launch primitive | You want explicit control over backend, model, identity, purpose, budget, and timeout | "Launch exactly this run." |
| `pd agent` | Preferred one-shot single-agent sugar | You want Port Daddy to do the right coordination steps around one bounded task | "Handle this task correctly for me." |
| `pd sortie` | Mission record + launch surface | You want a tracked delegated mission with a durable id, event log, and outcome | "Run this mission and give me a result I can inspect later." |
| `pd fleet` | Declarative background automation | You want project agents that stay armed on schedules/triggers | "Keep watch over this repo." |
| `harbor` | Coordination namespace | You need scoped messaging, tuples, membership, and capability boundaries | "These runs belong to the same team/context." |

## Recommended Product Contract

### `pd spawn`

`pd spawn` should remain the primitive and stay relatively raw.

It is for:

- explicit backend/model launches
- shell scripting
- SDK/MCP wrappers
- lower-level debugging

Example:

```bash
pd spawn \
  --backend codex \
  --tier low \
  --budget 0.25 \
  --identity myapp:fixer:auth \
  --purpose "Investigate auth redirect loop" \
  -- "Inspect the failing redirect logic and summarize the root cause"
```

### `pd agent`

`pd agent` should be the preferred user-facing single-agent entry point.

It is a sugar layer over:

- session begin
- spawn preflight
- one spawned run
- session close / salvage note

Example:

```bash
pd agent \
  "Review the last commit for regressions" \
  --backend codex \
  --tier low \
  --budget 0.35
```

Product rule:

- if `pd agent` can stay single-agent and bounded, it should not force the user to think about mission objects
- if `pd agent` needs higher-order orchestration later, it can internally join or create a harbor, but that should stay mostly implicit

### `pd sortie`

`pd sortie` now exists because it buys one thing immediately and several things later.

Already true:

- durable sortie id
- persisted mission record
- event log
- status/result lookup

Still the intended reason it exists:

- multiple agents
- explicit mission roster
- explicit approvals / human gates
- richer artifact tracking
- a legible mission summary / result page

Current implementation note:

- the first shipped slice still runs a single coordinating spawned agent underneath
- the richer multi-agent/human-gate mission system is still the next layer

### `pd fleet`

`pd fleet` is for long-lived project automation:

- schedules
- triggers
- singleton background agents
- persistent repo stewardship

Fleet should not be described like one-shot delegation.

### `harbor`

A harbor is the shared semantic namespace for coordinated work:

- membership
- scoped messaging
- tuple-space isolation
- capability grouping
- collective identity

## Harbor Policy

This is the recommended rule going forward.

### Harbors should be compulsory for:

- every fleet
- every sortie
- any explicit multi-agent workflow

Compulsory does **not** mean the operator must manually create one every time. It means the system should auto-provision and enforce one instead of letting coordinated work float in the global namespace.

### Harbors should be optional or implicit for:

- raw `pd spawn`
- simple `pd agent` runs that do not need multi-agent coordination

For `pd agent`, the likely end state is:

- default to project-scoped identity
- auto-join a project harbor when coordination features are used
- stay lightweight for simple one-shot jobs

## Practical Guidance

Use this decision rule:

1. If you need exact low-level control, use `pd spawn`.
2. If you want one agent to handle a bounded task correctly, use `pd agent`.
3. If you want a temporary team with approvals, artifacts, and a mission result, use `pd sortie` once it becomes first-class.
4. If you want always-on repo stewardship, use `pd fleet`.

## Current Truth Gaps

- `pd sortie` is first-class enough to have ids, logs, and status, but it is not yet the full multi-agent mission engine from the recovery plan.
- some UI surfaces still blur fleet agents, ad hoc manual runs, and sorties together.
- harbor usage is already strong in fleets, but not yet uniformly enforced across every coordinated surface.

Those are product gaps, not operator mistakes.
