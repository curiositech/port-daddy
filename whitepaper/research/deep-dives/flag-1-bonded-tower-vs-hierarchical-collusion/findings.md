# Findings — flag 1

**Dive run:** 2026-08-26. **Primary source obtained:** yes (working-paper version — see
caveat in *Sources obtained*).

## Verdict

**CLEAR** — on the flagged risk. Kofman & Lawarrée contains **no** result about
stacking monitors requiring unbounded collateral. The scout's characterisation is
wrong. Their paper is a *three-tier, one-level* model (principal / auditor /
manager) whose second monitor sits in an explicitly **horizontal** relationship
with the first and is *assumed exogenously honest*. Far from proving a regress
result, the paper names the regress as an **open question left for future work**:
"If all auditors behave strategically the interesting question arises as to whether
it is possible to police the police without falling in an infinite regress"
(working paper p. 67) [verified]. There is no proposition, lemma, corollary or
remark in the paper that bounds, diverges, or otherwise characterises collateral
across stacked monitoring levels [verified — I enumerated every Proposition (1–6)
and Lemma (3.1, 3.2, 5.1, 5.2, 5.3, 6.1) in the working paper].

**But the dive did not come back empty, and two of its findings are adverse to the
paper.** They concern Theorem 1 and the bibliography, not Theorem 2:

1. **NARROW (Theorem 1, not Theorem 2).** Kofman & Lawarrée's Lemma 5.1 is
   Paper 3's stage-deterrence threshold under the confiscation convention, at
   perfect detection. Their δ = (P^m − w)/(P^m + P^i) with w = 0 is exactly
   Paper 3's ρ*_c = G/(d(G+B)) with d = 1, G = P^m, B = P^i. Paper 3 does not claim
   Theorem 1 as new, so nothing breaks — but the paper currently cites Becker and
   Avenhaus–von Stengel–Zamir for this and should cite the hierarchical-collusion
   line as well.
2. **Bibliographic gap.** `paper3.tex`'s bibliography contains *no* citation to the
   collusion-in-hierarchies literature at all — no Tirole, no Kofman–Lawarrée, no
   Laffont–Martimort, no Diamond. A paper whose headline second theorem is about
   bribing stacked auditors, and which asserts novelty for "the contraction theorem
   for a *stackable* audit tower," cannot go to referees without engaging that
   literature. This is the single most actionable output of the dive.

**Separately, a falsification pass on Theorem 2 itself (per `skills.md`) turned up
two internal problems that no literature check would have found.** See
*Falsification pass* below. Neither is a contradiction with prior work; both are
defects in the theorem's own statement. One of them (the C = 1 case) matters,
because the paper's claim that C = 1 "provably" fails is contradicted by the
paper's own arithmetic.

---

## Sources obtained

| Source | Obtained? | Version read | Confidence |
|---|---|---|---|
| Kofman & Lawarrée 1993 | **Yes** | **Working paper**: MIT Sloan School of Management Working Paper #3188-90-EFA, "May 1988, Revised March 1990", 69 pp. + appendix, read in full from the scan at DSpace@MIT, `hdl.handle.net/1721.1/47051`, file `collusioninhiera00kofm.pdf`. **Not** the published Econometrica text. | `verified` for the working paper; `probable` that the published version carries the same results (see below) |
| Tirole 1986 | No | Not obtained (JLEO paywalled; the one apparently-free mirror is behind bot protection) | characterised only through Kofman & Lawarrée's own description of it, which is `verified` as *their* description |
| Laffont & Martimort 1997 | **Yes** | Published Econometrica text, 65(4):875–911, scanned PDF from the Toulouse Capitole repository (`publications.ut-capitole.fr/14924/`). Read: abstract, §1–2, §6.1–6.3 | `verified` for the passages quoted |
| Diamond 1984 | Partially | The 1984 *RES* article was **not** obtained. I read Diamond's own later restatement of the same model: D. W. Diamond, "Financial Intermediation as Delegated Monitoring: A Simple Example," *Federal Reserve Bank of Richmond Economic Quarterly* 82(3), Summer 1996, pp. 51–66 — self-described as "a simplified version of the model in *Financial Intermediation and Delegated Monitoring* (Diamond 1984)" | `verified` for the 1996 exposition; `probable` for attributing the argument structure to the 1984 paper (Diamond himself makes the attribution) |
| Faure-Grimaud, Laffont & Martimort 2003; Baliga 1999 | No | Not obtained | — |
| Avenhaus, von Stengel & Zamir 2002 (Ch. 51) | No | Not obtained (host not reachable from this session). A near-miss worth recording: von Stengel's "Recursive Inspection Games" (arXiv:1412.0129) sounds like prior art for Theorem 2 and **is not** — its recursion is over *time periods* in a sequential inspection game with a limited inspection budget, not over levels of inspector | `verified` that arXiv:1412.0129 is not about stacked inspectors |

### Why the working-paper version is good enough for this verdict

Three checks, all pointing the same way:

