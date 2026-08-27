# Findings — flag 2

**Status: complete.** Dive run 2026-08-26; the two act-now items independently
re-verified by the calling session against Schneider's own text. No `.tex` file
was edited.

## Verdict — `NARROW`, and it is the most consequential of the four

The narrowing does not come from where this package expected it. The reported
preprint is real and harmless. The edit-automata gap is real and cheap. But a
2013 paper nobody had named holds Paper 2's contribution paragraph, and two
statements in `paper2.tex` about a paper it already cites are wrong.

## Q1 — Does arXiv:2607.22868 exist? **Yes. The scout was right.**

Shawn Ray, "What Can Be Enforced? A Theory of Certified Runtime Safety for
Tool-Using Agents," submitted 24 Jul 2026, 26 pp., cs.AI/cs.CR/cs.LG, DOI
`10.48550/arXiv.2607.22868`. Full text read.

| Check | Result |
|---|---|
| `arxiv.org/abs/2607.22868` | **HTTP 200**, 41,193 bytes |
| **control: `arxiv.org/abs/2607.99999`** (fabricated, same shape) | **HTTP 404** |
| `arxiv.org/html/2607.22868v1` | HTTP 200, 781,501 bytes, read in full |
| arXiv exact-title search | "Showing 1–1 of 1" |
| DBLP | `journals/corr/abs-2607-22868` |

Both the 200 and the control 404 were re-run independently by the calling
session and reproduce.

**The lesson inverts this package's premise.** These packages were written
assuming a fabricated citation, and told this dive so. That framing was wrong
twice over: flag 4's suspect citation is also real, and this one is real too.
Two corrections carry forward:

1. **`uncertain` entries should be checked, not discounted.** The prior sweep's
   unverified citations have a better hit rate than assumed.
2. **A `WebFetch` block is not evidence a source does not exist.** `curl` through
   the agent proxy reaches hosts `WebFetch` refuses. At least one earlier "could
   not retrieve" may have been this, and flag 4's unresolved Bach 1999 is worth
   retrying by that route.
3. **The control test is the transferable technique.** An arXiv `abs` 200 proves
   nothing unless a same-shaped fake ID is fetched alongside it and 404s. One
   extra request; make it standard.

## Q2 — Does the preprint state the same characterization? **No.**

Ray's **Theorem 1**, verbatim:

> Fix the available oracle interface Π and a nonempty policy P. Then P is
> effectively enforceable by a deterministic (T;Π)-gate if and only if it is
> safety and Good(P) ∈ RA[T;Π].

His criterion is safety plus register-representability of good prefixes — not
controllability. Exhaustive grep of his full text: `Ramadge`, `Wonham`,
`supervisory`, `discrete-event`, `uncontrollab`, `regiment`, `reference monitor`,
`complete mediation` **do not occur**. His gate decides on every proposed action;
in Paper 2's terms he works at $\Sigma_u = \emptyset$.

| Dimension | Paper 2 | Ray 2026 |
|---|---|---|
| Alphabet split | the whole subject | none; gate mediates everything |
| Criterion | RW controllability | safety + Good(P) ∈ RA[T;Π] |
| What varies | which events are refusable | what policy state is representable; what a fallible judge sees |
| Compound trigger→effect | §5, "where untrained intuition most often guesses wrong" | routine; his P2/P3 are exactly this, unremarked |
| Checker | `b3_controllability.py` | PSPACE decision procedure + 949-episode empirical study |
| Fallible judge | absent | Neyman–Pearson frontier, conformal certificate |

**Complements, not competitors.** Ray asks what a gate can represent and decide;
Paper 2 asks which events a gate can refuse at all. Cite as adjacent
contemporaneous work — the positioning is favorable.

## The actual priority problem: Basin et al. 2013

Found via one sentence in Ray's related work: *"Basin et al. (2013) separate
controllable from merely observable actions."*

**Basin, Jugé, Klaedtke & Zălinescu, "Enforceable Security Policies Revisited,"
ACM TISSEC 16(1):1–26, 2013**, DOI `10.1145/2487222.2487225`. Not in this
package's reading list, not in `paper2.tex`. Read in full (25 pp.) from ETH
Zürich. `verified`

