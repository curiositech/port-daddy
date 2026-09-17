# Changelog

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
