# Controlled evaluation cycle

```mermaid
flowchart TD
  C[Define task contract and rubric] --> DEV[Separate development cases from evaluation]
  DEV --> HOLDOUT[Freeze untouched held-out set]
  HOLDOUT --> BASE[Run baseline under recorded conditions]
  HOLDOUT --> CAND[Run candidate under matched conditions]
  BASE --> JOIN[Join task-level results]
  CAND --> JOIN
  JOIN --> REVIEW[Review quality, effects, recovery, latency, cost]
  REVIEW --> MEETS{Meets local criteria?}
  MEETS -->|No| REVISE[Revise on development cases]
  REVISE --> FRESH[Freeze a fresh untouched held-out set]
  FRESH --> RERUN[Run baseline and candidate under matched conditions]
  RERUN --> JOIN
  MEETS -->|Yes| HUMAN[Human review and scoped next-stage decision]
  HUMAN -->|More evidence| FRESH
  HUMAN -->|Stop| RECORD[Record decision and limits]
```

Once evaluation results influence prompts or code, those exposed cases are no longer held out for the next decision. Revise on development cases and use a fresh untouched evaluation set. Passing local criteria does not establish production readiness or generalize beyond the tested tasks and conditions.
