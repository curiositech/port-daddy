# Agent Issue Tracker Workflow

Discipline an AI agent needs to work a Jira/Linear/GitHub Issues tracker as
the shared source of truth: pull the right item, search before creating,
write actionable items, keep status honest, and link work to items.

Use this skill when you need an agent to pick up tracker work, file a new
item, update status, or close an item — and you want that behavior audited
against real discipline instead of trusted on the agent's word.

## Quick Start

1. Read `SKILL.md`.
2. Load `references/tracker-discipline.md` for the core loop: reading the
   queue, actionable-item structure, honest status semantics, and capturing
   spawned work instead of scope-creeping.
3. Load `references/tracker-integration-patterns.md` for per-tracker linking
   syntax (GitHub Issues, Linear, Jira) and this repo's `roadmap-link` gate.
4. Fill `templates/output-template.md` for the items handled in a session, or
   write a plan matching `schemas/issue-plan.schema.json` directly.
5. Run `node scripts/issue_hygiene.mjs --input plan.json`.

A plan that scores `pass: true` means every active item was searched,
actionable, linked to its diff, and — if `done` — backed by validated
evidence. If it doesn't, fix the tracker discipline, not the audit.
