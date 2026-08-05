# Coordination Papers Research and Implementation Program

Updated: 2026-08-04

Registry authority: `roadmap_items` in harbor `port-daddy`

Collected volume: `link:coordination-papers-mega-volume`

## Purpose

The seven Coordination Papers now form one research program: local coordination
kernel, operator legibility and authority, durable agent identity, capability
security, bonded accountability, harbor economics, and federation. This roadmap
keeps three kinds of work separate so a formal result is never mistaken for a
runtime guarantee:

- **Paper work** sharpens definitions, assumptions, counterexamples, and the
  cross-chapter argument.
- **Proof and empirical work** establishes which claims survive adversarial or
  measured conditions.
- **Runtime work** closes the implementation gaps identified by the papers.

The status vocabulary matches the volume: **implemented** means a running and
tested artifact; **partial** means a running slice that does not satisfy the full
contract; **specified** means a concrete mechanism or model without a shipping
realization; **proposed** means an open research direction.

## Roadmap registry

| Link | Status | Outcome |
|---|---|---|
| `link:coordination-papers-mega-volume` | now | Ship the cohesive volume, global contents and references, consolidated implementation ledger, visual audit, library surface, and production artifact. |
| `link:coordination-papers-proof-program` | backlog | Close theorem, security, game-theoretic, conservation, dissemination, and model-to-runtime proof obligations. |
| `link:coordination-papers-empirical-program` | backlog | Measure the parameters and failure modes the formal claims depend on; publish reproducible traces. |
| `link:coordination-papers-runtime-closure` | backlog | Build the missing identity, outcome, checkpoint, relay, revocation, custody, settlement, and projection-consistency mechanisms. |

## A. Add to the papers

1. Maintain one volume-wide assumption and notation concordance. Every symbol,
   trust root, failure model, clock assumption, oracle, and unit of account gets
   one canonical meaning plus chapter-local aliases.
2. Add a claim-to-artifact matrix for every theorem and security property:
   specification, proof/model, executable conformance test, deployed witness, and
   known counterexample.
3. Add compact adversarial case studies spanning the whole stack: identity reset,
   false completion, verifier capture, partitioned revocation, escrow bypass,
   redelivery, and operator override.
4. Add a comparative chapter or appendix positioning the stack against FIPA/JADE,
   actor systems, capability security, tuple spaces, mechanism design, distributed
   ledgers, and modern agent runtimes without flattening their threat models.
5. Keep an editioned implementation ledger in every release and link each status
   row to concrete source, test, model, or deployment evidence.

## B. Prove

1. State each game with players, information, timing, action space, payoffs,
   deviations, equilibrium concept, and parameter region. Prove or falsify the
   claimed honest-strategy result under collusion, Sybils, cheap reset, judge
   capture, delayed evidence, and bounded rationality.
2. Close the grading-oracle recursion: define independence and conflicts, specify
   appeals and re-audits, and establish conditions under which error contracts
   rather than merely moving to another judge.
3. Prove settlement and custody conservation per unit of account, then state the
   additional valuation assumptions needed for cross-currency exposure.
4. Derive dissemination safety and liveness separately for connected operation,
   finite partitions, redelivery, reordering, and equivocation. Map model rounds
   to measured wall-clock distributions rather than asserting a deadline.
5. Establish a model-to-runtime conformance chain for capability attenuation,
   sealed relay, custody, revocation, and settlement. Record bounds such as chain
   depth and adversary class explicitly.
6. Characterize the Proof-of-Attention game class and either prove approximation
   or tightness bounds for the proposed allocation rule, or narrow the claim.

## C. Try and measure

1. Calibrate operator miss and false-alarm costs, detection probability, slash
   probability, discount factors, and payoff ranges using replayable workloads.
2. Run judge-validity experiments with seeded defects, blind duplicate ratings,
   conflict graphs, appeals, and re-audits; report inter-rater reliability and
   adversarial catch rates.
3. Chaos-test crash recovery, at-least-once delivery, duplicated messages,
   partitions, revocation lag, stale custody, and restart/resurrection across all
   supported adapters.
4. Attack identity-reset laundering by minting fresh actors under shared budgets
   and bonds; measure whether any legacy or bypass path restores a clean slate.
5. Publish small, versioned trace bundles that reproduce each empirical figure and
   link them from the relevant theorem or status row.

## D. Add to the code

1. Extend the shipped commitment substrate into a reputation-grade
   witnessed-outcome ledger with neutral grading events, identity binding,
   conflicts, appeals, sanctions, and append-only correction.
2. Require daemon-minted actor credentials at every security-relevant write
   boundary; migrate legacy asserted identifiers and test impersonation/reset
   failures end to end.
3. Build portable execution-state checkpoint and successor restoration where an
   adapter can support it, and expose an explicit unsupported grade elsewhere.
4. Implement HPKE-style sealed cross-harbor relay, witness-log revocation,
   non-bypassable custody, and a minimal settlement prototype behind conformance
   tests and fault injection.
5. Make every roadmap and status projection identify its authority source and fail
   loud on divergence; close the current fragmented-projection class rather than
   reconciling counts by hand.

## Current implementation evidence

| Mechanism | Grade | Evidence and remaining boundary |
|---|---|---|
| Durable commitments and obligation monitor | partial | `lib/commitments.ts`, `lib/obligation-monitor.ts`, API/CLI routes, and focused tests ship. Neutral graded outcomes, sanctions, and reputation binding do not. |
| Local actor identity root | partial | `lib/actor-souls.ts`, actor registration, lookup credential, bounded newcomer pool, and budget-guard tests ship. Universal write-boundary enforcement and legacy migration do not. |
| Execution checkpoint | partial | Recovery passes durable notes and summaries, not portable execution state. |
| Cross-operator attestation and federation runtime | specified/proposed | Protocols and bounded models exist; the mutually sovereign deployed path and conformance chain remain open. |

## Exit criteria

The program is not “done” when the prose is persuasive. It is done when every
load-bearing claim is one of: (a) proved under named assumptions and linked to a
conforming implementation; (b) empirically supported with reproducible evidence;
or (c) explicitly narrowed or rejected. The production library must publish the
same edition and implementation grades that the repository builds.
