# Exposition + Figure Review: Continuity Without Metaphysics — Identity, Reputation, and the Body Problem for Software Agents

Paper 5 of the Harbor program (`whitepaper/research/tex/paper5.tex`, 456 lines, ~9 pages of body plus a 15-item bibliography). It is the corpus's *identity* volume: it takes the four ways an agent's body can change — forking/distillation, engine substitution, cross-provider resurrection, and fresh entry — and proves a conservation property at each door (Theorems 1, 2a/2b, 3, 4), explicitly refusing to answer the metaphysical question underneath any of them. It sits downstream of the program's non-forgeable-identity necessity theorem (whitepaper Def. III.6.1), upstream of the quorum layer, and it is the formal counterpart of the public whitepaper volume `whitepaper/source/spawn-to-person.tex`. Structurally it is the most disciplined paper in the corpus on the seven moves — every section has its one-breath line, its box, its "what it buys," and its honest boundary — and the weakest on Rail B: four figures across four results where the house grammar calls for eight, with §4 (resurrection) carrying zero. The recent corrections (γ≈0.5437, the Theorem 4 feasibility bound, the Theorem 2b pricing hypothesis) landed correctly *inside the boxes* but were not propagated to the abstract, the express lanes, the "New, honestly" list, or one figure caption — which is the single largest cluster of findings below.