- The published abstract, taken verbatim from the Econometric Society's own page
  [`verified`], is: *"In this model, shareholders can use auditors' reports to
  contract with a privately-informed manager. Our imperfect audit technology allows
  the auditor and the manager to collude. Auditors are useful only if they have good
  information and if the manager's liability is high. Expected maximum deterrence is
  not desirable and production is suboptimal, even with unbounded punishments,
  risk-neutral agents, and costless auditing. Raising the manager's punishment raises
  the bribe he may offer the auditor, which raises the cost of preventing collusion.
  We also distinguish internal auditors (who are costless but may collude) from
  external ones (who are costly but never collude) and show that the optimal contract
  may specify random external audits."* Every clause of that abstract maps onto a
  result I read in the working paper. No clause mentions towers, stacking, regress,
  or collateral across levels.
- The one substantive claim in the working-paper abstract that is *absent* from the
  published abstract is "Finally, we present a model where allowing collusion is the
  optimal strategy for the principal" — which the authors spun off into Kofman &
  Lawarrée, "On the optimality of allowing collusion," *Journal of Public Economics*
  61(3):383–407, 1996 [`probable`, from RePEc/Crossref metadata; I did not read that
  article]. The published Econometrica paper is therefore a *subset* of the working
  paper, not a superset. A stacking result cannot have been added.
- Note a bibliographic correction for `reading-list.md`: the JSTOR stable id is
  **2951721**, not 2951722. Crossref DOI `10.2307/2951721`; the Econometric Society's
  own citation block links `https://www.jstor.org/stable/2951721` [`verified`].

**Caveat that must survive into the paper:** proposition and lemma numbers below are
the **working paper's**, and page numbers are the **working paper's folios**. Do not
cite them as Econometrica proposition or page numbers. If any of this goes into
`paper3.tex` as a numbered reference, the published article must be pulled first.

---

## Q1 — Does Kofman & Lawarrée contain an unbounded-collateral result?

**No such result appears in this paper.** [`verified`]

The paper's structure, enumerated in full from the working paper:

| Result | Content (paraphrase) |
|---|---|
| Proposition 1 (BO) | Optimal contract with **no** auditor |
| Proposition 2 | Optimal contract with one **free, faithful** auditor |
| Proposition 3 | Optimal contract with one **costly, faithful** auditor |
| Proposition 4 | Optimal contract with one **free, unfaithful** (bribable) auditor |
| Proposition 5 | Optimal contract with **two** auditors — one bribable insider, one honest costly outsider |
| Proposition 6 | Optimal contract with a **free auditor of unknown type** (honest w.p. 1−c) |
| Lemmas 3.1, 3.2, 5.1, 5.2, 5.3, 6.1 | Supporting technical steps |

Not one of these concerns more than **two** monitors, and the second monitor is never
itself a monitored party. The single sentence in the entire paper that touches the
regress question is in *Conclusions and Directions for Further Research* (working
paper p. 67) [`verified`, verbatim]:

> "Our model can be extended in a variety of directions. If we consider a costly
> self-interested internal auditor, for example, the probability of sending the
> external alone need not be zero any more. If all auditors behave strategically the
> interesting question arises as to whether it is possible to police the police
> without falling in an infinite regress."

That is a **research agenda item, stated as an open question, in the conclusion**. It
is the opposite of a theorem. It is, in fact, almost word-for-word the question
Paper 3's Theorem 2 answers — which makes Kofman & Lawarrée a *supporting* citation
for Paper 3, not a competing one.

The paper is explicit elsewhere that its honest monitor is honest by assumption, not
by construction (working paper p. 49) [`verified`, verbatim]:

> "(2) The second model introduces a second auditor (the police of the police). That
> auditor is assumed to be always honest but expensive."

And in the model setup (working paper §The Model) [`verified`, verbatim]:

> "The second auditor — external — serves only to perform his audit; we assume that he
> is 'collusion-free' (he always reports truthfully), that his services are costly and
> that his information is perfectly correlated with the internal's information."

**Where the scout's "unbounded collateral" phrasing probably came from.** Two
candidates, both real features of the paper, neither the claimed result:

- The abstract's phrase *"even with unbounded punishments"*. That is about the
  **manager's** liability bound P^m being taken to infinity in a **one-level** model.
  The result is a *negative* result about deterrence (first best is not attained), not
  about collateral in a hierarchy.
- The escalation logic: the coalition-incentive-compatibility constraint in the
  one-auditor model is literally **(CIC) w ≥ P^m** (working paper p. 35) [`verified`,
  verbatim from the constraint list]. Deterring collusion costs the principal a reward
  at least equal to the punishment being evaded. Extrapolate that naively up a
  hierarchy and you get "each level costs at least what the level below is protecting,
  so collateral explodes." That extrapolation is **not in the paper**, and Paper 3's
  Theorem 2 is precisely the argument for why it fails once the monitor's stake is a
  *bond forfeited on detection* rather than a *reward paid for reporting*.

---

## Q2 — Is monitor selection randomised and hidden?

**Randomised: yes, over *whether* to check. Hidden identity: no. Multi-pool: no.**
[`verified`]

The timing (working paper, §Timing, pp. 12–13) [`verified`, paraphrased faithfully
from the numbered list]:

1. Nature draws productivity θ and the auditors' signal s.
2. The manager learns θ.
3. The principal offers the contract, which **specifies** the audit probabilities
   γ(x) and δ(x, s^i) along with all transfers and the liability caps P^m, P^i.
4. Contract signed; effort chosen; output realised and observed by all.
5. The internal auditor is sent with probability γ(x); the signal s is observed by the
   manager and the auditors.
