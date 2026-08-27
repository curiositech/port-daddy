# Exposition + Figure Review: Reputation is Amortized Verification — Inspection Games for Agent Economies (paper3.tex)

Paper 3 of the Harbor research program (B2/R7, executed), 216 lines of LaTeX — the shortest of the seven — carrying three results: the stage-game deterrence threshold with its settlement-convention fork ($\rho^\star = G/(dB)$ vs. $\rho^\star_c = G/(d(G{+}B))$), the tower-contraction theorem for sealed sampling from $C$ disjoint cliques, and the amortization theorems ($\Theta(T)$ / $\Theta(\log T)$ / $O(1)$ lifetime audit spend). Its role in the corpus is to close the source volume's Conjecture III.11.1 (the grading-oracle / rate-the-raters problem) — the same conjecture the public whitepaper `spawn-to-person.tex` poses as an open starred exercise — and to supply the deterrence arithmetic that the economics chapters cite. It is a genuinely good paper: the vocabulary section, the pre-saturation caveat in §5, and the honest-boundaries box are among the best writing in the program. The problems below are almost entirely *localized to one story*: the paper corrected its clique claim in the body but left the old, stronger version standing in the express lane, the one-breath sentence, the misread-to-preempt, the theorem box, and two of the three figures.

**Tooling notes.** `skills/research-paper-submission/scripts/submission_lint.py` does not exist in the tree; only the compiled `__pycache__/submission_lint.cpython-311.pyc` survives. I ran that directly (`python3 skills/research-paper-submission/scripts/__pycache__/submission_lint.cpython-311.pyc docs/harbor-research/tex/paper3.tex --figures-dir docs/harbor-research/figures`): **0 errors, 0 warnings, 3 claims-to-confirm** — the sole `unbounded` hit is line 117's *"not an unbounded one"*, which is a disclaimer, not an overclaim, and `iff`×12 / `if and only if`×1, all of which are genuinely two-sided in this paper. `skills/research-paper-submission/references/figures-and-examples.md` also does not exist; the Cleveland-McGill / greyscale / caption-states-the-finding criteria below are applied from `figures/CONVENTION.md` and `harbor-exposition/references/style-template-v2.md` Rail B. No LaTeX toolchain exists here — anything requiring a compile is marked **[needs render]**.

**Verdict on the recent additions.** The line-125 paragraph ("The threshold is per level") and the line-131 paragraph ("What the clique multiplier actually buys") both still read as **patched-in corrections, not landed exposition** — see A1, A2, A3. The "unbounded depth" removal was done in the prose but **missed two live occurrences in `fig-r7-relation.tex`** and one implicit occurrence in `fig-r7-regime.tex`'s inset — see B1, B2. That is the single most important finding in this review.

---

## Part A — Text/exposition changes

### A1. The one-breath sentence still asserts the claim §4 spent a paragraph retracting

**Location:** line 29 (Move 2, `\onebreath{}`), and its echoes at line 23 (express lane) and line 31 (misread-to-preempt).

**Issue:** *Overclaim surviving a correction* — the corrective paragraph at line 131 says clique diversity is **not** what makes the tower converge, but the paper's single most-quoted sentence says it is, as a proviso. Compounded by **One Path For All Readers**: the express lane is the expert's whole reading, and it is the version that is wrong.

**Current text** (line 29):

> *Honesty holds when expected punishment beats the bribe; the tower of auditors converges, because each level has geometrically less corruption left to protect, provided judges are drawn sealed from enough independent camps that no single deal buys them all; and the audit rate an old judge needs falls with the reputation it would forfeit --- so reputation is amortized verification.*

and (line 31):

> The former needs diversity ($C>1$) plus finite bonds, because what each level protects shrinks;

and (line 23):

> stacking auditors sampled sealed from $C$ independent cliques makes bribery collapse geometrically at logarithmic depth on finite total bond;

**Proposed rewrite** — line 29:

> *Honesty holds when expected punishment beats the bribe; the tower of auditors converges on finite bond capital because each level has geometrically less corruption left to protect, and drawing judges sealed from $C$ independent camps buys down the depth by shutting off the phase where bribery still pays; and the audit rate an old judge needs falls with the reputation it would forfeit --- so reputation is amortized verification.*

line 31 (replace the clause after "The former needs"):

> The former needs only finite bonds and a sealed draw, because what each level protects shrinks geometrically once bribery stops paying; clique diversity ($C>1$) buys depth and capital, not convergence.

line 23 (replace the middle clause):

> stacking auditors sampled sealed from $C$ independent cliques shuts off the bribery-profitable phase, leaving a geometric collapse that finite total bond certifies at logarithmic depth;

