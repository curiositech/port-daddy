# VERIFICATION — paper1.tex ("The Price of a Summary")

Falsification-first verification pass on four claim-level items raised by the
round-2 editorial review. Method: read the primary source, independently
recompute every number from its own definition (not from the figure
coordinates, not from the review), run the cited scripts, and actively look
for a reading that would make the review **wrong** before confirming it.

No document was edited. Repo state at time of check: branch
`claude/white-paper-pr-review-uncpxg`, HEAD `127ffc91f`.

Scripts run: `skills/harbor-results/scripts/a7_experiment.py` (full, exit 0).
Independent recomputations written ad hoc in Python (closed forms + a
from-scratch reimplementation of the halving procedure).

---

## A11 — "[verified] super-additivity 1.05–1.08 across regimes" vs. its own figure

**Verdict: CONFIRMED** (and the underlying defect is *worse* than the review
states, while one of the review's supporting details is slightly off).

### Evidence

**Exact claim strings in the source.**

- `docs/harbor-research/tex/paper1.tex` L34 (Contribution 2):
  `... the joint zero-miss floor is super-additive: $\mathrm{Floor}(N,2k,m)\approx 2.13\times\mathrm{Floor}(N,k,m)$, with ratio-over-double $1.05$--$1.08$ across regimes [verified].`
- L88–90 (Claim "Super-additive split penalty"):
  `\frac{\mathrm{Floor}(N,2k,m)}{2\,\mathrm{Floor}(N,k,m)}\;\approx\;1.05\text{--}1.08 \quad\text{across regimes,}`
- L75 (figure caption, `fig-r2-regime.tex`):
  `... super-additivity $1.05$--$1.08$ across the swept regimes [verified] ...`

**Partial refutation of the review's own citation list.** The review names the
abstract (L21) as a third site of the bad range. It is not. L21 says only
`with the joint floor \emph{super}-additive ($\approx 2.13\times$, not $2\times$)`
— that is the *ratio-to-single* number (2.13×), which is correct and correctly
tagged. Likewise the table at L64–65 (`2.13×`, `1.07`) and the in-text
instantiation at L91 (`super-additivity $1.07$ [verified]`) are all correct at
the stated regime. **The defect is confined to three sites: L34, L88–90, and
the caption at L75.** A fix that touches the abstract or the table would be
over-correcting.

**The CROSS-CHECK NOTE exists, verbatim**, at `fig-r2-regime.tex` L7–13:

```
% CROSS-CHECK NOTE: the caption below (kept verbatim from paper1.tex) states
% "super-additivity 1.05--1.08 across the swept regimes" -- the script's own
% swept data does NOT support that range: panel (a)/(b)'s m=8 curve alone
% already reaches 1.122 at k=3 and 1.224 at k=4, and the m=20 curve reaches
% 1.392 at k=10. Only the single k=2 point sits at 1.067, inside the stated
% band. Flagged, not silently corrected -- see the figure-conversion report.
% [verified: script r2_figures.py]
```

**Independent recomputation.** I did not trust the plotted coordinates. I
recomputed `Floor(N,k,m) = log2 C(N,k) − log2 C(m,k)` from scratch (lgamma) and
evaluated `Floor(N,2k,m) / (2·Floor(N,k,m))` at every point the figure plots:

| regime | k=1 | k=2 | k=3 | k=4 | k=5 | … | k=10 |
|---|---|---|---|---|---|---|---|
| N=60, m=8  | 1.0290 | **1.0670** | 1.1221 | 1.2240 | — | | — |
| N=60, m=20 | 1.0157 | 1.0332 | **1.0529** | **1.0754** | 1.1015 | … | 1.3922 |

Every one of the 14 pgfplots coordinates in `fig-r2-regime.tex` L62–69
reproduces to the digit. **The figure's data is real and correct; the prose is
what is wrong.**

**Correction to the review's detail, in the paper's favour and then against
it.** The review says "only the single k=2 point (1.067) sits inside the
claimed band." That is not quite right — **three** of the 14 plotted points sit
in [1.05, 1.08]: (m=8, k=2)=1.0670, (m=20, k=3)=1.0529, (m=20, k=4)=1.0754.
So the band is not a single-point band. But this makes the claim *worse*, not
better: 11 of 14 points are outside it, the two k=2 points (the paper's own
worked regime) straddle it in opposite directions (1.0670 in, 1.0332 **below**),
and the ratio is monotonically increasing and unbounded in k.

**The adversarial reading, tested and rejected.** The strongest defence of the
prose is that "across regimes" means *across (N, m) at the paper's fixed k=2*,
not across k. I swept it:

| N (k=2, m=8) | 30 | 60 | 100 | 200 | 500 | 1000 |
|---|---|---|---|---|---|---|
| ratio | 1.0882 | 1.0670 | 1.0564 | 1.0460 | 1.0367 | 1.0317 |

The band fails at both ends of the N sweep too (1.088 above at N=30; 1.032
below at N=1000), and fails at k=2 across the figure's own two m regimes. **No
reading of "regimes" rescues the range.** The mechanism sentence at L91
(`because $\log_2\binom{N}{2k}$ grows faster than $2\log_2\binom{N}{k}$`) is
directionally true, but it is precisely the reason a fixed numeric band cannot
hold.

**Tag check.** The `[verified]` tag itself is defensible in kind — the quantity
*is* closed-form recomputable — so this is not a provenance-tag error like A25.
It is a `[verified]`-tagged statement that is simply false as written, which is
arguably worse: the tag asserts the reader can check it, and a reader who
checks it finds it wrong.

### What this means for the fix

The number to keep is the point estimate, not the range. The three sites need
the same edit: replace "ratio-over-double 1.05–1.08 across regimes" with the
instantiated value plus the true qualitative fact, e.g. "ratio-over-double
1.067 at N=60, k=2, m=8, **growing without bound in k** (1.22 at k=4, m=8; 1.39
at k=10, m=20)". Then the caption at L75 becomes true and the CROSS-CHECK NOTE
at `fig-r2-regime.tex` L7–13 can be retired. Do **not** touch abstract L21,
table L64–65, or L91's instantiation — those are already correct. Note the
figure caption is duplicated prose ("kept verbatim from paper1.tex" per the
fragment header), so the caption must be edited in the fragment, not the paper.

---

## A12 — §4's two halves calibrated at incompatible densities

**Verdict: CONFIRMED.** The arithmetic holds under independent rederivation,
the `f ≥ 12(p−δ)` crossover is not merely plausible but **exact** for the
paper's own Corollary bound, and the incompatibility is broader than the review
states: the entire operating band §4 recommends (f from p to 2p) sits in the
regime where zoom loses.

### Evidence

**The two paragraphs, verbatim (paper1.tex).**

- L190: `Stage one, the digest, spends $R(\delta,f)\cdot N$ bits to cut $N$ artifacts to $F\approx fN$ flags at miss budget $\delta$; stage two, zoom, spends at most $2k\lceil\log_2(F/k)\rceil+4k$ group opens to isolate the $k$ criticals among the flags. ... loosening flags from $f{=}p$ to $f{=}2p$ cuts the digest from $0.286$ bits/symbol [verified] to $0.186$ [internal] at zero miss, and the flags it adds cost only logarithmically in the second stage`
- L192: `When the flagged set is already dense in positives ($k/F$ large --- e.g.\ a tight flag budget $f\approx1.5p$, most flags real), group overhead dominates and adaptive halving can open \emph{more} than $F$: at $F{=}100,k{=}90$ the run costs $199$ opens against $100$ flat [internal].`
- L183 (Corollary): `at $(F,k)=(2500,10)$, at least $2500/200=12.5\times$`
- L136–138 (Proposition): `both constraints bind at the optimum`, with `q_{11}=p-\delta`.

**Deriving the density independently.** L190 itself supplies the composition:
`F ≈ fN`. The Proposition (L136) states both constraints bind, so the flag rate
is *exactly* f and the true-positive cell is *exactly* `q11 = p − δ`. Therefore
the criticals surviving into the flagged set number `(p−δ)N`, and

    k / F = (p−δ)N / (fN) = (p−δ) / f.

Three independent cross-checks of this identity: (i) at δ=0 every critical is
flagged so k = pN directly; (ii) at f = p, δ = 0 it gives density 1.0 — every
flag is a true critical, which is right, because a zero-miss digest at the
tightest possible flag budget must flag exactly the criticals; (iii) at f → 1
it gives density p, the sparsest reachable, which is right because flagging
everything reproduces the raw source. The formula is correct.

**Evaluating it at §4's own stated numbers (p = 0.05 throughout §4, L145):**

| setting | source | density k/F | F/k |
|---|---|---|---|
| f = p, δ = 0 | L190 start of the recommended move | **1.000** | 1.0 |
| f = 1.5p, δ = 0 | L192's *dense* example | **0.667** | 1.5 |
| f = 2p, δ = 0 | L190 end of the recommended move | **0.500** | 2.0 |
| (δ, f) = (0.01, 0.10) | L145/L190 | **0.400** | 2.5 |
| (δ, f) = (0.04, 0.06) | L145 | **0.167** | 6.0 |
| (F, k) = (2500, 10) | L183 Corollary | **0.004** | 250 |

The Corollary's worked example is two-and-a-half orders of magnitude sparser
than anything §4's frontier half can produce. To hit density 0.004 you need
`f = (p−δ)/0.004 = 250(p−δ)`, i.e. **f = 12.5 at p = 0.05, δ = 0** — infeasible,
since f is a probability. The *sparsest reachable* density at p = 0.05 is
f = 1 (flag literally everything), giving F/k = 20, still 12.5× denser than the
Corollary's 250. **The Corollary's illustration is unreachable from §4's own
source model at §4's own p.** Confirmed.

**Independently deriving the `f ≥ 12(p−δ)` crossover — the exact result.**
Write d = k/F. The paper's own Corollary bound gives adaptive cost
`2k⌈log2(F/k)⌉ + 4k = k(2⌈log2(1/d)⌉ + 4)`, and flat cost `F = k/d`. So the
guaranteed advantage is a function of **density alone**:

    adv_bound(d) = 1 / ( d · (2⌈log2(1/d)⌉ + 4) ).

(Sanity check against the paper: at d = 0.004 this returns exactly 12.500×,
matching L183's `2500/200 = 12.5×`. The formula is the paper's own.)

Zoom is guaranteed to pay iff `d·(2⌈log2(1/d)⌉ + 4) ≤ 1`. Solve piecewise: on
`d ∈ [2^-j, 2^-(j-1))` we have `⌈log2(1/d)⌉ = j`, so the condition is
`d ≤ 1/(2j+4)`.

- j = 3 → d ∈ [0.125, 0.25), need d ≤ 1/10 = 0.100 → **empty**
- j = 4 → d ∈ [0.0625, 0.125), need d ≤ 1/12 = 0.08333 → **d ∈ [0.0625, 1/12]**
- j = 5 → d ∈ [0.03125, 0.0625), need d ≤ 1/14 = 0.0714 → **all of it**
- j ≥ 5 → all of it

So `{d : guaranteed advantage ≥ 1} = (0, 1/12]`, with the boundary attained
**exactly** at d = 1/12 (there `12d = 1.0000` to the digit). Substituting
d = (p−δ)/f:

    (p−δ)/f ≤ 1/12  ⟺  **f ≥ 12(p−δ)**.

The review's number is not an estimate — it is exact for the bound the paper
states, and it is exact by a numerical coincidence worth knowing: 1/12 is the
unique point where the ceiling-step function `d(2⌈log2(1/d)⌉+4)` first touches 1.

**What f ≥ 12(p−δ) costs.** At p = 0.05, δ = 0 that is **f ≥ 0.60** — the digest
must flag 60% of every artifact the fleet produced before the second stage is
guaranteed to beat just reading the flags. §4 recommends f = 2p = 0.10.

**Adversarial check: is the worst-case bound too pessimistic to indict the
prose?** Possibly — so I reimplemented the exact halving procedure of Theorem 4
from its own text (query the set; discard negatives; report positive
singletons; else split into ⌊s/2⌋,⌈s/2⌉ and recurse) and measured the *mean*
over random placements, F = 1000–2000, 40–60 placements per point:

| density d | 0.004 | 0.02 | 0.05 | 1/12 | 0.10 | 0.15 | **0.165** | 0.20 | 0.40 | 0.50 | 0.667 | 0.90 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| measured advantage | 15.4× | 4.29× | 2.19× | 1.54× | 1.37× | 1.06× | **≈1.00×** | 0.90× | 0.64× | 0.58× | 0.53× | 0.50× |

The *measured* crossover is d ≈ 0.165 (i.e. `f ≥ ~6(p−δ)`), roughly twice as
forgiving as the guaranteed bound. **This does not rescue the prose.** Every
density §4's frontier half actually operates at — 0.400, 0.500, 0.667, 1.000 —
is on the losing side of even the generous empirical crossover. At f = 2p the
measured advantage is 0.58×, i.e. adaptive halving costs **1.7× more opens than
simply reading all F flags**.

**The specific sentence that is false.** L190's "the flags it adds cost only
logarithmically in the second stage" is wrong at its own numbers. Doubling f
from p to 2p doubles F; since zoom does not pay at either density, the honest
second-stage cost across that whole move is **linear in F** (read the flags),
not logarithmic. The two-stage "exact exchange rates" sentence at L190 therefore
prices a stage-two saving that does not exist at the stage-one setting it
recommends.

**A secondary inconsistency inside L192 itself, not previously flagged.** L192
gives its dense example as "f ≈ 1.5p" (density 0.667) but illustrates with
(F,k) = (100,90), which is density **0.900**, i.e. f ≈ 1.11(p−δ). The prose
parameter and the numeric illustration do not correspond. Both are in the
losing regime, so the conclusion survives, but the two numbers should be made
to agree. (The 199 figure is correct: at density 0.9 essentially every node of
the halving tree is positive, so the run degenerates to the unconditional
`2F−1 = 199`, exactly as Theorem 4 predicts. I reproduced 199 from scratch.)

**Corroborating record found in the repo.** `docs/harbor-research/wrong-turns/README.md`
already lists lesson #3: *"b1_experiment.py — Zoom tested in the dense-flag
regime → apparent 0.5× 'advantage'."* The program has already burned itself on
exactly this confusion once; §4 reintroduces it at the composition seam.

### What this means for the fix

This is a real technical inconsistency, not a wording problem, and it cannot be
fixed by softening L190's adverb. Options, in order of honesty:

1. **Re-anchor the Corollary's example to a reachable regime.** (F,k) = (2500,10)
   requires p−δ ≤ f/250. State it at a source density the frontier can produce
   — e.g. p = 0.002 with f = 0.5 (density 0.004, F/k = 250) — or drop p = 0.05
   from the composition paragraph and let the zoom theorem stand on its own
   parameters, explicitly *not* composed with the p = 0.05 frontier numbers.
2. **State the composition condition explicitly in L190.** The clean statement
   is: the two stages compose profitably iff `(p−δ)/f ≤ 1/12`, i.e.
   `f ≥ 12(p−δ)` (guaranteed) or `f ≳ 6(p−δ)` (measured mean). At p = 0.05 that
   means f ≥ 0.6 — which is worth saying plainly, because it is the honest
   boundary of the paper's headline architecture.
3. **Repair the false clause.** "the flags it adds cost only logarithmically in
   the second stage" must go; at f ∈ [p, 2p] the second stage is linear.
4. **Reconcile L192's own two numbers** (f ≈ 1.5p vs. (F,k) = (100,90)).

Item 3 is mandatory (it is a false statement). Items 1–2 are the substantive
fix. This one warrants owner sign-off on *which* repair, since it changes what
§4 claims the architecture buys.

---

## A13 — R4 Panel B argues against the paper's own boundary

**Verdict: PARTIALLY-CONFIRMED.** The core complaint is correct and the figure
is genuinely misleading. But **two of the review's supporting specifics are
wrong**, and correcting them makes the criticism sharper in one place and
weaker in another.

### Evidence

**What Panel B actually plots.** `fig-r4-regime.tex` L1–8 header:
`Panel B: the idealized zoom advantage F/(k log2(F/k)) as a function of
flagged-set density k/F -- an exact closed form of density alone since
F/(k log2(F/k)) = 1/(density*log2(1/density))`. Confirmed by recomputation: the
25 plotted coordinates at L88–89 reproduce `1/(d·log2(1/d))` to four decimals
(d = 0.001 → 100.3433; d = 0.011666 → 13.3487 vs. plotted 13.3489; d = 0.7 →
2.7762). **It is the ideal `k·log2(F/k)` bound, not the deployed
`2k⌈log2(F/k)⌉+4k` bound.** Confirmed.

**Axis ranges (L80):** `xmin=0.0008, xmax=0.8, ymin=0.8, ymax=100`, log–log.
Plotted data spans d ∈ [0.001, 0.700].

**"Never crosses parity" — confirmed, and stronger than stated.** The review
says the ideal curve never crosses parity *in the plotted range*. In fact
`1/(d·log2(1/d))` has a global minimum of **1.884× at d = 1/e ≈ 0.368** and
`max_d d·log2(1/d) = 0.531 < 1`, so the plotted quantity **cannot cross parity
anywhere on (0,1)** — extending the axis to d = 1.0 would not help. The
`seagreen dashed` series at L92 with `\addlegendentry{zoom stops paying}` is a
parity line the plotted curve is mathematically incapable of reaching. The
shaded `\addlegendentry{zoom wins}` region (L83–87) fills from the curve down to
y = 1 across the entire data range. **A reader who reads only the picture
concludes zoom always wins.** Confirmed.

**REFUTED detail #1: the honest boundary does *not* fall off the right edge —
it falls *inside* the plotted range and is simply not drawn.** The review says
the boundary "falls off the right edge of the plotted range entirely,
invisible." Only the paper's *illustrative point* does: (F,k) = (100,90) is
density 0.900, and xmax = 0.8. But the boundary itself is not that point. The
deployed bound is, like the ideal one, **a function of density alone**:
`adv_bound(d) = 1/(d(2⌈log2(1/d)⌉+4))`, which crosses parity at **d = 1/12 =
0.0833** — comfortably inside the plotted x-range [0.0008, 0.8], near the
middle of the log axis. The measured-mean crossover, d ≈ 0.165, is also inside.
So the figure could have plotted the deployed curve on exactly the same axes,
in exactly the same "density only" form, and shown the crossing. **This makes
the criticism worse, not better: the boundary is not off-screen, it is
omitted.**

**And the mismatch at the paper's own illustration is severe.** At d = 0.9 —
the (100,90) point §4 uses to state its honest boundary — the plotted ideal
formula returns **7.31×**. The figure's own curve, extrapolated to the paper's
own worst case, predicts a 7.3× *win* at the exact configuration the text says
loses 2:1. The plotted quantity and the stated boundary are not merely
differently scaled; they disagree in sign of conclusion.

**REFUTED detail #2: "admits this in a subordinate clause" understates the
caption.** The actual caption (L101), verbatim:

> `Regime diagram for the zoom advantage: the idealized open-count advantage $F/(k\log_2(F/k))$ against flagged-set density $k/F$, over the sparse-to-moderate range this digest architecture targets. The advantage is steep where flags are sparse ($k\ll F$) and falls toward parity as density grows; the plotted idealization never crosses parity, but the deployed algorithm's constant overhead does invert the ordering at higher density still, exactly as measured at $(F,k)=(100,90)$ in \S\ref{sec:zoom} ($199$ adaptive opens against $100$ flat) --- both halves of the claim are load-bearing.`

This is a full coordinate clause, not a subordinate one: it names the quantity
as *idealized*, states outright that it *never crosses parity*, names the
inversion, cites the section, and gives both numbers (199 vs 100). **The
caption is unusually candid** — it is close to a model of the house's honest-
boundary discipline. The review's "subordinate clause" framing is not accurate
and should not be used as the justification for the fix.

**So what survives?** The real defect is a *figure/caption mismatch*, not a
concealment: the caption tells the truth in words while the plot's own graphical
grammar — a shaded region labelled "zoom wins" covering 100% of the chart, and a
"zoom stops paying" line the curve cannot touch — asserts the opposite. In a
paper whose §5 boundary box (L212) commits to "we bound the *deployed*
algorithm, not the best one," the one regime figure for that theorem plots the
best one.

**Minor, uncaught by the review:** the Panel B title (L79) reads
`Panel B --- the sparse-flagged boundary\\($F{=}2500$)`, but the fragment's own
header (L7–8) states the curve has "no dependence on F=2500 beyond the measured
point." The `F=2500` in the title is misleading for a curve that is a function
of density alone.

### What this means for the fix

The caption needs no honesty repair — it is already honest. The **plot** needs
the deployed curve. Concretely:

1. Add a second series to Panel B: `1/(d(2⌈log2(1/d)⌉+4))`, the deployed
   guaranteed bound, on the same density axis. It is a closed form of density
   alone, so it costs nothing structurally, and it reproduces the Corollary's
   12.5× at d = 0.004 as a built-in cross-check.
2. That series crosses y = 1 at **d = 1/12 = 0.0833**, inside the current
   x-range. The shaded "zoom wins" region must then be clipped to d ≤ 1/12
   rather than filling the chart, and the "zoom stops paying" line finally has
   something that touches it.
3. Optionally extend xmax from 0.8 to 1.0 so (F,k) = (100,90) at d = 0.9 can be
   marked as a point, matching the caption's own citation.
4. Fix the Panel B title's spurious `F=2500`.

No change to paper1.tex is required for A13 (the caption is quoted from the
fragment). This is a figure-fragment fix in
`docs/harbor-research/figures/fig-r4-regime.tex`, plus optionally the generator
`figures/src/r4_figures.py`. Note that fragment already carries a
`BUG FOUND AND CORRECTED` note (L10–24) for a *different* defect in Panel A —
the house's precedent is to correct in the `.tex` and flag, not to reproduce the
`.py`'s output.

---

## A25 — "0/16" provenance tag mismatch

**Verdict: CONFIRMED**, unambiguously, and settled by running the script.

### Evidence

**Exact tag strings, both sites.**

- `paper1.tex` L33 (Contribution 1):
  `(0/16 violations at $N{=}60,k{=}2,m{=}8$ [internal, \texttt{a7\_experiment.py}])`
- `paper1.tex` L53 (falsification experiment paragraph):
  `Result: \textbf{0/16 violations}; ... [internal, \texttt{a7\_experiment.py}]`
- `paper1.tex` L66 (provenance table):
  `Oracle violations of the floor & $0/16$ & [internal, \texttt{a7\_experiment.py}] \\`
- `fig-r1-relation.tex` L33 (row 3, target node):
  `{$m{=}8$ opened $\Rightarrow$\\$B^\star = 5.98$ bits;\\$0/16$ floor violations\\{[verified, \texttt{a7\_experiment.py}]}}`

So paper1 tags it `[internal, a7_experiment.py]` at **three** sites (the review
named two; the table at L66 is a third), and the figure tags the identical
number `[verified, a7_experiment.py]` at one. Mismatch confirmed verbatim.

**Additional inconsistency inside the fragment itself, not previously flagged.**
`fig-r1-relation.tex` L4 — the fragment's *own leading provenance comment*,
which is the tag CONVENTION.md actually governs — reads
`% [internal, script r1_figures.py]`. So the fragment's header says
**internal** while its row-3 body says **verified**, about the same figure.
The fragment contradicts itself.

**Which script paper1 cites.** Two copies exist:
`skills/harbor-results/scripts/a7_experiment.py` and
`docs/harbor-research/wrong-turns/a7_experiment.py`. paper1 §Reproducibility
(L218) resolves it: `\texttt{a7\_experiment.py} (the falsification experiment;
0/16, with the wrong-turn v1 and its 8/14 spurious violations retained under
\texttt{wrong-turns/}) ... both bundled with the research program's results
skill`. The cited script is therefore the **skills/harbor-results/scripts/**
copy; the wrong-turns copy is v1 (its docstring header confirms: it is the
tie-breaking-meter version that produced 8/14). `wrong-turns/README.md`
independently confirms the mapping.

**Script output (full run, exit code 0):**

```
Regime N=60, k=2, m=8:  B* = 5.98 bits

=== FALSIFICATION TEST: does the oracle encoder ever beat the floor? ===
  violations: 0/16 -> floor HOLDS (theory survives)

=== KEY NUMBERS ===
  floor B* (k=2):                 5.98 bits
  floor disjoint readers (2k=4): 12.77 bits
  split penalty (disjoint - single): 6.78 bits
  ratio:                            2.13x
```

(Generated `a7_figure.png` was removed; working tree left clean.)

**Is 0/16 a simulation or a closed-form check? Decisive.** From the script:

- L125–126: `Bsched = np.linspace(1, Bmax, 16)` — the denominator 16 is the
  number of *swept budget points*.
- L126: `oracle = [encode_decode_miss("oracle", N, k, m, B, codebook, trials=4000) ...]`
  — each point is a **Monte-Carlo mean over 4000 random placements**, drawn from
  `rng = np.random.default_rng(20260816)` against a **randomly generated
  codebook** (`build_codebook`: `rng.choice(N, size=m, replace=False)`).
- L172–177, the violation test itself:

  ```python
  violations=0
  for B,mo in zip(Bsched,oracle):
      lo = optimal_miss(B,N,k,m)
      if mo < lo - 0.04:                      # MC slack
          violations+=1
  ```

  The comparison is a **stochastic estimate `mo` against the closed form `lo`,
  with an explicit `0.04` Monte-Carlo slack**. The presence of a Monte-Carlo
  slack term is itself proof that the quantity is not closed-form
  recomputable — a hand calculator has no slack to apply.

**Against paper1's own definition (L38):** `numbers are tagged \textbf{[verified]}
(externally recomputable from the closed form) or \textbf{[internal]}
(regenerates from the named script at seed 20260816)`. 0/16 is a seeded
simulation count with an MC tolerance. It is textbook `[internal]`. CONVENTION.md
("Numeric provenance") agrees: `[verified: script X.py, seed …]` vs
`[internal, script X.py]`, with the compendium's simulated numbers on the
internal side.

**Adversarial reading, tested and rejected.** Could `[verified]` be defended on
the ground that the *floor* 5.98 bits — which appears in the same figure node —
is closed-form recomputable, and the tag is loosely scoped to the whole node?
No. Two reasons: (a) the node's tag sits on the line directly below `0/16 floor
violations`, and 5.98 is tagged `[verified]` separately and correctly at
paper1 L51 and L62, so the corpus already distinguishes them; (b) the same
fragment's own header at L4 says `[internal]`, so even the fragment's author did
not intend a `[verified]` scope. The tag is simply wrong.

### What this means for the fix

Single-token edit in `docs/harbor-research/figures/fig-r1-relation.tex` L33:
`[verified, \texttt{a7\_experiment.py}]` → `[internal, \texttt{a7\_experiment.py}]`.
No change to paper1.tex — its three sites (L33, L53, L66) are already correct
and consistent. This is the lowest-risk fix of the four: the correct value is
determined by the corpus's own stated rule, the script's own structure, and the
fragment's own header, with no judgement call.

---

## Summary table

| Item | Verdict | Fix site | Judgement needed? |
|---|---|---|---|
| A11 | CONFIRMED (defect worse than stated; abstract wrongly implicated) | paper1.tex L34, L88–90 + fig-r2-regime.tex L75 | No — replace range with point value + growth |
| A12 | CONFIRMED (crossover f ≥ 12(p−δ) exact; one clause outright false) | paper1.tex L183, L190, L192 | **Yes** — which repair changes what §4 claims |
| A13 | PARTIALLY-CONFIRMED (2 review specifics refuted; core defect real) | fig-r4-regime.tex only (caption is already honest) | No — add deployed curve, clip shading |
| A25 | CONFIRMED | fig-r1-relation.tex L33 | No — one-token edit |