6. **The manager and the internal auditor sign the side contract.**
7. The internal reports s^i; side transfers are realised.
8. **The principal asks for the external's report with probability δ(x, s^i).**
9. Transfers realised.

So the answer to the question as `questions.md` puts it — *can the colluding party
identify its counterparty before committing to a side payment?* — is **yes,
unambiguously**. There is exactly one internal auditor, he is a named party who "lives
in the firm," and the manager bargains with him face to face at step 6. What the
colluders do *not* know at step 6 is the realisation of the step-8 external check; they
know only its contracted probability δ.

That is a *sealed audit-occurrence draw*, not a *sealed identity draw*. The distinction
is exactly the one Paper 3 §"Why sealing is load-bearing" makes: the factor C in
Paper 3's threshold comes from the briber not knowing **which of C disjoint cliques**
the auditor will be drawn from. Kofman & Lawarrée have C = 1 — one identifiable
bribable monitor — plus an exogenously honest checker sampled at rate δ.

**This is the finding that dissolves the flag.** Kofman & Lawarrée's model is Paper 3's
C = 1 case *with the honest anchor already installed*. Paper 3's own boundary section
already says a tower "needs an honest root … the operator in a small deployment, a
bonded arbitration market at scale." Kofman & Lawarrée's external auditor **is** that
root, priced at z per invocation. The two papers are answering adjacent questions about
the same object: Kofman & Lawarrée price the root and ask how often to call it;
Paper 3 asks what happens when you do not get a free honest root and must manufacture
one out of mutually-suspicious bribable parties.

Also relevant to the "framework excludes it by assumption?" half of the README's
question: Kofman & Lawarrée state that Tirole's baseline **rules this out by axiom**
(working paper §The Model) [`verified`, verbatim]:

> "Tirole relies on a third axiom which rules out the possibility of dividing the
> auditing job among several auditors. This allows the auditor and the manager to
> collude without any risk of being discovered. The point of this paper is to explore
> the consequences of introducing a second auditor together with a system of rewards
> and punishments to prevent deviant coalitions."

and that their own second monitor is horizontal, not vertical (working paper,
Introduction) [`verified`, verbatim]:

> "In this paper, we consider a different way of preventing collusion; creating an
> alternative source of information. Our suggestion is to introduce a second supervisor
> (in a horizontal relationship with the first) whose purpose is to discourage deviant
> coalitions."

**Answer to the README's question (a): Paper 3's C-pool sealed sampling is a mechanism
Kofman & Lawarrée's framework neither covers nor prices. It is excluded one level up,
by Tirole's third axiom, which Kofman & Lawarrée relax only to the extent of adding one
*honest* horizontal checker.**

---

## Q3 — What quantity is unbounded, if any?

Taking the four candidates in `questions.md` one at a time [all `verified`]:

| Candidate | In Kofman & Lawarrée? |
|---|---|
| Unbounded **collateral per monitor** | **No.** The monitor's stake is a liability cap P^i, exogenous and finite, with "the same limited-liability interpretation" as the manager's P^m. |
| Unbounded **total collateral across the hierarchy** | **No.** There is no hierarchy to sum over — two monitors, one of them honest. |
| Unbounded **depth** | **No.** Depth is fixed at one auditing level. |
| Unbounded **transfers in the collusion side-contract** | **Bounded above by P^m**, the manager's own liability cap: "To avoid the punishment P^m the manager is willing to pay the auditor up to P^m." |

The only thing taken to infinity anywhere in the paper is **P^m, the manager's maximum
punishment**, and the result there is *negative and one-level*: production stays bounded
away from first best however large P^m gets, so the principal optimally declines to use
its full punishment capacity. Verbatim (working paper p. 40) [`verified`]:

> "Then the punishment for the manager, the effort of the low productivity type and the
> profit of the principal are kept constant even if the maximum punishment available
> increases. In other words, even if higher punishments are available it is not optimal
> to use them."
>
> "So, even though production does not reach its first best level, *expected* maximum
> deterrence is not optimal."

**None of the four candidate claims contradicts Theorem 2.** Paper 3 bounds total bond
capital at B·⌈log G₀ / log(1/(1−ρd))⌉, and nothing in Kofman & Lawarrée speaks to that
quantity in either direction.

---

## Q4 — Bond versus wage-plus-constraint

The two instruments are genuinely different, and — this is the sharp part — **Kofman &
Lawarrée say in the text that switching to Paper 3's instrument collapses their
problem.** Two passages, both verbatim [`verified`]:

Working paper p. 35, immediately after the constraint list containing (CIC) w ≥ P^m:

> "We have implicitly ruled out the possibility that the auditor pay up-front the
> expected reward he will get by exposing the manager¹⁸. If the principal is allowed to
> sell the rights of auditing, the auditor will only receive his reservation utility.
> The principal will then be in a situation analogous to the one discussed in the model
> with a faithful auditor."
>
> [footnote 18] "This possibility would not be optimal if the auditor was infinitely
> risk averse or had a liquidity constraint."

Working paper p. 40:

> "Two puzzling features appear in this model: the auditor is earning some rent and the
> first best is not attainable with unbounded punishments even though all players are
> risk neutral. These results depend crucially on the fact that we do not allow the
> principal to 'sell' the right to audit, or to impose on the auditor negative transfers
> when he reports that the manager complied. Either possibility would take us back to
> the case of a faithful auditor (see footnote 17)."

