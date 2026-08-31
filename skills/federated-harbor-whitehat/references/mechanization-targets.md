# Mechanization Targets — Federated Harbor Whitehat

Every defense in this skill commits to a mechanization artifact.
This file is the canonical mapping: defense class → tool → file path
→ what it must prove. `fh-proof-completer` works against this table.

If you ship a counter without a row here pointing to an existing
file, the counter is hand-waving.

## Layout

Formal models live under the method-specific
`whitepaper/formal/{proverif,tla,z3}/federated-harbor/` roots. Empirical
simulations live under
`whitepaper/research/program/simulations/federated-harbor/`. These rows are a
planned target register, not evidence that the named artifact exists. The
whitepaper's section text may carry `MECHANIZATION-PENDING:<path>` until a file,
receipt, and manifest record actually land.

## Targets

### 1. Trust transitivity

| File                                                          | Tool      | Must prove                                                                                  |
|---------------------------------------------------------------|-----------|---------------------------------------------------------------------------------------------|
| `whitepaper/formal/proverif/federated-harbor/trust/non-transitive-pact.pv`                | ProVerif  | `accepted(C-token at A) ==> consented(A, C)`; two-hop composition does NOT imply consent. |
| `whitepaper/formal/proverif/federated-harbor/trust/transitive-consent.pv`                 | ProVerif  | (Redteam companion) explicit consent event is required for transitive acceptance.           |
| `whitepaper/formal/z3/federated-harbor/trust/depth-bound.smt2`                      | Z3        | Verifier depth check correctly rejects chains exceeding D (PLACEHOLDER-DEPTH-D).            |
| `whitepaper/research/program/simulations/federated-harbor/trust/wot-bond-weighted.py`                  | Mesa      | K colluding harbors contribute K × bond, not K × 1, to WoT trust score.                     |

### 2. Cross-harbor capability tokens (forgery, re-issuance, splice)

| File                                                          | Tool      | Must prove                                                                                  |
|---------------------------------------------------------------|-----------|---------------------------------------------------------------------------------------------|
| `whitepaper/formal/proverif/federated-harbor/tokens/cross-harbor-issuance.pv`             | ProVerif  | Three queries: forgery (true), re-issuance under epoch-rewind (false), splice (false).      |
| `whitepaper/formal/proverif/federated-harbor/tokens/position-binding.pv`                  | ProVerif  | Signature lifting from chain X into chain Y fails the position-binding check.               |
| `whitepaper/formal/z3/federated-harbor/tokens/historical-root-storage.smt2`         | Z3 / Kani | Storage cost O(log epoch + recent-window); bound holds for paper-stated retention horizon. |

### 3. Federated revocation under partition

| File                                                          | Tool      | Must prove                                                                                  |
|---------------------------------------------------------------|-----------|---------------------------------------------------------------------------------------------|
| `whitepaper/formal/tla/federated-harbor/revocation/propagation.tla`                  | Apalache  | Inductive invariant `RevokedNotAccepted` parametric in D; no counterexample in bounded model. |
| `whitepaper/formal/tla/federated-harbor/revocation/propagation.cfg`                  | Apalache  | TLC config: bounded state space; partition adversary; clock-skew ≤ D/3.                      |
| `whitepaper/formal/tla/federated-harbor/revocation/pessimistic-verifier.tla`         | TLA+      | Partitioned harbor refuses cross-harbor tokens for entire partition duration.                |
| `whitepaper/research/program/simulations/federated-harbor/revocation/replenishment-race.py`            | Mesa      | Bond slash gossip ordering: post-slash token presentations refused.                          |

### 4. Cross-harbor Sybil

| File                                                          | Tool      | Must prove                                                                                  |
|---------------------------------------------------------------|-----------|---------------------------------------------------------------------------------------------|
| `whitepaper/research/program/simulations/federated-harbor/sybil/join-cost.py`                          | Mesa      | For every (K, N, bond-curve), adversary voting-weight-fraction ≤ stake-fraction.            |

### 5. Cross-domain settlement