> We revisit Schneider's work on policy enforcement by execution monitoring. We
> overcome limitations of Schneider's setting by distinguishing between system
> actions that are controllable by an enforcement mechanism and those actions
> that are only observable, that is, the enforcement mechanism sees them but
> cannot prevent their execution. For this refined setting, we give necessary and
> sufficient conditions on when a security policy is enforceable.

Their **Lemma 3.7**: `P is (U,O)-safety iff cl(pre*(P ∩ U) · O*) ∩ U ⊆ P`.
Their **Theorem 3.8**: enforceable iff (1) (U,O)-safety, (2) `pre*(P ∩ U)`
decidable, (3) `ε ∈ P`. Immediately preceded by: **"In Schneider's setting, U is
Σ^∞ and O equals ∅."**

**That is the same theorem on Paper 2's hypotheses.** With $L=\Sigma^*$, $K$
prefix-closed regular, $O=\Sigma_u$: Lemma 3.7's condition becomes
$\overline{K}\Sigma_u^* \subseteq \overline{K}$, equivalent by induction on
suffix length to $\overline{K}\Sigma_u \cap \overline{L} \subseteq \overline{K}$
— verbatim Paper 2's boxed criterion. Their (2) is automatic for regular $K,L$;
their (3) is Paper 2's nonemptiness. And identifying Schneider as the
$O=\emptyset$ degenerate case is Paper 2's specific framing move, published in
2013.

**But Basin explicitly declines the Ramadge–Wonham identification**, from their §5:

> the Ramadge-Wonham framework from control theory has several similarities with
> our setting… It remains to be seen whether and how the domain of policy
> enforcement can benefit from the Ramadge-Wonham framework and the results
> around it (and also vice versa).

**That open question is Paper 2's honest surviving delta**, and it is a real one.

## Q3 — What survives

Against Ray: nearly everything. Against Basin, specifically:

- **The RW identification by name, and what it imports.** Basin has
  PSPACE-completeness and synthesis but no supremal controllable sublanguage.
  Paper 2's $\sup\mathcal{C}(K)=\emptyset$ result for thought-bans has **no
  analogue in Basin**. This should become the lead contribution.
- **$\Sigma_u$ as the generative forward pass.** Basin's canonical uncontrollable
  action is a *clock tick* — an environment event. Paper 2's are events of the
  regulated agent's own constitution. That is exactly why widening $\Sigma_c$ can
  never make a confident lie preventable (honest boundary vi) — a corollary with
  no counterpart in a clock-tick model.
- The checker, the nine-row table, the worked two-state supervisor with both
  certificates, and the clean-room consequence.

**Not surviving as written**: "the mapping of agent-runtime enforcement onto
supervisory control, and the resulting exact prevented/detected boundary, is the
contribution" (`paper2.tex:282–284`).

## Q4 — Detect-and-compensate is *outside* the edit-automata taxonomy

Ligatti, Bauer & Walker, IJIS 4(1–2):2–16, 2005, read in full. `verified`

Their Theorems 1, 3, 5, 7 give the *same* criterion verbatim for truncation,
suppression, insertion, and edit automata: all four precisely enforce exactly the
safety properties. Theorem 8: an edit automaton *effectively* enforces any
property by suppressing until a prefix is confirmed legal, then reinserting.

**Why detect-and-compensate is not among them, and the reason is structural
rather than economic.** All four operations require the mechanism to be
interposed and able to withhold. Suppression *looks* like "let it go and clean
up" but is the opposite — a suppressed action never reaches the system, so it is
prevention. Edit automata's power over truncation comes entirely from the ability
to **delay**, which is precisely what a $\Sigma_u$ event denies. All four Ligatti
mechanisms are mechanisms over $\Sigma_c$. The economic character of Paper 2's
compensation is a second, weaker reason; the structural one holds even for pure
rollback.

Their §2.5 names Paper 2's regime as an out-of-model limitation: *"the monitor is
unable to interpose itself between the application and the device."*

**The citation reads "we sit adjacent to this," not "we refine this."**

## Q5 — Orthogonal to the safety-progress hierarchy; neither contains the other