**Priority:** **high.** This is the express-lane/box done-test failing: an expert who reads only line 23 and the box comes away with the pre-correction claim.

---

### A2. The theorem box states the depth formula without the precondition that makes it true

**Location:** line 117, final sentence of `\begin{theorem}[Tower contraction]`.

**Issue:** *Boundary burial inside the box.* The box is supposed to be self-contained and quotable cold (style-template-v2, Move 4). As written it gives one depth, $\lceil \log G_0 / \log\frac{1}{1-\rho d}\rceil = 27$ levels, $1350$ of bond — but line 131 shows that at $C{=}1$ the true answer is $53$ levels and $2650$. The number in the box is the $G_0 \le CB$ case only, and the box never says so. This is precisely why the line-131 paragraph has to open by apologizing for the reader's "natural reading": the overclaim is upstream, in the box.

**Current text** (line 117):

> Consequently \emph{finite} bond capital certifies a tower deep enough to drive surviving corrupt value below any fixed unit: $B$ per level for $\lceil \log G_0 / \log\frac{1}{1-\rho d} \rceil$ levels --- a depth logarithmic in the initial corrupt value, not an unbounded one.

**Proposed rewrite:**

> Consequently \emph{finite} bond capital certifies a tower deep enough to drive surviving corrupt value below any fixed unit, at $B$ per level. If $G_0 \le CB$ the tower is geometric throughout and the depth is $\lceil \log G_0 / \log\tfrac{1}{1-\rho d} \rceil$. If $G_0 > CB$, a linear phase of $\lceil (G_0 - CB)/(C\rho d B) \rceil$ levels precedes it, during which the briber bleeds $C\beta$ per level; the total is still finite, and the depth is logarithmic in $G_0$ in both regimes once the linear phase is passed. Raising $C$ shortens or removes the linear phase; it does not change the geometric rate $(1-\rho d)$, which is what makes the tower converge.

(Both closed forms check out at the running parameters: $C{=}1 \Rightarrow \lceil 350/10\rceil = 35$ linear $+\ \lceil\log 50/\log 1.25\rceil = 18$ geometric $= 53$; $C{=}2 \Rightarrow \lceil 300/20\rceil = 15 + 21 = 36$; $C{=}8 \Rightarrow 0 + 27 = 27$. These are the numbers already quoted at lines 129, 131 and 169.)

**Priority:** **high.** Fixing the box lets A3 shrink the two patch paragraphs rather than adding a third.

---

### A3. The two new paragraphs are ordered as corrections rather than as exposition

**Location:** lines 125 ("The threshold is per level…"), 129 ("Numbers by hand"), 131 ("What the clique multiplier actually buys").

**Issue:** *Patched-in correction* + forward reference. Line 125 uses $35$ levels, $\times 10$ per level, $G_0 = 400$, and $50$ — none of which have been introduced yet; the running tower parameters are first stated at line 129. And line 131 opens by telling the reader that the paragraph they just read misled them:

**Current text** (line 131, opening):

> It is worth being exact here, because the natural reading of the previous paragraph overstates the case.

**Current text** (line 129, the sentence that creates the misreading):

> At $C{=}1$: the profitability threshold is $G_k > 50$, so bribery persists at first and corruption bleeds only the bribe bill $C\beta = 10$ per level: $400 \to 390 \to 380 \to \cdots$ [internal, \texttt{b2\_tower.py}].

**Proposed rewrite** — three moves, no new prose net:

1. **Move line 125 to immediately after line 131**, so the per-level/multi-level scoring argument (which is a proof-scope remark) sits after the reader has the parameters and both recursions in hand. Retitle it **"Why the per-level condition suffices."**
2. **Rewrite the $C{=}1$ sentence in line 129** so it terminates its own recursion, which removes the overstatement at the source:

> At $C{=}1$: the profitability threshold is $G_k > 50$, so bribery still pays at first, and corruption bleeds only the bribe bill $C\beta = 10$ per level --- $400 \to 390 \to 380 \to \cdots$ --- for $35$ levels, until $G_k$ reaches $50 = CB$ and the geometric phase takes over for $18$ more: $53$ levels, $2650$ of bond capital [verified, arithmetic; regenerates from \texttt{b2\_tower.py}]. At $C{=}8$: the threshold is $G_k > 400$, not met even at level 0, so there is no linear phase at all and the collapse is geometric from the start at $(1-\rho d) = 0.8$ per level: $400 \to 320 \to 256 \to 204.8 \to \cdots$, reaching below one unit in $\lceil \log 400/\log 1.25\rceil = 27$ levels for $1350$ of bond [internal / verified, arithmetic].

