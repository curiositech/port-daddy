# Operational Receipts and Effect Reconciliation

[OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/)
were opened for telemetry naming. **Access depth:** official convention pages.
Conventions standardize labels; they do not prove coverage, causality, or that
every external effect was observed.

```mermaid
sequenceDiagram
    participant O as Operator or runner
    participant A as Attempt
    participant S as Effect system
    participant R as Receipt store
    O->>A: dispatch with revision and idempotency key
    A->>S: requested effect
    S-->>R: observed status or unknown state
    A-->>R: completion or cancellation acknowledgement
    O->>R: reconcile before retry or join
```

```mermaid
stateDiagram-v2
    [*] --> Ready
    Ready --> Running
    Running --> Completed
    Running --> CancelRequested
    CancelRequested --> CancelAcknowledged
    CancelAcknowledged --> EffectUnknown
    EffectUnknown --> Reconciled
    Completed --> Reconciled
    Reconciled --> [*]
```

Record attempt identity, graph revision, inputs, authority, queue/wait and active
duration, retry cause, cancellation acknowledgement, external effect status,
and acceptance result. A cancelled worker can still leave an effect requiring
reconciliation.
