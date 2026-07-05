# Changelog — opentelemetry-instrumentation

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/opentelemetry_instrumentation_audit.mjs`), draft-07
schema (`schemas/opentelemetry-instrumentation-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: Node SDK setup with load-order rules (CJS -r vs ESM --import), manual span
lifecycle, the resource attributes that matter, head/tail sampling, exporter comparison with
BatchSpanProcessor queue limits, context propagation across worker_threads and detached
promises, browser fetch instrumentation with CORS allowlist, metric instrument selection,
anti-pattern catalog, quality gates.
