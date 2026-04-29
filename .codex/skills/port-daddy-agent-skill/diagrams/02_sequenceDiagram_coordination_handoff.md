# Coordination Handoff

```mermaid
sequenceDiagram
  participant A as Agent A
  participant D as Port Daddy daemon
  participant Actor as Durable actor
  participant B as Agent B
  A->>D: pd begin + claim files
  A->>D: pd note scope and validation plan
  A->>Actor: actor inbox message when role ownership matters
  A->>D: tuple out machine-readable fact
  A->>D: pd note result, validation, remaining risk
  A->>D: pd done
  B->>D: pd briefing + notes + salvage
  B->>Actor: read inbox if relevant
  B->>D: continue from claims, notes, tuples, and evidence
```
