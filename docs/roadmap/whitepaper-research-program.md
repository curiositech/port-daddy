# Coordination Papers Research and Implementation Program

Updated: 2026-08-05

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
6. Make Fleet review resumable at ship and chunk boundaries: checkpoint completed
   comments and spend, bound GitHub reads/writes, and ensure a retry cannot replay
   every successful ship after one provider or remote-completion failure.
7. Apply and verify the production migration for `fleet_run_spend`; fail the
   deployment check if the executor schema and Worker code disagree.
8. Turn single-chunk memory ceilings and empty provider responses into explicit,
   exact-head failure receipts. A tracking label is not a substitute for a
   completed review when review protection is waiting on Fleet.
9. Coalesce or discard stale-head deliveries before expensive model work, and
   make the current head SHA visible in the queue, check-run, and review receipt.
10. Make Purser fail closed before retargeting a reviewed PR: resolve every
    referenced path, reject binary-as-text assertions and malformed source
    escapes, execute the generated tests in the real repository harness, and
    preserve the original base unless that exact generated branch is green.

## Current implementation evidence

| Mechanism | Grade | Evidence and remaining boundary |
|---|---|---|
| Durable commitments and obligation monitor | partial | `lib/commitments.ts`, `lib/obligation-monitor.ts`, API/CLI routes, and focused tests ship. Neutral graded outcomes, sanctions, and reputation binding do not. |
| Local actor identity root | partial | `lib/actor-souls.ts`, actor registration, lookup credential, bounded newcomer pool, and budget-guard tests ship. Universal write-boundary enforcement and legacy migration do not. |
| Execution checkpoint | partial | Recovery passes durable notes and summaries, not portable execution state. |
| Cross-operator attestation and federation runtime | specified/proposed | Protocols and bounded models exist; the mutually sovereign deployed path and conformance chain remain open. |
| Reproducible collected-volume publication | implemented | The deterministic generator fails closed on missing sources, cyclic imports, missing citations, and namespace collisions; the build pins source epochs and produces the seven standalone artifacts plus the collected root. Production publication still requires the receipt below. |
| Exact-head Fleet publication review | partial | GitHub records a Fleetbot request signal and the executor rejects stale heads, but the August 5 publication run exposed one- and two-chunk memory failures, empty provider responses, replayed work, and a missing production `fleet_run_spend` table. A successful exact-head Fleet receipt remains the closure condition. |
| Purser adversarial-test gate | partial | Purser can state a useful steel-manned contract and retarget a PR through generated tests, but publication review produced tests that parsed a PDF as HTML, referenced absent files, or used malformed TeX string escapes. The operator rejected those branches; generation is not authoritative until the candidate tests execute successfully before retargeting. |

## Exit criteria

The program is not “done” when the prose is persuasive. It is done when every
load-bearing claim is one of: (a) proved under named assumptions and linked to a
conforming implementation; (b) empirically supported with reproducible evidence;
or (c) explicitly narrowed or rejected. The production library must publish the
same edition and implementation grades that the repository builds.

### Publication receipt contract

Every published edition must append one immutable receipt that records, together:

- the landed source commit and volume edition;
- the mega-volume route, page count, byte count, and SHA-256 digest;
- the route and SHA-256 digest of each of the seven standalone papers;
- the production library deployment identifier and verification timestamp.

The release item stays `now` until those values are read back from production and
match the landed artifacts. A preview URL, local build, or CI artifact is evidence
for the release, but is not the release receipt.
