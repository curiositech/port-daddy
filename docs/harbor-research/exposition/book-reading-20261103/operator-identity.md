# Chapters 4–5: sequential reading and concept development

Worktree: `/Users/erichowens/coding/tmp/book-textbook-craft-20261103`; branch `codex/book-textbook-craft-20261103`; linked metadata `/Users/erichowens/coding/port-daddy/.git/worktrees/book-textbook-craft-20261103`. No local Port Daddy runtime used. Canonical chapter ownership: `whitepaper/legible-swarm.tex` and `website-v2/public/whitepaper/spawn-to-person.tex`.

## Read evidence

Both original chapter files were read from first to final line, in order, before their respective edits. This includes all prose, examples, formal statements/proofs, exercises, deferred solutions, bibliography entries, and status appendices. Exact original hashes and non-overlapping contiguous read intervals are in `operator-identity-concepts.json`: Chapter 4 lines 1–4461; Chapter 5 lines 1–3983. An initial tool attempt at Chapter4 3321–3740 returned no readable text due to context truncation; it was not counted, and the interval was subsequently read in bounded chunks. Reading bibliography entries is not verification of every cited work. Mechanical lint is recorded separately below.

## Reader model and conceptual route

A software engineer who knows processes, logs, basic probability and algebra should be able to follow the core route. Queueing, information theory, rating models, and competitive analysis need local examples. The surviving spine is: Mira authorizes a coordinator; she must inspect both worker and authority evidence; bounded review creates decision and information budgets; Heron’s outcomes can then become a persistent record; Bob needs identity, evaluation and liability rather than a label or score alone. The political and identity-philosophy material remains, but does not do the work of a missing mathematical premise.

## Principal repairs

Chapter4:

- `def:zoom`/`prop:verifiable-zoom`: separate evidence addressability from authenticity. A linked log can be fabricated or stale; require binding to exact tree, command, result and independently controlled runner. Recorded evidence does not exhaust tacit knowledge.
- `sec:sole-roles`: a small two-server example precedes the queue theorem; stable queues, positive waiting-cost rate and cost units are explicit. `sec:succession-corner` defines K, and the dependent solution retains the failure-model and eta K<1 boundary.
- `thm:escalation-threshold`: worked threshold names b(u)=V(u)=u. SDT examples declare perfect inspection and a common cost unit; positive miss cost alone does not make zero review suboptimal.
- `thm:lowerbound`: four artifacts/one critical/two opens teaches the counting argument. Message coding convention and integer rounding are explicit. Coverage failure is distinct from a broken zoom link. H(p) is only the exact-identification Bernoulli corner.
- `thm:split-digest`: the unsupported impossibility for arbitrary compression becomes an exhaustive two-record, one-retained-record counterexample with explicitly defined loss functions. More budget or a joint codec can preserve both readers’ information; shared storage remains allowed.
- `thm:paging`: h means offline comparator capacity; Young’s classical algorithm and model are named. A fixed common pinned set reduces both capacities. The extra corruption allowance remains a finite experimental question, not part of the imported theorem.
- `prop:decay`: continuous score decay does not revoke leases; hard eligibility, fencing, and unresolved obligations are distinct. Prevention claims are scoped to the actual effect boundary and exact registered keys.

Chapter5:

- `def:role`/`def:person` and `inv:parfit-lineage`: role is an ordered tuple; role changes do not mint fresh history. Directed ancestry is not identity equivalence. Psychological-continuity philosophy motivates questions, not a theorem choosing the ledger or establishing software consciousness.
- `def:oracle`: a worked closure record binds task, accepted specification, delivered commit, runner and result. An oracle is a designated independent evaluation procedure; a pointer does not certify truth. Exact execution restoration is stronger than the continuity needed by every reputation system.
- `thm:necessity`: the newcomer-floor escape states fresh-score, free-use, unlinkable-liability, admissible-dishonesty, score-only-access and counterfactual assumptions. Cryptographic authenticity is separate from abandonment cost.
- `thm:probation-dominance`: the .60-now versus1-tomorrow exchange precedes the general optimization. The existing ceiling and participation caveats remain.
- `thm:engine-swap`: theta is expected buyer value in common monetary units; payoff comparison is one delivery without extra future discipline. The participation inequality does not prove a dynamic exit spiral or adoption of attestation.
- `sec:substrate`/`sec:not-bandit`: a 3-of4 pairwise comparison teaches BT input semantics. Routing and public evidence are complementary; adversarial, contextual and non-stationary bandits are acknowledged instead of denying their existence.
- `def:qvec`/`proto:skill`: scales, higher-is-better direction and hard acceptance precede weighted scores. Skill exposure and outcome association are not causal attribution.
- `thm:tower-imported`: uniform sealed clique selection, prepaid bribes and conditional detection now support the affine payoff. Geometric depth starts below the bribery threshold. The illustrative linear phase additionally assumes bribes deplete the next level’s available budget; selected bonds do not count all eligible-pool capital.
- Audit amortization defines a,v,r, t-indexing and exact sums. Setting rho=0 in ModelA removes its deterrence; repeated-game discipline needs another observation channel.
- `prop:tombstone`: evidence persistence is not monotonicity of quality estimates. Detection delay differs from tombstone propagation, and partitions require a freshness/fail-closed contract.

