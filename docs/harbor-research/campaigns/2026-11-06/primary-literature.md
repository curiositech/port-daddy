# Primary-literature seed and next proof targets

Campaign: 2026-11-06. Source checks performed on 2026-11-06 America/Los_Angeles
(2026-11-07 UTC). Scope ends at the local campaign date. This is a bounded,
incremental literature investigation, not an exhaustive survey or a novelty
certificate. Publication dates below come from primary pages or manuscripts,
not search-engine crawl dates.

The strongest next result is a checked bridge from a declared transition model
to admission decisions, with separate evidence that the model covers the adapter.
The antichain lemma, discounted incentive inequalities, and basic vacuity checks
already have substantial neighboring literature. The useful contribution must
be stated more narrowly than any of those general ideas.

## Evidence and method

Applied the repository's `research-prior-art` skill and
`references/finding-prior-art.md`, plus `research-craft` and its
`references/evidence-ledger.md`. Structural searches crossed model checking,
supervisory control, normative systems, repeated games, and verification
coverage. The companion `scholarship-transcript.jsonl` preserves exact
tool-visible query arguments and concise cited response records. It is expressly
not a reconstructed raw transcript or hidden reasoning.

The source trail follows Basin et al. 2013 into proactive enforcement
(2016/2024), then its 2025 and 2026 successors. Antichain searches connect
Doyen–Raskin to a 2025 data-structure study; repeated-game searches connect APS
to Abreu–Sannikov and a 2024 working paper with a 2025 posting. Citation
snowballing remains incomplete, especially the second round for economics and
capability protocols. Exact-phrase searches for “positive deontic” with future
admission and “maximal labels” returned other uses; neither absence nor collision
establishes novelty. No new technical name is proposed.

Primary manuscript text is distinguished from metadata-only leads.
Tool-author documentation is primary evidence of tool semantics, not a peer
reviewed theorem. Reported experiments and mechanizations in outside papers
were read, not independently reproduced. Local manuscript/source inspection
below is not a solver run or production observation.

## 1. Future commitments and reachable fact labels

**Structural question.** Given a finite transition graph, state fact labels,
and a fixed positive rule program, is a conflict absent at every state reachable
from the admission state? What evidence licenses replacing those states by
fewer representatives?

