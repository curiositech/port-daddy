# HTA-to-specialized-analysis handoff

```mermaid
flowchart TD
  A[Reviewed HTA record: goals, plans, evidence, terminal reasons] --> B{Declared downstream question and complete input?}
  B -- no --> C[Record missing evidence or plan detail; return to HTA review]
  B -- yes --> D[Select a separate specialist method]
  D --> E[Apply its taxonomy, assumptions, and validation]
  E --> F{Method-specific validation supports a result?}
  F -- no --> G[Report no validated downstream result]
  F -- yes --> H[Report source-bounded specialist finding]
  A -. scope limit .-> I[HTA alone does not measure, allocate, or certify]
```

Stanton (2006) §§4–5 discusses these applications. The arrow is a handoff, not evidence that HTA alone completes an error, interface, workload, team, or allocation analysis.
