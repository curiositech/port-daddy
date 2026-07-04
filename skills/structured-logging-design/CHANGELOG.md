# Changelog — structured-logging-design

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter; added deterministic audit helper (`scripts/structured_logging_audit.mjs`), draft-07 schema, verified sample input; added Quality Gates.

## [0.1.0]

Initial authoring: single-file `SKILL.md` covering the minimum log schema, precise level usage, trace_id correlation (W3C traceparent), logger-level PII redaction, sampling and cardinality-aware cost control, pino/slog/structlog configuration, hot + cold routing, six anti-patterns, and the logging-bill-spike worked example.
