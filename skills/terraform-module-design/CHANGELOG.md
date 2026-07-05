# Changelog — terraform-module-design

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter; added deterministic audit helper (`scripts/terraform_module_audit.mjs`), draft-07 schema, verified sample input; added Quality Gates.

## [0.1.0]

Initial authoring: single-file `SKILL.md` covering module structure and variable validation, outputs as the public API, tag-pinned versioning, count vs for_each, lifecycle blocks, remote state with locking, moved/import blocks for refactoring without recreate, drift detection, OIDC to cloud providers, tagging strategy, and six anti-patterns including plan-apply-pray.
