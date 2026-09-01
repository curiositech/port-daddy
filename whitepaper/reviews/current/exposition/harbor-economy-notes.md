# Exposition + Figure Review: The Harbor Economy — A Three-Sided Market for Agent Labor, Settling on One Conserving Bond Ledger (harbor-economy.tex)

Chapter IV of VII of the Port Daddy Coordination Papers, 1,653 lines of LaTeX — the market/mechanism-design volume of the public-facing whitepaper series that popularizes the seven formal Harbor research papers for a smart-but-non-specialist reader. It argues the harbor is a three-sided market (labor / capital-rental / IP-licensing) settling on one conserving bond ledger, states the built-vs-designed-vs-vision status of every mechanism (float-plan escrow, cross-harbor capability transfer, federation, reputation), and carries five open reconciliations (the identity keystone gap, cross-currency valuation, Myerson–Satterthwaite budget balance, the grading-oracle folk-theorem hole, and the sheaf-gluing analogy) with unusual honesty. It is the heaviest chapter in the series by design — the reader's-map explicitly routes five different reader types through it — and it already implements most of the harbor-exposition house style (dramatized worked examples for every mechanism, `\keyidea`/`\pitfall` callouts, an honest-status appendix table, a reader's-map). The problems below cluster in two places: one `\subsection` that was dropped into Related Work without the seven-move treatment the rest of the paper gets, and three TikZ figures that break the paper's own single-typeface/single-accent-color rule.

**Tooling notes.** `skills/research-paper-submission/scripts/submission_lint.py` does not exist in the tree; only the compiled `__pycache__/submission_lint.cpython-311.pyc` survives (confirmed identical situation to the paper3 review). Ran it directly: `python3 skills/research-paper-submission/scripts/__pycache__/submission_lint.cpython-311.pyc whitepaper/source/harbor-economy.tex --figures-dir whitepaper/source/figures` → **0 errors, 1 warning, 9 claims-to-confirm**. `skills/research-paper-submission/references/figures-and-examples.md` also does not exist on disk (same tree gap); the Cleveland–McGill / greyscale-survival / caption-states-the-finding / worked-example-effect criteria below are applied from `harbor-exposition/references/style-template-v2.md` Rail B and `high-quality-latex-whitepaper/SKILL.md`'s seven cheap tells instead. No LaTeX toolchain exists in this environment; anything that needs an actual render is marked **[needs render]**.

**On the "Name the impossibilities" brief.** I grepped every `impossib*`/`cannot`/`never` occurrence (37 hits) and read each in context. This paper is unusually disciplined here and it is worth saying so up front rather than only in the summary: FLP is scoped to "asynchronous network with even one crash failure," Myerson–Satterthwaite is stated with its four named assumptions and immediately followed by "This theorem constrains such a slice; it does not by itself prove incentive compatibility," the HTLC/trustless-settlement remark explicitly says "does not prove impossibility because the asset and adjudication models differ," and the equivocation lower bound is stated conditionally ("If partitions are unbounded, no finite bond covers the worst case"). All 9 linter "claims to confirm" (the `unbounded`/`impossible`/`optimal`/`in every` hits) resolved as non-issues on inspection — every one is either a citation title, a correctly-hedged conditional, or a definitional statement, not a sweeping overclaim. This is a real strength of the chapter and I did not find a single unscoped "cannot" or "impossible" in the body prose.

---

## Part A — Text/exposition changes

### A1. "Mechanism 9" appears with no Mechanisms 1–8 anywhere in the document

**Location:** line 1378, `\subsection{Mechanism 9: The Adversarial Test Market and Purchased Assurance}\label{sec:adversarial-tests}`, inside `\section{Related work}` (line 1310).

**Issue:** Orphaned reference / broken numbering scheme (a house-style-adjacent defect: a smart-but-non-specialist reader will stop and hunt for "Mechanism 1" through "8"). `grep -n "Mechanism [0-9]"` over the whole file returns exactly one hit — this one. No section, table, or figure anywhere else in the paper uses "Mechanism N" numbering, so the "9" implies eight prior mechanisms that don't exist in this document (they may exist in an outline or a sibling chapter, but nothing here says so).

**Current text:**
> \subsection{Mechanism 9: The Adversarial Test Market and Purchased Assurance}\label{sec:adversarial-tests}
>
> Beyond labor and IP licensing, the Harbor Economy establishes an internal market for \textbf{adversarial test generation}, formalizing PR verification as an interactive proof system (delegated computation~\cite{goldwasser2008} and multi-agent debate~\cite{irving2018}).

**Proposed rewrite:**
> \subsection{A fourth mechanism: the adversarial test market and purchased assurance}\label{sec:adversarial-tests}
>
> Beyond labor, capital, and IP licensing, the harbor supports one more internal market: \textbf{adversarial test generation}. Independent test-writing agents compete to find flaws in a proposed diff before it settles, formalizing PR verification as an interactive proof system (delegated computation~\cite{goldwasser2008}: a prover convinces a resource-bounded verifier without the verifier redoing the work; multi-agent debate~\cite{irving2018}: two adversarial reasoners are more legible to a judge than one cooperative one).

Drop the "Mechanism 9" numbering entirely (there is no established numbering to be the ninth entry in); if a numbering across the whole series is wanted, it needs to be introduced once, early, and reused consistently — not invented in Related Work.

**Priority:** high.

### A2. That same theorem carries no maturity tag, breaking the paper's own explicit promise

