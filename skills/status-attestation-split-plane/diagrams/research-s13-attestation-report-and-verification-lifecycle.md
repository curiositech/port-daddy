# S13 — Attestation report and verification lifecycle

```mermaid
sequenceDiagram
  participant P as Reporter
  participant L as Ledger
  participant A as Archive
  participant V as Verifier
  participant C as Client
  P->>L: Submit bound observation
  L->>L: Append and sign checkpoint
  L->>A: Send checkpoint
  A-->>L: Retention receipt
  V->>A: Obtain retained checkpoints
  V->>L: Request history and proofs
  V->>V: Check identity, signatures, range and proofs
  alt Required evidence unavailable
    V-->>C: Verification unknown
  else Checked evidence conflicts
    V-->>C: Inconsistency and affected range
  else Checks succeed
    V-->>C: Consistency within checked range
  end
  Note over V,C: History integrity does not prove health
```

This is a local design sketch. Archive custody, receipt verification and verifier
independence must be established separately. One retained view cannot exclude an
unseen conflicting view. Health classification also requires the observation's
coverage, age and semantics. A signature or successful consistency check supplies
none of those facts on its own.