Falcone, Fernandez & Mounier, STTT 14(3):349–382, 2012, read in full. `verified`

**Corollary 3**: "Enforceable properties are exactly response properties:
EP = Response(Σ)." **Definition 26**: `Ops = {halt, store, dump, off}`.

All four operations presuppose the monitor can withhold every event
indefinitely — Falcone works at $\Sigma_u=\emptyset$ with unbounded finite
memory. What buys him response properties is `store`/`dump`: the ability to
delay.

- **Falcone's axis**: which class of the safety-progress hierarchy a mechanism of
  given transformational power reaches. Answer: response.
- **Paper 2's axis**: within prefix-closed safety, which policies survive
  partitioning the alphabet into refusable and non-refusable. Answer: the
  controllable ones.

Paper 2 restricts to the *bottom* of his hierarchy, then cuts it with a condition
his framework cannot express. Conversely his response properties are not even
candidates for Paper 2, which has no buffering. **The honest joint statement is
"safety ∩ controllable."** Paper 2 must cite him explicitly — the title overlap
will be noticed.

## Q6 — The "August-2026 survey found nothing" claim

**Defensible narrowly, indefensible as framed.** Searches recorded and
reproducible: arXiv full-text `"supervisory control" AND "LLM agent"` → 1
irrelevant result; `"controllable events" AND "LLM agent"` → 0; `"Ramadge" AND
"agent guardrail"` → 0; `"norm enforcement" "supervisory control"` → 0.

**Survives**: no 2024–26 LLM-agent-guardrail paper states the RW
characterization — Ray confirms it by not containing the word.
**Fails**: the framing. It *is* stated in two adjacent literatures the sweep
never searched. Delete the survey claim; cite the prior art.

## Q7 — Paper 2 misstates Schneider. This is a correctness bug.

**Independently re-verified by the calling session.** Schneider, TISSEC
3(1):30–50, 2000, fetched from `cs.cornell.edu/fbs/publications/EnfSecPols.pdf`
(HTTP 200, 148,241 bytes), text extracted, both claims located verbatim.

**Bug 1 — the theorem is misstated.** Schneider, p. 35, verbatim:

> Obviously, the contrapositive holds as well: EM enforcement mechanisms enforce
> security policies that are safety properties. But, as discussed later in
> Section 4, **the converse—that all safety properties have EM enforcement
> mechanisms—does not hold.**

`paper2.tex:87–89` says EM "enforces exactly the safety properties." Schneider
proves **necessity only and explicitly denies sufficiency**. Basin says the same:
"Schneider's conditions for enforceability are necessary but not sufficient…
already pointed out by Schneider [2000, Page 41]."

Consequently `paper2.tex:91–92` — "Schneider's theorem is exactly what our
characterization degenerates to" — is also wrong. At $\Sigma_u=\emptyset$
Paper 2's theorem is *strictly stronger* than Schneider's, and the extra strength
comes from regularity silently supplying decidability and nonemptiness, i.e.
Basin's conditions (2) and (3).

**Bug 2 — the headline compound case is Schneider's own Figure 1.** Schneider,
verbatim:

> Figure 1 depicts a security automaton for a security policy that prohibits
> execution of Send operations after a FileRead has been executed. In this
> diagram, the automaton states are represented by the two nodes labeled q_nfr
> (for "no file read") and q_fr (for "file read").

Two-state taint automaton; read permitted in both states; send gated in the
tainted one. `paper2.tex` §`sec:compound` calls this "the case where untrained
intuition most often guesses wrong" and rests the clean-room product line on it.
It is the illustrative figure of a paper Paper 2 already cites, and Ray treats an
isomorphic policy as routine.

The *design rule* extracted — uncontrollable events are free in a policy's
condition, fatal in its prohibition — is still real and useful. But it must be
presented as a reading of Schneider's own example under the alphabet split, not
as a surprising new classification.

## Job 3 — the normative-MAS sweep confirmed, and it costs more than expected

"Regimentation" is exactly the term of art. Verified from four independently-read
primary sources:

- **Alechina, De Giacomo, Logan, Perelli, KR 2022**: *"Norms may be implemented
  in a MAS through regimentation or enforcement (Grossi, Aldewereld, and Dignum
  2006). A regimented norm is impossible to violate due to the design of the
  MAS."*
