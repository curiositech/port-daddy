# Research decisions from exact evidence

Research development, 30 September 2026. This note develops the eight-paper program around decisions an operator actually needs to make: which evidence to open, which commitment to admit, which effect to retry, which result to release, and when another review is worth its cost. The mathematical statements below concern declared finite or symbolic models. None establishes a deployed enforcement boundary, authentic receipt acquisition, semantic truth, or reviewer performance.

Source basis: all 30 PDFs accounted for in [the corpus reading](corpus-reading-20260928.md); the current `tex/paper1.tex` through `tex/paper8.tex`; `tex/doc2_product.tex`, `tex/doc3_research.tex`, and `tex/doc4_papers.tex`; the Harbor Results skill, compendium and tacit lessons; and the [continuation](continuation-observation-model.md), [receipt acquisition](receipt-bundle-design.md), and [reviewer protocol](reviewer-dependence-protocol.md) artifacts. This note uses source statements as claims to check, including statements labelled verified. It does not recertify the corpus by reading it.

## The organizing contract

For an evidence packet set E and a declared world model, let W(E) be the worlds compatible with the admitted evidence. A contradiction means W(E) is empty. Consistency means W(E) is nonempty. Neither statement selects the actual world. For a consequential action a, require its safety in every world in W(E), plus the action's separate authority and effect-boundary contract. If W(E) is empty, stop for conflict resolution; do not exploit vacuous universal truth to authorize every action.

This connects the papers without collapsing their claims:

- Papers 1 and 7 price distinctions between worlds and the evidence needed to expose them.
- Paper 8 checks a specific compatibility relation and retains a witness when it fails.
- Paper 2 determines whether an unsafe transition can actually be prevented under the observation and control boundary.
- Paper 6 decides a restricted conflict predicate; its changing fact base must also satisfy Paper 2's premises.
- Paper 4 specifies which distinctions a release may reveal.
- Paper 5 separates transferable authority or economic credit from the evidence that a successor can read.
- Paper 3 prices detection only after specifying what auditors can observe and how their failures depend on one another.

Evidence refinement shrinks W(E) only when evidence contracts, identities, time boundaries and background assumptions remain fixed. Replacing a stale packet, accepting a new schema, changing a hypothesis library, or repairing a compromised source changes the model and needs a new analysis. A signed claim has attribution; a corroborating observation has its own observation contract; a successful effect has a separate effect receipt. These are distinct types.

## Exact categorical auditing as the shared evidence layer

Fix a finite fact vocabulary, a finite nonempty value domain for each fact, actor identities, and one snapshot. For each fact, build its reciprocal observation graph. In the one-hot difference contract, a zero edge equates endpoint values; a valid nonzero edge fixes its two endpoint categories. Union the zero edges, propagate these endpoint pins, and report conflict exactly when a component receives incompatible pins. An unpinned component has the entire fact domain available. Invalid edge encodings and missing observations are admission failures or unknowns, never zero-valued evidence.

The algorithm is an equality-constraint solver with unary assignments. Its value is the typed, independently checkable path witness and its match to the packet contract; union-find itself is established machinery. Real-vector feasibility is a relaxation. A potential satisfying real differences may not give legal one-hot vertex values. On a path 0–1–2, two differences both equal to e_B−e_A have an unconstrained real potential and zero Hodge residual, but the first pins vertex 1 to B while the second pins it to A. Exact categorical feasibility rejects this path without needing a cycle. This makes a categorical oracle the required baseline for discrete facts.

The useful next acquisition question must distinguish two problems. Given already known candidate constraints and their fixed positive prices, find a cheapest inconsistent certificate; a conflicting pin pair connected by a zero-edge path gives a simple certificate structure. Before a query is answered, the future constraint is unknown; optimizing which query to buy requires an answer model or an adversarial objective. An offline cheapest witness is not an adaptive acquisition policy. The existing six receipt fixtures already show complementary acquisitions and the failure of zero-immediate-gain stopping; they do not answer the unknown-answer problem.

