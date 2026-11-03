# Chapters 6–8: reading, concept development, and verification

Scope: canonical chapter sources, including every exercise/solution, appendix and bibliography. The reader model is a competent systems engineer who has not learned the book's economic or topological vocabulary. Applied `textbook-craft`, the chapter template, exercise design, and reader-eye guidance. No local Port Daddy runtime was used.

## Reading evidence

The linked worktree and branch were verified before writes: `/Users/erichowens/coding/tmp/book-textbook-craft-20261103`, `codex/book-textbook-craft-20261103`; Git metadata is `/Users/erichowens/coding/port-daddy/.git/worktrees/book-textbook-craft-20261103`.

All **7,776 original canonical source lines** were read sequentially. This count includes LaTeX setup and comments; it is not a word count or a claim about rendered pages. Truncated previews were not treated as coverage. Chapter 8's truncated middle was reread. The accompanying JSON records exact original hashes, intervals, and resulting hashes. The eight specified figure sources and selected rendered spreads are recorded separately below; they are not silently included in that source-line count.

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
- In `sec:gaps`, inaccessible escrow is a liveness failure even when the supply identity holds. The table, its caption, and the 560-credit example agree on that distinction.
- The licensing paragraph treats contingent payment and authenticated outcome history as proposed responses to hidden quality. Akerlof does not uniquely force a green-only licence; a known, inspectable skill can support an upfront price. Merkle inclusion authenticates records, not their quality.
- Move `sec:adversarial-tests` before Review/Exercises. Add a worked transfer exercise: independent miss probability .4^k requires six reviewers for one percent, costing 12 recruitment credits at two per reviewer; bounties remain separate. Perfectly shared blind spots defeat the product formula. Held-out mutants reduce direct leakage, but do not prove generalization.

