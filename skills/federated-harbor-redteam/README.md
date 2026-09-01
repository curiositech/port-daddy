# federated-harbor-redteam

One-screen orientation. The authoritative content is `SKILL.md`.

## What this skill is for

Adversarial review of **The Federated Harbor** whitepaper. Probes
federation-specific threats: trust transitivity, cross-harbor token
forgery, federated revocation under partition, cross-harbor Sybil,
cross-domain settlement, equivocation, bond-pool draining,
cold-start gaming, federation-operator Sybil.

Pairs 1:1 with `federated-harbor-whitehat`. Inherits the comms
protocol and reputation-bond mechanics from `redteam-review`.

## Structure

```
federated-harbor-redteam/
├── SKILL.md                                  # nine probe categories + falsifiable forms (read first)
├── README.md                                 # this file
├── CHANGELOG.md                              # versioned skill history
├── agents/
│   ├── fh-redteam-trust.md                   # trust transitivity, pact composition
│   ├── fh-redteam-tokens.md                  # cross-harbor token forgery, equivocation
│   ├── fh-redteam-revocation.md              # revocation under bounded partition
│   ├── fh-redteam-econ.md                    # settlement, Sybil, draining, cold-start
│   └── fh-proof-gap-auditor.md               # cross-cutting MECHANIZATION audit
├── references/
│   ├── cross-paper-dependencies.md           # running dependency table (shared)
│   └── topic-map.md                          # twelve-cluster bibliography map
├── scripts/
│   ├── new-round.sh                          # scaffolds dialogue + target list
│   ├── probe-template.json                   # JSON schema for one probe
│   ├── verify-probe.sh                       # sanity-checks a probe JSON
│   ├── env.sh                                # FH-specific env, inherits redteam-review
│   └── run-fh-redteam.sh                     # pd-spawn orchestrator
└── examples/
    ├── dialogue-fh-v0.1-to-v0.2.example.json # worked round (three closes)
    └── probe-trust-example.json              # worked single-probe entry
```

## Quick start

1. Read `SKILL.md` — nine probe categories with falsifiable forms,
   artifact obligations, owners, and shibboleths.
2. Read `references/cross-paper-dependencies.md` — rows tagged
   `UNRESOLVED — prime probe target` are this round's highest leverage.
3. Read `references/topic-map.md` — which probe class lives in which
   bibliography cluster.
4. Source the env: `. scripts/env.sh --verify` (sanity-check
   formal-methods toolchain).
5. Open a round: `scripts/new-round.sh v0.1 v0.2` (scaffolds dialogue
   + target list).
6. Spawn the five personas: `scripts/run-fh-redteam.sh v0.2`.
7. Each persona files probes per `scripts/probe-template.json`.
   Validate locally with `scripts/verify-probe.sh <probe.json>`.

## The nine probe categories (1:1 with whitehat defenses)

1. Trust transitivity — `fh-redteam-trust`
2. Cross-harbor capability-token forgery / re-issuance / splice — `fh-redteam-tokens`
3. Federated revocation under adversarial network — `fh-redteam-revocation`
4. Cross-harbor Sybil — `fh-redteam-econ`
5. Cross-domain settlement (claim-A / settle-B / dispute-C) — `fh-redteam-econ`
6. Equivocation between harbor tree-heads — `fh-redteam-tokens`
7. Bond-pool draining across boundaries — `fh-redteam-econ`
8. Cold-start joining without prior reputation — `fh-redteam-econ`
9. Federation-operator Sybil — `fh-redteam-econ`

Plus cross-cutting:

- Proof-gap audit — `fh-proof-gap-auditor`

## What this skill is NOT for

- Probing Anchor or Bonded — use `redteam-review`.
- Production incident response — `SECURITY.md` + on-call runbooks.
- Probes against deployed peers — this skill probes the *paper's*
  claims, not real-world federations.
- Speculative attacks lacking a concrete probe template (target →
  tool → expected observation → impact). Theatrical findings slash
  the reputation bond.

## Round cadence

Mirrors `redteam-review`:

1. Gate A — `fh-secops:lead` opens the round, writes the target list,
   sprays `round:fh:open:vN`.
2. Phase 1 (attack, sealed) — each persona probes its surface. Smells
   filed via `scripts/probe-template.json` + `scripts/verify-probe.sh`.
3. Gate B — `fh-secops:lead` seals the manifest, delivers to whitehat.
4. Phase 2 (defense, sealed) — whitehat closes or carries.
5. Gate C — `fh-secops:lead` publishes the dialogue artifact at
   `whitepaper/research/program/rounds/federated-harbor/dialogue-fh-vN-to-vN+1.{json,md}`.
