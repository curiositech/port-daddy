# Mechanization Targets — Federated Harbor Whitehat

> **Audited 2026-09-06** against `whitepaper/corpus.json` (wave-p1/proof-estate):
> of this table's 25 file rows, only the cross-cutting
> `proofs/coordination/isolation.pv` row exists on disk (it is already WIRED
> into CI as `proverif-estate`, and independently registered in the corpus
> manifest under `coordination-isolation-proverif`). `proofs/federated/` does
> not exist. The other 24 rows are marked **PLANNED** below rather than
> deleted -- they remain a legitimate future mechanization roadmap for the
> Federated Harbor chapter, just not yet started; this audit does not judge
> whether any of them still has a realistic path to landing, only whether the
> file exists today.

Every defense in this skill commits to a mechanization artifact.
This file is the canonical mapping: defense class → tool → file path
→ what it must prove. `fh-proof-completer` works against this table.

If you ship a counter without a row here pointing to an existing
file, the counter is hand-waving.

## Layout

All artifacts live under `proofs/federated/`. Mirror of
`proofs/anchor/` and `proofs/bonded/`. The whitepaper's section text
carries `MECHANIZATION:<path>` annotations that resolve to these
paths.

## Targets

### 1. Trust transitivity

| File                                                          | Tool      | Must prove                                                                                  | Status  |
|---------------------------------------------------------------|-----------|----------------------------------------------------------------------------------------------|---------|
| `proofs/federated/trust/non-transitive-pact.pv`                | ProVerif  | `accepted(C-token at A) ==> consented(A, C)`; two-hop composition does NOT imply consent. | PLANNED (not yet shipped) |
| `proofs/federated/trust/transitive-consent.pv`                 | ProVerif  | (Redteam companion) explicit consent event is required for transitive acceptance.           | PLANNED (not yet shipped) |
| `proofs/federated/trust/depth-bound.smt2`                      | Z3        | Verifier depth check correctly rejects chains exceeding D (PLACEHOLDER-DEPTH-D).            | PLANNED (not yet shipped) |
| `proofs/federated/trust/wot-bond-weighted.py`                  | Mesa      | K colluding harbors contribute K × bond, not K × 1, to WoT trust score.                     | PLANNED (not yet shipped) |

### 2. Cross-harbor capability tokens (forgery, re-issuance, splice)

| File                                                          | Tool      | Must prove                                                                                  | Status  |
|---------------------------------------------------------------|-----------|----------------------------------------------------------------------------------------------|---------|
| `proofs/federated/tokens/cross-harbor-issuance.pv`             | ProVerif  | Three queries: forgery (true), re-issuance under epoch-rewind (false), splice (false).      | PLANNED (not yet shipped) |
| `proofs/federated/tokens/position-binding.pv`                  | ProVerif  | Signature lifting from chain X into chain Y fails the position-binding check.               | PLANNED (not yet shipped) |
| `proofs/federated/tokens/historical-root-storage.smt2`         | Z3 / Kani | Storage cost O(log epoch + recent-window); bound holds for paper-stated retention horizon. | PLANNED (not yet shipped) |

### 3. Federated revocation under partition

| File                                                          | Tool      | Must prove                                                                                  | Status  |
|---------------------------------------------------------------|-----------|----------------------------------------------------------------------------------------------|---------|
| `proofs/federated/revocation/propagation.tla`                  | Apalache  | Inductive invariant `RevokedNotAccepted` parametric in D; no counterexample in bounded model. | PLANNED (not yet shipped) |
| `proofs/federated/revocation/propagation.cfg`                  | Apalache  | TLC config: bounded state space; partition adversary; clock-skew ≤ D/3.                      | PLANNED (not yet shipped) |
| `proofs/federated/revocation/pessimistic-verifier.tla`         | TLA+      | Partitioned harbor refuses cross-harbor tokens for entire partition duration.                | PLANNED (not yet shipped) |
| `proofs/federated/revocation/replenishment-race.py`            | Mesa      | Bond slash gossip ordering: post-slash token presentations refused.                          | PLANNED (not yet shipped) |

### 4. Cross-harbor Sybil

| File                                                          | Tool      | Must prove                                                                                  | Status  |
|---------------------------------------------------------------|-----------|----------------------------------------------------------------------------------------------|---------|
| `proofs/federated/sybil/join-cost.py`                          | Mesa      | For every (K, N, bond-curve), adversary voting-weight-fraction ≤ stake-fraction.            | PLANNED (not yet shipped) |

### 5. Cross-domain settlement

