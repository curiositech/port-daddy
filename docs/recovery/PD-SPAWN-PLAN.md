# PD Spawn Plan

Last updated: 2026-07-03

## Status

`pd spawn` is the only one-shot launch primitive. `pd agent` remains the registry,
inbox, heartbeat, interrupt, and stream namespace. Legacy mission rows only exist
so older spawned-run records can still be read.

## Product Shape

`pd spawn` should feel like:

> "Start the right bounded agent body for this task, with a clear budget,
> identity, transcript, worktree, and salvage path."

The FleetBar, Fleet Control Center, Chrome extension, and `pd-console` should all
route one-shot delegation through this same primitive. Higher-level workflows can
preflight, template, group, or review spawned runs, but they should not invent a
second launch verb.

## Required Operator Guarantees

- Every spawned run declares identity, purpose, backend, budget, and worktree
  policy before launch.
- The daemon records a transcript, cost events, route/channel context, and final
  result or salvage reason.
- Visual-task intake opens a work item and optionally starts a spawned run using
  screenshot and DOM context.
- Fleet UI labels should say "spawn", "spawned run", or "delegated task"; they
  should not expose dispatch, worker, or legacy storage internals to the operator.
- Multi-agent orchestration is a planner over spawned runs, not a separate public
  launch function.

## Example

```bash
pd spawn --backend cli:codex \
  --identity port-daddy:visual-task:fix \
  --budget 1 \
  -- "Fix the clipped checkout button using the attached visual-task payload."
```