- **Criado & Such, arXiv:1505.03996**: *"Regimentation mechanisms prevent agents
  from performing forbidden actions… by mediating access to resources and the
  communication channel… **However, the regimentation of all actions is often
  difficult or impossible.**"* — Paper 2's thesis in one clause, with mediation
  named as the mechanism.
- **Dastani, Grossi, Meyer, Tinnemeier**, DagSemProc 08361: *"When regimenting
  norms all agents' **external actions** leading to a violation of those norms
  are made impossible. Via regimentation (e.g., **gates in train stations**) the
  system prevents an agent from performing a forbidden action."* — Paper 2's
  bouncer-at-a-door, as a turnstile, twenty years earlier.
- **Balke**, DagSemProc 09121 — the most structurally damaging. Regimentation is
  achieved either "by ensuring that all agents' **mental states** are accessible
  to the system (closed systems)… agents are treated as a **white box**" or, "in
  case the mental states are not accessible (i.e. the inner states of an agent
  are a **black box**), by **constraining the actions** of the individual
  agents." **That is Paper 2's alphabet split, in prose, in 2009.** An LLM agent
  is the black-box case and $\Sigma_u$ is the formal content of its
  black-boxness.

Canonical origin: **Grossi, Aldewereld & Dignum, "Ubi Lex, Ibi Poena," COIN II,
101–114**, DOI `10.1007/978-3-540-74459-7_7` (Crossref + DBLP verified). Full
text **not obtained** — cite as origin per three independently-read attributions,
but do not quote from it.

### The highest-priority open item

**Dastani, Sardina & Yazdanpanah, "Norm Enforcement as Supervisory Control,"
PRIMA 2017, LNAI 10621, pp. 330–348**, DOI `10.1007/978-3-319-69131-2_20`.
Existence, authors, venue, pages and DOI verified three ways. Abstract verbatim:

> In this paper, we study normative multi-agent systems from a supervisory
> control theory perspective. Concretely, we show how to model three well-known
> types of norm enforcement mechanisms by adopting well-studied supervisory
> control theory techniques for discrete event systems…

**Full text could not be obtained — `UNRESOLVED`.** Springer preview only; RMIT
repo HTTP 202 empty; Southampton ePrints 401; Utrecht DSpace 500; no arXiv
preprint.

**The "green OA" record is confirmed metadata-only — this route is definitively
closed.** A follow-up pass queried the figshare API directly rather than the
landing page:

```
GET https://api.figshare.com/v2/articles/27343188
  title:         "Norm enforcement as supervisory control"
  defined_type:  conference contribution
  is_embargoed:  False
  files:         []
GET https://api.figshare.com/v2/articles/27343188/files  ->  200  []
```

Not embargoed, not restricted — **no file was ever deposited**. Semantic Scholar
and Unpaywall both report this record as GREEN open access, and both are wrong.
Anyone re-attempting this should skip the OA flags entirely and go straight to
institutional access or an author request (Sardina at RMIT, Yazdanpanah at
Southampton).

**Do not submit before someone with institutional access reads these 19 pages.**
The remaining priority question turns on it.

No paper found in this community states the regimentability boundary as a
*theorem* other than possibly Dastani et al. — the distinction is universally a
design taxonomy, and "regimentation of all actions is often difficult or
impossible" is treated as a practical observation. `probable`; a negative claim
over a large literature.

## Proposed text for `paper2.tex`

Drafted, not applied.

### Replacement for lines 282–286

