# Chapters 6–8: reading, concept development, and verification

Scope: canonical chapter sources, including every exercise/solution, appendix and bibliography. The reader model is a competent systems engineer who has not learned the book's economic or topological vocabulary. Applied `textbook-craft`, the chapter template, exercise design, and reader-eye guidance. No local Port Daddy runtime was used.

## Reading evidence

The linked worktree and branch were verified before writes: `/Users/erichowens/coding/tmp/book-textbook-craft-20261103`, `codex/book-textbook-craft-20261103`; Git metadata is `/Users/erichowens/coding/port-daddy/.git/worktrees/book-textbook-craft-20261103`.

All **7,776 original canonical source lines** were read sequentially. This count includes LaTeX setup and comments; it is not a word count or a claim about rendered pages. Truncated previews were not treated as coverage. Chapter 8's truncated middle was reread. The accompanying JSON records exact original hashes, intervals, and resulting hashes. Transitive figure sources and final rendered spreads need their own review; they are not silently counted here.

| Chapter | Source | Original lines | Original SHA256 |
|---|---|---:|---|
| 6 | `website-v2/public/whitepaper/harbor-economy.tex` | 3431 | `399ca5d771a5bd8f07e5b68d8170e9af10d070592cb7df5e0672febcb9efa485` |
| 7 | `website-v2/public/whitepaper/agent-transactions-whitepaper.tex` | 2434 | `7c3d712a488e706727756b0ce459d7aa7ebc42412540a44e88e517e8e9af5ab7` |
| 8 | `website-v2/public/whitepaper/federated-harbor-whitepaper.tex` | 1911 | `d7c800511f8d67cc8b951bc60b8eacb810bb187ca33fd3ced08e48980a306292` |

## Chapter 6: markets and assurance

The strongest teaching material is the sequence of concrete counterparties and the explicit settlement arithmetic. Its weakest points were a formal conflict grammar before the witness that motivates it, a queueing theorem whose rates and units were not introduced locally, and an assurance section after the chapter's own review and exercises.

Completed:

- In `sec:three-sides`, distinguish three purchases from three distinct platform populations. Teach Poisson arrivals, exponential service/repair clocks, the stability requirement, accountability value A, waiting price w, the time-unit cost line K, and dimensionless D before the succession formula. The review now states what D* actually thresholds.
- In the deontic section, place the complete production-write conflict witness before the grammar. Define ground statements and Horn propagation in plain language. The disjunction exercise now explicitly supplies the two rules its solution needs; it no longer silently invents them.
- In `sec:one-settlement`, the green-only licence now pays zero on Partial; the entire reserve is refunded. With the explicitly stated delivered-runtime lease clause, the combined Partial ledger is -210+100+50+0+60=0. This makes the contract clause and number agree.
- In `sec:keystone`, replace impossible exercise premises with a genuine counterexample: prepaid, hash-addressed licensing need not depend on persistent agent personhood. Durable principal liabilities, quotas and reputation still require their own binding.
- In `sec:ms`, distinguish the three properties retained by the example double auction from the fourth it cannot achieve under the bilateral hypotheses. Do not infer the full market's sacrificed corner from that slice.
- In federation exposition, FLP limits guaranteed termination under its asynchronous crash model. A periodic send schedule supplies no delivery bound. These claims were checked against the primary FLP paper.
- In reputation/cartel discussion, distinguish growing outcome records from monotonically improving scores. Concavity alone does not cap pair credit: sqrt(n) is the nonexample; a bounded exponential schedule illustrates the needed extra assumption.
- In `sec:gaps`, inaccessible escrow is a liveness failure even when the supply identity holds. The table now agrees with its own 560-credit example.
- Move `sec:adversarial-tests` before Review/Exercises. Add a worked transfer exercise: independent miss probability .4^k requires six reviewers for one percent, costing12 recruitment credits at two per reviewer; bounties remain separate. Perfectly shared blind spots defeat the product formula. Held-out mutants reduce direct leakage, but do not prove generalization.

