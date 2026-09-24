# Failure and recovery boundary

```mermaid
stateDiagram-v2
  [*] --> attempt
  attempt --> reported_success: action outcome reported
  attempt --> failure_event: action or subgoal reports failure
  attempt --> evidence_changed: explicit application reconsideration
  failure_event --> guarded_recovery: recovery context holds
  failure_event --> unmatched: context absent or unknown
  guarded_recovery --> attempt
  evidence_changed --> attempt: application selects and adopts new plan
  reported_success --> verify: independent evidence check
  verify --> [*]
  unmatched --> [*]
```

This is an application recovery policy, not the interpreter transition system. A new belief does not automatically replace an executing intention. Reconsideration requires explicit application logic. Verification can fail; its separate disposition must be retained rather than inferred from a reported action success.
