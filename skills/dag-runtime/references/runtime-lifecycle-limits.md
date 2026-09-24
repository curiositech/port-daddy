# Runtime lifecycle limits

[Kotlin coroutines basics documentation](https://kotlinlang.org/docs/coroutines-basics.html) was inspected as structured-concurrency documentation. **Accessed:** 2026-09-24; the page is unversioned. **Access depth:** lifecycle documentation, not a Task-agent runtime test. Dispatch, cancellation, join, and external-effect state require executor receipts.

```mermaid
flowchart LR
 A[Planned node] --> B[Dispatch receipt] --> C[Terminal or unknown state] --> D[Join/reconciliation policy]
```

```mermaid
flowchart TD
 A[Timeout/failure] --> B{Effect reconciled and retry safe?}
 B -->|No| C[Contain and reconcile]
 B -->|Yes| D[Propose authorized retry or failure disposition]
```
