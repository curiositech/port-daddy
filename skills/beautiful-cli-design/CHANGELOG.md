# Beautiful Cli Design — Changelog

## 2026-07-04
- Upgraded to the agentic-family standard: `provenance` moved to block-style `kind: first-party, owners: [port-daddy]` (prior recovery provenance preserved under `authorship.history` and in the history below); added `io-contract` (consumes a CLI/TUI design brief + a CLI design spec JSON, produces a design writeup + audit JSON).
- Fixed dangling `pairs-with` entries pointing at skills absent from the repo (`technical-writer`, `performance-profiling`, `data-viz-2025`); replaced with `beautiful-gui-design` and `gpui-rust-console`, both verified present, alongside the existing `web-design-expert` entry.
- Added a deterministic auditor, `scripts/cli_design_audit.mjs` (`auditCliDesign`), scoring a CLI design spec against this skill's real Quality Gates (color-only signal, `NO_COLOR`/non-TTY handling, exit codes, stderr routing, progress feedback, Unicode-safe alignment, width responsiveness, greppable logs, quiet-by-default) — fails closed, `pass = !hasCritical && score >= 75`.
- Added `schemas/cli-spec.schema.json` (draft-07), `examples/sample-input.json` (verified `pass:true`), and `examples/expected-output.md` (a color-only + ignores-`NO_COLOR` + errors-to-stdout spec verified `pass:false`, then fixed).
- Filled out the bundle: `README.md`, `agents/openai.yaml`, `templates/output-template.md`.

## 2026-04-19
- Rewrote the broken recovered description into a complete trigger-focused statement with an explicit `NOT for` clause
- Added body-level `When to Use` and `NOT for` sections plus a Mermaid decision flow for framework selection
- Tightened pairs-with metadata, removed empty runtime noise, and added fork guidance and a curated reference map

## 2026-04-17
- Normalized frontmatter into the canonical metadata-based repo shape
- Added or refreshed repo-local provenance metadata
- Recorded this automated migration for future structural upgrades

## 2026-04-17
- Recovered upgraded skill assets from `/Users/erichowens/coding/workgroup-ai/.claude/worktrees/agent-aa6fba4b/skills/beautiful-cli-design`
- Applied CTA SKILL.md overlay from `/Users/erichowens/coding/workgroup-ai/.skill-runtime-archive/cta-upgrades/beautiful-cli-design/after.md`
- Recorded CTA audit snapshot from `/Users/erichowens/coding/workgroup-ai/.skill-runtime-archive/cta-upgrades/beautiful-cli-design/audit.json`

## 2026-04-17
- Recovered upgraded skill assets from `/Users/erichowens/coding/workgroup-ai/.claude/worktrees/agent-aa6fba4b/skills/beautiful-cli-design`
- Applied CTA SKILL.md overlay from `/Users/erichowens/coding/workgroup-ai/.skill-runtime-archive/cta-upgrades/beautiful-cli-design/after.md`
- Recorded CTA audit snapshot from `/Users/erichowens/coding/workgroup-ai/.skill-runtime-archive/cta-upgrades/beautiful-cli-design/audit.json`

## 2026-04-17
- Folder affordance pass refreshed scorecard, reference index, and Mermaid companion artifacts

## 2026-04-17
- Structural bridge pass added or normalized decision, failure, example, quality-gate, and Mermaid scaffolding

## 2026-04-17
- Folder affordance pass refreshed scorecard, reference index, and Mermaid companion artifacts

## 2026-04-18
- Normalized frontmatter into the canonical metadata-based repo shape
- Added or refreshed repo-local provenance metadata
- Added or refreshed repo-local authorship metadata
- Recorded this automated migration for future structural upgrades

## 2026-04-18
- Folder affordance pass refreshed scorecard, reference index, and Mermaid companion artifacts

## 2026-04-19
- Recovered upgraded skill assets from `/Users/erichowens/coding/workgroup-ai/.claude/worktrees/agent-aa6fba4b/skills/beautiful-cli-design`
- Applied CTA SKILL.md overlay from `/Users/erichowens/coding/workgroup-ai/.skill-runtime-archive/cta-upgrades/beautiful-cli-design/after.md`
- Recorded CTA audit snapshot from `/Users/erichowens/coding/workgroup-ai/.skill-runtime-archive/cta-upgrades/beautiful-cli-design/audit.json`
