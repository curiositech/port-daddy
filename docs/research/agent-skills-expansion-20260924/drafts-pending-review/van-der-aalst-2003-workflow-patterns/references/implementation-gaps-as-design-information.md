# Implementation gaps are hypotheses to test

Classify each required pattern in a named engine/version as `NATIVE`, `ENCODED`,
`UNSUPPORTED`, or `UNKNOWN`. A static DAG representation has no back-edge, but an
engine may model iterative work through versioned attempts, nested workflows, or an
external state machine. Therefore infer no engine-wide inability from the diagram form.

For each classification, retain the smallest trace, configuration, and acceptance rule.
For a discriminator, test concurrent arrivals, late arrivals, reset, and an optional
separate cancellation protocol. For a synchronizing merge, test inactive branches,
activated branches, and duplicate completion. This turns an apparent gap into a
reproducible design decision.

## Four different gap diagnoses

| Evidence | Narrow diagnosis | Next step |
|---|---|---|
| A specified finite acyclic representation disallows back edges | That representation cannot contain a directed cycle | Examine whether the surrounding engine provides a separately specified iteration mechanism |
| Required state exists only in custom code | Explicit encoding outside a native primitive | Review ownership, invariants, observability and maintenance cost |
| A long composition expresses the required trace | Encoding may be awkward but capable | Measure complexity against a simpler implementation without an arbitrary cutoff |
| One admitted event order violates the contract | Counterexample to that configuration | Preserve the trace and repair or reject the implementation |

Missing documentation or an unrun test is `UNKNOWN`, not a mathematical impossibility.
A failing fixture disproves that implementation's claim for the fixture; it does not
prove no encoding can work in the engine.

## Minimal discriminator counterexample

Expected: first arrival B enables D once, then C is absorbed, then the cycle resets.
Observed: B enables D; C also enables D. Preserve cycle ID, membership `{B,C}`, input
order and both successor activation IDs. Investigate whether both arrivals read a
not-yet-fired flag before either records the transition, or whether the cycle IDs were
mixed. The observation alone does not distinguish those hypotheses. Retest the repaired
arbitration with reversed order, concurrent arrivals and repeated observations.

## Deliberate constraints

A system may intentionally omit unbounded iteration or particular cancellation scopes.
State that boundary and an escalation/alternative rather than promising every pattern.
Do not infer that acyclicity supplies activity termination, that a missing primitive
invalidates the entire architecture, or that an encoded pattern is necessarily unsafe.