> Closest to our setting is Basin, Jug\'{e}, Klaedtke and
> Z\u{a}linescu~\cite{bjkz13}, who refine Schneider by distinguishing system
> actions that an enforcement mechanism \emph{controls} from those it merely
> \emph{observes}, and who give necessary and sufficient conditions for
> enforceability with respect to that distinction --- generalizing safety to a
> $(U,O)$-relative notion whose closure form,
> $\mathrm{cl}(\mathrm{pre}^*(P\cap U)\cdot O^*)\cap U\subseteq P$, specializes
> on a universal plant and regular $K$ to exactly the controllability criterion
> in our box. Our alphabet split is theirs; we claim no priority for it. What
> Basin et al.\ leave open is the identification itself: they observe that ``the
> Ramadge--Wonham framework $\ldots$ has several similarities with our setting''
> and close with ``it remains to be seen whether and how the domain of policy
> enforcement can benefit from the Ramadge--Wonham framework and the results
> around it.'' This paper closes that question in one direction. Naming the
> condition as controllability is not a relabeling: it imports the supremal
> controllable sublanguage, the maximal-permissiveness certificate, and decades
> of modular, hierarchical and tool-supported synthesis, none of which is
> available from the $(U,O)$-safety formulation. Our second contribution is the
> instantiation: Basin's canonical uncontrollable action is a clock tick, an
> event of the environment; ours are the generative model's own forward-pass
> steps --- which is why widening $\Sigma_c$ can never make a confident lie
> preventable, a corollary with no counterpart in a clock-tick model. Khoury and
> Hall\'{e}~\cite{kh15} generalize Basin's binary split to a lattice of control
> levels; our two-valued split is the coarsening appropriate to a runtime that
> either owns a channel or does not.

### Runtime-enforcement lineage, following the Schneider sentence in §8

> The mechanism-power lineage descending from Schneider is orthogonal to ours and
> should not be confused with it. Ligatti, Bauer and Walker~\cite{lbw05} classify
> monitors by what they do to the trace --- truncation, suppression, insertion,
> and edit automata --- and show that all four \emph{precisely} enforce exactly
> the safety properties, while an edit automaton \emph{effectively} enforces any
> property by suppressing actions until a prefix is confirmed legal and then
> reinserting them. Every one of those operations requires the mechanism to be
> interposed and able to withhold the action; edit automata are powerful
> precisely because they can \emph{delay}, which is the capability an
> uncontrollable event denies. Our detect-and-compensate is therefore not a
> weaker member of their taxonomy but a category outside it: all four of their
> mechanisms are mechanisms over $\Sigma_c$. They name our regime as an
> out-of-model limitation --- ``the monitor is unable to interpose itself between
> the application and the device'' --- which Basin et al.\ later formalize.
> Falcone, Fernandez and Mounier~\cite{ffm12} ask a question whose title is
> nearly ours and answer it on the other axis: holding complete mediation fixed
> and equipping the monitor with unbounded finite memory and
> $\{halt, store, dump, off\}$, the enforceable properties are exactly the
> response properties of the safety--progress hierarchy. Their refinement moves
> \emph{up} the hierarchy by adding buffering power; ours stays at prefix-closed
> safety and removes mediation. Neither contains the other, and the joint
> statement --- safety \emph{and} controllable --- is what a deployed agent
> runtime must satisfy.

### New normative-MAS paragraph

> The word ``regimentation'' is not ours. In normative multi-agent systems it is
> an established term of art for precisely the distinction this paper draws:
> regimentation makes violation impossible by design, enforcement detects
> violations and responds with sanctions~\cite{gad06}. That community has long
> observed both halves of our theorem informally --- that regimentation operates
> ``by mediating access to resources and the communication channel'' and that
> ``the regimentation of all actions is often difficult or
> impossible''~\cite{cs16} --- and has even drawn our alphabet split as a design
> taxonomy, separating regimentation of an agent's \emph{mental states} (possible
> only when the agent is a white box) from regimentation of its \emph{actions}
> (the black-box case)~\cite{balke09}. An LLM agent is the black-box case, and
> $\Sigma_u$ is the formal content of its black-boxness. Our contribution
> relative to this literature is to replace ``often difficult or impossible''
> with a decidable criterion and a synthesis procedure.

### Corrections required in §3 (`sec:schneider`)

Rewrite `paper2.tex:87–92`. Schneider proves that EM-enforceable policies **are**
safety properties (necessity), and explicitly denies the converse. The
degeneration sentence must change accordingly: at $\Sigma_u=\emptyset$ Paper 2's
theorem is strictly stronger than Schneider's, with regularity supplying what
Basin states as separate decidability and nonemptiness conditions.

### Correction required in §5 (`sec:compound`)

