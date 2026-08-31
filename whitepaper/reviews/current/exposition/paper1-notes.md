# Exposition + Figure Review: The Price of a Summary — Information-Theoretic Limits of Agent Oversight

`whitepaper/research/tex/paper1.tex`, 233 lines, Paper 1 of the seven-paper Harbor formal program. It is the corpus's *foundation volume*: it establishes that an oversight digest is a channel with a metered price, and every later paper (the split-head architecture, the inspection tower, the work unit) inherits its vocabulary — digest, open budget, miss budget, zoom. Structurally it carries four results (information floor + falsification experiment; the comonotone split-digest characterization; the derived regret head; the two-constraint frontier plus a genuinely new zoom-advantage theorem), seven `\input`'d TikZ/pgfplots figures, one unnumbered table, a bibliography of eleven items, and a red-boxed limitations section. It is the only paper in the program that contributes a new theorem rather than a write-up of a prior execution report, and the prose knows it — §4 is noticeably the best-built section, §2 and §3 the least.

The mechanical linter (`submission_lint.py`, run from the committed `.pyc` — the `.py` source is absent from `skills/research-paper-submission/scripts/`) reports **0 errors, 0 warnings, 7 claims-to-confirm**: five instances of unqualified "optimal" (L21, L35, L80, L102, L213) and nine `iff`/`if and only if` occurrences whose converse directions it wants confirmed (L21, L27, L34, L35, L80, L102, L108, L140, L142). Those are folded into Part A below as wording issues, not as re-litigations of the mathematics. There is no LaTeX toolchain in this container, so every judgment that depends on final page geometry — label collisions, figure floats, whether an annotation box overlaps a curve — is tagged `[needs render]`.

---

## Part A — Text/exposition changes

### 1. The super-additivity band "1.05–1.08 across regimes" is contradicted by the paper's own figure data

- **Location** — §2 (`sec:split`), Claim "Super-additive split penalty", L88–91; echoed in the abstract L21 and contribution 2 L34.
- **Issue** — Underclaim-by-narrow-band presented as a swept result; the `[verified]` tag asserts external recomputability for a range the recomputation does not produce. `figures/fig-r2-regime.tex` carries an explicit `CROSS-CHECK NOTE` at its head saying so, and its own plotted panel (b) reaches 1.122 at $k{=}3$, 1.224 at $k{=}4$ ($m{=}8$) and 1.392 at $k{=}10$ ($m{=}20$). Only the single $k{=}2$ point (1.067) sits inside the stated band.
- **Current text** —
  > `\frac{\mathrm{Floor}(N,2k,m)}{2\,\mathrm{Floor}(N,k,m)}\;\approx\;1.05\text{--}1.08 \quad\text{across regimes,}`
- **Proposed rewrite** —
  > $$\frac{\mathrm{Floor}(N,2k,m)}{2\,\mathrm{Floor}(N,k,m)}\;>\;1 \quad\text{for every } N,k,m \text{ with } 2k\le m,$$
  > because $\log_2\binom{N}{2k}$ grows faster than $2\log_2\binom{N}{k}$. The penalty is smallest where the essential sets are smallest and grows without bound in $k$: at $N{=}60,m{=}8$ it runs $1.03$ ($k{=}1$), $1.07$ ($k{=}2$), $1.12$ ($k{=}3$), $1.22$ ($k{=}4$); at $N{=}60,m{=}20$ it reaches $1.39$ by $k{=}10$ [verified]. At the paper's reference regime $N{=}60,k{=}2,m{=}8$: joint floor $12.77$ bits versus $2\times 5.98=11.96$; ratio $2.13\times$, super-additivity $1.07$ [verified]. One stored compaction under-provisions divergent readers by *more* than a factor of two, and by increasingly more as each reader's critical set grows (Figure~\ref{fig:r2reg}).
- **Also fix** — the same "$1.05$--$1.08$ across the swept regimes" phrase in the caption of `fig-r2-regime.tex`, and "ratio-over-double $1.05$--$1.08$ across regimes [verified]" at L34. The corrected version is *stronger* for the paper's thesis, which is why this is worth the edit rather than a hedge.
- **Priority** — **high**

### 2. §4's concluding "what it buys" paragraph puts stage two outside stage two's own advantage regime

- **Location** — §4 (`sec:frontier`), "What the frontier plus the theorem buy", L190; directly contradicted by "The dense-flag boundary, stated" two paragraphs later, L192.
- **Issue** — Composition overclaim: the two halves of §4 are calibrated at incompatible flagged-set densities and the joining paragraph never surfaces the density that actually results. The flagged set has $F=fN$ items of which $(p-\delta)N$ are real, so its density is $k/F=(p-\delta)/f$ — at the paragraph's own numbers ($p{=}0.05$, $\delta{=}0$, $f{=}2p$) that is **0.5**, and at $(\delta,f)=(0.01,0.10)$ it is **0.4**. Both sit deep in the dense regime the *next* paragraph says inverts the advantage. The Corollary's $(F,k)=(2500,10)$ example is density $0.004$, which under this model requires $f\approx 250(p-\delta)$ — unreachable at $p{=}0.05$.
- **Current text** —
  > "Every relaxation is now priced: loosening flags from $f{=}p$ to $f{=}2p$ cuts the digest from $0.286$ bits/symbol [verified] to $0.186$ [internal] at zero miss, and the flags it adds cost only logarithmically in the second stage; tolerating $\delta{=}0.01$ misses cuts the rate almost in half again."
- **Proposed rewrite** —
  > Every relaxation is now priced, and the two prices compose only in a stated window. Loosening flags from $f{=}p$ to $f{=}2p$ cuts the digest from $0.286$ bits/symbol [verified] to $0.186$ [internal] at zero miss, and tolerating $\delta{=}0.01$ misses cuts the rate almost in half again. But the flags stage one emits set stage two's density: the flagged set holds $(p-\delta)N$ real criticals among $fN$ flags, so $d=k/F=(p-\delta)/f$, and Theorem 4's guaranteed advantage $1/\bigl(d(2\lceil\log_2(1/d)\rceil+4)\bigr)$ exceeds $1$ only for $d\le 1/12$. **The composition therefore pays only when the flag budget is at least twelve times the residual positive rate, $f\ge 12(p-\delta)$** [verified from the two closed forms]. At $f{=}2p$, $\delta{=}0$ the density is $0.5$ and adaptive halving is guaranteed only $0.33\times$ — a $3\times$ *loss*, not a saving; at $(\delta,f)=(0.01,0.10)$ the density is $0.4$ and the guarantee is $0.31\times$. The Corollary's $12.5\times$ belongs to $d{=}0.004$, i.e.\ a far sparser source ($p\approx0.004$) with a generous flag budget. Stated plainly: cheap digests and cheap zooms are bought from the same budget, and the operating points where both are cheap are exactly the sparse-source ones.
