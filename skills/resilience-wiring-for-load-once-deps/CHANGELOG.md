# Resilience Wiring for Load-Once Dependencies — Changelog

## v1.0.0 (2026-07-20)

- Initial skill creation, scoped as the load-once-dependency DELTA on top of the
  general `circuit-breakers-and-retries` canon (no duplication of jitter/budget/
  breaker-math tables — cross-linked instead).
- Encodes the poison-pill memoized-promise anti-pattern (getEmbedder → 7,182
  re-awaits → 313 GB storm) and the gated-loader fix (only success memoized,
  governed load-failure log, coalesced in-flight load).
- Encodes the "primitive exists but is dead code" shibboleth (tests-only
  resilience util = zero coverage; wire it or delete it).
- OPTIONAL (tryGet→null) vs REQUIRED (get→throw) load-shape decision.
- Runnable stdlib demo `scripts/herd_sim.py` (storm vs gated-loader + breaker trace).