3. **Rewrite line 131's opening** so it delivers a finding rather than a retraction:

> \textbf{What the clique multiplier actually buys.} Set the two runs side by side and the multiplier is precisely a factor of two in certified depth and capital --- $53$ levels and $2650$ against $27$ and $1350$ --- not the difference between a tower that converges and one that does not. Both converge. Raising $C$ \emph{removes the linear phase}, because the profitability threshold $CB$ rises past $G_0$; the geometric phase, and the rate $(1-\rho d)$ that drives it, are common to both. That is a real and budgetable saving, and it is the whole of the claim. \emph{Now you try:} at $C{=}2$, what is the per-level bleed while bribery remains profitable, and where does the linear phase stop? ($C\beta = 20$ per level: $400 \to 380 \to 360 \to \cdots$, until $G_k \le CB = 100$ after $15$ levels, where the decay turns geometric for a further $21$ --- $36$ levels, $1800$ of bond.)

**Priority:** **high.** After A2 and A3, the paper never makes the overclaim, so it never has to walk one back — which is what "landed" means.

---

### A4. The "multi-level programme" paragraph argues with a referee in the reader's hearing

**Location:** line 125, final sentence.

**Issue:** *Patched-in correction.* The content is correct and worth keeping (it forecloses a real objection), but the register is a rebuttal letter, not a paper.

**Current text:**

> We state the per-level condition because it is what the affine argument establishes; the multi-level programme is dominated a fortiori, and no separate hypothesis is needed for it.

**Proposed rewrite:**

> The per-level condition is therefore the weaker and the safer of the two to state: it is what the affine argument establishes, and any multi-level bribery programme is dominated by it a fortiori.

**Priority:** medium.

---

### A5. §3 "The vocabulary, defined" is a 45-line dictionary sitting between the analogy and the first box

**Location:** lines 42–87.

**Issue:** **Definitions First** (partial) and **One Path For All Readers**. The section itself is excellent prose — line 44's *"its terms are cheap to define but expensive to guess at"* is one of the best sentences in the corpus, and the wage-vs-bond distinction at lines 61–66 does real teaching work. But it is placed at exactly the point where the reader's belief from Move 3 is highest and the box has not yet arrived, and four of its entries (settlement conventions, bribe floor, sealed, clique) define things by reference to theorems the reader has not met — e.g. line 76: *"This is a hypothesis of the tower theorem, not a hygiene recommendation"* lands on a reader who has not been told there is a tower theorem.

**Proposed rewrite** — two options, in order of preference:

**(a)** Add a signpost as the section's first line and make it visibly skippable:

> \emph{Express lane: skip to \S\ref{sec:stage}; the terms below are defined again at first use in the theorems.} This paper is economics, and its terms are cheap to define but expensive to guess at. A software reader who has never taken a mechanism-design course loses nothing but the dictionary; here it is, in the order the terms are needed.

and move the two forward-referencing entries — *sealed* (lines 76–78) and *clique* (lines 80–82) — down to §5, where they are first load-bearing, leaving §3 with the five terms that stand on their own (inspection game, mixed strategy/equilibrium, incentive-compatible, bond/slash, amortization).

**(b)** If the section must stay whole, demote it to an appendix titled "Glossary, in the order the terms are needed" and cross-reference it once from line 44.

**Priority:** medium.

---

### A6. `$O(1) = aG^2/(2dBrv)$` is an equality between a complexity class and a number

**Location:** line 20 (abstract), line 35 (contributions (iii)), line 147 (theorem box display).

**Issue:** *Referee-bait wording.* Line 147 gets it right — it writes the limit as a chain ending in $= O(1)$, which is conventional. Lines 20 and 35 write `$O(1) = aG^2/(2dBrv)$`, which reverses the containment.

**Current text** (line 20):

> to $O(1) = aG^2/(2dBrv)$ (cheats also surface at an independent rate $r$)

**Proposed rewrite:**

> to $O(1)$, with the constant $aG^2/(2dBrv)$ (cheats also surface at an independent rate $r$)

Same edit at line 35: *"independent revelation at rate $r$ gives $O(1)$ lifetime spend, with the constant $aG^2/(2dBrv)$"*.

**Priority:** low.

---

### A7. Move 6 ("what it buys") is never named concretely

**Location:** §7 (lines 166–173), specifically the third bullet at line 171.

**Issue:** style-template-v2 Move 6 requires the application be *named* — "this is Paper 3's core", "this is why the sidecar exists" — not gestured at. Paper 3's Move 6 is folded into the conjecture section and names only abstractions ("the operator at $n{=}1$, a bonded arbitration market at scale"). A reader finishes the paper knowing the theorem is true and not knowing which shipped or planned surface consumes it.