- **Priority** — **high**

### 3. §2 has no structural analogy and no relation-map — the two rails are broken for a whole result

- **Location** — §2 (`sec:split`), L76–96. The section opens straight into the two-reader definition; there is no Move 3 and the only figure is a regime diagram.
- **Issue** — Definitions-first plus the missing relation-map rail. The house repertoire already assigns this result a base (`style-template-v2.md` L20: "thermometer → scalar heads (comonotonicity)"), and Rail B mandates a relation-map wherever an analogy carries a result. §1 and §4 both have one; §2 and §3 do not, so a reader who has been trained by §1 to expect base∥target∥arrows is dropped without warning.
- **Current text** —
  > "Every compaction in an agent system is read twice: by the \emph{successor} --- the next agent instance, which wants what is worth continuing (fit-shaped, forgone continuation value) --- and by the \emph{operator}, who wants what is dangerous to ignore (risk-shaped, regret-if-ignored). Standard practice stores one summary for both."
- **Proposed rewrite** (insert an analogy paragraph after the existing opener, before the box) —
  > **The analogy, mapped by relations.** A scalar summary head is a thermometer: one number, one order, every reader who consults it ranked the same way. That is fine when the readers want the same thing — a nurse and a pharmacist both want the hottest patient first. It fails the moment two readers want quantities that do not move together. Every compaction here is read twice: by the *successor* — the next agent instance, which wants what is worth continuing (fit-shaped, forgone continuation value) — and by the *operator*, who wants what is dangerous to ignore (risk-shaped, regret-if-ignored). The relation that transfers is not "summary resembles temperature" but the harder fact underneath: a single scalar induces exactly one total order, so it can serve two readers only if the two readers' own orders never cross. Standard practice stores one summary for both, and therefore silently asserts that they never do. The misread to preempt: this is not a claim that scalars are too coarse — a scalar with *infinite* precision fails identically, because the obstruction is ordinal, not numeric.
- **Priority** — **high**

### 4. §3 likewise has no analogy, no relation-map, no reader fade, and no inline boundary

- **Location** — §3 (`sec:regret`), L98–119.
- **Issue** — One-path-for-all plus boundary burial. §1, §2 and §4 each carry an inline misread-to-preempt; §3 carries none, and its only caveat is deferred 100 lines to L210. Its "Numbers by hand" (L113) also works a second case *for* the reader instead of handing it over, so the Move-5 fade is missing here alone.
- **Current text** (L113, end) —
  > "Raising $C_{\mathrm{miss}}$ to $1000$ drops the bar to $6/1005\approx 0.006$ --- the direction that matters: as the miss-to-false-alarm ratio grows the threshold \emph{falls}, driving the operator toward inspecting everything ambiguous (Figure~\ref{fig:r3reg})."
