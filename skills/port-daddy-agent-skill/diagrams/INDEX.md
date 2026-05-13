# Diagrams

Visual models. Open the diagram that matches the question you're asking, not the file order.

| Diagram | Use when |
|---|---|
| `01_flowchart_agent_operating_loop.md` | You want the canonical default operating loop in one picture. |
| `02_sequenceDiagram_coordination_handoff.md` | You're leaving a handoff (or picking one up) and need to see message order across the durable surfaces. |
| `03_stateDiagram-v2_agent_lifecycle.md` | You're confused about the difference between a durable actor and a temporary body. |
| `04_flowchart_decision-points.md` | You're at a branch in a coordinated session and want the visual companion to the decision tables. |
| `05_promote-stable-timing.md` | You're inside (or about to enter) the launchd respawn window during a stable promotion. |
| `06_skill-fanout-topology.md` | You're wondering how `pd init`/`pd setup` make Claude/Codex/Gemini/Cursor/Continue all see the same skill content. |
| `07_session-claim-lock-interaction.md` | You're conflating sessions, file claims, and locks and need the scope ladder. |

If a diagram contains an unrendered Mermaid block, the validator will catch it.
