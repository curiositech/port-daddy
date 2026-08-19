# Changelog — readme-craft

## 0.1.0 — 2026-08-18

Initial release.

- `SKILL.md` — the ten-second/two-minute gate framing, the identity interview, section
  grammar, the length budget, show-don't-assert, voice rules, and the verification tiers.
  Five anti-patterns in Novice/Expert/Timeline form.
- `references/section-grammar.md` — per-section contract: must contain, must not contain,
  and the tell that it has gone wrong.
- `references/exemplars.md` — ink, VHS, uv, and ripgrep, with the one technique each
  demonstrates and what not to copy from them.
- `references/voice-and-style.md` — the Diátaxis mapping for README versus `docs/`, the
  Google style-guide subset that matters here, and the unverifiable-adjective blocklist.
- `references/verification.md` — freshness gate versus accuracy gate, the three
  verification tiers, fence extraction rules, and CI wiring.
- `scripts/extract-examples.mjs` — delimiter-tracking fence parser with provenance and
  tier declaration. Exported as a library so accuracy gates import it instead of
  re-implementing it.
- `scripts/readme-scorecard.mjs` — project-agnostic rubric scorer. Errors block, warnings
  inform.
- `agents/readme-steward.md` — the upkeep subagent, with the constraints that stop it
  from satisfying a gate by deleting the failing example.
- `examples/before-after.md` — worked rewrite of a 1,046-line front door down to ~330.