The compound policy is Schneider's Figure 1. Present the design rule as a reading
of his own example under the alphabet split, and drop "the case where untrained
intuition most often guesses wrong."

### `\bibitem` entries

```latex
\bibitem{bjkz13} D.~Basin, V.~Jug\'{e}, F.~Klaedtke, and E.~Z\u{a}linescu.
Enforceable security policies revisited. \emph{ACM Transactions on Information
and System Security}, 16(1):1--26, 2013.

\bibitem{lbw05} J.~Ligatti, L.~Bauer, and D.~Walker. Edit automata: enforcement
mechanisms for run-time security policies. \emph{International Journal of
Information Security}, 4(1--2):2--16, 2005.

\bibitem{ffm12} Y.~Falcone, J.-C. Fernandez, and L.~Mounier. What can you verify
and enforce at runtime? \emph{International Journal on Software Tools for
Technology Transfer}, 14(3):349--382, 2012.

\bibitem{kh15} R.~Khoury and S.~Hall\'{e}. Runtime enforcement with partial
control. arXiv:1508.06525, 2015.
% peer-reviewed venue not established -- detail unconfirmed

\bibitem{gad06} D.~Grossi, H.~Aldewereld, and F.~Dignum. Ubi lex, ibi poena:
designing norm enforcement in e-institutions. In \emph{Coordination,
Organizations, Institutions, and Norms in Agent Systems II}, pages 101--114.
Springer, 2007.
% 2006-workshop / 2007-proceedings discrepancy; Crossref gives no year

\bibitem{cs16} N.~Criado and J.~M. Such. Norm monitoring under partial action
observability. arXiv:1505.03996, 2016.
% venue beyond arXiv v2 unconfirmed

\bibitem{balke09} T.~Balke. A taxonomy for ensuring institutional compliance in
utility computing. Dagstuhl Seminar Proceedings 09121, 2009.
% article number beyond seminar 09121 unconfirmed

\bibitem{dsy17} M.~Dastani, S.~Sardina, and V.~Yazdanpanah. Norm enforcement as
supervisory control. In \emph{PRIMA 2017}, LNAI 10621, pages 330--348. Springer,
2017.
% DO NOT CITE UNTIL READ -- see open item 1

\bibitem{ray26} S.~Ray. What can be enforced? A theory of certified runtime
safety for tool-using agents. arXiv:2607.22868, 2026.
```

### Reserve paragraph, only if the Dastani overlap turns out real

> Dastani, Sardina and Yazdanpanah~\cite{dsy17} study normative multi-agent
> systems from a supervisory-control perspective and synthesize SCT-based norm
> enforcement mechanisms. Our theorem is, for the systems they consider, an
> instance of their framework; what this paper adds is the agent-runtime alphabet
> --- in which the uncontrollable events are a generative model's own
> forward-pass steps rather than exogenous environment events --- the resulting
> classification of a deployed governance corpus, and the machine-checked
> product-automaton test that produces it.

## Open items, ordered by how much they can still change the paper

1. **`UNRESOLVED` — Dastani/Sardina/Yazdanpanah, PRIMA 2017.** Needs
   institutional access or an author request. **Do not submit before this is
   read.**
2. **`UNRESOLVED` — Grossi/Aldewereld/Dignum full text.** No claim above depends
   on its internals, but a referee in that community will expect it read.
3. **`uncertain` — Jones & Sergot 1996**, *Log. J. IGPL* 4(3):427–443, DOI
   `10.1093/jigpal/4.3.427` (Crossref-verified). Not obtained; make no
   institutional-power claims without it.
4. **Decide the framing.** Preferred: "Basin split the alphabet and characterized
   enforceability; we identify their condition with RW controllability, closing
   the question their §5 leaves open, and instantiate it for a runtime whose
   uncontrollable events are a generative model's own steps." Fallback if (1)
   goes badly: drop the theoretical priority claim entirely and lead with the
   classification, checker, synthesis case study, and $\sup\mathcal{C}(K)=\emptyset$
   corollary — a respectable applied paper with a correctly attributed theorem,
   which is what §4–§6 already are.
5. **Fix the two Schneider errors.** Independent of everything else, and
   independently re-verified. Act now.
