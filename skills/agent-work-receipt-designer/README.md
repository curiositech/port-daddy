# Agent Work Receipt Designer

Design the normalized, machine-readable receipt that answers "what changed,
why, by whom, with what validation" for any AI-coding-agent task.

Use this skill when you need a cross-tool receipt schema, when you are
normalizing Claude Code/Codex/Cursor/Aider/CI logs into one evidence shape, or
when you need to gate merges on artifact-backed proof instead of an agent's
self-reported "tests pass."

## Quick Start

1. Read `SKILL.md`.
2. Load `references/field-model.md` for the field-by-field meaning and the
   reviewer-first ordering rule.
3. Load `references/backend-normalization.md` for extracting evidence from a
   specific backend's raw logs, and for signing/attributability guidance.
4. Fill `templates/output-template.md` for the task at hand, or write a
   receipt matching `schemas/work-receipt.schema.json` directly.
5. Run `node scripts/receipt_lint.mjs --input receipt.json`.

A receipt that scores `pass: true` should let a reviewer decide fast without
re-deriving what happened. If it doesn't, fix the receipt, not the scorer.