## Independent numerical checks

Direct Python standard-library/Fraction arithmetic, without running plotting scripts or regenerating assets:

- two-server example Wpool=4/3 hours, specialist rate1.75 gives4/3;
- extractive feasible losses (1,10),(0,10),(1,0); retaining both at budget2 gives(0,0);
- cache factors8/5 and fixed-common-pin6/5;
- pairwise BT strength difference ln3≈1.098612;
- capped probation H=25.405555...→25.41; delayed spike199.01773→199.0;
- ModelA T200 sum25.583785; ModelB T200 sum35.075;
- ModelB lifetime exact167167/4000=41.79175; first zero integer period334; integral41.666... is a different quantity.

## Primary sources inspected for repairs

- Young, *On-Line File Caching*, author-hosted [conference paper](https://www.cs.ucr.edu/~neal/Young98Online.pdf), Theorem1.1 and potential proof. h is comparator capacity; integer file sizes, fixed costs, initially empty caches. [Author’s journal entry](https://www.cs.ucr.edu/~neal/Young02Online) establishes the journal citation.
- Lattimore and Szepesvari, [*Bandit Algorithms*](https://tor-lattimore.com/downloads/book/book.pdf), contents and model coverage: adversarial PartIII, contextual Chapter18, non-stationary Chapter31. No claim to have read the entire external book.
- Cai et al., [model substitution paper](https://arxiv.org/abs/2504.04715), abstract: TEEs offered as a practical verification approach; it does not prove the chapter’s pricing mechanism induces adoption.
- [AP2 specification](https://ap2-protocol.org/ap2/specification/) and [UCP AP2 extension](https://ucp.dev/specification/payment/extensions/ap2-mandates/): signed checkout/payment authorization is a format/verification contract, not independent-principal identity proof. Removed fragile unversioned algorithm-detail assertions.

## Mechanical checks and limits

Final focused lint: Chapter 4 22/22 tagged claims and all 58 exercise entries at chapter end; Chapter 5 18/18 tagged claims and all 50 exercise entries at chapter end. Five legacy environments now carry recognized design-status tags; definitions are not called theorems. Example-floor flags include source apparatus and sections containing meaningful unboxed examples. No empty example boxes were added to satisfy those counters. Chapter5 source heading `Reproducing the chapter results` is not recognized as history/reference apparatus by the title heuristic. Parent owns apparatus metadata.

The advisory reader-eye scan produced35 signals. Several are false positives from `figures/legible...` include paths, written-out numbers, or concretely explained examples lacking digits. Genuine gaps informed the edits above. Do not present that count as complete reader judgment. The final build and two-page spread review remain parent responsibilities.

## Remaining reconciliation and limits

Bounded follow-through is complete in Papers 1, 3, and 5 and their directly related figures. Paper 7 is about equivocation/cohomology, contains none of the paging claim under repair, and was left untouched. This follow-through is a targeted consistency review, not a claim to have sequentially read those entire papers. Manifest/index changes and generated-book synchronization belong to parent. Every existing numerical sweep count is retained as a reported historical script result unless the independent arithmetic above explicitly verifies the specific number; no new live-agent evidence is claimed.

The chapter is still substantial. Some exposition retains wide claims about production status, estimator choice, or external literatures that merit a separate citation/runtime audit. This read does not certify every external work or every deployed mechanism. Full concept lifecycle anchors and current source lines are in the JSON report.


## Dependent research results and figures

- Paper 1, `sec:split`: the existing ordinal comonotonicity theorem remains. A complete one-record extractive example defines both losses and all feasible summaries; no arbitrary-encoding impossibility or empirical prevalence is claimed. The super-additive ratio compares one m-open budget with the sum of two m-open lower bounds; it is not an equal-total-budget architecture comparison. `fig-r2-relation.tex` teaches the same scope.
- Paper 3, `thm:stage`: weak deterrence and probability-feasibility conditions are explicit; an interior mixed equilibrium needs both fractions strictly between zero and one. `thm:tower` distinguishes the sealed prepaid affine bribe calculation from conditional detection across misses. The strict-depth formula uses floor+1; the geometric case starts at G0≤CB. Its C1 linear prefix requires a separately stated, self-funded non-replenishing budget. All matching abstract/interpretive retellings now retain those boundaries. Vendor diversity and VRFs are design ingredients, not proofs of independence/secrecy/honesty.
- Paper 3, `thm:amort`: exact lifetime cost is a[nG−rv n(n−1)/2]/(dB), n=ceil(G/(rv)); the integral is an approximation. The continuous and discrete error is bounded by the initial term. The stated Model B payoff is additive expected audit-bond loss plus separate revelation-stake loss. The repeated-game comparison no longer claims setting B=rho=0 recovers a punishment mechanism.
- Paper 5, introduction/`sec:cliff`: newcomer-floor premises match Chapter 5. `sec:engine` states the one-delivery, fixed-price comparison; participation is not a dynamic-exit theorem, and sound attestation does not by itself prove price pass-through or provider adoption.
- `fig-stp-rate-the-raters.tex`: actual computed recurrence coordinates replace hand-shaped curves on a purported log axis. C8 conditional contraction and C1 extra budget model are labeled separately. Selected-bond capital and an honest root are separate obligations.
- `fig-stp-audit-amortization.tex`: smooth curves are labeled continuous integrals; T200 dots are discrete sums. `fig-paper3-amortization.tex` uses completed-grade count T rather than silently plotting t+1 costs at t; exact plateau and zero-rate index agree with the theorem.
- `fig-stp-parfit-chain.tex`: the overlap diagram is an engineering analogy; valid succession records, not repeated outcome labels, establish directed ancestry. The first incarnation interval now includes its shared witness mark.
- `fig-stp-sybil-whitewash.tex`: principal-level sanction and voting policies are named, with newcomer-floor scope. Authentication alone is not shown as preventing both attacks.
- Narrow label-wrap repairs in `fig-stp-role-vs-person.tex` and `fig-stp-tombstone.tex` address the build agent's specific overfull reports. Ch4's table, inspection-benefit display, and script-path exercise were similarly repaired. Rendered acceptance remains the build agent's task.

## Final numerical and source checks

An independent standard-library Fraction loop checked 144 positive amortization parameter combinations: exact finite sum equals the closed form, first zero-rate integer agrees, and the sum-minus-integral lies between zero and the initial term. Forty-five (C,G) cases checked the affine bribe endpoint optimum and strict G>CB condition. Exact rational recurrences produce depths 53/36/27 for C1/C2/C8 under the disclosed extra-budget model where applicable.

Assigned source regressions pass: 8 tests in `test_book_decompressed_blocks.py`; 2 source/provenance tests in `test_book_margin_object_batch.py`. One compiled-PDF placement check is skipped pending the parent build. The regressions retain negative controls for false numbers, promoted empirical evidence, collapsed explanation paragraphs, and missing probability assumptions. `git diff --check` passes after the bounded edits.

Focused textbook-craft lint reports all claim tags and end-of-chapter exercises passing. Its example floor still flags 6/15 Chapter 4 sections and 12/19 Chapter 5 sections, including review/exercise/reference/status apparatus and substantively worked unboxed prose. It does not recognize Chapter 5's 'Reproducing the chapter results' as history/reference apparatus. These are recorded limits, not hidden green checks. Full sequential read evidence and concept teaching/reuse anchors are in the JSON; lint is not a substitute for that reading.

No tracked PDF, generator, global index, or Git commit was changed by this worker. Parent/build agent owns canonical regeneration, library-manifest reconciliation, compilation, and final spread review. Existing stochastic sweep counts are reported historical evidence, not newly rerun experiments. A finite uncapped probation sweep is explicitly a finite check, not certification of a universal theorem or the capped case.

Final caption-to-body check: the read-poverty introduction now uses a six-update inspection budget against two/fifty incoming updates, makes the empirical bottleneck hypothesis explicit, and avoids treating an update count as Shannon capacity or an unspecified directory as a complexity theorem. Fencing summaries are limited to mediated resources, and state-dependent admission is distinguished from invariants preserved by construction.
