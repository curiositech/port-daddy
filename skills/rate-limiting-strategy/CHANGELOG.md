# Changelog — rate-limiting-strategy

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/rate_limiting_strategy_audit.mjs`), draft-07
schema (`schemas/rate-limiting-strategy-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: the three decisions (algorithm, placement, key), algorithm comparison
table with the fixed-window boundary trap, edge-vs-origin architecture, key-tier table with
login-tuple layering, Redis Lua recipes for all four algorithms, the full 429 response
contract, distributed gotchas (cluster hash tags, failure modes), anti-patterns, and quality
gates. Grounded in the Redis tutorial, API7 guide, Upstash docs, MDN, and the IETF
RateLimit-headers draft.
