# Composition plot: lower epsilon is a tradeoff

20 September 2026. Integrated locally; parent and independent exact-page
review accept this bounded pass. This is an
analytical-figure pass, not a fresh privacy proof, model run or publication.

## Figure brief

- Stable ID: `VIII/fig:sealed-composition-crossover`, Figure 3.11.
- Reader question: at which positive integer release count is the advanced
  epsilon bound first below basic composition for the stated parameters?
- Claim: at per-release epsilon 0.1 and delta-prime 10^-6, advanced is still
  above basic at 32, and is first below it at 35. The positive-delta tradeoff
  prevents interpreting smaller epsilon as uniformly stronger privacy.
- Grammar: two analytical curves on one common axis; a focal marker and
  vertical guide identify 35. Direct labels distinguish the delta values.
- Evidence: closed forms `k*epsilon` and
  `epsilon*sqrt(2*k*ln(1/delta-prime)) + k*epsilon*expm1(epsilon)`;
  fixed caps/maximum horizon, with queries allowed to adapt. These are not
  measurements. The adjacent chapter establishes the conditional premises.
- Counter-reading: 32 is a worked checkpoint, not the crossing; arbitrary
  adaptive stopping does not justify substituting a realized horizon;
  a smaller epsilon with positive delta is not pure-DP dominance.
- Rejected form: a title/callout/caption stack above an ambiguous
  “spent-budget” axis. It blurred theorem parameters with ledger spending.

## What changed

The figure has an epsilon-bound y axis and release-count x axis, no separate
title, direct basic/advanced labels with their delta values, a quiet field,
and one concise outside caption. The 32 tick is omitted to avoid crowding
the focal 35; its exact checkpoint remains in the adjacent calculation and
caption. The worked calculation, source notes, theorem and exercise text are
unchanged. No new data, uncertainty band or experimental observation is invented.

Only normal prose labels are standardized to native SG 9/11; mathematical
superscripts keep their legitimate smaller size. Local style overrides are
necessary because `pd axis label`, `pd direct label` and `pd focus label`
otherwise override an outer SGType declaration with 8.75-point text.

## Rejected drafts and a useful QA lesson

The specialist's first two candidates were rejected by the parent for an
advanced-label/curve collision and long caption, despite reported PASS.
Checking only a label's prose word missed the crossing through its math.
The third candidate cleared those problems but overprinted the native 35
tick with a second node. The final sidecar removed that duplicate.

Final frozen specialist sidecar source:
`da7b812ea50570f1901ba6d0052c92a1caf52c1eac66826353c7f186213c1c1f`.
Sidecar PDF:
`25746b2f6bc82408301860a1daedd14d823b7f78b2358357e06639e161eb5b9c`.
Parent inspected its 144-dpi rendering, then measured the actual glyph sizes.
They were 8.717416 PDF points, or 8.75 TeX points, not the asserted 9.

First integrated PDF
`904d2fe83dd3e00b37e5e6745306c2eefb143b231335043a1f64977f2af32a94`
is retained at `.cache/book-composition-20260920/pre-native-type-repair/`.
It is rejected for native-type mismatch and only 3.28 PDF points of clearance
between the full basic-label box and its curve. A persistent PDF regression
genuinely rejects both defects; a wrapped TeX log record is handled separately,
not mistaken for a typography failure.

Parent locally overrides all three label styles to SGType and raises the
basic label from axis y=6.72 to 6.90. A small Book-preamble wrapper was compiled
offline and opened before the second whole-Book build. The final native ink
is 294.77505 by 191.21956 TeX points, within the 325.215-point column. Prose
glyphs are 8.966376 PDF points, corresponding to 9 TeX points.

## Current exact proof

- PDF: `.cache/book-composition-20260920/coordination-papers-mega-volume.pdf`.
- SHA256: `125c8bbfc91e4bd7b855c846b554295c3db7a7585aa278ad990fd0f1fa2bf06a`.
- AUX: `a3dacde7b2327c750abc5e5969f3269d6789436f92534ef141d8b256db0a3ad1`.
- Source: `website-v2/public/whitepaper/figures/fig-sealed-composition-crossover.tex`.
- Source SHA256: `4f3692a701b6da503ca3fb9d93b017b879009f465181f05a3838afc7477a63fc`.
- Baseline: accepted `f7352e065d5c95b921059dfba4c74f5f3ed072e06459558077794cd2c4df5d61`.

Parent opened actual physical page 201. The matrix, complete worked example
and revised plot remain together with their outside captions. All 220 scoped
tests pass. `test_sealed_composition_figure.py` verifies the source contract,
seven misleading source mutations, independent closed-form arithmetic,
printed scope, measured type, one 35 tick and native ink geometry.

The actual-PDF collision test recovers the plot's field from its drawn geometry,
then tests complete direct-label rectangles, including mathematical second
lines, against both curves in that page's coordinates. Independent review
improved the check from vertical interval gaps to Euclidean distance to the
curve edge, including half its stroke width. The persistent test now uses
that method, sampling every .001 release over the whole domain. Minimum
edge clearance is about 5.58 PDF points (basic label); the advanced label
clears by about 9.73 points. This is numerical layout evidence, not a formal
clearance proof.
The earlier overlapping one-line box fails a translated negative control.
These tests are not a substitute for final-size human-readable inspection.

Independent review is recorded in
`/Users/erichowens/coding/tmp/book-composition-independent-review-20260920/`.
The parent whole-PDF comparison is now complete: only physical 201 changes
in raw glyph/text and vector fields. All other 699 pages match those fields,
image hashes/placements and page rectangles; Part II remains at 218. The Book
is still 700 pages with 1363/1363 registered margins, zero placement issues,
233 captions/zero failures and 193 adjacency checks. All 2172 public
signatures, 271 section identities and 553 citation records are unchanged.
The 59 whitespace candidates and 42 normalized overfull warnings persist.
All 71 generator tests pass. These counts do not supply visual acceptance:
the independent reviewer personally opened actual pages 200–202, matched
them to the exact PDF, and opened 201 again at 72 dpi. The review independently
recomputed the first integer 35 and verified that the continuous equality
lies near 34.50776, not exactly at 35. The complete upper worked example
retains identical glyph data; caption ownership and native labels pass.
Independent all-page structural comparison also finds only 201 changed,
and selected pixel comparisons carry forward earlier accepted findings.
No whole-Book approval, local Port Daddy runtime, provider experiment, A3/A4
script execution, package installation, commit, push or publication is claimed.

## Next candidate

The specialist now owns the canary-power/latency sidecar at
`/Users/erichowens/coding/tmp/book-operating-curve-candidate-20260920/`.
It must distinguish the analytic conditional-power curve, Wald stopping-time
approximations and any source-reported simulation. The theorem's equality
language versus its later overshoot caveat is a separate source-review issue,
not something to conceal with a better-looking plot. No next-figure integration
or fresh experiment is implied.

Parent subsequently reviewed the first operating-curve candidate, PDF
`449dda01ba8e28026932e82793336374e236a4b433b3bee6294d39cea10abf26`,
and rejected it: crowded upper annotations, an overly long caption, missing
SPRT parameters, and a caption that denied sample estimates while showing
reported simulation means. Its final sentence also blurred the no-overshoot
approximation with exact expectation. Revision is assigned, including a
0-to-1 conditional-power scale with the zero-canary boundary. The paired-dot
comparison is promising, but dispatch/source existence is not acceptance.
