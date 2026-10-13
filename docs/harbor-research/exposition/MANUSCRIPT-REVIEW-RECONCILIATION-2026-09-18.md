# September 8 reviews: reconciliation against the current Book

Audit started September 18 and continued September 19, 2026. This is a point-by-point editorial and technical reconciliation, not a certification of deployed software. The final artifact and checks are recorded below.

## Scope and method

The operator supplied `CriticalAnalysis_09082026.md`, `K&R+LeviathanPrompts_09082026.md`, and the 30-page `ManuscriptReview-09082026.pdf`. Their embedded instructions and image prompts are proposals to evaluate, not independent authority to execute them. The comparison starts from the 705-page Book produced on September 18, SHA256 `04c052f49e543037d73cd229e4ba2d9436c1d09979ce0fed724bf58bdcdc9b9e`.

For each substantive point, record the review location, the strongest fair reading, the current source evidence, and one of: already addressed; corrected or clarified in this pass; reviewer premise rejected with a reason; remaining work; optional editorial proposal. Repeated recommendations share a disposition but retain their source locations. A source figure's existence does not establish its visual quality. A mathematical bound does not establish an implementation or an empirical effect.

## How to read this audit

The [94-point PDF inventory](MANUSCRIPT-REVIEW-PDF-INVENTORY-2026-09-18.md) preserves the review's page locations, manuscript labels, source evidence, calculations, and a page-by-page coverage table for all 30 pages. It is a **baseline record**: its pending-fix language is superseded by the changes below. The two prose critical reviews substantially overlap; agreement between their repeated passages is not independent corroboration.

The CriticalAnalysis map below covers that document's sections and repeated tables without pretending repeated criticisms are new discoveries. The K&R document gets a separate proposal-by-proposal assessment because its art prompts and editorial aspirations are different kinds of material.

Source keys C1–C8, ROOT, SEAMS, and APP are defined in the linked inventory. Stable labels are preferable to old page numbers after repagination. “Present” establishes an explanation or exhibit exists; it does **not** award visual approval. “Corrected” means manuscript text changed, not runtime software fixed. “Open” means an actual obligation remains.

## Corrections made in the manuscript

