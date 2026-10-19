# Sealed Harbor: the same ledger, different guarantees — 20 September 2026

Status: accepted locally by parent and independent exact-PDF review. This is
not whole-Book or adjacent scientific-prose acceptance,
publication, a new model run, or evidence of deployed privacy.

## Exact artifacts

- Book: `.cache/book-sealed-two-adversaries-20260920/coordination-papers-mega-volume.pdf`
- PDF SHA256: `009f58cab2d1a37640fe9b67bb7b83807bed86dbfcdad2268b530047f62641c3`
- AUX SHA256: `476603da956fd8c6caa70e8287280d18e43bb352f754479940770e0de5d42d6d`
- Figure 3.9, physical page 199 / folio 171; stable identity
  `sealed:fig:sealed-two-adversaries`, atlas `VIII/fig:sealed-two-adversaries`.
- Reader extract: `.cache/book-sealed-two-adversaries-20260920/sealed-two-adversaries-pages.pdf`,
  actual Book pages 198–201, not separately typeset examples.
- Figure SHA256: `b99e48729b442658cb7638aaaf6674ad122326dbad1458f132411fa19f5dc668`.
- Owning chapter SHA256: `ae91898f6ad8ca379c3edbfcbc54981114ab4a53b0f57660912888b02c39e160`.
- A3 unchanged: `abba1d99268deb58e319cae038f2853a63c9eb1a7e095651da8cb813433109cc`.
- Baseline: accepted paired-worlds proof `c0aa81baf88ac90b12a1ba3238a17b2546976fe8edc857f7c32161370eb76e89`.
- Independent final review and byte/raster evidence:
  `/Users/erichowens/coding/tmp/book-two-adversaries-independent-review-20260920/REVIEW.md`
  and its adjacent `EVIDENCE.json`.

## Drawing and source changes

The two cases have identical folded-paper ledger records, aligned equations
and budget bounds. The left eye observes a valid private release; the right
pencil represents a worker choosing its output. It does not grant the worker
write access to the ledger, nor imply that the runtime branches on honesty.
Only the two local observation/choice arrows remain. Color reinforces the
written distinction; the neutral ledger is the same in both cases.

The left conclusion is conditional on valid mechanisms and complete mediation.
The right says no DP certificate, not no accounting guarantee. Its separate
q·b bound is in bits and explicitly excludes timing; the caption limits it to
the specified output channel. Epsilon is not a bit count. A3's conservation
check does not verify release distributions or those privacy premises.

Both adjacent occurrences of "certifies nothing" now say "does not certify
differential privacy." These are the only owning-chapter changes in this pass.
No arithmetic, model transitions, proof scripts, citation records, or claimed
experimental counts were changed. The atlas gains one substantive contract
with explicit counter-readings; this is not a placeholder coverage row.

Native ink is 316.85 × 287.67297 TeX pt within the 325.21503pt body, using
genuine Suisse SGType 9/11. The candidate is about 67.4pt taller than the old
figure; actual Book flow was checked rather than shrinking it. Its bounded
geometry check covers 23 text fragments / 21 logical labels, 251 external
label pairs and 40 mark bounds, with minimum text/text clearance 10.32703pt
and text/mark 5.73851pt. Parent independently reran 42 candidate controls.
These are literal/layout checks, not a general diagram verifier or reader study.

## Exact-proof checks and impact

- 194 scoped tests pass, no skips; 71 generator tests pass.
- 1363/1363 margin entries placed, no registered issues.
- All 233 captions pass, including 193 owner-adjacency checks.
- Zero detected lost content, margin collisions or footer intrusions.
- 698 pages, unchanged; 2172 public signatures, 271 section identities and
  553 citation records unchanged.
- All-page structural comparison changes only physical 199, 200 and 206.
  The other 695 match raw text/glyph positions, vector records, image digests
  and placements, and page rectangles. This is not whole-Book visual approval.
- A separate 1.5x pixel comparison confirms exact raster identity on physical
  196–198, 201–205 and 207–209. The protected complete calculation/plot on
  201 and latency statement on 203 remain whole.