**Location:** lines 1382–1388 (Theorem `thm:assurance`, "Purchased Assurance Bound").

**Issue:** *Boundary burial* / broken house promise. The maturity-key box the paper opens with (lines 246–267) states as a hard rule: "Every claim in this paper carries one of four maturity labels, so the reader always knows whether a sentence reports running code or a designed target." Every other theorem, protocol, and property in the paper is tagged `\Built{}`, `\BuiltWeak{}`, `\Designed{}`, or `\Vision{}` — Theorem `thm:functor` is `\Designed{}`, Property `thm:lax` is `\Open{}`, Theorem `thm:ms` states its own conditionality in prose. The Purchased Assurance Bound has none of that: no tag, no "not yet implemented," no pointer to Appendix~\ref{app:impl}. It is also the *only* mechanism in the paper absent from Table~\ref{tab:honest-state} (the per-claim maturity ledger) — I checked all 21 rows of that table against the paper's mechanisms and this is the one gap.

**Current text** (end of the theorem, line 1387–1388):
> The operator's assurance level $1 - (1-d)^k$ is thus a purchasable commodity priced at $k \cdot (\text{bounty} + \text{bond carry})$, making ``hosted trust as a service'' a quantifiable line item.

**Proposed rewrite:**
> The operator's assurance level $1 - (1-d)^k$ is thus a purchasable commodity priced at $k \cdot (\text{bounty} + \text{bond carry})$, making ``hosted trust as a service'' a quantifiable line item. (\Vision{}: the mutation-testing oracle and the bounty-per-killed-mutant contract are specified here for the first time in this series; neither ships, and neither appears yet in the reference implementation's ledger module. Added to Table~\ref{tab:honest-state}.)

And add a row to Table~\ref{tab:honest-state} (after the "Skill licensing" row, line 1491): `Adversarial test market (Purchased Assurance Bound) & \Vision{} & no mutation-testing oracle or bounty contract shipped \\`

**Priority:** high.

### A3. Two symbols in the Becker condition (ρ, B, G) are used but never defined

**Location:** line 1387, "...satisfying the Becker condition $\rho d B > G$."

**Issue:** *Definitions-in-reverse* — a symbol used with no definition at point of use, violating the paper's own notation discipline (every other formula in the document glosses each variable at first use: e.g. Definition~\ref{def:float-plan} defines *task, criteria, budget, bounty* before using them; the grading-oracle section defines $d$ and $k$ in the sentence immediately before using them). Here, $d$ and $k$ are defined ("detection probability $d$", "$k$ independent... agents"), but $\rho$, $B$, and $G$ appear for the first and only time inside the inequality with no antecedent. A reader who doesn't already know the Becker deterrence condition from criminology/law-and-economics (probability of detection × penalty > gain) cannot recover what's being asserted.

**Current text:**
> Truthful effort is a strictly dominant strategy for test-writers under a bounty-per-killed-mutant and slash-per-false-alarm contract satisfying the Becker condition $\rho d B > G$.

**Proposed rewrite:**
> Truthful effort is a strictly dominant strategy for test-writers under a bounty-per-killed-mutant and slash-per-false-alarm contract satisfying the \textbf{Becker condition} (\textbf{Becker}~1968, the general deterrence inequality: expected punishment must exceed the gain from cheating): $\rho d B > G$, where $\rho$ is the probability a false alarm is caught on re-audit, $B$ is the slashed bond on a caught false alarm, and $G$ is what a test-writer gains by reporting a fake flaw (or suppressing a real one) instead of working honestly.

(This also needs a `\cite{becker1968}` entry in the bibliography — see A9.)

**Priority:** high.

### A4. Mechanism 9 is the only mechanism in the paper with no scene, no dramatization, and no honest-boundary paragraph

**Location:** §Mechanism 9 as a whole, lines 1378–1390.

**Issue:** *One path for all readers* / inconsistent apparatus. Every other mechanism in the document gets the full treatment: a scene, a dramatized numeric worked example with Bob/Alice/Carol/Judy, a `\keyidea` or `\pitfall`, and (where relevant) an honest-boundary sentence. Compare §Float-plan's "A settlement, dramatized" (lines 617–624, with actual numbers) or §Reputation's "A captured judge, dramatized" (lines 1132–1143). Mechanism 9 jumps straight from one sentence of framing into a boxed theorem with no scene and no worked instance — it fails the novice test (a smart outsider cannot restate what a "critical flaw surviving $k$ reviewers" means in practice) and it never says what happens when it's wrong (no `\pitfall` on, e.g., correlated flaws breaking the independence assumption `d` needs).

**Current text:** (as quoted in A1 — one sentence of setup, then straight into the theorem.)

**Proposed rewrite:** add, before the theorem, a two-to-three-sentence dramatization in the paper's own voice, e.g.:
> \paragraph{The adversarial test market, dramatized.} Bob's float plan ships a diff Alice's specialist wrote. Instead of trusting Alice's own test run, Bob posts a $30$\,\textsc{cr} bounty per confirmed flaw and opens the diff to $k=3$ independent test-writing agents, each paid only for a mutant it actually kills. If each independently catches a real defect with probability $d=0.6$, the chance a planted flaw survives all three is $(1-0.6)^3 = 0.064$ --- Bob is buying down defect risk from $1$ to about $6\%$ for $3 \times 30 = 90$\,\textsc{cr}, a number he can compare against the cost of the bug reaching production.

