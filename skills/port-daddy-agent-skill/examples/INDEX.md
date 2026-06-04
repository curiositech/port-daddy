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

After examples, the canonical contracts live in `../schemas/` and the executable helpers in `../scripts/`.
