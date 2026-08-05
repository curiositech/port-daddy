# Delegation Modes

Last updated: 2026-07-02

This document is the canonical operator explanation for Port Daddy delegation.

## The Short Version

- `pd spawn` is the one public launch primitive for bounded AI work.
- SDK callers use `pd.spawn()`.
- MCP callers use the `spawn` tool.
- `pd fleet` is for always-on project automation from `pd-fleet.yml`.
- Harbors remain the coordination namespace for grouped work, but they do not introduce another launch verb.

## Product Contract

### `pd spawn`

Use `pd spawn` when a task should run in the background with Port Daddy coordination, budget tracking, backend readiness checks, transcripts, and salvage state.

```bash
pd spawn \
  --backend codex \
  --tier low \
  --budget 0.25 \
  --identity myapp:fixer:auth \
  --purpose "Investigate auth redirect loop" \
  -- "Inspect the failing redirect logic and summarize the root cause"
```

The CLI submits to a durable daemon-owned run. By default it follows that run;
Ctrl-C detaches the client without killing the work. Use `--detach` to return
the admission receipt immediately, `pd spawned <id>` to inspect once,
`pd spawned <id> --wait` to reconnect and collect, and `pd spawn kill <id>` for
explicit cancellation. `--timeout <ms>` is an optional hard execution deadline,
not a client request timeout; CLI agents have no default wall-clock deadline.
See [`docs/operations/spawn-lifecycle.md`](operations/spawn-lifecycle.md) for the
receipt, monitor, liveness, and daemon-restart contract.

Everything that launches delegated work should eventually lower to this primitive:

- visual tasks from FleetBar or a browser extension
- roadmap work items
- dispatch/nightshift jobs
- review and QA helpers
- fleet-triggered one-shots
- future approval queues and artifact pages

Those surfaces can add better intake, routing, artifacts, and result views. They should not ask the operator to choose between competing launch names.

### `pd fleet`

Use `pd fleet` for recurring or always-on project automation:

- schedules
- triggers
- singleton background workers
- persistent repo stewardship

Fleet is configuration and lifecycle. Spawn is launch.

### Harbors

A harbor is a shared semantic namespace for coordinated work:

- membership
- scoped messaging
- tuple-space isolation
- capability grouping
- collective identity

Harbors should be automatic for fleets and explicit multi-run workflows. A simple `pd spawn` can stay lightweight unless it needs grouped coordination.

## Legacy Records

Older builds created mission-style records over spawned work. Those rows may still exist in local databases and legacy HTTP compatibility routes may still read them until a migration removes or converts them.

They are not an operator launch surface. New product work should model outcomes as spawned runs plus artifacts, transcripts, notes, issues, and roadmap links.

## Decision Rule

1. If you want bounded delegated AI work, use `pd spawn`.
2. If you want recurring stewardship, use `pd fleet`.
3. If you need a shared namespace around multiple runs, add or enter a harbor around spawned work.

If another surface makes the operator choose a different launch noun for the same action, that surface is wrong.