Mechanical linter run (`submission_lint.py`, from the compiled module at `skills/research-paper-submission/scripts/__pycache__/`, since the skill's source tree is not present in this checkout): **0 errors, 0 warnings, 5 claims to confirm** — `uniquely` at lines 32 and 269, `optimal` at line 411, `for all` at line 309, `iff` ×2 at lines 165–166. Four of the five are genuine wording defects and are written up as A1 and A3 below. No LaTeX toolchain exists in this container; every claim about rendered geometry is marked **[needs render]**.

---

## Part A — Text/exposition changes

### A1. The Theorem 2b pricing hypothesis is honest in the box and dropped everywhere else
**Location** — Abstract, lines 28–31; §3 express lane, lines 151–153; §6, line 353; §7 "New, honestly", lines 407–409. (The box itself, lines 170–175, is correct.)

**Issue** — Overclaim by non-propagation. Theorem 2b was amended to flag its pricing condition as a hypothesis; the four places that *advertise* the theorem still state the conclusion unconditionally. A reader on the express lane (Rail A: "express lane + box alone must state the result completely and correctly") gets a strictly stronger claim than the box supports, which is the failure mode Rail A exists to prevent.

**Current text** (abstract, lines 28–31):
> (2) \emph{Engine substitution}: unattested, the price can never depend on the engine actually running, so swapping in a cheap engine always pays and Akerlof's death spiral runs \emph{inside one identity}; with attested engine ids the incentive flips to the planner's own efficiency rule at zero audit stake

**Current text** (§3 one-breath, lines 151–153):
> attest the engine on every witnessed outcome and the substitution incentive flips to the planner's own efficiency rule at zero audit stake

**Current text** (§7, lines 407–408):
> (2) the observation that engine attestation does not merely deter substitution but \emph{flips} its incentive to the planner's efficiency rule at zero audit stake

**Proposed rewrite** — add the hypothesis in six words at each site, in the same clause:

Abstract:
> (2) \emph{Engine substitution}: unattested, the price can never depend on the engine actually running, so swapping in a cheap engine always pays and Akerlof's death spiral runs \emph{inside one identity}; with attested engine ids the incentive flips to the planner's own efficiency rule at zero audit stake \emph{whenever the attested price schedule passes through the full quality difference} --- a hypothesis on the pricing regime, not a consequence of attestation, and we say where it fails.

§3 one-breath:
> attest the engine on every witnessed outcome and, provided the attested price schedule passes through the full quality difference, the substitution incentive flips to the planner's own efficiency rule at zero audit stake

§7:
> (2) the observation that engine attestation does not merely deter substitution but, under a stated pricing hypothesis, \emph{flips} its incentive to the planner's efficiency rule at zero audit stake --- with the Bertrand case, where the flip collapses, named

**Priority** — high.

---

### A2. Theorem 4's uniqueness is retracted in the box and still asserted in three other places
**Location** — Abstract, lines 31–33; §5 one-breath, lines 268–270; §7 "New, honestly", lines 410–411. (Box lines 292–302 correctly retracts it.)

**Issue** — Same anti-pattern as A1, and it is what the linter flagged twice (`uniquely` at 32, 269) plus once (`optimal` at 411). The box says in terms: "the \emph{uniqueness} claim and the closed form $H(g^\star)=G_{\max}$ do not [survive]." Three summaries still say "uniquely" / "unique optimal shape."

**Current text** (abstract, lines 31–33):
> (3) \emph{The probation cliff}: among all newcomer-restriction schedules with equal power to deter whitewashing, the maximally front-loaded one uniquely minimizes the tax on honest newcomers --- the ramp should be a cliff.

**Proposed rewrite**:
> (3) \emph{The probation cliff}: among all newcomer-restriction schedules with equal power to deter whitewashing, the maximally front-loaded \emph{feasible} one minimizes the tax on honest newcomers --- the ramp should be a cliff, of positive width when the newcomer's own ceiling caps how much a single period can hold back, and no shape at all is feasible once the fraud gain exceeds what that ceiling can carry.

**Current text** (§5 one-breath, lines 268–270):
> Among all newcomer-restriction schedules with equal power to deter a short-horizon whitewasher, the one that stacks the whole restriction at entry --- a cliff, not a ramp --- uniquely minimizes the tax on honest newcomers, because early restriction is the only kind the impatient type still feels

**Proposed rewrite**:
> Among all newcomer-restriction schedules with equal power to deter a short-horizon whitewasher, the most front-loaded one the newcomer's ceiling can carry --- a cliff, not a ramp --- minimizes the tax on honest newcomers, because early restriction is the only kind the impatient type still feels

**Current text** (§7, lines 410–411):
> the probation-cliff optimality result, which sharpens ``newcomers pay dues'' into ``the dues schedule has a unique optimal shape, and it is not a ramp.''

**Proposed rewrite**:
> the probation-cliff optimality result, which sharpens ``newcomers pay dues'' into ``the dues schedule has an optimal shape, it is front-loaded rather than a ramp, and it has a feasibility ceiling past which probation is the wrong instrument entirely.''

**Priority** — high.

---

### A3. The γ threshold is stated wrongly at line 105 and then repaired inside a parenthesis at line 128
**Location** — §2, line 105 (the wrong-turn paragraph) and lines 126–129 (Numbers by hand / the fade).

**Issue** — Boundary burial, plus a broken Move 5. The correction that "the threshold is $\gamma\approx0.5437$ for *this* chain, not $1/2$" is real and important, but it is delivered as an eight-line aside inside the parentheses of a "Now you try" answer, immediately after the prose has already told the reader the wrong thing. The fade move is specified as "one sentence of cost"; this one is a lecture, and it exists only to clean up a sentence three paragraphs earlier. Fix it at the source and the fade shrinks back to one line.

**Current text** (line 105):
> Budgets without debiting conserve nothing for $\gamma>\tfrac12$ (Figure~\ref{fig:r12reg}).

**Proposed rewrite**:
> Budgets without debiting conserve nothing: this three-hop chain already mints for every $\gamma>0.5437$, and for \emph{any} $\gamma>\tfrac12$ some chain of sufficient depth does, since $\sum_{d\ge1}\gamma^d=\gamma/(1-\gamma)>1$ there --- two hops suffice at $\gamma=0.9$, five at $\gamma=0.51$ [verified] (Figure~\ref{fig:r12reg}).

**Current text** (lines 126–129):
> \emph{Now you try:} at $\gamma=0.8$, does the same full-weight chain still mint under the budget-only phrasing? ($0.8+0.64+0.512=1.952>1$ --- yes. Note the threshold carefully: \emph{this three-hop chain} crosses $1$ at $\gamma\approx0.5437$, the root of $\gamma+\gamma^2+\gamma^3=1$, not at $\gamma=1/2$. What is true at $\gamma>1/2$ is that \emph{some} chain mints, since $\sum_{d\ge1}\gamma^d=\gamma/(1-\gamma)>1$ there --- the depth required grows as $\gamma$ falls, needing five hops at $\gamma=0.51$ and only two at $\gamma=0.9$; under transfer semantics the same chain's live total stays exactly $\le 1$ [verified].)

**Proposed rewrite**:
> \emph{Now you try:} at $\gamma=0.8$, does the same full-weight chain still mint under the budget-only phrasing? ($0.8+0.64+0.512=1.952>1$ --- yes; it keeps minting all the way down to $\gamma\approx0.5437$, the root of $\gamma+\gamma^2+\gamma^3=1$. Under transfer semantics the same chain's live total stays exactly $\le 1$ at every $\gamma$ [verified].)

**Priority** — high.

---

### A4. $W$ carries two different meanings inside one paper
**Location** — §2 box, lines 113–114 ("$W$ total witnessed value"); §3 box, lines 167–168 ("slashable stake $W$") and line 178 ("$W^\star=\Delta c/q=0.5$"); §6 line 356 relies on the §2 sense ("conserves the same witnessed total").

**Issue** — Violates the template's explicit notation rule ("One alphabet discipline per piece: don't reuse a letter for two roles"). It is worse than usual here because §6 composes the two theorems in one paragraph, so both senses of $W$ are live in the reader's head at the same moment. The sibling whitepaper compounds it: `spawn-to-person.tex` Thm. `whitewash-cost` uses $W$ for the whitewasher's forgone ability — a third role.

**Current text** (line 168):
> Deterring the swap without attestation requires an audited stake $qW\ge\Delta c$ (audit probability $q$, slashable stake $W$).

**Proposed rewrite** — rename the stake to $B$ (bond), which is also the letter the program's deterrence analogy already uses ($\rho dB \ge G$ in the speeding-ticket base):
> Deterring the swap without attestation requires an audited bond $qB\ge\Delta c$ (audit probability $q$, slashable bond $B$; $W$ is reserved throughout this paper for total witnessed value, \S\ref{sec:nomint}).

and at line 178, `$W^\star=\Delta c/q=0.5$` → `$B^\star=\Delta c/q=0.5$`.

**Priority** — high (cheap, and it removes a real reading hazard in §6).

---

### A5. `spend(p)` is introduced cold inside the box
**Location** — §2 box, lines 109–111; first prose use is the mismatched `value(source)` at line 103.

**Issue** — Definitions-first inversion, in miniature. The template requires each symbol be "introduced at point of use, bound to the concrete example." `\mathrm{spend}(p)` appears for the first time inside the formal Definition with no gloss, and the reader must reverse-engineer that it means node $p$'s *current live* creditable balance (not its lifetime grant, not its witnessed value) — which is exactly the distinction the whole theorem turns on. Meanwhile the Intuition paragraph above uses `value(source)`, a different word, for the refuted phrasing.

**Current text** (lines 109–111):
> \textbf{Definition (discount-and-split, transfer form).} A derivation with sources $S$, per-source grant fractions $w_p\in[0,1]$, and discount $\gamma\in(0,1]$ gives the child $\sum_{p\in S}\gamma\,w_p\,\mathrm{spend}(p)$ and \emph{debits} each source $w_p\,\mathrm{spend}(p)$.

**Proposed rewrite** — bind the symbol in the Intuition paragraph (insert after "Reputation inheritance must be a transfer" at line 98), then let the box refer back:
> Write $\mathrm{spend}(p)$ for the balance identity $p$ can still spend right now --- its \emph{live} creditable reputation, which starts at the witnessed value it earned and falls each time it endows a child. That is the quantity a transfer moves and a photocopier duplicates.

and in the box, line 109, `A derivation with sources $S$` → `A derivation with sources $S$, each holding live balance $\mathrm{spend}(p)$ (bound above),`.

**Priority** — medium.

---

### A6. The Parfit passage in §1 is the paper's one genuinely decorative analogy; §7's is not
**Location** — §1, lines 46–52; §7 "Imported", lines 360–368.

**Issue** — Uncalibrated analogy (Gentner structure-mapping), *in §1 only*. Applying the skill's detection test — "the analogy cannot survive one 'so does that mean…?' question" — the §1 passage fails it. It spends six lines establishing that Parfit dissolved personal identity rather than answering it, and the only thing transferred is a *stance* ("we also refuse the question"). Nothing about the ledger is predicted, constrained, or checked by the mapping; delete the Parfit sentences from §1 and no claim, theorem, or design decision in the paper changes. That is the definition of decorative.

The §7 passage, by contrast, is the strongest use of philosophy in the corpus and should be protected: it draws the mapping *and* the place it breaks. "Theorem 1 makes the inherited prior scarce, conserved and divisible precisely so that it \emph{must} split eight ways among eight forks. A reputation ledger is exactly the kind of thing Parfit argues psychological continuity is not" is a checked disanalogy — it identifies the structural property (scarcity under division) that separates base from target, and derives from that difference the reason the ledger version is enforceable where Parfit's is not. That earns its place; the problem is only that it sits 310 lines away from the passage that set the reader up for it, so the reader meets the decorative half first and the substantive half last.

**Current text** (§1, lines 46–52):
> Philosophy has owned that question for twenty-four centuries without producing a fact of the matter that a mechanism could safely depend on. The nearest thing to a resolution is itself a dissolution: Parfit's argument that in fission cases --- his teletransporter duplicating into two survivors is the ancestor of every fork case in this paper --- personal identity has no determinate answer and, more to the point, is not what matters for survival; what matters is the pattern of psychological continuity, which can hold, and matter, without any yes-or-no verdict on identity ever being reached \cite{parfit}. This paper takes the same exit for a different substrate, and gives it teeth a ledger can enforce where a stream of experience cannot: any mechanism whose safety depends on resolving the ship of Theseus is unbuildable.

**Proposed rewrite** — cut to the one sentence that does work, name the transferred *move* explicitly, name the place the mapping breaks, and forward-reference §7 so the two halves read as one argument:
> Philosophy has owned that question for twenty-four centuries without producing a fact of the matter that a mechanism could safely depend on. We borrow one thing from it: Parfit's \emph{move} --- in fission cases, his teletransporter duplicating into two survivors being the ancestor of every fork in this paper, the identity question is dissolved rather than answered, and what matters survives without any yes-or-no verdict ever being reached \cite{parfit}. We borrow it because it transfers structurally and not just rhetorically: what plays the role of ``what matters'' here is a ledger position, and the one relation that does \emph{not} carry over --- Parfit's insistence that fission leaves what matters undiminished --- is exactly what Theorem 1 must reverse, since a conserved prior has to split eight ways among eight forks (\S\ref{sec:related} works the correspondence through, row by row). The design rule it licenses is flat: any mechanism whose safety depends on resolving the ship of Theseus is unbuildable.

Note that this also repairs a broken colon in the original: "gives it teeth a ledger can enforce where a stream of experience cannot: any mechanism whose safety depends on resolving the ship of Theseus is unbuildable" promises an elaboration of *teeth* and delivers an impossibility claim instead.

**Priority** — high. Pair with figure proposal C4, which is what actually converts the analogy from asserted to checked.

---

### A7. §1's second paragraph is one 19-line block doing three jobs
**Location** — §1, lines 46–64.

**Issue** — One path for all readers. The paragraph runs: the Parfit refusal → the Def. III.6.1 necessity root → the four-door roadmap, with no paragraph break. The roadmap — the single most navigationally useful sentence in the paper — is buried at position 3 of 3 inside a wall.

**Proposed rewrite** — no wording change needed beyond A6; insert paragraph breaks before "The root the chain hangs from is the program's prior impossibility result" (line 54) and before "Forks and distillation ask what a child may inherit" (line 59). Three paragraphs: the refusal, the root, the roadmap.

**Priority** — medium.

---

### A8. Theorem 2a's "iff" mixes a definitional participation condition with an algebraic equivalence, and omits its degenerate case
**Location** — §3 box, lines 165–166. (Linter: `iff` ×2 at 165, 166.)

**Issue** — Wording. The linter's question — "both directions proved?" — has two different answers in one sentence and the sentence doesn't distinguish them. The second `$\iff$` is a genuine biconditional (dividing through by $\Delta\theta>0$). The first "iff" is not a proved biconditional at all; it is the model's *definition* of participation, and stating it as "iff" invites a reader to look for the proof. Separately, the sentence sits directly after "no belief supports pooling on $\theta_H$," which a careful reader will read as contradicting it — the resolution is that two populations are in play (strategic swappers, who always swap, and *committed* $\theta_H$ types, who cannot), and the box never says so. Finally the degenerate case is unstated: if $c_H>\theta_H$ then $\mu^\star>1$ and no share supports the strong engine at all.

**Current text** (lines 165–166):
> Committed $\theta_H$ sellers stay in the market iff the pooled price clears their cost: $\mu\theta_H+(1-\mu)\theta_L\ge c_H\iff \mu\ge\mu^\star=(c_H-\theta_L)/\Delta\theta$; below $\mu^\star$ the death spiral runs inside one identity down to $\theta_L$.

**Proposed rewrite**:
> Two populations are in play: strategic sellers, for whom the swap gain above is unconditional, and \emph{committed} $\theta_H$ sellers, who cannot swap and therefore participate exactly when the pooled price weakly clears their cost --- a participation condition, by definition of entry, not a derived one. Since $\Delta\theta>0$, that condition rearranges to a biconditional: $\mu\theta_H+(1-\mu)\theta_L\ge c_H\iff \mu\ge\mu^\star=(c_H-\theta_L)/\Delta\theta$. Below $\mu^\star$ the committed share falls, the pooled price falls with it, and the death spiral runs inside one identity down to $\theta_L$; if $c_H>\theta_H$ then $\mu^\star>1$ and no committed share supports the strong engine at any price.

**Priority** — medium.

---

### A9. Theorem 4's box has stopped being quotable
**Location** — §5 box, lines 283–311 (the theorem statement runs 283–303 before the Verification paragraph).

**Issue** — The template's Move 4 rule: "Written to be quoted in another document without edits." This box now contains, interleaved with the statement, three sentences of editorial commentary about the paper's own revision history and rhetorical stance: "That qualification is the theorem's missing hypothesis and it binds." / "The front-loading conclusion survives this unchanged; the \emph{uniqueness} claim and the closed form $H(g^\star)=G_{\max}$ do not." / "Underestimate $G_{\max}$ and no shape saves you; overestimate it relative to the ceiling and no shape saves you either." / "(The LP's optimum sits at this vertex for \emph{every} $\delta_f<\delta_h$ --- the corner is not a knife-edge.)" These are good sentences in the wrong container — they are commentary *about* the theorem, which is what the surrounding prose and the boundary block are for. As written the box cannot be lifted into a slide or a downstream paper without editing.

**Proposed rewrite** — keep in the box: the ratio argument, the exchange argument, the unconstrained optimum, the capped-optimum statement, the infeasibility bound, and the worked ceiling number. Move out to the paragraph that follows the box (or the boundary block):
> \noindent The qualification is not cosmetic and it changes what may be claimed: front-loading survives the cap unchanged, but \emph{uniqueness} and the closed form $H(g^\star)=G_{\max}$ do not, which is why this paper's summaries say ``the most front-loaded schedule the ceiling can carry'' rather than ``the cliff.'' The LP's optimum sits at that vertex for every $\delta_f<\delta_h$, so the corner is not a knife-edge --- and $G_{\max}$ cuts both ways: underestimate it and no shape deters, overestimate it relative to the ceiling and no shape is feasible.

**Priority** — medium.

---

### A10. An untagged number in a paper whose own §1 promises every number is tagged
**Location** — §5 box, line 299.

**Issue** — Provenance-policy violation. §1 lines 67–69 commit: "Every number carries a provenance tag." The feasibility ceiling `$8$` — the concrete payload of the newly added Theorem 4 bound — carries none. It is [verified]: $L/(1-0.6)\ge 20 \Rightarrow L\ge 8$, one line of arithmetic.

**Current text** (lines 298–300):
> at the worked instance ($\delta_f=0.60$, $G_{\max}=20$) any per-period ceiling below $8$ makes the fraud gain undeterrable by probation alone

**Proposed rewrite**:
> at the worked instance ($\delta_f=0.60$, $G_{\max}=20$) probation can destroy at most $L/0.4$, so any per-period ceiling below $L=8$ makes the fraud gain undeterrable by probation alone [verified]

**Priority** — medium.

---

### A11. §4 (resurrection) is missing Move 5 entirely
**Location** — §4, between the box (ends line 245) and "The wrong turn, reported" (line 247).

**Issue** — Missing move. Every other section has "Numbers by hand" plus a fade; §4 has neither. It is the section a reader is *least* able to self-test on, because its content is a three-clause checklist rather than an inequality, and the checklist is exactly the kind of thing the fade device is good at drilling.

**Proposed insertion** (after line 245):
> \textbf{Traces by hand.} Run the shortest crime for clause (i) yourself: a sanctioned identity migrates (step 1) and its successor is admitted without lineage verification (step 2) --- two steps, and the successor's accessible score now equals a clean newcomer's, which is precisely the Def.~III.6.1 failure the necessity theorem forbids. \emph{Now you try:} keep (i) and (iii), drop only (ii) --- what does the successor do on step 2, and which of the three named attacks is that? (It runs $\theta_L$ while collecting on the migrated $\theta_H$ price key: engine-history shedding, caught in 2 steps [internal, \texttt{b5\_engine\_substitution.py}].)

**Priority** — medium-high.

---

### A12. §5's foil leans on a source the paper admits it has not read
**Location** — §5, lines 278–281; §7, lines 400–402.

**Issue** — Underclaim risk / a structural weakness the honest disclosure at line 400 makes visible but does not fix. §5's rhetorical spine is "the folklore instinct is a gentle ramp; the instinct is wrong here." That instinct is sourced to Lazear at line 280, and §7 then concedes: "we have not been able to obtain Lazear's article, and if his contract front-loads the honest worker's implicit bond then Theorem 4 agrees with him rather than correcting him." The disclosure is exactly right and should stay. But the §5 framing should not depend on it — the folklore is real independently of whether Lazear is its source, and naming him at the point of attack makes the section's setup hostage to an unverified citation.

**Current text** (lines 279–281):
> and the folklore instinct, of the kind one might import from deferred-compensation wisdom \cite{lazear}, is a gentle ramp that eases the newcomer in. The instinct is wrong here, and the LP says so

**Proposed rewrite**:
> and the design instinct almost every onboarding system encodes --- a gentle ramp that eases the newcomer in, restrictions relaxing month by month --- is wrong here, and the LP says so. (Whether that instinct has a formal ancestor in the deferred-compensation literature \cite{lazear} is an open citation; see \S\ref{sec:related}.)

**Priority** — medium.

---

### A13. The four regime figures are all referenced from Move 5, never from Move 7
**Location** — line 105 (`fig:r12reg` cited in the wrong-turn paragraph), line 189 (`fig:r13reg` cited in Numbers by hand), line 315 (`fig:b6reg` cited in Numbers by hand); `\input` sites at lines 131–133, 193, 318.

**Issue** — Rail B placement. The house grammar assigns the relation-map to Move 3 and the regime diagram to Move 7 (the honest boundary), so that the boundary block has a picture of where the result stops holding. In paper 5 all three regime figures are pulled forward into the numeric-example move and none is referenced from the boundary block it was drawn for. The `fig-r12-regime` case is the clearest: it is a picture of the *failure region* and it is cited in a paragraph about a refuted phrasing, while the boundary block eleven lines later — which discusses precisely what conservation does and does not govern — has no figure at all.

**Proposed change** — move each `\input{fig-*-regime.tex}` to immediately *after* its section's `boundary` block, and add one cross-reference inside each boundary block. E.g. append to the §2 boundary (after line 146): "Figure~\ref{fig:r12reg} draws the line this boundary sits on: everything above the mint line is credit no witnessed outcome backs." Keep `fig-r12-relation.tex` where it is conceptually (Move 3) by moving its `\input` from line 131 up to just after line 99, where the analogy is actually made.

**Priority** — medium.

---

### A14. §6 is excellent and should not be touched
**Location** — §6, lines 336–356.

No issue. The one-breath at 338–339 ("not a soul but a ledger position: its witnessed evidence, counted once; its price keys, scoped to the engine that earned them; and its debts, scoped to the principal that owes them") is the best single sentence in the corpus, and the paragraph that follows does the hardest thing in the paper — composing four theorems into one claim — in nine lines without a symbol. The "eight forks are not the same agent or different agents, they are eight debit lines against one witnessed balance" reframing is what the whole paper was built to earn. Leave it alone.

---

## Part B — Existing figures/tables: clarity audit

Four figures and one unlabeled table. Per Rail B, four results should carry eight figures; §3 has no relation-map and §4 has nothing at all (see Part C).

### B1. Unlabeled overview table — §1, lines 71–86
**What it currently shows** — Four rows (fork/distill, engine swap, resurrection, fresh entry) × four columns (Event, Claim, Verification, Artifact), in a bare `center` environment.

**What the reader should take away** — That the paper's four results are four doors onto one problem, and that each is backed by a falsification sweep or a bounded model check with a named regenerating script.

**Will they get it?** — Partly. Cleveland-McGill is not engaged (it is a text table, correctly so — this is categorical lookup, the right form). But it fails the Mensh–Kording caption rule outright: it has *no caption at all*, no `\label`, no float, and no prose reference. It is a table the reader walks past. Greyscale: fine. Secondary problem: the "Verification" column mixes units without saying so — "4000 random DAGs; mutant caught", "$4000\times 8$ sweeps; 2000 spirals", "747-state machine; 4/4 mutants", "76,000 schedules, 0 dominate" are four different kinds of evidence, and a reader cannot tell that row 3 is a model check while rows 1, 2, 4 are sweeps. Third: `b5_engine_substitution.py` appears in two consecutive rows and reads as a copy-paste error.

**Verdict** — Keep, but promote it to a captioned table with a finding-stating caption and one added column.

**Concrete fix** — Wrap in `table`/`\caption`/`\label{tab:doors}`, reference it from line 63 ("Section \ref{sec:survives} composes the answers…" → "Table~\ref{tab:doors} is the map; \S\ref{sec:survives} composes the answers…"), split "Verification" into "Method" and "Scale", and caption it with the finding rather than the contents:

> \caption{Four doors through which continuity can be abused, and one conservation law behind each. No result rests on a general proof alone: two are falsification sweeps, one is a bounded model check, one is an exhaustive-shape search, and every count regenerates from the named script at seed 20260816. \texttt{b5\_engine\_substitution.py} carries rows 2 and 3 because Theorem 3's migration machine is built on Theorem 2's engine keys.}
> \label{tab:doors}

**[needs render]** for column-width after the split.

---

### B2. `fig:r12rel` — relation-map, Theorem 1 (`figures/fig-r12-relation.tex`, `\input` at line 131)
**What it currently shows** — Two rows, two columns: (bank transfer → fork inheritance, arrow "debit-on-send ⇔ split") over (photocopier → copy-full mutant, arrow "photocopy ⇔ quorum ×"), with an italic summary node beneath.

**What the reader should take away** — That the money analogy maps by *relations*, and that the relation that matters is debiting, not the size of the grant.

**Will they get it?** — Yes; this is the corpus's model relation-map. The arrows are labeled with relations, not nouns, exactly as the template demands. Greyscale survival: good — the two rows are separated by position and by bold text labels ("Bank Transfer" / "Photocopier", "= TRANSFER" / "8.2× quorum multiplication"), so the harborblue/shipred distinction is reinforcement rather than the only channel. Caption states the finding: yes.

**Verdict** — Keep, two small fixes.

**Concrete fix** —
1. The title node reads `R12 --- reputation you cannot photocopy` (line 19 of the fragment). "R12" is a research-ledger code that appears **nowhere in paper5.tex** (verified: zero occurrences of R12/R13/B6 in the source). A reader of Paper 5 meets an orphan identifier in the largest type on the figure. Change to `Theorem 1 --- reputation you cannot photocopy`. The same defect afflicts B4 below.
2. The italic node at fragment lines 47–48 is *verbatim identical* to the second sentence of the caption at lines 51–52. Drop the in-figure node; the caption already carries it, and the figure gets its vertical space back.

---

### B3. `fig:r12reg` — regime diagram, Theorem 1 (`figures/fig-r12-regime.tex`, `\input` at line 133)
**What it currently shows** — Total inherited credit along a depth-3 full-weight chain vs. discount γ: a rising red curve (copy semantics, $\sum\gamma^d$), a flat green line at 1 (transfer), a flat blue dashed line at 1 (witnessed value / "the mint line"), a shaded "minting" band above $y=1$, and the counterexample point marked at $(0.9, 2.439)$.

**What the reader should take away** — Budgets alone mint above a threshold; transfer conserves at every γ.

**Will they get it?** — Only partly, and one defect is serious.

- **Two legend entries, one visible line.** The transfer curve (fragment line 39: `coordinates {(0,1) (1,1)}`, seagreen solid) and the mint line (fragment line 41: `coordinates {(0,1) (1,1)}`, harborblue dashed) are plotted at *identical coordinates*. The dashed blue overprints the solid green, so the reader sees one dashed line and two legend entries and cannot match either. In greyscale it is unrecoverable. **[needs render]** to confirm draw order, but the coordinates are literally equal, so the collision is certain.
- **The shaded region does not encode a regime.** The `\fill` (fragment line 25) covers $y\in[1,3]$ across the *entire* γ range and is labeled "minting" — implying minting happens at all γ. The result's actual regime boundary is on the γ axis at $\gamma\approx0.5437$ (this depth) and $\gamma=1/2$ (depth limit). A reader trying to answer "for which γ does this fail?" from the figure has to read the curve against the line rather than read a shaded band, which is what a regime diagram exists to avoid.
- Cleveland-McGill: position along a common aligned scale, the top of the ranking. Correct choice. Caption states the finding and even carries the bracketing points — good.

**Verdict** — Keep, two structural fixes; this figure can be made to do the work that Part A item A3 currently does in prose.

**Concrete fix** —
1. Collapse the two coincident lines into one: delete the `harborblue,dashed` plot (fragment lines 41–42), make the seagreen line thicker, and give it the merged entry `\addlegendentry{transfer semantics = witnessed value = the mint line}`. Add a right-edge node `\node[anchor=west,font=\scriptsize] at (axis cs:1.01,1) {mint line};` so the identity is visible without the legend.
2. Re-shade on the γ axis: replace the full-width band with `\fill[shipred,opacity=0.08] (axis cs:0.5437,0) rectangle (axis cs:1,3);` plus a vertical rule `\draw[black,dotted,thick] (axis cs:0.5437,0) -- (axis cs:0.5437,3);` and a tick label at $\gamma=0.5437$. Move the "minting" label into that band. The figure then answers "for which γ?" directly, and the caption's bracketing sentence ("the plotted points $(0.5,0.875)$ and $(0.5833,1.1221)$ bracket the crossing") can be cut because the crossing is drawn.
3. Update the caption's second clause to say the shading is depth-3-specific and the $\gamma=1/2$ line is the depth limit — it currently says this in prose, which the new vertical rule makes checkable.

---

### B4. `fig:r13reg` — two-panel regime diagram, Theorem 2 (`figures/fig-r13-regime.tex`, `\input` at line 193)
**What it currently shows** — Panel A: pooled price vs. committed share μ, with $c_H=0.5$ dashed, $\mu^\star=1/6$ marked, red "death spiral" region left of it and green "sellers stay" right. Panel B: one-period swap gain vs. quality gap $\Delta\theta$ — flat red line at $\Delta c=0.3$ (unattested) and descending green line $\Delta c-\Delta\theta$ (attested), crossing zero at $\Delta\theta=0.3$.

**What the reader should take away** — Panel A: unattested, quality cannot survive below a committed share of 1/6. Panel B: attestation turns a constant positive swap incentive into one that changes sign exactly at social efficiency. Panel B is the paper's headline result.

**Will they get it?** — Panel A yes; **Panel B, no**. This is the worst figure in the paper and the fragment's own comments say why. From fragment lines 63–75 and 88–104: the panel's plotted width "measures out to roughly 2cm on the physical page", the legend was **deleted** after "four rounds of narrower/repositioned/smaller-font legend attempts each still collided", one annotation ("swap pays") was **deleted** after a fifth reposition attempt, and the remaining labels were cut to `\tiny`. The result is a 2cm-wide plot carrying the paper's central claim with **no legend and no line labels**, in which the only thing distinguishing "unattested" from "attested" is red vs. green. Greyscale survival: zero — the two lines become a flat grey line and a sloping grey line with nothing to say which is which. Cleveland-McGill: position on a common scale, correct in principle, defeated in practice by the width.

The diagnosis in the fragment's comments is right about the symptom and wrong about the remedy: the problem is not the legend, it is the `minipage{0.48\textwidth}` side-by-side layout. Five successive local patches were spent on a global layout defect.

**Verdict** — Rebuild the layout. Do not patch again.

**Concrete fix** —
1. Replace the two `minipage{0.48\textwidth}` blocks with two stacked full-width axes (`width=0.82\textwidth,height=5.4cm` each, separated by `\\[6pt]`), which is the layout `fig-r12-regime.tex` and `fig-b6-probation.tex` already use successfully. This resolves the legend, the tick crowding (fragment lines 22–26), and every annotation collision documented in the comments, at once.
2. With the width restored, replace the legend with **direct line labels**, which survive greyscale where a legend does not: `\node[shipred,font=\small,anchor=west] at (axis cs:0.62,0.33) {unattested: $\Delta c$};` and `\node[seagreen,font=\small,anchor=west] at (axis cs:0.62,-0.36) {attested: $\Delta c-\Delta\theta$};`. Restore the deleted "swap pays" / "strong engine pays" region labels in the shaded quadrants.
3. Panel A: add $\mu^\star$ to the axis — `xtick={0,0.1667,0.5,1}, xticklabels={0,$\tfrac16$,0.5,1}`. Currently the paper's most-quoted number in this section is a dot with no tick under it.
4. Panel A y-axis: `ylabel={price the pool clears}` should be `ylabel={pooled price $\mu\theta_H+(1-\mu)\theta_L$}` to match the box's own wording at line 166.
5. Panel B caption sentence should name the pricing hypothesis, per A1 — the panel plots $\Delta c-\Delta\theta$, which *is* the full-pass-through case, and the caption currently presents it as the attested case simpliciter.

**[needs render]** on all of the above.

---

### B5. `fig:b6reg` — regime diagram, Theorem 4 (`figures/fig-b6-probation.tex`, `\input` at line 318)
**What it currently shows** — Honest newcomer burden $H=G_{\max}(\delta_h/\delta_f)^t$ for a deterrence-tight schedule holding all gap mass at period $t$, log $y$-axis, $t=1\ldots9$ as a red line with markers and $t=0$ as a separate green dot at 20, with callouts for the cliff and for $t=5$ ($199.0$).

**What the reader should take away** — Every period of delay multiplies the honest tax by $\delta_h/\delta_f = 1.58$ while buying zero extra deterrence.

**Will they get it?** — Mostly yes, with one caption defect that is now a correctness problem.

- **The caption contradicts the amended theorem.** Fragment lines 41–43: "the cliff at $t=0$ is the **unique minimum**." Theorem 4 as revised (paper lines 292–297) explicitly retracts uniqueness once the per-period ceiling $L$ binds. The figure caption is a fifth un-propagated site for the A2 defect, and the worst kind, because captions are what readers quote.
- **Orphan code in the title**: `B6 --- the newcomer ramp is a cliff`. "B6" appears nowhere in paper5.tex. Same fix as B2.
- **The log axis under-sells the finding.** The paper's rhetorical payload is "ten times the honest tax." On a log scale a 10× gap is a modest vertical step; readers systematically under-read ratios on log axes (Cleveland-McGill: position on a common scale is best, but the *scale transform* is what carries the ratio, and it is unlabeled as such). The range 20→1250 (62×) does justify log; the fix is annotation, not a linear rebuild.
- **The new feasibility bound has no visual at all.** The figure plots only unconstrained single-mass schedules. The whole capped/bang-bang regime, and the infeasibility threshold $G_{\max}>L/(1-\delta_f)$, are invisible. See C5.
- Greyscale: survives — the two series differ in marker size and both carry text callouts with arrows. Good.

**Verdict** — Keep the plot; fix the caption, the title, and add a ratio annotation.

**Concrete fix** —
1. Caption → "Regime diagram for Theorem 4: honest burden of a deterrence-tight schedule holding its gap mass at period $t$ (log scale). Every step later multiplies the honest tax by $\delta_h/\delta_f=1.58$ while buying zero extra deterrence, so the burden is minimized by pushing mass as early as the newcomer's own ceiling permits --- at $t=0$ when the ceiling does not bind (Theorem 4), and across the first $k$ periods at the cap when it does [verified; regenerated by \texttt{paper5\_figures.py}]."
2. Title node → `Theorem 4 --- the newcomer ramp is a cliff ($\delta_h{=}0.95$, $\delta_f{=}0.60$, $G_{\max}{=}20$)`.
3. Add a bracketed ratio annotation between $t=0$ and $t=5$ making the 10× legible against the log distortion: a `\draw[<->,gray]` between $(0.4,20)$ and $(0.4,199)$ labeled `$10\times$`.

---

## Part C — New figures/examples proposed

Ranked by value. Items C1–C3 close the Rail B gaps (§3 has no relation-map, §4 has no figure at all); C4 is the fix that converts the Parfit analogy from asserted to checked; C5 visualizes the newly added feasibility bound.

### C1. The worked lineage DAG — §2, immediately after the relation-map
**Where** — `figures/fig-paper5-lineage.tex`, `\input` after line 99 (with the relation-map), replacing nothing.

**What it would show** — Two small DAGs side by side, same shape, different semantics, with every node's live balance printed on it and a running $\Phi$ total beneath.
- **Left (transfer semantics):** root episode $e$, witnessed value $1.0$. Three children $a_1,a_2,a_3$ derived at $w=1/3$, $\gamma=0.9$: each child shows $0.30$, the root drops to $0.00$, $\Phi = 0.90 \le W = 1$. Then one re-derivation edge $a_1\to a_4$ at $w=1$: $a_1\to 0.00$, $a_4 = 0.27$, $\Phi = 0.87$. Annotation on the cycle edge: "re-derivation draws on the artifact's already-debited balance, never the leaf's."
- **Right (copy-full mutant, the same shape):** every child shows $1.00$, the root stays at $1.00$, $\Phi = 5.00 \gg W = 1$. Beside it, the 8-way version collapsed to a single annotation: "$8.2\times$ at eight children."

**Why it helps** — This is the highest-value missing figure in the paper. Theorem 1's claim is about *DAG shapes* — chains, diamonds, merges, cycles — and the paper currently shows the reader zero DAGs. The relation-map (B2) explains why debiting matters; it does not show the reader a fork. Three specific things become visible that prose is currently carrying alone: (a) $\Phi$ is *nonincreasing under derivation*, which is a statement about a running total and is trivially readable off two columns of numbers and unreadable as a sentence about supermartingales; (b) the re-derivation cycle, which is the theorem's least intuitive clause and gets one sentence at line 116; (c) the $8.2\times$ exhibit, which is quoted four times in the paper (abstract, box, relation-map, §7) and never drawn. It also does the Move-5 job: these are hand-checkable numbers a reader can add up on the page, which is exactly the worked-example effect the template invokes.

**Kind** — relation-map / structural diagram carrying a worked numeric example. Plain `tikzpicture` with `relnode`/`relarrow` per CONVENTION.md (no numeric axes). Budget: comfortably inside the 2-hour rule; the arithmetic must be regenerated from `a6_no_mint.py` and tagged `[internal, script a6_no_mint.py]`.

---

### C2. The Akerlof relation-map — §3, at the "scene, resumed" paragraph
**Where** — `figures/fig-paper5-akerlof-relation.tex`, `\input` after line 160.

**What it would show** — Three columns in the house grammar: base (used-car market) | correspondence arrows | target (engine substitution), three rows plus a fourth row for the relation that does *not* map.
- Row 1: "buyer cannot inspect the car" → *asymmetry on the good itself* → "buyer cannot see which engine ran".
- Row 2: "price = expected quality over the seller pool" → *pooling price collapses to the mix* → "price = expected quality over the engine mix behind the name".
- Row 3: "good cars withdraw; mix worsens; price falls" → *the spiral* → "committed $\theta_H$ sellers exit below $\mu^\star=1/6$; the mix worsens down to $\theta_L$".
- Row 4, drawn in `shipred` as a **broken arrow**: "asymmetry is *across sellers* — you don't know which seller you drew" → ✗ → "asymmetry is *across time within one seller* — the record is real, and the lemon is wearing the plum's history".

**Why it helps** — §3 is the only result section whose analogy is explicit, essential, and undrawn, so this is a straight Rail B gap. More than that: the paper's own best sentence about this analogy (line 158, "the lemon is wearing the plum's history") describes a *disanalogy* — the twist that makes the case sharper than Akerlof's — and a relation-map is the one format that can show a mapping and its one broken arrow at the same time. Drawing the broken arrow is also what makes the §7 Grossman §2/§3 discussion (lines 370–388) land, because that discussion is precisely about which of Akerlof's hypotheses survive here.

**Kind** — relation-map, plain `tikzpicture`, matching `fig-r12-relation.tex`'s conventions (harborblue base, seagreen correct target, shipred failure/broken mapping).

---

### C3. The clause × attack table — §4, inside or immediately after the box
**Where** — `figures/fig-paper5-resurrection-clauses.tex`, `\input` after line 245.

**What it would show** — A four-column table-as-figure: *Clause dropped* | *Attack* | *Shortest trace* | *What the ledger loses*.

| dropped | attack | trace | the ledger loses |
|---|---|---|---|
| (i) lineage verification | whitewash-by-resurrection | 2 steps | a sanctioned identity re-enters at a clean newcomer's score |
| (ii) successor engine attestation | engine-history shedding | 2 steps | $\theta_L$ work is paid on the $\theta_H$ key; accessible score exceeds a clean twin's |
| (iii) commitments closed/escrowed | liability stranding | 2 steps | in-flight obligations attach to no principal |
| — (scope lemma: sanctions keyed per engine) | sibling-key escape | 1 step, no migration | a dishonest engine key is escaped by acting on the sibling key |
| none (intact protocol) | — | — | nothing: Def. III.6.1 holds in all 747 reachable states |

**Why it helps** — §4 currently has **zero** figures, which is the paper's largest Rail B hole, and its content is the one thing in the corpus that is naturally tabular: a checklist where each row is an attack. The prose version (lines 231–236) is a single 6-line sentence containing three clauses, three attack names, three trace lengths, and three mechanisms — a reader cannot hold it. The table also makes the scope lemma's asymmetry visible as a row, which is the paper's own "one lemma, two doors" point (line 251). Include the intact row: a failure-mode table that shows only failures reads as a list of caveats rather than a proof of coverage.

**Kind** — table (as a captioned float, per the figure convention — `booktabs`, no rules beyond `\toprule/\midrule/\bottomrule`, per the corpus's existing table style). Caption states the finding: "Each clause is essential: dropping any one admits a named attack whose shortest trace the model checker exhibits in two steps or fewer. The scope lemma's row needs no migration at all [internal, \texttt{b5\_engine\_substitution.py}]."

---

### C4. The Parfit correspondence — §7 "Imported", or §1 alongside A6
**Where** — `figures/fig-paper5-parfit-map.tex`, `\input` after line 368.

**What it would show** — Four rows in the same base | arrow | target grammar as C2, three mapping and one breaking:
- "fission: one person, two survivors" → *one source, many successors* → "one identity, eight forks".
- "identity has no determinate answer" → *the mechanism carries no identity predicate* → "no rule anywhere in Theorems 1–4 evaluates whether the fork *is* its ancestor".
- "what matters survives without the verdict" → *what matters is a conserved quantity* → "the ledger position: evidence counted once, price keys, sanction ledger".
- **Broken, in shipred:** "what matters is not diminished by division — each survivor has all of it" → ✗ → "the inherited prior *is* diminished by division — Theorem 1 requires it to split eight ways, and that is exactly what a stream of experience cannot do."

**Why it helps** — This is the direct answer to the review's central question. As it stands the Parfit material is asserted in two places 310 lines apart and never drawn, and the §1 half in particular passes no structure-mapping test (see A6). Rendering it as a relation-map applies the skill's own detection rule mechanically: if the arrows can be drawn and labeled with *relations*, the analogy is structural; if they cannot, it is decorative and should be cut. They can be drawn here — which is the finding — but only because the fourth row exists. A three-row version, all arrows intact, would be the decorative version. The broken row is what makes the figure worth the space, and it is also the paper's actual contribution to the philosophy: it names the property (scarcity under division) that separates a ledger from a stream and explains why only one of them can be enforced.

**Kind** — relation-map.

---

### C5. The feasibility panel — §5, as panel B beside the existing burden curve
**Where** — add a second axis to `figures/fig-b6-probation.tex`.

**What it would show** — The $(L, G_{\max})$ plane at $\delta_f=0.60$: the line $G_{\max} = L/(1-\delta_f) = 2.5L$ dividing the plane, with the region above it shaded `shipred` and labeled "no schedule shape deters — wrong instrument", the region below shaded `seagreen` and labeled "deterrable; optimum is a cliff of width $\lceil\cdot\rceil$", and the worked instance plotted as a point at $(8, 20)$ sitting exactly on the boundary, annotated "$L=8$ at $G_{\max}=20$: the ceiling below which probation cannot work [verified]".

**Why it helps** — The Theorem 4 feasibility bound is the paper's newest and most consequential correction — it converts "here is the optimal schedule" into "here is when there is no schedule" — and it is currently invisible: prose only, inside an already-overlong box (A9), with its key number untagged (A10). It is also textbook regime-diagram material by the template's own definition ("axes = the two parameters that most control validity; shaded = where the result holds"), and the existing §5 figure is not a regime diagram in that sense at all — it is a burden curve. Adding this panel gives §5 the boundary figure Rail B actually asks for, and gives the boundary block at lines 327–334 a picture to point at.

**Kind** — regime diagram (`pgfplots`, `harbor curve`).

---

## Part D — Cross-reference notes

`whitepaper/source/spawn-to-person.tex` (1,940 lines) is **strongly related** — it is the public-facing counterpart of this exact paper, not a loose thematic sibling. §"Continuity is a personal-identity problem" (line 627), §"The role / person distinction" (line 540), the no-mint status note (lines 693–712), and `thm:probation-dominance` (line 974) are the popular renderings of paper 5's §1, §2, and §5 respectively, down to the same $8.2\times$, the same 4,000-DAG sweep, the same 76,000 schedules, and the same seed 20260816. Four drifts, ranked:

**D1 (highest) — the sibling's probation theorem is now stale and overclaims.** `thm:probation-dominance` (lines 974–984) states the pure cliff $g_0=G_{\max}$, $g_{t>0}=0$ as *the* minimizer with no ceiling hypothesis, and its proof text asserts "moving holdback mass from period $t>0$ to period $0$ relaxes the deterrence constraint while strictly decreasing the honest cost." Paper 5's amended Theorem 4 adds exactly the hypothesis that breaks this: with a per-period cap $L$, the pure spike is infeasible whenever $G_{\max}>L$, and the whole programme is infeasible when $G_{\max}>L/(1-\delta_f)$. The sibling must inherit the qualification, and its status note (line 984) is the natural place. Note that this drift runs *toward* the sibling: paper 5 is now the corrected statement of a theorem the public volume still states in its refuted-uniqueness form.

**D2 — Parfit is used in two incompatible registers across the two documents.** The sibling *endorses* Parfit's positive thesis and builds on it: "Parfit's repair … is the version that survives, and it dictates the engineering" (line 658), and the pullquote at 664–667 makes the ledger *be* the Parfitian transitive chain ("reputation … can only attach to the transitive thing"). Paper 5's §7 says the opposite in terms: "We take Parfit's \emph{move} and not Parfit's \emph{thesis}" and "A reputation ledger is exactly the kind of thing Parfit argues psychological continuity is not" (lines 360, 367–368). Both are defensible — the sibling borrows *transitivity*, paper 5 rejects *indivisibility* — but nothing in either document tells the reader that, and a reader who reads both in either order will conclude one of them is wrong. Recommended: one shared sentence, stated identically in both (the corpus already has the "canonical seam sentence" device for exactly this, sibling line 793): *"We borrow Parfit's transitivity and his dissolution of the identity question; we do not borrow his claim that what matters is undiminished by division, because a conserved ledger must divide."*

**D3 — citation-key and edition drift on Parfit.** Sibling uses `\bibitem{parfit1984}` (Reasons and Persons). Paper 5 uses `\bibitem{parfit}` for the same 1984 book plus `\bibitem{parfit1971}` for the Philosophical Review article, and the 1971 article is where the direct quotation at lines 364–365 comes from. Trivial to fix, but the corpus should settle on `parfit1984`/`parfit1971` everywhere so a cross-volume bibliography merge does not silently drop one.

**D4 — notation drift on the probation schedule and on $W$.** (a) The sibling calls $g_t$ "earning holdbacks" and frames the instrument against the ceilings $\kappa_0$ / $\kappa^\star$ (lines 952–953); paper 5 calls the same object a "gap" by which the "economic ceiling is reduced" and introduces a fresh symbol $L$ for the per-period cap with no link back to $\kappa^\star$. Since $L$ *is* essentially $\kappa^\star-\kappa_0$-flavoured, paper 5 should say so in one clause, or the two documents describe the same schedule in two vocabularies. (b) $W$ is overloaded three ways across the pair: total witnessed value (paper 5 Thm 1), slashable stake (paper 5 Thm 2a), and the whitewasher's forgone ability (sibling `thm:whitewash-cost`, line 933ff). Item A4 fixes two of the three by renaming paper 5's stake to $B$; doing so also removes the collision with the sibling, since the sibling's $W$ then maps cleanly onto paper 5's $W$ only in the reputation sense.

---

## Summary

1. **The corrections landed in the boxes and not in the shop window.** Theorem 2b's pricing hypothesis and Theorem 4's retracted uniqueness are stated honestly where they were fixed and stated in their old, stronger, wrong form in the abstract, both express lanes, the "New, honestly" list, and the `fig:b6reg` caption — seven sites, all one-line fixes (A1, A2, B5). This is the highest-priority cluster: as it stands, a Rail-A reader who reads only the express lane and the box gets a claim the box does not support, which inverts the purpose of the express lane.
2. **§4 has no figure and §3 has no relation-map — the Rail B grammar is half-built.** Four results, four figures, where the house style calls for a relation-map and a regime diagram apiece. The three gaps are all cheap and all high-yield: the Akerlof relation-map with its one deliberately broken arrow (C2), the resurrection clause × attack table (C3), and the Theorem 4 feasibility panel (C5).
3. **The single most valuable missing figure is a worked lineage DAG (C1).** A paper whose central theorem is about fork/merge/cycle DAG shapes, and whose $8.2\times$ exhibit is quoted four times, currently draws zero DAGs. A two-column figure with live balances on the nodes and a running $\Phi$ under each column makes conservation, the re-derivation-cycle clause, and the copy-mutant's multiplication all readable at a glance.
4. **The Parfit contrast is decorative in §1 and essential in §7 — keep the second, cut the first to one sentence, and draw the correspondence.** §7's disanalogy ("Theorem 1 makes the inherited prior scarce, conserved and divisible precisely so that it *must* split eight ways") is the corpus's best piece of applied philosophy and passes structure-mapping. §1's six-line version transfers only a stance and would cost the paper nothing if deleted. A4/A6 plus the four-row correspondence map (C4) — three arrows that map, one that visibly breaks — converts the whole thread from asserted to checked.
5. **Two concrete graphical defects to fix before the next render**: `fig-r12-regime` plots the transfer line and the mint line at identical coordinates, giving two legend entries for one visible dashed line (invisible in greyscale, certain from the source, B3); and `fig-r13-regime` Panel B carries the paper's headline result in a ~2cm-wide plot whose legend and half its annotations were deleted to stop collisions — the fix is to abandon the side-by-side `minipage` layout for stacked full-width axes and use direct line labels, not a sixth round of legend patching (B4). Also cosmetic but reader-facing: two figures print internal ledger codes ("R12", "B6") as their on-page titles, and neither code appears anywhere in paper5.tex.