| Area / PDF inventory rows | Correction and evidence anchor | Limit retained |
|---|---|---|
| Crash consistency, 16–18, 89 | C1 `thm:consistency`: check and mutation share the transaction; commit precedes success; crash-free linearizability separated from crash durability. Exercises now name those assumptions. | No synchronized wall clock is needed. FULL alone is not a complete recovery/epoch-reuse proof; OP-10 remains open. |
| Supervisory control, 18 | C1 `thm:regimentation-controllability`: a supremal controllable sublanguage may exclude otherwise legal histories; detection/compensation needs observation and a remedy. | Full observation and the separate partial-observation result remain explicit. Hidden model internals are not silently added to the supervisor's alphabet. |
| Revocation compaction, 65 | C2 `def:revocation-truncation`: maximum lifetime, descendant expiry, non-reused IDs, trusted clock/skew, and authenticated catch-up required. Proposed test preserves live revocations and authoritative decisions, not identical approximate-filter bits. | Serving-state compaction is not audit-history deletion. A bounded time window does not bound memory under an unbounded issue rate. Not shipped by this edit. |
| Kani drift, 64 | C2 `inv:anchor-memory-safety`, harness listing and exercise: unwind **128**, matching Rust; fixed key, zero-byte decoder/error, and signature-result stubs described individually. | Header JSON parsing of the stubbed zero bytes makes the explored path rejection-only. No successful acceptance, real crypto, arbitrary-depth, FFI, or deployed constant-time proof is claimed. Kani was not rerun. |
| Confinement and timing, 19, 36–37, 67 | C3 comparison and `sec:sealed-budget`: distinguish protecting an application from its host from protecting its input owner; finite timing alphabet requires fixed observation rules and accounting for aborts/counts. | Ryoan does not prove DAGs are the only possible confinement. Serialization and a balanced epsilon ledger do not establish semantic noninterference. Canaries are probabilistic. |
| Queue variance, 20–21 | C4 `sec:spec-heavy-tails`, `hyp:spec-variance`: service mean stays unscaled; only waiting changes with variability. Exact M/G/1 and approximate M/G/c response expressions are printed. | Poisson arrivals and finite second moments are assumptions, not measurements of agent workloads. No new heavy-tail experiment is claimed. |
| Digest/zoom domains, 22–24 | C4 `thm:pinned-joint` now states nondegenerate source probability; `thm:zoom-advantage` states the error-free unit-cost oracle and positive population bounds. Strict advantage uses **d < 1/12**, equality at 1/12. Composition uses the corresponding sufficient strict window. | A query-bound crossing is not proof that every denser workload loses. Noisy tests need a separate model. |
| Finite probation, 25–26 | C5 `thm:probation-dominance`: exact finite capacity, zero-gain case, and unique earliest-fill capped optimum under strict discount ordering. Example with L=12 requires at least three dates. | The earlier b6 script checks the uncapped model. Lifetime participation does not imply a per-period cash floor; the additional income-floor constraint is now stated separately. Entrant mix remains unmeasured. |
| Latent-state recovery, 13, 72 | C5 `tab:death-ladder` and surrounding text: unavailable through assumed provider interfaces, not impossible for every runtime. | Exposed same-runtime caches may be serialized; that is not provider-independent restoration or subjective continuity. |
| Audit tower, 33, 84 | C5 `thm:tower-imported`: conditional detection given preceding misses; heterogeneous-rate product; strict depth uses floor-plus-one. Remove “oracle is no longer an assumption.” | Distinct cliques do not guarantee independent errors. Competence, completeness, truthful root, sampling, and calibration remain assumptions/obligations. |
| Control rights, 41 | C6 rental passage, role table and exercise: renter control is a proposed allocation illuminated by Grossman–Hart, not a theorem of optimal allocation. Renter still bears fee and task risk. | Investment, bargaining and outside-option models would be needed for efficiency claims. |
| Conflict complexity, 34, 73 | C6 `thm:deontic-detect`: sorting bound finds existence and one witness for ground scope keys. Reporting Z pairs has at least Omega(Z) output cost; Z can be quadratic. | Does not cover arbitrary semantic scope predicates or turn NP-complete conflict-freedom into NP-complete conflict existence. |
| Trade arithmetic, 39 | C6 `sec:ms`: **7/32** of all type pairs, **7/16** of efficient pairs, and **5/32** of expected efficient surplus. Price is not a private value/cost draw. | Distribution/equilibrium-specific example, not a universal percentage implied by Myerson–Satterthwaite. |
| Correlated reviewers, 33, 74 | C6 `sec:assurance-correlation`: conditional independence under a common latent detection rate is explicit. Jensen comparison scoped to that model. Two equal-pairwise-moment examples have different all-miss probabilities. | Pairwise correlation/effective sample size alone cannot determine the probability all judges miss. Calibration needs labeled outcomes, not only disagreement. |
| Local/federated custody, 4, 8, 14 | C7 `def:float-plan` now specializes C6's canonical definition; local daemon ledger separated from the Designed 2-of-3 federation proposal. Bounty and performance bond separated; evidence authenticates records but does not automatically price unfinished work. | No new custody implementation, arbitration correctness, full compensation, or shipped signature ceremony is asserted. |
| Monitoring and threshold, 27–28 | C7 `prop:claim-signaling-ic`: exact root **0.3425080314…**, persistent identities and public observation before each decision round. Other rounded references normalized to 0.3425. | Shared storage does not ensure shared timely knowledge. Private-monitoring games are not universally impossible; the cited communication result is not mislabeled belief-free. |
| Economic analogies, 40, 42 | C7 budget-breaker and Ostrom passages: pool must be outside the relevant coalition; compensation need not destroy individual deterrence; selected institutional principles guide design. | No theorem of coalition first-best, complete adoption of all eight principles, or field success follows from accounting/services. |
| Residual bounds, 30–32 | C8 `thm:sheaf-equivocation`: single nonzero coordinate-edge offset and prefix-incidence model attached to iff claim. Projected operator's kernel and norm used in soundness bound. Localization distinguishes support/detection from ranking and culpability. | A top-entry ranking needs a top/runner-up gap above twice the noise norm. Multiple offsets from one actor or colluding actors may be invisible. |
| Hodge language, 45–46 | C8 `sec:fh-sheaf`: cyclic/divergence-free residual, curl versus harmonic distinction, and smallest-positive eigenvalue. Removed blanket H1/gluing/contextuality equivalence. | A linear data consistency test is not a signed-log security proof or an automatic application of Bell contextuality. |
| Propagation, 77, 91 | C8 limitations and APP: remove “tree gap vanishes”; a path has positive diffusion gap and no cycle residual. Alarm-time research must specify visibility, signal, noise, schedule and time units. | No established transfer from continuous sheaf diffusion to asynchronous Byzantine anti-entropy. |
| Funding and clearance, 29 | C8 funding reserves existing credits; clearing transfers them. Positive transfer amount specified. | Native-unit conservation is not invariant mark-to-market value or proof of cross-rail custody. |
| Assurance and index, 2, 78–79 | ROOT: claim kind separate from implementation maturity; assurance modes not a universal ranking. APP table now honestly named “Routes to the open problems.” | Thematic routes are not an exhaustive numbered research register. OP-4a, OP-5 and OP-11 are not falsely closed. |
| Engineering precedent, 38 | C1 related work distinguishes Litestream backup/recovery from LiteFS replication, links official descriptions. | Context, not endorsement or evidence of this kernel's implementation correctness. |

