# Changelog — federated-harbor-author

All notable changes to this skill. Versioning matches the paper's
round versions (`v0.1`, `v0.2`, ...). One entry per skill version.

## v0.3 — 2026-08-31

- Corrected the scope to Volume VII and replaced obsolete output roots with the canonical research-round and method-specific formal roots.
- Replaced a machine-private voice dependency with the repository's portable expository reference.
- Moved worked examples into `references/worked-examples.md` so the entrypoint remains concise.
- Registered the skill as a chapter adapter whose claims remain subordinate to the source chapter and research manifest.

## v0.2 — 2026-05-20

### Added

- `agents/drafter.md` — section-level prose owner with per-claim
  template enforcement.
- `agents/voice-editor.md` — Erich's seven-tells voice enforcer.
- `agents/cross-paper-citation.md` — Anchor/Bonded substitution-form
  auditor; maintains `references/cross-paper-dependencies.md`.
- `references/cross-paper-dependencies.md` — running dependency table
  shared with redteam + whitehat skills.
- `references/topic-map.md` — twelve-cluster map from
  `docs/shipwright/SECURITY-BIBLIOGRAPHY.md` keyed to FH sections and
  probe/defense classes.
- `scripts/new-round.sh` — scaffolds
  `whitepaper/research/program/rounds/federated-harbor/dialogue-fh-vN-to-vN+1.{json,md}`.
- `scripts/voice-check.sh` — banned-phrase grep + em-dash density +
  ballast heuristic. Mechanical pass only.
- `scripts/probe-template.json` — JSON schema for a critical
  claim. Every drafter output uses this shape.
- `examples/section-claim-example.json` — worked example for §fh-3
  cross-harbor token acceptance.

### Voice / structural

- No changes to `SKILL.md` prose. The L3 artifacts wrap the existing
  voice; they do not replace it.

## v0.1 — 2026-05-19

### Added

- `SKILL.md` — initial draft. Voice rules, four cardinal sins,
  decision trees (figure / inline-vs-appendix / cite-vs-paraphrase),
  quality gates, educational density quotas, shibboleths.
- Prose-only; no agents, references, scripts, examples. L3 missing
  entirely.

### Known gaps (closed in v0.2)

- No agent personas — drafter / voice-editor / cross-paper-citation
  were forward-declared in §"Reference manifest" but not written.
- No `cross-paper-dependencies.md` — referenced but did not exist.
- No `voice-check.sh` — referenced but did not exist.
- No worked example of the claim template.