Provenance is needed to reject copies and bind facts to snapshots, but provenance is not statistical independence. Database provenance already studies symbolic dependence of outputs on input records: [Green, Karvounarakis and Tannen, *Provenance Semirings*](https://www.cs.ucdavis.edu/~green/papers/pods07.pdf). The proposed extension is an auditable correspondence from admitted packet identities to exact categorical witnesses and decision permissions. A general novelty claim would require a broader literature comparison and product evidence.

## Paper-by-paper next results

The table identifies a strongest defensible target for each paper, rather than treating completed finite checks as experiments still to run. The detailed developments below supply proofs or counterexamples for the most immediate targets.

| Paper | Defensible next result and beneficiary | Assumptions | Simplest baseline | Falsifier and evidence required |
|---|---|---|---|---|
| **1: evidence and attention** | A costed, decision-preserving digest for operator inspection and successor actions. Preserve categorical conflict witnesses and unresolved effects while allowing different reader projections from one provenance store. Beneficiary: an operator with a fixed inspection budget. | Fixed task/loss family, priced opens, an explicit capture boundary, measured inspection effectiveness; missing evidence stays unknown. | One structured packet index with two deterministic projections; flat inspect-all at the same evidence budget. | If projection loses an action-relevant distinction, or the index matches decision loss at lower cost, reject the proposed summarizer. Need held-out tasks, independently adjudicated actions and measured attention cost; token counts alone do not suffice. |
| **2: mediated enforcement** | Characterize which observation classes admit a safe effect, including delayed facts and stale observations; connect this to robust commitment admission below. Beneficiary: an effect broker deciding whether to allow a request. | Declared plant, control/observation alphabets, epoch and snapshot binding, complete mediation of the claimed effect. | Finite belief-state safety controller and conservative refusal on unresolved outcomes. | One legal observationally indistinguishable unsafe world defeats permission. Need adapter traces and a refinement argument from implementation to model; a policy check alone does not establish mediation. |
| **3: auditing and incentives** | Replace homogeneous clique shortcuts with conditional detection and weighted exposure; estimate the marginal value of another review before fitting an incentive schedule. Beneficiary: a review budget owner. | Frozen outcome population, protected labels, actual cost parity; distinct economic and stochastic assumptions. | One strong reviewer with deterministic tests; equal-cost repeated review. | Information separation fails if equal-cost joint misses and false blocks do not improve. Weighted bribery falsifies all-or-nothing outside the equal-exposure model. Need the admitted multi-project benchmark and measured conditional rates; the current 24 slots are preparation only. |
| **4: bounded release** | A payload-carrying transition model proving exactly when every permitted transformation preserves the declared declassification partition. Beneficiary: a release-gate implementer. | Committed input, explicit adversarial payloads, public observations including status/length/timing if visible, permitted release family. | Recompute a fixed approved function on committed input; reject arbitrary submitted replacements. | A same-release-class secret pair with different public traces is decisive. Need payload/schedule mutants and implementation channel inventory; a one-bit counter may still permit the wrong bit. |
| **5: continuity and credit** | A joint conservation/refinement contract: economic authority transfers without minting, while copied evidence contributes no new independent observation; recovery preserves unresolved operation obligations. Beneficiary: a successor actor and its principal. | Stable operation/principal/evidence IDs, atomic credit transfers, sanctions and dedup retention, explicit adapter capability. | Durable outbox plus remote dedup/result record; ordinary authority ledger and source-ID deduplication. | Duplicate effects, retained spendable parent credit, or confidence gained solely by copying falsifies the corresponding contract. Need concurrent transfer traces and real adapter failure injection; the existing 1-operation/2-epoch model does not cover these compositions. |
| **6: conflict and authority** | Robust admission for commitments whose Horn conditions may activate later; the maximal-fact theorem below is an exact tractable special case. Beneficiary: a scheduler accepting commitments. | Monotone ground Horn rules, static intervals, explicit future-fact reachability and a fixed rule set between admissions. | Recompute the existing exact checker at the maximal reachable fact valuation, or enumerate a bounded reachable family. | The dormant-activation witness refutes current-state admission as a perpetual guarantee. Mutually exclusive futures refute unconditional exactness of the union envelope. Need transition-level checking and separate decision/enumeration performance. |
| **7: evidence acquisition** | Minimum-cost typed contradiction certificates for a fixed observed packet graph; then a separate acquisition model with uncertain answers and missingness. Beneficiary: incident triage paying for evidence retrieval. | Same fact and snapshot, authenticated admissible packets, fixed positive cost accounting, explicit availability; no free raw-claim channel. | Direct claim comparison, equality propagation, shortest witness paths, exhaustive small bundle optimum. | If direct evidence weakly dominates at equal total cost, retain it. Need a grounded packet corpus and measured acquisition costs; the synthetic unbalanced-cycle result is already complete in its restricted regime. |
| **8: typed diagnosis** | Prove and validate a correspondence between categorical feasibility, witness paths and the strictly weaker real relaxation; preserve unsupported and unresolved states. Beneficiary: an operator reading an audit finding. | Exact finite encodings, correct restriction maps, snapshot-bound contracts, all missingness explicit. | Equality/pin solver or SAT oracle receiving identical packets; Hodge only for declared numeric telemetry. | A categorical counterexample missed by the checker or a causal label unsupported by evidence fails the claim. Need exhaustive bounded oracle comparison and packet-admission mutants, followed by independently adjudicated incidents before making field diagnostic claims. |

## Opportunity 1: commitments safe under future facts

### A three-transition witness

Paper 6's composition section gates acceptance on the conflict predicate of committed state. For the literal policy “never accept a currently conflicting proposal,” that is sufficient when acceptance is mediated. It does not by itself maintain “the accepted commitments never become conflicting” as their condition facts evolve.

Start with no `event` fact. Accept `event → O(write, scope, [0,1])`. Accept `event → F(write, scope, [0,1])`. Both admissions pass because neither token fires. Now an uncontrollable observation adds `event`; both obligations fire and conflict. The witness has three transitions if each rule is accepted separately, or two if submitted together. A control-plane store may mediate recording the event, but suppressing its recording cannot prevent the environmental event or justify treating its known occurrence as false.

This identifies the exact boundary: frozen facts or a separately controlled fact-admission semantics can make the narrower source guarantee correct. For evolving environmental facts, robust admission must account for those transitions. Paper 2's controllability theorem already predicts the failure: a legal prefix followed by an uncontrollable event leaves the stronger safety language. The relevant imported theory is [Wonham and Ramadge's supremal controllable sublanguage construction](https://epubs.siam.org/doi/10.1137/0325036). The following special case is a local monotonicity lemma, not a new general supervisory-control theorem.

### Maximal-fact admission theorem — proved here

Fix a ground Horn program P, the current positive facts F, ground deontic rules with positive conjunctive bodies, fixed scopes and intervals, fixed resource claims and fixed difference constraints. Between admissions only facts change: any subset of a finite set U of possible new positive facts may be added, and the combined valuation F∪U is itself reachable. Let C(F′) be the Paper 6 conflict predicate after Horn closure of F′. Then

`every permitted future valuation is conflict-free  ⇔  C(F ∪ U) is false`,

provided every permitted valuation lies between F and F∪U. Arbitrary independent additions of members of U are one sufficient reachability model. The theorem also covers a more constrained model if its maximum F∪U is jointly reachable.

**Proof.** Horn closure is monotone in facts. Positive deontic bodies therefore fire monotonically. Derivable bottom and an overlapping opposite-polarity pair remain present after facts are added; the resource and difference-constraint conflicts are unchanged. Thus C is monotone. If C(F∪U) is false, it is false at every subset valuation. If it is true, the assumed reachable maximum supplies a violating future. This proves both directions. A witness at the maximum may include facts still in the future; label it a potential conflict and include the activating facts rather than reporting a current breach.

The result gives the same asymptotic decision bound as one complete batch conflict check on the expanded fact set, including its actual input size. It is maximally permissive for the fixed-rule, reachable-maximum contract: every rejected rule set has a permitted violating future, and every accepted one remains safe between admissions. Sequential admission preserves this property only if each new proposal is rechecked against the combined accepted rules and the applicable future-fact contract. Rule withdrawal, fact retraction, negation, changing intervals, unmodelled new atoms and changing temporal constraints need their own transition semantics.

**Reachability counterexample.** Let the only futures be `∅`, `{a}`, and `{b}`. Rules `a → O(write,s,[0,1])` and `b → F(write,s,[0,1])` are safe in every reachable future. Checking their union `{a,b}` reports conflict, although that combination cannot occur. The union envelope remains sound for admission but rejects a safe rule set. For mutually exclusive branches, evaluate their reachable maximal valuations separately or use a symbolic reachable-state representation. No polynomial claim is made for an arbitrary succinct reachability language.

**Bounded check performed.** Imported the existing reference checker without executing its experiment driver, then saved a self-contained standard-library checker with a separately implemented truth-table oracle. Enumerated all 512 Horn programs drawn from the nine rules with bodies `∅`, `{a}`, `{b}` and heads `a`, `b`, `bottom`; all four current fact sets; and all four U sets. Horn closure agrees with the independent interpretation oracle in **2,048** program/fact cases. With the fixed opposite rules `a→O` and `b→F`, all **8,192** envelope cases satisfy `C(F∪U) = OR_{V⊆U} C(F∪V)`. The dormant witness yields `false,true`. The exclusive-future witness yields `false,false,false,true` for `∅,{a},{b},{a,b}`. The checker requires witnesses against current-facts-only admission, omission of Horn propagation, and treating an unreachable union as exact. These are finite model checks supporting the proof, not a check of a deployed scheduler.

### Output size and the authority inference

Paper 6's Theorem 1a says a sweep finds *every* interval clash in an output-free `O(T log T + X log X)` term. With n same-action obligations and n prohibitions, all having the same scope and interval, there are n² different clashes. Any explicit enumeration takes Ω(n²) output operations. An output-sensitive implementation must charge the emitted witnesses; if scopes contain several atoms, also charge expanded scope incidences and repeated keyed pair occurrences unless deduplication is proved to avoid them. Deciding that some clash exists is a different interface and can stop at one witness. The current Python reference explicitly scans all active pairs, including nonclashes, and remains quadratic even on n overlapping obligations with no prohibitions and therefore no output.

NP-completeness of a richer conflict language does not imply that a human judge is required. A bounded solver can return a machine-checkable satisfying discharge assignment or an unresolved timeout; policy authority determines permissible resolution, independently of solver runtime. No general polynomial solver follows, and no practical impossibility follows merely from the complexity class. The useful next experiment measures rejection latency, emitted witness size and timeout rate on realistic commitment corpora against indexed deterministic checks and a bounded SAT/SMT baseline.

## Opportunity 2: release the permitted distinction

Paper 4 explicitly says its current `submit` transition has no payload. Its finite checker consequently cannot exhibit a worker replacing a committed secret s by a computed payload f(s) before the gate applies its release function g. This is an executable-model gap with a small complete next model.

### Factorization criterion — proved here

Let S be a finite secret set, let g:S→D be the declared release, and let an adversary choose a deterministic payload map f:S→T. Let r:T→Y be the gate's actual payload-release function. The released value respects the declared secret equivalence exactly when

`g(s)=g(s′) ⇒ r(f(s))=r(f(s′))` for every s,s′.

This holds **iff** there exists h on the image g(S) such that `r∘f = h∘g`. The proof is elementary: constant output on each g-fiber defines h unambiguously; a factorization makes equal g-values produce equal released values. This is a confidentiality criterion. A correctness contract requiring precisely g(s), rather than any function of it, is stronger.

For a permitted deterministic adversary class F, require the criterion for every f∈F. If arbitrary f is allowed, a nontrivial secret equivalence class and a release function r with two available outputs make the guarantee fail: choose two equivalent secrets and map them to payloads that r distinguishes. Cryptographic payload integrity alone does not remove this semantic freedom.

**Minimal concrete witness.** Take S=T=`{0,1,2,3}`, g(s)=r(s)=s mod 2, and f(s)=floor(s/2). Secrets 0 and 2 have the same permitted parity, but the actual released bits are 0 and 1. The release contains only one bit, yet it is the wrong distinction. Exhausting all **256** possible maps f gives **64** maps satisfying factorization and **192** violating it. These counts were independently computed by comparing the pairwise equivalence condition with explicit enumeration of the four maps h:`{0,1}→{0,1}`. They are finite combinatorics, not measured attack prevalence.

The simplest gate recomputes an approved function on the committed input and separately handles a worker's untrusted candidate. Accepting a syntactically valid payload or matching its own digest proves neither that it is the committed input nor that its release factors through the allowed partition. If arbitrary useful model output is the product requirement, the contract must instead state a channel/capacity or mechanism-specific guarantee and test that guarantee directly.

Delimited release and laundering protection are established prior art: [Sabelfeld and Myers, *A Model for Delimited Information Release*](https://www.cs.cornell.edu/andru/papers/isss03.pdf). The proposed contribution is a payload-carrying Harbor model with independently checkable attack traces and an explicit implementation correspondence. It does not establish a new general declassification theory.

**Next bounded artifact.** Extend the finite transition alphabet with `submit(payload)`, committed-input identity, gate rejection and public receipt status. Compare approved recomputation, payload parity, and fixed-bit budgeting. Exhaust equal-g secret pairs across the permitted adversary strategies; seed wrong-input, uncharged-rejection and secret-dependent enabledness mutants. Include public observation of refusal, query count and scheduling when they are in scope. A bound of q·log₂|Y| requires a fixed/bounded transcript format or an accounted transcript alphabet; visible timing and variable length must be priced too. For adaptive or randomized strategies the property is equality of permitted public trace distributions/sets under a specified scheduler, not merely the one-step deterministic equation above.

## Opportunity 3: audit dependence and unequal exposure

The reviewer protocol already states the chain rule correctly. Let M_j be the event that reviewer j misses. Then joint miss is the product of conditional misses given all preceding misses. A uniform conditional detection bound `Pr(detect_j | M_1,…,M_{j−1}) ≥ d_j` implies joint miss at most `Π(1−d_j)` without independent reviewers. Marginal detection alone does not: if every reviewer misses exactly the same 10% of defects, k reviewers still miss 10%, while multiplying the marginals predicts 0.1^k.

This is elementary probability, and the independence problem has a primary empirical antecedent in [Knight and Leveson's multi-version programming experiment](https://people.cs.rutgers.edu/~uli/cs673/papers/EvaluationMultiVersionProgramming86.pdf). That study supplies motivation, not a numerical prior for LLMs. The required research evidence is the protected, adjudicated, cost-matched experiment already specified in the protocol. Its current draft is not execution-ready and this task ran no reviewers.

### Weighted sealed sampling permits partial bribery — derived and checked here

Paper 3's all-or-nothing conclusion uses equal sampling weight and equal per-clique bribe cost. Keep its one-draw, fixed-payment model but let clique i have sampling probability w_i, with Σw_i=1; let capture probability conditional on an unbought clique be p_i; and let its buyout cost be β_i. For bought set S and protected gain G, the expected value is

`V(S) = G(1 − Σ_{i∉S} w_i p_i) − Σ_{i∈S} β_i`.

With no cross-clique effects or budget coupling, buy exactly the cliques with `G w_i p_i > β_i`; equality permits either choice. This follows by writing V as a constant plus `Σ_{i∈S}(G w_i p_i − β_i)`. Partial buying can therefore be uniquely optimal.

For two cliques with weights `(0.9,0.1)`, capture probabilities both `0.2`, bribe costs both `10`, and G=`100`, the four payoffs are **80** for neither, **88** for clique 1 only, **72** for clique 2 only, and **80** for both. All four were enumerated. Equal weights would give zero marginal gain for either clique at these numbers, matching the source's knife edge. This is a counterexample to extending the equal-weight conclusion to an arbitrary sealed pool, not a refutation of that equal-weight calculation.

**Useful next result.** Optimize auditor assignment subject to measured conditional detection, disclosure restrictions, workload availability and principal concentration; compare with uniform assignment and the strongest affordable single reviewer. Strategic buyout probabilities and ordinary reviewer errors need separate estimands. A claim about stable incentives additionally needs a specified sequential game, actual forfeitable continuation value, settlement semantics and feasible probabilities. Repeatedly applying a one-stage expected-value identity is not a proof of equilibrium for an arbitrary adaptive audit tower.

This opportunity is independent of the release and admission models: no runtime integration is needed to recruit and adjudicate cases. Its stopping rule is empirical dominance by the simple review baseline or inability to establish the required evidence isolation, cost parity or population coverage.

## Paper 1 arithmetic: preserve the result, repair its reason

The R2 tacit lesson and Paper 1 explain superadditivity by claiming `log₂ C(N,2k)` grows faster than `2 log₂ C(N,k)`. For positive k with 2k≤N the inequality goes the other way. Every 2k-set has C(2k,k) ordered partitions into two k-sets, so

`C(N,k)^2 ≥ C(N,2k) C(2k,k) > C(N,2k)`.

The floor nevertheless is strictly superadditive when `2k≤m<N`. Define

`F(t)=log₂[C(N,t)/C(m,t)]=Σ_{i=0}^{t−1} log₂[(N−i)/(m−i)]`.

Its summands strictly increase in i because N>m. Consequently the second block of k summands exceeds the first, and `F(2k)>2F(k)`. The denominator's change is essential. Exact integer/rational checks verified both inequalities for **17,545** triples with `3≤N≤60`, `2≤m<N`, `1≤k≤floor(m/2)`; for N=60,m=8,k=2 the floors are `5.9821787229` and `12.7661591366` bits.

An unbounded superadditivity ratio is possible along an explicit varying-parameter sequence, rather than at fixed N,m: take `N=2k+1,m=2k`. Then `F(2k)=log₂(2k+1)` and `F(k)=log₂[(2k+1)/(k+1)]`, so `F(2k)/(2F(k))` diverges. At k=`1,10,100,1000` it is approximately `1.355,2.354,3.853,5.487`.

This comparison assumes one shared open budget m that must contain both readers' disjoint critical sets. It does not establish a lower bound for arbitrary two-decoder representations with separate budgets, or require two model processes. A vector-valued shared evidence representation can preserve both readers' information while each applies its own ranking. Common optimal scalar order and common sufficient representation are different questions. The classical decision-theoretic backdrop is [Blackwell, *Comparison of Experiments*](https://digicoll.lib.berkeley.edu/record/112749/files/math_s2_article-08.pdf); the proposed applied contribution needs measured decision preservation and cost.

Paper 1's regret-head inequality also contains an algebraic mismatch worth resolving before an empirical attention study. From `C a ≥ c + F(1−a)`, the probability threshold is `(c+F)/(C+F)` when C+F>0. For C>c and a<1 its odds form is `(c+F)/(C−c)`, not `(c+F)/C`. If C<c inspection never wins; if C=c and costs are nonnegative it can only tie at a=1 except the degenerate all-zero case. This correction is elementary arithmetic, not a research contribution.

## Evidence plan and completion criteria

The exact categorical program should deliver its solver, typed witness checker, exhaustive bounded oracle comparison and certificate-cost contract first. Those artifacts give Papers 1, 7 and 8 a concrete evidence object. They must retain ordinary direct checks and explicit unknown states.

The three independent research opportunities then have narrow next deliverables:

1. **Robust admission:** a transition-level harness for future-fact activation, a certificate listing the facts needed to activate a conflict, and an explicit reachable-future contract. The proof above is complete for the monotone reachable-maximum case. General dynamic semantics, incremental complexity and implementation refinement remain open.
2. **Payload release:** a payload-carrying finite model and mutation suite implementing the proved factorization boundary. The 256-map enumeration is complete for its four-secret, one-step case. Adaptive strategies, schedules and deployed channels remain unverified.
3. **Dependence-aware review:** independently recruit and adjudicate the protocol's cases, then run a separately authorized equal-cost pilot. The chain rule and weighted one-stage counterexample are proved; useful conditional detection, incentive calibration and field benefit are unmeasured.

The continuation note already establishes the finite unknown-effect cases. Extend it only where the evidence can add a decision: multiple operations, authority transfers, record reclamation, or a real adapter's demonstrable failure contract. RIFL already supplies unique requests and atomic completion records: [Lee et al., *Implementing Linearizability at Large Scale and Low Latency*](https://web.stanford.edu/~ouster/cgi-bin/papers/rifl.pdf). Similarly, costed noisy test selection already has a substantial theory; [Golovin, Krause and Ray's EC² work](https://arxiv.org/abs/1010.3091) is the baseline literature before claiming an acquisition approximation guarantee.

### Reproduce the new bounded checks

From the repository root, both commands use only the Python standard library, write no files, and leave Port Daddy off:

```sh
python3 -B -W error skills/harbor-results/scripts/research_envelopes.py
python3 -B -W error skills/harbor-results/scripts/test_research_envelopes.py
```

The first command prints the deterministic JSON counts and named mutation witnesses, and exits nonzero on any failed check, including under Python optimization. The second passes five boundary tests covering import silence, unreachable union, inconsistent Horn premises, confidentiality versus exact output correctness, and all finite counts. Both commands passed locally on 30 September 2026. The witness expectations are necessary fail conditions for weaker policies; they do not establish that these are the only possible faults. The checker is import-safe and does not rerun any experiment until called.

No local Port Daddy runtime, paid model run, PR, deployment, or TeX edit is part of this note. The new proofs are elementary specializations with explicit hypotheses; the finite checks are bounded corroboration; the practical advantage and broader novelty of the proposed research remain to be established.