The textbook/exposition skills influenced these repairs by putting assumptions beside the claims, giving concrete counterexamples, and retaining worked examples rather than hiding qualifications in a distant appendix.

### Follow-through check: neighboring prose, protocols and examples

A second, bounded [independent source review](MANUSCRIPT-REVIEW-FOLLOWUP-2026-09-19.md) found four places the initial repairs had not propagated. All four were then edited:

1. **Canonical C6 funding:** requester funds the bounty; provider principal authorizes the performance bond. Both funding identities and settlement terms are bound to the signed plan. The two-party signed ceremony is Designed, not Built; the local bond ledger and incomplete admission gate retain their separate grades. The figure caption now says this is the proposed order.
2. **C2 reached paths:** the worked example no longer claims expiry or payload-parser coverage. The zero-byte decoder fails header JSON parsing first, even when signature verification returns success. A final neighboring-example check also removed the false claim that pinning eliminates the header-algorithm guard: Rust explicitly checks the authenticated header against `SUPPORTED_ALG`. Pinning the algorithm and validating that header are different obligations; channel authorization and stateful revocation are separate again.
3. **C7 shared punishment:** both players enter the same three-round countdown after a public deviation. The former opponent-only instructions did not produce the mutual-punishment sequence used in the calculation. Prescribed punishment does not reset itself. The bounded TLA witness is explicitly narrower than arbitrary deviation histories/reset behavior.
4. **C8 partial clearance:** whole-bond lifecycle accounts are not recipient balances. An 80 payment/20 source remainder is one cleared 100 status, plus a separate recipient ledger summing to 100. The figure caption distinguishes the model-checked status partition from money-transfer conformance.

The build also exposed duplicate `stp:sec:handoff` and `stp:tab:handoff` labels. The second nearly identical handoff section/table was replaced by a reference to the first; the retained table no longer declares the grading oracle “no longer owed.” No unique technical result was removed. The original duplicate remains recoverable in the repository history and the frozen baseline Book; no unrelated content was discarded.

While repairing two neighboring margin-note anchors, the final read found an additional C4 gap in `thm:escalation-threshold`: mere monotonicity does not imply strict increase, an interior root needs continuity and both endpoint signs, and a closed feasible debit band needs continuity of the aggregate constraints. The theorem and b7 script's explanatory contract now say this explicitly and distinguish a best response to a fixed validator from a joint equilibrium. The continuous worked model's numerical band is unchanged. Two new counterexample tests cover constant payoffs, an absent root, a discontinuous jump and a signal atom that makes the band open. The arithmetic scripts do not establish field calibration.

## CriticalAnalysis_09082026.md: section-by-section disposition

The inventory numbers in this table refer to the linked PDF audit, which records the same critique in greater source-level detail. Each repeated summary-table row inherits the named disposition, not a fresh implementation claim.

