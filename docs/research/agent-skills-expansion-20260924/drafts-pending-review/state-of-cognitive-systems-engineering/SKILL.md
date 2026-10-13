---
name: state-of-cognitive-systems-engineering
description: Analyze human-automation work as situated activity, then test recovery and observability on representative scenarios.
category: Research & Academic
tags: [cognitive-systems-engineering, human-factors, automation, task-analysis, recovery]
---

# Cognitive systems engineering for agent operations

CSE treats people, automation, representations, environment, and control authority as a work system. It is not a theorem that fixed pipelines fail or that interviews reproduce expertise.

```mermaid
flowchart LR
  C[Situation cues] --> H[Working hypothesis]
  H --> E[Expected trajectory]
  E --> A[Permitted action]
  A --> O[Observed trajectory]
  O --> M{Mismatch?}
  M -- no --> C
  M -- yes --> R[Reclassify, seek evidence, or escalate]
  R --> C
```

```mermaid
flowchart TB
  U[Operator] --> R[Shared representation]
  A[Automation or agent] --> R
  ENV[Environment] --> R
  R --> D[Decision and authority boundary]
  D --> X[Effect]
  X --> F[Feedback and recovery cue]
  F --> R
```

For each critical decision record cues, competing hypotheses, expected evolution, permitted action, authority, observable effect, and escalation. Test one familiar scenario and one novel disturbance with similar aggregate metrics. Measure cue coverage and safe recovery; a timeout, summary, or success does not prove hidden cause.

See [recognition-primed decisions](references/recognition-primed-decision-making-for-agents.md), [automation surprises](references/automation-surprises-and-coordination-failure.md), and [work-as-done](references/true-work-vs-prescribed-work-gap.md). The 2002 IEEE record was abstract-only; the detailed workflow is an engineering proposal.