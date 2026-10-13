# Intention operators and failure boundaries

```mermaid
flowchart TD
  G[Parent intention: !deliver] --> A{Subgoal form}
  A -->|!move| S[Same intention; parent waits]
  A -->|!!notify| N[New intention; parent continues]
  S --> Q{Concurrent composition?}
  Q -->|parallel AND| AND[Two sub-intentions; continue only when both finish]
  Q -->|first-success OR| XOR[Two sub-intentions; first success drops the other]
  AND --> F{One branch fails without handler?}
  F -->|yes| DROP[Drop other branch; handle failure of parent goal]
  F -->|no| BOTH[Continue until both branches complete]
  XOR --> X{One branch fails without handler?}
  X -->|yes| OTHER[Discard failed branch; continue trying other]
  X -->|no| FIRST[Wait for first successful completion]
  DROP --> R[-!deliver recovery plan if applicable]
  R --> C[Explicit compensation or local stop]
  C --> E[External side effects are not rolled back automatically]
  AT[atomic plan annotation] -. prevents other intentions while it runs .-> G
```

The `!a |&| !b` operator corresponds to parallel AND; `!a ||| !b` corresponds to first-success OR. The comparison reflects Jason’s documented concurrency rules. `atomic` also propagates to subgoals and therefore trades responsiveness for a short local critical region; it is not a transaction or rollback mechanism.

A handled branch failure can continue through its recovery plan. If neither XOR branch can finish, the enclosing goal cannot be counted as achieved. The arrows summarize outcomes, not a guarantee that an unfinished branch will terminate.
