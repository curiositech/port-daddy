# Changelog — redis-patterns-expert

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter; added deterministic audit helper (`scripts/redis_patterns_audit.mjs`), draft-07 schema, verified sample input; added Quality Gates.

## [0.1.0]

Initial authoring: single-file `SKILL.md` covering caching strategies (cache-aside, stale-while-revalidate, single-flight), distributed locks with ownership tokens, sliding-window rate limiting in Lua, sorted-set leaderboards, Streams + consumer groups, pub/sub, eviction policies, and the KEYS/DEL/SET-then-EXPIRE anti-patterns.