Read adversarially, that is a *hostile* pair of quotes for Paper 3, and the paper should
meet it head-on rather than hope a referee misses it. What it says is: an auditor who
posts capital up front is, in Kofman & Lawarrée's model, equivalent to an honest auditor
— no tower required, no contraction required, one level and done.

**Why Paper 3 is nonetheless not subsumed by it.** Kofman & Lawarrée's
sell-the-audit-rights device works because their bribable auditor's *entire* payoff from
honest behaviour is the contingent reward w. Refusing to report forfeits w automatically;
**no detection event is needed**, so the forfeiture is self-executing. Paper 3's judge is
paid for grading whether or not it exposes anything; its bond is slashed only on ρd, i.e.
only if a *higher-level auditor* catches it. That is precisely why Paper 3 needs the level
above, and precisely why Kofman & Lawarrée's shortcut is unavailable in the LLM-judge
setting. This is a real and defensible distinction, but it is currently **implicit** in
`paper3.tex` and needs to be made explicit — it is the load-bearing reason the tower
exists at all.

Instrument comparison:

| | Paper 3 | Kofman & Lawarrée |
|---|---|---|
| Monitor's stake | Bond B, posted ex ante, slashed on detection | Liability cap P^i (an exogenous bound on ex-post punishment), plus a contingent reward w |
| What makes honesty pay | ρ·d·B ≥ G — probability × detection × bond | (CIC) w ≥ P^m with one auditor; with the honest outsider at rate δ, δ(P^m + P^i) ≥ P^m (Lemma 5.1) |
| Who pays | The judge, up front, out of its own capital | The principal, ex post, out of profits (w is a *rent* to the auditor) |
| Interconvertible? | Partially. Kofman & Lawarrée's own p. 35 remark says selling audit rights converts wage→bond and trivialises collusion, subject to footnote 18's liquidity/risk-aversion escape. Paper 3's judges are risk-neutral and bondable by construction, so Paper 3 sits inside the branch Kofman & Lawarrée exclude. | |

**Lemma 5.1 is prior art for Theorem 1.** Verbatim (working paper p. 83) [`verified`]:

> "**Lemma 5.1:** If the outsider is sent after the insider, the conditional probability
> of sending the outsider is δ = (P^m − w)/(P^m + P^i)."

Set w = 0 (Lemma 5.2 shows the reward is always at a corner, w ∈ {0, P^m}, and w = 0 is
the regime where the outsider does the deterring): δ* = P^m/(P^m + P^i). Paper 3's
Theorem 1 under the confiscation convention is ρ*_c = G/(d(G+B)). With the identification
G = P^m (the value the coalition is protecting), B = P^i (the monitor's forfeitable
stake), d = 1 (the outsider's signal is perfectly correlated with the insider's, so an
audit detects a lie with certainty), these are **the same expression**. Paper 3 does not
claim Theorem 1 as new, so nothing breaks — but a referee from this literature will
recognise it, and the citation should be there.

Two further Kofman & Lawarrée results a referee will read as adjacent to Paper 3's tower
[`verified`]:

> "**Lemma 5.3:** The external auditor is never used alone. I.e., φ = 0."

and, in the conclusion, "the external auditor is always hired on a random basis because
his role is mainly to police the internal auditor." Both are consonant with Paper 3, not
competing with it: the expensive honest root is invoked sparingly, on a randomised
schedule, and only to check a cheaper monitor.

---

## Q5 — Collusion-proofness principle

**It applies to a different object than Paper 3's sealed sampling, and does not threaten
Theorem 2.** [`verified` for the statement; the application to Paper 3 is my argument,
labelled as such]

Verbatim (Laffont & Martimort 1997, Econometrica 65(4), p. 889) [`verified`]:

> **DEFINITION 2:** A mechanism M = {q(·); t₁(·); t₂(·)} which gives to the agents
> utility levels V_i(θ_i), i ∈ {1,2}, when it is played noncooperatively is
> *collusion-proof* when the null side contract is coalition-interim-efficient with
> respect to this mechanism.
>
> **PROPOSITION 4:** *There is no loss of generality in restricting the principal to
> offer collusion-proof contracts, i.e., any perfect Bayesian equilibrium of the overall
> game of grand contract offer and coalition formation gives an allocation for the
> principal and the agents which can also be achieved with a collusion-proof contract.*

Its hypotheses, stated by the authors on the same page and in §1 [`verified`]:

- Two agents (a regulated duopoly), each with private cost information; collusion is
  **between the agents**, not between an agent and a supervisor.
- The side contract is offered by an **uninformed third party / mediator** who maximises
  the sum of the coalition's expected rents subject to feasibility, incentive and
  acceptance constraints.
- The principal has full commitment to a grand mechanism.
- The principle is **weak**: "Our concept of collusion-proofness is rather weak. The null
  side contract may be only *one* continuation equilibrium of the game of coalition
  formation sustained with passive beliefs but other equilibria in which the third party
  offers a non-null side contract could also be sustained."

