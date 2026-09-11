# Actor-coordination salvage (isolated, not wired into lib/)

Per instruction: `maritime-actors.ts` is kept here rather than dropped into the
live TypeScript library's `lib/` directory, since it was never reviewed or
tested against the current codebase.

- `maritime-actors.ts` (+ its test file) — a typed actor-coordination model for
  fleet agents (gardener, qa, documentarian, spark, spider, ...) with explicit
  states (attached/recoverable/detached/dormant) and mailbox/lease semantics.
- `agent-runs-2026-05-06/` — a real multi-agent fan-out runbook from an actual
  6-worktree parallel run: `orchestrator.md` (the spawn/monitor loop),
  `SHARED-CONTEXT.md`, and five per-PR handoff notes. Concrete evidence of how
  a past multi-agent fan-out was actually run, not a proposal.

Neither has been checked against the current `core`/`lib` code for API drift;
treat as reference material, not drop-in code.

`maritime-actors.test.js` is the source branch's own test for `maritime-actors.ts`,
kept alongside it so a reviewer can see the intended behavior — it is **not** under
`tests/` and is not picked up by this repo's jest config, so it does not run in CI.
