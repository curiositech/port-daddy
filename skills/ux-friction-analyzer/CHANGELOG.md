# UX Friction Analyzer — Changelog

## v1.1.0 (2026-07-03)

- Upgraded to the agentic-family bundle standard: `metadata.provenance`,
  `metadata.pairs-with`, and `metadata.io-contract` added to frontmatter.
- Added deterministic `scripts/friction_audit.mjs` (`auditFrictionFlow`)
  covering all 5 failure modes plus the mobile/touch/feedback quality gates,
  with `schemas/flow-audit.schema.json` and a verified `examples/sample-input.json`.
- Added `README.md`, `agents/openai.yaml`, `templates/output-template.md`,
  and `examples/expected-output.md`.
- Split the two worked examples into `references/worked-examples.md` and the
  full Quality Gates checklist into `references/quality-gates.md` to keep
  `SKILL.md` focused on the decision matrix, decision tree, and failure
  modes used on every audit.

## v1.0.0

- Initial skill creation (SKILL.md only): cognitive-load/ADHD decision
  matrix, primary decision tree, friction-vs-feature trade-offs, 5 failure
  modes, two worked examples, quality gates, NOT-FOR boundaries.