**Does it cover Paper 3's sealed sampling?** No — and for a reason that helps Paper 3
rather than hurting it. Proposition 4 says nothing about *which* mechanisms are
available; it says that within a **fixed** coalition-formation game, restricting to
collusion-proof grand contracts loses nothing. Laffont and Martimort say this themselves,
on p. 892: "The Collusion-Proofness Principle does not make any restriction on the set of
available mechanisms in the first place." Paper 3's sealed C-clique sampling is not a
grand contract at all; it is a change to the **coalition-formation game** — it changes
which side contracts are feasible and what they cost, by forcing payment before the draw
is known. That is transaction-cost territory, and it is territory Laffont and Martimort
explicitly reserve for a separate section: from their roadmap on p. 877, "Section 9 shows
how asymmetric information can be used to generate endogenously some transaction costs in
side contracting" [`verified`, verbatim].

So the right characterisation is: **Paper 3's sealing is a device for manufacturing
transaction costs in side contracting, out of the briber's uncertainty about the audit
draw.** Laffont & Martimort manufacture such costs out of asymmetric information *within*
the coalition; Paper 3 manufactures them out of sealed randomisation over monitor
identity. Same target, different generator. That framing is worth a sentence in the paper
because it names the mechanism in the vocabulary a referee from this field already has. I
did **not** read their §9 and am not claiming their §9 contains Paper 3's device; the
sentence above rests only on the roadmap description, which is `verified` as the authors'
own summary.

---

## Q6 — Diamond 1984 correspondence

