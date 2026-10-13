# A configurable family, not a conflict-free universal mechanism

## What the report actually supplies

TR 94-14 presents independently parameterizable initial mechanisms, with a common substrate that must arbitrate their constraints (§§3.1–3.6). Their initial mappings are narrow:

| ID | Relationship or information fact | Action | Limit |
| --- | --- | --- | --- |
| M1 | private related task structure | non-local viewpoint sharing | domain-specific relationship detection; none/some/all policy |
| M2 | a result is needed elsewhere | result communication | minimal/TG/all policies have different audiences |
| M3 | exact duplicate method under MAX | select one simultaneous candidate | not general allocation or load balancing |
| M4 | hard predecessor enables successor quality | estimated low-negotiability commitment | predecessor direction only |
| M5 | positive facilitation | estimated high-negotiability intermediate commitment | hinders is not handled |

A common substrate can surface or process schedule/commitment conflicts. The report does not say its mechanisms are conflict-free, that one mapping exists for every relationship, or that a mechanism always helps merely because a related feature is present.

## Source experiment scope

The technical-report experiments use generated abstract TÆMS episodes and the Design-to-Time local scheduler (§4). They vary configuration and task structure; observed differences are conditional on those simulations. The centralized comparison has complete global task information and omitted the cost of acquiring it. It is a reference comparison, not a deployable universal baseline. Do not turn the reported settings, percentages, or categorical negotiability heuristic into generic deployment thresholds.

## Constructed selection exercise

A knows a private cross-agent relationship: choose M1 `some` only after its domain detector finds it. A then owes B a result: independently choose M2 `minimal`, `TG`, or `all` according to the declared recipient need. If two agents instead own an exact equivalent MAX method, M3 can select one. If the relation hinders, return `UNSUPPORTED_EXTENSION` and specify separate resource/conflict semantics. This construction tests that the source mappings are not collapsed.

## Overhead remains measured, not fabricated

The report distinguishes communication/information-gathering executions, local-scheduler calls, and mechanism computation (§4.1). Its Table 2 symbolic coefficients were not legible in the inspected extraction; no inherited O-expression, additive budget, message count, or latency multiplication is reproduced as verified. Measure the three categories alongside quality, method execution, deadlines, and termination time for the specific environment.
