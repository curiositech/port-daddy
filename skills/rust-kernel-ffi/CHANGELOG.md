# Rust Kernel FFI — Changelog

## v1.1.0 (2026-07-03)

- Imported from the global skill library into the repo (`skills/rust-kernel-ffi/`).
- Upgraded to the agentic-family bundle standard: `metadata.provenance`,
  `metadata.pairs-with`, and `metadata.io-contract` added to frontmatter.
- Added deterministic `scripts/ffi_safety_audit.mjs` (`auditFfiExport`) plus
  `schemas/ffi-plan.schema.json`, `examples/sample-input.json`, and
  `examples/expected-output.md`.
- Added `README.md`, `agents/openai.yaml`, `templates/output-template.md`.
- Fixed two dangling references to a nonexistent `macaroon-capability-credentials`
  skill (dropped; not present under `skills/`).

## v1.0.0

- Initial skill creation (global, SKILL.md-only): cdylib⇄koffi FFI decision
  points, worked example, failure-mode table, quality gates.
