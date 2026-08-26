# Findings — flag 3

**Status: complete.** Dive run 2026-08-26, plus a follow-up pass by the calling
session that closed the dive's one genuinely open question and surfaced one
citation the dive missed. No `.tex` file was edited.

## Verdict — `NARROW`

The results survive. The framing does not.

Nothing found supersedes Theorem 1a or 1b as stated. But the *shape* — restrict a
deontic policy language and conflict checking is polynomial; allow richer
formulae in the obligation and it jumps to (co)NP-complete — is already
published, mapped exhaustively, and tabulated in the business-process compliance
literature, over a language of obligations with genuine temporal extent. That
literature is Paper 6's true neighbour and is entirely uncited.

**What survives as novel**: $\mathcal{L}_c$ *as a combination*. No source found
combines $\bot$-headed Horn + ground $\Ob$/$\Fb$ over scope × interval +
exclusive interval claims + difference constraints. No source states
*conflict-freedom of the norm set* (as opposed to *compliance of a behaviour
model*) as an NP-complete decision problem. Discharge-choice semantics for
disjunctive obligation was found nowhere.

**Why not `SUBSUMED`**: every close neighbour solves compliance of a behaviour
model against a norm set. Paper 6 solves conflict-freedom of the norm set itself
— no process model, no traces. Different input, different problem.

**Why not `CLEAR`**: a compliance referee will read Theorem 1a/1b and think "this
is the 1L−/1L+ boundary again." The paper must say, itself, why it is not.

**Cost to fix**: four `\bibitem`s under Imported, five under Positioned-against,
one dichotomy sentence, one sentence conceding the shape. No theorem changes.

## The single most important missing citation

**Colombo Tosatto, Governatori & Kelsen, "Business process regulatory compliance
is hard," IEEE TSC 8(6):958–970, 2015**, with its tractable-side companion
**"Algorithms for tractable compliance problems," Frontiers of Computer Science
9(1):55–74, 2015**.

That pair already draws a P-to-(co)NP-complete boundary for conditional
obligations with triggers, deadlines, and in-force intervals, with the boundary
located at literals-vs-formulae in the obligation — i.e. at disjunction.

Their map, transcribed from the primary sources (`verified`):

| Full compliance | | Partial compliance | |
|---|---|---|---|
| `1G−` | P | `1G−` | P |
| `1L−` | P | `nG−` | NP-complete |
| `nL−` | P | `1G+` | NP-complete |
| `1L+` | coNP-complete | `nG+` | NP-complete |
| `nL+` | coNP-complete | `nL−`, `1L+`, `nL+` | NP-complete |

Where Theorem 1b still stands apart:

| | Colombo Tosatto et al. | Paper 6, Thm 1b |
|---|---|---|
| Input | process model **+** norm set | norm set **only** |
| Question | does every/some execution comply? | is the norm set internally conflict-free? |
| Hardness source | propositional formulae in obligations; TAUTOLOGY/SAT over traces | **discharge choice** among disjuncts |
| Certificate | — | selection certificate; 3-SAT both directions |
| Class | coNP-c (full) / NP-c (partial) | NP-complete |

Theorem 1b is an instance of a published pattern, not a rediscovery of a specific
published theorem. Citing it and stating the two differences makes the claim
stronger, because it becomes defended rather than asserted.

## Q1 — Halpern & Weissman: adjacent, and more sharply so than expected

Read in full: arXiv `cs/0601034v3`, 39 pp. `verified`

**Their language** is Lithium, a multi-sorted FOL fragment whose only deontic
predicate is `Permitted(subject, action)`. Prohibition is `¬Permitted`.

**Discriminating answer: permissions, unambiguously.** Three independent
confirmations from the primary text:

1. Obligation has no representation. Their own §7 says other work "deal[s] with
   obligation as well as permission," that such features "take them beyond
   Lithium," and "we have not explored this issue."
