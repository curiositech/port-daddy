# The Harbor Volume — Consolidated Defect Inventory

7 papers, all compile. Two render-visible build defects (`§??` refs in harbor-economy). The rest is cohesion, voice, figure-semantics, and one structural overhaul (workbook extraction). Ordered: cross-cutting first, then per-paper, blocking → major → minor inside each.

Paper key: **LS** legible-swarm · **SWK** single-writer-kernel · **STP** spawn-to-person · **HE** harbor-economy · **BC** bonded-commons · **AP** anchor-protocol · **FH** federated-harbor.

---

## A. CROSS-CUTTING (affects all / most papers)

### A1. BLOCKING — Volume size / numbering is incoherent across the set
Every paper hard-codes a different denominator. This is the single most load-bearing defect: it's on the title page and footer of every paper.

| Paper | Currently claims | Files / lines |
|---|---|---|
| LS | "Paper 1 of 4", "four-paper volume" | title, footer, abstract, stack-map fig |
| SWK | "A Four-Paper Series", "a four-paper volume" | l.170, l.233 |
| STP | "Paper 3 of 4" | footer l.166, title l.173 |
| HE | "Paper 4 of 4", "four-paper volume" | l.4, 160, 167, 179, 228 |
| BC | "THE PORT DADDY TRILOGY / PAPER I OF III" | l.171, 166 |
| AP | "TRILOGY / PAPER II OF III" | l.115, 162 |
| FH | "TRILOGY / PAPER III OF III" | l.164, footer |

Three different volume sizes (3 / 4 / 7) on disk simultaneously. **Fix = adopt one series framing volume-wide (see PLAN §REFRAME).** Retire "Trilogy" and "N of M" hard counts in favor of a volume name + role label.