Primary-source correction: [Chiu, Zhang and van der Schaar](https://arxiv.org/html/2512.04988v1) models reputation as information in a simulated agent labor market, not an independently priced third participant side. The chapter now attributes that narrower connection. [Fischer, Lynch and Paterson](https://groups.csail.mit.edu/tds/papers/Lynch/jacm85.pdf) supplies the precise nontermination boundary. [Akerlof’s 1970 article](https://www.sfu.ca/~allen/Ackerlof.pdf) motivates the conditional adverse-selection claim; its model is not a theorem that this particular licensing contract is necessary.

## Chapter 7: authority, evidence, incentives

The repeated-game section already has useful stage payoffs, a worked threshold, and negative controls. Its instructional problem was uneven scope: careful hypotheses in theorem boxes were contradicted by absolute claims in nearby prose, summaries, and solutions.

Completed:

- Introduce correlated equilibrium with a fully numerical proceed/defer recommendation and a payoff-change counterexample before the obedience inequality.
- State that consent depends on outside options; a table of useful services is not a dominance proof.
- Keep capability inclusion conditional on complete mediation and model scope. A Git worktree separates ordinary edits but is not a sandbox against the same user. The worked manifest/card example now distinguishes two promised files from a wider `tests/**` capability.
- Teach mutable view versus immutable evidence with strength 8, half-life 10 minutes, value 2 after 20 minutes, then revocation 0. Add a later exercise that also tests what authenticated inclusion cannot prove.
- Repair Sen retellings and exercises so the precautionary-lock example remains a conditional example, not a universal theorem about lock managers.
- Describe recovery as continuation from retained artifacts, not preservation of all cognition. A crash at minute 12 detected 90 seconds later belongs in a 12–14 minute phase.
- Separate cleanup coverage from deterrence: bond 6 covers cost 5 but a retained gain 10 with detection probability .5 still yields profit 7. Make the cleanup floor conditional on its funding policy and preserve it under reputation discounts using max(c, discounted quote).
- Make the oracle protocol coherent when the human judge is sampled rather than present on every case. The unsampled path is provisional; disagreement or abstention triggers arbitration. Sampling probability must be multiplied by conditional audit sensitivity.
- The lifecycle listing is an excerpt, not a proof that all three layers compose. A Tick-only continuation shows why the displayed fairness assumptions do not imply eventual salvage. Positive escrow and fund conservation are distinct invariants.
- Repair the TLA exercise to explicitly retain `minted` instead of omitting its next-state constraint. Repair the magic-link exercise's private-mailbox baseline and injective-event notation.
- Replace undefined CC/NC/RP/NS abbreviations with the concrete information, entry, coverage and baseline assumptions actually available in the chapter.

## Chapter 8: federation and consistency

The strongest material is the distinction between a consistency certificate and a finding of guilt. The largest teaching obstruction was introducing vector spaces, sheaf terminology, visibility, projection, and several operators before letting the reader compute one inconsistency.

Completed:

- Retain destination authority even when it verifies a foreign signature; verification is not surrender of sovereignty. Define private signing key `sk_A` and corresponding public verification key `pk_A` at their first use; transfer verification uses `pk_B`, while issuance signs with `sk_B`. State that parent revocation requires an enforced dependency, not merely receipt of a new root.
- Define the numerical stalk and coordinate restriction in ordinary terms. Distinguish channel observations g from differences delta x of one fixed assignment; constructing the input as delta x would force zero residual.
- Move the complete C4/chain/dark-link hand calculation before the detector theorem. Define effective resistance through a one-ohm parallel circuit before using the formula. State feature units and avoid interpreting r as a dishonesty probability.
- Explain A_q, projection, kernel, observable offset component and singular values before the quantitative repair statement. The operational paragraph now says unrestricted correction norm, not smallest admissible lie.
- Introduce one-hot A=(1,0), B=(0,1), equality edges and endpoint pins before the categorical theorem. The contradictory path example comes first; its empty equality path explains the least-cost certificate. Add a later transfer exercise.
- Explain why detecting and locating an erroneous edge differ: C4 errors on two different edges have the same syndrome. Define grouped support before the min-cut/distance rule.
- A positive cuckoo-filter lookup needs exact evidence. Rebuilding with the same hashes does not erase the underlying false-positive event.
- Repair the main test-database to staging-database example: this is token exchange plus a new local grant under an explicit mapping, not subset attenuation across different resource universes.
- Replace the claimed expected log2(m) finite-size gossip count with an ideal doubling lower bound and an exact three-node calculation: expected completion 7/3 rounds in the specified push model.
- Sponsorship graduation requires declared evidence and replacement coverage, not elapsed time alone. The all-oracle cartel discussion now puts lost continuation value on the loss side, rather than claiming concavity raises the gain term.

## Verification performed

- Owned-file `git diff --check`: pass.
- LaTeX environment open/close counts: balanced in all three sources. Exercise/solution counts:35/35,17/17,12/12. These are structural checks, not compiler or pedagogy verdicts.
- `python3 scripts/harbor-research/check_propagated_corrections.py`:14 RESOLVED,0 stale,0 manual review.
- Independent Python arithmetic and NumPy least squares: Partial ledger0; assurance .4^5=.01024 and .4^6=.004096; queue effective rate1.6667, floor2.6667, exact response8.1667 versus naive4.1667; threshold signs at.30/.34/.35; floor-preserving discount5; deviation gain7; decay2; three-node gossip7/3; C4 residual1.5 and equal syndromes for alternate one-edge errors.
- Exhaustive two-value enumeration: each singleton receipt on the categorical path has two assignments; the pair has none. Its minimum certificate therefore costs5.

The integrated candidate and selected-spread evidence are recorded below. Parent owns exercise registration, theorem/index validation, bibliography integration, and publication delivery. The three new exercise IDs are listed in the JSON.

## Remaining obligations and handoffs

1. **Navigation:** the shared exercise-heading repair is complete. The registered audit checks all 212 exercise labels and destinations against their rendered headings; the machine agent also independently checked all 212 solution destinations. Final candidate acceptance is recorded below.
2. **Completed visual scope:** all 35 selected Chapter 6–8 spreads were directly inspected at 150 dpi, including all three chapter openers and their following pairs. Reuse for a final candidate requires exact image-hash equality; the receipt records that check. The seven delegated figure fragments and caption retellings are complete. This does not claim inspection of every rendered page or every transitive art source.
3. **Source-present versus deployed:** this pedagogical read does not supply runtime or hosted deployment evidence. Ch7’s verification table explicitly scopes each completed check and keeps model results separate from missing runtime obligations.
4. **Citation and comparison scope:** FLP, Chiu, and Akerlof corrections were checked against primary sources. Broad platform-comparison and historical-adoption claims are not certified by this slice’s citation review.
5. **Non-orphan contrasts:** contextuality, spectral diffusion, and native-unit valuation delimit tempting invalid conclusions and return in exercises/open questions. Their presence does not establish a new theorem. The concept JSON records substantive later uses.
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
| 8 | Sponsored admission | `sec:fh-sponsor` | `ex:fh-cold-start-admission` — Successful admissions versus request-cohort metrics | Graduation needs funded replacement; metrics name records, denominators, selection and identification limits |
| 8 | Formal-model scope | `sec:fh-formal` | `ex:fh-proverif-federation` — All-shares compromise negative control | Retained explicit artifact limitations |
| 8 | Common knowledge and cross-harbor games | `sec:fh-lim-correlated` | `ex:fh-correlated-equilibrium` — CCE versus CE and missing-evidence policy | Retained distinct information and incentive obligations |
| 8 | Diffusion versus gossip | `sec:fh-lim-equiv` | `ex:fh-equivocation-speed` — Mathematical correspondence versus deployment validation | Proof/counterexample needs specified processes and observables; traces support operational estimation, not a logical prerequisite |

## Figure follow-through and rendered verification

The bounded federation-history support audit removed the unsupported five-to-ten-year concentration claim, universal adoption claims, and the unproved claim that witness replication makes a dominant hub more expensive. The cold-start summary now states that fees do not establish sponsor supply, and the related-work retelling uses the same topology distinction. [Maler and Reed, p.21](https://css.csail.mit.edu/6.858/2012/readings/identity.pdf) describes both a SAML identity-provider hub and multiple institutional providers in InCommon; it supplies the architectural contrast, not a concentration timeline. [Tailscale's architecture explanation](https://tailscale.com/blog/how-tailscale-works) and [Headscale's primary repository](https://github.com/juanfont/headscale) support the control-plane versus implementation-choice example. [Sigstore's custom-component documentation](https://docs.sigstore.dev/cosign/system_config/custom_components/) supports configurable components, not the discarded deployment-concentration history. The chapter now makes authority concentration, switching cost, and record continuity explicit deployment measurement obligations. This is a bounded audit of those passages, not a full external bibliography validation.

Candidate16's Ch6–8 receipt records 43 selected spreads: 41 actual fresh image inspections and two exact-byte reuses from earlier actual views. The placed conflict-witness diagram, active-session note monotonicity, fairness scope, shared-resource transfer, and paragraph-boundary landmark placements agree with their body premises. Candidate16 remains diagnostic: its scope and local identity-status corrections, and the independently found `lin-` / `eage` page turn, are resolved in the final candidate below. Its diagnostic receipt is retained separately.

Candidate15 selected-spread reading also reconciled the memory-horizon retelling in Chapter6 with the finite-recent-history model, removed two Chapter7 summary claims of proved recovery liveness, and corrected the conflict-witness figure: only the obligation depends on the Horn-derived fact, while the prohibition is unconditional. These are propagation repairs to the stated body premises. The independent retelling pass also scoped the market thesis to reputation-priced trade, identified cross-harbor models as unexecuted sketches, and limited note monotonicity to active sessions. The conflict diagram compiled with the Suisse Book preamble, passed fragment geometry checks, and was directly inspected; final placed validation is covered by the source-bound receipt below.

All 42 assigned candidate14 spreads were directly opened at 150 dpi. This diagnostic review found landmark plates interrupting sentences in Chapters 6–8; the three plate blocks now flush at logical boundaries, before subsequent exposition. The federation witness-log cross-reference resolves the actual Merkle Forest label. Two margin analogies now distinguish a consistency alarm from attribution and local authorization checks from cross-harbor mutual exclusion. Candidate14 is not accepted as the final rendering; these repairs are covered by the final converged build and selected-spread receipt below.

Eight complete figure sources were read. The four delegated semantic retellings agree with their chapters: staging access needs a destination-local grant; transfer verification uses the public key; parent revocation requires an enforced dependency; the gossip trace carries no three-round expectation; lifecycle arrows do not establish eventual salvage. No same-name mirrors were present for these four fragments. Their TikZ precheck passed. The sponsor lifecycle now requires declared criteria and funded replacement coverage before permitted sponsor release; its caption explicitly limits itself to the two depicted paths. The float-plan timeline and federation assurance axis received local geometry corrections that preserve label size and fit the body column.

The Ch6 deontic solution separates inference, observed checker output, added-rule cases, and complexity. The adjacent Sybil exercise demonstrates an equal-weight alias attack and its limits. The Ch7 verification-table caption defines completion as the stated row’s check within its assumptions, not a blanket claim of deployed proof.

Two exact Chapter 4–5 repairs were handed off to this agent: the specialization command now names the script and a breakable directory path in the sole canonical Chapter4 source; the tombstone timeline label is widened in both figure mirrors. Bounded caption repairs also aligned the WAL fault-class table, leakage ledger, split-ranker, and amortization figure with their exhibit bands. The protocol regression retains all nine named identities despite renumbering. The contents regression binds its 17 visual locators to the exact source art: four part plates, nine chapter plates, and four reflection plates.

The admission-metrics prompt and solution (`ex:fh-cold-start-admission`, canonical lines 1706–1740, source SHA256 `7871f858514a754c75a72f79ff700d0bd6be67688be2ee3057301af290ce9843`) were independently read against the admission ceremony. A complete success log permits sponsor-share/Herfindahl summaries, with no value at zero admissions. Ten recorded admissions can arise from ten requests and no refusals or one thousand requests and 990 refusals. Acceptance, waiting-time and reapplication metrics therefore require separate linked request/outcome records, a cohort and cutoff; pending requests and selected completed waits cannot be relabeled as refusals or all-applicant waits. Concentration or disparities can motivate investigation but do not identify a cartel. This is an observational-scope correction, not a new experiment or theorem. Its explicit prompt and solution targets are covered by the final candidate receipt below.

Candidate20 passed its expanded 122-test suite (115 passed, seven skipped), registered PDF gates and the independent all-font page-turn/navigation audits. Its 50 owned selected spreads were reviewed (four direct views, 46 exact-image reuses). It remains diagnostic: root's actual review of the admission-solution pair exposed Exercise8.11's false requirement that a mathematical comparison first obtain deployment traces. The prompt and solution now separate specified processes/observables for a proof or counterexample from operational trace collection, model validation and uncertainty in pricing. The expected gossip round count remains confined to its stated model; no sheaf-rate transfer is claimed. The verification-table explanation now describes the remaining proof, executable-model, empirical or runtime obligation for each row, without unsupported workplan or collaborator commitments. The two table references now use their declared types, Theorem and Design invariant. Canonical repair lines 1742–1770 and 2052, source SHA256 `7871f858514a754c75a72f79ff700d0bd6be67688be2ee3057301af290ce9843`, are covered by the final source-bound candidate and selected-spread receipt below.

Candidate21 passed the same expanded rendered and PDF gates; 51 owned selected spreads were checked by four direct views and 47 exact accepted-image reuses. The repaired prompts, solutions and status explanation are present and readable. Root identified one remaining typography defect in `app:fh-tla`: the complete model path forced excessive justification. The model filename, directory and configuration filename are now separate prose units; all numerical and model-scope claims remain verbatim. Candidate21 remains a diagnostic record; the exact paragraph is accepted in the final source-bound receipt below.

## Bounded paired-plot correction and verified placement

Candidate 24 exposed two local placement defects: Figure 7.8 measured 328.34 pt against a 324 pt body column; Figure 7.11’s tall caption began 26.29 pt above its owner. The paired panels now use 4.2 cm axes with unchanged type, gap, data and key. The cartel caption is concise while retaining all premises, boundary identity, formula, regions and sampled values; its placement remains `[H]`. All six fresh figure/profile renders pass automated failure checks and were actually viewed. Production placement is verified in the final candidate and scoped receipt below.

The family audit directly inspected the engine-swap, tolerance-comparison and Sybil-deposit plots on candidate23 physical pages 459, 628 and 630. The comparison plot’s reporting paragraph contradicted its data. The existing simulation was rerun and reproduced all 36 committed rows byte-for-byte; each configuration uses 2,000 trials of 50 transactions. The plotted rate permits a 3% commons-receipt shortfall and insurer losses up to 5% of static principal cost, so the text and axis now name a tolerance-based comparison rather than exact Pareto dominance. At five insurers, its no-colluder rate falls from 0.861 at zero noise to 0.006 at noise 0.3. The body reports the tested slices without unplotted full-cartel or objective-peak claims.

The artifact’s dependent reporting footer is also corrected: it computes the observed no-noise/no-collusion summary from the simulation counts and explicitly identifies the tolerance-based comparison. The numerical functions, seeds and trial loop are byte-identical; all 36 regenerated numeric rows match. Only console reporting changed.

All four plotted coordinate sequences are unchanged. The figure uses A/B headings and a complete shared ruled series key; the arbitrary 50% line and incorrect invisible ±0.02 Wilson claim are removed. The exact metric, log/source hashes, Wilson counterexample and three actual accepted fragment views are recorded in `render-proof/paired-plot-pareto-repair.json`. Swiss, maritime and technical fragment checks pass; the only B7 warning compares different semantic rows and is justified in the receipt. Candidate23 remains diagnostic; the final production placement is verified by the source-bound receipt below. The related Sybil repair and collision/domain regression implementation belong to the operator lane; this agent made no shared-style or checker edits.


The final integrated candidate was generated from source checkpoint `39c7e2cf708d937317811d69049cce227e1a3393`, with 282 input hashes captured and verified unchanged at convergence. The private Suisse profile was used in place, without copying font assets. XeLaTeX converged in 3 passes at 844 pages. Required log checks found zero overfull horizontal/vertical boxes, undefined references, missing characters, or head-height warnings; margin placement reported complete.

The PDF SHA256 is `b589f090130f5b6f775d88a2f2314456ea762a95f3f1d12bcc6dd982ead581b9` (17,652,139 bytes). Its matching auxiliary and log files are retained with the cache candidate. Fifteen rendered/source suites ran 122 tests: 115 passed and 7 fixture-only or before-comparison checks were skipped. Registered PDF gates checked 263 captions with zero placement failures, all 212 exercise headings/labels/destinations with zero navigation issues, all 1,464 margin objects with zero margin issues, and zero off-paper loss rows. The existing audit lists 74 safety-net picture advisories and 96 whitespace-review pages; these remain distinct from passed fatal gates. Both the original body-text scan and the independent all-font-size body-column audit found zero split-word candidates; their exact PDF hashes match this candidate.

The final gallery contains 109 targets and 148 unique facing spreads at 150 dpi, including all nine chapter openers, the changed teaching sequences, and all twelve authored landmark captions with their following pairs. Every opener matched its own question and epigraph. This slice’s final visual receipt covers 65 selected spreads: the assigned Chapter 6–8 teaching sequences, chapter openers and following pairs, Landmarks 09–12, the explicit interlock-caption target, and the revised federation admission, concentration, and related-work passages, including the admission-metrics and diffusion/gossip prompts and solutions, plus the status-table explanation, and both repaired paired-plot targets with their following context. The owned receipt records 4 fresh actual views and 61 exact accepted-image reuses. Every accepted image was either directly opened or proved byte-identical to a previously opened image; the receipt distinguishes those cases and retains exact hashes. This is selected visual coverage, not a claim to have inspected every rendered page. The source-bound licensing rationale has its own gallery target. Obsolete generated images are removed rather than left at plausible proof URLs.

Evidence paths under `.scratch/textbook-craft-20261103/`: `candidate-source-snapshot.json`, `candidate-build-25.log`, `rendered-tests-25.log`, `pdf-gates-25.log`, `page-end-hyphens-25.json`, `visual-reviewed-25.json`, `candidate-acceptance-25.json`, and `spreads/manifest.json`. The machine agent separately owns `book-facing-spreads.pdf`, its navigation-preservation receipt, and the symmetric solution-destination audit; those receipts must match this PDF hash. No tracked publication PDF or publication metadata was written by this agent.
