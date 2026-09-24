# E02 — Choose analysis from the joint design

```mermaid
flowchart TD
  Goal[State estimand and primary outcome] --> Unit[Identify assignment units and dependence]
  Unit --> Joint[Record pairing and clustering together]
  Joint --> Scale[Identify outcome scale, sparsity, and missingness]
  Scale --> Check{Candidate analysis has defensible assumptions?}
  Check -->|Yes| Method[Use a design-compatible model or randomization analysis]
  Check -->|No| Limit[Show per-unit outcomes and narrow the claim]
  Method --> Report[Report effect, uncertainty, assumptions, and sensitivity]
  Limit --> Report
```

Pairing and clustering can coexist. Sparse counts do not automatically make an arbitrary exact or permutation test valid; its assignment and distributional assumptions still matter.