**Current text** (line 171):

> \emph{The termination is named, not wished.} The tower roots in an exogenously honest anchor --- the operator at $n{=}1$, a bonded arbitration market at scale --- and Theorem~\ref{thm:tower} prices the depth: $27$ levels and bond capital $1350$ at the running parameters [verified, arithmetic].

**Proposed rewrite** (append one sentence):

> ... [verified, arithmetic]. Concretely, this is what the judge ceremony of the reputation chapter is buying: the re-audit sampling rate is $\rho^\star$, the "distinct architectural weights" quorum is the $C$ in $CB$, the VRF injection is the seal, and the depth-and-capital line item ($27 \times B$) is a number a platform can put in a budget rather than an assumption it has to hope holds.

**Priority:** medium.

---

### A8. Exposition inside the box

**Location:** line 98, the parenthetical closing `\begin{theorem}[Stage deterrence]`.

**Issue:** minor **Move 4** violation — the box should be quotable into another document without edits; this sentence is commentary on the box.

**Current text:**

> (The formula for $\rho^\star$ is unchanged across the two game forms not by coincidence but because both solve the same judge-indifference equation: commitment picks the cheapest rate that deters, simultaneous play lands an equilibrium mix exactly there.)

**Proposed rewrite:** delete from the box; open the proof paragraph (line 102) with it, unparenthesized:

> \emph{Why the same $\rho^\star$ twice.} The formula is unchanged across the two game forms not by coincidence but because both solve the same judge-indifference equation: commitment picks the cheapest rate that deters, and simultaneous play lands an equilibrium mix exactly there. \emph{Proof.} Keep-gain: ...

**Priority:** low.

---

## Part B — Existing figures/tables: clarity audit

Paper 3 has **three figures and zero tables**. Rail B mandates two (relation-map + regime); the third (amortization) is a justified extension and is the strongest of the three.

---

### B1. `\label{fig:relation}` — `figures/fig-r7-relation.tex`, `\input` at line 33

**What it currently shows:** a two-column relation map, "Base: one audited inspector" ∥ "Target: the inspection tower", three rows joined by red double-headed relation arrows (single audit ⇔ sealed audit; one bribe ⇔ bribe floor climbs ×C per level; flat patrol ⇔ amortized ladder), with a footer line.

**What the reader should take away:** that the stage game and the tower are the same deterrence arithmetic applied once vs. recursively, and that the arrows carry *relations*, not nouns.

**Will they get it?** **No — three separate defects, two of them serious.**

1. **The caption describes a different figure.** The caption reads *"The relation map for the stage game. Left: traffic enforcement --- a driver obeys when expected fine $F\cdot p$ beats the time saved $T$... Right: agent honesty..."*. Nothing in the drawing is about traffic enforcement; the left column is "one audited inspector." The fragment's own header comment documents this and says the mismatch was "flagged in the conversion report, not silently patched." It has now survived into the paper. Mensh–Kording rule 1 (the caption states what the figure shows and what it means) fails at the first clause.
2. **The figure still carries "unbounded depth" — twice.** This is the claim removed from five/six places in the prose. Verbatim, at the row-2 arrow label: `{one bribe $\Leftrightarrow$\\ bribe floor climbs\\ $\times C$ per level\\ (finite bond,\\ unbounded depth)}` and in the footer: `{The tower prices depth, not detection: a finite bond, sealed against the draw, certifies unbounded levels.}` The prose at line 117 now explicitly says *"a depth logarithmic in the initial corrupt value, not an unbounded one"* — the figure contradicts the theorem it illustrates.
3. **"bribe floor climbs ×C per level" is wrong as stated.** The bribe floor is $\beta = \rho d B$ per auditor and does not climb; what costs $C\beta$ is buying all $C$ cliques *at one level*. Per Rail B, arrow labels must name the mapped relation; this one names a false one.

**Verdict:** **rebuild.** This is the highest-priority figure work in the paper.

**Concrete fix:**
- Replace the caption wholesale with one that describes the drawing and states its finding:
  > **Figure 1.** The relation map: the stage game (left) and the tower (right) are the same deterrence arithmetic, applied once and applied recursively. The arrows carry the load — a single committed audit maps to a *sealed* draw from $C$ benches; one bribe maps to a bribe bill of $C\beta$ that must be paid *at every level* the briber wants protected; and a flat patrol budget maps to a history-indexed schedule. The relation preserved across all three rows is *expected forfeiture $\ge$ corrupt gain*; what changes is only who pays it and over what horizon.