### A2. BLOCKING — "Layer" / count overloading (the operator's flagged "4 layers and 3 proofs" problem)
The word *layer* means 4+ different things, sometimes within one paper:
- **LS**: 4-layer stack (L0–L3) vs "three-layer cure" (existence/relevance/trust, l.1159) vs "three continuity organs" (l.1769).
- **SWK**: 4-point maturity scale vs "three deontic modalities" vs "three continuity organs" vs "two delegation chains".
- **BC**: "three layers" (architecture, canonical Fig 1 + Layer-1/2/3 sections + conclusion l.1281) vs "four layers" (Reader's Map table l.188). Flat contradiction inside one paper.
- **AP**: "four phases" vs "three protocol phases verified" vs "three-layer verification stack" — bare "three" means three different things.
- **FH**: Reader's-Map "5 layers" vs Contributions "6" vs threat-bands "3" vs formal-model "2".

**Fix = reserve ONE noun per axis volume-wide** (see PLAN §REFRAME). Distinct nouns: *layer* (the L0–L3 substrate stack only), *organ*, *phase*, *band*, *track/pillar* (reading map), *proof*. Never a bare numeral without its noun.

### A3. MAJOR — No print-safe failure RED anywhere in the figure palette
Not one paper defines a mayday-red. Every failure / blocked / forbidden / revoked / fraud / slash state is forced onto **cobalt** (the control/info hue) or amber or ink — so failure reads as information. This is the root of every "transitive-closure-failure" figure defect below.
**Fix = add ONE AAA-on-cream error-red to `website-v2/scripts/check-figure-palette.mjs` ALLOWED_HEX, then route all failure states to it** (candidate hex in PLAN §COLOR; STP audit verified `#5A0000` 13.7:1, `#8B0000` 9.37:1, `#991B1B` 7.78:1 on `#FBF7EF`).

### A4. MAJOR — Status-encoding convention contradicts itself (hue vs weight)
SWK body states the house rule "status by WEIGHT and SMALL-CAPS, never a rainbow" (l.46) — and the `\Built`/`\Designed` macros obey it — but the **figures** color status tags by hue (teal=implemented / cobalt=partial / amber=specified). HE's `fig-he-stack-map` invents off-vocabulary grades (`built`, `whitepaper'd`) not in the Maturity Key. **Fix = pick one volume-wide.** Recommend: figures adopt the semantic hue language AND the body relaxes the "never hue" claim to "never DECORATIVE hue; hue is reserved for the four semantic states." Kill `whitepaper'd` (HE `fig-he-stack-map.tex` l.37).

### A5. MAJOR — Exercise blocks read as courseware, not a proclamation volume
Boxed "Exercises" / "Check / Trace / Open" blocks with ★ difficulty stars appear in LS (every section), SWK (10 blocks, l.95–103 + instances), STP (§3/§10/§11/§12), BC (Appendix C, E1–E9 with "Hint:" lines). LS's are the cleanest; SWK/STP/BC tip into syllabus. STP's are also **mis-numbered** (see STP-min below). **Fix = extract ALL of them into a separate companion Workbook (.tex); papers keep a one-line pointer.** Full spec in PLAN §WORKBOOK.

### A6. MAJOR — Italics over-use (the operator's "italics overdone" flag) — see §C roll-up
Density across the volume: LS ~326 `\emph`/~2150 lines, SWK 176 `\emph`+26 `\textit`, STP 277+64=341 (~10/page), HE/BC/AP/FH all carry reflexive negation/copula stress. Per-line roll-up in §C.

### A7. MAJOR — Companion-paper naming drift
Same paper cited by different tokens: Paper 2 is "The Anchor Protocol" / "The Harbor Daemon" (LS l.232) / "the formal-core paper" (STP) / "Anchor Protocol substrate" vs "Anchor Protocol proper" (HE §6 vs AP). Paper 4 is "The Harbor Economy" once but "market paper"/"companion market paper" 18+ times (STP). "From Spawn to Person" vs "the personhood paper" (SWK l.269, 388…). **Fix = first mention `Title (Paper N)` then `Paper N` thereafter, one canonical title token per paper.**

### A8. MAJOR — Forked federation content (HE ⇄ FH)
HE inlines the entire federation layer (`sec:fh-*`, `fig-fh-*`) AND defers to "the companion federation paper"; `federated-harbor-whitepaper.tex` exists with the same material. The two undefined refs in HE (`sec:fh-lim-cartel`, `fig:cartel-folk`) are the merge scar. **Fix = decide one home** (PLAN §WAVE-2 HE/FH).

### A9. MINOR — "Cinnabar" ghost references
AP `fig-anchor-verification-stack` caption says "Cinnabar arrows" but arrows are cobalt; HE `fig-he-three-sided` prose says "dashed-red band" but the box is `draw=hhcobalt`. Cinnabar was retired from the volume; these are stale word↔color mismatches. **Fix = correct caption/prose word OR recolor to the new red.**

---

## B. THE TWO OPERATOR-NAMED FIGURE CLASSES

### B1. "Transitive-closure-failure" figures — a blocked/absent link drawn as a *dashed cobalt arrow* instead of *red + ✗*
This is the same defect in six figures. In every case the meaning is "NO valid path / this is forbidden / this binding does not exist," but it renders as a tentative-but-valid blue link.

| Paper | Figure file | Page | What's wrong | Fix |
|---|---|---|---|---|
| LS | `figures/legible-swarm-zoom-vs-potemkin.tex` | 12 | Potemkin panel: dashed cobalt arrow → dashed cobalt void box. Reads "weak link exists"; point is NO link. | Mayday-red arrow dead-ending in bold red ✗ at a void marker; red tile border; keep good-zoom arrows seafoam/teal. Contrast by HUE (teal=reaches-truth, red=terminates), not solid-vs-dashed. |
| SWK | `figures/fig-swk-reference-monitor.tex` | 18 | "compensate (undo/salvage)" feedback edge is dashed teal — reads optional; it's the monitor's ONLY power. | Solid mayday-red edge + small undo glyph; "observes" edge solid cobalt/teal; keep dashing only for the commit line. |
| STP | `figures/fig-stp-parfit-chain.tex` | 11 | Reid's non-transitivity ("does not remember") drawn dashed cobalt — reads "weaker link that still exists." | Faint gray line + bold red ✗ at midpoint, label "no direct memory (Reid)"; solid "remembers" arcs stay ink. |
| HE | `figures/fig-he-keystone-split.tex` | 12 | Cross-operator-attestation gap drawn `<->` cobalt + cobalt "specified→proposed" box — the keystone the market provably does NOT have. | Mayday-red arrow + ✗ overlay (or break it); keep cobalt only on the two intact intra-harbor trust roots. |
| AP | `figures/fig-anchor-capability-attenuation.tex` | — | Forbidden downstream grant = dashed cobalt `na` arrow. | Solid mayday-red bar-headed/crossed arrow + large red ✗; forbidden text node red. |
| FH | `figures/fig-fh-settlement.tex` | 17 | "Forbidden" outcome box = same cobalt fill as legitimate "Refuse"; impossibility shown as dashed cobalt arrow "ruled out structurally". | "Forbidden" → red fill + ✗ badge + barred connector; "Clear" teal; "Refuse" → neutral amber. Three outcomes: success / neutral-decline / blocked. |

Plus adjacent same-hue-collapses-meaning failures: AP `fig-anchor-alg-confusion` (successful exploit "ACCEPT(bad!)" in cobalt), AP `fig-anchor-revocation-gossip` (revoked nodes cobalt), BC `fig-bonded-three-layer` (refused path dashed cobalt + 5pt dot, not a red ✗), BC `fig-sybil-inline` (whole adversary cluster cobalt), STP `fig-stp-tombstone`/`fig-stp-judge-market`/`fig-stp-role-vs-person`/`fig-stp-rate-the-raters`, HE `fig-cartel-game-inline`. All resolve under A3 (add red) + route failure→red.

### B2. "Memory multi-angle" figures — the continuity through-line drawn as a flat equal-weight conveyor, failing to convey its profundity
The volume's spine (memory → checkpoint → ledger → identity → reputation → market) renders as three identical boxes in a row. The "two built, one not" maturity gradient and the "three different ANGLES on the same thing" idea are carried only by 8pt text.

| Paper | Figure file | Page | What's wrong | Fix |
|---|---|---|---|---|
| SWK | `figures/fig-swk-continuity-organs.tex` | 22 | Flat 3-box conveyor + star over box 2. Through-line invisible in geometry. | Redesign as ascending staircase/vertical stack: each tread labeled with the angle it answers (memory="what the agent remembers" / checkpoint="what survives its death" / ledger="what the world will vouch for"); through-line arrow LEAVING the top toward the economy paper; maturity by SHAPE/fill solidity (solid=implemented, hatched=partial, ghosted-outline=specified). |
| STP | `figures/fig-stp-three-organs.tex` | 12 | All three organs identical `hhsand!30` fill; source comments claim teal/amber/blue fills never applied. | Maturity-coded: organ1 solid seafoam fill+border; organ2 amber fill + "gums not teeth" caveat glyph; organ3 paper/white fill + dashed border. Add journal / brain-snapshot / witnessed-seal icons. |
| HE | spine equation l.366–370 (overflows 188pt) | — | The literal spine is an inline equation clipped by the margin. | Render as a small horizontal TikZ pipeline figure (also lets it carry the semantic palette + icon vocabulary). |

**Volume-wide:** these three should share ONE visual language — the same staircase/pipeline grammar and the same three icons — so a reader who learns it in SWK recognizes it in STP and HE.

---

## C. ITALICS-MISUSE ROLL-UP (with line refs)

Rule for the fix swarm: italics mark a genuine **contrast pair** only. Demote stress-italics, negation-italics, copula-italics, proper-name-italics, and decorative term-intros to roman; bold-once-at-definition for load-bearing nouns.

**LS** — l.821 see/rules (over-repeated pair), l.684 `why`/`how` (4+ uses; also l.831 `right`, l.1755 `now`/`why`), l.315 + l.435 `uncertainty` (repeated punchline keyword), l.194/195/297 + 2 fig titles `local` (bold once, roman after), l.512 + l.1586 `most`/`least`, l.519/706/543 "political theorist" frame. Root cause: ~326 `\emph` (1 per 6.6 lines).

**SWK** — global 176 `\emph`+26 `\textit`; l.300 three italic spans in one reference-monitor sentence (roman them); l.288 italic `not`; l.553 + l.890 italicized rhetorical questions ("What survives?"/"What happens?" — set roman); l.1457 italic inside a keyidea box (use bold).

**STP** — global 341 italic spans (~10/page); l.319 character names italicized inconsistently (Drake/Wren/Pike/Finch/Heron emph'd, Alice/Bob never — drop italics on ALL names); l.1093 italic `not` **inside a section heading** (pollutes ToC + running header — restructure the title); ~15 reflexive `not`/`is`/`be` single-word emphases (l.216,289,582,629,646,862,1000,1060,1093,1162,1413,1451,973,981,985). KEEP l.706 `of-record`/`of-execution` (genuine contrast — the template to prune toward).

**HE** — l.555 `actually`, l.738 `stops`, l.723 `is` (copula; recurs 474,479,951,958), l.356 `same` (×9: 356,581,644,793,1235,1371), l.565 "real…not an aspiration" (drop the italic protest), l.204 `not` (×15: 190,204,315,384,474,713,718,1059,1076,1080,1083…), l.853 `this` (deixis; also 306,1235). KEEP l.486 `at the conservation object`/`at the identity object` (correct contrast — drowning among the decorative ones).

**AP** — l.153 nested `\textit` note with `\emph` title inside (italic-in-italic cancels); l.241 `\textit{entire chain}` (use `\emph` for house consistency); l.286 lifecycle state names in `\textit` (use `\texttt`/`\textsc`); l.334 `\textit{injective agreement}` (use `\emph`); l.320 design/implementation contrast in `\textit` (use `\emph`). Standardize on `\emph` for contrast, `\texttt`/`\textsc` for named states.

**FH** — l.166 double-emph in series box (keep Why/How/across tricolon, drop "commons authority"); l.299 re-italicizing "intra-/inter-harbor" in running prose (italicize once at definition); l.635 `did not`, l.752 `is` (negation/copula tics; recur 240,287,322,324,326,538,635,752).

**BC** — l.827/834/839 three identical italic lead-ins "Transition metric." (use `\paragraph` run-in or `\textbf`); l.162 whole-sentence `\textit` reading-time note stacked under abstract emphs; l.900 `\textit` inside display math (use `\text{agent history}`).

---

## D. CLOWNY-STYLING ROLL-UP (exercise blocks + section titles + slogans)

**Exercise blocks** (extract per A5 / PLAN §WORKBOOK):
- LS: boxed Exercises every section + ★ stars — **CONFIRMED CLEAN on visual audit; the cleanest instance. Do NOT "professionalize" away — but DO move to the workbook for consistency.**
- SWK: 10 boxed blocks (l.95–103 macro; instances 420,500,596,719,814,985,1053,1184,1221,1298), each "open" star DUPLICATED in OP-1..OP-11. Reads as courseware + pads length.
- STP: §3 (l.763–770), §10 (l.1341–1352), §11 (l.1421–1431), §12 (l.1527–1536) — **item numbers BROKEN**: §3 (1)(2)(4), §10 (1)(2)(3)(5), §11 (1)(2)(4)(10), §12 (1)(2)(8) — leftover global numbers from §13 pasted in. Single most unpolished thing in STP. Plus `\textit{Check./Trace./Open.}` + raw ASCII `$\star$` (homemade idiom).
- BC: Appendix C, E1–E9 "for instructors using this paper in a class" + "Hint:" lines (syllabus framing). Reader's-Map "six reader personas" (l.204–212) — trim to 3–4.

**Section titles / slogans:**
- STP §9 title italicizes `not` (l.1093) — only section title with stray italics; pollutes ToC.
- BC "teeth/gums" pun (l.708–709) — soften to straight technical line.
- AP per-page footer "Port Daddy v3.13.0 — Formally Verified" (l.115) — marketing badge stamped on every page incl. the honest open-problems appendix; change to neutral running foot. AP pull-quote "We err toward listing fewer items as closed" (l.854) — demote to plain sentence.
- FH "heroically more honest" / "heroic" (l.644, 788) — cut "heroically". FH threat-band header "Stopped" (noun-label) → "Mechanized".
- HE `\textsc{whitepaper'd}` made-up grade (`fig-he-stack-map.tex` l.37) — replace with a real Maturity-Key grade.
- BC/AP/FH "TRILOGY" all-caps eyebrow — retire (A1).

---

## E. PER-PAPER (defects not already folded into A/B/C/D)

### LEGIBLE-SWARM (39 pp, compiles clean)
- **major** `legible-swarm-four-questions.tex` (p.14): monochrome decision flow — force-zoom/refuse-to-ship "yes" branches look identical to benign pass-through. Color irreversible "yes" branches red, "ship it" terminal seafoam, question nodes cobalt.
- **minor** `legible-swarm-authority-organs.tex` (p.15): built vs designed/vision organs all same sand/ink fill though appendix tracks status. Tint by status (seafoam=built / neutral=designed / amber=vision).
- **minor** `legible-swarm-cascade.tex` (p.29): cobalt=failure rungs collides with SDT fig (cobalt=danger) and house cobalt=info. Use red for failure rungs, seafoam/teal for cures.
- **minor** clowny: `legible-swarm-split-ranker.tex` (p.25) in-figure scare-quoted mottos — drop quotes, set as small roman sub-labels.
- **clarity** Ex.3.4 (l.809): "L2 alone — without L1's jail and L3's reputation" — L0–L3 defined only in p.2 stack-map; "jail" never defined in THIS paper (leaks from DOM-DADDY/Anchor). Gloss layers inline; replace "jail" with "L1's constraint enforcement".
- **clarity** `sec:value-curve` (l.1159): "three-layer cure" collides with L0–L3 stack — rename to "three-STAGE discovery cure".

### SINGLE-WRITER-KERNEL (35 pp, clean)
- **minor** `fig-swk-durability-faultclass.tex`: I1b "NOT GUARANTEED" in cobalt mislabels the key failure as info — recolor red; keep I1a SURVIVES teal. (This is where the 15-min reader is sent.)
- **minor** `fig-swk-comm-organ.tex`: lineage-inside-chain nesting drawn as 2×2 siblings — draw coordination-lineage box literally INSIDE authorization-chain box.
- **clarity** tab:honestkey (l.338–359): four overlapping grading vocabularies in first 6 pages incl. unused Closed/Partial/Open markers (l.54–56, never appear in body) — cut the dead markers; defer I1a/I1b + regimented/enforced refinements to first use.
- **clarity** §7 (l.776–802): authorization-chain vs coordination-lineage lands as abstraction wall — lead with a concrete one-line picture (operator signs→A, A signs→B; each hop narrows).
- **clarity** §11 I11: dual-runtime hazard assumes reader knows prod-vs-test SQLite bindings — one grounding sentence at first mention.

### SPAWN-TO-PERSON (35 pp, clean, palette guard passes)
- **minor** `fig-stp-tombstone.tex` (p.30): fraud o3 and corrective tombstone both cobalt — o3→red, tombstone stays cobalt.
- **minor** `fig-stp-role-vs-person.tex` (p.7): "-loss" marker barely distinct from "+win" — render -loss red text+border.
- **minor** `fig-stp-judge-market.tex` (p.25): slash arrow cobalt — →red; optionally re-audit node amber.
- **minor** `fig-stp-rate-the-raters.tex` (p.28): shrinking-incentive shown only by box width — apply red→amber→seafoam gradient down the tower.
- **clarity** abstract (l.194–227): single 33-line block, ~9 italic spans, inline math chain — split into two paragraphs, move math to §1.1.
- **clarity** §9 title "not a bandit problem" answers an unasked question — add one orienting sentence.
- **clarity** Thm 1.1 proof (l.802–820): run-on — break into two steps.
- **clarity / cohesion** `\label{sec:adr0049}` leaks internal PD nomenclature — rename `sec:multidim-reputation`; audit for other internal IDs in printed text.
- **cohesion** "Paper~N" vs "Paper N" non-breaking-space inconsistency (l.173,360,378,1540) — normalize to `Paper~N`.

### HARBOR-ECONOMY (31 pp)
- **BLOCKING (render-visible)** two undefined refs print as `§??`/`Figure ??`: (1) `\ref{sec:fh-lim-cartel}` in `figures/fig-fh-threat-bands.tex` l.60 (p.21) — section is actually `sec:fh-failure-modes` (l.1202); (2) `\ref{fig:cartel-folk}` in `figures/fig-cartel-game-inline.tex` l.58 (p.25) — fig doesn't exist here (leftover cross-ref to FH paper). Repoint/remove both.
- **major** `fig-he-three-sided.tex` (p.7): prose/caption say "dashed-red band" but box is `draw=hhcobalt` — make it red (functor-disagreement = failure) OR fix prose to "cobalt". Prefer red.
- **minor** overfull boxes: l.370 spine equation 188pt (→ B2 fix), l.412–418 44.76pt; font warning `T1/lmr/bx/sc` (cosmetic).
- **clarity** §6 "The Anchor Protocol PROPER" vs Paper 2 "SUBSTRATE" — rename §6 "Cross-harbor capability transfer".
- **clarity** federation in-paper vs "companion federation paper" contradiction (l.1019,1435,1450) — decide one home (A8).

### BONDED-COMMONS (48 pp)
- **major (content)** `sec:pricing:threats` multiply-defined: attached at l.794 (`\subsubsection`) AND l.883 (`\paragraph`); the two blocks DUPLICATE the same three threat bands + figures. Merge into one (keep richer 4-row §7.5.4 table; fold l.883 Monte-Carlo defensibility in); give surviving blocks unique labels.
- **minor** `fig-bonded-three-layer.tex` (p.9): font warning `T1/lmss/bx/sc` from `\textsc` inside `\bfseries` ringtitle — drop `\bfseries` or pre-uppercase.
- **minor** `fig-sybil-inline.tex` (p.30): adversary cluster all cobalt — move to violet (agent-acted) or red (threat); reserve cobalt for mechanism boxes.
- **clarity** Reader's-Map "FOUR layers" vs everything-else "three layers" (A2) — rename Reader's-Map column "Track"/"Pillar"; one sentence reconciling.
- **clarity** abstract (l.155): single 14-line block, five big ideas no breaks — split into two paragraphs.
- **clarity** "24 hours of vibe time" (l.555) used before defined in §8 (l.1005) — add a Tufte gloss at first use.
- **overfull** l.1169–1172 (81pt, Conservation theorem), l.90/91 (75pt, listings block) — `\seqsplit`/line-break hints.

### ANCHOR-PROTOCOL (26 pp, clean)
- **major** `fig-anchor-alg-confusion.tex`: successful exploit path ("ACCEPT (bad!)") in cobalt — red; keep pinned-verifier REJECT teal.
- **major** `fig-anchor-revocation-gossip.tex`: revoked nodes cobalt fill — red ring; gossip arrows stay cobalt or amber.
- **major** `fig-anchor-verification-stack.tex`: caption "Cinnabar arrows" but arrows cobalt — simplest fix: caption word "Cinnabar"→"Cobalt" (cobalt=design-obligation handed down is defensible).
- **minor** `fig-anchor-cuckoo-inline.tex`: two ambiguous cobalt elements — tint rejection box amber or active-insert cell seafoam.
- **clarity** "four phases" vs "three verified phases" never reconciled (A2) — one sentence after the four-phases figure.
- **clarity** two freshness bounds (l.270 "~2 min, O(log m)" vs l.283 `Δ(1+ln m)`) don't obviously match (log vs ln) — pick one, plug in, reconcile with figure's "~2 min".
- **clarity** §8 limitation item 1 (l.661): four facts in one run-on + 56.9pt overfull — break into 2–3 sentences / sub-list, let breaks land on the `\texttt` paths.
- **structure** Appendix B/C/D peers though all are model listings — make Phase 2/3 `\subsection` under Appendix B.
- **overfull** l.661 (56.9pt), l.839 (40.6pt), l.341 (20.6pt) — `\seqsplit`/`\small`.

### FEDERATED-HARBOR (28 pp, clean, palette guard passes)
- **major** `fig-fh-federation-topology.tex` (p.8): xfer-ceremony amber arrow and gossip teal-dashed arrow share the same horizontal corridor; labels stack — route xfer with downward bend, gossip upward; give each its own lane.
- **minor** `fig-fh-revocation-gossip.tex` (p.15): grid shrunk by resizebox + duplicate convergence-bound band; per-cell notes below legible — move band to caption, bump note font above `\scriptsize`, faint red wash on stale cells.
- **clarity** Property 2.3 "Threshold publishability" name contradicts "does not require trust / no k-of-n" body — rename "Independent publishability"; reserve "threshold" for §10.2.
- **clarity** Thm 5.1 "O(Δ log m)" prose vs "Δ(1+ln m)" theorem — one reconciling sentence (same as AP bound issue — align both papers).
- **clarity** §4.1 four-message ceremony: msg 4 is intra-B though "msg 3 completes" — one clarifying clause + figure caption.
- **clarity** abstract/§1 duplicate the 4pm-demo Alice-Bob vignette near-verbatim — compress abstract to one sentence.
- **cohesion** version mismatch: title "Version 0.9 (pre-print)" (l.137) vs footer "Port Daddy v4 — pre-print" (l.119) — make footer "Port Daddy v4 platform · paper v0.9".
- **cohesion** companion-citation style inconsistent ("Anchor §2.4" vs `\cite{owens2026anchor}`) — define shorthand once, use consistently (A7).