And close with a `\pitfall{}` naming the independence assumption's failure mode (test-writers copying each other's approach, or all three trained on the same blind spot, breaks the $(1-d)^k$ bound).

**Priority:** medium.

### A5. The abstract has no scene and opens with six reconciliations before a single concrete referent

**Location:** lines 193–227, `\begin{abstract}`.

**Issue:** *Definitions First*, applied to the highest-traffic paragraph in the document. The abstract is the one place every reader — including the "founder asking what is the product" persona the reader's-map names first — will read. It currently opens "The first three chapters build a harbor for a single operator..." (good, that's a scene) but by sentence four is already inside "float-plan escrow," "cross-harbor capability-transfer ceremony," "non-bypassable, recipient-whitelisted custody," and "revocation gossip with an expected convergence result under a connected, reliable-round model" — five pieces of jargon in one sentence, none of them glossed, before the reader has met Alice, Bob, or a single credit amount. The rest of the series (per the reading-time note at line 235) budgets 12 minutes just for the thesis; the abstract should be readable by the founder persona in one pass, and right now it reads like a paper abstract, not a whitepaper abstract.

**Current text** (the sentence that turns the corner, line 202–206):
> We present the \textbf{cross-harbor capability-transfer ceremony} and the federation that lets fleets on machines you do not own trade without a shared chain: a witness log, an escrow whose extraction bound is conditional on non-bypassable, recipient-whitelisted custody, and revocation gossip with an expected convergence result under a connected, reliable-round model.

**Proposed rewrite:**
> We present the \textbf{cross-harbor capability-transfer ceremony}: a way for Alice's harbor to hand Bob's harbor a narrowed, time-boxed authorization for one of Alice's agents, so the two harbors can trade without sharing a chain or a root of trust. The mechanics --- a public log both sides can audit, an escrow that can only pay out to a named recipient, and a gossip protocol that spreads a revocation in expected logarithmic time --- are stated formally in \S\ref{sec:federation}, with their conditions named rather than assumed.

This keeps every technical noun but attaches each to what it's *for* before naming it, and defers the "conditional on... reliable-round model" precision to the body where it belongs (it's exactly the kind of precision the "Name the impossibilities" theme wants, just not in the abstract's first pass).

**Priority:** high.

### A6. Table~\ref{tab:readers-map}'s caption is six words and states no finding

**Location:** line 286, `\caption{Where to enter, by who you are.}` (also flagged by the mechanical linter: `harbor-economy.tex:283: table caption is under 8 words`).