**Related but structurally different — and Paper 3 should cite it anyway.** [`verified`
against Diamond's own 1996 restatement; `probable` as attribution to the 1984 article, on
Diamond's own attribution]

Diamond poses Paper 3's question in Paper 3's words [`verified`, verbatim, Richmond Fed
1996, p. 59]:

> "How can the monitoring task be delegated without the need to monitor the monitor? The
> answer is for the banker to face liquidation as a function of the amount paid to the
> 10,000 small lenders (depositors). This provides incentives to the banker in the same
> way it does to a borrower: the banker is always better off paying a sufficient amount
> to avoid liquidation."

and shows that a stake alone is not enough — independence is the load-bearing ingredient.
Section heading, verbatim: **"Delegated Monitoring without Diversification Does Not
Succeed."** The limit argument [`verified`, verbatim, pp. 63–64]:

> "The law of large numbers implies that if the bank gets sufficiently diversified across
> independent loans with expected repayments in excess of the face value of bank
> deposits, then the chance that it will default on its deposits gets arbitrarily close
> to zero. In the limit of a perfectly diversified bank, the bank would never default and
> would face no liquidation costs. In addition, the control rent needed to provide
> incentives to monitor approaches zero. The delegation cost for the bank approaches
> zero, and the only cost of intermediation is the (unavoidable) cost of monitoring."

**Structural correspondence, spelled out:**

| | Diamond | Paper 3, Theorem 2 |
|---|---|---|
| The regress question | "monitor the monitor" | "who audits the auditors" |
| The monitor's stake | Liquidation of the bank — a **non-pecuniary sanction**, no cash recovered | Posted bond B, slashed |
| What triggers the sanction | A **publicly observed, hard variable**: whether depositors were paid | A **higher-level audit** succeeding, w.p. ρd |
| Independence across what | N **monitored projects** in one monitor's portfolio | C **monitor pools** (cliques) |
| Why independence helps | Law of large numbers ⇒ the sanction is almost never triggered ⇒ delegation cost → 0 | Sealed draw ⇒ briber must buy all C ⇒ all-in bribe price CB exceeds protected value |
| Levels needed | **One.** No second-level monitor at all | ⌈log G₀ / log(1/(1−ρd))⌉ — 27 at the running parameters |

**Answer: no, these are not the same argument.** Diamond's independence is across the
*objects being monitored*; Paper 3's is across the *identities of the monitors*.
Diamond's mechanism is variance reduction; Paper 3's is a purchase-cost multiplier.
Diamond needs no tower because his sanction fires off a hard public variable; Paper 3
needs one because a judge's verdict is not such a variable.

**But the citation is mandatory anyway**, for three reasons: Diamond asks Paper 3's exact
question in Paper 3's exact words; Diamond is the canonical "finite capital +
independence terminates the monitoring regress" result; and a referee who knows Diamond
and does not see him cited will assume the authors do not. Being Diamond's cousin is good
company, as `questions.md` anticipated — the correspondence is friendly, and the
*differences* above are exactly what makes Theorem 2 a contribution rather than a
restatement.

One more reason to cite him: Diamond flags Paper 3's own boundary risk, in the same
breath as his limit result [`verified`, verbatim, p. 64]:

> "This is too strong because in practice the default risk of borrowers is not
> independent, it is positively correlated. In addition, the number of loans in the
> bank's portfolio is limited."

---

## Q7 — Independence of LLM judge pools

Not a literature question, but the read produced two things that bear on it directly, and
both say the paper's boundary caveat is *understated* rather than overstated.

**First, Kofman & Lawarrée assume perfect correlation between their two monitors' signals
and identify relaxing it as opening a new cost channel** [`verified`, verbatim, working
paper p. 68]:

> "Another interesting direction would be to allow the auditors' information to be
> imperfectly correlated. A new trade-off would appear, the internal could be punished by
> mistake and his individual rationality constraint would gain importance (he won't work
> unless he is compensated for the possible mistakes of the external)."

Translated into Paper 3's variables: once cliques disagree for reasons other than
corruption, the platform must **compensate honest judges for wrongful slashing**, and
that compensation is a cost item Theorem 2 does not carry. Theorem 2 prices bond capital
at B per level; it does not price the insurance premium on false positives. At high C —
exactly the regime the paper recommends — cross-clique disagreement from benign model
heterogeneity goes *up*, so the two forces work against each other: more cliques buy a
bigger bribery multiplier and a bigger wrongful-slash bill simultaneously. That trade-off
is absent from the paper and is a fair referee question.

**Second, Diamond's caveat above** ("in practice the default risk of borrowers is not
independent, it is positively correlated") is the same warning from the finance side,
about the same idealisation, from the canonical source.

**Third, the Sybil channel that `skills.md` flags is real and is not addressed.**
Theorem 2 counts C as the number of *disjoint* cliques. Nothing in the theorem
distinguishes C nominal from C real. A briber who *controls* several nominal cliques buys
them at price 0, so the effective threshold is C_real·B, not C·B, and C_real is
unobservable to the platform. The paper's boundary section says disjointness "is
falsifiable and must be monitored" via judge-pair agreement statistics — but agreement
statistics detect *correlated errors*, not *common ownership*, and a competent adversary
running two benches would keep their outputs uncorrelated precisely to pass that test.
**Recommendation: the boundary bullet should name the adversarial-Sybil case separately
from the innocent-correlation case; they need different detectors.**

---

## Falsification pass on Theorem 2 (adversarial, independent of the literature)

`skills.md` asks for the equilibrium-proof gate to be applied hostilely first. Findings
below are internal to `paper3.tex`.

### F1. The C = 1 case does not show what the paper says it shows

`paper3.tex` §`sec:conjecture` asserts that a homogeneous pool "provably does not" supply
the contraction, and §`sec:tower` calls C = 1 "linear life support." Run the paper's own
recursion at its own numbers:

- C = 1: threshold is G_k > CB = 50, bleed is Cβ = 10/level. From G₀ = 400 the linear
  phase runs 400 → 50 in exactly **35 levels**, at which point G_k ≤ CB and the geometric
  phase takes over, needing ⌈log 50 / log 1.25⌉ = **18 levels** more. Total **53 levels,
  bond capital 53 × 50 = 2650** [arithmetic, recomputable].
- C = 8: **27 levels, bond capital 1350** [matches the paper].

So **C = 1 also terminates, in finite depth, on finite bond capital** — at these
parameters within a factor of two of C = 8. What C > 1 buys is a *constant factor on the
depth*, not the difference between convergence and divergence. "Provably does not" is
false as written, and "linear life support" reads as non-termination when the paper's own
dynamics terminate. **This wording must change.** The honest claim is: *sealed
multi-clique sampling removes the linear phase entirely, cutting the certified depth (and
hence the bond capital) by roughly half at the running parameters.* That is still a
result. It is not the result the prose claims.

### F2. The profitability criterion is myopic, and the "iff" is not an iff

V(c) compares bribing versus not bribing **at a single level**. But a briber who buys all
C cliques at level k+1 has protected G_k only from the level-(k+1) audit; the
level-(k+2) audit still threatens it, so it must buy every level, at Cβ per level, for as
long as the tower runs. The paper's own C = 1 trace concedes this by iterating the bleed.
Evaluate the *strategy* rather than the *level*: at C = 1 the all-bribe path spends
35 × 10 = **350** to shepherd G₀ = 400 down to 50, and then loses the 50 geometrically
anyway. The one-level rule says "bribe" (400 > 50); the strategy-level comparison says the
bribery programme burns 87.5% of the protected value and ends in the same place. **The
theorem states G_k > CB as an iff for "rational bribery," but it is an iff only for a
one-level deviation.** The gate in `skills.md` — "deviation analysis for each player
against *every* alternative strategy" — is not met, because the briber's alternative
strategies include multi-level plans that the affine-in-c argument never scores.

This does not break the contraction (it makes bribery *less* attractive than the theorem
says, so the conclusion survives). It breaks the **statement**. Suggested repair: state
the threshold as a *per-level* condition and add one sentence noting that the multi-level
bribery programme is dominated a fortiori, or restate the theorem in terms of the
briber's dynamic problem.

### F3. Two unstated hypotheses worth naming in the theorem box

- **No holdout bargaining.** V(c) prices every clique at the floor β regardless of c. If
  the briber must buy *all* C, the last clique holds the whole surplus hostage and can
  extract far more than β. This *strengthens* the result but is currently an unstated
  assumption, and it is one the prior literature does not leave implicit — Kofman &
  Lawarrée devote a paragraph of their conclusion to generalising the coalition's
  bargaining split via a parameter p ∈ [0,1], with transfer w + (P^m − w)p, and use the
  Nash bargaining solution in the body [`verified`].
- **No liquidity constraint on the briber.** cβ is paid up front, out of nothing in
  particular. Kofman & Lawarrée's footnote 18 makes exactly this caveat about their own
  bonding device.

### F4. "Unbounded depth" (the README's item (b)) — confirmed, and it is a wording bug

The theorem's own bound is ⌈log G₀ / log(1/(1−ρd))⌉ = 27 at the running parameters:
finite, and logarithmic in G₀. The abstract, the express lane, the contributions list and
§`sec:tower` all say "unbounded depth." The defensible reading is *"finite bond capital
per level certifies a tower of any depth"* — but the sentence as written invites a referee
to point at the paper's own 27 and ask which it is. **Fix the wording in all five
places.** This is independent of the Kofman & Lawarrée verdict and should be actioned
regardless.

---

## Hypothesis comparison

| Hypothesis | Paper 3, Theorem 2 | Kofman & Lawarrée 1993 (WP version) |
|---|---|---|
| Monitor identity known to briber before payment | **No** (sealed draw over C cliques) | **Yes.** One named internal auditor who "lives in the firm"; the side contract is signed at step 6 with a known counterparty |
| What *is* hidden at the time of the bribe | Which clique the auditor comes from | Only whether the external check will be invoked (probability δ is contracted and public; the realisation is not yet drawn) |
| Number of independent monitor pools | C, disjoint by construction | **1** bribable monitor + 1 exogenously honest checker. Their signals are **perfectly correlated** by assumption |
| Is the second monitor itself monitored? | Yes — that is the tower | **No.** "That auditor is assumed to be always honest but expensive" |
| Depth of the monitoring hierarchy | ⌈log G₀ / log(1/(1−ρd))⌉ levels (27 at running parameters), rooted in an exogenously honest anchor | **One** auditing level, with an exogenously honest checker over it |
| Monitor's stake | Posted bond B, slashed on detection; bribe floor β = ρdB | Exogenous liability cap P^i (limited liability), plus a contingent reward w. (CIC) w ≥ P^m with one auditor; with the checker, Lemma 5.1 gives δ = (P^m − w)/(P^m + P^i) |
| Detection technology | Probability d per audit | Perfect given an audit — the external's signal is perfectly correlated with the internal's, so a lie is caught with certainty when checked |
| Monitor's information | Verdict on work quality; hard enough to be checkable by the level above | Signal s, "neither completely 'soft' nor 'hard'": the internal's report is not credible when it announces a bad state, but is verifiable when it announces a high state. Blackmail is ruled out |
| What is bounded | Total bond B·⌈log G₀ / log(1/(1−ρd))⌉ | Nothing across levels (there are none). Within the level: the side transfer is bounded above by P^m; P^m itself is taken to ∞ in a comparative-statics exercise |
| Collusion side-payments | Bribe floor β = ρdB; cliques priced at β regardless of how many are bought | Pareto-efficient, individually rational side contract; Nash bargaining split in the last part; assumed self-enforcing via an explicit device (split banknotes / two-signature escrow) |
| Who bears the cost of honesty | The judge, ex ante, as posted capital | The principal, ex post, as a rent w to the auditor — **except** in the branch the authors exclude, where selling audit rights converts it to ex-ante capital and, they say, "would take us back to the case of a faithful auditor" |
| Randomisation | Over monitor **identity** (sealed, VRF in deployment) | Over monitor **invocation** (δ, contracted and public) |

---

## Proposed text for `paper3.tex`

The verdict is CLEAR, so a "how we differ" sentence is warranted. Drafted in the existing
imported/new voice of §`sec:related`. **Do not paste this without first pulling the
published Econometrica text to confirm the result numbers**; the draft below deliberately
avoids citing any proposition or lemma number for exactly that reason.

Insert into the first (imported) paragraph of `\section{Related work, and what is
actually new}`, after the Avenhaus–von Stengel–Zamir sentence:

> The hierarchical half of the problem has its own literature, and it stops one
> level short of the tower. Tirole \cite{tirole1986} introduces the
> principal--supervisor--agent hierarchy with side contracts and rules out dividing
> the audit among several supervisors by axiom; Kofman and Lawarr\'ee
> \cite{kl1993} relax that axiom in the horizontal direction, adding a costly
> \emph{exogenously honest} external auditor invoked on a random schedule to police
> a bribable internal one, and their optimal invocation rate --- the audit
> probability at which the internal's forfeitable liability just covers the bribe it
> is refusing --- is our Theorem~\ref{thm:stage} under the confiscation convention
> at $d=1$. What they do not have is the recursion: their honest auditor is honest
> by hypothesis, and they close by naming as an open question ``whether it is
> possible to police the police without falling in an infinite regress.''
> Theorem~\ref{thm:tower} answers that question in the case their model excludes,
> where \emph{every} auditor is bribable and the honesty of the pool is
> manufactured, not assumed, by sealing the draw over $C$ mutually inaccessible
> cliques. Laffont and Martimort \cite{lm1997} show that restricting a principal to
> collusion-proof contracts is without loss of generality, holding the
> coalition-formation game fixed; sealed sampling is not a contract in that sense
> but a modification of that game --- it manufactures a transaction cost in side
> contracting out of the briber's ignorance of the draw, in the same spirit as their
> endogenous transaction costs but from a different source. The closest structural
> ancestor of the contraction itself is Diamond \cite{diamond1984}, who terminates
> the monitor-the-monitor regress with a stake plus independence and shows that
> without diversification the delegation fails; his independence runs across the
> \emph{projects} a single monitor holds and his sanction fires off a hard public
> variable, so he needs no second level, whereas ours runs across the
> \emph{identities} a single audit might draw and our sanction needs the level above
> to fire it.

And add to the *New, honestly stated* paragraph, at the end of the tower clause:

> --- the point of departure from Kofman and Lawarr\'ee \cite{kl1993} being that our
> auditors have no honest member to fall back on, so the honest root must be priced
> rather than assumed.

Bibliography entries:

```latex
\bibitem{tirole1986} J.~Tirole. Hierarchies and bureaucracies: on the role of
  collusion in organizations. \emph{Journal of Law, Economics, and Organization}
  2(2):181--214, 1986.
\bibitem{kl1993} F.~Kofman and J.~Lawarr\'ee. Collusion in hierarchical agency.
  \emph{Econometrica} 61(3):629--656, 1993.
\bibitem{lm1997} J.-J. Laffont and D.~Martimort. Collusion under asymmetric
  information. \emph{Econometrica} 65(4):875--911, 1997.
\bibitem{diamond1984} D.~W. Diamond. Financial intermediation and delegated
  monitoring. \emph{Review of Economic Studies} 51(3):393--414, 1984.
```

Confidence on each bibliographic record:

- Kofman & Lawarrée 1993 — `verified`. Econometric Society publication page and Crossref
  DOI `10.2307/2951721` both give 61(3):629–656, May 1993.
- Laffont & Martimort 1997 — `verified`. Read off the article's own running head:
  "Econometrica, Vol. 65, No. 4 (July, 1997), 875–911."
- Diamond 1984 — volume 51, issue 3, first page 393 `verified` via Crossref DOI
  `10.2307/2297430`; **end page 414 is `probable`**, from two independent secondary
  listings, not from the article.
- Tirole 1986 — DOI `10.1093/oxfordjournals.jleo.a036907` `verified` via Crossref, but
  **Crossref carries no volume, issue or page range for it**. The 2(2):181–214 figures
  are `probable`, from RePEc and other secondary listings. **Confirm against the article
  before submission.**

---

## Collateral effects

**Theorem 3 (amortization) is untouched.** Nothing in Kofman & Lawarrée, Laffont &
Martimort or Diamond concerns history-indexed audit schedules, declining audit rates
against accumulated reputation, or lifetime verification cost. Kofman & Lawarrée's model
is static with full commitment; they explicitly flag dynamics as unexplored ("Introducing
reputation to make endogenous assumptions about the principal and the auditors opens the
issue of dynamics. We are exploring the consequences of considering a two-period
model…" — working paper p. 66, `verified`). Theorem 3 is analytically independent of the
tower — it takes (ρ, d, B) as given per judge and never invokes C — so even a total
collapse of Theorem 2 would leave the paper's title claim standing. **Stating this
explicitly, as `README.md` asked: Theorem 3 is not collateral damage under any outcome
this dive could have produced.**

**Theorem 1 (stage deterrence) is not damaged, but its provenance changes.** It has a
closer ancestor than the paper currently credits — Kofman & Lawarrée's optimal
external-audit probability is the same expression at d = 1. Since `paper3.tex` already
lists the stage game under *Imported*, the fix is a citation, not a retraction.

**Theorem 2 survives the literature check intact.** The damage it takes in this dive is
self-inflicted (F1, F2, F4) and is fixable by rewording, not by weakening the mathematics.

---

## Open items

1. **The published Econometrica text was never obtained.** The verdict rests on the 1990
   MIT Sloan working paper plus a 1:1 mapping of the published abstract onto it. Residual
   risk that the published version added a stacking result: low, but not zero. **To
   close:** one JSTOR pull of `stable/2951721`, confirm the proposition list matches
   Propositions 1–6 above. Ten minutes for anyone with institutional access.
2. **Tirole 1986 not obtained.** Everything above about Tirole's third axiom is Kofman &
   Lawarrée's characterisation of it, not mine. Before the drafted sentence goes in,
   someone should read Tirole and confirm that the axiom is stated as Kofman & Lawarrée
   describe. Also confirm the 2(2):181–214 pagination.
3. **Faure-Grimaud, Laffont & Martimort 2003 and Baliga 1999 not obtained.** These bear on
   the soft-vs-hard-information question, which matters more than it looks: Kofman &
   Lawarrée describe their auditor's information as "neither completely 'soft' nor
   'hard'," and Paper 3's machine-checkable verdicts sit further toward hard than either.
   If a referee objects that hard information trivialises the problem, this is where the
   answer lives.
4. **Avenhaus–von Stengel–Zamir Ch. 51 §on multiple inspectors not re-read.** The host was
   unreachable. The pre-emption risk this was meant to check is unresolved. Partial
   mitigation: von Stengel's "Recursive Inspection Games" (arXiv:1412.0129), the most
   alarming-sounding title in that lineage, recurses over *time periods*, not over levels
   of inspector, and is not prior art for Theorem 2 [`verified`].
5. **Wrongful-slash compensation is unpriced in Theorem 2** (Q7). Kofman & Lawarrée name
   this cost channel; Paper 3 does not carry it. Whether it changes the optimal C is an
   open modelling question, not a literature question.
6. **Bibliographic correction for `reading-list.md`:** JSTOR stable id is 2951721, not
   2951722 [`verified`].

## Retrieval note for future dives

`WebFetch` is blocked by the egress proxy for most academic hosts in this environment, but
`curl` over HTTPS reaches many of them. The route that worked for the decisive source:
Semantic Scholar's Graph API by DOI
(`api.semanticscholar.org/graph/v1/paper/DOI:10.2307/2951721?fields=openAccessPdf`)
returned a GREEN open-access location at DSpace@MIT that no search engine surfaced.
Unpaywall by DOI is the natural companion query and found the Toulouse Capitole copy of
Laffont & Martimort. Both are worth trying **before** any manual hunting.
