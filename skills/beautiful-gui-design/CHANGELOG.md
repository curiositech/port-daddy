# Beautiful GUI Design — Changelog

## v1.1.0 (2026-07-04)

- Upgraded to the agentic-family standard: `license`, block-style `provenance`
  (first-party/port-daddy), `pairs-with` (gpui-rust-console, rust-gpui-motion,
  gpui-shaders, web-design-expert), and an `io-contract`.
- Added a deterministic auditor `scripts/gui_design_audit.mjs` (`auditGuiDesign`) mapping
  the skill's real Quality Gates — contrast, readable type, semantic tokens, light/dark,
  8pt/4pt spacing, a disciplined type system, touch targets, interactive states — to a
  runnable, fail-closed check.
- Added `schemas/gui-spec.schema.json`, `examples/sample-input.json` (passing spec), and
  `examples/expected-output.md` (a failing spec audited, then the fix walkthrough).
- Added `README.md`, `agents/openai.yaml`, and `templates/output-template.md`.
- Wired existing anti-pattern "Detection rule" lines to the new script's finding ids, and
  added two anti-patterns the auditor now covers but the prose previously did not: "Cramped
  Touch Targets" and "Design-by-Committee Type System".

## v1.0.0 (unreleased prior)

- Initial skill creation: decision tree, Visual System Rules, seven anti-patterns, a worked
  button example, Quality Gates checklist, fork guidance, and six `references/` files
  (layout/spacing, color/theming, typography, motion, accessibility, component systems &
  platform idioms).