2. Full-text search returns five occurrences of *obligation*/*deontic*, all five
   inside §7 Related work, none in any definition or theorem.
3. **Zero** occurrences of *interval*, *temporal*, or *deadline*. Time enters
   only as a constant `now`; queries evaluate at the current instant.

**They do not even draw a P-to-NP-complete boundary.** Theirs runs P →
$\Pi^P_2$-hard/undecidable, with an NP-hard-*and*-coNP-hard band between, driven
by first-order quantifier alternation (Thm 3.1) and function symbols (Thm 3.3).
$\mathcal{L}_c$ is ground and function-free, so **every one of their hardness
sources is definitionally absent from Paper 6's fragment.**

Cite as the closest *access-control* analogue and the source of the design
stance, with one clause noting the vocabulary is permission-only and
instantaneous.

## Q2 — Deontic complexity literature

**Input/output logic — not the hit.** Sun & Ambrossio, LORI 2015, read in full
(`verified`). Fulfillment/violation coNP-complete, compatibility NP-complete for
simple-minded $O_1$; $O_3$ between coNP and $P^{NP}$. Not the hit for three
reasons: there is *no tractable fragment anywhere in this line* (the floor is
coNP, since I/O logic builds on classical `Cn`), so there was no P-to-NP boundary
to scoop; their `OR` rule is disjunction of the *input*, not disjunctive
obligation, and carries none of the discharge-choice content; and their own
conclusion lists complexity of *constraint* I/O logic — the nearest thing to
conflict-freedom — as open future work.

The 2017 JAL version was **not read** (ScienceDirect blocked). Two secondary
sources agree it extends to the second level of the polynomial hierarchy.
`probable` — do not cite a theorem number from it.

**Defeasible deontic logic — tractable side already owned.** Governatori,
Olivieri, Rotolo & Scannapieco (arXiv:1212.0079, read; *J. Phil. Logic* 42(6),
2013) compute obligations, prohibitions, three notions of permission and
contrary-to-duty chains in **linear** time, on Maher (TPLP 2001). `verified`

Costs Paper 6 nothing in the theorems, but kills any implicature that *tractable
deontic reasoning* is itself novel — it has been available since 2001–2013, in a
language with the contrary-to-duty structure $\mathcal{L}_c$ deliberately
excludes. It does not supply an NP-complete frontier, interval arithmetic, or
resource claims, and it answers *what is derivable*, not *is this set
conflict-free*.

## Q3 — Does $\mathcal{L}_c$ appear as a combination? No.

The ingredients live in four literatures that do not cite each other.

| Ingredient | Standard source | Combined elsewhere? |
|---|---|---|
| $\bot$-headed definite Horn, least model | Dowling–Gallier 1984 (cited) | Rule-based deontic reasoning uses *defeasible* rules with a superiority relation, not definite Horn with $\bot$ heads under least-model semantics. **No exact match.** |
| Ground $\Ob$/$\Fb$ over scope × interval | Colombo Tosatto/Governatori `O⟨r,t,d⟩`; Governatori et al. deadline typology (AI 2007) | **Yes, standard.** Closest relative. Their intervals are condition-delimited over traces; Paper 6's are ground numeric $[t_1,t_2]$. |
| Exclusive interval claims (sweep-line) | textbook interval sweep-line | **Not found combined with deontic operators anywhere.** The norm-conflict literature treats simultaneous-performance impossibility as an *indirect* conflict handled by unification, never as a first-class exclusive-resource claim. Least-precedented ingredient. |
| Difference constraints, negative cycle | Dechter–Meiri–Pearl 1991 — this *is* the STN | Heavily owned (Q5), but not found combined with deontic operators. |

Searched in five vocabularies that do not presuppose ours, plus targeted crosses
(deontic × STN; norms × difference constraints; obligations × exclusive
resource). The deontic × STN cross returns temporal *deontic logics* but no work
importing STN machinery into a normative conflict checker. `verified` negative —
"not found," not "does not exist." The paper's existing caveat language is
correct and should be kept.

## Q4 — Bound correct, not best known

$O(H + T\log T + C\log C + V\cdot E)$ is right for the algorithms used.

The $V\cdot E$ term is Bellman–Ford. Near-linear negative-weight SSSP now exists:
Bernstein–Nanongkai–Wulff-Nilsen, improved by Bringmann, Cassis & Fischer to
$O(m\log^2 n\log(nW)\log\log n)$ (arXiv:2304.05279, read, `verified`).

**Fix**: one clause acknowledging faster algorithms exist and would improve that
term at constants that do not pay at harbor batch sizes. Converts a hole into a
considered choice.

Also: the negative cycle *as witness* is the STN literature's own idiom
(Comin & Rizzi, Thm 1, `verified`). Attribute it.

## Q5 — An STN citation is owed. Cheapest fix here.

An STN is time-point variables with binary constraints $Y - X \le \delta$;
consistency decided with a negative-cycle certificate by Bellman–Ford. That is
Paper 6's fourth conflict species verbatim.

**Owed**: Dechter, Meiri & Pearl, "Temporal constraint networks," *AI*
49(1–3):61–95, 1991.

**And a second, which matters more.** The canonical "add disjunction, lose
tractability" result in temporal reasoning is STP → DTP: Stergiou & Koubarakis,
*AI* 120(1):81–117, 2000. Simple temporal problem polynomial; disjunctive
temporal problem NP-complete.

This is the structurally closest published analogue to Theorem 1b in the entire
dive — same move, adjacent formalism, twenty-six years earlier. **Cite it in the
same breath as Theorem 1b**: it makes Theorem 1b read as a well-understood
phenomenon correctly relocated into a deontic setting, which is what it is.

## Q6 — The problem has a name, and Paper 6's hardest case is a named category

Read in full by the follow-up pass: the full JAAMAS journal version, Santos,
Zahn, Silvestre, Silva & Vasconcelos, *AAMAS* 31(6):1236–1282, 2017, green OA at
`aura.abdn.ac.uk/bitstream/2164/10273/1/detection_resolution_normative_final_different_format.pdf`
(151,663 characters extracted). `verified`

| Field | Their name | What they prove | Overlap |
|---|---|---|---|
| Normative MAS | **normative conflict detection**; **direct** vs **indirect**; design-time vs runtime | algorithms and architectures; **essentially no complexity classification** | high on problem, near-zero on results |
| Policy/access control | policy consistency analysis | Halpern & Weissman (Q1); Cholvy & Cuppens | adjacent; permission-centric, instantaneous |
| Business process compliance | regulatory compliance checking | the full P/NP-c/coNP-c map (above) | **highest on result shape**, different input |
| Temporal reasoning | STP/DTP consistency | STP polynomial, DTP NP-complete | owns one conflict species outright |

**The renaming entry that matters most.** The survey's worked example of an
*indirect* normative conflict: an agent bearing $\Ob q$ and $\Fb p$ where
$q \to p$ — "note that `q` and `p` are different, but `q` implies `p`."

That is exactly Paper 6's canonical mutation-detected case, the one the paper
calls "a two-hop indirect conflict, exactly the species the mutant misses"
(`paper6.tex:145–146`). The paper independently arrived at the field's textbook
example of an indirect conflict and built its load-bearing mutation test on it.

**Adopt the term.** Say "what the normative-MAS literature calls an *indirect*
normative conflict" once at `paper6.tex:145`. Eight words. It tells a COIN/AAMAS
reader the Horn layer is the field's known hard case, and converts the mutation
result from "we tested a thing" into "we quantified the field's known hard case
at scale, and it is 11% of conflicts."

**Second renaming item: `regimentable`.** Paper 6 uses *regimentation* as a term
of art, attributing it only to Ramadge–Wonham via Paper 2. The
regimentation-vs-enforcement distinction in normative systems is **Jones &
Sergot's** (*Deontic Logic in Computer Science: Normative System Specification*,
Wiley, 1993, pp. 275–307). `probable` — chapter not fetched. Ramadge–Wonham
supplies the control-theoretic content; Jones & Sergot supplies the word. Cite
both.

## Q7 — Dichotomy framing: yes, with a hedge

Schaefer defined an infinite family of Boolean satisfiability problems, showed
each is either in P or NP-complete, and gave a criterion deciding which
(STOC 1978, 216–226). `probable`.

Keep the hedge: Schaefer classifies an *infinite family*; Theorem 1a/1b is *two
points*. Correct phrasing is "a dichotomy at a designed boundary," not a claim to
have classified $\mathcal{L}_c$'s whole fragment lattice.

## Q8 — Part II: closed, nothing owed but one courtesy citation

Time-boxed, abstract-level by design.

**Exists** (`probable`): a large pooling-vs-dedicated literature comparing
*identical* servers — Mandelbaum & Reiman, *Management Science* 44(7):971–981,
1998; Sunar, Tu & Ziya, *Management Science* 67(6):3785–3802, 2021 (pooling can
*hurt*).

**Not found**: no decision boundary between a sole specialist and a pool as an
inequality on the skill premium against an Erlang-C expression; none carrying an
accountability term $A$; no succession-viability threshold of $D^\star$'s form.
The $W_\infty$ floor is a natural consequence of the breakdown model and would
not surprise a queueing theorist; the *decision rule built on it* is the part not
found.

**Recommendation**: leave Part II as is; add Mandelbaum–Reiman under Imported.
The paper cites Halfin–Whitt for "economies of pooling … classical folklore," and
Mandelbaum–Reiman is the specific citable version of that folklore for exactly
Theorem 2's comparison.

---

# Follow-up pass by the calling session

Two things the dive left open or missed.

## A. The dive's one open question, now effectively closed

The dive flagged one item as genuinely unresolved and potentially
verdict-changing: *Conflict Detection among Multiple Norms in Multi-Agent
Systems*, which a search summary claimed establishes NP-completeness of norm
conflict detection by reduction from 3-SAT. If true, that would move Theorem 1b
specifically toward SUBSUMED.

**Bibliographic details now `verified`** via Crossref: Eduardo Augusto Silvestre
and Viviane Torres da Silva, *Applied Artificial Intelligence* **32(4):388–418**,
2018, DOI `10.1080/08839514.2018.1481591`. (The dive had these as unconfirmed.)

**Full text still not obtained.** Taylor & Francis returns HTTP 403 on every
route tried: DOI redirect, `/doi/pdf` with browser UA, `/doi/epdf`. Unpaywall
reports bronze OA at the publisher endpoint, but that endpoint is the one
returning 403. Semantic Scholar's abstract field is elided by the publisher.

**But the claim is now strongly disconfirmed indirectly.** The full JAAMAS 2017
survey — the definitive literature survey on exactly this problem, by an author
group that *includes Silvestre and Silva*, published one year earlier — contains
across 151,663 characters:

| String | Occurrences |
|---|---|
| `np-complete` | **0** |
| `np-hard` | **0** |
| `3-sat` | **0** |
| `satisfiab` | **0** |
| `polynomial` | 2 |
| `tractab` | 3 |

Its Table 9, "Computational cost of the different approaches," has columns for
Linear $O(n)$, Polynomial $O(n^c)$, Exponential $O(c^n)$, "Decidable but
intractable," NEXPTIME-complete, PSPACE-complete, and N/A — **no NP-complete
column at all.** Its conclusion states "the majority of the detection/resolution
approaches analyzed have linear or polynomial complexities," and lists
computational complexity among the factors the literature does *not* supply.

A field survey by overlapping authors would not omit an NP-completeness result
for its own central problem. **Treat the search summary's claim as unreliable**
(it also misattributed the result to Shoham & Tennenholtz, which is independently
wrong). The verdict stands at `NARROW`; this no longer threatens Theorem 1b.

Reading the paper before submission remains worthwhile for completeness, but it
is no longer a blocker.

## B. A citation the dive missed — and it is the closest one on *problem*

Reading the full survey surfaced a result the dive did not report, and it is
closer to Paper 6's problem definition than the Colombo Tosatto line is.

**Gaertner, García-Camino, Noriega, Rodríguez-Aguilar & Vasconcelos,
"Distributed norm management in regulated multiagent systems," AAMAS '07,
pp. 90:1–90:8, ACM, 2007.** `probable` — reference transcribed from the survey's
own bibliography, which was fetched and read; the AAMAS paper itself not fetched.

Per the survey (`verified` as the survey's characterization):

> The authors map the NSs into Coloured Petri Nets (CPNs) and use well-known
> theoretical results from work on CPNs in order to prove that ensuring
> conflict-freedom of a NS at design time is computationally intractable.

**Why this matters more than its length suggests.** Every other neighbour in this
dive solves *compliance of a behaviour model against a norm set*. That difference
is the load-bearing reason the verdict is `NARROW` rather than `SUBSUMED`. This
one does not: it is **conflict-freedom of the normative system itself, at design
time** — Paper 6's problem, stated the same way, proven intractable, in 2007.

It does not subsume Theorem 1b. The complexity class is different and almost
certainly much higher (CPN reachability is EXPSPACE-hard territory, not NP), the
norms regulate illocutions rather than scoped interval actions, and there is no
tractable fragment on the other side of the boundary — which is precisely
Theorem 1a's contribution. But it is the one prior result that asks Paper 6's
exact question, and a paper claiming "the location of the frontier" as its
contribution cannot omit the work that established there *is* a frontier for this
problem.

**Recommendation**: cite it in the Positioned-against paragraph, immediately
before the Colombo Tosatto sentences, framed as: conflict-freedom of a normative
system at design time was shown intractable in general; $\mathcal{L}_c$ is the
fragment where it is not, and Theorem 1b locates the boundary between them.

---

## Proposed text for `paper6.tex`

Drafted, not applied.

### Insert into **Imported** (after the Dowling–Gallier sentence, `:288`)

> The difference-constraint layer is a simple temporal network in the sense of
> Dechter, Meiri and Pearl~\cite{dmp91}: consistency by single-source shortest
> paths, with the negative cycle as the standard inconsistency certificate. We
> use Bellman--Ford for the $O(V\!\cdot\!E)$ term; asymptotically faster
> negative-weight shortest-path algorithms exist~\cite{bcf23} and would improve
> that term, at constants that do not pay at harbor batch sizes. The
> regimentation/enforcement distinction we invoke in \S\ref{sec:regiment} is
> Jones and Sergot's~\cite{js93}; Ramadge--Wonham supplies its control-theoretic
> content, Jones and Sergot the normative-systems reading of it.

### New paragraph under **Positioned against deontic logic** (extending `:295–299`)

> \textbf{Positioned against the computational side of deontic logic.}
> Tractability in normative reasoning is not new and we do not claim it.
> Defeasible deontic logic in the Maher--Governatori lineage computes
> obligations, prohibitions, and several notions of permission in \emph{linear}
> time~\cite{maher01,gors13}, in a language with contrary-to-duty structure that
> $\mathcal{L}_c$ deliberately forgoes. Nor is the intractability of the general
> problem new: Gaertner et al.~\cite{gaertner07} map normative structures to
> coloured Petri nets and show that ensuring conflict-freedom \emph{at design
> time} --- our question, not a compliance question --- is computationally
> intractable in general. $\mathcal{L}_c$ is a fragment where it is not, and
> Theorem~1 locates the boundary. Nor, finally, is a tractable/hard frontier for
> temporally extended obligations new: Colombo Tosatto, Governatori and
> co-authors map the complexity of regulatory compliance for conditional
> obligations with triggers, deadlines and in-force intervals across eight
> variants, and find precisely the boundary we find --- restrict the obligation's
> elements to propositional literals and the problem is polynomial; allow
> arbitrary formulae and it is NP-complete (partial compliance) or coNP-complete
> (full compliance)~\cite{ctgk15,ctkm15,ctgv21}. Our Theorem~1b is an instance of
> that pattern, not an escape from it, and two differences are worth stating
> plainly. Their input is a \emph{process model together with} a norm set and
> their question is whether executions comply; ours is a norm set alone and our
> question is whether it is internally conflict-free --- no traces, no
> executions. And their hardness comes from evaluating propositional formulae
> over traces, whereas ours comes from \emph{discharge choice}: the agent selects
> which disjunct of $\Ob(l_1\vee\dots\vee l_k)$ to satisfy, which is why
> membership is by a selection certificate and the class is NP rather than coNP.
> The tractable-to-intractable step at disjunction is in any case older than
> either of us: the simple temporal problem is polynomial and the disjunctive
> temporal problem is NP-complete~\cite{sk00}.
>
> The problem of Part~I also has a name we should use. The normative multi-agent
> systems community calls it \emph{normative conflict detection}, and
> distinguishes \emph{direct} conflicts --- opposed modalities on the same
> regulated behaviour --- from \emph{indirect} conflicts, where $\Ob q$ and
> $\Fb p$ collide only because $q$ implies $p$~\cite{szssv17}. Our $\bot$-headed
> Horn layer exists to catch exactly the indirect species, and the mutation
> result of \S\ref{sec:thm-detect} measures its weight: deleting propagation
> misses 100 of 885 conflicts. That literature is rich in detection algorithms
> --- normalization, unification, constraint solving, substitution~\cite{vkn09}
> --- and, by its own survey's account, thin on complexity classification, which
> is the gap this fragment is meant to fill.
>
> On the access-control side, Halpern and Weissman's Lithium~\cite{hw08} is the
> closest analogue in \emph{method}: restrict a first-order policy language until
> entailment and consistency are near-linear, then argue the restrictions hold in
> practice. It is not an analogue in \emph{content}. Lithium's only deontic
> predicate is $\mathsf{Permitted}$, prohibition is its negation, obligation is
> absent by the authors' own account, and time enters only as a constant
> $\mathit{now}$ --- no intervals, no deadlines, no difference constraints. Their
> hardness sources are first-order quantifier alternation and function symbols,
> both definitionally absent from a ground, function-free $\mathcal{L}_c$.

### Dichotomy sentence (immediately after the Thm 1a/1b box, `:124`)

> Read together, Theorems 1a and 1b are a \textbf{dichotomy} at a designed
> boundary, in the sense Schaefer~\cite{schaefer78} made standard for
> satisfiability: on one side of a single expressive choice the problem is
> polynomial, on the other it is NP-complete, and nothing in between is on offer
> to the language designer. The same step is familiar one formalism over ---
> simple temporal networks are polynomial, and admitting disjunctions of
> difference constraints makes consistency NP-complete~\cite{sk00} --- which is
> why we read $\mathcal{L}_c$'s boundary as a price list rather than an accident
> of this fragment.

### Amend **New, honestly** (replacing the survey sentence at `:303–305`)

> \textbf{New, honestly.} No component algorithm or queueing formula above is
> ours, and neither is the \emph{shape} of Theorem~1: a polynomial deontic
> fragment with an NP-complete step out is a pattern the compliance-complexity
> literature has been mapping for a decade, and the intractability of design-time
> conflict-freedom in general has been known since 2007. What we did not find, in
> a sweep across computational deontic logic, normative multi-agent systems,
> business-process compliance, access-control policy languages, and temporal
> constraint networks, is $\mathcal{L}_c$ \emph{as a combination} ---
> $\bot$-headed definite Horn rules, ground $\Ob$/$\Fb$ over scopes and
> intervals, exclusive interval claims, and difference constraints over deadline
> variables, chosen so that all four conflict species fall out of one polynomial
> pass with witnesses --- nor a statement of conflict-freedom (as opposed to
> compliance) as an NP-complete decision problem, nor the discharge-choice
> semantics under which Theorem~1b's disjunction bites. The remaining
> contributions are as before: the composition making in-fragment
> conflict-freedom regimentable rather than merely checkable; the falsification
> and replacement of the whitepaper's specialization threshold by the exact
> $g_A(\rho,c)$; and the succession criterion $D^\star$. ``Not found'' is still
> not ``proven nonexistent.''

### `\bibitem` entries to add

No identifier below was invented; gaps are flagged, not guessed.

```latex
\bibitem{dmp91} R.~Dechter, I.~Meiri, and J.~Pearl. Temporal constraint networks.
\emph{Artificial Intelligence}, 49(1--3):61--95, 1991.
% verified via reference list of Comin & Rizzi (arXiv:1805.02183) ref [5];
% doi:10.1016/0004-3702(91)90006-6

\bibitem{sk00} K.~Stergiou and M.~Koubarakis. Backtracking algorithms for
disjunctions of temporal constraints. \emph{Artificial Intelligence},
120(1):81--117, 2000.
% verified via Comin & Rizzi ref [16]

\bibitem{maher01} M.~J. Maher. Propositional defeasible logic has linear
complexity. \emph{Theory and Practice of Logic Programming}, 1(6):691--711, 2001.
% verified via reference list of Governatori et al. (arXiv:1212.0079) ref [23]

\bibitem{gors13} G.~Governatori, F.~Olivieri, A.~Rotolo, and S.~Scannapieco.
Computing strong and weak permissions in defeasible logic. \emph{Journal of
Philosophical Logic}, 42(6):799--829, 2013.
% arXiv:1212.0079 read; linear complexity O(S) proved there.
% Volume/issue/pages: probable -- CHECK AT SUBMISSION

\bibitem{gaertner07} D.~Gaertner, A.~Garc\'ia-Camino, P.~Noriega,
J.~A. Rodr\'iguez-Aguilar, and W.~W. Vasconcelos. Distributed norm management in
regulated multiagent systems. In \emph{Proc.\ 6th International Joint Conference
on Autonomous Agents and Multiagent Systems (AAMAS)}, pages 90:1--90:8. ACM, 2007.
% probable: transcribed from the bibliography of the JAAMAS 2017 survey, which
% was fetched and read. AAMAS paper itself NOT fetched -- verify at submission.

\bibitem{ctgk15} S.~Colombo Tosatto, G.~Governatori, and P.~Kelsen. Business
process regulatory compliance is hard. \emph{IEEE Transactions on Services
Computing}, 8(6):958--970, 2015.
% verified via reference lists of arXiv:2001.10148 [3] and arXiv:2105.05431 [4];
% doi:10.1109/TSC.2014.2341236

\bibitem{ctkm15} S.~Colombo Tosatto, P.~Kelsen, Q.~Ma, M.~El~Kharbili,
G.~Governatori, and L.~van~der~Torre. Algorithms for tractable compliance
problems. \emph{Frontiers of Computer Science}, 9(1):55--74, 2015.
% verified via reference list of arXiv:2105.05431 [5]; doi:10.1007/s11704-014-3239-y

\bibitem{ctgv21} S.~Colombo Tosatto, G.~Governatori, and N.~van~Beest. Proving
regulatory compliance: full compliance against an expressive unconditional
obligation is coNP-complete. arXiv:2105.05431, 2022.
% verified: read in full. Prefer a peer-reviewed venue if one now exists.

\bibitem{szssv17} J.~S. Santos, J.~O. Zahn, E.~A. Silvestre, V.~T. Silva, and
W.~W. Vasconcelos. Detection and resolution of normative conflicts in multi-agent
systems: a literature survey. \emph{Autonomous Agents and Multi-Agent Systems},
31(6):1236--1282, 2017.
% verified: full journal version fetched and read (green OA, aura.abdn.ac.uk)

\bibitem{vkn09} W.~W. Vasconcelos, M.~J. Kollingbaum, and T.~J. Norman. Normative
conflict resolution in multi-agent systems. \emph{Autonomous Agents and
Multi-Agent Systems}, 19(2):124--152, 2009.
% verified bibliographically via the survey's reference list [40];
% doi:10.1007/s10458-008-9070-9. Full text NOT read.

\bibitem{hw08} J.~Y. Halpern and V.~Weissman. Using first-order logic to reason
about policies. \emph{ACM Transactions on Information and System Security},
11(4):1--41, 2008.
% Full text read via arXiv cs/0601034v3 (39 pp.).
% Journal volume/issue/pages: probable -- CHECK AT SUBMISSION

\bibitem{js93} A.~J.~I. Jones and M.~Sergot. On the characterisation of law and
computer systems: the normative systems perspective. In \emph{Deontic Logic in
Computer Science: Normative System Specification}, pages 275--307. Wiley, 1993.
% probable: two secondary sources. Chapter NOT fetched.

\bibitem{schaefer78} T.~J. Schaefer. The complexity of satisfiability problems.
In \emph{Proc.\ 10th Annual ACM Symposium on Theory of Computing (STOC)},
pages 216--226, 1978.
% probable: two secondary sources agree on venue and pages.

\bibitem{bcf23} K.~Bringmann, A.~Cassis, and N.~Fischer. Negative-weight
single-source shortest paths in near-linear time: now faster! arXiv:2304.05279, 2023.
% verified: read.

\bibitem{mr98} A.~Mandelbaum and M.~I. Reiman. On pooling in queueing networks.
\emph{Management Science}, 44(7):971--981, 1998.
% probable: two secondary sources. Full text NOT read (Q8 time-boxed).
```

## Open items

1. **Silvestre & Silva 2018** — details now `verified` via Crossref; full text
   blocked by Taylor & Francis on every route. The NP-completeness claim about it
   is strongly disconfirmed by the 2017 survey (see Follow-up A) and is no longer
   a blocker. Read at submission for completeness.
2. **Gaertner et al. 2007** — `probable`; transcribed from the survey's
   bibliography. Fetch the AAMAS paper to confirm the intractability result's
   exact statement and class before citing it as this dive recommends.
3. **Sun & Robaldo, JAL 2017** — ScienceDirect blocked; only the LORI 2015
   precursor read. Conclusion unaffected; cite at abstract level only if at all.
4. **Cholvy & Cuppens 1997** — primary text blocked. Abstract-level only. Low
   stakes.
5. **Vasconcelos, Kollingbaum & Norman 2009** — abstract only. Whether their
   constraint layer includes temporal activation/expiration windows is
   unconfirmed; if it does, $\mathcal{L}_c$'s ground-interval ingredient has a
   closer relative than this dive found. Worth one focused fetch.
6. **Jones & Sergot 1993** page range — corroborated twice, chapter not fetched.
7. Q3 and Q8 negatives are reasonably-searched `probable`, not proofs.
