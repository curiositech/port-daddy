# Swarm Invocation Designer

Design guidance for magic-feeling multi-agent invocation, typed coordination contracts, and fast agent-to-agent communication.

Use this skill when a product surface needs to summon, supervise, stop, or audit a swarm of coding agents.

## Quick Start

1. Read `SKILL.md`.
2. Load `references/invocation-patterns.md` for operator flows and role patterns.
3. Load `references/fast-agent-bus.md` for hot-path versus durable-path guidance.
4. Describe channels and message sizes in a latency plan.
5. Run `node scripts/latency_budget.mjs --input latency-plan.json`.

Keep hot chatter small and fast. Put transcripts, proofs, and settlement into durable storage.