| Review location / point | Assessment on its own terms |
|---|---|
| Executive assessment: textbook, research collection, product manual | Preserve a mechanisms-and-limits textbook with a named reference implementation, not a deployment approval. Current frontmatter already establishes this (1–2). The review's old page count is not the current edition. Its praise is not verification. |
| Structure: sealing → human oversight | Existing sealed-to-legibility handoff explicitly explains why opaque execution increases the need for inspectable evidence (3). Keep it and the part spreads. |
| Structure: Float Plan drift | Real semantic inconsistency, corrected in C7; one definition in C6, distinct local and proposed federated profiles (4, 8, 14). |
| Structure: transfer, topology, threat bands, Keystone duplicates | Already conditionally omitted from the Book's C6, with canonical C8 or C5 references. Do not remove useful economic motivation or create a second copy (5–7). |
| Chapter responsibility matrix: C1 capability bridge, C2 attenuation | Present with complete-mediation limits; authorization does not prevent every harmful authorized act (9–10). |
| Matrix: C3 shortness; C4 density | Figure-register row counts are not a quality metric. Ceremony, laundering, taxonomy, examples and reading routes exist. Optional explanatory refinements are not proof gaps (11–12, 66, 68). |
| Matrix: C5 continuity; C6–8 division | Engineering analogy does not establish philosophical personhood. Preserve canonical ownership of economics, local commons and federation. Formal/synthetic checks are not “high empirical depth” (13–15). |
| Systems: async arrival order allegedly refutes linearizability | Reject: only non-overlapping real-time precedence constrains the order. Concurrent calls can linearize in either order. No synchronized clock is required. Clarified in theorem (16). |
| Systems: NORMAL and fencing after host failure | Valid durability concern. Separate process, OS and power faults; specify durable recovery and non-reused epochs rather than downgrading everything to sequential consistency (17, 89). |
| Systems: partial observation | Existing full-observation theorem and projection-based theorem already separate the cases. Clarify restrictive supervision may reject some otherwise legal behavior; do not claim hidden internal events are observed (18). |
| Systems: laundering despite epsilon accounting | Existing formal boundary is correct: accounting balances declarations, not arbitrary semantic information flow. Retain explicit committed-input and mediation limits (19). |
| Queue base derivation | Keep the correct M/M/c algebra and stated mean-response objective; no invented Pareto law for every agent workload (20). |
| Queue heavy tails | Correct the actual variance extension, which had scaled the wrong terms. Approximation and finite-second-moment limits now adjacent; empirical calibration remains open (21). |
| Rate distortion: expansion and convexity | Four logarithmic terms and zero-rate region already present. Add 0<p<1; reject the review's global strict-convexity shortcut (22). |
| Adaptive halving: imperfect tests | Error-free oracle is an explicit hypothesis, not a guarantee about linters. Repeated noisy tests require their own dependence/error model (23). |
| Halving threshold and visual crossing | Strictly better below 1/12, equal at 1/12; corrected theorem and composition wording (24). |
| Probation: liquidity/capital constraints | Real concern, but the old capped theorem needed finite-horizon feasibility and retained uniqueness. Added exact constraints and distinguish lifetime participation from period cash flow. The claimed adverse selection effect is a research question, not a measured outcome (25–26). |
| Repeated-game root | Reject 0.3419. Independent calculation gives 0.3425080314…; corrected inconsistent rounding (27). |
| Public versus private monitoring | Valid scope concern; explicit public history before decisions and persistent identity assumptions added. Communication/forgiveness are possible designs, not an automatic theorem extension or universal cure (28). |
| Cross-currency conservation | Review conflates conserved native units and changing valuation. Current per-unit/in-flight accounting plus valuation, fees and slippage boundary is appropriate; fixed numeraire alone would not freeze value (29). |
| Sheaves: trees and effective resistance | Valid for the stated coordinate-incidence model and a single-edge offset, not every arbitrary cellular sheaf. Formal scope tightened (30–31). |
| Sheaves: collusion and localization | Single-actor/coalition limit already appears in formal statements. Correct the new real defect: signal amplitude does not establish ranking stability or culprit attribution (32). |
| Mathematical summary table: tower correlation | Conditional detection along a history is what contraction needs. Distinct model names do not establish it; remove oracle-closure headline (33). |
| Mathematical table: deontic visual | Conflict trace and frontier diagram already exist. Correct decision-versus-enumeration complexity. Literal clause-selector bipartite figure remains an optional teaching addition (34). |
| Literature: OCaps/Macaroons | Existing credit and comparison retained. This signed-card format is not Macaroons' HMAC construction; inspiration does not transfer a proof (35). |
| Literature: Ryoan/SCONE | Compare precise threat models, not a false theorem that stateful systems require our single writer. C3 now rejects that inference (36–37). |
| Literature: TigerBeetle/Litestream/LiteFS | Engineering precedent retained and backup/replication distinguished (38). |
| Literature: Myerson–Satterthwaite | Correct the review's denominator. 21.875% of all pairs is not 21.9% of surplus; see three exact quantities above (39). |
| Literature: Holmström | Keep a qualified outside-coalition budget-breaker analogy; do not infer compensation always destroys deterrence or a pool solves all team incentives (40). |
| Literature: Grossman–Hart–Moore | Keep as a design question about control and investment; no “renter must” theorem without a model. Exercise and role table corrected too (41). |
| Literature: Ostrom | Monitoring/sanctions already grounded. Four selected principles are not empirical compliance with all eight (42). |
| Human factors: automation levels 8→4 | Current action-specific consent mapping is useful. An exact numbered shift requires the actual interface; classifier threshold is not authorization (43). |
| Human factors: canaries and vigilance | Mackworth/Bainbridge already cited. Literature motivates a study; it does not prove the canary intervention preserves skill or vigilance (44). |
| Topology: Hansen–Ghrist | Kernel relationship retained; use smallest positive eigenvalue where H0 may be multidimensional, not automatically lambda2 (45). |
| Topology: Jiang curl analogy | Correct non-gradient residual to cyclic/divergence-free, distinguish harmonic and curl, and correct contextuality overreach (46). |
| Personal identity row | Locke, Reid and Parfit already contextualized; cryptographic lineage is an engineering analogue, not psychological continuity proved (47). |
| Visual register: 378/141/237/64 counts | Historical backlog counts, not a current absence audit or a visual quality score (48). |
| ch1-25 taint automaton | Present before relevant discussion; preserve secret-read and egress distinction (49). |
| ch2-35 escalation/fix | Paired chain exhibit present; per-hop check owns rejection. Existence does not prove runtime verification (50). |
| ch3-12 laundering fork | Present and names the semantic escape, not an accounting failure (51). |
| ch4-32/33 rate plane and halving | Both present. Distinguish feasible boundary f=p−delta from independence/zero-rate boundary f=1−delta/p; reviewer table confuses these (52–53). |
| ch5-21/22 engine swap | Present paired payoff/threshold explanation; attestation must bind outcomes to the right engine, not merely name a model (54). |
| ch6-09 Horn/3-SAT | Present conflict trace and complexity frontier; exact requested bipartite selector drawing is optional (55). |
| ch7-46/47 lifecycle and ledger | Present before code. Use actual model state set, not six states by fiat. Preserve external topUp rather than draw every movement as closed-system conservation (56–57). |
| ch8-39 Acme/Beta/Staging | Present. Worked scenario, not a historical production incident report (58). |
| Visual grammar: circles, buckets, dashed boundaries | Shared grammar exists. Select notation by semantics; rounded lifecycle boxes can be clearer than circles. Dashed grouping alone does not define adversarial powers. No blanket aesthetic approval or restyle in this pass (59–61). |
| Tactical C1: delegation terminology and same-UID bypass | Authorization/task lineage separated; OP-9 explicitly a prerequisite for Confined claims, still not implemented. Cgroups alone are not isolation (62–63). |
| Tactical C2: verification and compaction | Concrete bound drift and retention assumptions corrected, not merely a new reassuring callout (64–65). |
| Tactical C3: attestation ceremony and timing | Ceremony already present; timing alphabet qualified. “Neutralize timing” was too absolute (66–67). |
| Tactical C4: three losses and CSV | Taxonomy already present. r1-floor CSV is tracked; plotted points evaluate the same formula, not independent empirical evidence. No misleading measured-data overlay added (68–69). |
| Tactical C5: resurrection, Sybils, death ladder | State-machine guards, identity tradeoff and ladder already present; hidden-state claim scoped to interfaces. Migration model does not certify provider portability (70–72). |
| Tactical C6: grammar and correlation exponent | Complete grammar already exists. Effective sample size is not an all-miss law; add explicit counterexamples and keep conditional-mixture model (73–74). |
| Tactical C7: TLA+ scaffolding and unbondable disclosure | Scaffolding present. Disclosure can exceed feasible collateral and cannot be undone by payment; not every loss is mathematically infinite, nor is hardware the only possible control (75–76). |
| Tactical C8: incident and diffusion | Incident present. Diffusion/gossip gap explicitly open; false tree-gap intuition removed. Do not create a false theorem merely by numbering it OP-12 (58, 77). |
| Assurance tiers | Reject one ordered prestige scale that puts TLC in two tiers. Keep evidence kind, model bounds, conformance, runtime maturity and residual assumptions separate (78). |
| OP concordance | Current table gives thematic routes, not every individual problem. Retitled honestly; full per-question ledger is still an optional navigation improvement (79). |
| OP-1 | Remains open: FIFO cooperative release does not establish lazy-expiry fairness or a bounded wall-clock wait (80). |
| OP-2 | Already closed within the formal observation/mediation model; not a deployment claim (81). |
| OP-3 | Differential binding test remains unbuilt/open; design is not a million-operation run (82). |
| OP-4a / OP-4b | Split exists; reject “replay Closed.” Task capsule replay remains specified; latent-state portability remains open (83). |
| OP-5 | Reject “completeness closed for bonded panels.” Incentives to use a supplied oracle do not make it complete (84). |
| OP-6 | Read-path tamper evidence remains open; integrity/freshness is not the same problem as all information-flow confidentiality (85). |
| OP-7 | Partial boot ledger; deterministic version/recovery discipline does not require a new local consensus protocol (86). |
| OP-8 | Empirical decay calibration remains open; define objective and bursty workload before fitting a rate (87). |
| OP-9 | Essential prerequisite for confined hostile co-tenancy, still open; naming bwrap is not implementation (88). |
| OP-10 | Durability selector remains open. PRAGMA is not per-table; acknowledgment, error handling, storage and epoch recovery must be specified together (89). |
| OP-11 | Reject closure from one Float Plan transaction. All compound claim/bus/escrow paths and injected failures need checking (90). |
| Proposed OP-12 | Retain chapter-local propagation research question; no renumbering or unjustified spectral alarm-time assertion (91). |
| Four curricular paths | Present in frontmatter. Week-by-week prerequisites/exercise loads would be a separate syllabus, not a correctness repair (92). |
| Promote solution results | Succession threshold and death ladder already in main narrative. Preserve their derivation exercises and hypothesis limits (93). |

