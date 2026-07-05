# Changelog — python-asyncio-pitfalls

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/python_asyncio_pitfalls_audit.mjs`), draft-07
schema (`schemas/python-asyncio-pitfalls-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: the asyncio trap catalog — blocking-call detection and debug mode,
TaskGroup vs gather semantics, sync offload (to_thread / run_in_executor), cancellation
re-raise discipline, ContextVars, bounded queues, timeouts, FastAPI/aiohttp specifics,
anti-patterns, and quality gates.
