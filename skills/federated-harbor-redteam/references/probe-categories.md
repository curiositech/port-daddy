## Probe categories

Each probe category names: (1) the falsifiable form, (2) the
artifact obligation that *closes* the smell when the whitehat fleet
answers it, (3) the persona that owns it.

### 1. Trust-transitivity assumptions

**Question.** When does "Alice trusts Bob" + "Bob trusts Carol"
imply "Alice trusts Carol" in a federated harbor?

**Falsifiable form.** Construct a triple (A, B, C) of harbors such
that A → B and B → C federation pacts exist, but A does *not* admit
a Carol-issued capability under the paper's verification rules.
Show the precise verifier rule that fails. If the paper's text
implies transitive trust without naming the pact-composition rule,
this is a smell.

Equivalently: construct a triple where the paper's verifier *does*
accept the token but the operator of A did not consent to C. That
is a worse smell — silent transitivity.

**Artifact obligation to close.** A ProVerif or Tamarin model of
two-hop federation pact composition, with an explicit `consent`
predicate. Authenticity query: a token accepted at C-via-B-via-A
implies an event `consented(A, C)` was emitted by A.
Path: `whitepaper/formal/proverif/federated-harbor/trust/transitive-consent.pv` (placeholder).

**Owner.** `fh-redteam:trust` ↔ `fh-whitehat:trust`.

### 2. Cross-harbor capability-token forgery and re-issuance

**Question.** Can an adversary present at harbor B a token that
harbor A never issued, or re-present a token A revoked, or splice
two valid tokens into a third?

**Falsifiable form.** Three sub-probes:

- **Forgery.** Dolev-Yao adversary, harbors share only public
  federation roots, no private keys. Adversary tries to produce a
  token verifiable at B. Token-forgery query must be `false`
  (i.e., not derivable by attacker).
- **Re-issuance.** A revokes token T at epoch e. Adversary
  presents T at B at epoch e+1. Acceptance must require an
  epoch-bound check; if the paper's verify rule does not bind
  epoch, the smell is real.
- **Splice.** Two valid tokens T1 (A→X) and T2 (A→Y); adversary
  attempts to construct T3 (A→Z) by recombining signatures.
  Splice query must be `false`.

**Artifact obligation.** ProVerif at
`whitepaper/formal/proverif/federated-harbor/tokens/cross-harbor-issuance.pv` (placeholder)
with three queries (forgery, re-issuance, splice), each independently
`false`.

**Owner.** `fh-redteam:tokens` ↔ `fh-whitehat:tokens`.

### 3. Federated revocation propagation under adversarial network

**Question.** When A revokes a delegation, how long until B and C
observe the revocation, and what can an adversary do during the
gap?

**Falsifiable form.** Construct a TLA+/Apalache model of revocation
propagation with: (a) an adversary that controls message timing
between harbors, (b) an adversary that can *partition* one harbor
from the federation for a bounded duration, (c) an adversary that
*equivocates* (publishes different revocation messages to different
peers). Specify the invariant: at any time after the revocation
deadline D, no harbor in the federation accepts the revoked token.
Find the precise scenario that violates the invariant. If D is not
named in the paper, the smell is "no propagation bound stated."

Equivalently: if D is named but the model shows a partition longer
than D admits a token presentation that the paper claims is
revoked, the bound is wrong.

**Artifact obligation.** Apalache spec at
`whitepaper/formal/tla/federated-harbor/revocation/propagation.tla` (placeholder) with
an inductive invariant `RevokedNotAccepted` proved under bounded
partition assumption. Counterexample trace produced and refuted.

**Owner.** `fh-redteam:revocation` ↔ `fh-whitehat:revocation`.

### 4. Cross-harbor Sybil

**Question.** Can an adversary join the federation cheaply enough
that the joint-bond-pool guarantees of the paper degrade by more
than a stated factor?

**Falsifiable form.** Mesa or agent-based simulation: adversary
spawns K Sybil harbors against a federation of N honest harbors,
posting the minimum joining bond each. Compute the fraction of
the joint bond pool the adversary controls as a function of K, N,
and the bond curve. If that fraction exceeds the paper's stated
safety margin (e.g., the paper claims "<= 1/3 adversarial mass"),
the smell is real.

A subtler form: the adversary does not control 1/3 of bonds, but
controls 1/3 of *voting weight* on revocation decisions because
the paper measures weight by harbor count rather than by stake.
Name the metric mismatch.

**Artifact obligation.** Mesa simulation at
`whitepaper/research/program/simulations/federated-harbor/sybil/join-cost.py` (placeholder) producing a
table of (K/N, adversary stake fraction, voting weight fraction)
across the bond curve. The paper's safety claim must hold for
every row, or the bond curve must be revised.

**Owner.** `fh-redteam:econ` ↔ `fh-whitehat:econ`.

### 5. Cross-domain settlement (claim-A / settle-B / dispute-C)

**Question.** Can an adversary exploit the three-harbor settlement
pattern — file a claim at A, settle on B (taking the funds), then
file a dispute at C — to extract more than a single legitimate
settlement?

**Falsifiable form.** TLA+ model of the settlement state machine
with three roles (claim, settle, dispute) parameterized by which
harbor plays which role. Adversary controls one role at a time and
attempts to construct a trace where the adversary's account
balance increases by more than the legitimate settlement amount.
The invariant `NoDoubleExtract` must hold over all role
assignments. Find a violating trace.