## K&R+LeviathanPrompts_09082026.md: proposal-by-proposal disposition

This document is an editorial/art direction brief, not mathematical evidence. Its historical aspirations do not require claiming the book is already a standard or that political economy replaces every other account of multi-agent systems.

| Proposal | Decision and reason |
|---|---|
| K&R/SICP-level clarity, density, durable mental models | Adopt the goal: concrete state, authority, observation and accounting models with worked failures. Reject greatness claims as evidence and page count as the target. |
| Reference implementation versus universal architecture | Keep the implementation named and the mechanisms general. Do not declare an adopted universal standard. Current repository license is FSL 1.1 with a future MIT conversion; do not casually relabel it OSI open source. |
| Fencing Lease primitive | Keep lease/epoch vocabulary with the actual enforcement boundary. A fence only makes stale writes inert when the protected effect checks it and recovery does not reuse epochs. |
| Digest-with-Zoom primitive | Keep addressable evidence and bounded-information argument. The lower bound depends on the source, review budget and oracle; it is not a guarantee that every digest preserves meaning. |
| Float Plan primitive | Canonical definition now in C6, local collateral specialization in C7, proposed federation profile in C8. Do not turn three market sides into three mandatory signers in every implementation. |
| Laundering Residual primitive | Keep as a named limitation, not a claim that current semantic tracking detects it. Distinguish from a numeric cohomology residual. |
| Radical compression/deduplication | Existing transfer, threat and Keystone deduplication preserved; corrected substantive custody drift. Short applications can legitimately revisit a primitive without redefining it. |
| Three Books replacing present Parts | Do not apply: operator explicitly wants the current four-part structure and opening spreads. The proposed grouping can be a reading route, not an unauthorized structural replacement. |
| Move all long TLA+/ProVerif listings to appendix | No mechanical line-count purge. Existing diagrams and prose precede the code. Retain a listing when readers must inspect its guards; appendix placement is optional where it interrupts the argument. |
| Red-teamer crucible: 32-bit filesystem exfiltration | Useful bounded-model exercise, not a deployment attack instruction or universal counterexample. Requires specifying which filesystem path/observer lies outside the gated channel. Existing enforcement-gap and laundering exercises cover the principle; a runnable toy would be a separate artifact. |
| Market-exploiter crucible: borrowed bond | Useful research exercise only after specifying loan repayment, liability, participation and benefit timing. Wealth alone does not defeat a deterrence inequality. This pass adds finite capacity and cash-flow conditions rather than inventing a successful exploit. |
| Topologist crucible: six-node ring and collusion | Existing visible-cycle/cancellation exercises address it. A severed ring edge yields a tree and zero residual even without a two-liar cancellation; an un-compared but relayed edge is different. No topology-free minimum Byzantine count is defensible. |
| Spare systems-philosopher voice; Hobbes/Parfit/Scott | Retain these motivations and dry concrete exposition. Analogies now explicitly stop before security, welfare or personhood claims they do not prove. |
| Sovereign colossus made of agents | Optional frontispiece metaphor; no generation performed. One universal sovereign would misrepresent local sovereignty and federation. A caption/brief must name it as allegory. |
| Cyclopean head/searchlight | Optional motif for selective attention, not omniscient supervision. Its limited field of view matters to the book's claim. |
| Attenuated capability scepter | Optional scoped-authority motif, not evidence that all runtime effects are mediated. |
| Ledger/Float Plan scroll | Optional commitments/evidence motif. A signed log is neither an infallible oracle nor a legal judgment. |
| Harbor citadel | Compatible with existing chapter art. Do not replace chapter plates or the illustrated contents with one generic image. |
| Twin pillars | Optional decorative organization; two pillars are not a new theorem or a reason to collapse four parts. |
| Subterranean gears/Merkle roots | Optional artifact metaphor. Keep decorative roots distinct from a technical inclusion-proof diagram. |
| Master frontispiece prompt | Retained in the supplied brief as an option, not executed by reading it. Generation would need a chosen brief consistent with local sovereignty and readable jacket composition. |
| Colossus close-up prompt | Same optional status; mechanical detail is not a substitute for an explanatory figure. |
| Harbor/subterranean cutaway prompt | Same optional status; could support an opener if requested, without encoding invented quantitative relationships. |
| Aspect ratios and negative prompt | Production suggestions, not manuscript requirements. Ratio must follow actual trim/placement; no tool flags or unverified 8K capability promised. |
| Caslon/IM Fell/Baskerville cartouches and postprocessing | Superseded for this Book by operator-purchased Suisse and restrained typography. Any future historical lettering would be a deliberate art treatment, not a body-font substitution. |

