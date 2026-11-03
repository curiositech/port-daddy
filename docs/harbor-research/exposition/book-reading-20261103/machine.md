# Chapters 1–3: sequential reader audit and repairs

## Scope and evidence

Worktree: `/Users/erichowens/coding/tmp/book-textbook-craft-20261103`; branch `codex/book-textbook-craft-20261103`; linked metadata `/Users/erichowens/coding/port-daddy/.git/worktrees/book-textbook-craft-20261103`. Root/branch/gitdir verified before writes and after context resumption. No primary-checkout writes, local Port Daddy operations, commit, push, or PR.

Applied textbook-craft: reader-eye restatement, concrete examples before formal vocabulary, nonexamples, meaningful downstream use, and exercise follow-through. This is a full sequential reading of the THREE assigned canonical chapter sources, including preambles, claims, algorithms, prose, exercises, solutions, appendices and bibliography. Every original source line was displayed without truncation in the ranges below. A truncated first attempt at Chapter 2 was discarded and reread. It is not a claim to have read every cited publication, executed every proof, or reviewed every rendered spread. Parent owns complete Book generation and spread acceptance.

The accompanying `machine-concepts.json` contains 37 substantive concept clusters, first-treatment and application locations, examples/nonexamples, recall exercises, and chapter handoffs. Locations refer to saved post-edit sources, hashes below; a later mention alone was not counted as a developed application. The ledger covers the explanatory spine; appendix-only names of related tools or historical authors are references rather than new concepts the reader must master.

### Chapter 1 — `whitepaper/single-writer-kernel.tex`

Initial SHA-256: `da71044c54d8dde59d474ecd29c78532bee332017d76443aed84a322660bee17`. Initial lines: 3514.

Read coverage: 1–180, 181–520, 521–880, 881–1260, 1261–1630, 1631–2010, 2011–2400, 2401–2760, 2761–3130, 3131–3514.

Saved source: 3606 lines; SHA-256 `ffac19cf5ada147106defb6a4d47eb26d5edd645e07b958888bd9d44a80606ec`.

### Chapter 2 — `website-v2/public/whitepaper/anchor-protocol-whitepaper.tex`

Initial SHA-256: `b9006cf6e5c85ccc0d96945feb9f5b639d763422a6bf692023e325f996f275e6`. Initial lines: 2053.

Read coverage: 1–220, 221–460, 461–700, 701–940, 941–1210, 1211–1510, 1511–1780, 1781–2053.

Saved source: 2092 lines; SHA-256 `4cf06613f5978aff3e994c7c181649a79accfe0d62e96f407f2a1f705754101a`.

### Chapter 3 — `website-v2/public/whitepaper/sealed-harbor.tex`

Initial SHA-256: `c627a9f55d6becce0df697d0d01e3e6d7aedbcbd46c8ac3656877478e9c0bd8c`. Initial lines: 1874.

Read coverage: 1–200, 201–430, 431–670, 671–910, 911–1150, 1151–1390, 1391–1630, 1631–1874.

Saved source: 1927 lines; SHA-256 `ad243d84c13ad926d05128a3a500a60c295391532ac789709270295ebaa1d331`.

## Reader findings and completed repairs

### Chapter 1 — The Single-Writer Kernel

The chapter has substantial examples and real exercises, but assumes its own vocabulary too early and retells careful formal claims too loosely later. The main losing sentence came before the reader could distinguish a coordination record from control over an OS effect.

- Opening: added the three-request port 7421 trace, then daemon, transaction, commit, WAL and lease definitions. Returned to the trace for ordering and fencing. Explicit nonexample: the record alone cannot stop a raw OS bind.
- `sec:substrate`, `thm:exclusion`, `sec:resource`: separated exact-key uniqueness, atomic reclamation, and downstream fencing. The acquisition sketch does not establish interval/hierarchy exclusion or stale-effect rejection. The stronger theorem now explicitly names serialized conflict checks, persistent epochs and downstream validation.
- `sec:controllability`, `sec:partial-observation`: defined prefix-closure notation and exact realization; moved the hidden-read/two-identical-observations example before the partial-observation theorem. Recaps now distinguish exact realization, a safer restriction that sacrifices legal histories, and detection that additionally requires evidence. An unavailable prevention mechanism does not prove a detector exists.
- `sec:enforcement`: removed unconditional bounded monitor-response promises. Added the concrete release commitment and explained the oracle as a named machine predicate, not an infallible judge. Bound evidence to the claimed revision/result.
- `sec:continuity`: separated restoration of hidden inference state from durable outcome/identity evidence needed by reputation. Signed task bytes do not certify semantic task equivalence.
- `sec:workunit`: corrected local I1–I6 meanings and distinguished them from the chapter's I1–I12 namespace. Corrected five-guard/seven-step table reference.
- `sec:invariants`, OP10: distinguish conformance fuzzing from proof; closing durability summary now agrees that connection `synchronous=FULL` before commit, not `wal_checkpoint(FULL)`, supplies the stated commit contract.
- Exercise follow-through: three-operation linearization now has three operations; pre-commit prompt names actual rules; wrong I7–I9 references removed; FIFO waiting requires bounded trigger and processing delay, not merely eventual requests; hardening solution uses the actual different-UID threat row.

