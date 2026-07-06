# Agentic Coding UX Designer

Design guidance for low-friction, inspectable, recoverable AI coding assistant flows.

Use this skill when shaping Cursor/Claude Code/Codex/Windsurf-style workflows, FleetBar/Fleet Control Center agent surfaces, review swarms, or background task handoffs.

## Quick Start

1. Read `SKILL.md`.
2. Load `references/magic-progressions.md` for comeback loops.
3. Load `references/design-rules.md` for concrete UI controls and proof requirements.
4. Describe the proposed flow as JSON.
5. Run `node scripts/magic_progression_score.mjs --input flow.json`.

Do not ship a flow without visible progress, rollback, human gates for risky actions, and durable receipts.
