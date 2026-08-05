# Examples — Worked End-to-End Scenarios

Each example is self-contained: copy-pasteable, with the exact CLI invocations and the expected outcomes. Read top-to-bottom; sections after the first are deep dives.

## Numbered scenarios (read in order on first pass)

| Example | When to read it |
|---|---|
| `01-bootstrap-new-session.md` | First time using PD in a repo, or every session start. |
| `02-two-agents-same-file.md` | You're a parallel agent and another agent is in the same area. |
| `03-salvage-dead-agent.md` | `pd sitrep` shows a dead agent in your project. |
| `04-fleet-from-zero.md` | You want background QA / docs / cartography. |
| `05-tuple-swarm-handoff.md` | Multiple fleet agents need to hand work off without a queue. |
| `06-debug-daemon-down.md` | `pd <anything>` returns connection refused. |
| `07-deterministic-port-collision.md` | Two services need the same hash slot. |
| `09-better-sqlite3-abi-rebuild.md` | A broad test cascade is one worktree-local Node ABI mismatch. |
| `10-walked-into-anothers-rebase.md` | Your branch shifted under you because another agent was mid-rebase in a shared worktree. |
| `11-briefing-first-even-for-diagnostics.md` | You started "just diagnosing" without `pd briefing` and the working tree drifted. |

## Quick-start vignettes

| Example | When to read it |
|---|---|
| `build-now.md` | You want one concrete thing to build with the shipped helpers, right now. |
| `coordinated-edit.md` | You need a minimum-viable claim → edit → note → done flow on a single file. |
| `fleetbar-triage.md` | FleetBar is showing red and you need a triage path before deeper investigation. |

After examples, the canonical contracts live in `../schemas/` and the executable helpers in `../scripts/`.
