# S12 — Monitor failure-domain map

```mermaid
flowchart TD
  P[Probe] -->|request| APP[Monitored service]
  APP -->|response when received| P
  P -->|observation and validity| DB[Sample store]
  DB --> R[Status renderer]
  R --> C[Client]
  P -->|heartbeat| N[Silence detector]
  N --> O[Alert delivery]
  F[Shared identity or control plane?] -.-> P
  F -.-> DB
  F -.-> R
  G[Shared DNS or network?] -.-> APP
  G -.-> N
  G -.-> O
```

Solid arrows are requests or evidence delivery. A request timeout is observed by
the probe without a service response; classify it under the capability's rule.
Dashed arrows are audit questions, not verified independence. Record the failure
domains of every node, including collector, renderer and alert delivery. A silence
detector is useful only within its own delivery, timing and dependency assumptions.
