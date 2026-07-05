# Changelog — distributed-tracing-w3c-context

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with
frontmatter; added deterministic audit helper
(`scripts/trace_propagation_audit.mjs`), draft-07 schema
(`schemas/trace-propagation-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates. Appended a "NOT for"
exclusion clause to the frontmatter description.

## [0.1.0]

Initial authoring: byte-precise traceparent/tracestate formats with verbatim
W3C MUSTs, composite-propagator migration off B3/vendor headers, head vs tail
sampling recipes, sqlcommenter HTTP->SQL propagation, anti-patterns, and
quality-gate checklist.
