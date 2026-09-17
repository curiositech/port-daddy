# Changelog

## 1.0.1 — 2026-09-17

- Bind every bypass test to a unique, identity-disjoint `VERIFIER_RUNNER` witness.
- Reject dangling mediation witnesses and require externally witnessed coverage to use a control-disjoint host or provider witness.
- Add duplicate-test, missing-test-witness, and dangling-inventory-witness mutations.

## 1.0.0 — 2026-09-16

Breaking replacement of the imported 0.1.0 bundle.

- Recast the skill as contract and evidence audit guidance, not a deployed
  reference monitor.
- Added a six-rung claim ladder separating schemas, verifier behavior,
  authority, pre-effect binding, mediation inventory, and witnessed mediation.
- Made approval, adjudication, permit redemption, execution, and reconciliation
  separate roles.
- Removed the execute-after-deny corrective mode.
- Removed fabricated or misattributed FormalJudge, Lean, Cedar, FORGE,
  AgentSpec, and AgentBC claims and all inherited performance targets.
- Added closed schemas, semantic validation, mutation tests, activation tests,
  source ledger, repository-status receipt, threat model, benchmark protocol,
  and decision diagrams.
- Deleted phantom references and the stale self-scorecard.

Compatibility: deliberately none. No legacy complete-mediation or corrective-
deny mode remains.