- Replace the row-2 arrow label with: `{one bribe $\Leftrightarrow$\\ $C\beta$ per level,\\ payable at every level\\ the briber protects}`.
- Replace the footer with: `{The tower prices depth, not detection: finite bond, sealed against the draw, certifies a depth logarithmic in the corrupt value.}`
- The traffic-enforcement analogy is genuinely used, at line 31, and deserves the relation map that Rail B specifies for Move 3 — but as a *third* row or a separate small panel, not as a caption for a figure that does not contain it. See C1.
- **[needs render]** after any edit: the `\resizebox{0.95\textwidth}` wrapper means text scales non-uniformly with the box; the added footer length will change the scale factor.

---

### B2. `\label{fig:regime}` — `figures/fig-r7-regime.tex`, `\input` at line 106

**What it currently shows:** the deterrence frontier $\rho = G/(dB)$ in the $(B,\rho)$ plane, $B \in [10,100]$, at $G{=}10$, $d{=}0.8$; seagreen shading above the curve ("deterrence holds"), shipred below ("cheating pays"); the running point $(50,0.25)$ marked with a callout; a yellow inset box carrying the tower consequence.

**What the reader should take away:** capital and vigilance are substitutes along $\rho d B = G$ — the boundary of the paper's first result.

**Will they get it?** **Mostly yes, with two real problems.**

- **Cleveland–McGill:** position along a common scale for both axes, plus shaded region for the binary — top of the ranking. Correct encoding choice. The marked point and its annotation are well done. The curve's clip at $\rho = 1$ for $B \le 12.5$ is handled honestly.
- **Greyscale survival:** `seagreen!12` and `shipred!8` are both very light tints; in greyscale they will be near-indistinguishable washes, and the legend entries "deterrence holds" / "cheating pays" then carry the entire load. **Fix:** make the cheating-pays region a hatch pattern (`pattern=north east lines, pattern color=shipred!40`) rather than a fill tint, so the two regions differ in texture, not only in hue. **[needs render]** to confirm the hatch does not fight the frontier curve.
- **The inset perpetuates the corrected claim.** Verbatim: `{tower: sealed sampling from $C$ cliques\\ $\Rightarrow$ corruption decays $(1-\rho d)^k$\\ $C=8$ collapses $\times 0.8$/level}`, and the caption repeats it: *"sealed sampling from $C$ cliques drives surviving corrupt value down as $(1-\rho d)^k$, a $\times 0.8$-per-level collapse at $C{=}8$."* The rate $(1-\rho d) = 0.8$ **does not depend on $C$ at all** — it is identical at $C{=}1$. Attaching "$C{=}8$" to it is the third surviving instance of the claim §4 retracts.
- **The template says this should be a different figure.** style-template-v2 Rail B names the R7 regime diagram explicitly: *"tower (C vs G_k plane, bribery-profitable region G_k > C·B)"*. Paper 3's regime figure is the $(B,\rho)$ stage-game frontier with the tower demoted to an inset. Both are worth having; the mandated one is missing. See C2.

**Verdict:** **keep, fix the inset and the shading.**

**Concrete fix:** replace the inset text with
`{tower: once $G_k \le CB$, corrupt value\\ decays $(1-\rho d)^k = 0.8^k$ per level\\ (rate independent of $C$;\\ $C$ sets where the decay starts)}`
and the caption's final sentence with
> The inset records the tower consequence of \S\ref{sec:tower}: below the bribery threshold $G_k \le CB$, surviving corrupt value decays as $(1-\rho d)^k$ — a $\times 0.8$-per-level collapse at these parameters, at every $C$. What $C$ controls is not the rate but where the decay begins.

---

### B3. `\label{fig:amort}` — `figures/fig-paper3-amortization.tex`, `\input` at line 157

**What it currently shows:** cumulative audit spend vs. $t \in [0,200]$ for the three schedules (flat/shipred, Model A/harborblue, Model B/seagreen), endpoint dots at $t{=}199$, a dashed seagreen line at the $41.67$ limit, and two annotation boxes — one naming the limit and $t^\star{=}333$, one explaining the pre-saturation gap.

**What the reader should take away:** the three schedules have three different *growth rates*, and Model B's shortfall against its closed form is pre-asymptotic rather than an error.

**Will they get it?** **The second point, emphatically yes; the first, no.**

