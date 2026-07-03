# Changelog

All notable changes to this skill will be documented here.

## [1.1.0] - 2026-07-03

### Added
- `metadata.provenance`, `metadata.pairs-with` (structured), and
  `metadata.io-contract` in frontmatter, bringing the skill to the
  agentic-family governance standard.
- `scripts/appeal_audit.mjs` — a NET-NEW deterministic auditor exporting
  `auditDesirability(spec)`. Complements (does not replace) the existing
  `scripts/appeal_scorer.py`: the Python script interactively drafts an
  analysis from a live URL; the new `.mjs` re-checks an already-scored,
  structured JSON spec against this skill's own gates (Triangle vertex <5,
  failed 5-Second Test, trust-ladder violation, identity mismatch,
  feature-soup headline, screenshot hero) with no keyword/text matching.
- `schemas/appeal-spec.schema.json` (draft-07) describing the auditor's
  input shape.
- `examples/sample-input.json` (verified `pass: true`) and an expanded
  `examples/expected-output.md` with a verified passing scorecard and a
  contrasting failing spec.
- `README.md`, `agents/openai.yaml`, `templates/output-template.md`.

### Changed
- Restructured top-level `category`/`tags`/`pairs-with` into `metadata.*`.
- Dropped `ux-friction-analyzer`, `competitive-cartographer`, and
  `web-design-expert` from `metadata.pairs-with` (no `skills/<name>/`
  directory present in this worktree at upgrade time — re-add
  `ux-friction-analyzer` and `web-design-expert` — both imported in the same
  batch and now present in-repo — plus `agentic-coding-product-research` and
  `agentic-coding-ux-designer`, all verified. The `description` field's NOT-clause and the
  "Integration with ux-friction-analyzer" prose section are unchanged per
  the upgrade spec (name/description preserved as-is).
- `allowed-tools` gained `Bash` to run the new script.

## [1.0.0] - 2026-01-15

### Added
- Initial skill release
- Core frameworks: Desirability Triangle, 5-Second Test
- SKILL.md with activation patterns and anti-patterns
- `scripts/appeal_scorer.py` for structured analysis
- Reference documents:
  - `references/scoring-templates.md` - Full assessment templates
  - `references/trust-ladder.md` - Trust building stages deep dive
  - `references/identity-signals.md` - Visual/verbal identity catalog
  - `references/objection-catalog.md` - Universal objections and counters

### Integrations
- Pairs with `ux-friction-analyzer` (appeal + friction = complete picture)
- Pairs with `competitive-cartographer` (positioning against alternatives)
- Pairs with `web-design-expert` (implementing recommendations)

### Design Decisions
- Kept SKILL.md under 300 lines for fast activation
- Moved detailed templates to `/references` for progressive disclosure
- Encoded 4 shibboleths as anti-patterns:
  1. Feature Soup Headline
  2. Screenshot Hero
  3. Trust Ladder Violation
  4. Identity Mismatch
- Python scoring script provides structure without requiring external dependencies
