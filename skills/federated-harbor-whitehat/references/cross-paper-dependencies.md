# Cross-Paper Dependencies — Federated Harbor Whitehat View

Same dependency table as
`skills/federated-harbor-author/references/cross-paper-dependencies.md`
and `skills/federated-harbor-redteam/references/cross-paper-dependencies.md`,
viewed from the whitehat side. **All three files must say the same
thing.** If they disagree, one of the three has drifted; `fh-secops:lead`
reconciles at Gate C.

The whitehat reads this table to know:

1. Which prior-paper artifacts your defense can lean on.
2. Which prior-paper artifacts your defense *cannot* lean on yet
   (those rows are `UNRESOLVED`; your defense either weakens or the
   round opens a cross-paper coordination).
3. Which `EXTERNAL-ASSUMPTION:` annotations belong in each artifact.

## Format

| FH §        | Anchor / Bonded source          | Substitution                                                                                                              | Mechanization (source)                                  | Falsification path                                                                            | Status |
|-------------|---------------------------------|---------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------|-----------------------------------------------------------------------------------------------|--------|
| §fh-3       | Anchor §[ANCHOR-§-SIGS]          | [single-harbor token → cross-harbor token, signed-by-issuer → signed-by-issuer+epoch-bound-federation-root]               | `whitepaper/formal/proverif/anchor/token-verify/algconfusion.pv`             | If Anchor's signature scheme is broken (existential forgery under CMA), every FH token forges  | resolved |
| §fh-3       | Anchor §[ANCHOR-§-CHAIN]         | [delegation chain → cross-harbor delegation chain, position-binding → position+epoch+harbor-binding]                       | `whitepaper/formal/proverif/anchor/delegation/chain-replay.pv`               | If Anchor chain-binding fails, FH splice attacks succeed                                       | resolved |
| §fh-4       | Bonded §[BONDED-§-MERKLE]        | [Merkle Forest root → federation tree-head, single-publisher → cross-witness quorum W]                                     | `whitepaper/formal/tla/bonded-conservation/Conservation.tla` (partial) | If Bonded Merkle binding is loose, FH equivocation detection has a gap                          | resolved |
| §fh-6       | Bonded §[BONDED-§-BONDS]         | [local-bond → joint-bond, single-harbor escrow → three-harbor escrow with timeouts]                                        | `whitepaper/formal/tla/bonded-conservation/Conservation.tla`            | If Bonded bond mechanics overflow, FH cross-harbor settlement double-extracts                   | resolved |
| §fh-7       | Bonded §[BONDED-§-REVOKE]        | [single-harbor revocation → cross-harbor revocation under partition D, monotone gossip → bounded-equivocation gossip]      | `whitepaper/formal/bonded/revocation/*.tla` (placeholder)           | If Bonded revocation does not bound staleness, FH partition-then-spend attack works             | **UNRESOLVED — defense parametric in D; FH artifact can land alone** |
| §fh-8       | Bonded §sec:youle                | [single-harbor competitive insurance → cross-harbor competitive insurance over joint pool]                                 | TBD (Youle pending)                                      | If single-harbor Pareto-dominance does not hold, FH cross-harbor extension does not              | **UNRESOLVED — external dependency** |
| §fh-9       | Bonded §[BONDED-§-CONSERVATION]  | [sum-of-bonds-conserved-per-harbor → sum-of-bonds-conserved-across-federation]                                              | `whitepaper/formal/tla/bonded-conservation/Conservation.tla`            | Conservation holds locally but not cross-harbor under settlement reversal                       | **UNRESOLVED — FH-side spec PENDING** |

## Defense leverage per row

- **§fh-3 token guarantees** rest on Anchor signature unforgeability +
  chain-binding. Both resolved; your defenses can cite, not re-prove.
- **§fh-4 federation tree-head** rests on Bonded Merkle binding
  (partial); your cross-witness defense adds the *bonds* layer on
  top, which is independent.
- **§fh-6 settlement** rests on Bonded bond mechanics; your TLA+
  spec extends Bonded's Conservation.
- **§fh-7 revocation** rests on Bonded revocation, currently
  UNRESOLVED. Your defense is parametric in D; the FH Apalache spec
  can land alone without the Bonded artifact (D is paper-stated).
  Document the parametricity explicitly so future Bonded artifact
  landing does not invalidate.
- **§fh-8 cold-start / Pareto** rest on Youle pending. Defense
  carries; document substitution form for when Youle lands.
- **§fh-9 conservation cross-harbor** rests on Bonded Conservation.
  Your TLA+ spec must extend, not duplicate. The substitution form
  names what is added (cross-harbor settlement reversal).

## EXTERNAL-ASSUMPTION annotations

Every defense artifact must declare its assumptions:

| Annotation                            | Statement                                                                       | Artifacts                                        |
|---------------------------------------|---------------------------------------------------------------------------------|--------------------------------------------------|
| `EXTERNAL-ASSUMPTION:dolev-yao-network` | Network adversary reads all messages, forges nothing without keys.              | tokens/*.pv, settlement/*.tla, equivocation/*.pv |
| `EXTERNAL-ASSUMPTION:trusted-anchor-keys` | Anchor's per-user signing key is uncompromised.                                 | tokens/*.pv                                      |
| `EXTERNAL-ASSUMPTION:clock-skew-bounded-by-D-over-3` | Real-world clocks drift by ≤ D/3 within any round.                             | revocation/*.tla                                 |
| `EXTERNAL-ASSUMPTION:witness-honest-majority` | ≥ ⌈W/2 + 1⌉ federation witnesses behave honestly.                              | equivocation/*.pv, settlement/*.tla              |
| `EXTERNAL-ASSUMPTION:bond-pool-solvent`     | Federation reserve covers worst-case slash event.                              | econ/bond-drain.py, cold-start/extraction-bound.py |

If an artifact uses an assumption not in this table, add the row
before landing.

## Workflow

1. Round opens. Read this table.
2. For each smell you counter, identify the dependency rows in this
   table for your section.
3. If row is `resolved`: cite, re-run the source artifact to confirm
   it still passes under the FH substitution form. If yes, fine. If
   no, escalate to `fh-secops:lead`.
4. If row is `UNRESOLVED`: either land an FH-side artifact that
   stands alone (preferred), or carry the smell with explicit reason.
5. At Gate C, `fh-secops:lead` reconciles this table across all
   three skills.

## Anti-patterns

- Citing a `resolved` row without re-running the source. Source
  papers move; a resolution in round N may break in N+1.
- Closing a defense by citing an `UNRESOLVED` row. The dependency
  is what's unresolved, not the FH defense.
- Adding new defense artifacts without declaring all
  `EXTERNAL-ASSUMPTION:` annotations.
