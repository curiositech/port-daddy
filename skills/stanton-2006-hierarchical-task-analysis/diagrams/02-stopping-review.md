# Purpose-bounded stopping review

```mermaid
flowchart TD
  A[Candidate subgoal] --> B[State analysis purpose and consumer]
  B --> C[Name the next detail and decision it could change]
  C --> D[Record supporting evidence and uncertainty]
  D --> E{Further detail useful for that purpose?}
  E -- yes --> F[Redescribe the subgoal and add its plan]
  F --> G[Check with SME or independent source]
  G --> A
  E -- no --> H[Mark // with terminal reason]
  D -. optional rough prompt .-> I[P x C: probability of failure times cost of failure]
  I --> J[No invented score or acceptability cutoff]
  J --> E
```

Stanton discusses probability of failure × cost of failure as a rough heuristic and also reports difficulty quantifying both terms. The diagram therefore makes purpose and usefulness the decision record rather than a numerical quadrant.
