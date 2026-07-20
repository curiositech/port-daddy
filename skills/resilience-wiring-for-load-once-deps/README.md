# Resilience Wiring for Load-Once Dependencies

The load-once-dependency delta on top of the general resilience canon in
`circuit-breakers-and-retries`. Covers only what that canon does not: wiring a
circuit breaker + full-jitter backoff around a MEMOIZED lazily-loaded resource
(native lib, ML model, connection pool, embedder) so a permanent failure is not
cached as a rejected promise and re-awaited every tick (the 313 GB storm).

## Structure

```
resilience-wiring-for-load-once-deps/
├── SKILL.md                          # Core instructions (<200 lines)
├── CHANGELOG.md                      # Version history
├── README.md                         # This file
├── references/
│   ├── gated-loader.md               # createGatedLoader implementation (get/tryGet/coalescing)
│   └── incident-and-detection.md     # The 313 GB storm anatomy + audit grep playbook
└── scripts/
    └── herd_sim.py                   # Runnable stdlib demo: storm vs gated-loader + breaker trace
```

## Quick Start

1. Read SKILL.md; for the general breaker/backoff canon it defers to, read `circuit-breakers-and-retries`.
2. `python3 scripts/herd_sim.py` to see the storm collapse (7182 ticks → governed handful of logs).
3. Validate: `python3 <skill-architect>/scripts/validate_skill.py .`
