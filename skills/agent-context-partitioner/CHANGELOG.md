# Changelog

## [2.0.2] - 2026-09-17

### Fixed

- Bind every transferred item to one disposition-declared source target and reject disclosure edges forged from a different admitted target.
- Added an unrelated-source mutation so destination-only joins cannot pass as transfer authorization.

## [2.0.1] - 2026-09-17

### Fixed

- Require every `TRANSFERRED` disposition to join exactly to typed source/destination evidence with a non-empty disclosure proof, and reject orphan, duplicate, self, or mismatched transfer edges.
- Added valid-transfer and missing/mismatched-evidence mutations.

## [2.0.0] - 2026-09-16

### Changed

- Replaced pressure-driven spawning and heuristic K selection with proposal-only, trust-typed partitioning.
- Replaced untyped memory dumps and prose templates with a closed Context IR proposal and coverage proof.
- Added hard authority/disclosure/causal/capability/capacity filters before optimization.
- Added immutable retrieval `spaceId`, deterministic baseline ordering, and adversarial validation.
- Separated `PrepareContinuation` from lifecycle-owned `AdmitSuccessor`.

### Removed

- Spawn recommendations, runtime pressure estimation, automatic full-copy fallback, and universal optimality claims.
- Legacy Python algorithms, stale examples, and prompt templates.
