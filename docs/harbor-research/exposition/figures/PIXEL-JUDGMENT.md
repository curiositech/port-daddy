<!--
Provenance: a pixel-judgment pass over the Book, 2026-09-14. Every row was
decided by rendering the Book page at 150 dpi and looking at it, not by reading
the fragment and not by running a checker. The measured column is corroboration,
never the verdict.
-->

# Pixel judgment — every figure in the Book, judged on its printed page

**What was judged.** `website-v2/public/whitepaper/coordination-papers-mega-volume.pdf`,
551 pages, SHA-256 `00e1e8b279a9ceabc0f828fa950f2437e3646dc33439614af404eb387f3e98a8`,
committed at `1d8ebc787` (*build(whitepaper): regenerate PDFs from source*,
2026-09-14). That is the newest built Book in the repository. It is one commit
ahead of `origin/main`'s copy (`dd7853981`, 2026-09-12) in page layout only:
`git diff origin/main..1d8ebc787 -- whitepaper/figures website-v2/public/whitepaper/figures`
is empty, so every figure fragment judged here is byte-identical to the one on
`origin/main`, which is where this branch is based.

**The Book is the Swiss edition.** `coordination-papers-mega-volume-preamble.tex`
line 153 declares `\providecommand{\pdedition}{swiss}`, so the committed Book
loads `figures/pd-figure-language-swiss.tex` over the base figure language. That
matters for a third of the findings below, and it is the first cross-cutting
result of this pass (§1).

**Method.** All 551 pages were scanned with PyMuPDF for vector-ink density,
caption strings and per-span typefaces; the 59 figure-bearing pages and the
figure-free runs of three pages or more were then rendered at 150 dpi and read
as images. Each figure was judged against the five-point legibility rubric in
`skills/harbor-chartwork/references/craft-rules.md` §1, the page-role test in §2,
and the form/colour rules in the `dataviz` skill (`choosing-a-form.md`,
`anti-patterns.md`, `color-formula.md`). The default verdict is *fails*; a figure
earns *keep* only by clearing all five points on its own page.

**A compiling, figcheck-clean figure earns nothing.** `fig-swk-stack-map` passes
T1–T8 and carries three typefaces in one picture. Nineteen figures in this Book
pass every mechanical gate the repository owns and are illegible, mislabelled or
wrong. The gates are a floor, not evidence.

---

## 1. Five findings that are not about any one figure

### 1.1 The Swiss edition deletes every fill's drawn edge

`figures/pd-figure-language.tex` defines regions the way the craft rules require:

```tex
pd focus fill/.style   = {fill=hhteal!24,  draw=hhteal!65,  line width=.4pt, ...},
pd caution fill/.style = {fill=hhamber!26, draw=hhamber!70, line width=.4pt, ...},
pd neutral fill/.style = {fill=hhsand!40,  draw=hhgray!65,  line width=.4pt, ...},
```