Remaining exposition obligation: long implementation and assurance catalogs need rendered pacing inspection. No new result about deployed daemon safety, identity, or memory recovery was established here.

### Chapter 2 — The Anchor Protocol

The main conceptual split is authentication versus authorization. It must remain intact through algorithm choice, chain walking, time, revocation and replay. Several recaps and solutions contradicted that split.

- `sec:architecture`: defined card, subject, verifier, TTL, authentication and authorization; explained HMAC's shared mint/verify power versus public verification. The rights/lifetime example now consistently clamps a REQUEST before signing and rejects an already-signed overlong CLAIM. Coordinatewise order forbids trading a smaller rights set for extra lifetime.
- `prop:alg-pinning`: trusted policy selects the algorithm, while a mismatched header can still be rejected. No advice to skip authenticated-header validation. Checked against RFC 8725 section 3.1: https://www.rfc-editor.org/rfc/rfc8725.html .
- `sec:algorithms`: added explicit pseudocode scope and rejection/acceptance symbols. Explained daemon→Alice→Bob key progression. The illustrative loop now starts under the root's authenticated SUBJECT key and checks the parent link, instead of verifying Alice's delegation under the daemon key.
- `sec:revocation`: exact hash-set lookup is not inherently linear; filter memory is not log/gossip volume; false-positive resolution and unhealthy-index fallback are distinct from global freshness. Mistaken revocation requires fresh issuance, not deleting a live denial.
- `sec:conclusion` / review: removed invented four-to-six-second and two-gossip-interval deadlines. The 1→2→4→5 schedule is one possible trace, not a random-gossip expectation or deadline.
- `sec:implementation`: retitled to distinguish one source crate from different verification scopes. Thirty-two stubbed bytes and two fixed capability vectors remain bounded evidence.
- `ex:anchor-chain-replay`: directly read `proofs/anchor/delegation/chain-replay.pv`. It inserts `consumed_nonce` but never checks it. Its displayed query is NON-INJECTIVE tuple correspondence; identical-chain replay is not excluded. Corrected the solution accordingly, without modifying or claiming a fresh execution of the model.
- `ex:anchor-security-envelope`: bearer semantics and per-request rechecking are independent choices. Narrowed loopback interception scenario to an attacker actually able to observe the transport.

Remaining obligations: runtime status assertions and the 17-case conformance claim were not independently re-established. The chapter's twelve-row assurance summary is not a score of twelve interchangeable security proofs. The replay artifact, its manifest authority/evidence policy, and any runtime replay cache require separately scoped follow-up.

### Chapter 3 — The Sealed Harbor

The chapter's careful theorem caveats were undermined by universal claims in its framing and recap. The mathematical teaching also jumped from differential privacy and Bernoulli trials directly to formulas without enough preparation.

- `sec:sealed-problem`: the parity example now explicitly assumes uniform secrets when claiming two entropy bits. Conservative whole-worker labeling is a DESIGN CHOICE, not an unsupported impossibility theorem about all generative-model taint analysis.
- `sec:sealed-design`: distinguished contract pins from enforcement, and attestation measurement from code correctness. Thirteen fields remain thirteen (4+2+2+2+3); an initial recount mistake was corrected before delivery. A 63-bit unsigned risk code plus one flag now makes the 64-bit payload example coherent, with quantization/framing obligations stated. Defined label join and declassification; explained why declassification is not permission to widen a child card.
- `sec:sealed-noninterference`: two-run parity guarantee remains bounded at depth 7. A gate on committed input and one on arbitrary worker-selected payload are different interfaces. Finer trusted computation remains possible; no universal prohibition follows from this model.
- `sec:sealed-enforceability`: propagated Ch1's full/partial-observation and exact-realization conditions. Deleted claims that only channel gates can ever work, internal events are automatically detectable, or two results settle all design alternatives.
- `sec:sealed-conservation`: explicitly stated zero initial ledger and nonnegative costs. Added neighboring-record DP inequality, the 3/4 randomized-response example (epsilon ln3), and exact-bit nonexample. Connected deterministic parity to why a small output alphabet is not automatically DP. Primary definition source: Dwork, Differential Privacy (2006), https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/dwork.pdf .
- `sec:sealed-detection`: defined canary, misses versus false alarms, hypergeometric sampling, Bernoulli observations, the accumulating log-likelihood ratio, KL's expected-increment meaning and SPRT stopping before the named result. Counts of outputs are not wall-clock deadlines.
- `sec:sealed-budget`: finite-alphabet capacity is an upper bound on possible distinguishability, not a claim of realized leakage or a substitute for the committed-input theorem. Existing timing/abort caveats retained.
- Exercises: equal-parity pair fraction approaches 1/2, not equals it (2/6,12/28). Recomputed A3 projections:15 full states;11 when ledger COST order is discarded but counters retained;5 cost multisets alone. Canary rotation alone does not repair an unchanged 30% per-job compromise probability: power remains 0.7(1−0.2^5)=0.699776.

