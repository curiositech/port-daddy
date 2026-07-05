# Changelog — go-pprof-profiling

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/go_pprof_profiling_audit.mjs`), draft-07 schema
(`schemas/go-pprof-profiling-plan.schema.json`), verified sample input
(`examples/sample-input.json`); verified the existing Quality Gates checklist.

## [0.1.0]

Initial authoring: net/http/pprof exposure, CPU/heap (inuse vs alloc)/goroutine/block/mutex
profiles, runtime/trace, escape analysis, sync.Pool, GOGC/GOMEMLIMIT tuning, and six
anti-patterns.