## Claims deliberately not upgraded

- No user study, workload-tail fit, vigilance-retention experiment, correlated-judge calibration, or multi-harbor deployment trial was fabricated. Existing analytic curves remain analytic; worked incidents remain examples.
- No Kani, ProVerif, TLC, Z3, runtime integration, confinement, custody or production release result was rerun or promoted merely because its text was edited.
- OP-1, OP-3, OP-4a/b, OP-5, OP-6, OP-8, OP-9, OP-10 and OP-11 are not closed by prose. OP-7 remains partial. The exact owning statements remain authoritative.
- A complete per-question research index, literal bipartite 3-SAT teaching figure, semester syllabi, three crucible implementations and new frontispiece are optional follow-ons, not silently completed tasks.
- This review does not finish the earlier whole-book visual redesign, 24-persona study or full language edit. The eight named exhibit groups are present; their presence and geometry do not settle their aesthetic quality.

## Independent witnesses and primary sources

The new `tests/harbor-research/test_review_math_boundaries.py` contains synthetic counterexamples and arithmetic checks for finite probation, cash-flow versus lifetime participation, queue variability, strict zoom/tower boundaries, the cubic root, the three trade denominators, pairwise correlation, a tree's positive spectral gap, projected-kernel/norm bounds, and ranking instability under bounded noise. These test specific failure modes, not every theorem in the book.