- 55 whitespace candidates remain. The lower gap on physical 200 decreases
  from 181.9 to 101.7pt. The 42 normalized overfull warnings are unchanged;
  the 35 full-width records are inventory, not approval.
- Parent personally opened actual 199 at 72dpi and 108dpi, changed 200/206,
  preceding 198 and protected 201/203. Figure and caption align; no new
  figure-level collision or compact-block split was observed.
- Independent reviewer opened 198–201, 203, 206–207, checked each image against
  the exact PDF pixels, and also inspected native-size 199 and baseline 199–200.
  It accepts the local 2+5-line prose continuation after the taller exhibit,
  not a split compact frame. Closing PDF/AUX hashes still match.
- Independent baseline measurements show Whitehouse remains aligned and Luo
  and Alvim now have 0.00pt first-baseline offsets on 200, versus notes about
  120.20 and 124.08pt above their owning lines before. This clears those two
  local offsets only. The figure and its caption both start at y=324.45pt.
- Seven new permanent tests cover the semantic contrast, owner wording,
  atlas counter-readings, actual caption/type/geometry and paired ledger
  alignment. Seventeen misleading source variants are rejected.
- The initial type test wrongly treated the upright mathematical `max`
  subscript as a prose label. It now checks exactly three such scripts at
  7.20–7.35pt separately and retains the 8.85–9.05pt principal-label check.
  Neither artwork nor type size was altered to satisfy the test.
- Fresh atlas coverage is 90/127, **37 missing**. In the existing Python3.11
  environment, 24/25 atlas tests pass; the historical fixed-count assertion
  still expects 66. Changing that assertion would not repair missing coverage.
  An initial system-Python run additionally failed on `zip(strict=True)`;
  that interpreter mismatch was resolved by using the existing environment.

## Separate scientific corrections: still open, not accepted by this pass

Goodall's primary-source review is retained at
`/Users/erichowens/coding/tmp/book-dp-composition-source-review-20260920/REVIEW.md`.
Parent also opened the official papers and read Whitehouse's introduction,
conditional-DP definition and filter discussion; this is not a claim to have
independently checked all proofs.

1. The two "worse constants" attributions to Whitehouse et al. need repair:
   the paper matches advanced-composition rates and leading constants,
   with a lower-order difference from its sharper reference formula.
   Its approximate-DP filter is not A3's pure-DP, sum-only guard.
   [Whitehouse et al. 2023](https://proceedings.mlr.press/v202/whitehouse23a/whitehouse23a.pdf).
2. Fixed privacy caps and horizon do not prohibit adapting queries/mechanisms
   to preceding releases. The chapter's "non-adaptive schedule" is too broad.
   "Uses" an advanced filter also overstates what A3 implements; distinguish
   a required accounting design from an implemented guarantee.
   [Dwork, Rothblum and Vadhan 2010](https://www.microsoft.com/en-us/research/wp-content/uploads/2010/01/DworkRV10.pdf).
3. State the conditional per-release and complete-observer-transcript premises
   with the DP corollary. The basic adaptive filter and an advanced filter are
   different results; do not generalize an odometer lower bound to all filters.
   [Rogers et al. 2016](https://papers.neurips.cc/paper/6170-privacy-odometers-and-filters-pay-as-you-go-composition.pdf).
4. A3's docstring/footer must not promote declared-cost bookkeeping to privacy
   certification. Read-only inspection found no neighboring-dataset model,
   release distributions or advanced filter there. This is not a repository-wide
   implementation search. Do not run the model just to repair commentary.

A useful future margin example is exact and analytic: release a secret bit
unchanged while declaring zero cost. The ledger balances, but neighboring
inputs give output-event probabilities 1 and 0, violating every finite pure-DP
bound. One permitted payload bit still has capacity at most one bit. This is
not an empirical result. If used, label it an analytic counterexample and
keep the observer/channel assumptions visible.

Also retain the earlier property/theorem cross-reference misnaming, citation
offsets, compact-block debts elsewhere, chapter cards, larger trim and remaining
figure/plate/data work on the completion board. No provider spend, Port Daddy
runtime, model execution or Git publication occurred. Work remains local in the
shared dirty Book checkout; unrelated changes were preserved.
