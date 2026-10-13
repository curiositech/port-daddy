# Conditional code-review task

This converts the original ASCII example into a task path with explicit stopping points.

```mermaid
flowchart TD
  I[Receive change and scoped repository access] --> T[Run declared checks]
  T --> F{Checks fail?}
  F -->|Yes| R[Return failures with evidence]
  F -->|No| A[Review diff against task rubric]
  A --> U{Unclear or unsafe?}
  U -->|Yes| H[Request human decision; do not merge]
  U -->|No| S[Submit findings and test receipts]
  R --> E[Stop with no merge action]
  H --> E
  S --> E
```

This is a constructed example, not a claim that a reviewer agent can establish correctness or authorize a merge.