6. **Cite Ray 2026 as complementary.** True and favorable.
7. **Consider a lattice rather than a binary split** (Khoury–Hallé); honest
   boundary (ii) already describes lattice behaviour in prose.
8. **§7 (partial observation)**: Basin's trace universe $U$ does some of the work
   Paper 2 assigns to Lin–Wonham, and his PSPACE/EXPSPACE realizability results
   are the closest existing analogue to the deferred "which triggers are
   witnessed at which assurance levels" question.

## Retrieval notes

- `WebFetch` is egress-blocked for `arxiv.org` and `link.springer.com` here;
  `curl` through the agent proxy reaches both.
- `pdfs.semanticscholar.org/a5db/…` returns the Basin **conference slides**
  (6 pp.), not the paper. Do not cite from it. The ETH Zürich PDF is the article.
- The Falcone host 403s without a `Referer` header.
- The CMU `lbauer` URL for Ligatti et al. 403s; the USF `~ligatti` copy works.
- **`core.ac.uk` reaches full text that Unpaywall/Semantic Scholar/institutional
  repos miss** — closed Dastani et al. below on the first try via CORE search
  after four other routes had already dead-ended it. Worth trying earlier next
  time a citation is stuck on "record exists, no deposited file."

## Amendment 2026-08-27 — Dastani, Sardina & Yazdanpanah obtained and read

Closed via `core.ac.uk` (download id `572201458`; PDF matches the DOI's title,
authors, and page range `330–348` exactly). Item 3 in the "Open items" list
above ("`uncertain` — read Dastani et al. before submission") is now
`verified`.

**What it says.** Their **Theorem 1**: a norm is "regimentable" (their term,
same concept Paper 2 calls regimentable) in a plant $G$ iff there exists a
regiment-based supervisor $V_r$ with $L(V_r/G)=K_n$ — proved by directly
importing Ramadge–Wonham's Controllability Theorem (their ref [13], p. 145):
"having a plant $G$... and a nonempty $K\subseteq L(G)$, there exists a
supervisor $S$ such that $L(S/G)=K$ iff $K.\Sigma_u \cap L(G) \subseteq K$."
This is the same regimentable-iff-controllable identification Paper 2 makes,
in normative-multi-agent-systems vocabulary rather than security-policy
vocabulary, and it predates Paper 2 by construction (PRIMA 2017).

**Does it change the verdict?** No — **NARROW stands.** Two things keep this
from moving the needle further toward SUBSUMED:

1. **They don't claim it as a contribution.** §7/§8 place their novelty
   entirely in extending regimentation to sanction- and repair-based
   enforcement; the regimentable/controllable identification is presented as
   an unremarkable, one-paragraph corollary of "importing" classical SCT, not
   as a result they're claiming credit for.
2. **They don't cite Basin et al. 2013 or engage the enforceability-boundary
   question Paper 2 actually asks** (which safety policies are enforceable at
   all, at what observation granularity) — their scope is narrower, just
   "does this specific norm admit a regimenting supervisor in this specific
   plant."

**What this does change:** Paper 2's already-conceded "surviving delta" — that
Basin explicitly leaves the Ramadge–Wonham identification as an open question
— is weaker than the flag-2 verdict stated. It is not open; it has been
directly imported as a one-line corollary by at least two independent groups
in two different subfields (Basin's security-policy line, and this
normative-multi-agent-systems line) before Paper 2. **Recommended Related Work
addition to `paper2.tex`**, alongside the existing Basin 2013 citation:

> The regimentable-iff-controllable identification itself is not new to either
> the enforcement or the normative-systems literature: Dastani, Sardina \&
> Yazdanpanah~\cite{dsy17} import the same Ramadge--Wonham controllability
> theorem to characterize when a norm admits a regimenting supervisor, treating
> the identification as an unremarkable corollary rather than a contribution.
> Our delta is [the specific runtime instantiation / whichever framing the
> paper's own §7 ultimately keeps] — not the identification, which is folklore
> across at least two independent subfields by 2017.

Not wired into `paper2.tex` in this pass — this is a citation-ready proposal,
same discipline as every other entry in this register: only `verified` items
may enter a `.tex` file, and this one just crossed that line.
