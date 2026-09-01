# Cross-Paper Dependencies — Federated Harbor Redteam View

This is the same dependency table as
`skills/federated-harbor-author/references/cross-paper-dependencies.md`
and `skills/federated-harbor-whitehat/references/cross-paper-dependencies.md`
viewed from the redteam side. **All three files must say the same
thing.** If they disagree, one of the three has drifted; the
sec-eng-lead reconciles at Gate C.

The redteam reads this table to know:

1. Which Federated Harbor claims rest on Anchor or Bonded.
2. Which Anchor/Bonded sources have a mechanization artifact (a probe
   targeting one of those claims is a *cross-paper* smell, CC the
   prior-paper lead).
3. Which rows are `UNRESOLVED` — those are *prime targets* for new
   probes this round.

## Format

| FH §        | Anchor / Bonded source          | Substitution                                                                                                              | Mechanization (source)                                  | Falsification path                                                                            | Status |
|-------------|---------------------------------|---------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------|-----------------------------------------------------------------------------------------------|--------|
| §fh-3       | Anchor §[ANCHOR-§-SIGS]          | [single-harbor token → cross-harbor token, signed-by-issuer → signed-by-issuer+epoch-bound-federation-root]               | `whitepaper/formal/proverif/anchor/token-verify/algconfusion.pv`             | If Anchor's signature scheme is broken (existential forgery under CMA), every FH token forges  | resolved |
| §fh-3       | Anchor §[ANCHOR-§-CHAIN]         | [delegation chain → cross-harbor delegation chain, position-binding → position+epoch+harbor-binding]                       | `whitepaper/formal/proverif/anchor/delegation/chain-replay.pv`               | If Anchor chain-binding fails, FH splice attacks succeed                                       | resolved |
| §fh-4       | Bonded §[BONDED-§-MERKLE]        | [Merkle Forest root → federation tree-head, single-publisher → cross-witness quorum W]                                     | `whitepaper/formal/tla/bonded-conservation/Conservation.tla` (partial) | If Bonded Merkle binding is loose, FH equivocation detection has a gap                          | resolved |
| §fh-6       | Bonded §[BONDED-§-BONDS]         | [local-bond → joint-bond, single-harbor escrow → three-harbor escrow with timeouts]                                        | `whitepaper/formal/tla/bonded-conservation/Conservation.tla`            | If Bonded bond mechanics overflow, FH cross-harbor settlement double-extracts                   | resolved |
| §fh-7       | Bonded §[BONDED-§-REVOKE]        | [single-harbor revocation → cross-harbor revocation under partition D, monotone gossip → bounded-equivocation gossip]      | `whitepaper/formal/bonded/revocation/*.tla` (placeholder)           | If Bonded revocation does not bound staleness, FH partition-then-spend attack works             | **UNRESOLVED — prime probe target** |
| §fh-8       | Bonded §sec:youle                | [single-harbor competitive insurance → cross-harbor competitive insurance over joint pool]                                 | TBD (Youle pending)                                      | If single-harbor Pareto-dominance does not hold, FH cross-harbor extension does not              | **UNRESOLVED — prime probe target** |
| §fh-9       | Bonded §[BONDED-§-CONSERVATION]  | [sum-of-bonds-conserved-per-harbor → sum-of-bonds-conserved-across-federation]                                              | `whitepaper/formal/tla/bonded-conservation/Conservation.tla`            | Conservation holds locally but not cross-harbor under settlement reversal                       | **UNRESOLVED — prime probe target** |

## Probe-class implications

Rows tagged **UNRESOLVED — prime probe target** are the high-leverage
surfaces for this round. The redteam targets them in order:

1. **§fh-7 / Bonded revocation gap.** Build the Apalache partition
   model against the FH revocation prose; show whether the unstated
   Bonded staleness bound bleeds into FH safety.
2. **§fh-8 / Pareto cross-harbor.** Mesa simulation testing whether
   separating equilibrium survives multi-harbor; pooling re-emergence
   is the falsification.
3. **§fh-9 / Conservation cross-harbor.** Construct a TLA+ trace
   where settlement reversal between harbors breaks the cross-harbor
   sum-conservation invariant.

## When you find a cross-paper smell

The smell tag carries both papers' section keys:

```
smell:fh:trust:§fh-3+anchor:§[ANCHOR-§-SIGS]:NNNN
```

CC both leads:

```
pd msg send fh-secops:lead '{"ref":"smell:fh:trust:...", "ask":"cross-paper"}'
pd msg send secops:lead    '{"ref":"smell:fh:trust:...", "ask":"cross-paper from FH"}'
```

The prior-paper lead may need to open a separate round on Anchor /
Bonded to close the dependency. The FH round can either wait or
weaken the FH claim and proceed; the sec-eng-lead decides.

## Audit checklist (per round, before Gate B)

- [ ] Every `UNRESOLVED` row has at least one probe filed against it
      (or an explicit "deferred to round N+1" note signed by the lead).
- [ ] No probe references a `resolved` row without re-running the
      source artifact (resolution is not eternal; sources move).
- [ ] Every cross-paper smell has CC'd both leads.