| File                                                          | Tool      | Must prove                                                                                  |
|---------------------------------------------------------------|-----------|---------------------------------------------------------------------------------------------|
| `whitepaper/formal/tla/federated-harbor/settlement/no-double-extract.tla`            | Apalache  | Invariant `NoDoubleExtract`: net adversary balance change ≤ legitimate settlement amount.   |
| `whitepaper/formal/tla/federated-harbor/settlement/three-harbor-ordering.tla`        | TLA+      | Harbor-tree ordering: earlier-event-wins; loser's bond pays winner.                          |
| `whitepaper/formal/z3/federated-harbor/settlement/dispute-window.smt2`              | Z3        | Dispute-window arithmetic: bond decay, dispute timing, no overflow.                          |

### 6. Tree-head equivocation

| File                                                          | Tool      | Must prove                                                                                  |
|---------------------------------------------------------------|-----------|---------------------------------------------------------------------------------------------|
| `whitepaper/formal/proverif/federated-harbor/equivocation/witness-cross-check.pv`         | ProVerif  | Any two observers' accepted tree-heads at epoch e are equal OR Disagreement event in O(W).  |
| `whitepaper/formal/tla/federated-harbor/equivocation/witness-quorum.tla`             | TLA+      | Witness honest-majority assumption; equivocating publisher cannot clear two quorums.        |
| `whitepaper/research/program/simulations/federated-harbor/equivocation/witness-sim/`                   | Mesa      | (Simulator) empirical detection latency vs adversarial gossip topology.                     |

### 7. Bond-pool draining

| File                                                          | Tool      | Must prove                                                                                  |
|---------------------------------------------------------------|-----------|---------------------------------------------------------------------------------------------|
| `whitepaper/research/program/simulations/federated-harbor/econ/bond-drain.py`                          | Mesa      | Under adversary-optimal dispute timing, pool stays above safety floor for every run.        |
| `whitepaper/research/program/simulations/federated-harbor/econ/convex-curve-fit.py`                    | Mesa / numerical | Convex curve parameters fit so depletion is sub-linear in adversary collateral.       |

### 8. Cold-start

| File                                                          | Tool      | Must prove                                                                                  |
|---------------------------------------------------------------|-----------|---------------------------------------------------------------------------------------------|
| `whitepaper/research/program/simulations/federated-harbor/cold-start/extraction-bound.py`              | Mesa      | For every strategy + best-response, expected extraction ≤ posted bond over cold-start window. |
| `whitepaper/research/program/simulations/federated-harbor/cold-start/coalition.py`                     | Mesa      | Joint cold-start by K-coalition: cap is per-harbor; coalitions do not accelerate budget.    |

### 9. Operator Sybil (protocol commitment, not a proof)

| File                                                          | Kind      | What it states                                                                              |
|---------------------------------------------------------------|-----------|---------------------------------------------------------------------------------------------|
| `whitepaper/research/program/rounds/federated-harbor/planned/operator-sybil/binding.md`                   | Markdown  | Paper commits to "bonded-not-diverse" default; states the falsification path (economic, not identity). |
| `whitepaper/research/program/rounds/federated-harbor/planned/operator-sybil/optional-hw-attestation.md`   | Markdown (optional) | Sketch of hardware-attested operator-identity for deployments requiring diversity.   |

### Cross-cutting: comms-protocol isolation

| File                                                          | Tool      | Must prove                                                                                  |
|---------------------------------------------------------------|-----------|---------------------------------------------------------------------------------------------|
| `whitepaper/formal/proverif/coordination/isolation.pv` (inherited)                 | ProVerif  | Under Dolev-Yao adversary controlling daemon, red & defense payload secrecy hold; Gate B is only path. |

## Status legend

- **LANDED**: file exists, last run within current round, RESULT
  line(s) verified.
- **PENDING**: file does not yet exist; placeholder. Must land in
  current round or be granted explicit one-round grace.
- **FAILING**: file exists, counterexample found; either fix the
  artifact or the paper retreats.
- **PARTIAL**: file exists, some queries pass and some are by-design
  false (contrast case).

## Anti-patterns

- Listing an artifact here without a "must prove" line. The "must
  prove" is what makes the artifact critical.
- Listing an artifact that no defense counter references.
- Forgetting to update this table when a new defense class lands.
- Pointing a counter at a PENDING file across multiple rounds. One
  round of grace; two is a defect.
