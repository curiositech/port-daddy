# Cross-Paper Dependencies — Federated Harbor

The running table of Federated Harbor claims that depend on Anchor or
Bonded results. Shared across all three FH skills (author, redteam,
whitehat). Updated by `fh-author-cross-paper-citation`; audited by
`fh-proof-gap-auditor` (redteam side) and `fh-secops-lead` (whitehat
side). A round cannot close while a dependency is on the unresolved
list.

## Format

Every row carries the substitution form. Bare paraphrases are
incomplete; flag and resolve.

| FH §        | Anchor / Bonded source          | Substitution                                                                                                              | Mechanization (source)                                  | Falsification path                                                                            | Status |
|-------------|---------------------------------|---------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------|-----------------------------------------------------------------------------------------------|--------|
| §fh-3       | Anchor §[ANCHOR-§-SIGS]          | [single-harbor token → cross-harbor token, signed-by-issuer → signed-by-issuer+epoch-bound-federation-root]               | `whitepaper/formal/proverif/anchor/token-verify/algconfusion.pv`             | If Anchor's signature scheme is broken (existential forgery under CMA), every FH token forges  | resolved |
| §fh-3       | Anchor §[ANCHOR-§-CHAIN]         | [delegation chain → cross-harbor delegation chain, position-binding → position+epoch+harbor-binding]                       | `whitepaper/formal/proverif/anchor/delegation/chain-replay.pv`               | If Anchor chain-binding fails, FH splice attacks succeed                                       | resolved |
| §fh-4       | Bonded §[BONDED-§-MERKLE]        | [Merkle Forest root → federation tree-head, single-publisher → cross-witness quorum W]                                     | `whitepaper/formal/tla/bonded-conservation/Conservation.tla` (partial) | If Bonded Merkle binding is loose, FH equivocation detection has a gap                          | resolved |
| §fh-6       | Bonded §[BONDED-§-BONDS]         | [local-bond → joint-bond, single-harbor escrow → three-harbor escrow with timeouts]                                        | `whitepaper/formal/tla/bonded-conservation/Conservation.tla`            | If Bonded bond mechanics overflow, FH cross-harbor settlement double-extracts                   | resolved |
| §fh-7       | Bonded §[BONDED-§-REVOKE]        | [single-harbor revocation → cross-harbor revocation under partition D, monotone gossip → bounded-equivocation gossip]      | `whitepaper/formal/tla/bonded-revocation/*.tla` (placeholder)           | If Bonded revocation does not bound staleness, FH partition-then-spend attack works             | UNRESOLVED — Bonded artifact deferred to v2.3 |
| §fh-8       | Bonded §sec:youle                | [single-harbor competitive insurance → cross-harbor competitive insurance over joint pool]                                 | TBD (Youle pending)                                      | If single-harbor Pareto-dominance does not hold, FH cross-harbor extension does not              | UNRESOLVED — external dependency |
| §fh-9       | Bonded §[BONDED-§-CONSERVATION]  | [sum-of-bonds-conserved-per-harbor → sum-of-bonds-conserved-across-federation]                                              | `whitepaper/formal/tla/bonded-conservation/Conservation.tla`            | Conservation holds locally but not cross-harbor under settlement reversal — explicit counterexample required | UNRESOLVED — FH-side spec PENDING |
| §fh-3, §fh-6 | Anchor offline-attenuation [Anchor §[ANCHOR-§-ATTENUATION]] | [Macaroon-style attenuation → cross-harbor attenuation with epoch-binding]                                                | Anchor offline-attenuation tests (path TBD)              | If Anchor attenuation can be lifted, FH cross-harbor attenuation can be lifted twice            | resolved (with PLACEHOLDER section-pin in Anchor) |

## Anchor placeholders to pin

The Anchor paper currently uses these section IDs which Federated
Harbor depends on. When Anchor's section numbers move, this table
must be updated in the same commit:

- `[ANCHOR-§-SIGS]`            — the signature-scheme correctness claim.
- `[ANCHOR-§-CHAIN]`           — the delegation-chain binding claim.
- `[ANCHOR-§-ATTENUATION]`     — the offline-attenuation construction.
- `[ANCHOR-§-SIGNED-EVENTS]`   — the unforgeable-events assumption used by
                                 federation-pact registry (`fh-whitehat-trust`).

## Bonded placeholders to pin

- `[BONDED-§-MERKLE]`          — Merkle Forest binding.
- `[BONDED-§-BONDS]`           — local-bond mechanics.
- `[BONDED-§-REVOKE]`          — single-harbor revocation proof.
- `[BONDED-§-CONSERVATION]`    — Conservation Theorem (Bonded §7.x).
- `[BONDED-§-COLLUSION]`       — folk-theorem cartel-resistance argument.

## External assumptions

Each carries a one-line statement in §1 of the paper plus a
corresponding `EXTERNAL-ASSUMPTION:<name>` annotation in the proof
artifacts that depend on it:

| Name                            | Statement                                                                       | Used in   |
|---------------------------------|---------------------------------------------------------------------------------|-----------|
| `EXT:dolev-yao-network`         | Network adversary reads all messages, forges nothing without keys.              | §fh-3, §fh-6, §fh-7 |
| `EXT:trusted-anchor-keys`       | Anchor's per-user signing key is uncompromised.                                  | §fh-3 |
| `EXT:clock-skew-bounded-by-D`   | Real-world clocks across federation members drift by ≤ D/3 within any round.    | §fh-7 |
| `EXT:witness-honest-majority`   | At least ⌈W/2 + 1⌉ federation witnesses behave honestly.                        | §fh-4, §fh-6 |
| `EXT:bond-pool-solvent`         | The federation reserve covers any worst-case slash event in the safety floor.   | §fh-7, §fh-8 |

## Workflow

1. Drafter sprays `ready-for-redteam:fh:§N`.
2. Cross-paper-citation agent walks this table for §N's row(s).
3. For each row:
   - Verify substitution form present in §N text.
   - Verify source mechanization artifact exists and passes.
   - Verify falsification path is named in §N text.
4. If all check → row stays `resolved`. If any fails → row flips
   `UNRESOLVED` and the dependency blocks round close.

## Anti-patterns

- Adding a new FH section that cites Anchor or Bonded without adding
  a row here.
- Marking a row `resolved` based on the source paper's prose alone.
  Resolution requires the artifact too.
- Closing a dependency by paraphrasing — "Bonded shows X" is not a
  resolution; the substitution form is.

## Audit checklist

Before any FH round closes:

- [ ] Every row in this table is `resolved` or has an explicit deferral
      reason (with a target round).
- [ ] Every `UNRESOLVED` row has a CC to both papers' sec-eng-leads.
- [ ] Every Anchor / Bonded placeholder cited above maps to an actual
      section in the corresponding paper's current draft.
- [ ] Every `EXTERNAL-ASSUMPTION` is also stated in §1 of the paper.
