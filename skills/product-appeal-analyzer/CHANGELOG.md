# Changelog

All notable changes to this skill will be documented here.

## v1.2.0 - 2026-09-15

Extends appeal analysis from landing pages to **technical documents and
scientific books**, and to wireframes.

### Added
- `references/technical-document-appeal.md` — the Desirability Triangle grows a
  fourth vertex, **Return on Effort** (time to first insight, cost
  transparency, payoff visibility), because a monograph's price is forty hours
  rather than thirty seconds. Includes the **30-Second Shelf Test** (the
  technical analogue of the 5-Second Test), the random-page test, the technical
  trust ladder, a trust-signal/cheap-fake table, the figures-are-the-hero-image
  argument, and each landing-page anti-pattern mapped to its technical
  analogue.
- `references/surface-appeal-adapters.md` — wireframes, prototypes, and decks,
  under one rule: **a wireframe can fail appeal but cannot pass it.** Which
  vertices are assessable, and the discipline of scoring `null` rather than
  guessing.
- **Reader-map persona matching**: `technicalDocument.readerMap` matches each
  scored persona to the route the document prints for it and walks that chain —
  reporting personas with no route, routes addressed to nobody, routes that
  reward a different reader than they name, and routes that pay off after their
  reader's budget runs out.
- `scripts/appeal_audit.mjs` gains two optional blocks, `technicalDocument` and
  `surfer`, plus a `surfaceKind` honesty guard for wireframes. Both are absent
  for an ordinary landing page and the existing behaviour is unchanged.
- `examples/technical-book-spec.json` — a monograph exercising every new gate.

### Changed
- The integration section now states the mechanism rather than the slogan:
  appeal and friction are two readouts of one random-surfer chain — friction is
  the terms that raise the abandon hazard, appeal is the terms that lower it.
  Consequence: **appeal cannot be fixed downstream of where people stop.**

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