**Issue:** Fails the Mensh–Kording caption rule (a caption should let the table be understood without re-reading the surrounding prose). Every other caption in the document states what the reader should take away, not just what the object is (compare Table~\ref{tab:settlement}'s caption, which names the Goodhart-resistant discipline). This one just names the table.

**Current text:**
> \caption{Where to enter, by who you are.}

**Proposed rewrite:**
> \caption{Where to enter, by who you are. Five reader types, each routed to the section that answers their question and the one figure or theorem that would need to survive a review from someone in that role --- so no one has to read the paper end to end to get their answer.}

**Priority:** medium.

### A7. "Grim-trigger" and the discount factor δ are used in an exercise but never introduced in the prose that precedes it

**Location:** §Cartels and wash-trading, lines 1222–1247; the term first appears at line 1239 (`\item Use Figure~\ref{fig:cartel-game-inline} to identify the grim-trigger condition...`) and `\delta` at line 1241, with zero occurrences of either term anywhere earlier in the document (`grep -n -i "grim.trigger"` → one hit, the exercise itself).

**Issue:** *Definitions First inverted* — the opposite failure from the usual anti-pattern: instead of front-loading a definition nobody needs yet, the paper skips the definition entirely and expects the reader to reconstruct "grim-trigger" and "discount factor" from the figure's node labels (`collude`/`defect`, `$\pi_C$`/`$\pi_D$`) and from outside game-theory knowledge. The body paragraph above it (lines 1226–1234) talks about cartels and wash-trading in plain language but never once uses the phrase the exercise then tests.

**Current text** (the paragraph the exercise follows, in full):
> Multi-homing plus portable reputation enables cross-harbor \emph{cartels} (a rating cartel is the closest real-world analogue to ``the harbor's universities and rating agencies''). And a colluding requester$+$worker can \emph{wash-trade} fake settled outcomes to mint reputation cheaply. The defense form --- cost-per-settled-outcome must exceed reputation's marginal value --- is circular as stated, because that marginal value is endogenous to the same market. The fix is a structural break: make settled outcomes between a counterparty \emph{pair} exhibit sharply diminishing reputation returns (a concavity that caps the wash-trade payoff regardless of price), plus sampled adversarial re-audit of high-velocity pairs.

**Proposed rewrite** (append one sentence, and gloss the term at first use):
> ...plus sampled adversarial re-audit of high-velocity pairs. Whether a cartel of colluding operators can hold its rating floor is a repeated game: each round a member either \emph{colludes} (holds the agreed floor $q_{\mathrm{floor}}$) or \emph{defects} (undercuts it for a one-time gain, then the cartel unravels). A \textbf{grim-trigger} strategy --- cooperate until the first observed defection, then defect forever --- sustains the cartel only while members value future colluding payoffs enough, i.e.\ while their discount factor $\delta$ (the weight put on next round relative to this one) clears the threshold Figure~\ref{fig:cartel-game-inline} derives.

**Priority:** high.

### A8. "The same trade, run three ways" buries three hand-checkable numbers inside one dense paragraph

**Location:** lines 443–463, the running Bob/Alice/Carol example under §Three sides.

**Issue:** Not wrong, but under-formatted relative to the "numbers by hand" move it's performing. The paragraph is doing real work (grounding C1's abstract "three incentive constraints" claim in one concrete $1{,}200$-line-module trade, run three ways with real credit amounts: 400/60×3, 90, 0.5-per-file), but it's one unbroken block of prose, so a reader skimming for "what does side 2 cost" has to re-parse the whole paragraph. This is exactly the kind of number the house style's Move 5 ("numbers by hand ... verifiable on one line") wants set off, not embedded.

**Current text** (excerpt, the side-1 sentence):
> \emph{Side~1 (labor).} Bob posts a float plan with a $400$\,\textsc{cr} bounty; Alice takes it as a firm. She dispatches three of her own agents, posts a $60$\,\textsc{cr} sub-bond per agent ($180$\,\textsc{cr} total), and keeps $400 - (\text{slashed sub-bonds}) - \text{fee}$.

**Proposed rewrite:** keep the prose paragraph for the "who is privately informed" argument (that's genuinely narrative and shouldn't be tabularized), but pull the three price points into a compact three-row table immediately after it:

```latex
\begin{center}\small
\begin{tabular}{@{}l l l@{}}
\toprule
\textbf{Side} & \textbf{Bob pays} & \textbf{Who is exposed} \\
\midrule
1. Labor (hire Alice's firm)   & 400\,\textsc{cr} bounty          & Alice (her sub-bonds) \\
2. Capital (rent $a_2$ direct) & 90\,\textsc{cr} for the afternoon & Alice (reputation only) \\
3. IP (license Carol's skill)  & 0.5\,\textsc{cr} / file, metered  & Carol (unpaid if red) \\
\bottomrule
\end{tabular}
\end{center}
```

**Priority:** medium.

### A9. Two bibitems use `\newblock` formatting; the other 27 don't

**Location:** lines 1643–1649, `\bibitem{goldwasser2008}` and `\bibitem{irving2018}`.

**Issue:** Small but real typographic inconsistency — the "one style throughout" discipline the visual-craft skill asks of figures applies to the bibliography too. Every other entry (e.g. `\bibitem{rochet2003}`, line 1543) is a single run-on paragraph; these two use book-style `\newblock` line breaks, which will render with different spacing/line-breaking than their neighbors.

**Current text:**
> \bibitem{goldwasser2008} S. Goldwasser, Y. T. Kalai, and G. N. Rothblum.
> \newblock Delegating computation: Interactive proofs for Muggles.
> \newblock \textit{STOC}, pp. 613--622, 2008.

**Proposed rewrite:**
> \bibitem{goldwasser2008} S. Goldwasser, Y. Kalai \& G. Rothblum. ``Delegating Computation: Interactive Proofs for Muggles.'' \emph{STOC}, pp.~613--622, 2008.

(same fix for `irving2018`, matching the `\emph{Venue} volume(issue):pages, year` pattern used by every other entry.) Add `\bibitem{becker1968}` for the Becker condition cited in A3 while touching this block.

**Priority:** low.

### A10. The two "you don't sell crypto" pull-quotes risk reading as a copy-paste rather than a deliberate refrain

**Location:** lines 341–343 and 1184–1186.

**Issue:** Minor, and arguably intentional (C3's thesis restated to bookend the paper), but the two pull-quotes are close enough in wording ("You don't sell crypto --- crypto is the substrate...") that a reader who remembers the first will experience the second as a stutter rather than a callback, especially since pull-quotes are visually the loudest thing on the page (large italic, cobalt accent stripe) — repeating that treatment twice for near-identical text spends the device's scarcity. If the repetition is deliberate, it should be marked as one (e.g., "as \S\ref{sec:thesis} put it:" before the second instance) so it reads as a reprise, not a miss.

**Current text (second instance, line 1184):**
> \pullquote{You don't sell crypto --- crypto is the substrate. The defensible asset is attestation $+$ federation membership $+$ reputation, not the commoditized payment rail.}

**Proposed rewrite:**
> As \S\ref{sec:thesis} put it: \pullquote{You don't sell crypto --- crypto is the substrate. Here is what \emph{is} scarce: attestation $+$ federation membership $+$ reputation.}

**Priority:** low.

### A11. §Federation opens by pointing at "the impossibility landscape" before naming which impossibility

**Location:** lines 931–933, opening sentence of §Federation.

**Issue:** Minor clarity gap directly on the review's named theme. "Crucially, the federation design \emph{refuses consensus} here --- the correct reading of the impossibility landscape" makes a claim about "the impossibility landscape" one sentence before the `\keyidea` box actually names FLP. It's resolved within two sentences, so this is not a real ambiguity, but the fix is free.

**Current text:**
> Federation is where the leaderless distributed canon actually bites. Crucially, the federation design \emph{refuses consensus} here --- the correct reading of the impossibility landscape.

**Proposed rewrite:**
> Federation is where the leaderless distributed canon actually bites. Crucially, the federation design \emph{refuses consensus} rather than trying to route around Fischer--Lynch--Paterson --- the correct reading of the impossibility the next box states.

**Priority:** low.

---

## Part B — Existing figures/tables: clarity audit

All 13 `figures/fig-he-*.tex` / `fig-fh-*.tex` / `fig-auction-inline.tex` / `fig-cartel-game-inline.tex` files were read. Ten are genuinely strong and need no content change; three share the same visual-craft defect. [needs render] is noted throughout since no LaTeX toolchain is available to actually compile and look.

### B1–B3. Three figures use `\sffamily` and extra hues, breaking the paper's own one-typeface / one-accent rule

**Labels/locations:** `figures/fig-fh-threat-bands.tex` (line 16, `font=\sffamily\small`), `figures/fig-auction-inline.tex` (line 18, `font=\sffamily\small`), `figures/fig-cartel-game-inline.tex` (line 16, `font=\sffamily\small`). Referenced at lines 1047 (`fig:fh-threat-bands`), 1206 (`fig:auction-inline`), 1224 (`fig:cartel-game-inline`).

**What they currently show:** fh-threat-bands is a three-band regime diagram (Stopped/Bounded/Open, left-to-right = deeper into threat space); auction-inline is a side-by-side comparison of static escrow vs. competitive-Vickrey underwriting; cartel-game-inline is a repeated-game decision tree for the collude/defect choice.

**What the reader should take away:** fh-threat-bands: every claim in the federation layer sits in exactly one of three honesty bands. auction-inline: competitive underwriting removes the principal's idle-capital cost. cartel-game-inline: the cartel survives only above a discount-factor threshold that Prop.~\ref{prop:reserve}'s neighbor material derives.

**Will they get it?** All ten other figures in the document use the body serif (no `\sffamily` override) and a single cobalt accent against sand/paper fills, per the document's own preamble (line 43, `hhcobalt`, and the maturity-key box's own stated rule, line 51: "status by weight/small-caps, not a rainbow"). These three break both halves of that rule at once:
- **Font clash (cheap tell #2):** all three switch the whole figure to sans-serif against a serif body (`lmodern`). This is the single most recognizable "a script assembled this, not a press" signal the visual-craft skill names, and it's the one tell present here that is not present anywhere else in the 13 figures.
- **Rainbow status coding (cheap tell #3), and it directly contradicts the document's own stated philosophy:** fh-threat-bands fills its three bands `hhteal!30`/`hhamber!50`/`hhcobalt!40` — three hues carrying the status distinction, the exact "rainbow status key" pattern the paper's own maturity-key box (line 51) explicitly disclaims for its `\Built`/`\Designed`/`\Vision` labels ("differ by WEIGHT and SMALL-CAPS/italic, never by hue"). auction-inline uses `hhteal!40` for its Commons boxes and `hhamber!30` for its Escrow boxes in addition to the cobalt accent on the Vickrey label. cartel-game-inline uses `hhteal` for the "safe"/payoff outcome and `hhcobalt` for the "bad"/detected outcome — cobalt (the paper's *sole* accent, reserved everywhere else for "the one most important thing") is here doing double duty as a "bad outcome" color, diluting its meaning everywhere else it appears.
- Content-wise these are otherwise good figures (a real regime diagram, a real side-by-side mechanism comparison, a real decision tree with payoffs) — the fix is craft, not concept.

**Verdict:** needs fix (visual craft only; content is sound). [needs render] to confirm severity once compiled — the palette-mixing may be more or less jarring at actual print size than the source suggests.

**Concrete fix:** In all three files, delete the `font=\sffamily\small` (or `\sffamily\footnotesize`) from the top-level `tikzpicture` options so the figure inherits the body serif, matching every other figure in the set. Recolor: fh-threat-bands' three bands should be distinguished by weight/border-thickness/label small-caps (as the maturity key itself does) with at most the single cobalt accent on the band that most needs the reader's eye (probably "Open"); auction-inline should drop the teal/amber fills in favor of the paper's one `hhsand` fill for all boxes, reserving cobalt for the Vickrey second-price label only; cartel-game-inline should recolor "safe"/"detected" outcomes by weight or a filled-vs-outlined convention rather than hue, keeping cobalt only on the single node that most needs the reader's eye (probably the detected/slashed outcome, since it's the one the theorem below is about).

**Priority:** high (all three).

### B4. `fig-he-stack-map.tex` — the L0→L3 stack

**What it currently shows:** A four-rung vertical stack (daemon → coordination protocol → legibility/authority → economy/federation), each rung tagged with its maturity word and the chapter that builds it, with "this paper" flagged on the top rung.

**What the reader should take away:** This chapter is the top of a dependency ladder and consumes everything below it; the through-line (memory → checkpoint → continuity → person → reputation → market) is one arrow running up the whole stack.

**Will they get it?** Yes. This is exactly a relation-map per Rail B (base rungs, arrows for the mapped dependency, not just nouns), the caption states the finding rather than naming parts, and it reuses the document's one accent (cobalt border on the "this paper" rung) correctly — a single highlighted element, nothing else competing for attention. Text is body serif throughout.

**Verdict:** excellent, no changes needed. [needs render] only to confirm the `resizebox{0.92\textwidth}` doesn't crowd the long left-column "paper" labels against the rung boxes at actual page width.

### B5. `fig-he-three-sided.tex` — the three-sided market

**What it currently shows:** Three side-boxes (labor/capital/IP) converging into one escrow box, which feeds a settlement-oracle box below; each side is badged with what it keys reputation on.

**What the reader should take away:** the three sides are isomorphic at the escrow (one conservation object) and non-isomorphic at identity (three different reputation keys) — the paper's C1/C2 claim in one picture.

**Will they get it?** Yes — this is the paper's best figure. The caption explicitly states the finding ("non-isomorphic at the identity object... a decorative-analogy failure" if you drop the qualifier) rather than describing the boxes, which is exactly the Mensh–Kording rule. Color discipline is correct: cobalt only on the escrow (the single most important node) and the oracle-arrow; everything else is sand/paper.

**Verdict:** excellent, no changes needed.

### B6. `fig-he-float-plan.tex` — the escrow ceremony sequence diagram

**What it currently shows:** A three-lane (Requester/Daemon/Worker) sequence diagram for Protocol~\ref{prot:escrow}: sign FloatPlan → atomic debit-and-lock transaction → signed proof of escrow to the worker.

**What the reader should take away:** funds are locked before any work runs ("no-spawn-without-bond"), and the lock is one atomic database transaction, not a multi-step negotiable process.

**Will they get it?** Yes. Standard, legible sequence-diagram grammar, labels sit in clear bands above arrows (not on the lines — satisfies cheap tell #5), one accent (cobalt) on the message arrows and the atomic-transaction box. Caption states the finding (points at the conservation invariant and calls it "the one claim this paper can make at the highest maturity" — genuinely useful editorializing, not just description).

**Verdict:** excellent, no changes needed.

### B7. `fig-he-keystone-split.tex` — the two harbors and the gap between them

**What it currently shows:** Two harbor clusters (Alice's agents under her daemon-root, Bob's under his), with a cobalt-bordered "cross-operator attestation" box sitting explicitly in the gap between them, captioned with the exact unanswered question ("who vouches $b_i$'s keys map to a real distinct principal?").

**What the reader should take away:** the identity keystone that works *inside* one harbor does not reach *across* harbors — the missing primitive is drawn as a literal gap, not asserted in prose.

**Will they get it?** Yes, and this is a good instance of the relation-map genuinely doing work an paragraph couldn't: putting the unbuilt piece spatially between two built pieces is the single clearest way to make "the keystone doesn't reach the market" land. This is precisely the figure the review brief's "regime-diagram/relation-map" framing is asking for, already done well.

**Verdict:** excellent, no changes needed.

### B8. `fig-he-conservation-functor.tex` — native-unit vs. cross-currency

**What it currently shows:** Left panel: a composed trace $x \to y \to z$ in one unit with $\Delta(g \circ f) = \Delta(f) + \Delta(g)$; right panel: a valuation function $v_t$ converting between two units, captioned "no unit-free global sum exists."

**What the reader should take away:** conservation composes for free in one unit; crossing units requires an explicit valuation assumption that the paper has not supplied.

**Will they get it?** Yes — a real regime-diagram-adjacent figure (two conditions, sharply different guarantees), matched to Property~\ref{thm:lax}'s prose almost line for line. Colors and typeface are correctly disciplined.

**Verdict:** excellent, no changes needed.

### B9. `fig-he-grading-oracle.tex` — the folk-theorem's capturable evaluator

**What it currently shows:** agent → grading oracle → folk-theorem IC, with a "but the grade is produced by a capturable evaluator" box attacking the oracle node from above, and two fix boxes (Fix A machine-checkable, Fix B bond-and-slash) plus a "rate-the-raters must terminate" box below.

**What the reader should take away:** the folk theorem's public-signal assumption is exactly the thing that's fragile here, and there are two named, different repairs.

**Will they get it?** Yes. This is a genuine "attack on a chain" diagram (a pattern that reads well even in greyscale, since the arrows carry the logic, not the color), and the caption states the finding rather than the parts.

**Verdict:** excellent, no changes needed.

### B10. `fig-fh-xfer-ceremony.tex` — four-message capability transfer

**What it currently shows:** Four-lane sequence diagram (Alice's agent / Harbor A / Harbor B / Bob's agent) for Protocol~\ref{prot:xfer}, with two summary boxes below listing "invariants foreclosed" and "deferred properties."

**What the reader should take away:** no synchronous round-trip to Harbor A is needed after message 3; capability only ever narrows.

**Will they get it?** Yes — the two-column summary-box footer is a nice touch that a plain sequence diagram usually lacks (it does the "what this buys / what it doesn't" work inline). Consistent typeface and color with siblings B6/B10's sequence-diagram family.

**Verdict:** excellent, no changes needed.

### B11. `fig-fh-federation-topology.tex` — the four-element gestalt

**What it currently shows:** Witness log (top) over two sovereign harbors (middle) over a 2-of-3 multisig escrow (bottom), with solid cobalt arrows for the transfer ceremony and a dashed arrow for revocation gossip.

**What the reader should take away:** neither harbor is a root of authority for the other; the witness log and the escrow are the only two shared objects, and they're structurally different (append-only log vs. bounded custody).

**Will they get it?** Yes. Good use of the single accent to distinguish the "important" channel (capability transfer, solid cobalt) from the "background" channel (gossip, dashed grey) — this is exactly cheap-tell-#3-compliant status coding by weight/dash-pattern rather than hue.

**Verdict:** excellent, no changes needed.

### B12. `fig-fh-settlement.tex` — cross-harbor settlement / 2-of-3 escrow

**What it currently shows:** Alice/escrow/Bob at top, three numbered steps (bond posting, damage claim, oracle verification) below, terminating in an authority-invariant box plus Clear/Refuse outcome boxes.

**What the reader should take away:** the outcome space is exactly two states (Clear or Refuse), and the authority invariant (no bypass of whitelist/fee-cap/atomicity) is what keeps it that way.

**Will they get it?** Yes, cleanly laid out, consistent styling with its sequence-diagram siblings.

**Verdict:** excellent, no changes needed.

### B13. `fig-fh-revocation-gossip.tex` — three-harbor epoch timeline

**What it currently shows:** Three time columns ($t=0, \Delta, 2\Delta$), three harbor rows, each cell showing whether that harbor's filter has caught up to the revocation yet ("Stale" vs. "Synchronized"), with gossip arrows connecting the diagonal.

**What the reader should take away:** the revocation window is real and has a shape — Harbor C is still exposed at $t = \Delta$ even though Harbor B already isn't.

**Will they get it?** Yes — this is the strongest "regime diagram" in the set precisely because it's a timeline with a genuine before/after state per cell, and it pairs almost one-to-one with the "revocation race, dramatized" prose paragraph that follows it (lines 1014–1022). The "Stale" cells are marked by italic text, not color, so it survives greyscale.

**Verdict:** excellent, no changes needed.

### B14. Inline tables (not in `figures/`, but part of the same craft audit): `tab:readers-map`, `tab:settlement`, `tab:honest-state`, `tab:related`

`tab:readers-map` (line 283) — caption issue, see A6. `tab:settlement` (line 593) — good, caption states the Goodhart-resistant finding, not just the four rows. `tab:honest-state` (line 1458) — the single best piece of visual honesty-craft in the paper (21 rows, every claim graded, grounded in a named module or proof artifact) but is missing the Mechanism 9 row (see A2). `tab:related` (line 1392) — good, states what the harbor does differently in the third column rather than just naming the axis.

**Priority:** see individual items above (A2, A6); no new items here.

---

## Part C — New figures/examples proposed

### C1. A single worked numeric example that settles all three sides on one ledger at once

**Where:** end of §Three sides on one escrow (after line 687, before §The keystone), or as a boxed callout inside §Float-plan's settlement subsection.

**What it would show:** Right now the paper's flagship worked example ("the same trade, run three ways," lines 443–463) is genuinely good but runs the three sides *sequentially* — Bob buys the refactor as labor, *or* as capital, *or* as IP, three separate hypotheticals. The chapter's own thesis (C2: "all three sides settle on the *same* float plan escrowed in the same bond ledger") is never demonstrated with one concrete trade that uses all three sides *simultaneously* and shows the conservation identity closing across all of them at once. Given the chapter title theme "three sides, one ledger," this is the one number the paper promises and never actually shows worked.

Proposed numbers: Bob's refactor float plan bounties Alice's firm 400\,\textsc{cr} for the labor (side 1); Alice's firm additionally rents a second specialist agent from Dana for 50\,\textsc{cr} to speed up one module (side 2); the whole job licenses Carol's lint-and-type skill at 0.5\,\textsc{cr}/file × 20 files = 10\,\textsc{cr} (side 3). Settlement is Success. Walk the single conservation identity: $\Delta\text{Bob} = -460$, $\Delta\text{Alice} = +400\,(\text{bounty}) - 50\,(\text{lease}) = +350$ net of her own costs, $\Delta\text{Dana} = +50$, $\Delta\text{Carol} = +10$, and the ledger sums to $0$ across four wallets and three settlement buckets in one transaction — exactly the "one escrow object, three sides" claim, made hand-checkable.

**Why it helps:** this is the single highest-leverage addition the review found. It converts C2 from an assertion the reader has to trust ("all three sides settle on the same object") into an arithmetic fact the reader can re-derive, and it's exactly the "numbers by hand" move (Move 5) the house style prescribes but the paper currently only does per-side, never all-at-once.

**Kind:** worked-numeric-example (prose + a small table, in the style of the existing "settlement, dramatized" paragraph at lines 617–624, which is the right template to extend).

### C2. A regime diagram for the three-phase cold-start subsidy schedule

**Where:** §Cold start, after line 1199 (the Phase 1/2/3 paragraph), before the auction subsection.

**What it would show:** The text currently states three phases (seed supply at negative price → import external work history → flip to charging demand) gated by "a liquidity threshold (not a calendar date)," but there is no figure at all for §Cold start — it's the one major subsection in the labor-market half of the paper without a companion diagram. A regime diagram with the x-axis as "settled outcomes to date" (the liquidity proxy) and shaded bands for which phase the platform is in, plus a marked threshold where the subsidy flips sides, would make "not a calendar date" concrete instead of just asserted.

**Why it helps:** directly implements Rail B's mandate (every major claim gets a regime diagram showing where it holds) for a subsection that currently has none, and turns "liquidity threshold, not calendar date" from a slogan into something the reader can see is a slogan they could operationalize.

**Kind:** regime-diagram.

### C3. A small figure for the adversarial test market (Mechanism 9 / Theorem `thm:assurance`)

**Where:** immediately after the theorem, in §Mechanism 9 (see A1/A2/A4).

**What it would show:** every other formal mechanism in the paper (escrow ceremony, capability transfer, revocation gossip, grading oracle, settlement) gets a TikZ figure; this is the only theorem in the document with none. A simple diagram: one diff → $k$ independent test-writer nodes, each with detection probability $d$ → a converging "assurance level $1-(1-d)^k$" readout, with a small inset curve or three-point table showing how assurance climbs with $k$ (e.g. $k=1 \Rightarrow 60\%$, $k=3 \Rightarrow 93.6\%$, $k=5 \Rightarrow 99.0\%$ at $d=0.6$).

**Why it helps:** makes Mechanism 9 visually consistent with its siblings (closing the gap named in B1–B3's cousin issue, A4) and gives the reader the same "numbers by hand" grounding every other mechanism gets — right now the theorem's $(1-d)^k$ bound is asserted with no worked instance anywhere.

**Kind:** worked-numeric-example / small regime-diagram hybrid (a short table of $k$ vs. assurance level would suffice; doesn't need full TikZ machinery).

### C4. A compact "gaps → which promise it threatens" table for §Gaps

**Where:** §Gaps the design must still close (currently a flat six-item `\begin{enumerate}`, lines 1287–1306).

**What it would show:** Convert (or supplement) the flat list into a small table crossing each of the six gaps against which of the paper's own central promises it threatens (conservation, Sybil-resistance, incentive-compatibility, cross-boundary safety), in the same visual family as `tab:honest-state`.

**Why it helps:** the six gaps currently read as an undifferentiated list, but they're not equally dangerous — "operator exit / harbor death" threatens conservation directly, while "multi-dimensional reputation aggregation" threatens IC further downstream. A reader trying to prioritize (e.g. an implementer per the reader's-map) currently has to infer the stakes; a table would make triage possible at a glance.

**Kind:** table (relation-map in spirit: gap × threatened invariant, arrows-as-cells).

---

## Part D — Cross-reference notes

The pairing guessed by the task brief does not hold up. `whitepaper/research/tex/paper6.tex` ("What Needs an Authority: Mechanical Detection, Chartered Resolution, and the Exact Price of Sole Ownership") is about a completely different problem: which multi-agent coordination *functions* (conflict detection, sole-ownership of a role) genuinely require a designated authority, answered via a commitment-fragment complexity result ($\mathcal{L}_c$, polynomial detection vs. NP-complete one step outside the fragment) and an Erlang-C staffing-economics threshold for when a sole specialist beats a pooled swarm. A targeted grep for the harbor-economy vocabulary this chapter is built on (`ledger`, `escrow`, `float.plan`, `bond`, `reputation`, `attestation`, `principal`, `witness log`, `non-forgeable`, `keystone`, `conservation`) returns only two incidental hits in paper6.tex: `read_ledger` used once as a generic example commitment-scope identifier (line 203), and "ledger" used once in a queueing-cost accounting sense ("the honest ledger entry is...", line 320) — neither is the conserving bond ledger this chapter is about. paper6's "authority" is about *coordination-function* authority (who resolves a conflict, who owns a role); harbor-economy's "authority/ownership" is about *identity and settlement* authority (whose signing key is real, whose bond backs a trade). These are genuinely different papers in the series (paper6 looks like it maps instead to the Chapter II/kernel or Chapter I/legibility rung of Figure~\ref{fig:he-stack-map}, not Chapter IV). **Not actually related — skip.**

---

## Summary

1. **Highest-value fix:** Mechanism 9 (§Related work, lines 1378–1390) is structurally adrift — orphaned "9" numbering with no 1–8 anywhere in the document, no maturity tag despite the paper's explicit promise that every claim carries one, missing from the honest-state table, undefined symbols ($\rho$, $B$, $G$) in its own theorem, and the only mechanism in the paper with no scene/dramatization and no companion figure. This is one coherent story (A1, A2, A3, A4, C3) and the single highest-leverage place to spend editorial effort.
2. **Three figures break the paper's own visual-craft rules** (`fig-fh-threat-bands.tex`, `fig-auction-inline.tex`, `fig-cartel-game-inline.tex`): sans-serif text against the serif body, and status coded by hue (teal/amber/cobalt) rather than weight — the exact "rainbow status key" the document's own maturity-key box explicitly disclaims. Content is sound in all three; this is a one-line font fix plus a recolor per file (B1–B3).
3. **The abstract and Table~\ref{tab:readers-map}'s caption are denser than the rest of the paper's exposition**, which is otherwise unusually disciplined — the abstract crams five pieces of jargon into one sentence before any concrete referent (A5), and the readers-map caption is six words with no stated finding (A6, also mechanical-linter-flagged).
4. **The chapter never shows its own thesis worked all at once**: C2 claims all three market sides settle on one ledger, but the paper's worked example runs the three sides sequentially, never simultaneously in one settlement. A single combined worked numeric example (C1) is the most valuable new addition this review can propose, directly answering the task brief's question about whether a small three-sided settlement with real numbers would land the mechanism better.
5. **"Grim-trigger" and its discount factor $\delta$ are used in an exercise with zero prior definition anywhere in the body** (A7) — a genuine comprehension gap for the "smart-but-non-specialist" audience this series targets.
6. **On the explicit "Name the impossibilities" brief: this chapter is a genuine strength, not a risk.** All 37 impossible/cannot/never occurrences and all 9 linter claims-to-confirm were checked in context; every impossibility claim (FLP, Myerson–Satterthwaite, the equivocation lower bound, the trustless-settlement remark) is precisely scoped with its assumptions named and its conditionality stated in the same sentence or the next one. No unscoped sweeping claim was found.
7. **Ten of the thirteen TikZ figures are excellent as-is** (B4–B13) and need no content or craft changes — they are consistently the paper's strongest exposition, routinely stating the finding in the caption rather than describing the parts, and several (the keystone-split gap diagram, the revocation-gossip timeline) are genuinely good instances of the relation-map/regime-diagram grammar doing real explanatory work a paragraph couldn't.