A subtler form: the adversary does not double-extract funds, but
*delays* the dispute past the bond-clear horizon, leaving the
honest party uncompensated even though the dispute is meritorious.
Name the timing condition under which dispute is too late.

**Artifact obligation.** TLA+/Apalache spec at
`whitepaper/formal/tla/federated-harbor/settlement/no-double-extract.tla` (placeholder).
Invariant proved or counterexample trace produced and the protocol
revised.

**Owner.** `fh-redteam:econ` ↔ `fh-whitehat:econ`.

### 6. Equivocation between published harbor tree-heads

**Question.** Can a harbor publish *different* federation tree-heads
to different peers, so that revocations or attestations are visible
to some but not others?

**Falsifiable form.** Tamarin or ProVerif model of tree-head
publication with two observer roles. Adversary controls the
publishing harbor and broadcasts head H1 to observer 1, head H2 ≠
H1 to observer 2. Specify the invariant: any two observers
consistent at epoch e see the same tree-head at epoch e — or the
inconsistency is detectable in bounded time.

This is the CT-log analog: the paper's federation tree must be
gossip-audited or signed-tree-head-cross-witnessed so equivocation
is detectable. If the paper does not commit to a witness
mechanism, the smell is "no equivocation defense."

**Artifact obligation.** ProVerif at
`whitepaper/formal/proverif/federated-harbor/equivocation/witness-cross-check.pv`
(placeholder). Authenticity query: any two observers' accepted
tree-heads at epoch e are equal *or* a witness emitted a
`Disagreement` event.

**Owner.** `fh-redteam:tokens` ↔ `fh-whitehat:tokens`. (Tokens
because tree-head publication is the substrate the tokens reference.)

### 7. Bond-pool draining across administrative boundaries

**Question.** Can an adversary trigger a series of cross-harbor
disputes — each individually legitimate — that drain the joint
bond pool faster than the paper's economic model claims?

**Falsifiable form.** Mesa simulation: adversary holds capabilities
at multiple harbors; files disputes in sequence, each forcing a
bond slash. Compute the rate of bond depletion as a function of
the dispute filing frequency and the bond-replenishment rule. If
the adversary can deplete the pool below the paper's stated safety
floor within N epochs (for some adversary-controlled N), the smell
is real.

A subtler form: bond depletion is fine but the *replenishment*
mechanism asks honest participants to top up at adversary-induced
times. Adversary times disputes to force honest participants to
post bonds at unfavorable bond curve points. Name the timing
attack.

**Artifact obligation.** Mesa simulation at
`whitepaper/research/program/simulations/federated-harbor/econ/bond-drain.py` (placeholder) producing a
depletion curve and a tightened bond curve that resists it.

**Owner.** `fh-redteam:econ` ↔ `fh-whitehat:econ`.

### 8. Cold-start: joining an established federation without prior reputation

**Question.** Can a new harbor extract more value than it posts as
collateral during the cold-start period, before its reputation has
matured?

**Falsifiable form.** Mesa simulation: a new harbor joins a
federation of N seasoned harbors. New harbor posts the minimum
joining bond. Run the harbor's optimal strategy for [PLACEHOLDER-
EPOCHS-N] epochs (the paper's stated cold-start window). Compute
the expected value extracted vs the bond posted. If the ratio
exceeds 1.0 under any plausible strategy, the cold-start window or
the bond curve is wrong.

Sub-probe: a coalition of K new harbors enters together and
cross-attests for each other, accelerating reputation gain. If
joint cold-start is cheaper than the sum of individual cold-starts,
the reputation system is collusion-rewarding.

**Artifact obligation.** Mesa simulation at
`whitepaper/research/program/simulations/federated-harbor/cold-start/extraction-bound.py` (placeholder).
The cold-start window and bond curve are fit so that expected
extraction never exceeds posted bond.

**Owner.** `fh-redteam:econ` ↔ `fh-whitehat:econ`.

### 9. Sybil on the federation-operator layer

**Question.** Who runs harbors? Can one operator pretend to run
many?

**Falsifiable form.** This is *meta*-Sybil: not Sybil among users
of a single harbor (that's Bonded §[N]'s domain), nor Sybil among
harbors (probe 4), but among the *operators* who run harbors.
Operator O₁ runs harbor H₁; can O₁ also run harbors H₂, H₃, …,
Hₖ under different identities, and what does the federation lose?

If the paper claims federation diversity (resilience against any
single-operator failure), construct a probe where one operator
controls k > N/3 of harbors, and show what guarantee the paper
loses. If operator identity is unverified, the smell is "operator
diversity claim is unfalsifiable."

**Artifact obligation.** A protocol obligation, not a proof file:
the paper must commit to an operator-identity binding mechanism
(KYC-of-operators, hardware attestation, mutual cross-witness, or
explicit "no operator diversity claim — federation is bonded, not
diverse"). If the latter, the existing economic claim must be
re-stated to not depend on operator diversity.
Path: `whitepaper/research/program/rounds/federated-harbor/planned/operator-sybil/binding.md` (placeholder)
documenting the chosen mechanism + its falsifiability.

**Owner.** `fh-redteam:econ` ↔ `fh-whitehat:econ` (with `fh-whitehat:trust` for the binding mechanism if it is identity-based).
