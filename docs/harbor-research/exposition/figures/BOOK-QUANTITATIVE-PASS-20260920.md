# Quantitative figure review — 20 September follow-up

This ledger separates arithmetic, figure geometry and actual Book-page review.
The baseline is the 691-page Book in
`.cache/book-headings-terminals-full-20260920`, SHA256
`4e828275743b00530f34073748d84b0600f8a4be8fdf6b418c4c584fcc52b784`.
Nothing below is a live-agent experiment or whole-Book approval.

## Final local checkpoint

Current Book: `.cache/book-quantitative-pass-20260920/coordination-papers-mega-volume.pdf`.
SHA256 `4388d80658b30f6253e82d26cb1ffb3ea6178f55707e95e24792f368ff990db0`.
691 pages; 1362/1362 margin objects; zero margin issues; 232 captions with
zero placement failures, including 192 floating-owner adjacency checks.
All 39 heading, numbering, typography and quantitative tests and all 54
generator tests pass. The two new rendered paragraph-placement regressions
both reject the older broken Book. No source/runtime/release equivalence is
claimed; there were no commits, pushes, PRs, paid experiments or PD calls.

Parent opened the final actual pages: physical 6 (navigation), 260 / folio
232 (reader floors), 283 / 255 (split penalty), 420 / 392 (auction),
599 / 571 (complete conclusion), and 600 / 572 (following appendix).
The first assembled proof's regret theorem and split-penalty theorem/example
were also inspected; the final proof passes unchanged numbering/font checks.
Final extracts and selection metadata are in `final-review/`; the three-page
figure review is `quantitative-review.pdf`. Forty-seven whitespace flags
remain a candidate inventory, not automatic failures. The separate general
Split-Digest theorem remains unresolved as described below.

## Double-auction refusal wedge — `IV/fig:he-ms-wedge`

- **Question:** which mutually beneficial trades does this illustrative double
  auction refuse, and what population does its fraction describe?
- **Claim:** under independent uniform values and costs on `[0,90]` credits,
  the band `0 < v-c < 22.5` contains `7/32` of all draws. The worked pair
  `(70,60)` lies in that band.
- **Relation:** a two-dimensional decision region, not a measured frequency.
- **Required marks:** credit units on both axes; the zero-surplus diagonal;
  the trade boundary; three distinct regions; the worked point and its two
  coordinates; the all-draw denominator. Boundaries have zero probability.
- **Counter-reading:** `7/32` is neither the refused share of efficient
  opportunities (`7/16`) nor the lost share of first-best gains (`5/32`). It
  is not a universal implication of Myerson–Satterthwaite.
- **Grammar:** one common-scale regime plot with explicit polygon geometry,
  direct region labels, and a single short margin caption. Reject three bars
  comparing the fractions: their different denominators are the issue.
- **Change:** replace an unlabeled denominator and region text placed in the
  wrong region with a leader identifying the refusal band; remove repeated
  boundary prose from the caption. Keep the mathematical example unchanged.
- **Status:** integrated and inspected in the first assembled proof (Figure
  6.7, physical page 422 / folio 392). Parent then lowered the trade label
  to clear the diagonal and kept the word "linear" whole across the example's
  frame break. Final rebuild and actual-page inspection pass at physical
  page 420 / folio 392 on the final hash recorded above.

## Digest floors — `I/fig:readpoverty`, `I/fig:split-penalty`

The first read-poverty candidate was rejected: labels crossed curves. Its
arithmetic also requires narrower language. These are counting lower bounds,
not achieved encoder costs. Two reader-specific bounds each use `m` opens;
the joint bound uses `m` opens in total. Comparing those bounds is not an
equal-total-opening-budget benchmark. The revised read-poverty candidate
uses endpoint leaders in an external label gutter; its source is integrated,
with visible `k=2,m=8`. The input now follows the lower-bound explanation,
before any later figure, preserving figure order. The nonexistent value-curve
"right panel" reference and obsolete atlas prescription were removed.
The split-penalty candidate is integrated. Its 14 plotted coordinates and
41,860 admissible small-instance inequalities were independently checked;
the proof uses increasing positive summands, not that finite sweep. The
unbounded family is `N=2k+1,m=2k`, with `F(2k)=log2(2k+1)` and
`F(k)=log2((2k+1)/(k+1)) -> 1`. The two finite curves stop at their admissible
endpoints. Parent inspected Figures 4.10 and 4.14 on actual first-proof
pages 262 and 285, not just the specialists' fragments.

