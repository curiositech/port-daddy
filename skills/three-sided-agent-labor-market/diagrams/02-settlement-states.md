# Proposed settlement state machine

```mermaid
stateDiagram-v2
  [*] --> Proposed
  Proposed --> Held: accepted plan and funds held
  Proposed --> Rejected: no acceptance
  Held --> InProgress: authorised start
  Held --> FailureReview: accepted but fails before start
  InProgress --> EvidencePending: delivery or attempted effect
  InProgress --> UnknownEffect: timeout or uncertain transmission
  EvidencePending --> SuccessDecision: accepted evidence and authority
  EvidencePending --> PartialReview: partial scope evidence
  EvidencePending --> FailureReview: failed evidence
  EvidencePending --> Disputed: competing evidence or appeal
  UnknownEffect --> Disputed: investigate effect and authority
  PartialReview --> Disputed: contested allocation
  FailureReview --> Disputed: contested finding
  SuccessDecision --> Disputed: challenged before release
  SuccessDecision --> ReleaseRecorded: one stated release path
  PartialReview --> ReleaseRecorded: authorised partial rule
  FailureReview --> ReleaseRecorded: stated failure rule
  Disputed --> Reversed: superseding decision with new evidence
  Disputed --> ReleaseRecorded: final authority decision
  Reversed --> ReleaseRecorded: idempotent superseding release
  ReleaseRecorded --> RecoveryReview: later challenge or reversal
  RecoveryReview --> RecoveryRecorded: separate authorised recovery or deficit
  RecoveryRecorded --> [*]
  ReleaseRecorded --> [*]
```

This is a constructed state model. “Held,” “authority,” “release,” and “reversal” must be bound to an actual first-party contract before they are claimed as enforced behavior.

The pre-release dispute path preserves held funds. A challenge after release enters a separate recovery review; it cannot recreate the original hold. Partial releases require a stated disposition for any remaining balance.