`figures/pd-figure-language-swiss.tex` then overrides all three, and `pd state`,
and `pd hatch`, with **`draw=none`**. The Book is the Swiss edition, so on the
printed page *no* region in *any* figure has a drawn edge. Craft rule 1.3 ("every
band has a drawn edge... regions are edged, not merely tinted") is violated
corpus-wide by one file, not by forty fragments.

`tikz_precheck.py`'s P13 ("a `\fill` with no matching `\draw`") cannot see this:
it reads the fragment, and the fragment asked for an edge. This is the clearest
example in the pass of a defect that only the pixels reveal.

Affected here: 1.2, 1.11, 2.5, 4.1, 5.9, 6.3, 8.3, 8.4 explicitly, and every
`pd state` box in 1.4, 1.10, 3.1, 3.2.

**Fix is one file**, not forty: restore a hairline edge on the three fills and on
`pd state` in the Swiss override. Not done here — `pd-figure-language-swiss.tex`
belongs to the design-system branch.

### 1.2 `\resizebox` at the Book measure is the single biggest legibility failure

The Book's text column is 4.5 in (11.43 cm); the standalone papers' is ~6.4 in.
Twenty-four fragments wrap their picture in `\resizebox{0.88–0.96\textwidth}`.
`tikz_precheck.py`'s P12 only warns below 0.85, so all twenty-four pass — but
`\resizebox{0.96\textwidth}` at the Book measure applies an *effective* scale of
about **0.70–0.75** to a picture drawn for the paper's width. Eight-point type
lands at 5.6 pt.

Measured, inside the figure region, on the Book page:

| figure | smallest real label | what it is |
|---|---|---|
| 7.6 | **2.35 pt** | the assumptions line under the cartel grid |
| 7.4 | **2.90 pt** | the Wilson-envelope provenance line |
| 7.2 | **4.18 pt** | `criterion met`, and the run-provenance line |
| 5.8 | **4.81 pt** | `reaches root near level 27` |
| 5.1 | **4.96 pt** | `obligation + capability + authority` |
| 5.6 | **5.02 pt** | `weights .60, .30, .10` |
| 7.9 | **5.65 pt** | the minute tick numerals |
| 7.1 | **5.84 pt** | the four escalation edge labels |
| 7.8 | **5.98 pt** | the time tick numerals |
| 8.2 | **6.05 pt** | the envelope annotations |
| 8.6 | **6.62 pt** | `criteria` |

Nineteen figures carry text below the 7 pt floor on the Book page. The floor is
not arbitrary: Science asks for 6 pt symbols and 0.5 pt lines *at final size*;
IEEE asks 8–10 pt labels.

**The fix that works is visible in the corpus already.** Every pgfplots figure
(1.5, 3.4, 3.5, 4.3, 4.4, 4.5) sets an explicit `width=` and uses *no*
`\resizebox` — and every one of them measures 7.6–8.7 pt on the Book page. Draw
to the measure; never scale down to it. Both figures added in this change and
the one redrawn do exactly that.

### 1.3 `\tiny`, `\scriptsize` and bare fills are already hard errors, and are committed anyway

`tikz_precheck.py` over the whole Book corpus, today:

```
P10 (\tiny)        7 findings, hard error   fig-stp-multidim-reputation, fig-stp-rate-the-raters,
                                            fig-stp-role-vs-person
P11 (\scriptsize) 22 findings, hard error   fig-bonded-key-custody, fig-fh-settlement,
                                            fig-governance-flow, fig-he-assurance-sieve,
                                            fig-magic-link-inline, fig-stp-judge-market,
                                            fig-sybil-inline, fig-worked-example
P13 (bare fill)   16 findings, hard error   fig-cartel-game-inline, fig-fh-revocation-gossip,
                                            fig-fh-xfer-ceremony, fig-he-assurance-sieve,
                                            fig-magic-link-inline, fig-stp-parfit-chain,
                                            fig-stp-rate-the-raters, fig-worked-example
```

`check_figure_blockers.py` reports "61 total, 61 waived, 0 failures". The gate is
not failing because every finding is waived. The three `\tiny` fragments are
exactly three of the eleven figures measured under 7 pt above — the lint
predicted the illegibility and the waiver absorbed it.

### 1.4 Three chapter-7 figures are imported matplotlib PDFs

`fig-pareto-dominance.pdf`, `fig-sybil-deposit-floor.pdf` and
`fig-cartel-folk-theorem.pdf` are `\includegraphics` at `width=\textwidth`, not
TikZ. They carry Palatino and STIXGeneral — typefaces the Book does not declare —
and they hold the three smallest type sizes in the whole volume (2.35, 2.90,
3.58 pt). No fragment-level tool in the repository inspects them: `tikz_precheck`
skips them (no TikZ), `compile_fragment.sh` cannot wrap them, and they have no
`figcheck` row. They are the least-governed and least-legible figures in the
Book.

### 1.5 The worst collisions are fills painted over text, which T3 and T4 cannot see

figcheck's T3 finds text-over-text and T4 finds a stroked line through text.
Neither sees an *opaque fill* — a `pd direct label` cream backing, a `pd state`
diamond — painted across a neighbouring label. That mechanism causes the four
worst-looking failures in the Book:

- **7.7**: the four cut-set diamonds are painted over their own column titles.
  `A CARD` prints as `A C◆RD`, `EVIDENCE` as `EVID◆NCE`, `USER` as `U◆ER`,
  `FOREST` as `FO◆EST`. T3 = 0, T4 = 1.
- **8.5**: the subtitle `the disagreement closes a cycle` is buried under the
  `overlap disagrees` label box. T3 = 0, T4 = 0. Clean on every check.
- **5.7**: the station label `ledger` renders at **1.8 % ink coverage** — the
  amber `slash if overturned` box is on top of it.
- **7.3**: a third of the bold title `replicating identities multiplies entry…`
  is under the `K insurer identities` box.

A candidate **T9** is straightforward and was prototyped for this pass: for every
text span inside a figure, find filled paths overlapping it by more than 15 % of
the span's area, then measure that span's *rendered* ink fraction at 300 dpi. A
multi-character word fully covered by a fill and rendering under 6 % ink is
buried. Run against the Book it flags 2.6, 5.7 and 7.6 with no false positives.
Handing this to the typography agent alongside the per-figure font sets.

### 1.6 Per-figure typefaces

Thirty-nine of the 59 figures mix Heros (sans) and PagellaX (serif) inside one
drawing. The predictor the stack-map agent found holds here: **27 fragments set a
local `font=`**, which replaces the edition's face outright, and those are the
fragments whose measured family set is mixed. `fig-sealed-operating-curve` (10
local `font=`), `fig-sealed-pillar-pipeline` (8), `fig-sealed-two-worlds` (7),
`fig-anchor-phases` (6), `fig-sealed-mutant-grid` (6),
`fig-sealed-composition-crossover` (6), `fig-anchor-cuckoo-inline` (5),
`fig-he-assurance-sieve` (5), `fig-swk-continuity-organs` (5) lead the list. The
per-figure family sets are in the `measured` column of every row below.

---

## 2. The triage

Rubric shorthand: `+fact` / `-fact` etc. for the five points — one readable fact ·
concrete instance · anchored geometry · print contrast at 100 % · no collisions.
A figure earns **keep** only with five `+`.

### Chapter 1

| fig | fragment | page | the page's one idea | role | five-point rubric | measured | dataviz check | verdict | what the pixels show |
|---|---|---|---|---|---|---|---|---|---|
| 1.1 | `fig-swk-stack-map` | 19 | the kernel is the second band of a four-layer stack, above a narrow machine floor | supports | +fact +instance +anchored +contrast +collisions | min 8.72 pt; Heros,PagellaX | form ok (a layered block diagram, not a chart); no dual axis; colour is identity only | **redraw** | Owned by `claude/stack-map-redraw-v2`; the author has accepted that redraw. Left untouched here. Measured anyway: three typefaces inside one picture (Heros bands, a Pagella `MACHINE FLOOR`, a Pagella caption), which every T-check passes. |
| 1.2 | `fig-swk-single-writer` | 25 | many callers, one writer, and the reply only after the commit | carries | +fact +instance +anchored -contrast +collisions | min 8.72 pt; Heros | Gantt is the right form for concurrent work with one order out; no dual axis | **restyle** | Bands are fill-only: the Swiss edition's `pd neutral fill` override sets `draw=none`, so rule 3 ('every band has a drawn edge') fails on the printed page even though the fragment is innocent. |
| 1.3 | `fig-swk-durability-faultclass` | 29 | the default sync level is durable against a process crash but not against power loss | carries | +fact +instance +anchored -contrast +collisions | min 8.72 pt; PagellaX | 2 x 3 classification with a word in every cell: this is a table, and the tint is doing no work the words are not | **table** | Read it aloud and it is a table ('row one, column two says may lose last commits'). Craft rule 3: a classification is booktabs, never a tinted matrix. |
| 1.4 | `fig-swk-claim-lifecycle` | 31 | acquire is one atomic decision; expiry is swept lazily | carries | +fact +instance -anchored +contrast -collisions | min 8.72 pt; Heros | state machine is right; colour is identity | **redraw** | The `re-claim, idempotent` self-loop renders as a floating 2 mm blue stub with no arc back to HELD, so its label is anchored to nothing (rule 3). The EXPIRED-to-FREE sweep is drawn as a full-width dashed rectangle and reads as a box, not an edge. |
| 1.5 | `fig-swk-marker-decay` | 37 | halving the distance from r to 1 more than doubles a marker's life | carries | +fact +instance +anchored +contrast +collisions | min 7.64 pt; PagellaX; T3x1 T4x0 | xy plot, one axis, two series told apart by colour AND by a legend entry carrying each one's number | **keep** | The strongest figure in chapter 1. Both lifetimes (29, 59) are on the plot and in the legend. Only nit: the `0.05` and `0` y-ticks nearly touch. |
| 1.6 | `fig-swk-reference-monitor` | 40 | a mediator decides before the commit; a monitor only subscribes after it | carries | +fact +instance +anchored +contrast +collisions | min 8.72 pt; Heros | two-row timeline; the caution segment is dashed as well as amber, so it survives greyscale | **keep** |  |
| 1.7 | `fig-swk-controllability-quadrant` | 49 | preventable is one cell, not a spectrum | carries | +fact +instance +anchored +contrast +collisions | min 7.73 pt; Heros,PagellaX,SourceCodePro; T3x0 T4x2 | quadrant with one concrete instance per cell and the theorem's cell marked | **keep** | Concrete instances (`git push`, net egress, spawn child) and a named checker in the caption. |
| 1.8 | `fig-swk-commitment-oracle` | 52 | only four typed evidence kinds close a commitment; free text bounces | carries | +fact +instance +anchored +contrast +collisions | min 8.72 pt; Heros | state machine; the refusal edge is dashed as well as red | **keep** | `deadline set by the daemon, not the agent` floats free of any mark, but it is a note, not a datum. |
| 1.9 | `fig-swk-continuity-organs` | 55 | downstream confidence cannot exceed the weakest upstream link | carries | +fact +instance +anchored +contrast +collisions | min 8.72 pt; PagellaX | step chart with an ordinal y axis in words (full / notes only / partial / none): exactly right | **keep** | The cleanest figure in the Book. Nothing floats, nothing collides, every step is named. |
| 1.10 | `fig-swk-workunit-machine` | 60 | six phases, four essential guards, 536 reachable states | carries | +fact +instance +anchored +contrast +collisions | min 8.72 pt; PagellaX | state machine; the guard legend is a two-column text block, not a second encoding | **keep** | The g1-g5 legend is long enough to read as a second caption; consider a booktabs guard table. |
| 1.11 | `fig-swk-consistency-model` | 63 | overlapping operations, one commit order, one linearization | carries | +fact +instance +anchored -contrast +collisions | min 8.72 pt; Heros | Gantt; the extracted order is written under the rail | **restyle** | Same fill-only band defect as 1.2. |

### Chapter 2

| fig | fragment | page | the page's one idea | role | five-point rubric | measured | dataviz check | verdict | what the pixels show |
|---|---|---|---|---|---|---|---|---|---|
| 2.1 | `fig-anchor-capability-attenuation` | 91 | attenuation is conjunctive on rights and time together | carries | +fact +instance +anchored +contrast +collisions | min 8.72 pt; Heros | nested rectangles on two real axes with units; the refused re-grant is a marked datum outside the envelope | **keep** |  |
| 2.2 | `fig-anchor-alg-confusion` | 93 | the same wire bytes are accepted or rejected by who chose the verifier | carries | +fact +instance +anchored +contrast +collisions | min 7.73 pt; Heros,PagellaX,SourceCodePro | two sequence ladders, identical geometry, one difference, numbered messages | **keep** | Provenance names the ProVerif query and file. Model figure for the Book. |
| 2.3 | `fig-anchor-delegation-inline` | 94 | a spliced hop fails at exactly one adjacent-identity boundary | carries | +fact +instance +anchored +contrast +collisions | min 8.72 pt; Heros,PagellaX | DAG with time left to right and the offending edge dashed | **restyle** | Four lines of note under the picture plus a second cream label; craft rule 4 allows one note per figure. |
| 2.4 | `fig-anchor-cuckoo-inline` | 96 | bitwise OR of two filters keeps both placements; the log union does not | carries | +fact +instance -anchored +contrast -collisions | min 8.72 pt; Heros,PagellaX | before/after pair is right, but the ink is inverted: EMPTY buckets are heavy saturated blue blocks and OCCUPIED ones are pale | **redraw** | Row labels (`peer A`, `rebuilt`) run into bucket 1. And the encoding spends the loudest ink on the cells that carry no data - the dataviz 'thick saturated blocks' anti-pattern, applied to the wrong half of the data. |
| 2.5 | `fig-anchor-revocation-gossip` | 98 | revocation advances as an observation frontier, and a partition removes every deadline | carries | +fact +instance +anchored -contrast +collisions | min 8.72 pt; Heros,PagellaX | swimlane with a staircase frontier; the partition marker is dashed as well as red | **restyle** | The stale-exposure window is a fill-only region. |
| 2.6 | `fig-anchor-card-lifecycle` | 99 | acceptance is a one-way interval; a mistake is corrected on a new lane | carries | +fact +instance +anchored +contrast -collisions | min 7.73 pt; Heros,SourceCodePro; T3x2 T4x0 | three lanes on one time axis | **redraw** | Measured bury: `t0+tau` sits under a `pd direct label` backing at 5.9% rendered ink. The `k17 never returns` box lands on the terminal glyph. |

### Chapter 3

| fig | fragment | page | the page's one idea | role | five-point rubric | measured | dataviz check | verdict | what the pixels show |
|---|---|---|---|---|---|---|---|---|---|
| 3.1 | `fig-sealed-pillar-pipeline` | 135 | two fences make the channel enforceable; two gates make it silent, metered and watched | carries | +fact +instance +anchored +contrast +collisions | min 7.62 pt; Heros,PagellaX,SourceCodePro | architecture diagram with named gates and one checker script per property | **keep** | Very heavy ink (black blocks with reversed type), but every mark is named and nothing collides. |
| 3.2 | `fig-sealed-two-worlds` | 138 | two runs identical except the secret, tied at every step | carries | +fact +instance +anchored +contrast -collisions | min 8.33 pt; Heros,PagellaX | two-run lockstep with identity marks and the one permitted difference boxed | **restyle** | `...to depth 7` collides with the amber mutation note on the same line, and the figure carries two notes plus a five-line model-check block. |
| 3.3 | `fig-sealed-mutant-grid` | 144 | both mutants break the balance in one step; only the torn write reaches the cap, in three | carries | +fact +instance +anchored -contrast +collisions | min 8.72 pt; PagellaX | 2 x 2 of words plus a decorative square: a classification | **table** | Every cell is a phrase; the red square adds nothing the word `caught` does not. Plus a seven-line italic note that is a second caption. |
| 3.4 | `fig-sealed-composition-crossover` | 145 | below the crossover quote the basic bound, above it the advanced one | carries | +fact +instance +anchored +contrast +collisions | min 8.72 pt; PagellaX | xy plot, one axis, the crossing marked with both values | **keep** |  |
| 3.5 | `fig-sealed-operating-curve` | 148 | three canaries catch a leak with probability 0.992; the sequential test stops ~30% sooner under a leak | carries | +fact +instance +anchored +contrast +collisions | min 8.72 pt; PagellaX | power curve plus a two-bar comparison, each bar labelled at the tip | **keep** | The two stacked panels have different x quantities; they read as one axis at a glance. |

### Chapter 4

| fig | fragment | page | the page's one idea | role | five-point rubric | measured | dataviz check | verdict | what the pixels show |
|---|---|---|---|---|---|---|---|---|---|
| 4.1 | `legible-swarm-state-of-nature` | 161 | consent changes the schedule, not who may participate | carries | +fact +instance +anchored -contrast +collisions | min 8.72 pt; Heros | two Gantt panels on one time axis; the grants are marked on the commit spine | **restyle** | Fill-only bands again. |
| 4.2 | `legible-swarm-zoom-vs-potemkin` | 168 | a safe summary is an index into evidence; a calm one that terminates early is a facade | carries | +fact +instance +anchored +contrast -collisions | min 8.72 pt; Heros | before/after pair, identical shape, one difference | **restyle** | `resolves to` sits on its own arrowhead in both panels. |
| 4.3 | `legible-swarm-specialization` | 176 | below the Erlang-C boundary pooling wins; above it sole ownership does | carries | +fact +instance +anchored +contrast +collisions | min 7.64 pt; Heros,PagellaX; T3x1 T4x0 | regime plot; both regions filled AND edged; the superseded threshold is dashed and labelled `falsified` | **keep** | The one figure in the Book whose caption says it edged its regions - and it did. |
| 4.4 | `legible-swarm-sdt` | 181 | a miss costs far more than a false alarm, so the optimal criterion sits left of the throughput optimum | carries | +fact +instance +anchored +contrast +collisions | min 8.72 pt; Heros,PagellaX | two named densities with a criterion line; the idealisation is named in the caption | **keep** | The miss region is tinted; the false-alarm region is only labelled - the two are encoded inconsistently. |
| 4.5 | `legible-swarm-readpoverty` | 188 | splitting the digest costs 2.13x, not the 2x halving the readers would predict | carries | +fact +instance +anchored +contrast +collisions | min 8.72 pt; Heros,PagellaX | two curves, both values at N=60 direct-labelled | **keep** | The caption honestly says the sweep CSV is not committed and the curves are the closed form. Commit `r1-floor.csv` and this becomes verified. |
| 4.6 | `legible-swarm-split-ranker` | 201 | fit and regret are not comonotone: A and B fully invert | carries | +fact +instance +anchored +contrast -collisions | min 8.72 pt; Heros | slope chart, two ranked axes, one line per item | **redraw** | The four candidate description boxes overlap each other on both sides: `safe, calm` is clipped by the `C` heading, `risky, tense` by `D`. Four clipped labels out of eight. |
| 4.7 | `legible-swarm-roles` | 212 | one grant, gated acts, and one override edge that bypasses the agents | carries | +fact +instance +anchored +contrast +collisions | min 8.72 pt; Heros | sequence diagram, three lifelines, no crossing | **restyle** | The caption numbers the messages 1-4; the drawing does not, so the reader cannot match them. |

### Chapter 5

| fig | fragment | page | the page's one idea | role | five-point rubric | measured | dataviz check | verdict | what the pixels show |
|---|---|---|---|---|---|---|---|---|---|
| 5.1 | `fig-stp-role-vs-person` | 237 | a role is a slot; a person is a longitudinal record | carries | +fact +instance -anchored -contrast -collisions | min 4.96 pt; Heros; T3x0 T4x4 | two rails on one time axis | **redraw** | `obligation + capability + authority` renders at 4.96 pt and `non-forgeable identity` at 5.0 pt - both from a `\tiny` in the fragment, which `tikz_precheck` already calls a hard error. The `PERSON:` heading is overprinted by the role labels below it. |
| 5.2 | `fig-stp-parfit-chain` | 240 | continuity is an overlap chain, not permanent connectedness | carries | +fact +instance +anchored -contrast -collisions | min 5.56 pt; Heros,PagellaX; T3x1 T4x0 | overlap bands on one rail | **redraw** | The `o2` and `o3` witness labels are clipped in half by the band above them, and `o4` renders as a stray `4` beside `shared witness o3`. |
| 5.3 | `fig-stp-nomint-lineage` | 242 | budget-only sums to 2.439 > 1; transfer sums to 0.729 <= 1 | carries | +fact +instance +anchored +contrast +collisions | min 8.72 pt; Heros,PagellaX | three panels, identical geometry, one difference; every node carries its own number | **keep** | Provenance names the script and the seed. The best figure in chapter 5. |
| 5.4 | `fig-stp-probation-cliff` | 252 | a unit of deterrence bought nine periods late costs the honest newcomer 62.5x | carries | +fact +instance +anchored +contrast +collisions | min 8.72 pt; Heros,PagellaX | column chart; ten bars, each with its value - defensible here because the values ARE the claim | **keep** | Real data, script and seed named. |
| 5.5 | `fig-stp-sybil-whitewash` | 254 | principal binding carries the penalty across body leases and freezes quorum weight | carries | +fact +instance -anchored -contrast -collisions | min 7.75 pt; Heros; T3x0 T4x2 | two panels, but neither y axis has a scale and panel B's x axis has none either | **redraw** | `3` and `respawns` overprint each other on the x axis, and a dotted guide is drawn straight through `one principal = one accountable weight`. |
| 5.6 | `fig-stp-multidim-reputation` | 266 | one quality vector supports a legitimate preference reversal | carries | +fact +instance -anchored -contrast -collisions | min 5.02 pt; Heros,PagellaX; T3x0 T4x2 | slope chart, but the vertical whiskers sit on no axis and carry no scale | **redraw** | `weights .60, .30, .10` at 5.0 pt (another `\tiny`). Purple and red are `pd*` page-grammar hues; craft rule 4 restricts figures to the `hh*` set. |
| 5.7 | `fig-stp-judge-market` | 268 | neutrality is earned before selection; accountability persists after it | carries | +fact +instance +anchored -contrast -collisions | min 6.11 pt; Heros,PagellaX; T3x1 T4x5 | one rail with named stations - the right form | **redraw** | Measured bury: the station label `ledger` renders at 1.8% ink because the amber `slash if overturned` box is painted over it. `blind grade`, `ledger` and `re-audit` all run together. |
| 5.8 | `fig-stp-rate-the-raters` | 272 | heterogeneous sampling closes the audit tower in 27 levels; a monoculture needs 53 | carries | -fact -instance -anchored -contrast +collisions | min 4.81 pt; Heros,PagellaX; T3x0 T4x5 | the worst graphical-integrity failure in the Book: a hand-placed `plot[smooth] coordinates` curve drawn where the chapter's own recurrence gives a different shape | **redraw** | **Redrawn in this change.** The chapter's model is two-phase - a LINEAR bleed of C*beta per level while G_k > CB, then a geometric decay - so on a log axis the monoculture is concave for 35 levels and then straight. The committed drawing showed one smooth convex curve for both pools, with no y-axis values at all and 4.8 pt sublabels from a `\tiny`. |
| 5.9 | `fig-stp-deterrence-regime` | 275 | the frontier is rho*B = G/d; the worked point sits on it at rho = 0.25, B = 50 | carries | +fact +instance +anchored -contrast +collisions | min 7.67 pt; Heros,PagellaX | regime plot with a real frontier and a marked worked point | **restyle** | The deterred region is a fill-only lavender wash and the `capture pays` side is neither filled nor edged - the two regions are encoded differently for no reason. The trailing `G` of the region label wraps to a line of its own. |
| 5.10 | `fig-stp-tombstone` | 277 | a tombstone changes score consumption without rewriting history | carries | +fact +instance +anchored -contrast -collisions | min 6.11 pt; Heros,PagellaX; T3x2 T4x1 | two stacked traces on one rail - right form | **redraw** | The rotated y-axis label `score contribution` is printed straight through the bold heading `contribution of o3 to spendable reputation`. Neither trace has a y scale. |

### Chapter 6

| fig | fragment | page | the page's one idea | role | five-point rubric | measured | dataviz check | verdict | what the pixels show |
|---|---|---|---|---|---|---|---|---|---|
| 6.1 | `fig-he-three-sided` | 296 | one agent carries three different risk signatures, all closing through one journal | carries | +fact +instance +anchored +contrast +collisions | min 8.28 pt; Heros,PagellaX | three rows, one spine; line thickness redundantly encodes the exposure type | **keep** |  |
| 6.2 | `fig-he-float-plan` | 301 | the wallet debit and the escrow row happen at the same commit | carries | +fact +instance +anchored +contrast -collisions | min 8.2 pt; Heros; T3x1 T4x2 | four-lane state transition on one time axis | **redraw** | The panel title is destroyed: `execution becomes admissible at one committed transition` is overprinted from its midpoint by the `atomic commit boundary` box. `abort: all three traces unchanged` has the worker-state rule drawn through it. |
| 6.3 | `fig-he-conservation-functor` | 311 | a native unit closes to zero; a conversion cannot without a named valuation | carries | +fact +instance -anchored -contrast +collisions | min 5.96 pt; Heros,PagellaX; T3x0 T4x1 | waterfall - right form, but no y-axis values at all, so the reader cannot check that the bars sum to zero | **redraw** | A waterfall whose whole claim is a sum, drawn with no scale, carries nothing the sentence does not. Bars are fill-only. |
| 6.4 | `fig-he-cold-start` | 320 | the regime changes when observed depth crosses lambda*, not when time passes | carries | +fact +instance -anchored +contrast +collisions | min 5.92 pt; Heros,PagellaX; T3x0 T4x1 | two stacked panels sharing one x axis and one trigger - a good idea | **restyle** | Neither y axis is scaled, and the `lambda*` label is set on top of its own dashed rule. |
| 6.5 | `fig-he-assurance` | 332 | each independent reviewer multiplies residual risk down: 40% to 1.0% over five | carries | +fact +instance -anchored +contrast +collisions | min 5.47 pt; Heros,PagellaX | risk-cost trajectory on a log y - right form; the amber correlated-reviewer counterfactual is dashed as well as coloured | **restyle** | Neither axis carries a single tick value, so `cumulative cost rises linearly` cannot be checked - the points are evenly spaced by construction. The chapter gives b = 30 CR; put it on the axis. |

### Chapter 7

| fig | fragment | page | the page's one idea | role | five-point rubric | measured | dataviz check | verdict | what the pixels show |
|---|---|---|---|---|---|---|---|---|---|
| 7.1 | `fig-governance-flow` | 358 | intervention rises only when the cheaper exit fails, and every station lands on one evidence rail | carries | +fact +instance -anchored -contrast -collisions | min 5.84 pt; Heros,PagellaX; T3x7 T4x4 | escalation staircase - right form | **redraw** | Seven measured text-over-text overlaps and four lines through text: `3 BONDED PREEMPTION` runs into `machine limit reached`, and `one evidence-bound resolution rail` has a vertical arrow drawn through it. Edge labels at 5.8 pt. |
| 7.2 | `fig-pareto-dominance.pdf` | 377 | the auction's Pareto advantage survives moderate noise and collapses past sigma_r = 0.1 | carries | +fact +instance +anchored -contrast -collisions | min 3.58 pt; Palatino; T3x0 T4x2 | two matplotlib panels; no dual axis, but the type does not survive the Book measure | **redraw** | An imported matplotlib PDF scaled into a 4.5 in column: the run-provenance footnote renders at 4.2 pt and `criterion met` at 4.2 pt, against a 7 pt floor. Typeface is Palatino/STIX, outside the house set. |
| 7.3 | `fig-sybil-inline` | 377 | deposit-only deterrence saturates once the deposit reaches the coverage B_T | carries | +fact +instance +anchored +contrast -collisions | min 3.58 pt; Palatino; T3x0 T4x2 | a knee plot beside a fan-out - the right pair | **redraw** | The bold title `replicating identities multiplies entry, not the loss attached to one default` is buried under the `K insurer identities` label box for a third of its length. |
| 7.4 | `fig-sybil-deposit-floor.pdf` | 378 | the attacker still profits past B_dep = 200 because the slash is capped at coverage | carries | +fact +instance +anchored -contrast -collisions | min 2.9 pt; Palatino; T3x0 T4x4 | two matplotlib panels, correctly separate rather than dual-axis | **redraw** | Smallest type measured anywhere in the Book at 2.9 pt (`Profitable-trial fraction: 1.000-1.000; Wilson 95% envelope ...`). The in-plot `coverage cap reached` annotation is ~3.5 pt and sits on its own dashed rule. |
| 7.5 | `fig-cartel-game-inline` | 379 | a rare severe loss and a frequent small loss can sit on the same deterrence boundary | carries | +fact -instance -anchored -contrast -collisions | min 5.6 pt; Heros; T3x1 T4x0 | regime plot - right form, but the boundary is a hand-placed smooth curve with no data and neither axis carries a number | **redraw** | Craft rule 3: a schematic curve with no data is a sentence. Both regions are bare `\fill`s at 11% and 7% alpha, below the 24% floor and with no edge - `tikz_precheck` flags the bare fill today. The two axis annotations collide with the formula note under the axis. |
| 7.6 | `fig-cartel-folk-theorem.pdf` | 380 | cartel sustainability collapses once per-round detection crosses ~0.048 | carries | +fact +instance +anchored -contrast -collisions | min 2.35 pt; Palatino,STIXGeneral; T3x1 T4x4 | a categorical heat grid (S/C) plus a companion line panel; colour is doubled by the letter, which is right | **redraw** | The assumptions line renders at **2.35 pt** - the least legible text in the Book. Cell letters ~4 pt, legends ~3 pt. |
| 7.7 | `fig-bonded-key-custody` | 392 | three cuts need one secret each; impersonation is the only conjunctive one | carries | +fact +instance +anchored +contrast -collisions | min 4.89 pt; Heros,PagellaX; T3x0 T4x1 | four cut sets side by side with a teal control baseline under each | **redraw** | The diamonds are painted over their own column titles: `A CARD` prints as `A C(diamond)RD`, `EVIDENCE` as `EVID(diamond)NCE`, `USER` as `U(diamond)ER`, `FOREST` as `FO(diamond)EST`. Four of four titles damaged. |
| 7.8 | `fig-magic-link-inline` | 393 | two overlapping requests, one durable state edge | carries | +fact +instance +anchored -contrast -collisions | min 5.98 pt; Heros,PagellaX,SourceCodePro; T3x4 T4x2 | four-lane lockstep - right form | **restyle** | `request intervals overlap` is overprinted by the SQL line above it; `the rejected consumer creates no second state transition` has the drain band's edge drawn through it. Tick numerals at 6.0 pt. |
| 7.9 | `fig-worked-example` | 402 | authority breaks at minute 12; evidence and escrow do not | carries | +fact +instance +anchored -contrast +collisions | min 5.65 pt; Heros,PagellaX; T3x0 T4x3 | three-lane braid on one minute axis with real times | **restyle** | Tick numerals at 5.65 pt (the `\resizebox` effect at Book measure); a dotted rule crosses `cleanup exposure remains funded through the crash`. |
| 7.10 (new) | `fig-bc-graduated-trigger` | - | the three-round graduated window costs 0.009 of patience over grim | carries | +fact +instance +anchored +contrast +collisions | no word under 8.5 pt (only 1-glyph math scripts at 6.4-7.0); Heros + PagellaX; T1-T8 all pass at 11.43 cm, under both preambles | xy plot against a labelled floor; one series, so no legend | **add** | **Added in this change.** The chapter states delta*(3) ~ 0.342 and 'barely 0.009' in prose and never shows that the premium is 0.167 at k=1, 0.033 at k=2 and 0.001 by k=5 - the shape is the reason the production strategy can afford to forgive. |
| 7.11 (new) | `fig-bc-oracle-audit-rate` | - | the default 10% human-audit sample is about twice the rate the cartel model needs | carries | +fact +instance +anchored +contrast +collisions | no word under 8.5 pt (only 1-glyph math scripts at 6.4-7.0); Heros + PagellaX; T1-T8 all pass at 11.43 cm, under both preambles | threshold curve with an edged region below it and two policy rules; direct labels, no legend | **add** | **Added in this change.** The chapter says the audit rate sets the oracle layer's detection probability and that '10% is a starting point', without ever putting 10% beside the threshold. A 5% sample stops clearing it at delta = 0.964. |

### Chapter Table (new)

| fig | fragment | page | the page's one idea | role | five-point rubric | measured | dataviz check | verdict | what the pixels show |
|---|---|---|---|---|---|---|---|---|---|
| Table (new) | `tab-bc-settlement-rule` | - | the settlement rule is a lookup on how the three oracles agree | supports | n/a (table) | no word under 8.5 pt (only 1-glyph math scripts at 6.4-7.0); Heros + PagellaX; T1-T8 all pass at 11.43 cm, under both preambles | n outcomes x m properties: booktabs, not a figure and not three bullets | **add** | **Added in this change**, replacing a three-item prose list. Craft rule 3. |

### Chapter 8

| fig | fragment | page | the page's one idea | role | five-point rubric | measured | dataviz check | verdict | what the pixels show |
|---|---|---|---|---|---|---|---|---|---|
| 8.1 | `fig-fh-threat-bands` | 417 | assurance advances only when a threat acquires an artifact or a theorem | carries | +fact +instance +anchored +contrast -collisions | min 7.76 pt; Heros,PagellaX; T3x1 T4x9 | dot plot on an ordinal assurance axis - right form | **redraw** | `pushback is not a bound` is overprinted by the axis title `assurance position` at 55% overlap, plus nine measured line-through-text hits. The dotted continuation rules after every label are pure chartjunk. |
| 8.2 | `fig-fh-xfer-ceremony` | 418 | authority shrinks while destination-local verification takes over | carries | +fact +instance +anchored -contrast +collisions | min 6.05 pt; Heros; T3x0 T4x4 | a narrowing envelope where the prose gives four numbered messages with exact payloads: this wants to be a sequence diagram | **redraw** | Taxonomy: 'a protocol between named parties' is a sequence diagram with numbered messages and what each binds. The bottom note runs past the picture's own right edge and glues two sentences together. |
| 8.3 | `fig-fh-revocation-gossip` | 421 | the exposure window is a moving staleness frontier, not a deadline | carries | +fact +instance +anchored -contrast -collisions | min 7.37 pt; Heros,PagellaX | swimlane with a staircase; the amber exposure area is the claim | **restyle** | The double arrow is drawn straight through `exposure lasts until the local authority receives the revocation`. Both bands are fill-only. |
| 8.4 | `fig-fh-revocation-regime` | 422 | once the two operational bounds exceed the TTL, only the expiry binds | carries | +fact +instance +anchored -contrast +collisions | min 7.67 pt; Heros | regime plot with both axes in real units (rounds) and the TTL as the boundary | **keep** | Regions are fill-only, but the boundary line is drawn and both regions are labelled in words. |
| 8.5 | `fig-fh-cycle-vs-cut` | 426 | the same disagreement is visible on C6 (r = 1.2247) and invisible on P6 (r = 0) | carries | +fact +instance +anchored +contrast -collisions | min 8.72 pt; Heros,PagellaX | graph pair, same node set, the quantity under each - exactly the taxonomy's prescription | **restyle** | The subtitle `the disagreement closes a cycle` is buried under the `overlap disagrees` label box (a fill painted over text, which figcheck T3/T4 cannot see). |
| 8.6 | `fig-fh-settlement` | 432 | the custody bound is the absence of an extra transition | carries | +fact +instance +anchored +contrast -collisions | min 6.62 pt; Heros,PagellaX; T3x1 T4x0 | before/after pair of the same ceremony with one added edge | **restyle** | `compensate claimant` runs into panel B's `funded` at 21% overlap; `redirect / second close` sits on the red worst-case rule. |

---

## 3. Counts

| disposition | n | which |
|---|---|---|
| **keep** | 18 | 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 2.1, 2.2, 3.1, 3.4, 3.5, 4.3, 4.4, 4.5, 5.3, 5.4, 6.1, 8.4 |
| **restyle** | 16 | 1.2, 1.11, 2.3, 2.5, 3.2, 4.1, 4.2, 4.7, 5.9, 6.4, 6.5, 7.8, 7.9, 8.3, 8.5, 8.6 |
| **redraw** | 23 | 1.1, 1.4, 2.4, 2.6, 4.6, 5.1, 5.2, 5.5, 5.6, 5.7, **5.8**, 5.10, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.1, 8.2 |
| **table** | 2 | 1.3, 3.3 |
| **delete** | 0 | — |
| **add** | 3 | 7.10, 7.11, and the settlement-rule table |
| *judged* | **59** | every figure in the Book |

Of the 23 redraws, **one is done in this change** (5.8) and **one belongs to
another branch** (1.1, `claude/stack-map-redraw-v2`, already accepted by the
author). Twenty-one are specified here and not drawn.

Nothing earned **delete**. Every figure in the Book is carrying an idea the prose
depends on; what fails is the execution, not the choice to have a figure.

## 4. Missing figures — the pages that asked and got nothing

Fifty-one pages sit in figure-free runs of three or more inside a chapter body.
Most are exercises, related work or conclusions, where the answer to *"can a
reader read one true thing off a drawing here that the prose cannot say in a
sentence?"* is honestly **no**. Three pages answered **yes**:

### 4.1 §7.7.4, the graduated trigger — **drawn** (`fig-bc-graduated-trigger`)

The chapter derives δ\*(k=3) ≈ 0.342 against the grim bound 1/3 and says the
three-round window "adds barely 0.009". The sentence is true and it hides the
shape: the premium is **0.167** at one round of punishment, **0.033** at two,
**0.009** at three and **0.001** by five. The reader cannot get the curvature
from the sentence, and the curvature is the whole argument for why a *forgiving*
production strategy is affordable. One readable fact: **crash tolerance is paid
for in the first two rounds.** The chapter even sets it as Exercise 7.x.

Evidence: the root of 2(δ + ⋯ + δ^k) = 1 at the chapter's own stage game
(d − c = 1, c − p = 2). δ\*(3) = 0.34251 reproduces the chapter's 0.342.

### 4.2 §7.7.5.6, oracle collusion — **drawn** (`fig-bc-oracle-audit-rate`)

The chapter says the human-audit sampling rate σ *is* the oracle layer's
detection probability, that the folk-theorem threshold is therefore a calibration
target on σ, and that "the default 10 % sample is a starting point" — and never
puts 10 % beside the threshold it must clear. One readable fact: **the default
sample is about twice the rate the model needs, and a halved sample stops
clearing it at δ = 0.964.** That is a deployment decision the prose leaves the
reader unable to make.

Evidence: p\*(δ) = (π_C − (1−δ)π_D)/(L + δπ_D) at the chapter's supplied payoffs
π_C = 5/3, π_D = 4.95, L = 25 — which reproduces the chapter's own anchor
p\*(0.95) ≈ 0.0478 exactly.

### 4.3 §7.7.5.6, the settlement rule — **tabled** (`tab-bc-settlement-rule`)

Three verdict patterns × three properties, written as three prose bullets a
reader has to hold in order. Craft rule 3: a classification is a `booktabs`
table. The prose list is replaced.

### 4.4 Asked and answered "no"

For the record, so the question is not re-opened: §1.14 (adjacency contract),
§4.8 (tokens as COGS), §5.14–5.16 (exercises, open problems, conclusion), §6.16
(related work), §7.7.5.7 (the Bonded Advisor), §8.10–8.12 (failure modes,
related work, limitations) all carry arguments whose content is a sentence or a
citation, not a drawing. §4.6's read-poverty lead-in and §8.3's threat model
already have figures on the facing pages.

## 5. What the CSVs are

`whitepaper/figures/data/` is new. It holds the series behind the three figures
this change touches, plus the script that emits them:

| file | series | provenance |
|---|---|---|
| `make-figure-data.py` | the emitter | deterministic closed forms; no seed, no sampling |
| `audit-tower-depth.csv` | G_k by level for C = 1, 2, 8 | Ch. 5 §5.11 "Numbers by hand": G₀ = 400, B = 50, ρd = 0.2 |
| `graduated-trigger-threshold.csv` | δ\*(k), k = 1…12 and grim | Ch. 7 §7.7.4 stage game |
| `oracle-audit-threshold.csv` | p\*(δ), δ = 0.80…1.00 | Ch. 7 §7.7.5.10 supplied payoffs |

Reproducing the chapters' own published numbers is the check: 27 / 36 / 53
levels and \$1,350 / \$1,800 / \$2,650; δ\*(3) = 0.34251 against the quoted
0.342; p\*(0.95) = 0.04778 against the quoted 0.0478.

## 6. What this pass did not do

- Twenty-one specified redraws are not drawn. The specs are in the `verdict` and
  `what the pixels show` columns; they are enough to brief a renderer.
- `pd-figure-language-swiss.tex` is not touched, so finding 1.1 is reported and
  not fixed. It belongs to the design-system branch.
- The `\resizebox`-to-natural-width conversion (finding 1.2) is not applied to
  the twenty-four fragments that need it.
- Three imported matplotlib PDFs are not regenerated.
- `T9` (a fill painted over text) is prototyped and reported, not landed in
  `figcheck.py`.
- The whole Book was not rebuilt in this historical pass: the local TeX shim
  did not auto-fetch packages and `algpseudocode` was still installing. The
  standalone-chapter comparison named here is retired; current figure judgment
  uses the Swiss Book preamble and the assembled Book only.