Remaining obligation: mirror the exact-realization and conservative-label wording into standalone research papers/registry under parent ownership. The unbounded noninterference lift and real confidential deployment are still obligations, not newly completed claims.

## Validation actually run

- `git diff --check` on all 3 canonical sources: pass.
- Begin/end environment multiset counts: balanced for all 3; this is only structural checking.
- `a3_epsilon_ledger.py`: exit 0; 15 reachable states; 2000 seeded random cases without violation; conservation mutations caught in 1 step and overspend in 3.
- `c1_noninterference.py`: exit 0; depth 7 check and local respect pass; raw-secret mutant 4 steps, bypass 3 steps.
- Independently enumerated A3 projections from its transition function:15 full,11sorted costs plus counters,5 cost multisets.
- Independently recomputed marker thresholds 29 and 59; epsilon advanced crossing 35; Wald approximation 296.939171983; compromised-canary power 0.699776; timing-inclusive capacity 13116.9925 bits; randomized-response epsilon ln3.
- Filter byte arithmetic is explicitly rounded from approximate bits/entry; not a memory benchmark.
- No fresh A4 simulation, ProVerif, Kani, runtime or hosted-CI result is claimed. Parent owns compilation and facing-spread acceptance.

## Cross-chapter and figure handoffs

Chapter 0 should motivate the record/effect boundary before claiming system guarantees. Chapter 5 should require durable attributable outcomes for reputation without making hidden inference-state restoration a prerequisite. Chapter 3 uses Ch1's observation premise and Ch2's authority distinctions; those are substantive reuse, not decorative references.

Read the included source for Ch1 controllability quadrant and fencing epoch; Ch2 phase staircase, delegation chain and revocation gossip; Ch3 controllability quadrant, work-order schema and leakage ledger. This is not a complete visual inspection of every illustration. Parent granted follow-up edit ownership of three scoped figure families after this report: sealed controllability quadrant, sealed work-order schema, Anchor phases. Their propagation and check results will be appended below. Parent owns other figure/layout changes.

The standalone `paper2.tex` is the controllability paper, not the Anchor chain-replay paper. Initial inspection found overclaims in its abstract and recaps. Parent subsequently authorized bounded propagation; the completed scope is below. No chain-replay or nonce claim was found in it. Read-only inspection of `whitepaper/corpus.json` found row `anchor-delegation-chain-replay-proverif` marked authority `product-runtime` with a historical transcript match, without specifying the non-injective property or missing consumed-nonce guard. The manifest and proof model were not edited by this agent.


## Bounded propagation and build follow-through

Parent authorized these additional sources after the chapter read:

- `website-v2/public/whitepaper/figures/fig-sealed-controllability-quadrant.tex`: control and observation are independent; missing observation does not imply detectability. Caption distinguishes exact policy realization from blocking all egress.
- `website-v2/public/whitepaper/figures/fig-sealed-work-order-schema.tex`: digests identify approved inputs; attestation binds a measurement; neither proves correctness. Payment/liability fields specify remedies rather than guaranteeing them.
- `website-v2/public/whitepaper/figures/fig-anchor-four-phases.tex`: each defense is conditional, with revocation effective only after receipt. No universal threat closure or gossip deadline. Label cells widened locally to fit the book data font.
- Both canonical/public `figures/spark-revocation-gossip.tex` mirrors: replaced an invented logistic curve and incorrect round-three convergence comment with the explicit favorable eight-peer schedule 1, 2, 4, 8. Points show the informed fraction 1/8, 1/4, 1/2, 1 at rounds 0–3. The chapter caption says random contacts need not attain it.
- `docs/harbor-research/tex/paper2.tex`: bounded wording propagation across abstract, exact-realization criterion, examples and conclusions. Full observation is stated; failure of exact realization need not preclude a safe restriction or supply a detector. The formal controllability criterion is unchanged. Read relevant lines 1–352 and 430–482; this is not a full sequential paper review or fresh proof run.
- Both canonical/public `figures/pd-cite-shortforms.tex`: checked-in generator added Dwork 2006 (`mega077`); 336 forms generated. Existing first-wins warnings for reused bibliography keys remain visible.

