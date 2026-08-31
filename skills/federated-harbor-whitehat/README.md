# federated-harbor-whitehat

One-screen orientation. The authoritative content is `SKILL.md`.

## What this skill is for

Defensive counterpart to `federated-harbor-redteam`. Closes the smells
that red team opens against The Federated Harbor whitepaper.
Federation-specific defenses for cross-harbor primitives —
mechanization commitments, scope hedges, cross-paper dependency
formalization, pre-emptive analogies (CT, Macaroons, atomic swaps,
SPKI/SDSI), defense-in-depth framing (refuses vs prices).

Pairs 1:1 with `federated-harbor-redteam`. Inherits reputation-bond
mechanics, dialogue-artifact format, and sec-eng-lead coordination
structure from `whitehat-defense`.

## Structure

```
federated-harbor-whitehat/
├── SKILL.md                                  # nine defense categories + refuses/prices doctrine (read first)
├── README.md                                 # this file
├── CHANGELOG.md                              # versioned skill history
├── agents/
│   ├── fh-whitehat-trust.md                  # non-transitive pact composition
│   ├── fh-whitehat-tokens.md                 # three-layered token guarantees + cross-witness
│   ├── fh-whitehat-revocation.md             # bounded propagation + pessimistic verifier
│   ├── fh-whitehat-econ.md                   # quadratic bond, two-phase commit, budget cap
│   ├── fh-proof-completer.md                 # lands artifacts, pins placeholders
│   └── fh-secops-lead.md                     # Gate A/B/C arbiter
├── references/
│   ├── cross-paper-dependencies.md           # running dependency table (shared)
│   ├── topic-map.md                          # twelve-cluster bibliography map
│   └── mechanization-targets.md              # defense class → tool → path → must-prove
├── scripts/
│   ├── new-round.sh                          # scaffolds dialogue + defense target list
│   ├── defense-template.json                 # JSON schema for one counter
│   ├── env.sh                                # FH-specific env
│   ├── run-fh-whitehats.sh                   # pd-spawn defenders
│   └── run-fh-secops-lead.sh                 # gate-signing wrapper
└── examples/
    ├── dialogue-fh-v0.1-to-v0.2.example.json # worked round (mirror of redteam side)
    └── defense-tokens-example.json           # worked single-counter entry
```

## Quick start

1. Read `SKILL.md` — nine defense categories with mechanization
   commitments + refuses/prices doctrine.
2. Read `references/mechanization-targets.md` — every artifact this
   skill commits to, with tool + must-prove.
3. Read `references/cross-paper-dependencies.md` — what your defense
   can lean on from Anchor / Bonded.
4. Source the env: `. scripts/env.sh --verify`.
5. After Gate B (red manifest sealed): `scripts/run-fh-whitehats.sh v0.2`.
6. Each defender files counters per `scripts/defense-template.json`.
7. At Gate C: `scripts/run-fh-secops-lead.sh gate-c v0.2`.

## The nine defense classes (1:1 with redteam probe classes)

1. Non-transitive pact composition — `fh-whitehat-trust`
2. Three-layered token guarantees — `fh-whitehat-tokens`
3. Bounded propagation + pessimistic verifier — `fh-whitehat-revocation`
4. Quadratic joining bond, stake-fraction voting — `fh-whitehat-econ`
5. Two-phase commit settlement with bonded escalation — `fh-whitehat-econ`
6. Cross-witness tree-head publication — `fh-whitehat-tokens`
7. Convex bond curve + pool floor refusal — `fh-whitehat-econ`
8. Reputation budget cap for cold-start — `fh-whitehat-econ`
9. Honest disclaimer: paper does NOT claim operator diversity — `fh-whitehat-econ`

Plus cross-cutting:

- Proof completion — `fh-proof-completer`
- Round arbitration — `fh-secops-lead`

## What this skill is NOT for

- Ad-hoc code review — use the code-reviewer skill.
- Defending Anchor or Bonded claims — use `whitehat-defense`.
- Production incident response — `SECURITY.md` + on-call runbooks.
- Marketing language. The dialogue artifact is precise.
- "Defending" by quietly weakening a claim. RETREAT explicit.

## Round cadence

1. Gate A — `fh-secops:lead` opens round, writes targets, sprays
   `round:fh:open:vN`.
2. Phase 1 (attack, sealed, red side).
3. Gate B — `fh-secops:lead` seals red manifest, delivers to defense.
4. Phase 2 (defense, sealed) — each defender claims smells, builds
   artifacts, posts counters (refuses + prices mandatory).
5. Gate C — `fh-secops:lead` publishes the dialogue artifact at
   `whitepaper/research/program/rounds/federated-harbor/dialogue-fh-vN-to-vN+1.{json,md}`,
   bumps paper version, writes changelog, drafts blog announcement.