- **The caption is the best in the paper.** It states the finding, names the mechanism, gives the number, and pre-empts the objection — a Mensh–Kording exemplar. Keep verbatim.
- **Cleveland–McGill:** position along a common scale, three series. Correct.
- **Greyscale survival: fails.** Three solid lines of identical weight distinguished only by hue (shipred / harborblue / seagreen). Printed greyscale, Model A and Model B become the same mid-grey line and the legend cannot rescue them. **Fix:** `shipred,thick` → `shipred,thick`; `harborblue,thick` → `harborblue,thick,dashed`; `seagreen,thick` → `seagreen,thick,dash dot`. The existing `seagreen,dashed,thin` limit line should then become `seagreen,densely dotted,thin` to stay distinct from Model B. **[needs render]**.
- **The asymptotics are invisible on the plotted range.** This is the substantive defect. On $t \in [0,200]$, all three curves are visually near-linear and within a factor of two of each other; nothing in the picture *looks* like $\Theta(T)$ vs. $\Theta(\log T)$ vs. $O(1)$. The figure's annotations have to tell the reader in words what the plot is meant to show — which is the definition of a figure not doing its job. Worse, the one curve labelled $O(1)$ is, on screen, the second-steepest. **Fix:** see C3 — this wants a second panel out to $T = 1500$, past $t^\star = 333$, where flat reaches $375$, Model A about $46$, and Model B flattens dead at $41.67$. That single panel makes the theorem visible in one glance and turns the pre-saturation caveat from a defence into an observation.
- **Provenance inconsistency.** The plot title carries `{\scriptsize [internal, \texttt{b2\_tower.py}]}` and the caption ends `[internal, \texttt{b2\_tower.py}]`, but the fragment's header comment tags it `[verified: script paper3_amortization_figures.py, seed 20260816]` and says the coordinates were transcribed from that script. Two different scripts are named for the same numbers. Per CONVENTION.md §"Numeric provenance", pick one and state it once. **Fix:** drop the in-plot title tag entirely (it is chart junk; the caption already carries it) and change the caption's tag to `[verified: \texttt{paper3\_amortization\_figures.py}; cross-checks against \texttt{b2\_tower.py}]`.
- **Possible collision:** the annotation box anchored west at `(axis cs:4,26)` extends rightward through the region the flat curve enters around $t \approx 103$. **[needs render]** to confirm; if it collides, move to `(axis cs:4,44)` under the dashed limit line.

**Verdict:** **keep and extend.** Best figure in the paper; two mechanical fixes plus one added panel.

---

### B4. Tables: none exist

**Verdict:** a gap. Three of the paper's load-bearing structures are *comparisons* — keep-gain vs. confiscation, Model A vs. Model B, and the six boundary conditions with their measurement obligations — and all three are currently prose the reader has to hold in working memory. See C4 and C5.

---

## Part C — New figures/examples proposed

### C1. The traffic-enforcement relation map the caption already promises

**Where:** §1, at line 33, as a second panel of `fig:relation` (or as its top row).

**What it would show:** three columns — base (traffic enforcement: minutes saved $T$, fine $F$, odds of a patrol $p$; driver obeys iff $Fp \ge T$) ∥ target (a bonded judge: gain $G$, bond $B$, audit-and-detect $\rho d$; judge is honest iff $\rho d B \ge G$) ∥ arrows labelled with the *relations*: "expected fine $=$ magnitude $\times$ probability $\Leftrightarrow$ expected slash $=$ bond $\times$ $\rho d$"; "patrol budget $\Leftrightarrow$ audit rate"; "the city need not catch every car $\Leftrightarrow$ the platform need not audit every grade".

**Why it helps:** Move 3's analogy at line 31 is the paper's whole on-ramp for a non-economist, and Rail B requires it to have a relation map. Right now it has a *caption* for a relation map and a *drawing* of something else. Drawing it also discharges the caption honestly, and it is the cheapest way to make the "$\rho d B$ rather than $B$" distinction of lines 61–66 visual.

**Kind:** relation-map.

---

### C2. The mandated $(C, G_k)$ regime diagram — where bribery pays

**Where:** §5, replacing the inset of `fig:regime` or added immediately after line 131.

**What it would show:** the $(C, G_k)$ plane with the line $G_k = CB$ drawn; shade above it "bribery profitable — linear bleed at $C\beta$ per level", below it "bribery uneconomical — geometric decay at $(1-\rho d)$". Mark $G_0 = 400$ as a horizontal line, and mark the three worked columns $C = 1, 2, 8$ with their certified depths (53 / 36 / 27) and capital (2650 / 1800 / 1350) annotated on the axis. The reader sees instantly that raising $C$ slides the threshold up past $G_0$ and *deletes* the linear region — and that the geometric region is the same colour everywhere, i.e. the same rate.