Canonical build repairs: the two Chapter 1 maturity columns widened locally from 0.19 to 0.21 text width; Chapter 2 tables gained an abbreviated appendix reference, a discretionary word break and explicit filename breaks. No global font reduction was used. The Chapter 2 assurance row now says chain authenticity, its depth boundary says fixed model depth 3 rather than deployed depth, and the relay paragraph no longer falsely says ProVerif cannot express replay freedom. These are scope corrections, not new proof results.

Applied `tikz-diagram-craft` with its figure standard and quadrant template, while retaining the chapter's corrected control/observation distinction. The three main fragments compiled in Swiss, Maritime and Technical editions: 9/9 automated failure checks clear. Contact sheet inspected: no text collisions in those fragments. B2/B3/B7 heuristic warnings remain; the tool correctly leaves design review unaccepted. Initial Swiss width failure was caption text extracted as a separate block, not an overflowing diagram; a shorter caption removed the ambiguous block. Final phase-width/spark checks and full-book overfull/spread acceptance are recorded by the parent/build agent; local fragment checks are not full-book acceptance.

## Read-only adversarial Chapter 0 pass

Read the parent's diff in bounded chunks and the new foundations exercise/solution sequence. This was a second-reader review, not ownership or a claim of a fresh complete read of every unchanged source line. Reported exact targets to parent:

1. `inv:commitment-persistence`: authorized withdrawal should be an explicit release trigger, consistent with the preceding open-minded commitment example.
2. `ex:prereq-timeout`: absent receipt is not proof of never-arrived; an in-flight request remains possible. Safe retry requires the declared deduplication or terminal-state contract.
3. VCG passage: define reported value notation and the welfare-maximizing allocation before the formula.
4. Supervisory-control passage: full trace domain requires explicit full-observation qualification at introduction.
5. Purely qualitative scenarios should use ordinary examples rather than the numeric worked-example box. The summary example can explicitly show the two-to-one information loss.
6. `ex:prereq-risk`: distinguish audit selection probability from successful detection conditional on selection. The threshold 1/11 is correct.

The increment, hidden-bit, open recovery-contract solutions and the three-part kernel-gap argument check out under their stated premises. Parent owns response and final revision to these findings.


## Final research validation and handoff

Parent additionally assigned layout-only follow-through in research papers 2, 3, 5 and their directly included figures. Final active research changes:

- `fig-r5-regime.tex` and `fig-r5-quadrant.tex`: exact realization, full/partial observation and safety-through-restriction are distinguished. No negative control verdict is promoted to a detector. The quadrant is explicitly a classification of its stated examples, not a universal two-checkbox theorem. Adjacent paper 2 text now also rejects the claim that every confident falsehood is universally unpreventable.
- Paper 2 classification table wraps its policy column; papers 2/3/5 identifiers have discretionary breaks; paper 3 transcript wraps its longest line; paper 5’s evidence table has explicit paragraph columns. No font sizes were reduced.
- `fig-r7-relation.tex`: uniform sealed selection after prepaid bribes, low-gain conditional contraction, the extra self-funded high-gain budget model, selected-auditor capital versus pool collateral, and separate amortization payoff models are explicit. Text cells wrap inside their boxes.
- `fig-r12-relation.tex`: corrected the coordinate projection that put the lower-left box over the lower-right box; aligned cell heights and moved the footer below the row. Render inspection confirmed the overlap was real and the final layout separates the four boxes and their arrows.

The parent corrected B3’s explanatory strings without changing its algorithm. The rerun exits 0; the nine control verdicts remain the same. The script no longer claims a detector from a negative controllability result.

Standalone validation uses pdflatex from `docs/harbor-research/tex`, with figure lookup via TEXINPUTS and output only under `.scratch/textbook-craft-20261103/papers/{1,2,3,5}`. Each paper received two passes; later wording-only adjustments were recompiled against already-converged auxiliaries. All four final logs have zero overfull boxes, zero undefined citations/references, zero multiply defined labels and no compiler error. Publication PDF mirrors were not touched. Changed research figures were also inspected in the rendered pages; this does not imply a full visual review of every page of every paper.