Primary-source correction: [Chiu, Zhang and van der Schaar](https://arxiv.org/html/2512.04988v1) models reputation as information in a simulated agent labor market, not an independently priced third participant side. The chapter now attributes that narrower connection. [Fischer, Lynch and Paterson](https://groups.csail.mit.edu/tds/papers/Lynch/jacm85.pdf) supplies the precise nontermination boundary.

## Chapter 7: authority, evidence, incentives

The repeated-game section already has useful stage payoffs, a worked threshold, and negative controls. Its instructional problem was uneven scope: careful hypotheses in theorem boxes were contradicted by absolute claims in nearby prose, summaries, and solutions.

Completed:

- Introduce correlated equilibrium with a fully numerical proceed/defer recommendation and a payoff-change counterexample before the obedience inequality.
- State that consent depends on outside options; a table of useful services is not a dominance proof.
- Keep capability inclusion conditional on complete mediation and model scope. A Git worktree separates ordinary edits but is not a sandbox against the same user. The worked manifest/card example now distinguishes two promised files from a wider `tests/**` capability.
- Teach mutable view versus immutable evidence with strength8, half-life10min, value2 after20min, then revocation0. Add a later exercise that also tests what authenticated inclusion cannot prove.
- Repair Sen retellings and exercises so the precautionary-lock example remains a conditional example, not a universal theorem about lock managers.
- Describe recovery as continuation from retained artifacts, not preservation of all cognition. A crash at minute12 detected90 seconds later belongs in a12–14 minute phase.
- Separate cleanup coverage from deterrence: bond6 covers cost5 but a retained gain10 with detection.5 still yields profit7. Make the cleanup floor conditional on its funding policy and preserve it under reputation discounts using max(c, discounted quote).
- Make the oracle protocol coherent when the human judge is sampled rather than present on every case. The unsampled path is provisional; disagreement or abstention triggers arbitration. Sampling probability must be multiplied by conditional audit sensitivity.
- The lifecycle listing is an excerpt, not a proof that all three layers compose. A Tick-only continuation shows why the displayed fairness assumptions do not imply eventual salvage. Positive escrow and fund conservation are distinct invariants.
- Repair the TLA exercise to explicitly retain `minted` instead of omitting its next-state constraint. Repair the magic-link exercise's private-mailbox baseline and injective-event notation.
- Replace undefined CC/NC/RP/NS abbreviations with the concrete information, entry, coverage and baseline assumptions actually available in the chapter.

## Chapter 8: federation and consistency

The strongest material is the distinction between a consistency certificate and a finding of guilt. The largest teaching obstruction was introducing vector spaces, sheaf terminology, visibility, projection, and several operators before letting the reader compute one inconsistency.

Completed:

- Retain destination authority even when it verifies a foreign signature; verification is not surrender of sovereignty. State that parent revocation requires an enforced dependency, not merely receipt of a new root.
- Define the numerical stalk and coordinate restriction in ordinary terms. Distinguish channel observations g from differences delta x of one fixed assignment; constructing the input as delta x would force zero residual.
- Move the complete C4/chain/dark-link hand calculation before the detector theorem. Define effective resistance through a one-ohm parallel circuit before using the formula. State feature units and avoid interpreting r as a dishonesty probability.
- Explain A_q, projection, kernel, observable offset component and singular values before the quantitative repair statement. The operational paragraph now says unrestricted correction norm, not smallest admissible lie.
- Introduce one-hot A=(1,0), B=(0,1), equality edges and endpoint pins before the categorical theorem. The contradictory path example comes first; its empty equality path explains the least-cost certificate. Add a later transfer exercise.
- Explain why detecting and locating an erroneous edge differ: C4 errors on two different edges have the same syndrome. Define grouped support before the min-cut/distance rule.
- A positive cuckoo-filter lookup needs exact evidence. Rebuilding with the same hashes does not erase the underlying false-positive event.
- Repair the main test-database to staging-database example: this is token exchange plus a new local grant under an explicit mapping, not subset attenuation across different resource universes.
- Replace the claimed expected log2(m) finite-size gossip count with an ideal doubling lower bound and an exact three-node calculation: expected completion7/3 rounds in the specified push model.
- Sponsorship graduation requires declared evidence and replacement coverage, not elapsed time alone. The all-oracle cartel discussion now puts lost continuation value on the loss side, rather than claiming concavity raises the gain term.

## Verification performed

- Owned-file `git diff --check`: pass.
- LaTeX environment open/close counts: balanced in all three sources. Exercise/solution counts:35/35,17/17,12/12. These are structural checks, not compiler or pedagogy verdicts.
- `python3 scripts/harbor-research/check_propagated_corrections.py`:14 RESOLVED,0 stale,0 manual review.
- Independent Python arithmetic and NumPy least squares: Partial ledger0; assurance .4^5=.01024 and .4^6=.004096; queue effective rate1.6667, floor2.6667, exact response8.1667 versus naive4.1667; threshold signs at.30/.34/.35; floor-preserving discount5; deviation gain7; decay2; three-node gossip7/3; C4 residual1.5 and equal syndromes for alternate one-edge errors.
- Exhaustive two-value enumeration: each singleton receipt on the categorical path has two assignments; the pair has none. Its minimum certificate therefore costs5.

At initial report completion no full book build or final spread inspection had been completed. Build orchestration was subsequently delegated to this agent; the current status is recorded below. Parent retains exercise registration, theorem/index validation, bibliography integration, and final publication checks. Three new exercise IDs are listed in the JSON.

## Remaining obligations and handoffs

1. **Rendered sequence:** review the moved deontic and assurance sections, earlier C4 example, new mediator example, and new one-hot lead-in in two-page spreads. Formula lines and narrow captions may require reflow.
2. **Figure follow-through:** parent has delegated the corresponding federation-worked-example, gossip, and lifecycle art after this report. Their status is recorded separately below when done. No other figure is claimed read or repaired by this report.
3. **Source-present versus deployed:** the chapters still contain implementation-status statements beyond this pedagogical audit. The full runtime/hosted proof inventory must be reconciled before asserting publication readiness; canonical source reading is not deployment validation.
4. **Citation and comparison audit:** FLP and Chiu corrections were checked against primary sources. Broad platform-comparison paragraphs and historical adoption claims need their own source review; this pass does not certify them.
5. **Non-orphan contrasts:** contextuality, spectral diffusion, and native-unit valuation are retained because they delimit tempting invalid conclusions and return in exercises/open questions. Their presence is not a claim of a new theorem. The concept JSON identifies later substantive uses for each important idea.
6. **Research boundaries:** no live-LLM trial, new equilibrium, deployment-specific gossip deadline, runtime custody proof, or attribution guarantee was manufactured to fill an exposition gap.

## Concept lifecycle ledger

The JSON is the machine-readable authority for this slice. Each row states a first anchor, concrete example, distinct later use and action; mere repeated words were not counted as reuse.

| Chapter | Concept | First anchor | Later use | Editorial action |
|---|---|---|---|---|
| 6 | Labor, rental and licensing | `sec:three-sides` | `sec:one-settlement` — Combined settlement and participation constraints | Clarified contract types versus economic platform sides |
| 6 | Private information and adverse selection | `sec:three-sides` | `sec:one-settlement` — Licensing, reputation and oracle design | Preserved distinction between hidden quality and reliable grading |
| 6 | Succession and queue stability | `thm:succession-price` | `fig:he-succession-price` — 8.1667-hour canary and dimensionless D* review | Added rates, independence, stability, response-time units and accountability value |
| 6 | Float Plan | `sec:float-plan` | `sec:one-settlement` — Combined labour/rental/licence escrow | Kept bounty, collateral and contingent fees separate |
| 6 | Conservation | `prop:conservation` | `sec:gaps` — 560 conserved but inaccessible credits | Corrected safety versus liveness in gap table |
| 6 | Control rights | `sec:three-on-one` | `ex:he-grossman-hart-roles` — Locate authority over leased worker | Preserved capability versus normative permission distinction |
| 6 | Horn closure and deontic conflict | `def:lc-fragment` | `thm:he-reachable-admission` — Future-fact policy admission | Moved witness before grammar; defined Horn and ground; repaired disjunction exercise |
| 6 | Tractable fragment and NP frontier | `thm:deontic-detect` | `ex:he-deontic-conflict-checker` — Independent extra conflict and growth of discharge choices | Preserved algorithm versus slower reference implementation distinction |
| 6 | Reachable maximal fact sets | `sec:he-reachable-admission` | `thm:he-reachable-admission` — Admission contract must name reachable family | Retained useful nonexample rather than infer all facts may co-occur |
| 6 | Licensing settlement | `sec:one-settlement` | `sec:one-settlement` — Partial green-only policy pays0 and refunds10 | Reconciled clause and arithmetic |
| 6 | Persistent principal and Sybil | `sec:keystone` | `ex:he-no-identity-market` — Prepaid hash-addressed licensing counterexample | Replaced exercises asserting every market needs agent personhood |
| 6 | Myerson-Satterthwaite | `sec:ms` | `ex:he-ms-assumptions` — Check hypotheses before transferring impossibility | Separated three satisfied properties from full-market sacrificed corner |
| 6 | Native units and valuation | `sec:fh-settlement` | `ex:he-two-currency-example` — 10A+20B valued50 then70 without transfer | Retained quantitative nonexample |
| 6 | Revocation and reliance | `sec:ic` | `prop:no-saga` — Finite appeals and monitoring | Changed monotone reputation-score slogan to growing evidence and changing scores |
| 6 | FLP and delivery assumptions | `sec:fh-settlement` | `sec:fh-revocation` — Expected dissemination versus hard deadlines | Corrected universal consensus impossibility and send-interval inference against primary source |
| 6 | Wash trading | `sec:cartel` | `sec:cartel` — Cap example and sampled audit | Distinguished concavity from boundedness; sqrt(n) nonexample |
| 6 | Assurance panels | `sec:adversarial-tests` | `ex:he-assurance-budget` — Six reviewers and12 fixed recruitment credits | Moved section before review/exercises; added joint-dependence counterexample |
| 6 | Grader accountability | `sec:ic` | `sec:adversarial-tests` — Keep-gain deterrence and mutation-testing assumptions | Preserved evidence versus judgment and finite terminal authority |
| 7 | Commons authority | `sec:commons` | `app:worked` — Full task through claim, crash and settlement | Qualified participation payoff relative to outside option |
| 7 | Correlated equilibrium | `sec:correlating-device` | `sec:claim-signaling-ic` — Conditional obedience versus repeated-game enforcement | Added numeric motivation and payoff-change nonexample |
| 7 | Capability attenuation | `sec:structural` | `app:worked` — Manifest scope narrower than tests/** card | Preserved mediation assumption and separated proof model from deployed operations |
| 7 | Isolation | `sec:isolation` | `sec:pricing:threats` — Structural boundaries for dangerous tasks | Clarified worktree separation is not same-user access control |
| 7 | Evidence commitment | `sec:merkle-forest` | `sec:pricing:settlement` — Receipt authenticates record but cannot judge outcome | Corrected membership-versus-truth interpretation |
| 7 | Mutable signal over immutable ledger | `sec:pheromones` | `ex:bonded-signal-view` — View and retained evidence diverge usefully | Added worked arithmetic and transfer exercise |
| 7 | Advisory claims and Sen | `sec:sen` | `ex:bonded-advisory-claims` — Collision nonexample and negotiation cost | Removed universal Sen-to-lock welfare inference from body/summary/exercise |
| 7 | Fairness and governance | `sec:governance` | `sec:tlaplus` — Tick-only trace blocks eventual salvage | Stated release/selection assumptions and missing model fairness |
| 7 | Social recovery | `sec:crash-recovery` | `app:worked` — Crash at12, detection13.5, completion24 | Distinguished retained artifacts from complete model-state recovery |
| 7 | Bounty and bond | `def:bonded-float-plan` | `sec:youle` — Coverage partition insurer/principal | Preserved local versus federated custody distinction |
| 7 | Repeated claim-signaling game | `sec:claim-signaling-ic` | `sec:youle:a6` — Different cartel timing recurrence | Clarified monitoring is a hypothesis and threshold root is not total payoff |
| 7 | Cost recovery versus deterrence | `sec:cleanup-bound` | `sec:rep-discount` — Floor-preserving discount max(c,quote*(1-rho)) | Added gain7 counterexample and conditional cleanup theorem |
| 7 | Settlement oracle | `sec:pricing:settlement` | `sec:youle:a6` — Audit detection sigma*d_h needs own game | Defined unsampled provisional path and dissent escalation |
| 7 | Competitive insurance | `sec:youle` | `ex:bonded-insurance-alt-pricing` — Compare explicit baseline with costs and capital | Replaced undefined CC/NC/RP/NS shorthand with concrete assumptions |
| 7 | Capped insurer deposits | `sec:youle:a5` | `ex:bonded-a5-coverage-bound` — Profit8 versus full-forfeiture minus1 | Retained contract-dependent limit |
| 7 | Cartel detection | `sec:youle:a6` | `ex:bonded-cartel-detection` — delta.99 gives97/1797 | Preserved timing assumptions rather than import claim-signaling threshold |
| 7 | Expressive-act taxonomy | `sec:taxonomy` | `sec:pricing` — Different loss and participation constraints | Removed unsupported inevitable market-collapse claim |
| 7 | Evidence-growth score | `sec:vibe` | `sec:vibe` — Independent evaluation and privacy/replay requirements | Retained units and honest-thinking zero-score nonexample |
| 7 | Lifecycle and financial invariants | `sec:tlaplus` | `sec:conservation` — Three-bucket transfer and separate liveness | Clarified excerpt scope and conservation distinct from positive escrow |
| 7 | Magic-link injectivity | `sec:federated-sovereign` | `ex:bonded-magic-link-proverif` — Private mailbox baseline plus compromise process | Corrected exercise authentication notation and secrecy premise |
| 8 | Sovereignty | `def:fh-sovereignty` | `sec:fh-ex-xfer` — Destination issues staging grant | Separated foreign signature verification from loss of local authority |
| 8 | Witnessed epochs | `sec:fh-witness` | `ex:fh-revocation-finality` — External monotone epoch blocks rollback | Preserved local check versus propagation distinction |
| 8 | Token transfer and resource mapping | `sec:fh-xfer` | `sec:fh-ex-xfer` — Test-to-staging exchange needs independent destination grant | Repaired main example to obey theorem shared-universe premise |
| 8 | Revocation dependency | `sec:fh-xfer-compose` | `sec:fh-revocation` — Verifier refuses parent-invalid derivative | Observing a root alone no longer claimed to revoke a card |
| 8 | Epidemic dissemination | `thm:fh-conv` | `sec:fh-partition` — Expectations do not bound partitions | Corrected ideal doubling as best-case lower bound |
| 8 | Probabilistic cache | `sec:fh-cuckoo` | `sec:fh-revocation` — Exact authenticated check after cache positive | Rebuilding no longer claimed to cure same-hash false positives |
| 8 | Stalk/restriction/cochain | `sec:fh-sheaf` | `thm:sheaf-equivocation` — C4 residual1.5 versus chain0 | Defined construction that can actually be non-exact |
| 8 | Visible coordinate topology | `sec:fh-sheaf` | `ex:fh-consistency-radius-run` — Same physical ring darkens after one severed edge | Moved complete four-number example before theorem |
| 8 | Effective resistance | `thm:radius-soundness` | `ex:fh-consistency-radius-run` — C6 residual1.224745; P6 zero | Defined normalization and residual units before formula |
| 8 | Repair support and attribution | `thm:radius-soundness` | `thm:radius-localization` — Noise support and ranking gap2nu | Corrected smallest-lie retelling to unrestricted correction norm |
| 8 | Visible lie operator and kernel | `thm:radius-soundness` | `ex:fh-two-liar-boundary` — Multiple offsets can cancel even for one sender | Explained singular values and preserved soundness under cancellation |
| 8 | Categorical contradiction | `thm:categorical-certificate` | `ex:fh-categorical-versus-linear` — Cost5 path contradiction despite real residual0 | Introduced one-hot and pins before theorem with explicit arithmetic |
| 8 | Grouped code distance | `sec:fh-evidence-decision` | `sec:fh-evidence-decision` — K4 mincut3 identifies one grouped error | Defined support units and why detection differs from identification |
| 8 | Custody transition bound | `sec:fh-escrow` | `sec:fh-settle-proto` — 2-of3 signing does not establish oracle correctness | Preserved explicit recipient enforcement and trust boundary |
| 8 | Lifecycle versus recipient accounting | `prop:fh-cross-cons` | `ex:fh-synthesis` — Local verification does not prove remote custody | Retained separate quantities and invariant obligations |
| 8 | Sponsored admission | `sec:fh-sponsor` | `ex:fh-cold-start-admission` — Entry/concentration/selection metrics | Graduation requires criteria and funded replacement, not elapsed time alone |
| 8 | Formal-model scope | `sec:fh-formal` | `ex:fh-proverif-federation` — All-shares compromise negative control | Retained explicit artifact limitations |
| 8 | Common knowledge and cross-harbor games | `sec:fh-lim-correlated` | `ex:fh-correlated-equilibrium` — CCE versus CE and missing-evidence policy | Retained distinct information and incentive obligations |
| 8 | Diffusion versus gossip | `sec:fh-lim-equiv` | `ex:fh-equivocation-speed` — Scheduler/noise model required before time-to-alarm theorem | Useful contrast is revisited; no new convergence claim |

## Figure follow-through and candidate build

Six complete figure sources were read. The four delegated semantic retellings now agree with their chapters: staging access needs a destination-local grant; transfer verification uses the public key; parent revocation requires an enforced dependency; the gossip trace carries no three-round expectation; lifecycle arrows do not establish eventual salvage. No same-name mirrors were present for these four fragments. Their TikZ precheck passed. The float-plan timeline and federation assurance axis also received label-width corrections after actual candidate overfull warnings.

Follow-through reconciled Chapter6 summary prose with its contract-type distinction. Neither three purchase types nor three private-information problems establishes a three-sided platform; reputation is not a universal existence condition for licensing. The proposed reputation-priced contracts need attributable outcome histories, while a prepaid licence for known content can trade without them. A payment adapter needs explicit authorization and finality obligations, rather than a claim that external rails are interchangeable.

The candidate build uses the private Suisse profile and XeLaTeX through the existing bounded `run_tex_passes` helper. It writes only `.cache/whitepaper-build/coordination-papers-mega-volume` and `.scratch/textbook-craft-20261103`, with no publication copy or metadata update. Initial Chapter0 metadata failure was handed to the parent and repaired. A full first pass produced823 pages; this is preliminary pagination, not the final artifact. Source-specific overfulls were assigned to their chapter owners. Final convergence and facing-spread review remain pending.

Candidate03 converged in three XeLaTeX passes at837 pages, with zero undefined references and zero head-height warnings. Six remaining overfulls were assigned by exact source; this is not the clean final artifact. In the rendered Ch7 verification table, the caption had defined completion more strongly than its own model/runtime rows. Its definition now scopes completion to the stated check and explicitly separates model results from runtime and deployment evidence. The Ch6 deontic solution was split into inference, observed checker output, added-rule cases, and complexity explanation. The adjacent Sybil exercise now demonstrates an equal-weight alias attack and its limits instead of asserting that every reputation mechanism is impossible.

The reassigned Chapter4–5 agent handed off two exact layout repairs: explicit path-piece breaks in the specialization command and a wider top-timeline tombstone label. Both canonical/public mirrors were repaired; no other Chapter4–5 changes were made by this agent.