**Why it helps:** this is the figure the house grammar explicitly names for R7 ("tower: C vs G_k plane, bribery-profitable region $G_k > C\cdot B$"), it is currently missing, and it does in one picture the work that lines 125+131 currently do in two defensive prose paragraphs. With it, A3's rewrite can shrink further: the paragraph points at the figure instead of arguing.

**Kind:** regime-diagram.

---

### C3. A saturation panel for the amortization ladder, $T = 1500$

**Where:** §6, as a right-hand panel of `fig:amort`.

**What it would show:** the same three cumulative-spend curves out to $T = 1500$, with $t^\star = 333$ marked by a vertical rule and the $41.67$ dashed limit line the green curve visibly lands on and stops at. Flat reaches ${\approx}375$; Model A ${\approx}46$; Model B flat at $41.67$ from $t^\star$ onward. Optionally a log-$t$ x-axis on this panel so Model A renders as a straight line.

**Why it helps:** it is the only way the reader *sees* $\Theta(T)$ vs. $\Theta(\log T)$ vs. $O(1)$ rather than being told. It also converts the pre-saturation caveat from a defensive paragraph (line 155, which is currently one of the longest sentences in the paper) into a two-panel before/after, and makes line 155's "Now you try" ($T \approx 779$ for a 4× gap) a point the reader can locate on the canvas.

**Kind:** regime-diagram (second panel of an existing plot).

---

### C4. The settlement-convention table

**Where:** §4, immediately after line 104 ("Numbers by hand").

**What it would show:** four rows × three columns.

| | keep-gain | confiscation |
|---|---|---|
| Cheat payoff if caught | $G - \rho d B$ | $G - \rho d (G{+}B)$ |
| Critical audit rate | $\rho^\star = G/(dB)$ | $\rho^\star_c = G/(d(G{+}B))$ |
| At $G{=}10$, $d{=}0.8$, $B{=}50$ | $0.25$ [verified] | $0.2083$ [verified] |
| Failure mode if you quote the wrong one | escrow claws back the gain, you budget $G/(dB)$ → **over-auditing by 17%** | escrow does not claw back, you budget $G/(d(G{+}B))$ → **under-deterring** |

**Why it helps:** the convention fork is the paper's stated "first practical finding" (line 71) and its first boundary bullet (line 198), and it is currently carried in three separate prose passages (lines 68–71, 90, 96–97, 104, 198) that a reader must assemble. The fourth row is a failure-mode row — it tells a platform engineer which mistake they are making, which is what the boundary bullet says in words and what a table says in one glance.

**Kind:** table.

---

### C5. The boundary-as-measurement-obligation table

**Where:** §9, inside or immediately after the `boundary` box (lines 195–205).

**What it would show:** one row per boundary bullet, columns: *assumption* | *how it fails in deployment* | *observable symptom* | *what to measure*. E.g. "disjoint cliques" | two rival benches fine-tuned from the same base model | correlated overturn rates on the same task class | judge-pair agreement statistics, conditioned on task type; "sealed draw" | the sampler leaks which auditor takes the case | threshold silently drops from $CB$ to $B$ | VRF output audit, sampler operator in the TCB; "$r > 0$" | cheats never surface without audits | no sanctions ever first-flagged by non-audit channels | fraction of sanctions whose first flag was non-audit.

**Why it helps:** §9 is already excellent — it is a genuine Move 7, not a footnote — but its six bullets each carry two distinct things (what the theorem does not say, and what a deployment must therefore measure), and the measurement half is the paper's actual deliverable to an implementer ("numbers to estimate from audit telemetry, not assumptions to wave at", line 173). Splitting the two into columns makes the boundary box double as an instrumentation checklist without lengthening it.

**Kind:** table (failure-mode table).

---

## Part D — Cross-reference notes

`website-v2/public/whitepaper/spawn-to-person.tex` (1940 lines) is **strongly related** — its §"The grading oracle's incentive-compatibility" (line 1449 ff.) poses exactly the conjecture paper 3 closes. Four items of real drift, all in the *sibling's* direction, but two of which paper 3 should absorb.

**D1. The sibling's deterrence inequality drops $d$.** Line 1496 states the local condition as
```
P(Honeypot) > G_k / B_k
```
Paper 3's is $\rho^\star = G/(dB)$. The sibling's version is the $d = 1$ special case — perfect detection — and at the running $d = 0.8$ it under-quotes the required injection rate by 20%. It also uses strict $>$ where paper 3 uses $\ge$ (paper 3 is right: at $\rho d B = G$ the judge is exactly indifferent and the committed inspector picks the cheapest deterring rate). **Recommendation for paper 3:** one sentence in §7's second bullet, e.g. *"Where the source volume writes the honeypot condition as $P(\text{honeypot}) > G_k/B_k$, that is the $d = 1$ case; the injection rate a deployment must actually peg is $G/(dB)$, larger by $1/d$."* This is a genuinely useful correction to surface, and the paper already claims to be parameterizing that conjecture.