Final read-only adversarial acceptance: all six Chapter 0 findings listed above were corrected in source. The replay manifest now explicitly states non-injective correspondence, the unchecked consumed-nonce table and the absence of at-most-once evidence. The changed generator includes chapter-zero deferred solutions and its test matches authored exercise/solution identifiers. No additional defect found in that bounded source/test diff review; this is not a new ProVerif execution or a full generator correctness proof.

No known mathematical counterexample remains open from the assigned chapter pass. Separately unverified claims remain deployment/runtime conformance, the missing duplicate-replay guard/model, and complete mediation outside the bounded models. Those are evidence obligations rather than newly proved guarantees. The parent owns final Book compilation, facing-spread acceptance, integration tests and publication.


## Final plate-flow repair

Candidate14 placed Landmark12 between the two halves of the ticket-lock design sentence (physical114–116). At the existing `pdswisslandmarkplate{12}` invocation in Chapter1, a conditional `pdmarginpagebreak` now flushes that queued full-page plate before the next paragraph begins. The paragraph and mathematical content are unchanged; no tracked single-writer-kernel manuscript mirror exists. Final assembled spread placement remains the builder's check. The refreshed Chapter1 source hash is `627cec5727480a2fce293bc00305cf10d1efcc9fa03d3b1e5c0a0848f629fd57`.

The existing Book generator deliberately removes literal `clearpage`; this repair uses the preserved `pdmarginpagebreak` wrapper, whose expansion is covered by the generator regression.

The same actual14 review found Landmarks05,06,07 interrupting a reference-monitor sentence, the Algorithmic Pinning invariant, and a release-validity sentence. Each existing conditional figure now flushes through `pdmarginpagebreak` before following prose. No prose or formulas changed. Current source hashes and line counts for all three chapters are recorded in machine-concepts.json; assembled flow remains to be verified in the next build.


## Open-proof caption-placement follow-up

Read only the four inserted layout guards and their surrounding completed paragraphs/environments at source checkpoint `25676e9537493a0f3438520d2a2abb9f3b0b5c1d`. Chapter 1 now flushes the open-proof margin queue before the Commitments subsection; Chapter 3 does so before the Ryoan comparison and before the side-invariants table introduction. The corresponding Chapter 5 guard was independently reviewed but its reading record remains with the operator agent. Each guard checks the existing `pdbookfontprofile` inside `ifdefined`; only `open-proof` calls the generator-preserved `pdmarginpagebreak`. The Suisse and undefined-profile branches contain no action. Removing exactly those guards reproduces the committed manuscript bytes; no prose, formula, claim, or figure changed.

Chapter 1 current source: 3613 lines, SHA-256 `d18ff86060715d22f789677daefe0ba39c87b5915ca1b1dcb94491c4f7f432b8`. The initial sequential-reading hashes/ranges remain intact in machine-concepts.json; this follow-up is not a new complete read.

Chapter 3 current source: 1938 lines, SHA-256 `594794920d61c85096a7a5aa966c6416dba6b40be5ab41fcd0198e7346b4bd03`. The initial sequential-reading hashes/ranges remain intact in machine-concepts.json; this follow-up is not a new complete read.

The operator agent separately reports a six-pass Source Sans validation (`72783c15`): all 263 captions, 1464 margin objects and 212 exercise headings pass, zero off-page issues, and eight actual page contexts inspected. This agent has not independently inspected that isolated PDF. Candidate 22 still owns final assembled typography and edition acceptance.


## OP-5 tower scope and oracle expressiveness

Reread the OP-5 paragraph and neighboring prose (source lines 1788–1830 before this edit), STP `thm:tower-imported` with its detection/root caveats, and Paper 3 `thm:tower` with its proof. The SWK summary conflated candidate groups with audit depth, omitted the low-gain and conditional-detection premises, and denied the terminal trust obligation explicitly retained by the cited result. The replacement distinguishes the prepaid sealed-sampling bribery calculation from conditional geometric decay, names the trustworthy terminal adjudicator, and keeps oracle expressiveness separate. It adds a Book-only live reference to `stp:thm:tower-imported`; the standalone retains the chapter title. No theorem, proof, figure, exercise, or surrounding paragraph changed.

The source is now 3617 lines, SHA-256 `27c1bbff970f1efd2a4a7fa869fd79538c8240ad9d7099c2c61d89926ef9315d`. This is a bounded correction and reread, not a new full chapter review. The original reading ranges remain recorded. The original assertion was checked independently against its cited sources; the replacement is authored by this agent and awaits a second-reader review and assembled candidate 23 proof. No new mirror-the-prose test was added.
