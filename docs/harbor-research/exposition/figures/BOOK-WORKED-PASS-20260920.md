# Worked examples, marginal traces and succession price

## Scope and starting witness

This pass starts from the accepted local quantitative checkpoint:
`.cache/book-quantitative-pass-20260920/coordination-papers-mega-volume.pdf`,
SHA256 `4388d80658b30f6253e82d26cb1ffb3ea6178f55707e95e24792f368ff990db0`.
The previous goal turn made progress, not merely a status update: three plots,
scoped mathematical corrections, and two stranded-text repairs were built
and inspected. The whole Book remains incomplete and unapproved.

## Six conversions

The six explicit bare worked passages now use the existing Lucide Numbers
by Hand block, with bold parenthesized subtitles. They add no new theorem
claim. The two labeled tables remain outside the breakable frames and after
their associated examples; table identity and order must remain unchanged.

| Stable new label | Subject | Expected number, derived from source |
|---|---|---|
| `ls:ex:queue-boundary` | Sole ownership at the queue boundary | 4.4.2 |
| `ls:ex:digest-review-budget` | Digest Bits and File Opens | 4.6.3 |
| `stp:ex:newcomer-floor` | Sanctions at the newcomer floor | 5.6.2 |
| `stp:ex:maturation-cost` | Cost of starting over | 5.6.4 |
| `stp:ex:binding-probation` | Probation under a binding cap | 5.6.6 |
| `stp:ex:audit-depth` | Diversity and audit depth | 5.11.2 |

The queue example now states that its inputs are illustrative, not observed
roadmap performance. The newcomer table keeps all four numerical fields;
its redundant prose column moved into the example's interpretation. The
causal-density policy illustration remains plain because its asserted verdicts
lack reproducible weights/thresholds. Do not relabel it as checked arithmetic.

Six exact-rational/formula/source tests independently check the worked values,
table placement boundaries, and all three sparkline domains. A seventh checks
the six actual rendered headings for bold type, title text and exact numbers.
These do not prove the surrounding general theorems. The disputed Split-Digest
theorem is untouched.

Independent page review found a two-line tail from the binding-cap example
on physical 345. The final question was tightened to the exact finite-horizon
inequality `8 * sum(0.6^t, t=0..T) < 20`, retaining the smaller-cap limitation.
Tests independently check the inequality for finite horizons, the limiting
bound of 20, and the strict smaller-cap bound. A rendered regression now
requires that answer to finish on the example's opening page. The type size
and breakable-frame mechanism were not changed.

## Exact numbering migration

The source-derived frozen report is
`/Users/erichowens/coding/tmp/book-block-style-lab-20260920/bare-worked-migration/migration.json`.
Its baseline auxiliary SHA256 is
`98ddf2e6b205ba012eec14f981af7d42f4afe30e787aa6c5fb99eea9c05687be`.
Six insertions shift exactly ten existing public labels; the other 1,069
retain their numbers and anchors. Tables 5.5 and 5.6 are among those protected.
The migration compares all 2,170 expected auxiliary records, including
cleveref type/sort/display fields, with no wildcard family exemptions.

Timing caveat: source edits landed while the specialist began inspection.
It reconstructed the old sequence by removing only the six declared new
counter events and reconciled every old shared-counter label against the
baseline. It did not read a candidate build to set expectations. The report
is frozen and must not be regenerated to excuse a failed candidate.

`check_book_label_migration.py` is the portable read-only gate. Eleven sidecar
rejection tests and four repository rejection tests exercise wrong numbers,
types, cleveref ordinals, additions/removals, duplicate labels and baseline
hashes. Actual candidate-build validation is a separate gate.

The first assembled candidate exposed 215 incidental section-anchor shifts,
not public-number failures. Two explicit `\phantomsection` slots preserve the
old run-in paragraphs' hyperlink sequence. The frozen expectation was not
changed to accept the build. The next candidate passed all 2,170 records.

## New audit-depth marginalia

`spark-stp-audit-depth.tex` shows the three conditional recurrence trajectories
on common axes rather than another list of their final depths. All integer
levels are plotted, with each curve ending at the first value below one.
The neutral rules denote one unit, not zero; the value axis is explicitly
logarithmic. Different line patterns reinforce clique-count colors.

The first fragment failed because PGF evaluated an unused piecewise branch
whose intermediate exceeded its fixed-point range. Separate finite-domain
paths now express the same recurrence without evaluating that branch. A
native Book-preamble render was inspected; the parent increased clearance
above the first row and shortened the worked-example title after inspection.
The assembled page is physical 369, folio 341; the final-hash review below
must retain its readable outside-margin fit.

