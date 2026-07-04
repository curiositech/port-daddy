# Agent Identity, Continuity & Reputation — Changelog

## v1.1.0 (2026-07-03)

- Upgraded to the agentic-family bundle standard: added `license`,
  `allowed-tools`, and `metadata.{category, tags, provenance, pairs-with,
  io-contract}` frontmatter.
- Added deterministic `scripts/reputation_soundness_audit.mjs` exporting
  `auditReputationDesign(plan)`, with `schemas/reputation-plan.schema.json`
  (draft-07) and a passing `examples/sample-input.json`.
- Added `README.md`, `agents/openai.yaml`, `templates/output-template.md`,
  `examples/expected-output.md`.
- Split the Failure Modes table out to
  `references/failure-modes-and-defenses.md` to keep `SKILL.md` within the
  family's line-count target, and added a "so what" note per row.
- No changes to the thesis, decision points, quality gates, worked example,
  future-work designs, or References list — content preserved as-is.

## v1.0.0 (2026-06-05)

- Initial skill creation: identity→continuity→reputation→market thesis,
  Locke/Parfit grounding, five ordered decision points, failure-mode table,
  quality gates, Port Daddy worked example, references list.
