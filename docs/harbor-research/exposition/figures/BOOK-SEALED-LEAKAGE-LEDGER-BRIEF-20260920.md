# Leakage ledger — next bounded redraw

20 September 2026. **Candidate delegated; no integration or acceptance.**
Canonical Book remains untouched by this candidate. Parent owns integration;
Laplace owns `/Users/erichowens/coding/tmp/book-leakage-ledger-candidate-20260920`.

## Figure brief

1. **Stable ID:** `VIII/fig:sealed-leakage-ledger` (missing from the current atlas).
2. **Reader question:** What do 200 fixed 64-bit status observations and three
   distinguishable return slots per job allow an observer to distinguish?
3. **Claim:** Under that fixed observation model, the transcript alphabet has
   at most `(2^64 * 3)^200` elements; its log size is at most
   `200 * (64 + log2(3))`, approximately 13,117 bits.
4. **Relation:** quantitative accounting, grounded in an artifact and schedule.
5. **Required evidence:** one status-record glyph; three alternative slots,
   not three returns; explicit 200-event multiplier; aligned status/timing
   arithmetic; exact bound before rounded totals; category labels and colors.
6. **Counter-reading:** this is neither measured exfiltration nor a guarantee
   about all host channels, and bits are not differential-privacy epsilon.

Prefer two aligned accounting rows with a concrete status record and schedule.
Reject a waterfall that nearly hides the 317-bit addition, a generic process
graph, repeated title/caption, or pictogram areas implying a quantitative scale.

## Scientific premises and source check

The whole-transcript alphabet argument needs no independence or uniformity
assumption about the released values. Maximum alphabet size is not necessarily
attained, and maximum entropy is not the information actually leaked about a
particular secret. If every combination is freely selectable and distinguishable,
the alphabet-size ceiling can describe an ideal noiseless channel's capacity;
that extra condition must not be silently assumed for a constrained mechanism.

Primary teaching source checked: Peter Shor's MIT 18.200
[17 April 2024 notes](https://ocw.mit.edu/courses/18-200-principles-of-discrete-applied-mathematics-spring-2024/mit18_200_s24_lec18.pdf),
printed p.3: finite-alphabet entropy bound and uniform equality condition.
The Book-specific product-alphabet calculation above is our derivation, not
an experiment or a result reported by those notes.

Fixed 200 observations and at most three timing outcomes are material premises.
A separately visible failure, absence, termination choice or event count must
be included in the alphabet; three successful slots plus an observable no-result
outcome are not a three-outcome interface. No arbitrary scheduler proof follows.
The exact numerical ceiling is 13,116.992500... bits: do not write a strict
upper bound of 13,116.99 by rounding it downward. Use the exact expression and
an approximation sign for the display value.

## Integration work reserved to parent

- Review the existing example's unqualified attained-capacity language and
  “only b=0” sentence (which needs positive fixed q and content-channel scope).
- Keep the limitations row and exercise/solution consistent with the figure.
- Native 9 TeXpt prose; inspect strokes, labels and printed page context.
- Add an atlas row only after the chosen representation is reviewed.
- Static/source/closed-form checks only; no model/proof script execution,
  provider experiment, local Port Daddy, installation or Git publication.
- Preserve the accepted canary proof as an exact baseline before integration.

The provider experiment allocation is untouched. A standalone candidate or
passing geometry checks will not be called Book acceptance.

## Sidecar handoff

The first reviewed render was rejected: the status label protruded through its
paper border, another label crowded the total box, both categories were blue,
and the caption dominated the drawing. Revised composition uses two aligned
rows, a cobalt paper record, contrasting timing outcomes, and a single total
below a horizontal accounting rule. Parent opened the final 144dpi render;
this is a usable integration candidate, **not Book-accepted**. Eight tests are
reported by the child, not independently rerun by parent yet.

- Directory: `/Users/erichowens/coding/tmp/book-leakage-ledger-candidate-20260920`.
- Source SHA256: `74867e3aef33bf9322f854861c2c95338269fb2417386b3c567a2fae119d7546`.
- PDF `candidate-final-revised-20260920.pdf` SHA256:
  `7d5c1665e5ac1e1025598ef061c5652c4fc86d76954ae004c01dd8fd0bcf58f7`.
- Render inspected: `renders-revised4/candidate-144.png`, SHA256
  `a0d081b8d645285775b60ab9c2fc858e23935299e2815aeb425751436702a286`.
- Still required: review child tests; reconcile three scheduled returns with
  three observable outcomes (failure/absence cannot become a fourth); review
  surrounding example/limitations/exercise; add atlas row; integrate, rebuild,
  inspect actual Book context and run all matching gates.
- New accepted baseline for integration is canary proof
  `04f453aa4fcaa218cc9691f195ece320a996aa48ef8b6185ea81b0512da4cac5`.