| Primary source and checked location | Hypotheses and result relevant here | Delta and counterevidence |
| --- | --- | --- |
| Doyen and Raskin, [Antichains for the Automata-Based Approach to Model-Checking](https://arxiv.org/pdf/0902.3958), 2009, Definition 3.1 and Lemma 3.3, pp. 7–8. Full text. | A simulation preorder preserves the accepting set and predecessor closure in their Büchi-automata framework; maximal elements can represent closed sets. An application still needs a correct predecessor operator on representatives. | Our pointwise positive-conflict test is an elementary specialization, not new antichain machinery. Label inclusion alone does not establish a simulation between control states. |
| Cadilhac, Flügel, Pérez, and Rao, [Data Structures for Finite Downsets of Natural Vectors: Theory and Practice](https://arxiv.org/html/2502.09189v1), 2025, §2 Proposition 1 and §§3–6. Full text. | Finite downsets under componentwise order admit maximal-vector representations. The analysis treats dimension as input. Their asymptotic comparison and benchmark findings differ: the tested synthesis tasks do not favor current k-d-tree implementations. | Relevant to incremental representation and performance claims. A small antichain is not itself proof of cheap construction or faster total admission. |
| Basin, Jugé, Klaedtke, and Zălinescu, [Enforceable Security Policies Revisited](https://people.inf.ethz.ch/~basin/pubs/tissec-enforce2013.pdf), 2013, §4.1, Theorem 4.4, Corollary 4.5. Full text. | Policies and trace universes are given by finite-state automata; only some actions are controllable. Their stated general automata enforceability decision problem is PSPACE-complete, with witness constructions. | Admission at a mediated write is narrower than this general policy-enforcement problem. Do not transfer a polynomial batch-check bound to a succinct plant or general automata representation. |
| Basin, Debois, and Hildebrandt, [Proactive enforcement of provisions and obligations](https://people.inf.ethz.ch/~basin/pubs/ComputSecur24.pdf), [publication record](https://journals.sagepub.com/doi/10.3233/JCS-210078), online 2023 / issue 2024, finite automata and timed DCR sections. Author manuscript. | Enforcement may deny or cause designated actions. DCR deadlines require time-lock freedom; the paper distinguishes general decision procedures from a polynomial sufficient condition. | Future obligations and preventing their violation are already studied directly. Our admission checker neither causes a discharge nor establishes deadline feasibility merely by excluding contrary tokens. |
| Hublet et al., [Scaling Up Proactive Enforcement](https://people.inf.ethz.ch/basin/pubs/cav25.pdf), CAV 2025, Theorem 1. Full text. | A closed enforceable metric first-order temporal formula with functions, aggregations, and lets has a sound enforcer under their rules; transparency is established for a fragment. | Strong modern neighbor for language and operational claims. Comparing only with propositional or reactive guards would miss it. |
| [Practical Runtime Enforcement of First-Order Temporal Requirements](https://arxiv.org/html/2610.04611v1), 3 October 2026 preprint, Theorem 4.4, §4.5, Appendix B, §5.5. Full text. | Compilation soundness is conditioned on candidate clauses passing conflict and termination checks. The authors report Lean 4 formalization. The banking evaluation replays translated benchmark runs. | A direct recent comparison target. Its paper-level theorem and replay evidence must not become a claim that either implementation covers arbitrary deployments or adapting agents. |

A short exact source excerpt anchors the first boundary: Doyen–Raskin require
“a predecessor operator Preabs that applies to maximal elements” (p. 8).
The operator's correctness is an obligation, not a consequence of calling a
collection an antichain.

**Local comparison.** Paper 6's Theorem 1c already labels its result an
elementary specialization. The current `future_fact_reachability.py` source
explores every reachable state ID and outgoing transition, then filters
nonmaximal fact sets. Its labels describe current state facts; it does not
accumulate a path union. This is the correct distinction to retain.
The source was inspected; this note does not certify its execution.

**Explicit pruning counterexample.** Let initial state $i$ have successors
$x$ and $y$, with labels $L$x$=\{a\}$, $L$y$=\varnothing$.
Let $x$ be terminal and let $y\to z$, where $L$z$=\{a,b\}$.
Use fixed rules $a\to O(w)$ and $b\to F(w)$. Discarding the control
state $y$ because its label is included in $L$x$$ loses the conflict at
$z$. Exploring the graph first and only then filtering labels preserves it.
This is a constructed mathematical counterexample, not a measured adapter trace.

**Next theorem target A: an explicit conformance implication.** Define a finite
model $M$, initial states $I$, fixed baseline facts $B$, labels $L$,
and upward-closed conflict predicate $C$. After complete graph exploration,

$$
  \forall s\in Reach_M$I$,\ \neg C(B\cup L(s))
  \quad\Longleftrightarrow\quad
  \forall X\in Max_\subseteq\{B\cup L(s):s\in Reach_M$I$\},
    \ \neg C(X).
$$

Pointwise monotonicity of $C$ suffices; graph transitions need not grow labels.
For a runtime safety implication, additionally exhibit a relation from every
reachable concrete adapter state to a reachable model state, initial coverage,
step preservation (allowing defined stuttering), and inclusion of concrete
policy-relevant facts in the corresponding model label. Atomic admission must
bind the policy/model epoch used by the check. Under these premises model
safety transfers to concrete safety. An abstract conflict witness is not a
concrete violation without a realizability/reflection argument.

This is a proposed specialization of standard simulation/refinement reasoning.
The research contribution would be the adapter relation, independent
conformance evidence, and a useful auditable artifact, if established.

**Independent checks to add.** Retain the two dormant-conflict/unreachable-union
witnesses, add the dominated-control-state example above, label retraction,
equal-label/different-successor states, and a stop-before-frontier-exhaustion
case. A partial search may return a discovered unsafe witness; it must not
return safe. For an optimization claim, measure exploration, maxima
maintenance, checker calls, and total cost separately, varying antichain width
and the number of equal-label states.

**Open gaps.** No claim here resolves real-adapter conformance, dynamic policy
changes, dishonest fact provenance, timed obligation discharge, or the
complexity of succinct reachability. A later study must compare actual workloads
with the proactive-enforcement sources above before claiming practical advantage.

## 2. Bonds, sanctions, and public continuation states

**Structural question.** For a fixed public strategy automaton in a discounted
two-player game, does every player prefer its prescribed action after every
feasible public history, including punishment histories?

| Primary source and checked location | Hypotheses and relevant result | Delta and access boundary |
| --- | --- | --- |
| Abreu, Pearce, and Stacchetti, Toward a Theory of Discounted Repeated Games with Imperfect Monitoring, 1990; [author bibliography](https://www.princeton.edu/~dabreu/index_files/Papers.htm), [Yale working-paper record](https://elischolar.library.yale.edu/cowles-discussion-paper-series/1034/). | The primary record describes discounted imperfect-monitoring equilibrium values and self-generation. | Foundational neighbor. The linked full-text downloads failed or yielded an unreadable scan in this pass; exact 1990 theorem hypotheses were not independently checked. Do not cite this pass as that check. |
| Abreu and Sannikov, [An Algorithm for Two-Player Repeated Games with Perfect Monitoring](https://pages.nyu.edu/debraj/Courses/NewRes16/Papers/AbreuSannikov.pdf), inspected 27 April 2012 manuscript, §2 Definition 1 and equations (A), (IC). | Two players, finitely many actions, common discount factor below one, observed actions, pure strategies and public randomization. Values are generated by stage rewards and continuation values that satisfy incentive constraints. | Stronger task: computing an equilibrium payoff set. Harbor audits one declared strategy automaton; a cooperative-state inequality alone is insufficient. Use the manuscript date when describing the inspected version. |
| Karabegovic, [An Algorithm for Two-Player Repeated Games with Imperfect Public Monitoring](https://ssrn.com/abstract=5334893), primary abstract posted 1 July 2025. | The author describes computation of PPE payoffs with imperfect public monitoring, discounting, and public randomization. | The 2024 Graz record and 2025 SSRN posting are versions of one work. Full text remained inaccessible. This is a modern lead to inspect, not theorem-level comparison evidence yet. |

**Local comparison.** `bonded_trigger_audit.py` explicitly gives perfectly
public action observation and a shared countdown. Its expected forfeiture can
equal $qB$, but $q$ affects the current monetary payment only. It does not
gate observation or transition to punishment. Its three forfeiture conventions
charge different actions in punishment states and therefore define different
games. The module also excludes finite-bankroll insolvency, exit, identity
escape, coalitions, and participation constraints.

**Next theorem target B: a checkable all-state certificate.** For a finite
public automaton with bounded rewards, discount $0\le\delta<1$, prescribed
actions $a^*(s)$, and a declared stochastic transition kernel, solve

$$
 V_i(s)=r_i(s,a^*(s))+\delta\sum_{s'}P(s'\mid s,a^*(s))V_i(s').
$$

For every player, feasible public state, and unilateral action $b_i$, verify

$$
 r_i(s,(b_i,a^*_{-i}(s)))+
 \delta\sum_{s'}P(s'\mid s,(b_i,a^*_{-i}(s)))V_i(s')
 \le V_i(s).
$$

The standard discounted one-shot-deviation argument supplies the implication
to sequential optimality for the specified strategy/model. A new generic
equilibrium theorem is not claimed. Exact rational values, all inequalities,
and failed-state witnesses would make the particular strategy certificate
independently checkable. Checking only states on the obedient path misses the
credibility of prescribed punishment.

**Monetary detection is not monitoring.** A next model should separately expose
$q_{pay}$, bond $B$, a public signal law $\pi(y\mid s,a)$, and update
$g(s,y)$, including false alarms. Replacing the signal law by a scalar
expected payment erases continuation incentives.

A constructed example makes the distinction exact. Let cooperative,
deviation-against-cooperation, and absorbing punishment rewards be 3, 4, and
1; let $\delta=4/5$. Charge expected forfeiture $q_{pay}B=1/2$ only for
the cooperative-state deviation. Suppose detection switches permanently to
punishment; otherwise cooperation continues. Then $V_C=15$, $V_P=5$, and

$$
 G_C = 4-\tfrac12 + \tfrac45[(1-q_{detect})15+q_{detect}5]-15
     = \tfrac12-8q_{detect}.
$$

With the same monetary exposure, the gain is $1/2$ at no detection,
zero at detection probability $1/16$, and $-15/2$ at certain detection.
A Python `Fraction` calculation independently evaluated those three cases
during this pass. This is a synthetic calculation, not evidence of participant
behavior or a fitted enforcement mechanism.

**Open gaps.** The all-state certificate still needs a specified public
information structure and action set. Endogenous inspection, correlated
payment/detection, finite capital, appeal or revocation, renegotiation, and
entry/exit require new states/actions or a different equilibrium concept.
No 2025–2026 bond-specific theorem was fully verified in this bounded search;
the modern imperfect-public-monitoring lead does not fill that gap.

## 3. Mechanized scope, vacuity, and delegation

**Structural question.** Does a successful safety proof exclude a bad accepted
delegation while still admitting intended valid delegations, and does the
verified transition system represent the relevant implementation behavior?

| Primary source and checked location | Source-supported boundary | Consequence for the campaign |
| --- | --- | --- |
| Beer et al., [Efficient detection of vacuity in temporal model checking](https://research.ibm.com/publications/efficient-detection-of-vacuity-in-temporal-model-checking), 2001, authors' research page. | A valid temporal formula can be uninformative because its antecedent is never satisfied; the paper develops vacuity and interesting witnesses. | Foundational lead; full theorem text was not retrieved here. A green safety result alone is inadequate. |
| Lamport, [Refinement in State-Based Formalisms](https://lamport.azurewebsites.net/pubs/refinement.pdf), 1996, pp. 4–6, equations (6)–(7), (13)–(14). Full text. | A relation must both yield high-level behaviors and exist for every low-level behavior; implication alone permits the false relation. | The implementation-to-model relation needs totality/coverage as well as preservation. A filtered demonstration trace is not a refinement proof. |
| Blanchet, [Modeling and Verifying Security Protocols with the Applied Pi Calculus and ProVerif](https://bblanche.gitlabpages.inria.fr/publications/BlanchetFnTPS16.pdf), 2016, §§1.1–1.2 and correspondence discussion. Tool author's technical account. | Symbolic primitives, computational cryptography, specifications, and implementations have different guarantees. Horn abstraction may produce a derivation that cannot be reconstructed as a protocol attack. | Record exact query, model and adversary, solver outcome, and reconstructed witness. Non-injective correspondence does not automatically establish replay freedom. |
| Kani team, [Checking Code Reachability and Sanity Checking Proof Harnesses with kani::cover](https://model-checking.github.io/kani-verifier-blog/2023/01/30/reachability-and-sanity-checking-with-kani-cover.html), 2023. Official documentation. | A cover asks whether some harness execution reaches the stated condition; assertions quantify over admitted executions. | Require named successful-acceptance and rejection witnesses after relevant assumptions. A cover before an excluding assumption cannot establish reachability beyond it. |
| Wang et al., [KaPilot](https://arxiv.org/html/2607.21957v1), 24 July 2026, §3.6 and case study 2. Full text. | Appending an impossible postcondition detects contradictory preconditions; the authors separately assess verification success and specification quality. | Direct contemporary neighbor for automated proof-quality gates. Its positive results do not establish completeness of Harbor's contracts or arbitrary capability domains. |
| Birgisson et al., [Macaroons](https://www.ndss-symposium.org/wp-content/uploads/2017/09/04_3_1.pdf), NDSS 2014, design/authorization sections. Full text. | Caveats attenuate authority in a concrete decentralized credential construction. | Attenuation is established prior art. The cryptographic construction and caveat semantics are not interchangeable with Harbor's decoded predicates or flat-string FFI. |

A short exact KaPilot excerpt is: “A successful Kani verification does not
exclude vacuous specifications” (§3.6). Existence of one accepted execution
addresses one vacuity risk; it does not show that all intended inputs survived
the assumptions or that the asserted property is strong enough.

**Local comparison.** The inspected Chapter 2 source explicitly distinguishes
decoded policy predicates, bounded capability grammars, a stubbed parser, and
a signed-card example. It says the crate lacks a signed delegation-chain
verifier. It also records accepted-chain and rejected-escalation covers.
These are documented source contracts; current exact-head solver runs remain
the execution lane's responsibility.

**Next proof target C: accepted/rejected cross-model agreement.** Choose one
finite capability vocabulary and one precise result type. On that declared
domain, require equality between the Rust predicate and an independent
set-based relation, while a protocol model states per-hop authorization over
the same vocabulary. Include:

1. Equal parent and child rights accepted (reflexivity).
2. Strictly narrower child accepted.
3. Broader child rejected.
4. Root write → child read → grandchild write rejected.
5. Empty/duplicate rights and lifetime/rate boundaries interpreted explicitly.
6. At least one real accepted path that passes the relevant guards, plus
   a reconstructible malicious attempt that reaches the rejection boundary.

For arbitrary-depth chains, state and prove an induction over the immediate
parent relation; a fixed-depth solver model alone does not supply it.
Separately prove or test parsing/signature-to-decoded-state conformance on
the intended wire grammar. Cryptographic correctness, side channels and
runtime identity binding remain separate obligations.

**Required negative controls.** A reject-all mutant should fail acceptance
coverage; an accept-all mutant should violate rejection safety; root-only
comparison should admit the re-escalation witness; removing reflexivity should
lose an equality witness; and an impossible assumption should fail the intended
coverage gate. Require the named semantic failure, not compilation failure.
The log acceptance contract must reject a missing harness, missing cover,
unknown solver result, or stale source digest.

## Research decisions for the next iteration

1. **Execute A first:** prove the small conformance implication, maintain full
   state exploration as reference, and build a concrete adapter relation.
   The difficult premise is coverage of the adapter's permitted behaviors.
2. **Extend B as a separate model:** retain the perfect-public model, then add
   an explicit public signal kernel. Check all-state constraints with exact
   arithmetic before making any claim about imperfect monitoring.
3. **Execute C as an evidence contract:** make valid acceptance, rejection, and
   model/implementation agreement separately queryable; publish the admitted
   domains with the result.
4. **Return to scholarship before a contribution paragraph:** read the full
   Karabegovic manuscript and original APS theorem; compare our obligations
   and artifact boundary with EnfGuard/EnfFlash; finish citation snowballing
   around the closest candidate. No paid services or publication are needed.

The proposed deltas are narrower application, independent implementation,
and a possible checked bridge. Stronger-result or novelty classifications
remain unearned. No paper submission, deployment, or local Port Daddy runtime
operation occurred in this research lane.