The first full proof has 693 pages, all 1362 margin objects accounted for,
232 captions with no placement failure, and 37 passing heading, numbering,
typography and quantitative tests. Its SHA256 is
`be564e9047bad92d5282b6a9f424323078846c9dcace827b4936283ab264be55`;
it is retained under `.cache/book-quantitative-pass-20260920/prior/`.
This is superseded by the final 691-page checkpoint recorded above.

Independent final layout review also passes on that exact hash: navigation
is complete on physical page 6 / vi, the four conclusion paragraphs remain
together on page 599 / 571, and the appendix begins on page 600 / 572.
Exact source-preservation checks retain the navigation and limitations
verbatim. The scoped witness is
`/Users/erichowens/coding/tmp/book-human-review-20260920/audit/layout-final-20260920/two-fix-final-witness/REVIEW.md`;
it does not imply whole-book approval.

Parent review caught a false source-only objection from the specialist:
an external region label need not lie in the region when its leader ends
there. The refusal label's target `(38,28)` is in the band; the agent
inspected the actual render and retracted the objection. Conversely, the
parent rejected real on-curve labels in the first digest candidate. Review
the annotation's full geometry rather than classifying its text anchor alone.

## Counting does not construct a code

The displayed coverage ceiling is now called an upper bound, not an attained
best probability. Exact rejection fixture: with `N=4,k=2,m=3`, two messages
meet the elementary count `2*C(3,2)=C(4,2)=6`; any two review triples share a
critical pair, however, so they cover only five of the six possible pairs.
Three triples can cover all six. The exercise now distinguishes the two
ratios and finite sampling evidence from a universal proof.

The historical `skills/harbor-results/scripts/a7_experiment.py` docstring
still says the counting condition is "iff" and names its helper
`optimal_miss`. This pass did not rewrite or rerun that experiment. Its
necessary-versus-sufficient wording needs a separately scoped correction;
do not promote the historical script's prose to a new achievability result.

## Two scoped whitespace repairs

Ohm's actual-page review retained 46 of 48 flagged pages and all eight long
headings. The authored Book root—not the generator—owns the navigation
paragraph; it has been moved intact to "How to use this textbook". The final
Federated Harbor conclusion now reserves 26 baselines before opening, with
all four paragraphs and limitations unchanged. Both are in the final rebuild;
no global spacing change, smaller type or relaxed margin guard was used.

## Regret-head algebra

Independent review by Goodall confirmed that the printed odds form was not
equivalent to the primary decision inequality. For miss cost 100, attention
cost 10, false-alarm cost 5 and posterior 0.14, the primary inequality says
pass (14 < 14.3); the old odds form says inspect (0.1628 > 0.15).
The Book now uses the equivalent posterior threshold
`a >= (c_att+C_fa)/(C_miss+C_fa)`, explicitly conditional on a positive
denominator. When both loss terms vanish, inspection is chosen only if
attention is free, following the inspect-on-tie convention. The primary
decision policy is unchanged. Exact-rational grid checks and the negative
counterexample are in `test_book_quantitative_figures.py`.

## Open contradiction: Split-Digest theorem

The general compression impossibility does not follow from the current
premises. Two hundred redundant tokens can encode work and breach details
whose sufficient representation is only two tokens, fitting both readers
despite `B < |E|`. Also, `E \\ D` treats a token string as an event subset.
The earlier comonotone theorem concerns finite top-m selections at every
budget, not arbitrary strings and KL loss. This issue is independent of the
valid arithmetic comparison of counting floors.

The parent asked Erich whether to replace this with a conditional statement
and counterexample, or retain it flagged for discussion. No response yet;
no source rewrite of this theorem is authorized by that question alone.
Do not call the full chapter mathematically approved in the meantime.

## Independent terminal review

Ohm inspected all five terminal listings and the one split continuation in
the baseline above. All 97 nonempty source lines occur once in order, and
captions and listing numbers match. The nine sampled page renders match the
previous inspected revision. Three optional wrap nits remain; no clipped
terminal text or broken frame was found. Witness:
`/Users/erichowens/coding/tmp/book-human-review-20260920/terminal-lucide/fullbook-review/final-witness/REVIEW.md`.
