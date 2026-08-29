# Exposition + Figure Review: *What Needs an Authority: Mechanical Detection, Chartered Resolution, and the Exact Price of Sole Ownership*

`docs/harbor-research/tex/paper6.tex`, 416 lines (11 numbered sections, 2 `\input`-ed TikZ figures, 1 unfloated table, 11 bibitems). Paper 6 of the Harbor program: it takes the coordination functions a governance charter hands out — a *lookout* that scans commitments for contradictions, *sole-responsibility roles* for the roadmap/test-suite/release-tag — and sorts them into those an algorithm discharges for free and those a charter must pay for, pricing the second set. Part I is deontic logic and complexity (a designed commitment fragment $\mathcal{L}_c$ where conflict detection is polynomial and witness-producing, plus an NP-completeness frontier one disjunction outside it, composed with Paper 2 into a runtime guard); Part II is queueing (an exact Erlang-C specialization boundary $g_A(\rho,c)$ that falsifies and replaces the whitepaper's proposed threshold, plus a succession price $D^\star$ from an $M/M/1$-with-breakdowns model). It is the corpus's "what does the charter actually owe money for" paper, and it is the load-bearing consumer of Paper 2's regimentation theorem. **On the house checklist it is one of the strongest papers in the program** — express lane, one-breath line, relation map, two boxed theorems, three worked "Now you try" fades, a preempted misread in each part, an eight-item honest boundary, and consistent `[verified]`/`[internal]` provenance tags on every number. The findings below are mostly about *precision at the boundaries of the claims* and *where the reader is standing when a symbol arrives*, not about missing moves.

**Mechanical linter** (`skills/research-paper-submission/scripts/submission_lint.py`; note the `.py` source is absent from the working tree — only `__pycache__/submission_lint.cpython-311.pyc` exists, and it was run directly):

```
CLAIMS TO CONFIRM
  [info ] paper6.tex:43: 'iff' x8 at lines 43, 165, 174, 208, 244, 258, 290, 336
          - both directions proved? check the degenerate cases (empty, zero, singleton)
0 error(s), 0 warning(s), 1 claim(s) to confirm
```

Clean on refs, labels, citations, captions, abstract length, braces. **Two linter blind spots matter here and are folded in below:** (a) the overclaim needles (`unbounded`, `impossible`, `in every`, `for all`, …) are matched on raw text, so three universal quantifiers escape detection because the paper emphasises them — `in \emph{every} consistent world` (L102), `forced in \emph{every} world` (L164), `at \emph{every} skill premium` (L290) — and L290 is the one that turns out to be wrong; (b) the uncaptioned/unlabelled-float check only inspects `\begin{figure}`/`\begin{table}`, so the paper's central summary artifact (the inventory table, L328–339, wrapped in a bare `center`) is invisible to it. The linter's `iff` prompt is the right prompt: **item A1 below is exactly the degenerate case it asks about, and the claim does not survive it.**

No LaTeX toolchain in this container; anything needing a compile is marked **[needs render]**.

---

## Part A — Text/exposition changes

### 1. Theorem 3's `iff` is false at its own boundary point, and the box omits the condition under which $D^\star$ exists

**Location** — L289–291 (Theorem 3 box), with knock-on at L34–35 (abstract), L44 (express lane), L308–311 ("Now you try"), L337 (inventory table).
**Issue** — Un-both-directions `iff` + unguarded formula (the linter's flagged claim at L290). Three inequality conventions for the same fact appear in four places.
**Current text** (L289–291):

> decreasing in $\mu_s$ with infimum $W_\infty$: \emph{no amount of skill buys back residual downtime}. Consequently, with
> $K = A/(w\lambda) + W_{\mathrm{pool}}$ the pool's cost line, pooling dominates at \emph{every} skill premium iff
> \[ \frac{\xi}{\eta} \;>\; D^\star \;=\; \frac{\eta K}{1-\eta K}, \]

Two separate defects. **(i) Strictness.** $W_\infty$ is an *infimum, not attained* — the box says so one line earlier. So at exactly $\xi/\eta = D^\star$, where $W_\infty = K$, every *finite* $\mu_s$ still gives $W_{\mathrm{bd}} > W_\infty = K$ and pooling still dominates at every premium. The correct threshold is therefore $\ge$, not $>$. The inventory table (L337) independently writes "viable only while $\xi/\eta \le D^\star$", which claims the opposite at the same point; the abstract (L35) writes "stays below $D^\star$"; the express lane (L44) writes "$\xi/\eta \le D^\star$". Four statements of one fact, three conventions, and the boundary point is claimed for both sides.
**(ii) Missing domain condition.** $D^\star = \eta K/(1-\eta K)$ is only a threshold when $\eta K < 1$. For $\eta K > 1$ the closed form returns a *negative* number, and the boxed criterion "$\xi/\eta > D^\star$" then holds for every positive $\xi/\eta$ — i.e. as literally stated the box says pooling always dominates, which is the exact inverse of what the paper means. The paper's own "Now you try" at L308–311 gets the substance right ($\eta K = 2.07 > 1$ ⇒ no cap) but reports it as "$D^\star=\infty$", which the formula does not give. The real reason is that $W_\infty = \xi/(\eta(\xi+\eta))$ is bounded above by $1/\eta$, so $K \ge 1/\eta$ makes the floor unreachable at any $\xi$.

**Proposed rewrite** (box):

> decreasing in $\mu_s$ with infimum $W_\infty$, never attained: \emph{no amount of skill buys back residual downtime}. Consequently, with $K = A/(w\lambda) + W_{\mathrm{pool}}$ the pool's cost line, and \emph{provided} $\eta K < 1$ --- equivalently $K < 1/\eta$, the supremum of $W_\infty$ over all $\xi$ --- pooling dominates at every finite skill premium iff
> \[ \frac{\xi}{\eta} \;\ge\; D^\star \;=\; \frac{\eta K}{1-\eta K}. \]
> The inequality is non-strict because the infimum is not attained: at $\xi/\eta = D^\star$ exactly, $W_{\mathrm{bd}} > W_\infty = K$ for every finite $\mu_s$. When $\eta K \ge 1$ there is no cap at all --- $W_\infty < 1/\eta \le K$ for every $\xi$ --- and only the Theorem-2 premium test binds.

Then make L35, L44 and L337 all read $\xi/\eta < D^\star$ for viability, and rewrite the L309–310 answer as "(No: $\eta K \ge 1$ puts $K$ above the floor's own ceiling $1/\eta$, so no $\xi$ triggers the cap — the closed form for $D^\star$ has left its domain rather than gone to infinity. That is what a succession plan *buys*.)"
**Priority** — **high**. *Also flagged below as a possible factual issue.*

### 2. "definite Horn rules … where the head may be $\bot$" is a contradiction in terms, and it breaks the least-model story

**Location** — L145–146 (fragment definition), L99–103 (vocabulary), L162–165 (Theorem 1a).
**Issue** — Definitional inconsistency that propagates into the theorem's justification.
**Current text** (L145–146):

> \item \textbf{facts} (ground atoms) and \textbf{definite Horn rules} $a_1\wedge\dots\wedge a_k \to b$, where the head $b$ may be the contradiction symbol $\bot$;

A definite clause *is* one with a positive atomic head; a $\bot$-headed rule is a goal/integrity clause, and a Horn program containing one may have **no model at all** — which is precisely the first of the paper's four conflict kinds. That collides with L101–103 ("this process is guaranteed to terminate at one canonical answer. That answer is the *least model*") and with L102's "it contains precisely the facts forced in \emph{every} consistent world": when $\bot$ fires there are no consistent worlds and the sentence has no referent. Same issue at L163–165 ("which by monotonicity equals the intersection of all models") — the operative property is that *definite* Horn theories are closed under model intersection, not monotonicity as such, and it holds of the definite part only.
**Proposed rewrite** (L145–146):

> \item \textbf{facts} (ground atoms) and \textbf{Horn rules} $a_1\wedge\dots\wedge a_k \to b$, where the head $b$ is either an atom (a \emph{definite} rule) or the contradiction symbol $\bot$ (an \emph{integrity constraint}). The definite rules alone form a definite program with a least model; the $\bot$-headed constraints are then evaluated against that model, and a fired $\bot$ is the first of our four conflict kinds --- which is exactly why the program \emph{as a whole} may have no model;

and at L102, after "…forced in \emph{every} consistent world":

> --- and when an integrity constraint fires there are no consistent worlds, which is the report we want.

and at L163: replace "which by monotonicity equals the intersection of all models" with "which, definite Horn theories being closed under intersection of models, equals the intersection of all models of the definite part".
**Priority** — **high**. *Also flagged below as a possible factual issue.*

### 3. The NP-completeness definition omits completeness

**Location** — L112–118.
**Issue** — A wrong definition of the paper's central complexity concept, in a section whose whole job is to install it.
**Current text** (L113–115):

> It is \textbf{NP-complete} when a proposed solution can be \emph{checked} in polynomial time but no polynomial algorithm for \emph{finding} one is known, and finding one would settle the P versus NP question.

That defines "in NP and not known to be in P". Hardness — the half that makes Theorem 1b's 3-SAT reduction do any work — is absent, so a reader who takes this definition literally cannot see why the reduction is needed at all.
**Proposed rewrite**:

> A problem is in \textbf{NP} when a proposed solution can be \emph{checked} in polynomial time. It is \textbf{NP-complete} when it is in NP \emph{and} every problem in NP reduces to it in polynomial time --- so a polynomial algorithm for it would give one for all of NP, and settle P versus NP. The checking half is usually easy to see; the reducing half is what a reduction like Theorem~1b's establishes, and it is the half that licenses the phrase ``no proposal-time check scales here unless P$=$NP.''

**Priority** — **high**.

### 4. Two live notation collisions: $C$ carries three roles, $c$ carries two

**Location** — $C$ = exclusive-claim count (L161, L27, L332), $C(c,\rho)$ = Erlang-C (L129–130, L246, L260, throughout Part II), $\Delta C$ = cost difference (L315). $c$ = difference-constraint constant (L150, L186), $c$ = number of pooled servers (L125, L235, everywhere in Part II).
**Issue** — Direct violation of the house notation rule ("One alphabet discipline per piece: don't reuse a letter for two roles"). The worst instance is the complexity bound and the Erlang-C formula, which both appear in the abstract (L27 and L33) within six lines of each other.
**Current text** (L161, L246, L150):

> …$T$ fired deontic tokens, $C$ exclusive claims… decidable in $O(H + T\log T + C\log C + V\!\cdot\!E)$
> $g_A(\rho,c) \;=\; c\rho \;+\; \frac{1}{\,1 + \frac{C(c,\rho)}{c(1-\rho)} + \frac{A\mu_g}{w\lambda}\,}$
> \item \textbf{difference constraints} $x_j - x_i \le c$ over deadline variables.

**Proposed rewrite** — rename the two Part I offenders and leave Part II's canonical queueing symbols alone: exclusive-claim count $C \to X$ (bound becomes $O(H + T\log T + X\log X + V\!\cdot\!E)$, in the abstract L27, in the box L161–163, and in the inventory table L332); difference-constraint constant $c \to \delta$ (L150 becomes $x_j - x_i \le \delta$; L106 becomes "an inequality of the form $x_j - x_i \le \delta$"; the oracle's potential box at L186 becomes $[-\Sigma|\delta|,0]^V$). Set $\Delta C \to \Delta\mathcal{C}$ at L315.
**Priority** — **high** (cheap, mechanical, and removes the single most likely referee stumble).

### 5. The queueing dictionary arrives 110 lines before its first use

**Location** — L124–140 (the "Part II: queueing" paragraph inside §2 *The vocabulary, defined*), first used at L234–239 (§6).
**Issue** — Definitions-First, in the specific form the brief names: *placed before first use rather than just before it*. A single "vocabulary" section is a program convention (Paper 2 has one at its L66), so the section itself is not the problem — the problem is that this one holds **two** dictionaries for two disjoint fields, and the reader must carry $\lambda, \mu_s, \mu_g, \rho, c, r, C(c,\rho), W_\infty$ unused through 25 lines of $\mathcal{L}_c$ definition, a boxed dichotomy theorem, a 3-SAT reduction, an oracle sweep, two worked examples and a Paper-2 composition before any of them recurs. The paper even concedes the split at L91–92 ("two fields that share no readers").
**Proposed rewrite** — cut L124–140 wholesale and paste it into §6 (`sec:queue`) immediately after the section head at L228, before "Part I located the one place…". Retitle §2 (L90) from `The vocabulary, defined` to `The vocabulary of Part I`, and delete the now-inaccurate framing at L91–93, replacing it with:

> Part~I needs two dictionaries a scheduler-builder may not have: deontic logic and complexity theory. Both are below, in the order the terms are needed; Part~II's queueing vocabulary waits until \S\ref{sec:queue}, where it is used. Nothing here is deep; it is all notation someone else fixed decades ago.

While moving it, add the four symbols the dictionary currently omits but the boxes assume — $A$ (accountability value), $w$ (waiting cost per request-hour), $\xi$ (death rate), $\eta$ (succession rate, mean spin-up $1/\eta$) — and define $K$ there rather than mid-box at L290.
**Priority** — **high**.

### 6. The inventory table is unfloated, uncaptioned, unlabelled — and the express lane points at it

**Location** — L328–339; cross-reference at L45.
**Issue** — Mensh–Kording violation (a table a reader cannot read without the body text), plus a dangling promise. The express lane tells the expert to "read the two boxes …, the succession box …, and the inventory table (\S\ref{sec:inventory})" — pointing at a *section*, because the table has no label to point at. The linter cannot see any of this because the table is in a bare `center`.
**Current text** (L328):

> \begin{center}\begin{tabular}{@{}p{0.36\textwidth}p{0.2\textwidth}p{0.36\textwidth}@{}}

**Proposed rewrite** — wrap it as a float and give it a finding-stating caption (the paper already *has* the finding, in prose at L341–344 — promote it):

> \begin{table}[t]\centering
> \caption{The authority inventory, priced. Rows 1--2 delete an authority the governance document assumed it needed --- in-fragment detection is an algorithm and, composed with Paper~2, a runtime guard. Rows 3--4 locate the authority no theorem removes: choosing a discharge, and choosing the norms. Rows 5--6 keep the authority and hand it an invoice, in quantities the daemon already meters.}
> \label{tab:inventory}
> \begin{tabular}{@{}p{0.36\textwidth}p{0.2\textwidth}p{0.36\textwidth}@{}}
> …
> \end{tabular}\end{table}

and change L45 to "and the inventory table (Table~\ref{tab:inventory})". Keep L341–344 but trim it to the last sentence, so the caption and the body do not recite each other.
**Priority** — **high**.

### 7. Bellman–Ford's `iff` needs its super-source

**Location** — L108–110 (vocabulary), L165–166 (Theorem 1a box).
**Issue** — Un-both-directions `iff` (linter flag at L165): a precondition is missing that makes the reverse direction true.
**Current text** (L109–110):

> Bellman--Ford finds such a cycle if one exists, and hands it over as the witness.

and (L165–166):

> Bellman--Ford returns a negative cycle iff the deadline system is infeasible, in $O(V\!\cdot\!E)$.

Bellman–Ford from a single arbitrary source detects only negative cycles *reachable from that source*. The standard difference-constraint construction adds a source joined to every variable by a zero-weight edge; without it the "iff" fails on any policy set whose deadline variables split into disconnected components — which is the common case, since unrelated commitments do not share deadline variables. The complexity term also changes.
**Proposed rewrite** (L109–110):

> Bellman--Ford, run from an added source joined to every deadline variable by a zero-weight edge --- so that a cycle sitting in a component no single variable reaches is still found --- returns such a cycle exactly when one exists, and hands it over as the witness.

and in the box (L165–166): "Bellman--Ford over the augmented graph (source $v_0$, zero-weight edges to all $V$ variables) returns a negative cycle iff the deadline system is infeasible, in $O(V\!\cdot\!(E+V))$", with the abstract's L27 bound and the inventory table's L332 bound updated to match.
**Priority** — **medium**. *Possible factual issue if the script does not already add the source — see below.*

### 8. The one-breath sentence is four breaths

**Location** — L65–68.
**Issue** — Move 2 violation: "If you need two sentences, you have two results — split the piece." The line is 62 words carrying three semicolon-joined clauses and five symbols.
**Current text**:

> \onebreath{An authority is needed exactly where the algorithm ends: inside a designed commitment fragment, conflict detection is a polynomial witness-producing decision the runtime can enforce pre-commit --- no judge; one expressive step outside, conflict-freedom is NP-complete and a chartered resolver must choose; and sole ownership of a role is justified not by principle but by an exact Erlang-C threshold on skill, payable only while the owner's death-rate--times--succession-time stays below $D^\star$.}

**Proposed rewrite** — keep the slogan as the one breath (it is already the paper's best sentence, sitting unused at L36–37), and demote the enumeration to the paragraph after it:

> \onebreath{An authority is needed exactly where the algorithm ends --- and where it is needed, its price is a computable number, not a vibe.}
> \noindent Three places, in this paper: inside the fragment $\mathcal{L}_c$ the algorithm does not end, so no authority is consumed; one disjunction outside it the algorithm ends and a chartered resolver must choose the discharge; and sole ownership of a role is not an ending but a purchase, priced by an Erlang-C threshold and capped by a succession rate.

**Priority** — **medium**.

### 9. Abstract hands the reader six undefined symbols and one misreadable quantifier

**Location** — L24–37.
**Issue** — Abstract self-containment. $H, T, C, V, E$ arrive at L27 with no gloss; $K$ arrives at L35 inside $D^\star=\eta K/(1-\eta K)$ and is never named anywhere in the abstract. Separately, L34–35 reads:

> a sole owner who can die and be succeeded is viable at \emph{any} skill premium only while the death-rate--times--succession-time product stays below $D^\star$

which parses as "viable at *every* premium", i.e. that below $D^\star$ no premium test is needed — the opposite of Theorem 2, which still binds there. The intended claim is that *some* premium can rescue the role only below $D^\star$.
**Proposed rewrite** (L26–28 and L34–35):

> …detection is a polynomial, witness-producing algorithm --- linear in the Horn program, log-linear in the deontic tokens and exclusive claims, and Bellman--Ford in the deadline graph --- validated against a brute-force oracle…

> …and a sole owner who can die and be succeeded can be rescued by \emph{some} skill premium only while the death-rate--times--succession-time product stays below $D^\star=\eta K/(1-\eta K)$, where $K$ is the pool's cost line (its mean wait plus the accountability credit): past that line, pooling wins even against an infinitely skilled specialist.

**Priority** — **medium**.

### 10. The figure caption and the reproducibility note name different generating scripts

**Location** — `figures/fig-paper6-regime.tex` L137–138 vs `paper6.tex` L391–392.
**Issue** — A directly checkable contradiction a referee will notice.
**Current text** — figure caption: "Both panels regenerate from \texttt{b8\_specialization.py} [internal, seed 20260816]." Paper: "The two figures regenerate from \texttt{docs/harbor-research/figures/src/paper6\_figures.py}." The figure file's own header comment (L1–3) says it was transcribed from `create_regime_diagram()` in `paper6_figures.py`, which agrees with the paper and not with its own caption.
**Proposed rewrite** (figure caption last sentence):

> Both panels are closed-form curves, plotted from \texttt{figures/src/paper6\_figures.py}; the underlying boundary and $D^\star$ results are \texttt{b8\_specialization.py} [internal, seed 20260816].

**Priority** — **medium**.

### 11. Related work reaches nothing published after 2000 — and reproduces a documented prior failure exactly

**Location** — L346–364, bibliography L394–415.
**Issue** — Prior-art coverage. Every one of the 11 references is 1917–2000 (median 1978). Papers 2, 4 and 5 — the ones that have had a prior-art pass — each cite into the 2010s and 2020s.

The sharp version of this is not "the citations are old". It is that `references/finding-prior-art.md` opens with six real failures from the audit of seven papers in this program, and **failure #4 is this paper, verbatim**:

> 4. A paper cited deontic logic's philosophical origins and nothing from the computational side of the same field — where the complexity results live.

Paper 6 cites von Wright 1951 and Chisholm 1963 — the philosophical origins — and its Part I contribution *is a complexity result about deontic conflict*. This is the highest-risk item in the whole review, because it is the one failure mode the program has already written down and is repeating.

Named suspicions only, per the brief; **none chased down, all should be checked before submission**:
- **Norm conflict detection (the failure-#4 field).** There is a computational normative-MAS literature specifically about *detecting* conflicts between obligations and prohibitions over scopes and intervals (Vasconcelos/Kollingbaum/Norman on normative conflict resolution; Governatori & Rotolo on defeasible deontic logic; Ågotnes/van der Hoek/Wooldridge on normative systems; Meyer & Wieringa's *Deontic Logic in Computer Science* as the anchor volume). If any of it already draws a tractable/intractable line in a ground fragment, Theorem 1's novelty claim ("the *location* of the frontier", L349–350) is the claim at risk. Structural search per the protocol: state the result with no deontic vocabulary at all — *"ground implications plus typed interval assertions with a clash predicate; polynomial, and NP-complete once assertions may be disjunctive"* — and search that.
- **Temporal constraints.** The paper cites Stergiou–Koubarakis 2000 for "STP polynomial, disjunctive temporal NP-complete" but not **Dechter, Meiri & Pearl, *Temporal Constraint Networks*, AIJ 1991** — the canonical source for both the STP tractability result and the TCSP hardness result. The L182 sentence ("the same step is familiar one formalism over") is describing DMP's result and citing its successor. Cheapest fix in the whole item.
- **Pooling vs. dedication — and a whole field's vocabulary the paper never enters.** Halfin–Whitt 1981 is cited for "economies of pooling", but Halfin–Whitt is a heavy-traffic staffing limit, not a pooling-vs-dedication comparison (see F5). More structurally: the specialist-vs-pool question is *operations management's* question, and OM does not call it pooling-vs-dedication — it calls it **server flexibility** (dedicated vs. flexible servers, chaining; Jordan & Graves 1995 and successors) and, in the call-centre branch, **skill-based routing** (Gans/Koole/Mandelbaum 2003 is the standard survey). Those are the field's own controlled-vocabulary terms and none of them appears in the paper, which is the exact "searched thoroughly in your own words" shape. Venues to browse: *Management Science*, *M&SOM*, *Operations Research*, MSC 60K25/90B22.
- **Commitment languages.** "Commitment" is doing load-bearing work throughout, and the agent-communication literature owns that term (Singh's commitment machines, Chopra & Singh). One sentence of positioning, even if only to disclaim the connection.

**Proposed rewrite** — no prose to hand over yet; this is a research task. Minimally, add DMP 1991 alongside `sk00` at L182, and split the L354 "Positioned against deontic logic" sentence into "classical deontic logic" (von Wright, Chisholm, Ross) and "computational normative systems" (the modern line), with the honest sentence: "our fragment's conflict predicate is operational rather than logical, which is the point at which this literature and ours diverge."
**Priority** — **high** (raised from medium on the strength of the failure-#4 match).

### 11b. "Regimentable" is a term of art the paper uses without citing — the naming check was never run on it

**Location** — L29, L208–209, L213–214, L219, L224, L373; imported from Paper 2 (whose own title is *Regimented or Enforced*).
**Issue** — Coining a term that is already taken. `references/finding-prior-art.md`, failure #2:

> 2. A paper used "regimentation" as if coining it. It is a term of art in normative multi-agent systems meaning exactly what the paper meant.

Paper 6 introduces it in italics as a definition — "enforceable-by-prevention (\emph{regimentable})" (L208) — with no citation, which is precisely the "term introduced without a citation that a reader in an adjacent field might already know" detection cue. Worse, this is the *same adjacent field* (normative MAS) as failure #4 above, so a single missed literature is generating two independent defects. Note the upside the skill points out: if the term genuinely means the same thing, adopting it converts a novelty risk into a free citation of the founding work.
**Proposed rewrite** (L208), assuming the check comes back "same sense" — the wording to use once verified:

> Paper 2 proved that a safety policy over an agent's event alphabet is enforceable-by-prevention --- \emph{regimented}, in the normative-multi-agent-systems sense of a norm the institution makes impossible to violate rather than merely sanctioning after the fact~\cite{XXX} --- iff it is Ramadge--Wonham controllable

If the check comes back "adjacent but different", gloss it in the same slot rather than renaming; the term is now load-bearing across two papers.
**Priority** — **high** (a one-hour check that either buys a citation or averts a reviewer's opening sentence).

### 11c. The novelty claim has a date but no search trail

**Location** — L362–364.
**Current text**:

> An August-2026 survey found no prior statement of the authority question in this detection/resolution/ownership decomposition; a final lit-sweep before submission is owed --- ``not found'' is not ``proven nonexistent.''

**Issue** — The hedge is exactly right and should stay. What is missing is the artifact: "a one-paragraph search trail. Which databases, which terms, which vocabularies, which fields you checked and found nothing in, and the date. PRISMA-lite. Costs nothing; **it is the missing artifact in all six failures**." As written, a referee cannot tell whether the survey entered normative MAS or operations management at all — and per 11/11b, it probably did not.
**Proposed rewrite** — keep the sentence and append the trail:

> \paragraph{Search trail.} Semantic Scholar, DBLP and arXiv full-text, August 2026, for the fragment result stated without deontic vocabulary (``ground implications with typed interval assertions and a clash predicate; polynomial, NP-complete under disjunctive assertions'') and for the queueing result stated without queueing vocabulary (``when does one fast dedicated worker beat $c$ pooled slower ones, with a value on single-writer attribution''); two rounds of backward and forward snowballing from Dowling--Gallier, Stergiou--Koubarakis and Mitrany--Avi-Itzhak; ACM CCS siblings under normative systems and under queueing theory; arXiv cross-lists cs.LO/cs.MA/cs.GT. No prior statement of the detection/resolution/ownership decomposition found. ``Not found'' is not ``proven nonexistent.''

(Written as a template — **every clause of it must be true before it ships**, and per 11/11b at least the CCS and OM clauses are not true yet.)
**Priority** — **medium-high**.

### 12. Ross's paradox is named but not cited

**Location** — L355–356.
**Current text**: "the classical paradoxes --- Ross's paradox, Chisholm's contrary-to-duty puzzle~\cite{chisholm63} --- simply cannot be \emph{stated}". The `\cite` sits after Chisholm, so Ross is uncited. Add `\bibitem{ross41} A. Ross. Imperatives and logic. \emph{Theoria}, 7:53--71, 1941.` and cite it.
**Priority** — **low**.

### 13. Move 6 ("what it buys") is the paper's one weak move

**Location** — §9 `sec:inventory` (L325–344); nearest thing to an application sentence is L322–323.
**Issue** — House style: "the concrete application: which product claim, chapter, or paper this underwrites, **named**. No generic 'this has implications for…'." The inventory table is an *abstraction* of the result, not an application of it; the only concrete hook is "Every quantity in both tests … is daemon-metered, so the harbor can re-grade its roles from telemetry rather than from taste" (L322–323), which names no surface.
**Proposed rewrite** — add one short paragraph after L344:

> \paragraph{What it buys, concretely.} Two things ship from this table. The first two rows are a schema rule for the commitment language: as long as proposals stay inside $\mathcal{L}_c$, the acceptance path needs no reviewer role at all --- the daemon's mediated write refuses the commit and attaches the witness, and the charter can delete the lookout it was about to appoint. The last two rows are a role-grading rule: $\lambda$, $\mu_s$, $\mu_g$, $\xi$ and $\eta$ are all already metered per role, so a harbor can compute $r$ and $g_A(\rho,c)$ for each of its sole-responsibility roles on a schedule and demote the ones that stopped clearing the boundary --- and can price a succession plan by how much $\eta$ it buys.

**Priority** — **medium**.

### 14. Which direction does the guard actually need at the frontier?

**Location** — L115–116, L169–175, L222–226.
**Issue** — A question, not a defect. Theorem 1b states that *conflict-freedom* (there exists a conflict-free discharge selection) is NP-complete. But the runtime guard of §5 needs to **reject** — i.e. to certify that *no* selection is conflict-free — which is the complement, and coNP-complete. The paper's operational conclusion ("no proposal-time check scales there unless P$=$NP", L224) is unaffected, but as written a careful referee will ask why the harder direction is not the one stated, and whether the witness-producing property (the paper's distinguishing feature in Theorem 1a) survives at all past the frontier — a "no conflict-free selection exists" verdict has no short witness under standard assumptions.
**Proposed rewrite** — add two sentences at L224, after "unless P$=$NP":

> Note which direction bites. The guard must certify that \emph{no} discharge selection is conflict-free, the complement of the NP-complete question and therefore coNP-complete --- so past the frontier the harbor loses not just the polynomial check but the short witness with it. That is the second thing the chartered resolver is being paid for: a refusal it can defend without a certificate.

**Priority** — **medium**.

### 15. Section fragmentation: 11 sections, two of them under 15 lines

**Location** — §6 `sec:queue` (L228–239, 12 lines) and §7 `sec:thm-boundary` (L241–273) are one argument split across a section break, as are §3 `sec:lang` (L142–156) and §4 `sec:thm-detect`.
**Issue** — Low-grade structural noise; the paper reads as more chopped than it is, and the express lane has to name four separate section labels to route the expert.
**Proposed rewrite** — merge §6 into §7 under the head "Part II. The sole owner: an inequality, not a principle" (keeping `\label{sec:queue}` and adding `\label{sec:thm-boundary}` to the same section so both existing `\ref`s resolve), and merge §3 into §4 under "Part I. The lookout is a subroutine" the same way. Net: 11 sections → 9, and the express lane's pointers still work.
**Priority** — **low-medium**.

### 16. `graphicx` and `graphicspath` are dead after the native-vector conversion

**Location** — L3–4.
**Issue** — `CONVENTION.md` is explicit that no figure is a raster; both figures are `\input`-ed `.tex`. Leaving `\graphicspath{{../figures/}}` in place both preserves a path that the flat-`build/` copy step makes wrong anyway, and quietly invites an `\includegraphics` regression.
**Proposed rewrite** — delete both lines. **[needs render]** to confirm nothing else in `preamble.tex` depends on `graphicx` being loaded here.
**Priority** — **low**.

### 17. The title's "Exact Price" is exact only given two exogenous prices

**Location** — L13 (subtitle), against boundary item (v) at L376.
**Issue** — Unhedged superlative of the kind the brief asks about. $g_A(\rho,c)$ is exact in $\rho$ and $c$, but it contains $A/(w\lambda)$, and the boundary concedes "$A$ and $w$ are policy prices the theorem constrains but does not pick". "The exact price of sole ownership" therefore overstates by one input layer.
**Proposed rewrite** — either accept it as a title's licence (defensible) or tighten the abstract's version. At L36–37 the slogan already says the honest thing; the fix is to make the boundary's concession visible earlier — add to L320–323's misread paragraph: "The number is exact in the queueing parameters and only as good as $A$ and $w$ in the policy ones; the theorem prices accountability *given* a price for accountability."
**Priority** — **low-medium**.

### 18. Two numbers a referee will subtract, and they do not agree

**Location** — L187–188 vs L191–192.
**Issue** — Unexplained numeric tension in the verification paragraph.
**Current text**:

> 885 conflicts found --- 121 derivable $\bot$, 195 $\Ob$/$\Fb$ clashes, 484 claim overlaps, 213 negative temporal cycles --- of which 149 are reachable \emph{only} through Horn propagation
> …
> Mutation: deleting Horn propagation (checking only directly stated statuses) misses 100 of the 885 sweep conflicts

If 149 conflicts are reachable only through propagation, deleting propagation should miss at least 149 of them, not 100. (Also: $121+195+484+213 = 1013 \ne 885$, which is presumably fine if a policy set can carry several conflict kinds and the census counts conflicts while 885 counts something else — but the sentence reads as a partition of 885 and does not survive addition either.) The most likely reconciliation is that 149 counts *conflicts* and 100 counts *policy sets whose verdict flips* — a set carrying both a propagation-only and a directly-stated conflict is still correctly flagged. That must be confirmed against the script, not assumed.
**Proposed rewrite** (conditional on the reconciliation being the one above):

> 885 policy sets found conflicted --- across them, 121 derivable $\bot$, 195 $\Ob$/$\Fb$ clashes, 484 claim overlaps and 213 negative temporal cycles (a set may carry more than one), of which 149 conflicts are reachable \emph{only} through Horn propagation
> …
> Mutation: deleting Horn propagation (checking only directly stated statuses) \emph{flips the verdict} on 100 of the 885 --- fewer than the 149 propagation-only conflicts, because a set carrying one of those alongside a directly stated conflict is still correctly rejected; propagation is load-bearing at scale, not a formality [internal].

**Priority** — **high** (as a thing to resolve; the wording fix is easy once the arithmetic is settled). *Also flagged below.*

### 19. The worked examples are excellent but not *visibly* skippable, and the running example is dropped

**Location** — L194–205, L257–269, L298–311 (the three "Numbers by hand" paragraphs); L70–81 (the port scene).
**Issue** — Two craft points that pull in opposite directions, both minor, both cheap.

*(a) Skippability.* The worked-example effect says a newcomer measurably needs the toy case; the expertise-reversal effect says the same case taxes the specialist, who must reconcile it against a schema they already hold. The resolution is that the example must exist **and be visibly skippable** — a labelled box or aside — so each reader takes only the load they need. Paper 6's three worked examples are `\paragraph{Numbers by hand.}`-headed running prose, typographically identical to the argument around them. The express lane partly discharges this by telling the expert to read the boxes and skip the rest, which is more than most papers do. But the detection cue is "a specialist cannot reach the theorem without reading the toy case", and in §7 the specialist *must* scroll through 12 lines of hand-arithmetic between the Theorem 2 box (ends L255) and the cross-validation stack (L271) that they actually want.
**Proposed rewrite** — no prose change; a typographic one. Define a third mdframed environment beside `thebox` and `boundary` — grey-tinted, no rule, labelled `Worked example (skippable)` — and wrap all three "Numbers by hand" paragraphs in it. That keeps the content verbatim, makes the two reading paths visible on the page rather than only in the express lane, and costs one `\newmdenv` line in the preamble.

*(b) The running example.* The port scene of §1 (pilot, tug crews, three-vessel crossing) is vivid, does real work, and is then **dropped at L88** and never returns; Part I's worked example is `write_prod`/`prod_access`, the "Now you try" switches to an unrelated `audit_open`/`vault_access`, and Part II's numbers have no narrative attachment at all. One stable example lets the reader's effort go into the new mechanism rather than re-orienting to new notation. Cheapest partial fix: make Part II's reference instance a *named role* rather than a bare parameter tuple — "the release-tag owner, metered over a week: $\lambda{=}1$, $c{=}4$, …" — which costs six words at L298 and reconnects the arithmetic to the harbour the paper opened in. (This is craft lore, inferred rather than tested; treat it as a suggestion, not a defect.)
**Priority** — **low-medium**.

### 20. The honest boundary is missing two items it has earned

**Location** — L367–383 (eight items, otherwise exemplary — this is the best boundary section in the corpus).
**Issue** — Two live limitations are visible in the paper's own numbers and are not declared.
**Proposed rewrite** — add:

> (ix) The oracle validation is on \emph{small} instances: the brute-force comparison intersects all $2^5$ Horn models and searches an integer potential box exhaustively, so 3000 disagreement-free runs certify the algorithm's agreement with the semantics on five-atom programs, not its behaviour at production policy-set size. The complexity bound, not the sweep, is what covers scale.
> (x) Theorem~3's threshold $D^\star$ presupposes $\eta K < 1$. Where the succession plan is fast enough that $K \ge 1/\eta$, the downtime floor never reaches the pool's cost line and there is no viability cap to state --- the criterion does not apply rather than being satisfied.

**Priority** — **medium**.

---

### Possible factual issues (not just wording) — flagged, not resolved

Listed in the order I would check them.

**F1 — Theorem 3's threshold is stated with the wrong strictness and without its domain condition.** (Item A1.) As boxed, "pooling dominates at every skill premium iff $\xi/\eta > D^\star = \eta K/(1-\eta K)$" is (a) wrong at $\xi/\eta = D^\star$, where the un-attained infimum means pooling still dominates, and (b) vacuously inverted whenever $\eta K > 1$, where the closed form returns a negative number and the stated inequality holds everywhere. The paper's *substance* is right in both places — its own "Now you try" reaches the correct conclusion for $\eta K > 1$ — so this is a statement defect, not a modelling error, but it is in a box, in the abstract, in the express lane and in the summary table, with three different inequality signs across them.

**F2 — "definite Horn rules … where the head may be $\bot$" is not a coherent object,** and the least-model justification at L101–103 and L163–165 is stated over a program that may have no model. (Item A2.) Again likely benign in implementation — the natural implementation computes the least model of the definite part and then checks constraints — but the paper as written justifies Theorem 1a with a property the fragment does not have.

**F3 — Bellman–Ford's `iff` without a super-source is false on disconnected deadline graphs.** (Item A7.) This one is *not* cosmetic: if `b4_deontic_fragment.py` runs Bellman–Ford from a single arbitrary vertex, the detector genuinely misses negative cycles in other components, and the 3000-instance sweep would not have caught it if the oracle (exhaustive integer search over the potential box) and the detector share the omission — the oracle is a different algorithm, so it probably *would* have caught it, which is evidence the implementation is fine and only the write-up is loose. **Check the script.**

**F4 — the 149-vs-100 arithmetic, and the 1013-vs-885 census.** (Item A18.) Either the two numbers count different things and the prose does not say so, or one of them is wrong.

**F5 — Halfin–Whitt may be the wrong citation for the claim it is attached to.** L352–353: "the economies of pooling in many-server queues are classical folklore sharpened by Halfin--Whitt~\cite{hw81}". Halfin–Whitt 1981 is the square-root-staffing heavy-traffic limit; it is about *how many servers you need*, not about pooled-vs-dedicated. The pooling-economies result usually attributed here is Smith & Whitt (BSTJ 1981). Possible mis-attribution of a classical result — cheap to check, embarrassing if left.

**F6 — direction of the complexity claim vs. what the guard needs.** (Item A14.) Not a wrong statement, but the paper proves NP-completeness of the existential form and applies it to a universal (rejection) obligation. Worth confirming the intended reading is the coNP one before a referee does it for you.

**F7 — one of the four verification sweeps may be structurally incapable of failing.** L271–273:

> the 60-instance random sweep over $(\lambda,\mu_s,\mu_g,c,A,w,\xi,\eta)$ gave 55 decisive instances and \textbf{0} sign violations of the boundary

$g_A(\rho,c)$ is *derived* by rearranging the inequality $w\lambda(W_{\mathrm{solo}}-W_{\mathrm{pool}}) \le A$ — the paper shows the two lines of algebra at L257–260. If the sweep's assertion computes the sign of $r - g_A(\rho,c)$ and compares it to the sign of that same net-cost difference evaluated from the same closed forms, then the assertion is algebraically entailed by the theorem statement printed above it and would report zero violations on a false theorem. That is the skill's "trusting a verification sweep that cannot fail" anti-pattern, with its stated detection test: *can you algebraically derive the assertion from the theorem statement?* Here, apparently yes. **Check `b8_specialization.py`: does the sign check evaluate net cost from simulation, or from the same algebra?**

Two things sharpen rather than soften this. The paper's *other* three checks are genuinely independent and could have failed — the 3000-instance detection sweep runs a structurally different brute-force oracle (enumerate all $2^5$ models and intersect; exhaustive integer search over the potential box), the Erlang-C means are checked against discrete-event simulation ($|z|\le1.8$), and $W_{\mathrm{bd}}$ is cross-validated three ways (matrix-geometric to $2\times10^{-13}$, truncated CTMC to $10^{-14}$, Gillespie $|z|\le0.8$). And the falsification of $\tilde g$ *is* reported with simulation $z$-scores ($z=-15.7$, $z=+32$), which is real evidence. So the likely finding is that the 60-instance sweep is the one weak link in an otherwise strong stack, and the fix is either to re-run it against simulated net cost or to describe it honestly as an algebraic consistency check rather than as validation.

---

## Part B — Existing figures/tables: clarity audit

The paper carries exactly the two Rail-B figures (relation map + regime diagram) and one table. Both figures are native-vector `.tex` per `CONVENTION.md`, both have real labels resolving cleanly (linter: 0 dangling refs), and — worth saying plainly — **both captions state their finding rather than naming their contents**, which is the Mensh–Kording Rule 7 test ("the title of the figure should communicate the conclusion of the analysis") and which most papers fail. Both regime panels also satisfy the regime-diagram convention of carrying a representative point *and* the boundary equation on the figure itself, so the claim is checkable at a glance. The problems below are three named failure modes from the failure-mode table (unlabelled regime, truncated axis, colour as sole channel), one caption that contradicts the paper, and one type-size floor.

**Two program-level notes before the individual audits.**

*Palette.* The house palette (`CONVENTION.md`) is harborblue / shipred / seagreen — and the primary contrast in both of paper 6's figures is the **red–green pair**: seagreen exact vs. shipred falsified in Panel A, seagreen floor vs. shipred marker in Panel B, harborblue base vs. seagreen target in the relation map. Protanopia/deuteranopia affect ~8% of men; with three male reviewers the chance at least one is red–green colourblind is ~22%. Paper 6 is *mostly* rescued by redundant encoding — solid-vs-dashed in both panels, headers in the relation map — with the single exception of Panel A's two shaded lenses (B2). The Okabe–Ito remedy is "replace red with magenta, or green with turquoise, rather than trying to adjust red/green directly"; since the palette is program-wide this is a `CONVENTION.md` conversation, not a paper 6 edit, and I am recording it rather than proposing a unilateral change.

*Type size.* Nature's floor is 8pt figure text, never below 5–6pt. In an 11pt document `\tiny` is 6pt and `\scriptsize` is 8pt. The relation map sets **every** content cell at `\tiny` (6pt) and the correspondence labels at `\scriptsize`; the regime panels use `\scriptsize`/`\tiny` for in-plot annotations inside `0.48\textwidth` minipages. So the corpus is sitting exactly on the floor rather than above it — acceptable, but it means there is no headroom left, and any future attempt to fix a collision by shrinking text goes below the floor. **[needs render]** to confirm the tikzpicture is not additionally scaled down, which would put it under.

### B1 — `fig:relation` (`figures/fig-paper6-relation.tex`, `\input` at paper6.tex L88)

**What it currently shows** — A three-row Gentner relation map. Left column ("Base: a working port", harborblue box): collision geometry / give-way beyond the rulebook / one licensed pilot vs. tug pool. Right column ("Target: the agent harbor", seagreen box): in-fragment conflict scan / disjunctive obligations NP-complete / sole owner iff $g(\rho,c)$, capped at $D^\star$. Three red double-headed arrows between them carrying the mapped relation, plus a footer line: "The map carries relations, not scenery: refusable-by-rule vs decided-by-charter vs paid-for-by-premium."

**What the reader should take away** — That the three coordination functions differ *in kind*, not in degree: one is computed, one is decided, one is bought; and that the analogy is a relation-mapping (so it licenses predictions) rather than decoration.

**Will they get it?** — Cleveland–McGill does not apply (no quantitative encoding); the applicable tests are the house rule "Label arrows with the *relation*, never with nouns" and the olog convention, which is the sharper of the two: a box–arrow–box triple should read as a **grammatical English sentence**. Run it. Row 2: "give-way beyond the rulebook — *where the rulebook ends chartered resolution begins* — disjunctive obligations" — reads. Row 3: "one licensed pilot vs a pool of tug crews — *sole ownership is priced, not presumed* — sole role owner iff $g$" — reads. Row 1: "collision course, constant bearing — *mechanical detection, no authority needed* — in-fragment conflict scan" — does **not** read as a sentence; it is a noun plus a verdict, naming the row rather than stating what maps to what. **Greyscale** (delete-all-colour test): the two domain boxes are `fill opacity=0.12` in harborblue vs. seagreen and render as near-identical light greys, but the figure's claim survives intact because the columns are labelled and the arrows are the only arrows — colour is carrying no information here that a greyscale reader loses. Passes. **Legibility [needs render]**: row 1's target cell is seven 6pt lines in a 2.7 cm column, and the file's own header comments (L21–28) document a previous text-on-text collision at exactly this spot, fixed by hand-breaking lines against widths measured off the CI build. This is the fragile cell to re-inspect on the next build, and per the type-size note above there is no shrinking room left if it collides again — the fix would have to be fewer words.

**Verdict** — Good; three small fixes.

**Concrete fix** —
1. Row 1 arrow label (fig L32), make it a relation that survives the olog read: replace `{mechanical\\DETECTION\\no authority needed}` with `{is computed identically\\by everyone, so\\consumes no authority}` — which makes the triple read "a collision course is computed identically by everyone, so consumes no authority — an in-fragment conflict scan."
2. Notation drift inside the figure: the row-3 target cell (fig L42) says `$g(\rho,c)$` while the caption (fig L53) and the whole paper say `$g_A(\rho,c)$`. Make the body match the caption.
3. Greyscale: give the base box a dashed border (`draw=harborblue,thick,dashed`) and leave the target solid, so the two domains separate without colour.

### B2 — `fig:regime`, Panel A (`figures/fig-paper6-regime.tex` L28–88)

**What it currently shows** — Exact boundary $g(\rho,2)=1+2\rho-\rho^2$ (seagreen solid) against the falsified proposal $\tilde g=1+\rho/(1-\rho)$ (shipred dashed), on $\rho \in [0.02,0.92]$, $r \in [0.9,4.0]$; two shaded lenses between the curves (red below the crossing, blue above); a dotted vertical at $\rho=(3-\sqrt5)/2$; the two refuting instances marked and labelled.

**What the reader should take away** — That the proposed threshold is wrong on *both* sides of a crossing point, so it cannot be rescued by a constant, and that the two shaded lenses are the two error modes.

**Will they get it?** — The curves are position-on-a-common-scale, Cleveland–McGill rank 1: the right encoding, well chosen, and the reference's own corollary applies in the panel's favour — *in a regime diagram the boundary curve does the communicative work, not the fill colour*. The exact/falsified distinction is solid-vs-dashed and survives greyscale. Two named failure modes are nonetheless live.

**Unlabelled regime.** The failure-mode cue is "every shaded region has a text label, not just a colour key." Panel A's two lenses have **no text label at all** — only the two marker points are annotated (`false-certify $r{=}1.15$`, `false-reject $r{=}1.9$`), and those name the *points*, not the *regions*. The caption's key sentence ("the shaded lenses are the two error regimes --- false-certify below the crossing, false-reject above it") is therefore carrying interpretation the figure does not carry, and the two lenses are distinguished from each other only by hue (`fill=shipred,opacity=0.18` vs. `fill=harborblue,opacity=0.15`), which is the least accurate channel in the ranking and collapses to one grey in print. Apply the delete-all-colour test: the claim "$\tilde g$ is wrong on both sides" still survives, because the crossing curves carry it — but the claim "*these two regions are different kinds of error*" does not. That second claim is riding on the weakest available channel.

**Truncated axis.** `ymin=0.9` and `ymax=4.0`, with the dashed curve's own coordinate list running to 12.5 at $\rho=0.92$ — so the reader sees the dashed line leave the top of the frame with no break flagged. The cost is not cosmetic: the paper's sharpest contrast is **$g$ saturates while $\tilde g$ diverges** (L248, and the $\rho{=}0.9,c{=}8$: $7.73$ vs $64$ instance at L253), which is the reason the replacement matters in the busy-pool regime an operations reader actually runs in, and the panel as framed cannot show it.

I verified the plotted data independently: $g(0.1,2)=1.19$, $g(0.5,2)=1.75$, crossing at $0.381966$, $g(0.9,8)=7.733$, $\tilde g(0.9,8)=64$, $C(2,0.1)=0.018182$ — all correct. This is a framing problem, not a data problem.

**Verdict** — Strong panel, two fixes.

**Concrete fix** —
1. Replace the two `fill opacity` shadings with `pattern` fills (`pattern=north east lines` for false-certify, `pattern=north west lines` for false-reject, keeping `pattern color=shipred`/`harborblue`), **and put a text label inside each lens** — `false-certify` and `false-reject` — rather than only on the two marker points. That fixes the unlabelled-regime failure and the greyscale failure in one edit, and lets the caption stop doing the figure's work.
2. Either flag the truncation explicitly (`\node[shipred,font=\scriptsize,anchor=south east] at (axis cs:0.92,4.0) {$\tilde g \to 12.5$};` plus an axis break mark) or, better, add the third panel proposed in C4, which shows saturation-vs-divergence on a log axis where it is actually legible.

### B3 — `fig:regime`, Panel B (`figures/fig-paper6-regime.tex` L90–131)

**What it currently shows** — The downtime floor $W_\infty=\xi/(\eta(\xi+\eta))$ (seagreen solid) rising against a flat pool cost line $K=1.0362$ (harborblue dashed), crossing at $D^\star=0.350$; everything right of the crossing shaded; the $\mu_s=10^8$ specialist marked at $(0.5244, 1.3761)$ with a leader arrow and the note "$\mu_s{=}10^8$ still loses ($W{=}1.376{>}K$)".

**What the reader should take away** — That there is a value of death-rate × succession-time past which skill is irrelevant, because a floor no skill can cross has already gone above the pool's cost.

**Will they get it?** — Yes; this is the better of the two panels. Solid-vs-dashed plus a single shaded region survives greyscale intact. Position on a common scale again. The marked point matches the text exactly (I recomputed $W_\infty(1.5D^\star)=1.37607$ and $D^\star=0.34962$ from the reference instance $\lambda{=}1,c{=}4,\mu_g{=}1.2,A{=}0.2,w{=}1,\eta{=}0.25$ — both match). Two soft issues. (a) The y-axis is labelled "mean response time $W$", but neither plotted series is a response time: one is an *infimum over* response times and the other is a cost line that only has time units because $A/(w\lambda)$ does. A reader can conclude that the seagreen curve *is* the specialist's response time, which is the one misreading the panel most needs to prevent — the actual $W_{\mathrm{bd}}$ always sits strictly above it. (b) The caption's script attribution contradicts the paper (item A10).

**Verdict** — Good; one substantive fix.

**Concrete fix** — Add a third, faint series: $W_{\mathrm{bd}}$ at a realistic finite premium (say $\mu_s = 5$, the paper's own canary instance) as a grey dotted curve sitting above the floor, with `\addlegendentry{actual $W_{\mathrm{bd}}$ at $\mu_s{=}5$}`. That makes "infimum, not attained" visible, which is exactly the property item A1 says the theorem statement is currently getting wrong. Relabel the y-axis "response time / cost line (same units)".

### B4 — The authority inventory table (paper6.tex L328–339)

**What it currently shows** — Six coordination functions × {authority needed?, what it costs}: in-fragment detection (none/algorithm), in-fragment enforcement (none/runtime guard), disjunctive conflict-freedom (chartered resolver), priority-waiver-amendment (chartered, irreducibly), sole ownership (conditional), sole ownership without succession (conditional, capped).

**What the reader should take away** — The paper's entire answer, in one screen: which authorities get deleted, which are irreducible, which get an invoice.

**Will they get it?** — The content is excellent and the ordering is deliberate (deleted → irreducible → priced). But it is a bare `tabular` inside a `center`: no float, **no caption, no `\label`**, so it cannot be referenced, will not appear in a list of tables, and cannot be read without the paragraph beneath it — the paragraph that actually contains the finding. And the express lane at L45 promises the expert "the inventory table" while pointing at a section number, because there is nothing else to point at. Column 3 also mixes registers: rows 1–2 give complexity/mechanism, rows 3–4 give prose, rows 5–6 give inequalities — defensible, but a "what it costs" header over an $O(\cdot)$ bound and "the charter's residual job" is doing a lot of work.

**Verdict** — Highest-value fix in Part B.

**Concrete fix** — Float it, caption it, label it, point the express lane at it: see item A6 for the exact caption text. Additionally consider splitting column 3 into "cost" and "who pays", or renaming the header to "What it costs, and to whom".

---

## Part C — New figures/examples proposed

### C1 — A dichotomy regime diagram for Part I (the missing half of Rail B)

**Where** — §4 `sec:thm-detect`, immediately after the box (paper6.tex L177), before the "Read together…" paragraph.
**What it would show** — A single horizontal expressiveness axis with the fragment built up feature by feature: `ground facts + definite Horn` → `+ integrity constraints ($\bot$ heads)` → `+ ground deontic tokens` → `+ exclusive interval claims` → `+ difference constraints` → **|** → `+ disjunctive obligations under discharge choice`. Everything left of the bar shaded green and annotated with the algorithm and the complexity term that buys it (Dowling–Gallier $O(H)$; sweep-line $O(T\log T)$; sweep-line $O(X\log X)$; Bellman–Ford $O(V(E{+}V))$); everything right of the bar shaded red and annotated "3-SAT reduction; NP-complete; no short witness". A second, parallel strip beneath labelled "authority consumed", reading `none — none — none — none — none — a chartered resolver`.
**Why it helps** — Rail B mandates a regime diagram for *the boundary*, and this paper has two boundaries but draws only the queueing one. Part I is half the paper, carries the theorem the express lane leads with, and currently has no figure of its own — it appears only as row 1 and row 2 of the relation map. This is also the picture that makes the abstract's four-term complexity bound self-explaining, because each term gets attached to the feature that generates it. It is the figure the "price list" metaphor (L182–183, L224–226) has been promising in prose since page one.
**Kind** — regime-diagram (plain `tikzpicture` with `regimebox` styles, no numeric axes, per `CONVENTION.md`).

### C2 — A four-row table: conflict kind × detector × complexity term × witness object

**Where** — §4, directly beneath the Theorem 1a box (or folded into it as a boxed sub-table).
**What it would show** —

| Conflict kind | Detector | Cost term | Witness returned |
|---|---|---|---|
| derivable $\bot$ | unit propagation (Dowling–Gallier) | $O(H)$ | the derivation chain |
| $\Ob$/$\Fb$ clash on overlapping scope+interval | keyed sweep-line | $O(T\log T)$ | the two fired rules + overlap interval |
| two exclusive claims overlapping | keyed sweep-line | $O(X\log X)$ | the two claims |
| unsatisfiable deadline system | Bellman–Ford (augmented graph) | $O(V(E{+}V))$ | the negative cycle |

**Why it helps** — This mapping currently exists only as one 8-line run-on sentence inside the box (L160–167), where the four detectors, four cost terms and four witness objects are listed in three *separate* sequences the reader must zip together by position — "The witnesses are, respectively: …". A reader who loses the thread cannot recover it. Tabulated, the theorem's two distinguishing claims (polynomial *and* witness-producing) become checkable at a glance, and the abstract's opaque `$O(H + T\log T + X\log X + V\!\cdot\!E)$` acquires four referents. It also makes item A4's renaming self-evidently right.
**Kind** — table.

### C3 — The witness, drawn: an interval timeline for the four-line policy

**Where** — §4 "Numbers by hand" (L194–205), beside the canonical-miss example.
**What it would show** — A small two-lane timeline over ticks 0–15. Lane 1: the derivation, `agent_deployed` → (Horn) `prod_access` → (deontic) fires $\Ob(\texttt{write\_prod},s,[0,10])$, drawn as a bar spanning 0–10. Lane 2: the standing $\Fb(\texttt{write\_prod},s,[5,15])$ as a bar spanning 5–15. The intersection $[5,10]$ hatched and labelled "the witness". A ghosted third lane showing what the propagation-free mutant sees: no directly stated pair, nothing to report.
**Why it helps** — "Witness-producing is a strictly stronger requirement than deciding" (L120–122) is the paper's most distinctive Part I claim, and nothing in the paper shows a witness. This is the one place the reader could *see* what the checker hands back and why a human can argue with it. It also makes the two-hop-vs-one-hop distinction — the mutation's whole point, and the "Now you try" exercise's answer — visual rather than traced by eye through four lines of monospace. Small: one hour of TikZ at most.
**Kind** — worked-numeric-example (rendered as a small timeline diagram).

### C4 — Panel C on `fig:regime`: saturation vs. divergence at $c=8$

**Where** — `figures/fig-paper6-regime.tex`, as a third minipage (or as an inset in Panel A).
**What it would show** — $g(\rho,8)$ against $\tilde g(\rho,8)$ on a log-y axis over $\rho \in [0,0.95]$, with a horizontal asymptote drawn at $r=8$ and the $\rho=0.9$ instance marked on both curves: $g=7.73$ vs $\tilde g=64$.
**Why it helps** — The paper's most quotable falsification number is "$\rho{=}0.9, c{=}8$: $g=7.73$ vs $\tilde g=64$" (L253) and the claim it supports — "the boundary *saturates* at the capacity ratio, never diverges" (L248) — is a statement about a *limit*, which is exactly the kind of claim a picture settles and prose does not. Panel A cannot show it: it is $c=2$ and clipped at $r=4$. A log axis makes an 8× discrepancy legible where a linear one cannot. This is also the panel that would persuade an operations reader that the replacement threshold matters in the regime they actually run in (busy pool, several generalists), rather than only near $\rho=0.1$.
**Kind** — regime-diagram (pgfplots, `ymode=log`).

### C5 — A worked "re-grade a role from telemetry" example

**Where** — end of §9, attached to the new Move-6 paragraph proposed in item A13.
**What it would show** — Three lines of arithmetic for one named role: metered $\lambda$, $\mu_s$, $\mu_g$, $c$ over a week → $\rho$ → $g_A(\rho,c)$ → measured $r$ → verdict, then the same for $\xi$, $\eta$ → $\xi/\eta$ vs $D^\star$ → verdict. Ending with the honest ledger sentence the paper already writes at L320–321.
**Why it helps** — The paper has three excellent "Now you try" fades, all of them *inside* the mathematics. None of them is the exercise the intended reader (the operations lead of L57) actually has to perform, which is "here is my telemetry, is my release-tag owner still worth it?". One short instance would convert the whole of Part II from a result into a procedure. Low cost: the reference instance at L298–301 is already computed and can be re-narrated as a role.
**Kind** — worked-numeric-example.

---

## Part D — Cross-reference notes

I skimmed `website-v2/public/whitepaper/harbor-economy.tex` (1653 lines) for the themes the pairing guessed at. **The pairing is mostly wrong, but not entirely — there are two real terminology collisions worth fixing, and no notation drift.**

What harbor-economy is actually about: a three-sided agent-labour market (labour, capital, insurance) settling on **one conserving bond ledger** via float-plan escrow, the unbuilt **keystone** of local non-forgeable identity, macaroon-style capability attenuation, and federation across mutually distrusting daemons. Its "ledger" is a value ledger with a conservation invariant, not paper 6's accepted-commitment set. Its "keystone and the tax" chapter is about identity forgery and commons fees. There is no deontic logic, no complexity result, no queueing model, no Erlang-C, no conflict detection anywhere in it — greps for `deontic|Horn|NP-complete|queue|utilis|Erlang|conflict-free` return four incidental hits total.

**Two collisions that are worth a sentence of disambiguation in paper 6, because the two documents are meant to be read by the same person:**

1. **"specialist".** harbor-economy L320, L427, L452, L892 uses *specialist* to mean a rentable agent asset — "Alice owns a well-reputed refactoring specialist agent, $a_2$", which she "can rent out". Paper 6 uses *specialist* for the single fast server in an $M/M/1$-vs-$M/M/c$ comparison, with skill premium $r=\mu_s/\mu_g$. These are not the same object and a reader crossing between the documents will assume they are — the harbour-economy sense (an asset with a reputation you rent) is very close to paper 6's sole-responsibility role, which makes the near-miss worse, not better. Cheapest fix: in paper 6 at L235, write "a *sole specialist server*" on first use and stay with "sole owner" thereafter, which the paper mostly already does.

2. **"authority".** harbor-economy L877–905 uses *authority* in the capability-token sense — "att (which may only *narrow* authority)", "authority only ever narrowed", i.e. a permission set carried by a credential. Paper 6's title question uses *authority* in the institutional sense: a mind with standing, judgment and a name (L56–57). Paper 6 is careful and internally consistent, but its title is literally "What Needs an Authority", and a reader arriving from harbor-economy will initially read it as "what needs a capability". One clause in paper 6's §1 would inoculate — e.g. at L57, after "a mind with standing, judgment, and a name": "*Authority* here means chartered discretion, not a capability token; the harbour-economy sense of an authority that credentials only ever narrow is a different object."

3. **One weak positive.** harbor-economy L664–666 does mention a "deontic layer [that] separately governs *permission* (what it *may* do)" as distinct from the jail's capability enforcement. That is the one sentence in the sibling that paper 6's Part I could actually be cited into, and vice versa — worth a forward-reference from the whitepaper if the two are ever cross-linked. Nothing needs to change in paper 6 for it.

No notation drift: harbor-economy's symbol set ($W,E,C$ ledger state; $C_A$ cards; $\mathrm{att}$; $k$, $d$ in its review-redundancy bound) does not overlap paper 6's, with the sole exception of $C$ — which is already paper 6's own worst internal collision (item A4) and needs fixing on internal grounds regardless.

---

## Summary

1. **The prior-art gap is the top-ranked item, because the program has already written this exact failure down.** `finding-prior-art.md`'s failure #4 — *"a paper cited deontic logic's philosophical origins and nothing from the computational side of the same field, where the complexity results live"* — describes paper 6 precisely: von Wright 1951 and Chisholm 1963, in a paper whose Part I contribution is a complexity result about deontic conflict. Failure #2 lands too: "regimentable" is used in italics as a definition with no citation, and it is a normative-MAS term of art (A11b) — the *same* unread literature generating two defects. Add to that a whole field's vocabulary never entered on the queueing side (OM calls the specialist-vs-pool question **server flexibility** / **skill-based routing**, none of which appears), a missing Dechter–Meiri–Pearl 1991 for the temporal dichotomy the paper explicitly invokes, and a possible mis-citation of Halfin–Whitt for a pooling-economies claim it does not make (F5). All 11 references are 1917–2000. Flagged as questions, not chased (A11, A11b, A11c).
2. **Theorem 3's boxed `iff` does not survive its own degenerate cases** (A1/F1) — wrong strictness at $\xi/\eta = D^\star$ (the infimum is not attained, so pooling still wins there), and no $\eta K < 1$ guard, without which the closed form goes negative and the stated criterion inverts to say pooling always dominates. Compounded by three different inequality conventions for one fact across the abstract, the express lane, the box and the summary table. The mechanical linter flagged exactly this line and asked exactly this question; the answer is no. Fix the box first, then propagate.
3. **Three more precision defects in Part I's foundations, plus two numbers to reconcile at source.** "Definite Horn rules … where the head may be $\bot$" is not a coherent object and undermines the least-model justification (A2/F2); the NP-complete definition omits hardness, i.e. the half the 3-SAT reduction supplies (A3); Bellman–Ford's `iff` needs its super-source, and the complexity term changes with it (A7/F3). Then: 149 propagation-only conflicts vs. 100 missed by the mutation, and a 1013-vs-885 census (A18/F4); and the 60-instance sign sweep may be algebraically entailed by the theorem it validates, i.e. structurally unable to fail (F7) — the paper's other three verification stacks are genuinely independent and should be described as the load-bearing ones.
4. **Two structural fixes that help the reader most per line changed**: move the queueing dictionary from L124–140 down to §6 where it is first used, 110 lines later (A5 — the skill's own detection cue is literally "a definition in §2 whose first use is in §5"), and float/caption/label the inventory table so the paper's central summary artifact can be referenced and read alone (A6/B4). Both are mechanical; neither requires a new idea. Also cheap and worth doing: fix the $C$/$c$ triple-booking (A4).
5. **Part I has no figure of its own** — half the paper, the theorem the express lane leads with, and the only Rail-B regime diagram in the document is the queueing one. C1 (the expressiveness→complexity strip), C2 (conflict kind × detector × cost term × witness, currently one un-zippable run-on sentence inside the box) and C3 (the witness drawn as an interval timeline) are the three highest-value additions, in that order. On the existing figures: both regime panels are well-chosen encodings with data I recomputed and confirmed ($g(0.1,2)$, $g(0.5,2)$, the crossing, $g(0.9,8)$, $C(2,0.1)$, $C(4,0.208)$, $K$, $D^\star$, $W_\infty(1.5D^\star)$ — all match), and the defects are framing: Panel A's shaded regions carry no text label and are separated only by hue (two named failure modes at once), and its truncated $y$-axis hides the saturate-vs-diverge contrast that is the whole reason the replacement threshold matters at high utilisation.

**What is already excellent and should not be touched:** the honest boundary (eight items, each naming a specific modelling choice as load-bearing — the best in the corpus, and items ix/x in A19 are additions, not corrections); the three "Now you try" fades with answers in parentheses, which are textbook Renkl/Atkinson; the recorded wrong turns priced in-line ($4.17$ vs $8.17$; $\tilde g$ falsified by the program's own sweep); the two preempted-misread paragraphs; and the uniform `[verified]`/`[internal, script, seed]` provenance tagging, which never once left me unable to tell which kind of number I was reading.
