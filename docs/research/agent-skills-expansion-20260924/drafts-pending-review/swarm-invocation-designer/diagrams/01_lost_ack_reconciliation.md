# Constructed lost-acknowledgement trace

```mermaid
sequenceDiagram
  participant C as Controller
  participant L as Durable ledger
  participant W as Effect destination
  C->>L: Persist intent and reservation for operation k17
  C->>W: Dispatch attempt 1 with enforced generation fence
  W--xC: Acknowledgement unavailable
  C->>L: AMBIGUOUS: retain reservation
  C->>W: Reconcile exact operation k17
  alt terminal effect witnessed
    W-->>C: Operation-bound terminal receipt
    C->>C: Check required outcome and provider accounting
    C->>L: Record justified settlement or continued hold
  else authoritative noncommit plus late-commit fence
    W-->>C: Terminal absence and enforced fence evidence
    C->>C: Check current retry authority and remaining budget
    C->>L: Record authorized next attempt or hold
  else unresolved
    C->>L: Hold; assess proven same-operation dedup or escalate
  end
```