Primary sources consulted where the review's prescription was doubtful:

- [Herlihy–Wing, Linearizability](https://www.cs.columbia.edu/~wing/publications/HerlihyWing90.pdf): non-overlapping real-time precedence versus concurrent order.
- [SQLite synchronous documentation](https://www.sqlite.org/pragma.html#pragma_synchronous): WAL NORMAL versus FULL fault boundaries.
- [MIT M/G/1 derivation](https://web.mit.edu/urban_or_book/www/book/chapter4/4.7.html): service mean versus waiting-time variability.
- [Hansen–Ghrist, Spectral Sheaf Theory](https://jakobhansen.org/publications/spectralsheaves.pdf): linear diffusion and sheaf Laplacians, not an automatic Byzantine gossip bound.
- [Jiang et al., Statistical ranking and combinatorial Hodge theory](https://arxiv.org/abs/0811.1067): gradient and divergence-free components, then curl/harmonic split.
- [Kandori–Matsushima, Private Observation, Communication and Collusion](https://www.cirje.e.u-tokyo.ac.jp/research/dp/94/f33/dp.pdf): communication under private monitoring, not the attribution in the review.
- [Ryoan](https://www.usenix.org/system/files/conference/osdi16/osdi16-hunt.pdf), [Holmström](https://people.duke.edu/~qc2/BA532/1982%20Rand%20Holmstrom%20team.pdf), and [TigerBeetle](https://docs.tigerbeetle.com/concepts/performance/): independently checked by the PDF reviewer for threat-model, incentive and engineering comparisons.
- [Litestream](https://litestream.io/) and [LiteFS](https://fly.io/docs/litefs/): backup/recovery and live replication are distinct; deployment limitations remain the projects' own.

## Build and verification record

Final full Book: **706 pages**, built September 19, 2026, at
`.cache/book-review-20260918/coordination-papers-mega-volume.pdf`.
SHA256: `54988b85ca765434f0bc1757c0ecd68b743bfc39c14eed0602b2a11e9009552b`.
This is the complete eight-chapter Book, not eight chapter PDFs. The purchased
Suisse profile, four part spreads, chapter plates and single illustrated
contents are retained.

| Check against this output | Result / exact scope |
|---|---|
| Full Tectonic build | Completed; no undefined references, multiply defined labels or pending cross-reference rerun warnings in the final log. Typography/line-fit warnings remain, so this is not a warning-free typesetting claim. |
| Numbered captions | **229 checked; zero failures.** All checked for outer-margin bounds; **189 floating owners** also checked for adjacent tops, same page and body-column ink width. Non-floating tables/listings get bounds checks, not the same floating-owner adjacency test. |
| Registered marginalia | **885 of 885** shipped exactly once; zero measured overlap/bottom-bound failures. |
| Page overflow | Zero detected off-page ink loss, margin-column collisions or text below the body foot. Eleven width advisories remain, including intended margin pictures; these are not a blanket visual pass. |
| Illustrated contents and navigation | Six rendered/parser tests pass: every live entry has title/page links, page labels agree with destinations, all **four part plates and eight chapter plates** are present, and reader-route prose remains below the facing diagrams. Two source checks also pass. The old test's exhaustive-open-problems title and four-images-only assumption were updated to match the corrected title and the user's chapter-art requirement. |
| Mathematical/source counterexamples | **22 pass** in `test_review_math_boundaries.py`, covering specific repaired boundaries. They are neither a complete theorem audit nor deployment tests. |
| Escalation model | b7's existing numerical sweep rerun: continuous worked band unchanged, non-monotone counterexamples found, zero-debit and excessive-debit mutations rejected. The script's assumptions/labels now agree with the narrower best-response theorem. |
| Layout regression tests | Nine pass. Caption suite: 17 pass, including the exhaustive current-Book test; five separate synthetic-PDF fixture tests were not rerun. |
| Human visual inspection | Opened corrected queue, probation, correlation, punishment and residual pages; then inspected the final contents, verifier example, threshold statement, Figure 3.5, Figure 4.6 and Table 4.13 at readable resolution. This is a targeted inspection, not an aesthetic approval of all 706 pages. |

Reflow exposed two captions lifted away from their figures by later Recall
notes. Their notes now attach to relevant earlier passages. A later safety
failure caught Table 4.13 sharing a margin with an overlong Recall; both were
shortened without deleting the three questions. The final pages have captions
beside their exhibits and ordinary body flow beneath them. No spacing shim,
reduced type, clipping or disabled guard was used.

The whitespace inventory still queues **45 pages** for design review (the
baseline queued 42). That heuristic includes intentional opener grammar; it
does not establish that each queued page is defective or fixed. The earlier
whole-book visual request remains a separate unfinished pass.

Evidence is retained beside the Book in `caption-audit.json`,
`layout-audit.json`, `overflow-audit.json`, `math-check.log`,
`escalation-check.log`, and `final-review-p*.png`. The initial build also caught
an unsupported claim-kind name (replaced by a worked-example environment), then
stale auxiliary measurements imported through an older font-build directory.
The font configuration is isolated from that directory's auxiliary files;
the safety check was never disabled.

## Operational boundary

Port Daddy's local runtime remains halted. Existing unrelated and earlier Book changes are preserved. No new runtime behavior, empirical study, art generation, or publication is implied by this editorial pass. No commit, push or PR was made from this extensively dirty shared Book worktree.