## Succession price: candidates rejected, parent redraw

The first specialist candidate used a log wait axis, but its floor/pool
labels overlapped and its boundary annotation crowded the branch. It also
incorrectly said the entire interval `3 < mu_s < 3.05` lies above a 256-hour
panel. At `mu_s=3.049`, both curves are below that ceiling. The exact forms
are `8/3 + 11/(mu_s-3)` and `8/3 + 3/(mu_s-3)`, so their top crossings differ.
The candidate was returned for correction, not accepted because it compiled.

A second specialist return still placed labels on curves. The parent reclaimed
the drawing and reserved a right-side label gutter with leaders from the true
endpoints. Both means use hours on a common log scale, against service rate in
tasks/hour. The canary is exactly 49/6 versus 25/6 hours at rate 5; the limiting
floor is 8/3 hours, above the pool's 1.0362-hour-equivalent cost. The panel states
its finite shown domain without claiming omitted stable values are all offscale.
Galileo independently rechecked both reduced formulas against the surrounding
theorem and worked example. No new theorem claim was added.

The parent inspected the native fragment and assembled physical page 400.
This exposed a redundant old lead-in describing a threshold/canary boundary
that the wait-versus-service-rate plot does not draw. That paragraph was removed
and a source regression now rejects its return. The prior reviewed PDF is
retained in `before-prose-cleanup/`, not overwritten as the final witness.

## Harbor research sidecar

Paper 8 remains a systems prospectus gated on the artifact and experiments.
The product roadmap's unqualified at-most-once external-effect bullet conflicts
with the Book's narrower receiver-contract boundary. The specialist checked
the existing idempotency diagram and withdrew a largely redundant marginal
paragraph. A finite local SQLite crash experiment has now run: 12 primary
cases, two recovery mutants, four restoration cases, plus payload-binding
and oracle tests (22 top-level checks). The parent independently matched all
18 retained database pairs to the result JSON. Sender-only retry produces a
duplicate effect after a committed effect but missing receipt; receiver-side
atomic deduplication survives the declared cutpoints. This is not evidence
about Port Daddy or arbitrary external services. See
`../RECEIPT-GAP-EXPERIMENT-20260920.md` for the exact matrix, hashes, exclusions,
and rejected preliminary oracle. No paid model experiment or runtime restart
was performed. The experiment has not yet been integrated into the Book.

## Verification status

Final local proof:
`.cache/book-worked-pass-20260920/coordination-papers-mega-volume.pdf`.

- PDF SHA256: `9d8a7ca605993293190444e4464a189b142bf7ff83f75e5fa951440fb68d7646`.
- Matching AUX SHA256: `1ce855088af998501bacf7b17746d2b6a6e4c42a1e0fe35b6d188ba097ce45b5`.
- 691 pages; 1,364/1,364 registered margins; zero margin issues.
- 232 captions; zero placement failures; 192 floating-owner adjacency checks.
- All 2,170 frozen migration records pass: six new public labels, exactly ten
  predicted old-number shifts, 1,069 other public labels unchanged.
- 44 scoped heading/font/math/migration tests pass, plus seven separately run
  legacy-checker tests. The 70-test combined generator suite passes. These are
  distinct suites, not 121 newly authored tests or whole-Book validation.
- The repaired probation answer finishes on physical 344; the next example
  starts cleanly on 345. The rendered regression rejects the retained old PDF
  for placement while recognizing either version's ending, then passes here.
- 45 whitespace candidates remain a review queue, not 45 established defects.

The 12-page review extract and page/label/hash manifest are under
`.cache/book-worked-pass-20260920/final-review/`. Parent inspected the actual
pages and compared the unchanged page images to the independently reviewed
candidate. Newly changed 344/345 and 400 were reopened at the final hash;
369's sparkline was also reopened. The specialist's independent review is
`/Users/erichowens/coding/tmp/book-human-review-20260920/audit/worked-pass-final-20260920/REVIEW.md`.
The six heading numbers remain 4.4.2, 4.6.3, 5.6.2, 5.6.4, 5.6.6, 5.11.2;
the associated independent tables remain 5.5 and 5.6.

Known neighboring nits remain separate from acceptance of the six new heads:
bold Liability/under/Verification split across lines in older titles; an older
definition's footnote occupies a short continuation; the preceding probation
proof shows two end-of-proof squares. The full manuscript is not approved.
Do not treat a layout pass as proof of its mathematical or deployment claims.
No commit, push, PR, paid model run or local Port Daddy action occurred.
