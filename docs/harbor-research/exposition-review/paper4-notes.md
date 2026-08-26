# Exposition + Figure Review: The Sealed Harbor — Mutually Confidential Computation with Explicit, Gated, Bounded Releases

`docs/harbor-research/tex/paper4.tex`, 562 lines (~10–11 compiled pages), Paper 4 of the seven-paper Harbor program. It is the corpus's assurance-argument paper: it takes a concrete two-party standoff (Derek's data, Erin's agent), explains why the obvious product pitch ("silicon-enforced NDA", token-level taint) is unsound, presents a clean-room design (one work order, two fences, two gates), and then argues the design's safety as four independently verified pillars — noninterference modulo declassification (I), supervisory-control enforceability (II), ε-ledger conservation (III), canary/SPRT detection (IV) — before composing them into a single honest leakage account (q·b bits) and an unusually good "what cannot honestly be promised" section. It is the longest of the seven and the one carrying the most rhetorical load, because it is the paper that has to *retract* a shipped-sounding claim and replace it with a weaker true one. Recent edits (corollary rewritten as a Rogers et al. privacy filter, Theorem 1's committed-input hypothesis, the Pillar III honest-worker paragraph, Related Work rewritten against Ryoan) have all landed factually; what they have not yet done is re-settle the *exposition* around themselves, which is most of what follows.

**Mechanical linter result** (`submission_lint.py` via the compiled bytecode at `~/.claude/skills/research-paper-submission/scripts/__pycache__/submission_lint.cpython-311.pyc` — the `.py` source is absent from the repo, only the `.pyc` survives; Python 3.11 matched, so it ran):
`0 error(s), 0 warning(s), 8 claim(s) to confirm`. All eight are benign on inspection: three `unbounded` hits (192, 390, 447) are all correctly used in the *negative* sense ("the general theorem over unbounded state", "pretending to cover unbounded breach damage"); two `optimal` hits (358, 370) are both scoped ("optimal in the Wald–Wolfowitz sense"); the `iff`/`if and only if` pair (220, 234) is Theorem 2, whose degenerate case is *explicitly* handled ("$K=\emptyset$ is vacuously controllable but no supervisor realises it"), which is exactly what the linter asks for; and the `for all` at 454 is the lift section. Nothing to fold in as a defect. The paper's "impossible/exactly/never" surface is genuinely well hedged **with three exceptions the linter's word list does not reach** — items A1, A2 and A3 below. No LaTeX toolchain exists in this container; every claim below that depends on rendered geometry is marked **[needs render]**.

---

## Part A — Text/exposition changes

### A1. The voting-booth analogy overclaims exactly where its own figure caption is honest

- **Location**: §3 (Pillar I), lines 152–155.
- **Issue**: Uncalibrated analogy / overclaim. The style rule (Gentner structure-mapping) is that a reader should be able to derive *new true facts* about the target from the analogy. Here the reader derives a false one. The figure caption for this very analogy (`fig-r9-relation.tex`, line 74) already states the correct residual — "the analogy predicts, correctly, that the residual risk is a too-revealing tally --- a per-precinct board with one voter is a leaky $g$" — but the prose asserts the opposite.
- **Current text**:
  > The analogy with teeth is the voting booth: the turnstile clicks once per voter and the tally board shows only party totals; a poll-watcher outside learns exactly the declared aggregate and nothing about any ballot, \emph{no matter how long she watches or in what order voters arrive}.
- **Proposed rewrite**:
  > The analogy with teeth is the voting booth: the turnstile clicks once per voter and the tally board shows only party totals; a poll-watcher outside learns the declared aggregate and \emph{nothing beyond what that aggregate itself implies}, \emph{no matter how long she watches or in what order voters arrive}. The qualifier is load-bearing and the analogy is honest about it: a per-precinct board with a single voter discloses that voter's ballot exactly, and no property of the booth prevents it. That is the shape of this paper's residual too --- the room is sound; the tally may be indiscreet.
- **Priority**: **high**. This is the paper's central analogy, and the corrected version does more work than the original: it pre-loads the "$g$ may leak too much" residual that §3's misread line, §3's boundary block, and Pillars III–IV all depend on.

### A2. "Derek's data never leaves the room" contradicts the paper's own thesis

- **Location**: §5 (Pillar III), line 275.
- **Issue**: Overclaim by imprecision — and specifically the *kind* of imprecision the paper exists to eradicate. §8 states "``zero'' is available only at $b=0$"; §7 prices q·b bits of egress. A reader who has absorbed §1–§4 will trip on this sentence.
- **Current text**:
  > \textbf{The scene, resumed.} Derek's data never leaves the room; what leaves is a stream of gated releases, each carrying a differential-privacy cost $\varepsilon_i$.
- **Proposed rewrite**:
  > \textbf{The scene, resumed.} Derek's \emph{plaintext} never leaves the room; what leaves is a stream of gated releases derived from it, each carrying a differential-privacy cost $\varepsilon_i$ --- a privacy-loss parameter, where smaller means the release is harder to attribute to any one record in $D$. The contract says the total never exceeds $\varepsilon_{\max}$.
- **Priority**: **high**. The rewrite also discharges A6 (ε is never defined for a first-time reader) in the same stroke.

### A3. Token-level unsoundness is asserted as fact in §1 and called "a stated unsoundness result" in §10, with nothing in between

- **Location**: §1, lines 43–46; §10, lines 490–493.
- **Issue**: Underspecified provenance on the single most load-bearing premise in the paper. Whole-worker taint (§2), Theorem 2's consequence (§4), and the novelty claim (§10) all rest on it, and it is nowhere labelled as theorem / design invariant / model-checked property / empirical hypothesis — which is precisely the discipline line 111–112 announces ("the program's discipline is to label every important statement as theorem, design invariant, model-checked property, or empirical hypothesis, and never let one impersonate another").
- **Current text** (§1):
  > Token-level taint through an LLM is not soundly definable: the model taints everything it writes with everything it read, so a taint tracker faces a binary choice between marking every output token (useless) and missing semantic flows (unsound).
- **Proposed rewrite**:
  > Token-level taint through an LLM is not soundly definable, and we state this as a \emph{design premise} rather than a theorem, since it is the premise every later section leans on: the model taints everything it writes with everything it read, so a taint tracker faces a binary choice between marking every output token (useless) and missing semantic flows (unsound). We know of no sound token-granularity flow analysis for a generative model, and the burden of exhibiting one falls on any design that assumes it.
  And in §10, change "by a stated unsoundness result" to "by the stated unsoundness premise of \S\ref{sec:problem}".
- **Priority**: **high**.

### A4. Three incompatible naming schemes for the same four pillars

- **Location**: table at lines 117–126 ("NI modulo declassification / enforceable = controllable / ε-ledger conserves / canary power + SPRT clock"); composition paragraph at lines 132–137 ("Enforceability / Noninterference / Conservation / Detection"); section titles at 143/218/269/349 ("silence except through the slot / the channel, never the token / the budget is a ledger… / canaries with a power curve and a clock"); figure boxes in `fig-paper4-pillars.tex` lines 34/39/44/49 ("Mediation / Declassification gate / ε-ledger / Canary + SPRT"). Four schemes, actually.
- **Issue**: This is the direct answer to the brief's question *"is the four-pillar structure legible as a structure?"* — the architecture **is** argued and **is** drawn, but the pillars have no stable handle, so a reader cannot carry them across four pages. The evocative section titles are worth keeping; what is missing is a one-word name that appears in every surface.
- **Current text** (table header row and body, lines 117–126, plus line 132):
  > Pillar & Claim & Verification & Artifact \\
  > I (\S\ref{sec:p1}) & NI modulo declassification & exhaustive, depth 7; 2/2 mutations & …
- **Proposed rewrite**: adopt the §2 composition-paragraph names as canonical — **Noninterference (I)**, **Enforceability (II)**, **Conservation (III)**, **Detection (IV)** — and (a) add a `Name` column to the table so the row reads `I (\S3) & Noninterference & silence except through the slot & exhaustive, depth 7; 2/2 mutations & c1_noninterference.py`; (b) retitle each section as `\section{Pillar I --- Noninterference: silence except through the slot}` and likewise `Pillar II --- Enforceability: the channel, never the token`, `Pillar III --- Conservation: the budget is a ledger, and the ledger conserves`, `Pillar IV --- Detection: canaries with a power curve and a clock`; (c) change the four figure box headings to `I --- Noninterference`, `II --- Enforceability`, `III --- Conservation`, `IV --- Detection`, keeping the mechanism line beneath each unchanged.
- **Priority**: **high**. Cheapest high-value edit in the paper: four section titles, one table column, four figure labels.

### A5. "NI" is used before it is expanded, and never expanded at all

- **Location**: line 119 (table body).
- **Issue**: Definitions-first inverted into definitions-never. "NI" appears on page 2 as the first token of Pillar I's claim; "noninterference" is first spelled out at line 132/155, and the abbreviation is never introduced.
- **Current text**: `I (\S\ref{sec:p1}) & NI modulo declassification & …`
- **Proposed rewrite**: `I (\S\ref{sec:p1}) & noninterference mod.\ declassification & …` (or, with A4's Name column, drop the abbreviation entirely: `I (\S3) & Noninterference & silence except through the slot & …`).
- **Priority**: **medium** (trivial, but it is the reader's first contact with the pillar table).

### A6. Differential privacy is used throughout and defined nowhere

- **Location**: first live use at line 100 ("differentially private feedback to Erin"), then §5 throughout, §7 line 410.
- **Issue**: Definitions-first is the anti-pattern; *no* definition at point of use is the opposite failure. The stated audience is "a smart reader who's never seen this before"; ε, δ′, "sequential composition", "advanced composition" and "privacy filter" all arrive in §5 with no anchor. The double-entry-bookkeeping analogy explains the *ledger* beautifully and explains ε not at all.
- **Current text**: line 100, "fixed-schema, aggregated or differentially private feedback to Erin".
- **Proposed rewrite**: leave line 100 alone and bind the symbol at §5's scene per A2's rewrite, then add one sentence immediately after it:
  > Composition is the reason a ledger is needed at all: two releases that are each individually private are not jointly private for free, and the price of the pair is (at worst) the sum of their prices. The whole of Pillar III is the discipline of keeping that running sum honest under concurrency, and the Corollary is about what the sum then licenses you to say.
- **Priority**: **high** for the stated audience.

### A7. Pillar II is the only section with no worked numbers, no "now you try", and no figure

- **Location**: §4, lines 218–267.
- **Issue**: Rail B violation (the two-figure grammar) and a missing Move 5. Every other pillar has "Numbers by hand" + a fade + at least one figure; §4 has neither. Worse, the Reproducibility section (line 505) promises the reader something that does not exist in the paper: "Pillar II's classification table regenerates from \texttt{b3\_controllability.py}" — but there is no classification table, only a prose list inside the box.
- **Current text** (inside the Theorem 2 box, lines 238–243):
  > Consequences, from the product-automaton checker [internal, \texttt{b3\_controllability.py}]: \emph{forbid egress / push / write / exec / spawn} $\Rightarrow$ regimentable; \emph{forbid emit-token / context-read / internal-plan} (``the confident lie'') $\Rightarrow$ detect-only forever. The decisive compound case --- \emph{``no \texttt{net\_egress} after \texttt{in\_context\_read} of a secret''} --- is \textbf{regimentable}: the policy permits the uncontrollable read, records it as taint, and gates only the controllable egress.
- **Proposed rewrite**: cut the enumeration out of the box (leaving the box to state Theorem 2 and the two hypotheses only), promote it to the real table promised by §Reproducibility (see **C2**), and add the missing Move 5 after the box:
  > \textbf{Numbers by hand.} The checker's verdict is a one-line test you can run in your head. Take the policy \emph{``never \texttt{net\_egress} after \texttt{in\_context\_read}''} and ask: does every one-step uncontrollable extension of a permitted trace stay permitted? Extend by \texttt{in\_context\_read} --- still permitted (the policy records taint, it does not forbid reading). Extend by \texttt{model\_emit\_token} --- still permitted. Nothing in $\Sigma_u$ can push a permitted trace out of $K$, so $\overline{K}\Sigma_u\cap\overline{L}\subseteq\overline{K}$ holds and the policy is regimentable. \emph{Now you try:} the policy \emph{``never \texttt{model\_emit\_token} after \texttt{in\_context\_read}''}. (Extend a permitted trace by \texttt{model\_emit\_token}, itself in $\Sigma_u$: the extension is forbidden but uncontrollable, the inclusion fails, and the policy is detect-only forever --- this is ``the confident lie'' row of Table~\ref{tab:controllability}.)
- **Priority**: **high**. Pillar II is the load-bearing pillar (it is what licenses whole-worker taint and retires the naive pitch), and it is currently the thinnest-taught.

### A8. The Pillar III box has swallowed three paragraphs of discussion and stopped being a box

- **Location**: §5, lines 281–324 — a single `thebox` spanning 44 lines containing Theorem 3, a Corollary, a paragraph on advanced composition, the new honest-worker paragraph, and Verification.
- **Issue**: Move 4 / Rail A violation. The box is defined as "the precise statement, self-contained, readable cold" and the expert express lane is "one-breath sentence + box, read alone, must state the result". Three of these five blocks are prose argument, not statement; an expert taking the express lane now has 44 lines to wade through, which is the *One Path For All Readers* anti-pattern re-created inside the box. Compare Pillar I (21 lines), II (14), IV (20).
- **Current text**: the box currently ends at line 324, after "…so atomicity is what makes the budget promise auditable [internal]."
- **Proposed rewrite**: close the box after the Corollary's first paragraph (i.e. after line 296, "…that summing \emph{realised} parameters is a valid filter --- not sequential composition.") and re-open a second, short box for Verification. Demote the two intervening paragraphs to body prose under bold run-in heads that already exist in spirit:
  > \textbf{Why not just quote the advanced bound.} The same authors show that substituting the advanced-composition bound into such a filter is \emph{not} valid: […unchanged…]
  >
  > \textbf{Who the certificate binds, and when it says nothing.} The DP reading of $\sigma$ presupposes […unchanged…]
- **Priority**: **high**. This is a structural regression introduced by the (correct) factual rewrite; the content is good and only needs to be outside the frame.

### A9. Symbol collisions: `b` means two things two pages apart; so do `K` and `s`

- **Location**: `b` — line 369 (SPRT error target $(\alpha,b)$) vs line 404 and the title/abstract (`b` bits per job, $q\cdot b$). `K` — line 232 (the safety policy $K\subseteq L$) vs line 364 ($K\sim\mathrm{Hypergeom}$). `s` — line 163 (the secret) vs line 405 (timing slots, $\log_2 s$). `k` — line 326 (number of releases) vs line 363 (number of canaries in a leak).
- **Issue**: "One alphabet discipline per piece: don't reuse a letter for two roles." The `b` collision is the damaging one: the paper's headline quantity is $q\cdot b$ bits, and two pages earlier `b` is a Type-II error target. It reads like `β` was renamed to `b` in Theorem 4b to dodge the per-canary `β`, which walked it straight into the bits collision.
- **Current text** (line 369):
  > The SPRT with error targets $(\alpha,b)$ stops, under leak, after expected $\mathbb{E}_1[N]=\bigl[(1-b)\ln\tfrac{1-b}{\alpha}+b\ln\tfrac{b}{1-\alpha}\bigr]/\mathrm{KL}(p_1\Vert p_0)$ outputs
- **Proposed rewrite**: rename the SPRT Type-II target to $\gamma$ throughout Theorem 4b and its Verification block (`$(\alpha,\gamma)$`, `$(1-\gamma)\ln\frac{1-\gamma}{\alpha}+\gamma\ln\frac{\gamma}{1-\alpha}$`, "$\gamma{=}0.05$", "realized miss $0.048\le 0.05$" unchanged), leaving `b` free for bits. For `K`: rename the hypergeometric variate to $C_m$ ("a leak of $m$ spans carries $C_m\sim\mathrm{Hypergeom}(n,c,m)$ canaries"), giving $1-\mathbb{E}[\beta^{C_m}]$. For `s`: rename timing slots to $\tau$ ("choosing among $\tau$ timing slots adds up to $\log_2\tau$ bits per event"). For `k`: leave it — the two uses are in different pillars and both are "how many things", so the collision is benign; note it consciously rather than fix it.
- **Priority**: **high** for `b`, **medium** for `K` and `s`.

### A10. Pillar I's "What it buys" claims the whole headline, but Pillar I only buys two-thirds of it

- **Location**: §3, lines 191–194.
- **Issue**: Overclaim by attribution. "Bounded" is Pillar III's word; Theorem 1 says nothing about totals. The paper elsewhere gets this exactly right (line 132–137).
- **Current text**:
  > \textbf{What it buys.} The product's headline sentence in its corrected, provable form: \emph{every release is explicit, gated, and bounded}.
- **Proposed rewrite**:
  > \textbf{What it buys.} Two of the three words in the product's headline sentence, in provable form: every release is \emph{explicit} (it happens at a named gate step, not as a side effect) and \emph{gated} (nothing else crosses). The third word, \emph{bounded}, is not Theorem 1's to give --- a gate can be perfectly silent and still be invoked a thousand times. Pillar III supplies it.
- **Priority**: **medium**.

### A11. §7 is billed as the paper's composition step and is two paragraphs that never mention what it was promised to price

- **Location**: §7, lines 401–416; forward references to it at lines 54, 208, 308, 429.
- **Issue**: Three earlier passages promise §7 will price specific residuals — the laundering escape hatch (line 208: "We therefore price that residual in \S\ref{sec:budget}"), the malicious-worker case where the ledger certifies nothing (line 310), and the arbitrary-telemetry channel (line 429). §7 discharges all three *implicitly* and names none of them, so the loop reads as open. It is also the only substantive section with no box, no boundary block, and no figure, despite being the section the whole four-pillar argument converges on.
- **Current text** (lines 403–406):
  > The four pillars compose into one information-theoretic account, and the account is deliberately unromantic. If an Erin-visible channel permits $b$ freely chosen bits per job, a malicious worker can exfiltrate up to $b$ bits through it --- the noninterference theorem guarantees only that those bits pass through the declared gate, not that they are innocent.
- **Proposed rewrite**:
  > The four pillars compose into one information-theoretic account, and the account is deliberately unromantic. It is also where the paper pays its three outstanding debts: the laundering residual left open by Theorem 1's committed-input hypothesis (\S\ref{sec:p1}), the malicious worker against whom $\sigma\le\varepsilon_{\max}$ certifies nothing (\S\ref{sec:p3}), and the arbitrary-telemetry channel disclaimed in \S\ref{sec:cannot}. All three are the same debt, and it has one price. If an Erin-visible channel permits $b$ freely chosen bits per job, a worker that launders --- computing $t=f(s)$ and submitting $t$ so the gate honestly releases $g(t)$ --- can move up to $b$ bits through it: the noninterference theorem guarantees those bits pass through the declared gate, not that they are innocent.
- **Priority**: **high**. Also add a "Now you try" fade at the end of §7 (see **C4**).

### A12. Ryoan arrives on the last page, after nine pages in which the reader was told this standoff is settled with lawyers

- **Location**: §1 lines 36–38 vs §10 lines 478–496.
- **Issue**: The brief asks whether the paper distinguishes itself from Ryoan-style approaches *for a reader unfamiliar with either*. Right now: not until §10, and then in one dense paragraph. §1 frames the problem as unaddressed ("Every week some enterprise negotiates this exact standoff with lawyers and air-gapped laptops"), which is true of practice but leaves an informed reader thinking "Ryoan did this in 2016" for nine pages and an uninformed reader never learning that a prior system exists. The §10 treatment itself is admirably honest but assumes the reader knows what "a request-oriented model in which a module sees its input once and keeps no state" is a description *of*.
- **Current text** (§1, lines 36–38):
  > Every week some enterprise negotiates this exact standoff with lawyers and air-gapped laptops; the question is whether a \emph{computational} contract can replace the lawyers' one --- and what, precisely, it can promise.
- **Proposed rewrite** (add two sentences at the end of that paragraph):
  > Every week some enterprise negotiates this exact standoff with lawyers and air-gapped laptops; the question is whether a \emph{computational} contract can replace the lawyers' one --- and what, precisely, it can promise. The systems literature has answered a narrower version of this question already: Ryoan \cite{ryoan16} confines a proprietary module inside an attested enclave so that a data owner and a code owner who distrust each other both keep their secrets, and we claim none of that as new. What Ryoan buys its confinement with is a module that sees its input once and keeps no state --- a price a looping, tool-calling agent cannot pay, and the whole reason this paper needs a budget and a detector where Ryoan needed neither. \S\ref{sec:related} is explicit about the line.
- **Priority**: **high**. Pair with **C1** (the comparison table), which is the single highest-value new figure in the paper.

### A13. Two novelty claims are stated flatly over entire literatures

- **Location**: §10, lines 492–493 and 483–484.
- **Issue**: Overclaim wording (not fact). The paper is scrupulous everywhere else about hedging to what was checked.
- **Current text**:
  > The four-pillar schedule (II says where the boundary can be, I that it holds, III what crosses it, IV what evades it) has no counterpart in the confidential-computing literature.
  and
  > Any reader who knows that paper should be told so in this one.
- **Proposed rewrite**:
  > We are aware of no counterpart to the four-pillar schedule (II says where the boundary can be, I that it holds, III what crosses it, IV what evades it) in the confidential-computing literature; the individual pillars are all borrowed, and it is their scheduling against one design that we are putting forward.
  and delete the second sentence entirely — the surrounding paragraph already does the disclosing, and an instruction to the reader about what the reader should be told reads as a note-to-self that survived the draft.
- **Priority**: **medium**.

### A14. Pillar IV's one-breath sentence is three results

- **Location**: §6, lines 351–353.
- **Issue**: Move 2 ("If you need two sentences, you have two results"). This is one sentence by punctuation and three by content: the $1-\beta^k$ multiplication rule, the hypergeometric operating curve, and the SPRT clock. The express lane is supposed to be the thing an expert reads *instead of* the section.
- **Current text**:
  > \onebreath{Independent per-canary misses turn $k$ smuggled canaries into detection probability $1-\beta^k$; uniform planting turns leak size into a hypergeometric operating curve; and Wald's sequential test against the permutation null turns leak intensity into an expected time-to-detection --- formal statements in the box below.}
- **Proposed rewrite**:
  > \onebreath{Planting canaries at a known density converts ``how much did they take'' into a detection probability and ``how fast are they taking it'' into an expected alarm latency --- both quotable numbers, both with a named way to void them --- formal statements in the box below.}
- **Priority**: **medium**. Same treatment would help Pillar I's one-breath (lines 145–147), which is 47 words and three subordinate clauses.

### A15. Pillar IV's numbers are never bound to Derek and Erin

- **Location**: §6, lines 372–374.
- **Issue**: Move 5 says numbers should be "drawn where possible from the actual session numbers" *bound to the scene's referent*. $n{=}10^4$, $c{=}100$, $\beta{=}0.2$ arrive as bare parameters; the reader has to guess what a "span" is and whose corpus it is. Pillars I and III both re-enter through the scene; IV does not.
- **Current text**:
  > \textbf{Verification.} $n{=}10^4$, $c{=}100$ (density 1\%), $\beta{=}0.2$: a 100-span leak is caught with probability $0.554$…
- **Proposed rewrite**: add one sentence to the Intuition paragraph immediately before the box (after line 359, "…a CISO buys a number."):
  > Concretely: Derek's corpus is $n=10^4$ retrievable spans, of which $c=100$ are canaries his broker planted and Erin's worker cannot identify; $\beta=0.2$ is the measured rate at which a canary that does ride out in a release fails to trip the suppressor. Those three numbers are what the operating curve is a function of.
- **Priority**: **medium**.

### A16. Sections that are already excellent — leave them

§8 ("What cannot honestly be promised") is the best-executed section in the paper and possibly in the corpus: seven boundaries at full prominence, each naming the *structural* reason rather than an engineering gap, and the model-extraction asymmetry item (lines 424–427) is exactly right. §9 (the lift) is a model of how to declare an unfinished obligation without either hiding it or overselling it. Pillar I's honest-boundary block (lines 196–214) — particularly the laundering paragraph — is the strongest boundary-writing in the paper and needs nothing. The §2 composition paragraph (lines 131–139) is the sentence-level answer to "is this a structure or four sections": it *is* legible, and A4's naming fix is what will make it stick.

---

## Part B — Existing figures/tables: clarity audit

### B1. The pillar table — §2, lines 114–129 (unnamed, uncaptioned, unfloated, unreferenced)

- **What it currently shows**: four rows × four columns — pillar/section, claim, verification method, artifact script.
- **What the reader should take away**: that each pillar is a *separately checkable* claim with a named script behind it, i.e. that "four pillars" is an evidence schedule and not a rhetorical flourish.
- **Will they get it?** Partly. Cleveland–McGill is not engaged (it is a text table, correctly). Greyscale-safe (no color). But it fails the Mensh–Kording caption rule outright: it is a bare `\begin{center}\begin{tabular}` with **no `\caption`, no `\label`, and no cross-reference from the text**. Nothing tells the reader what the table is for; the paragraph that explains it (line 131) begins "The four rows are not four independent guarantees…" and refers to "the four rows" with no anchor. Its "Claim" column is also the reader's first contact with "NI" (A5) and with pillar names that appear nowhere else (A4).
- **Verdict**: **fix — the highest-return small fix in the paper.**
- **Concrete fix**: promote to a real float with the Name column from A4 and a caption that states the finding rather than labelling the object:
  ```latex
  \begin{table}[htbp]
  \centering
  \begin{tabular}{@{}lllll@{}}
  \toprule
  Pillar & Name & Claim & Verification & Artifact \\
  \midrule
  I (\S\ref{sec:p1})   & Noninterference & silence except through the slot & exhaustive, depth 7; 2/2 mutations & \texttt{c1\_noninterference.py} \\
  II (\S\ref{sec:p2})  & Enforceability  & the channel, never the token    & product-automaton checker          & \texttt{b3\_controllability.py} \\
  III (\S\ref{sec:p3}) & Conservation    & the ledger conserves            & exhaustive $+$ 2000 random; 2/2 mut. & \texttt{a3\_epsilon\_ledger.py} \\
  IV (\S\ref{sec:p4})  & Detection       & power curve $+$ alarm clock     & analytic vs.\ simulation agreement & \texttt{a4\_canary\_sprt.py} \\
  \bottomrule
  \end{tabular}
  \caption{Every pillar is checked by a different method against a different failure, and each row regenerates from one named script --- the four-pillar claim is an evidence schedule, not a rhetorical one.}
  \label{tab:pillars}
  \end{table}
  ```
  and change line 131 to open "The four rows of Table~\ref{tab:pillars} are not four independent guarantees…".

### B2. `fig:pillars` — `fig-paper4-pillars.tex`, `\input` at line 141

- **What it currently shows**: a top-to-bottom pipeline: dual-attested key release → a dashed "sealed workroom" boundary containing four left-to-right stage boxes (II Mediation, I Declassification gate, III ε-ledger, IV Canary+SPRT), each carrying an "if absent:" gap line → a green outcome bar (q·b bits, priced not eliminated) with the out-of-model channels noted.
- **What the reader should take away**: the pillars are links in one pipeline in the order II→I→III→IV, and no link is redundant because each box names the gap its absence reopens.
- **Will they get it?** **Yes — this is the paper's best figure and it directly answers the brief's question.** The four-pillar architecture is genuinely *visualized*, not listed: the "if absent" annotations are the non-redundancy argument rendered visually, the sequence is drawn in the logical rather than the numeric order, and the green outcome bar carries the honest boundary into the figure instead of leaving it to prose. Greyscale: all fills are 6–12% tints, so the boxes read as near-white with differing border colors and the *text* carries every distinction — it survives greyscale and color-blind viewing intact. Cleveland–McGill does not apply (no quantitative encoding). The caption states the finding.
- **Verdict**: **keep; three small fixes.**
- **Concrete fix**: (i) apply A4's naming to the four box headings; (ii) the pillars are drawn II, I, III, IV left-to-right but the roman numerals now run out of order across the page, which reads as an error rather than as the point — add a small caption-level or in-figure note: `\node[font=\scriptsize\itshape,color=black!45]` beneath the row reading "read left to right: this is the composition order, not the numbering order"; (iii) tighten the caption's last sentence to state the finding as a claim: "Each box names the gap left open if that pillar alone were dropped --- no pillar is decorative." (iv) **[needs render]** the fragment's header comments record two prior overflow repairs at this exact resize factor (0.95\textwidth, `minimum height` retuned); verify the four stage boxes' three-part text still fits at 2.6 cm after the heading rename in (i), since "Noninterference" is longer than "Declassification gate" is short.

### B3. `fig:r9rel` — `fig-r9-relation.tex`, `\input` at line 160 (Pillar I relation-map)

- **What it currently shows**: a three-row, two-column relation map whose *drawn* base analogy is a **sealed airlock** — "Sealed airlock" / "Erin, at the porthole" / "Inspector's logbook" on the left, mapped to "Gate $g(s)=s\bmod 2$" / "Erin's observation trace" / "Exhaustive + mutated" on the right, with three labelled correspondence arrows ("the only door is the gate", "equal release ⇒ equal view", "checked, not assumed").
- **What the reader should take away**: the analogy maps *relations*, and the third row shows the mapping is checked rather than asserted.
- **Will they get it?** **No — the caption describes a different figure.** The `\caption` (fragment lines 71–75) reads "The **voting booth** maps to the sealed workroom by relations… booth walls → attested isolation; the tally board → the declassification gate; ``watching all day reveals no ballot'' → two-run observational equivalence." No booth, no walls, no tally board appears anywhere in the drawing. The paper's prose (line 152) also commits to the voting booth. So the reader meets a voting-booth analogy in the text, a voting-booth caption, and an airlock picture between them. Separately, the in-figure title reads "R9 --- every release explicit, gated, and bounded" and the bottom interpretive line reads "Two directions, one theorem: **R5** gates the channel, **R9** shows the gate suffices" — R5 and R9 are execution-report IDs that appear **nowhere in paper4** (`grep -E '\bR[0-9]+\b' paper4.tex` returns nothing). Structurally the map is otherwise good: three columns' worth of content, arrows labelled with *relations* not nouns, which is exactly the Rail-B grammar. Greyscale: harborblue/seagreen/shipred at 10–12% fill, distinctions carried by text — survives.
- **Verdict**: **fix — highest-priority figure defect in the paper.**
- **Concrete fix**: keep the drawing's structure and relabel the left column to the voting booth the paper actually commits to, so figure, caption and prose agree:
  - `(l1)`: `{\bfseries The booth and the board}` / "Voters enter one at a time and are unobserved inside; the tally board updates only at the declared count" / annotation "never per-ballot".
  - `(l2)`: `{\bfseries The poll-watcher outside}` / "Sees only the board --- two electorates with the same totals look identical all day" / annotation "whenever the declared totals match".
  - `(l3)`: `{\bfseries Re-running the election}` / "Every voter order and every swap of two same-party ballots re-run --- the board never tells them apart" / annotation "except at a count itself".
  - Retitle to `Pillar I --- every release explicit, gated, and bounded`; change the bottom line to "Two directions, one theorem: Pillar II says gate the channel, Pillar I says the gate suffices".
  - Add one clause to the caption to carry the residual (pairs with A1): "…The analogy predicts, correctly, that the residual risk is a too-revealing tally --- a per-precinct board with one voter is a leaky $g$, which is what Pillars III and IV price."
  - *Alternative if you prefer the airlock*: it is arguably the better structural base (a chamber with one cycling door maps the interleaving quantifier more naturally than a tally does). Then change the paper's prose at line 152 instead and rewrite the caption to the airlock — but pick one; three analogies for one theorem is worse than either.
  - **[needs render]** the fragment header records a prior row-overflow repair (box height 2.15 → 3.8 cm); the replacement labels above are within a line of the current ones, but confirm.

### B4. `fig:r9reg` — `fig-r9-regime.tex`, `\input` at line 216 (Pillar I regime)

- **What it currently shows**: a 2×3 categorical grid — rows (0,2) equal parity / (0,1) unequal parity, columns Honest Gate / Leaky-Gate Mutant / Bypass Mutant — with each cell filled seagreen ("identical views"), harborblue ("differs only at gate release"), or shipred ("DISTINGUISHED / caught"), plus a legend keyed by color name.
- **What the reader should take away**: the honest gate holds on both rows (differently), and both mutants are caught on both rows — the mutation suite has teeth.
- **Will they get it?** **Mostly, but the encoding is the weakest one available and it fails greyscale.** Cleveland–McGill: the holds/caught distinction is carried by *color hue with a saturation difference* — the bottom of the ranking — where a glyph or a position would be free. Greyscale survival is the concrete failure: computing Rec.709 luminance on the preamble RGB values at the fragment's `fill opacity=0.75` over white gives harborblue → ~112, shipred → ~104, seagreen → ~132 out of 255. **Harborblue and shipred differ by ~3% luminance**, and those two are precisely the "holds" and "caught" cells that sit side by side in row 2. The cell text ("differs only at gate release" vs "DISTINGUISHED") rescues it, but the legend does not: it keys entirely on color names — "{\color{seagreen!70!black} Seagreen (holds):}", "{\color{harborblue} Harborblue (holds):}", "{\color{shipred} Red (caught):}" — which is meaningless in print, in greyscale, and to a deuteranope. The caption does state the finding, correctly.
- **Verdict**: **fix.**
- **Concrete fix**: add a redundant non-color channel and re-key the legend to it. Prefix each cell's bold line with a glyph — `\ding{51}` (or `$\checkmark$`) on the two honest-gate cells, `\ding{55}` (or `$\times$`) on the four mutant cells — and rewrite the legend to key on glyph plus a hatch, not on hue:
  ```latex
  {$\checkmark$ \bfseries holds:} honest gate --- identity on equal-parity pairs (row 1); any difference isolated to the gate-release event (row 2).\\[3pt]
  {$\times$ \bfseries caught:} every mutation is distinguished --- it leaks information the honest gate hides.
  ```
  Optionally add `pattern=north east lines` to the shipred cells so the two categories separate without color at all. Also retitle "R9 regime" → "Pillar I regime" per B3.

### B5. `fig:r10reg` — `fig-r10-regime.tex`, `\input` at line 334 (Pillar III regime)

- **What it currently shows**: log-x plot of certified total ε against number of releases k at δ′=10⁻⁶: basic sequential kε (harborblue), advanced DRV (seagreen), a dashed crossover line at k≈35.3 (shipred), a shaded region past the crossover, and four marked measured points with two annotation boxes.
- **What the reader should take away**: quote the sequential bound below k≈35, the advanced bound above it.
- **Will they get it?** Mostly — the encoding is right (position on a common scale, top of the Cleveland–McGill ranking) and the caption states the finding cleanly. Two real problems. **(i) The k=128 marked points do not lie on either plotted curve, and nothing says why.** Both curves are drawn at ε=0.1; the two k=128 markers are at ε=0.05 (basic 6.40, advanced 3.30), so they float at roughly half the blue curve's height at that x (kε = 12.29 at ε=0.1) with no visual explanation. A reader checking the figure against the curve will conclude one of them is wrong. **(ii)** Greyscale: two *solid* lines at luminance ~64 (harborblue) and ~90 (seagreen) on white — distinguishable but marginal, and the legend keys on color alone. Also "R10 regime" in the plot title (B3's problem again), and the `k=128` annotation node is drawn with `draw=seagreen!70` while it annotates a harborblue-marked basic-composition point.
- **Verdict**: **fix (i) and the title; (ii) is a cheap improvement.**
- **Concrete fix**: (i) either add a second, fainter pair of curves at ε=0.05 (dotted, `opacity=0.4`, `forget plot`) so the k=128 markers land on something, or — cheaper and probably better — relabel the annotation to make the off-curve status explicit: change the node text to `$k{=}128$ at $\varepsilon{=}0.05$ (off-curve): $6.40/3.30$` and add one caption clause: "The $k{=}128$ pair is computed at $\varepsilon{=}0.05$ and therefore sits below the $\varepsilon{=}0.1$ curves --- it is shown because it is the paper's second worked point, not because it lies on them." (ii) give the advanced curve `dashdotted` and add `mark=*,mark repeat=4` to one series so the two survive greyscale; recolor the k=128 annotation border to `harborblue!70`. Retitle "R10 regime" → "Pillar III".

### B6. `fig:r11reg` — `fig-r11-regime.tex`, `\input` at line 386 (Pillar IV regime)

- **What it currently shows**: log-log plot of detection probability against leak size in spans: the secure operating curve (harborblue solid), the adversary-strips-canaries curve (shipred dashed), six measured points (shipred filled circles), and a 50%-detection reference line.
- **What the reader should take away**: detection probability is a *quotable function of leak size*, and canary secrecy is what holds the curve up.
- **Will they get it?** Good encoding (position on a common scale; two curves, well separated at the right-hand end where the argument lives), and the boundary-inside-the-figure move is exactly the Rail-B discipline. Three defects. **(i) The measured points are `color=shipred` but they belong to the harborblue secure curve** — a reader will read six red dots as samples of the red dashed adversary curve, which inverts the figure's point. **(ii) The caption opens "Left: $\Pr(\text{detect})$ against leak size…" but the figure has one panel** — a leftover from the two-panel PNG this fragment replaced. **(iii)** The caption claims "exact, approximate, and simulated agree" but only one curve plus one marker series is drawn, so the three-way agreement is asserted rather than shown; and "R11 regime" appears in the plot title. Greyscale is otherwise fine (solid vs dashed).
- **Verdict**: **fix (i) and (ii); (iii) is a caption honesty tightening.**
- **Concrete fix**: (i) change the measured-points `\addplot` to `color=harborblue,mark options={draw=black!60,fill=harborblue}` and the legend entry to "measured, exact hypergeometric [internal, \texttt{a4\_canary\_sprt.py}]". (ii) delete "Left: ". (iii) rewrite the middle sentence to "Markers are the exact hypergeometric values; the binomial approximation plotted as the solid curve and the Monte-Carlo simulation agree with them to simulation precision at every marked $m$ [internal, \texttt{a4\_canary\_sprt.py}]." Retitle "R11 regime" → "Pillar IV".

### B7. The work-order display — §2, lines 65–73

- **What it currently shows**: a thirteen-field tuple $C=\langle\ldots\rangle$ set as a two-line aligned display, immediately followed by a prose sentence (lines 74–76) that re-lists what appear to be the *same* fields in different words and different order ("the measured runtime and agent bundle, the encrypted data inputs, the allowed tools…").
- **What the reader should take away**: what both parties are actually signing, and that any change re-hashes it.
- **Will they get it?** Only with effort. Thirteen comma-separated fields in a display is a table wearing an equation's clothes, and the following sentence's near-repetition makes the reader check whether the two lists match (they roughly do — "recipients" ↔ "the declassification authorities" is the one that does not obviously line up). This is the only place in the paper where the reader is asked to hold a thirteen-item list with no visual structure.
- **Verdict**: **fix (medium).**
- **Concrete fix**: keep the display as the formal object but cut the redundant re-listing sentence down to what it uniquely adds: "The order binds the measurement to the policy: any change to any field makes a new hash and requires both signatures." Then, if space allows, set the thirteen fields as a compact three-column `tabular` glossary (field / who cares / what breaks if it is wrong) — that turns a list into an argument. Low-cost alternative: group the display into three labelled braces (*what is measured* | *what may happen* | *what is owed*) so the tuple has visible structure.

---

## Part C — New figures/examples proposed

### C1. Ryoan vs. the Sealed Harbor — the distinguishing table

- **Where**: §10, immediately after the "And the design itself is not ours" paragraph (line 484), referenced forward from §1 per A12.
- **What it would show**: five or six rows contrasting the two designs on the axes that actually differ, e.g.

  | | Ryoan (2016) | The Sealed Harbor |
  |---|---|---|
  | Workload | one-shot module: sees input once, keeps no state | looping agent: tools, sub-steps, retained context |
  | How leakage is bounded | *structurally* — no state to leak from | *metered* — declared channel width, ε-ledger |
  | Taint granularity | module-confinement | whole-worker after first secret read |
  | Model access | module runs in enclave | model runs in the confidential domain; no external inference endpoint |
  | Multi-job accounting | per-request; repetition noted as exhausting the input | q·b across q jobs, in the work order |
  | Evasion | not in scope | canary operating curve + SPRT clock (Pillar IV) |
  | Timing | log₂ s bits over s static slots (their §5.2) | same arithmetic, restated per engagement |

- **Why it helps**: it is the single artifact that answers the brief's question for both audiences at once. A reader who knows Ryoan sees in ten seconds what is and is not claimed; a reader who has never heard of it gets a working description of Ryoan *and* the delta in the same glance, without needing to have read it. It also makes the honesty of §10 legible as structure rather than as a paragraph of concessions — the "same" rows are as visible as the "different" ones, which is the strongest possible form of the claim.
- **Kind**: **table**.

### C2. The controllability classification table (Pillar II)

- **Where**: §4, replacing the prose enumeration currently inside the Theorem 2 box (lines 238–243). This is the table §Reproducibility line 505 already promises exists.
- **What it would show**: one row per policy the checker classified — columns *policy*, *events it constrains*, *Σ_c or Σ_u*, *verdict*, with the compound clean-room case as the final, bolded row:

  | Policy | Constrains | Alphabet | Verdict |
  |---|---|---|---|
  | forbid `net_egress` | egress | Σ_c | regimentable |
  | forbid `git_push` / `fs_write` / `exec_tool` / `spawn_child` | effects | Σ_c | regimentable |
  | forbid `model_emit_token` ("the confident lie") | generation | Σ_u | detect-only forever |
  | forbid `in_context_read` | reading | Σ_u | detect-only forever |
  | forbid `internal_plan` | deliberation | Σ_u | detect-only forever |
  | **no `net_egress` after `in_context_read`** | trigger in Σ_u, effect in Σ_c | mixed | **regimentable** |

- **Why it helps**: Pillar II's whole claim is a *classification*, and a classification presented as prose inside a theorem box cannot be scanned, compared, or quoted. The table also makes the punchline visible at a glance — every Σ_u row is detect-only, every Σ_c row is regimentable, and the one mixed row is the entire clean-room design. It fixes the broken Reproducibility promise, gives §4 the artifact it currently lacks, and pairs with the worked example in A7.
- **Kind**: **table** (with a caption stating the finding: "Enforceability tracks the alphabet, not the severity: gating what the model *does* works; gating what it *reads, thinks, or says* never will.").

### C3. The clean-room architecture diagram (§2's title promise, currently undrawn)

- **Where**: §2, after the "Two fences" paragraph (line 93) or after "Whole-worker taint and two gates" (line 104).
- **What it would show**: the physical/logical architecture as concentric boundaries, which §2's own title announces and which no figure currently draws. Outer ring: the cloud operator (labelled "reads neither plaintext"). Inside it, the confidential VM. Inside that, the sealed workroom: Erin's worker (labelled hostile-even-if-honest), holding **only** the five semantic handles (`read`, `infer`, `execute`, `write`, `request_declassification`), the model sitting *inside* the same domain (with a struck-through arrow to an external inference endpoint, annotated "a third principal the contract never admitted"), the attested in-guest monitor as fence 1, and the Derek-controlled outer gateway as fence 2. Exiting: exactly three arrows through two gate icons — rich result → Derek, fixed-schema/DP feedback → Erin, padded receipt → both. Derek's and Erin's key brokers enter from the top with the dual attestation.
- **Why it helps**: this is the gap the brief's question about the four pillars exposes from the other side. The four-pillar *argument* is well visualized (B2); the *architecture the argument is about* exists only as three dense prose paragraphs carrying five function signatures, two fences, two gates, three channels and three non-readers. `fig:pillars` is often mistaken for this figure — its source file is even named `paper4_pillars_architecture` — but it draws the assurance pipeline, not the room. A reader who cannot picture the room cannot picture what Pillar I is quantifying over. It is also the figure a CISO will screenshot.
- **Kind**: **relation-map** (structural `tikzpicture`, `relnode`/`regimebox` styles, per `figures/CONVENTION.md` — nodes and arrows, no numeric axes).

### C4. A capacity-budget worked table for §7, with a fade

- **Where**: §7, after line 416.
- **What it would show**: a small three-by-three grid of $q\cdot b$ in bits for schema widths b ∈ {8, 64, 512} against engagement lengths q ∈ {20, 200, 2000}, with the paper's own worked cell (64 × 200 = 12,800) highlighted, and a right-hand column translating each into the sentence a contract writer would actually write ("at most 12,800 bits of adversarial capacity before timing — bond, canary, and price exactly that").
- **Why it helps**: §7 is the only substantive section with no Move 5 and no figure, and it is the section carrying the paper's most quotable design rule ("never negotiate over *does this output contain a secret* — negotiate over channel capacity"). A grid makes the rule operational in one look: halving the schema halves the exposure, and the reader can find their own engagement in the table. Add the fade the section is missing: *Now you try:* a contract granting a 16-bit status per job over 500 jobs — what capacity has it granted? (8,000 bits, before timing.)
- **Kind**: **worked-numeric-example** (as a small table).

### C5. A one-line reading-order cue for the pillar sequence

- **Where**: §2, at the end of the composition paragraph (line 139), or as a margin note beside the four section headings.
- **What it would show**: the four pillars on a single horizontal strip in *logical* order with the numerals visible — `II where` → `I holds` → `III meters` → `IV polices` — reproducing `fig:pillars`' spine at one-tenth the size, so it can be repeated as a thumbnail at the head of each pillar section with the current one highlighted.
- **Why it helps**: this is the cheapest available fix for the numbering-vs-narrative tension (A4, B2-ii). A reader landing in §5 has no way to recall that III comes third in the argument but second-to-last in the pipeline; a four-box strip with the current box filled re-orients them in half a second and costs about fifteen lines of TikZ, reused four times.
- **Kind**: **relation-map** (miniature; a "you are here" strip).

---

## Part D — Cross-reference notes

**Partly related — worth three specific notes, but the pairing is weaker than the titles suggest.** `website-v2/public/whitepaper/anchor-protocol-whitepaper.tex` (72 KB) is about *authentication and authorization*: Harbor Cards as constrained JWTs, Ed25519 signatures, Macaroon-style multi-hop delegation with per-hop capability attenuation, cuckoo-filter revocation with gossip, verified in ProVerif and Kani. Paper 4 is about *confidentiality of a joint computation*: declassification gates, noninterference, DP budgets, canaries. They share a program vocabulary and a threat posture, not a subject. The "gated, bounded confidential releases" ↔ "capability attenuation / delegation / revocation" pairing guessed from titles does not hold at the technical level — there is no shared theorem, no shared model, and no place where one's result is the other's hypothesis. **Part D is not skippable, though, because the shared vocabulary drifts in three places:**

1. **`ε` means two different things in the same program.** Paper 4 uses `\varepsilon` throughout as the differential-privacy loss parameter (`ε_i`, `ε_max`, `σ = Σ ε_i`). Anchor uses `\epsilon` exactly once, for a cuckoo-filter false-positive rate (line 265: "At false-positive rate $\epsilon$, a cuckoo filter uses approximately $\log_2(1/\epsilon)+3$ bits per entry… For $\epsilon = 10^{-3}$"). Both are small positive numbers where smaller-is-better, both appear inside a `log₂(·)` bit-count formula on the same page-equivalent of their respective papers, and the two are visually near-identical (`\varepsilon` vs `\epsilon`). *Recommendation*: no change to paper 4 — its usage is the standard one and it owns the symbol. Rename anchor's to `p_{\mathrm{fp}}` if the two are ever bound into the mega-volume, and note the collision in the mega-volume's notation table if one exists.

2. **`epoch` is overloaded three ways.** Paper 4 line 110 uses it for attestation freshness and rollback detection ("accepted epochs strictly increase in both external ledgers"), and it appears inside the receipt tuple at line 103. Anchor uses it for a TTL window (line 279, `Property: Filter Monotonicity over a TTL Epoch`) and for a revocation counter (line 886, "revocation-epoch mitigation"). Three unrelated clocks. *Recommendation*: paper 4 should say **"attestation epoch"** at both line 103 and line 110 rather than bare "epoch" — two words, and it prevents a mega-volume reader from importing the wrong clock.

3. **"Monotonicity" names the same *shape* of invariant in both, and neither paper says so — a missed cross-reference rather than a drift.** Paper 4 line 96–97: under decentralized labels "ordinary computation can only \emph{add} restrictions", and line 106 lists "label monotonicity (no label weakens without a declassification witness)". Anchor line 217: "a delegated token never carries more authority than its parent, and TTL only shrinks", proved as "Monotonic per-hop attenuation" (line 520). These are the *same* design principle — authority only shrinks, and any widening requires an explicit, witnessed exception — applied to labels in one paper and to capabilities in the other, with paper 4's declassification authority playing precisely the role anchor's re-issuance plays. *Recommendation*: one optional sentence in paper 4 §2 after line 97 — "This is the same shape as capability attenuation in the program's identity layer: authority only shrinks, and every widening is an explicit, witnessed exception rather than a computation." It costs a line and buys corpus coherence. Not required.

Note also that "Harbor" itself carries two senses in the corpus — anchor's Harbor is a zero-trust, namespace-isolated *execution environment* (line 197), while paper 4's "Sealed Harbor" is a confidentiality architecture. The titles will sit next to each other in a mega-volume. Not a defect in paper 4; a naming question for whoever assembles the volume.

---

## Summary

1. **The four-pillar structure is genuinely legible as a structure — the naming is what breaks it.** The composition paragraph (§2, lines 131–139) and `fig:pillars` both do real architectural work, and the "if absent:" annotations inside the figure are the non-redundancy argument rendered visually. But the four pillars carry four different naming schemes across the table, the composition paragraph, the section titles and the figure. Fix A4 (adopt Noninterference / Enforceability / Conservation / Detection everywhere, one table column, four section titles, four figure labels) and the structure becomes carryable.
2. **`fig:r9rel`'s caption describes a different figure than the one drawn** — voting booth in the prose and caption, sealed airlock in the drawing — and three of the paper's four figures leak execution-report IDs (R9, R10, R11, and an "R5" in a caption line) that appear nowhere in paper 4's text. The sibling paper-named figures (`fig-paper1-*`, `fig-paper3-*`, `fig-paper6-*`) all use descriptive titles, so paper 4 is the corpus outlier here and the fix has precedent. **B3, B4–B6.**
3. **Two figure-encoding defects will mislead a careful reader**: `fig:r9reg` distinguishes "holds" from "caught" by hue alone, and harborblue vs shipred differ by ~3% luminance at the fragment's 0.75 opacity — indistinguishable in greyscale, with a legend that keys on color *names*; and `fig:r11reg`'s measured points are drawn in the adversary curve's color while belonging to the secure curve. Both are one-line fixes. **B4, B6.**
4. **Ryoan is distinguished honestly but far too late and in prose only.** Add the forward pointer in §1 (A12) and the seven-row comparison table in §10 (C1) and the paper answers "how is this not Ryoan?" for both the informed and the uninformed reader in one glance. This is the highest-value new artifact proposed.
5. **Three structural regressions from the recent factual rewrites, all cheap**: the Pillar III box has grown to 44 lines and swallowed three paragraphs of discussion, breaking the express lane (A8); `b` now means both "SPRT Type-II target" and "bits per job" two pages apart, in a paper whose headline quantity is $q\cdot b$ (A9); and §7, which three earlier sections promise will price their residuals, discharges all three without naming any (A11). Beyond those: Pillar II remains the thinnest-taught section — no figure, no worked numbers, no fade, and a classification table that §Reproducibility promises but the paper never shows (A7, C2). §8 and §9 need nothing at all.
