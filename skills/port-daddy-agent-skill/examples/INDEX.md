# Examples — Worked End-to-End Scenarios

Each example is self-contained: copy-pasteable, with the exact CLI invocations and the expected outcomes. Read top-to-bottom; sections after the first are deep dives.

| Example | When to read it |
|---|---|
| `01-bootstrap-new-session.md` | First time using PD in a repo, or every session start. |
| `02-two-agents-same-file.md` | You're a parallel agent and another agent is in the same area. |
| `03-salvage-dead-agent.md` | `pd sitrep` shows a dead agent in your project. |
| `04-fleet-from-zero.md` | You want background QA / docs / cartography. |
| `05-tuple-swarm-handoff.md` | Multiple fleet agents need to hand work off without a queue. |
| `06-debug-daemon-down.md` | `pd <anything>` returns connection refused. |
| `07-deterministic-port-collision.md` | Two services need the same hash slot. |
| `08-launchd-respawn-window.md` | CLI flakes during stable promotion. The ~1s gap between SIGTERM and respawn. |
| `09-better-sqlite3-abi-rebuild.md` | 50+ test suites failing with `NODE_MODULE_VERSION` mismatch. |
| `10-walked-into-anothers-rebase.md` | Mysterious "rebase in progress" you didn't start. Branch state shifted under you. |
| `11-briefing-first-even-for-diagnostics.md` | The meta-lesson: diagnostic work needs the same coordination as edit work. |

After examples, the canonical contracts live in `../schemas/` and the executable helpers in `../scripts/`. Decision trees that branch from a vague situation to a concrete next step live in `../decisions/`.