**D2. The sibling assumes the contraction paper 3 derives.** Sibling Conjecture `conj:contract` (line 1501) takes *"$G_{k+1} \le \lambda G_k$ with $\lambda \in [0,1)$"* as a **hypothesis**. Theorem `thm:tower` derives $\lambda = (1 - \rho d)$ from the audit parameters. That is the actual advance, and paper 3 under-sells it: line 173 says the conjecture "becomes a parameterized theorem" without pointing out that the sibling's $\lambda$ was assumed and is now computed. **Recommendation:** add to line 173 — *"in particular the contraction factor $\lambda$, which the conjecture assumed, is derived: $\lambda = 1 - \rho d$."*

**D3. Naming collision on "clique".** Paper 3 §3 (lines 80–82) defines *clique* as a benign structural asset — "a pool of judges whose errors and loyalties are statistically and economically independent of another pool's" — and explicitly disclaims the graph-theoretic reading. The sibling uses "clique" only in the *adversarial* EigenTrust sense at lines 481 and 1145: *"resists collusive cliques"*, *"aggregate peer opinions while resisting collusive cliques."* Same word, opposite valence, in two documents a reader will encounter together. Paper 3's disclaimer at line 82 covers graph theory but not this. **Recommendation:** extend line 82 to *"The word is borrowed from social structure, not from graph theory, and not from the reputation literature's 'collusive clique' — here a clique is the asset, not the attack; it carries no adjacency-matrix meaning in this paper."*

**D4. Notation drift, minor and probably not worth fixing.** The sibling level-indexes the parameters ($q_k = \rho_k d_k$, $B_k$); paper 3 holds $\rho$, $d$, $B$ constant across levels and indexes only $G_k$. The sibling says "re-audit" where paper 3 says "level $k{+}1$ audits level-$k$ auditors." The sibling names the mechanism "Model Heterogeneity" (line 1490) where paper 3 says "$C$ disjoint cliques"; paper 3's §7 first bullet already bridges this explicitly and correctly. No action needed.

**D5. Consistent, and worth noting as a success.** The sibling's key-idea box (line 1505) already says the recursion terminates *"without relying on infinite re-audits."* So the two documents agree on the corrected claim — which makes the surviving "unbounded depth" strings in `fig-r7-relation.tex` (B1) the only place in either document where the old overclaim is still live.

---

## Summary

1. **The clique overclaim was removed from the prose body but survives in five places.** The one-breath sentence (line 29), the express lane (line 23), the misread-to-preempt (line 31), the theorem box's depth formula (line 117), and — verbatim, as the literal string "unbounded depth" and "certifies unbounded levels" — in `fig-r7-relation.tex`, plus implicitly in `fig-r7-regime.tex`'s inset ("$C{=}8$ collapses $\times 0.8$/level", a rate that is independent of $C$). Fix the box first (A2); the rest follow. **This is the whole of the paper's high-priority work.**

2. **`fig-r7-relation.tex` needs a rebuild, not a patch.** Its caption describes a traffic-enforcement figure that does not exist; the drawing shows something else; one arrow label ("bribe floor climbs $\times C$ per level") states a false relation; and it carries the removed claim twice. It is the only genuinely broken artefact in the paper. B1 + C1.

3. **The two new paragraphs read as patches because the overclaim upstream of them is still there.** Line 131 has to open by telling the reader the previous paragraph overstated the case, and line 125 uses parameters introduced four lines later. Reorder (125 after 131), let the $C{=}1$ recursion terminate inside the "Numbers by hand" paragraph, and both paragraphs become findings instead of retractions. A3.

4. **The amortization figure is excellent and cannot show its own theorem.** On $t \in [0,200]$ the three curves look alike; the $O(1)$ one is the second-steepest. A $T = 1500$ companion panel past $t^\star = 333$ would make $\Theta(T)$ / $\Theta(\log T)$ / $O(1)$ visible in one glance and retire the longest defensive sentence in the paper. B3 + C3.

5. **Two tables would carry structure the prose is currently asking the reader to hold in memory** — the settlement-convention fork with its two failure modes (C4), and the boundary box re-cut as a measurement-obligation checklist (C5). And §3's vocabulary, which is very good writing, should be made visibly skippable and stripped of its two forward references to theorems the reader has not met (A5).
