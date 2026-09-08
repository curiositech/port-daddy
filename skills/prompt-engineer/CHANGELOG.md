# Prompt Engineer — Changelog

## v1.1.0 (2026-07-04)

- Imported from the global jury_rig skill catalog (SKILL.md only) and upgraded to the port-daddy agentic-family standard.
- Added `license: Apache-2.0`, block-style `metadata.provenance` (first-party/port-daddy), verified `metadata.pairs-with` (`agentic-app-architecture`, `llm-router`, `output-contract-enforcer` — dropped `ai-engineer` and `automatic-stateful-prompt-improver`, neither present in this repo), and `metadata.io-contract`.
- Added a deterministic structural auditor: `scripts/prompt_audit.mjs` exporting `auditPrompt(spec)`, plus `schemas/prompt-spec.schema.json`, `examples/sample-input.json`, and `examples/expected-output.md`.
- Expanded the 4 existing anti-patterns into Novice/Expert/Detection form and added 5 new ones (missing output contract, undelimited untrusted input, no eval criteria, no refusal/edge behavior, no guardrails) so every scorer finding is taught in SKILL.md.
- Added `references/injection-and-safety.md` and `references/eval-criteria-patterns.md`, `README.md`, `agents/openai.yaml`, `templates/output-template.md`.
- Fixed dangling body references to skills absent from this repo (`ai-engineer`, `automatic-stateful-prompt-improver`, `agent-creator` in the closing "Use with" line) — rephrased without asserting non-existent in-repo skill links.

## v1.0.0 (upstream, pre-import)

- Initial skill creation in the jury_rig global skill catalog: CLEAR framework, optimization techniques table, prompt patterns, common issues/fixes, and 4 anti-patterns.
