# Diagrams

- `01_flowchart_agent_operating_loop.md`: the default operating loop.
- `02_sequenceDiagram_coordination_handoff.md`: how one agent leaves a handoff
  another agent can resume.
- `03_stateDiagram-v2_agent_lifecycle.md`: durable actor and temporary body
  lifecycle.
- `04_flowchart_decision-points.md`: decision points and branch outcomes
  encountered during a coordinated session.
- `05_promote-stable-timing.md`: launchd respawn window during promote-stable
  and why pdFetch retries through it.
- `06_skill-fanout-topology.md`: how `pd init` / `pd setup` fan the canonical
  skill out to every agent runtime via symlinks.
- `07_session-claim-lock-interaction.md`: how sessions, file claims,
  region/symbol claims, and locks compose; when to use which.
