# Changelog — federated-harbor-whitehat

Versioning matches the paper's round versions.

## v0.3 — 2026-08-31

- Routed planned proof, model, simulation, and research-round artifacts to their canonical method-specific directories.
- Marked bundled dialogue and defense examples as synthetic historical fixtures unless an execution receipt proves otherwise.
- Collapsed duplicated defense detail into the canonical `references/mechanization-targets.md` bundle.
- Replaced stale and machine-private dependencies with current repository references.

## v0.2 — 2026-05-20

### Added

- `agents/fh-whitehat-trust.md` — non-transitive pact composition,
  chain-depth bound, WoT bond-weighted scoring.
- `agents/fh-whitehat-tokens.md` — three-layered token guarantees
  (unforgeability + epoch-binding + position-binding), tree-head
  cross-witness.
- `agents/fh-whitehat-revocation.md` — bounded propagation invariant
  + pessimistic verifier; replenishment race ordering.
- `agents/fh-whitehat-econ.md` — quadratic joining bond, two-phase
  commit settlement, convex curve + pool floor, cold-start budget,
  honest operator-Sybil disclaimer.
- `agents/fh-proof-completer.md` — lands artifacts flagged by proof-
  gap-auditor, pins placeholders with witnesses.
- `agents/fh-secops-lead.md` — round arbiter; Gate A/B/C protocol;
  cross-paper coordination.
- `references/cross-paper-dependencies.md` — running dependency
  table (shared content; whitehat-side reading guide).
- `references/topic-map.md` — twelve clusters with defense class +
  persona owner; refuses-vs-prices structural table; canonical
  pre-emptive analogies.
- `references/mechanization-targets.md` — defense class → tool →
  file path → must-prove. Twenty-one targets enumerated.
- `scripts/new-round.sh` — scaffolds dialogue + whitehat target list.
- `scripts/defense-template.json` — JSON schema for one counter.
- `scripts/env.sh` — FH-specific env, inherits whitehat-defense.
- `scripts/run-fh-whitehats.sh` — pd-spawn orchestrator for the five
  defender personas.
- `scripts/run-fh-secops-lead.sh` — gate-signing wrapper (Gate A
  open / Gate B seal / Gate C publish).
- `examples/dialogue-fh-v0.1-to-v0.2.example.json` — mirrored worked
  example (matches redteam side).
- `examples/defense-tokens-example.json` — worked single-counter
  entry for §fh-3 token epoch-binding.

### Voice / structural

- No changes to `SKILL.md` prose.

## v0.1 — 2026-05-19

### Added

- `SKILL.md` — initial draft. Six personas (five 1:1 with redteam +
  sec-eng-lead), nine defense categories (1:1 with redteam probes),
  scope-hedge doctrine, dependency-formalization doctrine,
  pre-emptive analogies (CT, Macaroons, HTLC, SPKI/SDSI),
  refuses-vs-prices structural table, shibboleths.
- Prose-only; no agents, references, scripts, examples. Reference
  manifest at bottom of SKILL.md was forward-declared.

### Known gaps (closed in v0.2)

- No persona files.
- No mechanization-targets table.
- No defense template / counter schema.
- No worked example dialogue artifact.
- No gate-signing script for fh-secops:lead.