- **Proposed rewrite** —
  > Raising $C_{\mathrm{miss}}$ to $1000$ drops the bar to $6/1005\approx 0.006$ — the direction that matters: as the miss-to-false-alarm ratio grows the threshold *falls*, driving the operator toward inspecting everything ambiguous (Figure~\ref{fig:r3reg}). Now you try the other knob: hold $C_{\mathrm{miss}}{=}100$ and raise the false-alarm cost to $C_{\mathrm{fa}}{=}20$ — does the bar rise or fall, and by how much? (It rises, to $21/120=0.175$: attention that is expensive to waste buys back the operator's right to pass.) The misread to preempt: the theorem does not say the operator should inspect more. It says the *threshold* moves; whether that means more opens depends entirely on where the posterior mass sits, and an uncalibrated $a$ moves the threshold without moving the decision it was supposed to make.
  >
  > (An earlier draft of this program's signal-detection figure had the direction reversed; the likelihood-ratio statement leaves no room for that error.)
- **Priority** — **high**

### 5. Express lane and one-breath sentence are in the wrong order, and the express lane is not one sentence

- **Location** — §1 (`sec:intro`), L27 ("Express lane") and L29 (`\onebreath{...}`).
- **Issue** — Rail A inversion. The house rule is *one italic sentence first, formal statement in the box below*; the paper puts a four-clause 90-word paragraph at L27 and the actual one-breath sentence at L29, after it. An expert scanning for the express lane hits the dense paragraph first, which is the load the rail exists to remove.
- **Current text** — L27 begins "**Express lane.** One sentence per result, formal statements in the boxes." — then delivers four semicolon-joined result summaries.
- **Proposed rewrite** — move the `\onebreath{...}` block to immediately follow **The scene** (i.e. swap L27 and L29), and retitle L27:
  > **The four prices, one line each.** A zero-miss digest is a message that must single out a covering $m$-subset, so it costs $\log_2\binom{N}{k}-\log_2\binom{m}{k}$ bits (box in \S\ref{sec:floor}). One scalar head serves two readers iff their orders are comonotone, and oversight's two readers are not (box in \S\ref{sec:split}). The inspect-or-pass rule is a likelihood-ratio test, which makes "anomaly" a calibration obligation (box in \S\ref{sec:regret}). Pricing misses and flags separately yields a closed-form frontier $R(\delta,f)$ whose flagged set is then searched in $2k\lceil\log_2(F/k)\rceil+4k$ adaptive opens — the one theorem newly proved in this paper (boxes in \S\ref{sec:frontier}). *Experts can read the four boxes and stop there.*
- **Priority** — medium

### 6. Provenance tag for the 0/16 result disagrees between text and figure

- **Location** — L33 and L53 tag it `[internal, \texttt{a7\_experiment.py}]`; `figures/fig-r1-relation.tex` row 3 tags the same number `[verified, \texttt{a7\_experiment.py}]`.
- **Issue** — Direct violation of the numeric-claim provenance policy, which exists precisely because outside readers cannot distinguish the two tags unaided. A simulated 0/16 count is not externally recomputable from a closed form; `[internal]` is correct and the figure is wrong.
- **Current text** (figure) — `$0/16$ floor violations\\{[verified, \texttt{a7\_experiment.py}]}`
- **Proposed rewrite** (figure) — `$0/16$ floor violations\\{[internal, \texttt{a7\_experiment.py}]}`
- **Priority** — medium-high (cheap, and it is the one place the paper's own audit discipline visibly slips)

### 7. Theorem 3's caption formula and Theorem 3's inequality disagree

- **Location** — `figures/fig-r3-regime.tex` caption (kept verbatim from an earlier `paper1.tex`) states $a^\star=(c_{\mathrm{att}}+C_{\mathrm{fa}})/(c_{\mathrm{att}}+C_{\mathrm{fa}}+C_{\mathrm{miss}})=6/106$; the body text at L113 and the plotted crossing use $6/105$. The figure's own header comment flags this.
- **Issue** — Two non-equivalent closed forms for the same threshold, hidden by both rounding to "$\approx0.057$". Presentation defect, not a proof defect: solving the box's own inequality gives $a^\star=(c_{\mathrm{att}}+C_{\mathrm{fa}})/(C_{\mathrm{miss}}+C_{\mathrm{fa}})$.
- **Current text** (caption) — "Inspection pays exactly where the curves cross, $a^\star=(c_{\mathrm{att}}+C_{\mathrm{fa}})/(c_{\mathrm{att}}+C_{\mathrm{fa}}+C_{\mathrm{miss}})$"
- **Proposed rewrite** (caption) — "Inspection pays exactly where the two loss lines cross, at $a^\star=(c_{\mathrm{att}}+C_{\mathrm{fa}})/(C_{\mathrm{miss}}+C_{\mathrm{fa}})$ — the closed form obtained by solving Theorem 3's inequality directly. At the shown costs ($C_{\mathrm{miss}}{=}100$, $c_{\mathrm{att}}{=}1$, $C_{\mathrm{fa}}{=}5$) that is $6/105\approx0.057$ [verified]."
- **Priority** — medium-high

### 8. Theorem 1's box omits the two sanity endpoints that make it believable

- **Location** — §1 box, L43–49.
- **Issue** — Self-containment gap in the Move-4 box. The sibling whitepaper's version of this same theorem *does* carry the endpoints ("exact identification $m{=}k$ recovers $\log_2\binom Nk$; $m{=}N$ reduces the bound to zero"), and they are the fastest way for a reader to check the formula is the right shape. Paper 1 puts $m{=}N$ only in running prose (L53) and never states $m{=}k$.
- **Current text** — the box ends with the proof's $\square$ after "$2^B\binom{m}{k}\ge\binom{N}{k}$".
- **Proposed rewrite** — insert one sentence before the proof:
  > Two endpoints check the shape: at $m{=}k$ (the overseer opens exactly the criticals, no slack) the bound is $\log_2\binom{N}{k}$, the cost of naming the set outright; at $m{=}N$ (the overseer opens everything) it is zero, since no message is needed.
- **Priority** — medium

### 9. The `iff` at L108 asserts a converse the box does not deliver

- **Location** — §3 box, L108. Flagged by the linter (nine `iff` occurrences; this is the one whose converse is genuinely unargued in the box).
- **Issue** — Unhedged biconditional. The forward direction is the displayed algebra. The reverse — that *any* non-calibrated scalar requires precisely the correction $C_{\mathrm{miss}}\cdot g(s)$ — presumes a monotone calibration map $g$ exists, which is a modelling assumption, not a consequence.
- **Current text** —
  > "The product form $\mathrm{stakes}\times\mathrm{irrev}\times\mathrm{anomaly}$ is the exact ranking key iff $\mathrm{anomaly}=a$; any other anomaly scalar $s$ requires the correction $C_{\mathrm{miss}}\cdot g(s)$ with $g$ the empirical calibration map fit from the audit log."
- **Proposed rewrite** —
  > "The product form $\mathrm{stakes}\times\mathrm{irrev}\times\mathrm{anomaly}$ is the exact ranking key precisely when $\mathrm{anomaly}=a$; it is the *only* scalar for which the product equals expected unrecoverable loss, since that loss is $C_{\mathrm{miss}}(x)a(x)$ by definition. An anomaly scalar $s\ne a$ ranks correctly only up to a monotone reparametrisation: whenever a monotone calibration map $g$ with $g(s)=a$ exists, the corrected key is $C_{\mathrm{miss}}\cdot g(s)$, and $g$ is fit from the audit log. Where no such $g$ exists — where $s$ is not even monotonically related to the posterior — no rescaling of the product form recovers the optimal order."
- **Priority** — medium

### 10. L145 is a 260-word paragraph carrying four numbers, a cross-theorem consistency check, and an error confession

- **Location** — §4.1 (`sec:rdf`), "Numbers", L145.
- **Issue** — One-path-for-all / load dumping. The paragraph does four distinct jobs and the geometric-honesty note — genuinely one of the paper's best moments — arrives buried at the far end of it, exactly the "boundary in a trailing clause" shape the house style names.
- **Current text** — one paragraph beginning "**Numbers** ($p=0.05$): $R(0,0.05)=H(0.05)=0.286$ bits/symbol…" and ending "…with the same audit-the-meter discipline as \S\ref{sec:floor}'s wrong turn."
- **Proposed rewrite** — split into three paragraphs at the existing seams, with the third promoted to its own bold lead:
  > **Numbers by hand** ($p=0.05$): $R(0,0.05)=H(0.05)=0.286$ bits/symbol [verified, Cover--Thomas \cite{coverthomas}]; $R(0,0.10)=0.186$; $R(0.01,0.10)=0.110$; $R(0.04,0.06)=0.009$ [internal, \texttt{b1\_frontier.py}]. Reading: loosening the open budget cheapens the digest; tolerating misses cheapens it dramatically — two orders of magnitude between the guarantee corner and $(\delta,f)=(0.04,0.06)$ (Figure~\ref{fig:rdffrontier} shows the whole surface these four numbers sit on). *Now you try the flag-budget knob alone:* at $\delta{=}0$, is $R(0,0.20)$ above or below half of $R(0,0.10)$? (Above — $0.124$ against $0.093$; doubling the open budget a second time does not halve the digest again.)
  >
  > **Consistency with Theorem 1.** At $N{=}1000$, $R\cdot N\approx 186$ bits at $(0,2p)$, below the worst-case covering floor $\log_2\binom{1000}{50}\approx 282$ bits — an average-case rate sitting under a worst-case floor, as it must.
  >
  > **A second wrong turn, reported.** The pinned closed form holds only while $f<1-\delta/p$, the Proposition's stated regime where both constraints bind. Past that line an $X$-independent flagger already meets the miss budget on its own and the true rate is exactly $0$, not rising. An earlier plot that evaluated the pinned formula past this line showed a spurious uptick near $\delta/p\to1$ — a domain-of-validity error, not a feature of the true frontier. We flag it with the same audit-the-meter discipline as \S\ref{sec:floor}'s wrong turn: the failure mode is identical, a formula evaluated outside the region its derivation covers.
- **Priority** — medium

### 11. The limitations section points at a figure that is not in the paper

- **Location** — §6 (`sec:limits`), L213, last bullet.
- **Issue** — Dangling visual reference (the linter cannot catch it because it is prose, not `\ref`). `a7_figure.png` and its feature-corruption panel exist in `figures/` but are not `\input`'d anywhere in `paper1.tex`, so the reader is being asked to accept a caveat about something they cannot see.
- **Current text** —
  > "The feature-corruption panel of the same experiment is visually compressed at $m{=}8$ (the budget is generous enough that corruption barely moves in-range miss) and would need a tighter-$m$ rerun for a publication-grade figure."
- **Proposed rewrite** —
  > "The experiment's feature-corruption sweep — not reproduced here — is uninformative at $m{=}8$: the open budget is generous enough that corrupting the encoder's features barely moves the in-range miss rate, so that sweep neither supports nor undercuts the floor and would need a tighter-$m$ rerun before it could be shown at all."
- **Priority** — low-medium

### 12. "Bayes-optimal" and "optimal" are unqualified in five places

- **Location** — L21, L35, L80, L102, L213 (all five linter `optimal` hits).
- **Issue** — Unhedged superlative. Each is defensible but none names its class. L102 is the decisive one.
- **Current text** (L102) — "the Bayes-optimal policy inspects iff"
- **Proposed rewrite** (L102) — "among all policies that decide inspect-or-pass per item from its evidence alone, the Bayes-optimal one inspects iff". The same treatment at L80 ("realizes $r$'s optimal selection" → "realizes $r$'s loss-minimising selection at every budget $m$") and L21/L35 ("the Bayes-optimal surfacing rule" → "the Bayes-optimal per-item surfacing rule").
- **Priority** — low-medium

### 13. The `[verified]`/`[internal]` convention is defined at the end of the contributions list, after five tags have already fired

- **Location** — L38, after contributions 1–4 (L33–36) have used `[internal]` and `[verified]` a combined seven times.
- **Issue** — Minor definitions-after-use inversion, the mirror of definitions-first and equally avoidable.
- **Proposed rewrite** — move the sentence "Throughout, numbers are tagged \textbf{[verified]}… or \textbf{[internal]}…" to immediately before `\textbf{Contributions.}` at L31, as its own short paragraph. Leave the "Results 1--3 were derived…" sentence where it is.
- **Priority** — low

### 14. Related work's AI-oversight paragraph stops at 2018 while §4.1 advertises an August-2026 sweep

- **Location** — §5 (`sec:related`), "Attention and oversight", L201, against L133's "An August-2026 literature sweep found no prior false-negative-constrained lossy compression…".
- **Issue** — Missing-modern-citation *appearance*: the paper explicitly dates its sweep for the compression claim, so a reader reasonably infers the oversight paragraph was swept too — and it cites only Simon 1971, Sleator–Tarjan 1985, Irving 2018, GKR 2008. One clause fixes the inference without adding a citation the earlier accuracy pass did not vet.
- **Current text** — "…this paper is complementary --- it prices the \emph{interface} (the digest) rather than the protocol, and its floors apply to any oversight scheme whose human reads a bounded summary."
- **Proposed rewrite** — "…this paper is complementary — it prices the *interface* (the digest) rather than the protocol, and its floors apply to any oversight scheme whose human reads a bounded summary, including protocols proposed after the works cited here: the bound is on what a bounded-length summary can guarantee, so it constrains any protocol built on one."
- **Priority** — low

### 15. Sections that are already excellent — do not touch

- §1's "A wrong turn, reported" (L55) and its transferable rule are the best 80 words in the corpus; the falsification-first discipline is doing visible work.
- §4.2's "Positioning against group testing" (L186) is a model of honest attribution: it names exactly what is imported, exactly what is contributed, and volunteers that plain halving is a factor $\approx2$ from Hwang's optimum *by design*.
- §4.2's Theorem 4 proof (L161–180) introduces the halving tree, the $Q\le 1+2S^+$ accounting, and the two-regime charge in an order a reader can follow without backtracking, and the tightness construction is spelled out rather than asserted.
- L188's "Now you try the $k=1$ sanity case by hand" is a textbook Move-5 fade — one line of arithmetic, the answer checkable against the bound.

---

## Part B — Existing figures/tables: clarity audit

Seven `\input` fragments plus one unnumbered table. Rail B's "exactly two figures" applies per *result*, and the distribution is uneven: §1 has both kinds (relation-map + regime), §2 has regime only, §3 has regime only, §4 has three. The two missing relation-maps are Part A items 3 and 4; Part C proposes them.

### B1. `fig:r1rel` — R1 relation-map (`fig-r1-relation.tex`, `\input` at L72)

- **What it currently shows** — Two tall tinted rectangles (blue "Base", green "Target"), each holding three stacked blocks of small centred text, joined by three horizontal double-headed red arrows carrying relation labels ("one digest selects ONE covering"; "zero-miss needs $B\ge\log_2\binom Nk-\log_2\binom mk$"; "the floor holds exactly"). An italic footer restates the covering fact.
- **Intended takeaway** — That the digest *is* a message into a shared codebook, and that the covering ratio $\binom mk/\binom Nk$ is the entire proof.
- **Will they get it?** — Partially, and not from the graphic. Cleveland–McGill has nothing to grade here: no quantity is encoded on position, length, angle, area *or* colour. Every fact is carried by reading text, so the figure is a three-row table in fancy dress — it survives greyscale trivially and conveys nothing extra when it does. The caption is a genuine finding-caption ("each covering accounts for $\binom mk$ of $\binom Nk$ placements, which is the whole proof") and is the best part of the exhibit. The one relation a picture could carry — that an $m$-set's reachable placements are a *tiny fraction* of the possible ones — is stated numerically and never drawn.
- **Verdict** — **needs-fix**
- **Concrete fix** — Replace row 1's two text blocks with a drawn miniature at $N{=}6$, $k{=}1$, $m{=}2$: six labelled dots in a row on the base side; on the target side, three codewords drawn as brackets $\{1,2\}$, $\{3,4\}$, $\{5,6\}$ under a 2-bit message box, with each bracket shaded over the dots it covers. The reader sees $2^2=4\ge 3$ codewords and that the three brackets tile all six placements — the whole theorem, at a size that fits in a corner. Keep rows 2 and 3 as text. Also fix the `[verified, a7_experiment.py]` → `[internal, ...]` tag (Part A item 6).

### B2. `fig:r1reg` — R1 regime diagram (`fig-r1-regime.tex`, `\input` at L74)

- **What it currently shows** — Three step curves of $B^\star$ against $m/N$ at $k\in\{1,2,4\}$ ($N{=}60$), the region above the $k{=}2$ curve shaded, and the experiment's point $(m/N{=}0.133, 5.98)$ marked with an annotated callout.
- **Intended takeaway** — The floor is steep at tight budgets, falls monotonically, and vanishes only at $m{=}N$; the experiment sits on it.
- **Will they get it?** — Yes. The quantity is on position along a common scale, the strongest channel available; three curves with distinct dash patterns and distinct colours survive greyscale; the marked point ties the abstract number to the curve. Two small defects: the header comment concedes the $k{=}4$ curve is *clipped* at the top by an axis limit chosen for $k{=}2$ (a reader will read the flat top of the red curve as data), and the shaded "zero-miss possible" band is above the $k{=}2$ curve only — it silently means something different for the other two curves plotted in the same axes. The caption states a finding, correctly.
- **Verdict** — **works** (with two small fixes)
- **Concrete fix** — Raise `ymax` to `19` so the $k{=}4$ curve is whole, or drop $k{=}4$ and plot $k\in\{1,2,3\}$; and rename the shaded legend entry to "zero-miss possible ($k{=}2$ only)" so the scope of the shading is on the legend rather than in the source comment.

### B3. `fig:r2reg` — R2 regime diagram, two panels (`fig-r2-regime.tex`, `\input` at L96)

- **What it currently shows** — Panel (a): joint floor (blue squares) versus naive $2\times$ (green circles) against $k{=}1..4$ at $N{=}60,m{=}8$, with the gap between them shaded red as "penalty". Panel (b): the ratio $\mathrm{Floor}(2k)/(2\,\mathrm{Floor}(k))$ against $k$ for $m{=}8$ and $m{=}20$, with a dotted parity line at $1.0$.
- **Intended takeaway** — The joint floor exceeds twice the single floor; budgeting "two summaries" as "two × one summary" under-provisions.
- **Will they get it?** — From panel (b), yes; from panel (a), no. Panel (a) asks the reader to see a $6.7\%$ vertical gap between two lines on a $0$–$35$ axis at the marked point $k{=}2$ — at that scale the two curves are visually coincident for $k{=}1,2,3$ and only separate at $k{=}4$. The claim rides on a *difference of positions*, which Cleveland–McGill ranks well below position-along-a-common-scale, and here the difference is under one line-width for the point the paper actually cares about. The shaded "penalty" wedge is an area encoding of that same difference — weaker again. Panel (b) fixes all of this by plotting the ratio directly against a parity baseline, which is exactly right. Both panels survive greyscale (solid-square blue vs dashed-circle green). The caption states the finding but states the *wrong* finding — the "1.05–1.08 across the swept regimes" contradicted by panel (b)'s own $1.39$ (Part A item 1).
- **Verdict** — **needs-fix**
- **Concrete fix** — Demote panel (a): either drop it and give panel (b) full width, or replot it as the *difference* $\mathrm{Floor}(2k)-2\,\mathrm{Floor}(k)$ in bits (values $0.17$, $0.80$, $2.26$, $5.72$ for $k{=}1..4$) as a bar chart, so the quantity the paper claims is the quantity on the axis. Then correct the caption to the finding panel (b) actually shows: "the penalty exceeds $1$ everywhere and grows with $k$ — $1.07$ at the reference regime, $1.39$ by $k{=}10$."

### B4. `fig:r3reg` — R3 regime diagram (`fig-r3-regime.tex`, `\input` at L119)

- **What it currently shows** — Two straight lines against the calibrated posterior $a$ on $[0,0.2]$: loss-if-ignored $100a$ (rising, blue) and loss-if-inspected $1+5(1-a)$ (nearly flat, green), crossing at $a^\star=0.0571$; the region $a>a^\star$ shaded; a red dashed vertical at the crossing; a callout box; and a grey italic note reading "raising $C_{\mathrm{miss}}$ LOWERS the bar — the corrected SDT direction".
- **Intended takeaway** — Inspection pays exactly at the crossing, and the crossing moves *left* as the miss cost rises.
- **Will they get it?** — Half of it. The crossing itself is perfect: two lines, position channel, an unmistakable intersection, greyscale-safe via slope alone. But the second and more interesting half — the *direction* the threshold moves — is not drawn at all; it is asserted in a grey text box floating in the upper right. That is the failure mode the caption rules are written against, transplanted into an annotation: the figure names a finding it does not show. The paper's own history makes this the worst place to leave the direction undrawn, since an earlier draft had it reversed (L113, L202). Caption states a finding, but via the formula that disagrees with the body text (Part A item 7).
- **Verdict** — **needs-fix**
- **Concrete fix** — Add a second rising line $1000a$ in a lighter tint of the same blue with its own crossing marked at $a\approx0.006$, and an arrow along the $x$-axis from $0.057$ to $0.006$ labelled "$C_{\mathrm{miss}}$: $100\to1000$". Delete the grey text box — the arrow now *is* the statement. Optionally add a small inset of $a^\star$ against $C_{\mathrm{miss}}$ on log-$x$, a single monotone falling curve, which makes the direction a shape rather than a pair of points.

### B5. `fig:rdffrontier` — the two-constraint frontier (`fig-paper1-rdf-frontier.tex`, `\input` at L147)

- **What it currently shows** — A $21\times21$ interpolated heatmap of $R(\delta,f)$ over $f\in[0.04,0.16]$, $\delta\in[0,0.049]$, white→harborblue, with a colourbar; a grey infeasible wedge at bottom-left; a red dashed line $f=1-\delta/p$ labelled "$R=0$ beyond here"; and the four "Numbers" values marked with callout boxes.
- **Intended takeaway** — Loosening either budget cheapens the digest; past the dashed line it is free; the four quoted numbers live on this surface, and the zero-miss corner is Theorem 1's.
- **Will they get it?** — The qualitative shape, yes. The quantitative claim, no — and the quantitative claim is the one the prose makes. $R$ is encoded entirely on a sequential colour ramp, the weakest channel in the Cleveland–McGill ordering, on a *linear* scale spanning $0$ to $0.30$. The prose's headline ("two orders of magnitude between the guarantee corner and $(0.04,0.06)$", i.e. $0.286$ vs $0.009$) is unreadable from a linear ramp where $0.009$ and $0$ are indistinguishable; the reader gets it only from the four printed callout numbers, which means the heatmap is scaffolding for its own annotations. It does survive greyscale — the ramp is monotone in lightness, and the dashed line and grey wedge stay legible. There is real redundancy with `fig:r4reg` Panel A, which plots the *same* function on position and is therefore strictly more readable for the same claim. One caption/graphic mismatch: the caption says "the small hatched wedge", but the TikZ version deliberately replaced the hatch with plain grey fill (documented in the fragment's header). `[needs render]` for whether the four callout boxes and the "$R=0$ beyond here" box collide at final width.
- **Verdict** — **needs-fix**
- **Concrete fix** — (i) Change `point meta` to a log or square-root scale, or switch to a filled-contour with *labelled* isolines at $0.01/0.03/0.10/0.20/0.28$ so the two-orders-of-magnitude claim is readable as contour spacing rather than as hue. (ii) Fix "hatched wedge" → "grey wedge" in the caption. (iii) Consider retiring `fig:r4reg` Panel A into this figure as an inset slice at $\delta{=}0$, removing the duplication and giving the surface a position-encoded cross-section.

### B6. `fig:r4rel` — R4 relation-map (`fig-r4-relation.tex`, `\input` at L194)

- **What it currently shows** — The same base∥target∥arrows grammar as B1, three rows: (1) single-constraint RD → two-constraint RD, arrow "a SECOND knob: flags buy back bits"; (2) $\delta{=}0$ → $R(0,f\to p)=H(p)$, arrow "$\delta{=}0$ boundary $\Leftrightarrow$ entropy floor"; (3) Twenty Questions → group-splitting zoom, arrow "pays ONLY in the sparse regime".
- **Intended takeaway** — Per the caption, only row 3: twenty questions maps to group-split inspection, and the misread it invites ($\log_2 F$ questions suffice) is what Theorem 4 corrects.
- **Will they get it?** — No, for two compounding reasons. First, the caption describes one row and the figure draws three — the fragment's own header comment concedes this. A reader arriving at L150's "(Figure~\ref{fig:r4rel})" mid-analogy is handed a diagram whose top two-thirds are about the rate–distortion program from the *previous* subsection. Second, and worse, row 3's target cell states the zoom cost as "$k\cdot\log_2(F/k)$ opens" — the **ideal**, not Theorem 4's $2k\lceil\log_2(F/k)\rceil+4k$. The figure therefore asserts the very quantity the caption says the theorem corrects, and the section's whole point is the factor-of-two-plus gap between them. Same channel critique as B1: nothing is encoded except text. Greyscale-safe.
- **Verdict** — **needs-fix**
- **Concrete fix** — Split it. Rows 1–2 become a small two-row map placed in §4.1 next to the Proposition (where they belong); row 3 becomes the standalone zoom relation-map cited at L150, with the target cell corrected to read "$\le 2k\lceil\log_2(F/k)\rceil+4k$ opens (Thm.\ 4) versus $F$ flat; ideal $k\log_2(F/k)$ is a factor $\approx2$ below" and one drawn halving tree at $F{=}8,k{=}2$ underneath showing the fork — that fork is the misread the caption promises to preempt, and it is currently nowhere in the figure.

### B7. `fig:r4reg` — R4 regime diagram, two panels (`fig-r4-regime.tex`, `\input` at L196)

- **What it currently shows** — Panel A: $R(\delta,f)$ against $f$ for $\delta\in\{0,0.01,0.04\}$ with the four numbers marked. Panel B: log–log plot of the **idealised** advantage $F/(k\log_2(F/k))$ against flagged-set density $k/F$ over $[10^{-3},0.7]$, with everything above parity shaded "zoom wins", a dashed parity line, and the measured $(0.004,15.3\times)$ marked.
- **Intended takeaway** — Panel A: the rate surface as slices. Panel B: this is the *boundary* figure — where zoom stops paying.
- **Will they get it?** — Panel A: yes, cleanly. Position channel, three distinguishable line styles, greyscale-safe, and the corrected $\delta{=}0.04$ clipping (documented in the fragment header) removes a real bug present in the source script. Panel B: **it shows the opposite of the paper's boundary.** It plots the *ideal* $k\log_2(F/k)$, which never crosses parity anywhere in the plotted range, so the shaded "zoom wins" band covers the entire chart — and the honest boundary the section spends a paragraph on (L192: at $F{=}100,k{=}90$ adaptive halving costs $199$ opens against $100$ flat) is off the right edge and invisible. The caption *admits* this in a subordinate clause: "the plotted idealization never crosses parity, but the deployed algorithm's constant overhead does invert the ordering at higher density still". A regime diagram whose shaded region contradicts the result's stated boundary is the single most consequential figure defect in the paper — Rail B exists precisely so the boundary has a picture, and this picture argues against it. `[needs render]` for whether the "measured $15.3\times$" box clears the curve (it overlaps in the PNG).
- **Verdict** — **needs-fix** (Panel B), works (Panel A)
- **Concrete fix** — Replot Panel B with the **deployed** guaranteed advantage $1/\bigl(d(2\lceil\log_2(1/d)\rceil+4)\bigr)$ as the primary curve, keeping the ideal as a faint dashed reference so the factor-$\approx2$ gap is visible as the distance between them. Extend $x$ to $0.95$. Shade only the region where the deployed curve exceeds $1$, i.e.\ $d\le 1/12$. Mark three points: $(0.004, 12.5\times)$ guaranteed with the measured $15.4\times$ just above it; the parity crossing at $d=1/12\approx0.083$; and $d{=}0.9$, where the guarantee is $0.19\times$ and the measured $F{=}100,k{=}90$ run gives $0.50\times$ — currently outside the axes entirely. Values for the primary curve: $d{=}0.001\to 41.7\times$; $0.004\to 12.5\times$; $0.01\to 5.6\times$; $0.05\to 1.43\times$; $0.083\to 1.00\times$; $0.1\to 0.83\times$; $0.5\to 0.33\times$; $0.9\to 0.19\times$. Retitle the shaded band "zoom wins (deployed algorithm)". This one change makes §4's honest boundary visible instead of contradicted, and it is also what makes Part A item 2 legible at a glance.

### B8. The unnumbered provenance table (L57–70)

- **What it currently shows** — Six rows in a bare `center`+`tabular` (booktabs rules): floor, joint floor, ratio, super-additivity, oracle violations, wrong-turn violations — each with a value and a provenance tag.
- **Intended takeaway** — All of §1's and §2's headline numbers in one place, each with its evidence tier attached.
- **Will they get it?** — Mostly, and this is a good table: the provenance column is exactly the discipline the house style asks for, and putting the wrong-turn $8/14$ in the same table as the results rather than in a footnote is admirable. Three defects. (i) It is not a `table` environment — no number, no `\label`, so nothing in the text can point at it and it cannot float sensibly. (ii) It has **no caption at all**, so it names its parts and states no finding — the one exhibit in the paper that fails the caption rule outright. (iii) The Value column mixes bits ($5.98$), pure ratios ($2.13\times$, $1.07$) and count fractions ($0/16$, $8/14$) in one right-aligned column, so vertical scanning compares incomparable things; the two fractions are results of a different kind from the four closed-form quantities.
- **Verdict** — **needs-fix**
- **Concrete fix** — Wrap in `\begin{table}[t]…\label{tab:numbers}` and add a finding-caption:
  > **Table 1.** Every headline number in §\ref{sec:floor}–§\ref{sec:split}, with its evidence tier. The four closed-form quantities are recomputable by hand from Theorem 1; the two fractions are simulation counts, including the wrong turn's $8/14$ spurious violations, retained rather than deleted. The pairing that matters: the joint floor is $12.77$ bits where naive doubling budgets $11.96$.

  Add a horizontal `\midrule` between the four closed-form rows and the two count rows, and reference the table from L51 and L91.

---

## Part C — New figures/examples proposed

### C1. The composition window — where a cheap digest and a cheap zoom can both be bought

- **Where** — §4, immediately after the rewritten "What the frontier plus the theorem buy" paragraph (L190), before "The dense-flag boundary, stated".
- **What it would show** — $x$: the flag-budget ratio $f/(p-\delta)$ on log scale from $1$ to $300$. Two $y$-quantities on a twin axis: left, stage-one digest cost $R(\delta,f)\cdot N$ in bits (falling); right, stage-two guaranteed advantage $1/\bigl(d(2\lceil\log_2 (1/d)\rceil+4)\bigr)$ at $d=(p-\delta)/f$ (rising). Shade the region right of $f/(p-\delta)=12$ where the advantage exceeds $1$. Mark the paper's own three operating points on the $x$-axis: $f{=}p,\delta{=}0$ (ratio $1$, advantage $0.25\times$); $f{=}2p,\delta{=}0$ (ratio $2$, $0.33\times$); the Corollary's $(F,k)=(2500,10)$ (ratio $250$, $12.5\times$).
- **Why it helps** — It is the only place the paper's two theorems are made to face each other quantitatively. As written, §4.1 and §4.2 are calibrated at densities that differ by two orders of magnitude and the prose steps over the gap; this figure makes the trade a shape ("bits saved on the left are paid in opens on the right, and there is a window") instead of two unconnected results with a connecting paragraph. It also supplies the sentence Part A item 2 needs: $f\ge 12(p-\delta)$.
- **Kind** — regime-diagram

### C2. The covering codebook at $N{=}6,k{=}1,m{=}2$

- **Where** — §1, inside or immediately beside the "Numbers by hand" paragraph (L51), or folded into `fig:r1rel` row 1 per B1.
- **What it would show** — Six labelled dots in a row. Below them, three brackets $\{1,2\}$, $\{3,4\}$, $\{5,6\}$, each shaded over its two dots, each tagged with a 2-bit codeword `00`/`01`/`10`. A caption line: $\log_2 6-\log_2 2=1.585$, so two bits, four available codewords, three used, every placement covered.
- **Why it helps** — Theorem 1's proof is a counting argument, and counting arguments become obvious the moment the reader sees one complete instance. The current Move-5 is arithmetic on $N{=}60$ — verifiable but not *visible*; nobody can picture $\binom{60}{2}=1770$ placements. At $N{=}6$ the reader sees the entire codebook, sees why a fourth codeword would be slack, and sees why $m{=}1$ would need three bits. This is the worked-example effect applied to the paper's foundational result.
- **Kind** — worked-numeric-example (drawn)

### C3. The crossing pair — the two items that break the shared head

- **Where** — §2, immediately after the Theorem 2 box (L83), before the super-additivity claim.
- **What it would show** — A single scatter panel: $x$ = successor value (continuation value), $y$ = operator regret (regret-if-ignored). Two points only, labelled. $A$ = "routine working state, mid-refactor" at high $x$, near-zero $y$. $B$ = "abandoned dead-end that dropped a table" at zero $x$, maximal $y$. Two grey rank-arrows down the margins: successor order $A\succ B$ on the right, operator order $B\succ A$ on the left, pointing opposite ways.
- **Why it helps** — Theorem 2's proof is one sentence of order theory and one *constructed pair*, and the pair is where all the persuasive force lives. Right now that pair is a 40-word parenthetical inside the box (L80), which is the hardest place in the paper to read it. Drawn, the crossing is immediate and the reader can supply their own third example — which is the fastest possible check that the theorem's hypothesis is met in their fleet, and hence that its conclusion binds on them.
- **Kind** — relation-map (degenerate — two objects, two orders, crossing arrows)

### C4. Thermometer → scalar head, the Move-3 map §2 is missing

- **Where** — §2, with the analogy paragraph proposed in Part A item 3, before the box.
- **What it would show** — Standard base∥target∥arrows grammar. Base: one mercury column; two readers (nurse, pharmacist) reading it; the note "both want the hottest first — orders agree". Target: one scalar head $h$; successor and operator reading it; "one wants highest fit, one wants highest regret — orders cross". Arrows: "one scalar ⇒ exactly one total order"; "two readers served ⟺ their orders never cross"; "crossing pair exists in fleets ⇒ no shared head".
- **Why it helps** — Restores Rail B for §2 and, more importantly, carries the *ordinal* nature of the obstruction, which the prose never quite isolates. The arrow "one scalar ⇒ exactly one total order" is the whole theorem; a reader who has that arrow can derive the ($\Rightarrow$) direction unaided, which is Gentner's test for whether the analogy is structural or decorative.
- **Kind** — relation-map

### C5. Smoke detector → the inspect-or-pass rule, the Move-3 map §3 is missing

- **Where** — §3, before the Theorem 3 box (L101).
- **What it would show** — Base: a smoke detector; sensitivity dial; the two error costs (house burns down / burnt toast wakes you at 3am); the note "the dial's right setting depends only on the *ratio* of those two". Target: the surfacing rule; the threshold $a^\star$; costs $C_{\mathrm{miss}}$ and $c_{\mathrm{att}}+C_{\mathrm{fa}}$. Arrows: "expected loss = magnitude × probability"; "raise the fire's cost ⇒ lower the alarm's threshold"; "a detector that cries wolf is not miscalibrated in *sensitivity* — it is miscalibrated in *probability*".
- **Why it helps** — The third arrow is the section's actual thesis (calibration is the obligation, not tuning) and the prose currently delivers it only as an aside at L108 and a limitation at L210. It also gives the reader the correct intuition for the counterintuitive direction — that raising the miss cost *lowers* the bar — which the paper has already got wrong once in an earlier draft.
- **Kind** — relation-map

### C6. Calibration sensitivity — the regime diagram Theorem 3's boundary does not have

- **Where** — §3, after the reputation claim (L117), or in §6 beside the bullet at L210.
- **What it would show** — $x$: reported anomaly $s$ on $[0,1]$. $y$: the true posterior $a=g(s)$. The diagonal $g=\mathrm{id}$ (perfect calibration) plus two off-diagonal curves — an overconfident scorer ($g$ below the diagonal) and an underconfident one ($g$ above). On the $x$-axis, mark where each scorer *believes* the threshold is versus where it truly is; the horizontal gap between the two marks is the excess loss the section warns about, shaded.
- **Why it helps** — §3 is the only result in the paper whose limitation ("exactly as good as its calibration") has no picture anywhere, and it is arguably the limitation most likely to bite a practitioner, since every fleet dashboard already ships an uncalibrated anomaly score. The figure converts "fit $g$ from the audit log" from an instruction into a visible amount of damage.
- **Kind** — regime-diagram

### C7. The two-stage pipeline, with numbers on every arrow

- **Where** — §4 opening (L122), as the section's orientation figure.
- **What it would show** — Left-to-right: $N$ artifacts → [digest, $R(\delta,f)\cdot N$ bits] → $F=fN$ flags → [zoom, $\le 2k\lceil\log_2(F/k)\rceil+4k$ group opens] → $k$ criticals. Under each arrow, one worked instance in the sparse regime the composition actually supports. Above the first box, a dotted back-edge to Theorem 1 labelled "$\delta{=}0$, $f\to p$: the covering floor".
- **Why it helps** — §4 introduces "a three-way dial with exact exchange rates" (L190) and then never draws the dial. Readers currently have to hold the pipeline in their head across five pages of rate–distortion and group-testing. It is also the natural place to make the $\delta{=}0$ corner's identity with Theorem 1 a *drawn* back-edge rather than a claim made twice in prose (L145, L190).
- **Kind** — relation-map

---

## Part D — Cross-reference notes

`whitepaper/source/legible-swarm.tex` (2253 lines, "Legible Swarm") is **strongly related** — it is the popular-facing volume for exactly this material. Its §6.4 `sec:lowerbound` states paper 1's Theorem 1; its §7.2 `sec:relevance` states paper 1's Theorem 2 under a different name; its §5.1 `sec:sdt` is paper 1's Theorem 3 in signal-detection dress; and its §3 `sec:zoom` and §8.2 `sec:tokens-digest` are the mechanism paper 1 prices. Five drifts worth reconciling:

1. **"Zoom" means two different things across the corpus.** In the whitepaper, `\begin{definition}[The one law: digest-with-zoom]` defines a read-surface as a pair $(\sigma,\zeta)$ where $\zeta$ is a *total function from every summarised claim to a verifiable artifact* — zoom as **verifiability**, the anti-Potemkin guarantee. In paper 1 §4.2, "zoom" is **adaptive group search** over a flagged set (Theorem 4). Both documents even carry `\label{sec:zoom}`. A reader coming from the whitepaper will open paper 1's "zoom-advantage theorem" expecting a result about link integrity. Recommend paper 1 add one clause at L149: "*zoom* here means the second-stage search over the flagged set, not the whitepaper's digest-to-artifact link relation $\zeta$ — the two are complementary: $\zeta$ makes an open *possible*, Theorem 4 bounds how many opens are *needed*."

2. **Symbol collision on `a`.** The whitepaper's `def:sdt` uses $a$ for the *per-decision attention cost*; paper 1 uses $a(x)$ for the *calibrated posterior* and $c_{\mathrm{att}}$ for attention cost. Same letter, adjacent results, opposite roles — a direct violation of the one-alphabet rule read across the pair. $C_{\mathrm{miss}}$ and $C_{\mathrm{fa}}$ agree in both, which makes the clash on $a$ more likely to be missed. Recommend the whitepaper rename its attention cost to $c_{\mathrm{att}}$ to match paper 1, since paper 1's $a$ is essential in a boxed theorem.

3. **critical-set notation drift.** Whitepaper `thm:lowerbound`: unknown subset $S$, review set $\hat S$, condition $S\subseteq\hat S$, $|\hat S|\le m$. Paper 1 Theorem 1: subset $T$, review set $d(e(\cdot))$, condition $T\subseteq d(e(\cdot))$. Paper 1 then reuses $P$ for the positive set in Theorem 4 — a third letter for the same concept within one document. Recommend $S$ throughout both, and $\hat S$ for the opened set, retiring $T$ and $P$.

4. **The whitepaper's version of Theorem 1 is missing paper 1's decoder hypothesis.** `thm:lowerbound` says "a digest maps each possible $S$ to a review set" with no data-independence condition; paper 1's box correctly requires "a data-independent decoder $d$". Paper 1 is the careful statement and the whitepaper the loose one, which is the right direction for a popularisation — but the whitepaper should carry a pointer ("the precise hypothesis, and what it excludes, is Paper 1 Thm.\ 1") so the two are not read as identical claims. Conversely, the whitepaper's statement carries the two sanity endpoints ($m{=}k$ and $m{=}N$) that paper 1's box omits — the basis for Part A item 8.

5. **Two names for Theorem 2.** Whitepaper: `thm:split-ranker`, "No universal monotone identification of the two heads", stated as the non-existence of a strictly increasing $\phi$ with $\mathrm{regret}=\phi(\mathrm{fit})$. Paper 1: "Theorem 2 (comonotone characterization)", stated as an iff. Paper 1's is the stronger and more general form (it characterises *when* sharing works, not only that this instance fails), and it should say so — one clause at L94 pointing at the whitepaper's version as the special case would let the corpus be read in either order. The readers are also named differently: whitepaper "discovery ranker" vs "attention queue"; paper 1 "successor" vs "operator". The whitepaper's `eq:regret` is character-for-character paper 1's product form, so the naming is the only gap.

---

## Summary

1. **The R4 Panel B regime diagram argues against the paper's own honest boundary.** It plots the idealised $F/(k\log_2(F/k))$, which never crosses parity, so the "zoom wins" band covers the whole chart while §4 spends a paragraph explaining that the deployed algorithm *loses* at high density — and the caption concedes it in a subordinate clause. Replotting the deployed bound $1/(d(2\lceil\log_2(1/d)\rceil+4))$ out to $d{=}0.95$ fixes it and yields a crisp new boundary: zoom pays only for $d\le 1/12$. (B7, C1)

2. **§4's two halves are calibrated at incompatible densities and the joining paragraph steps over the gap.** Flagged-set density is $(p-\delta)/f$, which at the paragraph's own numbers ($p{=}0.05$, $f{=}2p$) is $0.5$ — dense, where the *next* paragraph says the advantage inverts. The composition pays only when $f\ge12(p-\delta)$; saying so converts an internal contradiction into the paper's sharpest practical result. (A2)

3. **"Super-additivity $1.05$–$1.08$ across regimes [verified]" is contradicted by its own figure**, whose plotted data reaches $1.22$ at $k{=}4$ and $1.39$ at $k{=}10$; only the single $k{=}2$ point falls in the band. The figure fragment flags this in a header comment nobody has acted on. The correction makes the claim stronger, not weaker. (A1, B3)

4. **§2 and §3 are missing both rails.** Neither has a structural analogy or a relation-map, though the house repertoire already assigns them bases (thermometer, smoke detector); §3 additionally lacks a reader fade and any inline boundary. §1 and §4 have all of it, so the middle of the paper reads as a different document. (A3, A4, C3–C6)

5. **Smaller, cheap, and worth doing together:** the $0/16$ result is tagged `[internal]` in the text and `[verified]` in the figure; `fig:r3reg`'s caption formula is not algebraically the one Theorem 3's box implies; the provenance table has no `table` environment, no label, and no caption; the express lane and the one-breath sentence are in the wrong order; and `fig:r4rel`'s target cell states the ideal $k\log_2(F/k)$ — the exact quantity its own caption says Theorem 4 corrects. (A5–A7, B4, B6, B8)