| File                                                          | Tool      | Must prove                                                                                  | Status  |
|---------------------------------------------------------------|-----------|----------------------------------------------------------------------------------------------|---------|
| `proofs/federated/settlement/no-double-extract.tla`            | Apalache  | Invariant `NoDoubleExtract`: net adversary balance change ≤ legitimate settlement amount.   | PLANNED (not yet shipped) |
| `proofs/federated/settlement/three-harbor-ordering.tla`        | TLA+      | Harbor-tree ordering: earlier-event-wins; loser's bond pays winner.                          | PLANNED (not yet shipped) |
| `proofs/federated/settlement/dispute-window.smt2`              | Z3        | Dispute-window arithmetic: bond decay, dispute timing, no overflow.                          | PLANNED (not yet shipped) |

### 6. Tree-head equivocation

| File                                                          | Tool      | Must prove                                                                                  | Status  |
|---------------------------------------------------------------|-----------|----------------------------------------------------------------------------------------------|---------|
| `proofs/federated/equivocation/witness-cross-check.pv`         | ProVerif  | Any two observers' accepted tree-heads at epoch e are equal OR Disagreement event in O(W).  | PLANNED (not yet shipped) |
| `proofs/federated/equivocation/witness-quorum.tla`             | TLA+      | Witness honest-majority assumption; equivocating publisher cannot clear two quorums.        | PLANNED (not yet shipped) |
| `proofs/federated/equivocation/witness-sim/`                   | Mesa      | (Simulator) empirical detection latency vs adversarial gossip topology.                     | PLANNED (not yet shipped) |

### 7. Bond-pool draining

| File                                                          | Tool      | Must prove                                                                                  | Status  |
|---------------------------------------------------------------|-----------|----------------------------------------------------------------------------------------------|---------|
| `proofs/federated/econ/bond-drain.py`                          | Mesa      | Under adversary-optimal dispute timing, pool stays above safety floor for every run.        | PLANNED (not yet shipped) |
| `proofs/federated/econ/convex-curve-fit.py`                    | Mesa / numerical | Convex curve parameters fit so depletion is sub-linear in adversary collateral.       | PLANNED (not yet shipped) |

### 8. Cold-start

| File                                                          | Tool      | Must prove                                                                                  | Status  |
|---------------------------------------------------------------|-----------|----------------------------------------------------------------------------------------------|---------|
| `proofs/federated/cold-start/extraction-bound.py`              | Mesa      | For every strategy + best-response, expected extraction ≤ posted bond over cold-start window. | PLANNED (not yet shipped) |
| `proofs/federated/cold-start/coalition.py`                     | Mesa      | Joint cold-start by K-coalition: cap is per-harbor; coalitions do not accelerate budget.    | PLANNED (not yet shipped) |

### 9. Operator Sybil (protocol commitment, not a proof)

| File                                                          | Kind      | What it states                                                                              | Status  |
|---------------------------------------------------------------|-----------|------------------------------------------------------------------------------------------------|---------|
| `proofs/federated/operator-sybil/binding.md`                   | Markdown  | Paper commits to "bonded-not-diverse" default; states the falsification path (economic, not identity). | PLANNED (not yet shipped) |
| `proofs/federated/operator-sybil/optional-hw-attestation.md`   | Markdown (optional) | Sketch of hardware-attested operator-identity for deployments requiring diversity.   | PLANNED (not yet shipped) |

### Cross-cutting: comms-protocol isolation

| File                                                          | Tool      | Must prove                                                                                  | Status |
|---------------------------------------------------------------|-----------|------------------------------------------------------------------------------------------------|--------|
| `proofs/coordination/isolation.pv` (inherited)                 | ProVerif  | Under Dolev-Yao adversary controlling daemon, red & defense payload secrecy hold; Gate B is only path. | LANDED |

## Status legend

- **LANDED**: file exists, last run within current round, RESULT
  line(s) verified.
- **PENDING**: file does not yet exist; placeholder. Must land in
  current round or be granted explicit one-round grace.
- **PLANNED**: this audit's marker for the same "file does not yet
  exist" state as PENDING, used for rows that were never picked up in
  any round rather than ones currently in flight. Treat identically to
  PENDING for the "one round of grace" rule below once work resumes on
  a given row.
- **FAILING**: file exists, counterexample found; either fix the
  artifact or the paper retreats.
- **PARTIAL**: file exists, some queries pass and some are by-design
  false (contrast case).

## Anti-patterns

- Listing an artifact here without a "must prove" line. The "must
  prove" is what makes the artifact load-bearing.
- Listing an artifact that no defense counter references.
- Forgetting to update this table when a new defense class lands.
- Pointing a counter at a PENDING file across multiple rounds. One
  round of grace; two is a defect.
