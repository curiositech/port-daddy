# R06 — Monitor crash and recovery contract

A monitor is not `Healthy` until its identity, source binding, state, and verified
baseline have been reconciled. A missed heartbeat alone is only suspicion.

```mermaid
stateDiagram-v2
  [*] --> Unknown
  Unknown --> Reconciling: startup or witness signals loss
  Reconciling --> Healthy: identity and baseline verified
  Reconciling --> Held: source or baseline unresolved
  Healthy --> Suspected: health evidence stale
  Suspected --> Reconciling: gather independent evidence
  Suspected --> Failed: process absence confirmed
  Failed --> Held: keep dependent effects gated
  Held --> Restarting: authorized bounded restart
  Restarting --> Reconciling: reconcile before reuse
  Restarting --> Held: restart denied or source unavailable
```
