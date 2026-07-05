# Agentic App Architecture

Decide the shape of an agentic LLM application — interaction transparency,
state/history/memory, context & caching economics, capability integration,
and execution substrate & side effects — before implementation begins.

Use this skill when architecting a new coding-agent console or a non-coding
agent (research, document, image, or data-artifact producer), or when
auditing an existing agentic app for hidden reasoning, transcript-only state,
an unbounded context strategy, unsafe secret custody, or ungated side
effects.

## Quick Start

1. Read `SKILL.md`.
2. Load `references/interaction-surface-and-transparency.md` for the
   transparency axis, `references/state-memory-and-context.md` for state and
   caching economics, and `references/capabilities-and-execution-substrate.md`
   for tools/skills/MCP/secrets and the coding vs. non-coding substrate.
3. Fill `templates/output-template.md` for the app at hand, or write a spec
   matching `schemas/agentic-app-spec.schema.json` directly.
4. Run `node scripts/agentic_app_audit.mjs --input spec.json`.

An architecture that scores `pass: true` should mean a reviewer can trust the
app's reasoning, resume/fork its state, bound its cost, trust its secret
handling, and gate its side effects — without reading the implementation.
