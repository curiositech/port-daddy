# Color Contrast Auditor — Changelog

## v1.1.0 (2026-07-04)

- Imported from the global jury_rig skill catalog into the repo.
- Upgraded frontmatter to the port-daddy agentic-family standard: block-style `provenance`, `pairs-with` (verified against skills present in this repo), and an `io-contract`.
- Added `scripts/contrast_audit.mjs`: a deterministic, pure-stdlib auditor that computes real WCAG relative-luminance contrast ratios and fails closed on `contrast-below-threshold`, `invalid-color`, and `color-only-signal`.
- Added `schemas/contrast-spec.schema.json`, `examples/sample-input.json` (all-passing), and `examples/expected-output.md` (a subtle near-miss ratio, an invalid hex, and a color-only signal audited, fixed, and re-audited to `pass:true`).
- Added `README.md`, `agents/openai.yaml`, `templates/output-template.md`.
- Added three Novice/Expert/Detection anti-patterns wired to the scorer's finding ids.

## v1.0.0 (imported, undated)

- Original skill content: WCAG 2.1 contrast requirements, contrast ratio formula, common failing patterns, audit methodology, color blindness considerations, and `references/safe-color-pairs.md`.
