# Changelog — federated-harbor-redteam

Versioning matches the paper's round versions. One entry per skill
version.

## v0.3 — 2026-08-31

- Corrected the scope to Volume VII and routed planned artifacts to method-specific formal, simulation, and round directories.
- Marked bundled dialogue as synthetic historical fixture material rather than executed evidence.
- Moved the nine detailed probe categories into `references/probe-categories.md` for progressive disclosure.
- Replaced stale and machine-private dependencies with declared peer-skill references.

## v0.2 — 2026-05-20

### Added

- `agents/fh-redteam-trust.md` — trust transitivity, pact composition,
  WoT collusion.
- `agents/fh-redteam-tokens.md` — cross-harbor token forgery, epoch-
  rewind, splice, equivocation between tree-heads.
- `agents/fh-redteam-revocation.md` — federated revocation under
  bounded partition, equivocating announcements, replenishment race.
- `agents/fh-redteam-econ.md` — cross-domain settlement, bond-pool
  draining, cold-start gaming, operator Sybil, Pareto cross-harbor.
- `agents/fh-proof-gap-auditor.md` — cross-cutting scanner for
  missing `MECHANIZATION:`, dangling paths, stale placeholders,
  broken cross-paper cites.
- `references/cross-paper-dependencies.md` — running dependency
  table from the redteam's view (shared content, redteam-side
  reading guide). Three rows marked `UNRESOLVED — prime probe target`.
- `references/topic-map.md` — twelve clusters keyed to probe class +
  persona owner. 1:1 index-match enforced against the whitehat skill.
- `scripts/new-round.sh` — scaffolds dialogue artifact + redteam
  target list.
- `scripts/probe-template.json` — JSON schema for a single probe.
- `scripts/verify-probe.sh` — sanity-checks a probe JSON before
  commit (required fields, §fh-N section key, persona/class
  consistency, observable/impact ≥ 20 chars, econ-class requires
  metric).
- `scripts/env.sh` — federation env, inherits redteam-review env.
- `scripts/run-fh-redteam.sh` — pd-spawn orchestrator for the five
  personas under round N.
- `examples/dialogue-fh-v0.1-to-v0.2.example.json` — worked example
  of a complete round (three closed smells, two carry-overs, two
  pinned placeholders).
- `examples/probe-trust-example.json` — worked example of a single
  probe entry against §fh-3 trust transitivity.

### Voice / structural

- No changes to `SKILL.md` prose.

## v0.1 — 2026-05-19

### Added

- `SKILL.md` — initial draft. Persona table, nine probe categories
  (each with falsifiable form + artifact obligation + owner),
  proof-gap auditor, comms protocol (inherits redteam-review),
  round runbook, anti-patterns, shibboleths.
- Prose-only; no agents, references, scripts, examples. The
  Reference manifest at the bottom of SKILL.md was forward-declared
  but unrealized.

### Known gaps (closed in v0.2)

- No persona files. The five personas existed only as table rows in
  SKILL.md.
- No probe templates. Probe shapes existed in prose but no schema.
- No scripts. No way to scaffold a round or verify a probe.
- No examples. No dialogue artifact at the canonical shape.
- No cross-paper-dependencies table.
