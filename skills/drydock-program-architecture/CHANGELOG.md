# Changelog

## Unreleased

- Added the source-present H1 controller-local TypeScript reducer, closed
  projection-update envelope, projection-only cursor consumer, and sealed
  golden-prefix corpus.
- Added fail-closed tests for event conflict/gaps, role collisions, incomplete
  work, aliased capacity, provider-native reservation/settlement, bounded
  envelopes, rework ceilings, atomic rejection, stream drift, digest tampering,
  and stale/offline truth.
- Bound each manager decision to the manager named by that attempt's assignment
  receipt and rejected provider/account/unit budget aliases that could multiply
  one underlying allowance.
- Clarified that the local runtime halt blocks dynamic promotion, not ordinary
  source implementation, and that Rust/Swift/HTML clients do not independently
  re-adjudicate lifecycle history.
- Added a closed hypertree-execution schema and semantic validator covering
  exact plan binding, ordered event chains, producer/reviewer/manager separation,
  deterministic checks, native-unit review reservations, and bounded rework.
- Added a bad-to-good execution fixture and one shared projection contract for
  HTML, Swift, and Rust observatory clients.
- Added the observatory architecture and test plan, including deterministic,
  low-cost independent, specialist, manager, and human review gates.

## 1.0.0 - 2026-09-14

- Added the integrated Drydock program-architecture entrypoint.
- Consolidated the lifecycle, simulation, resurrection, capacity, context, and
  operator-control corpus behind progressive-disclosure loading rules.
- Added a comprehensive Mermaid proof atlas, architecture decision matrix,
  staged delivery gates, executable hypertree fixture, schema, and semantic
  validator.
- Preserved the operator halt as a non-negotiable boundary: static design is not
  launch authority.
