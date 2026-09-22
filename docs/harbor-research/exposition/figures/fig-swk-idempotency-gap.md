# A missing receipt: two histories, measured recovery outcomes

1. **Stable atlas ID:** `II/fig:swk-idempotency-gap` (Book chapter 1).
2. **Reader question:** what can a recovering sender infer from its pending journal entry?
3. **Claim:** the same local record can conceal zero or one committed effects; retry/hold have different failure modes, while the tested receiver contract resolves both declared histories.
4. **Relation:** aligned event-order histories followed by a finite observed outcome matrix.
5. **Required evidence:** intent/effect/receipt order; two process-crash positions; identical pending/no-receipt records for the same key; differing remote effect counts; all 12 policy/cutpoint outcomes; atomic retained receiver binding and observation limits.
6. **Counter-reading:** no claim that a sender-side key alone guarantees useful exactly-once external effects, that never retrying violates at-most-once safety, or that this mock receiver certifies Port Daddy.

## Data and design

The final measured sidecar run is `run-02/experiment-results.json`, SHA256
`e93863430b6b09d7845aa637304e719114e60c9444529deb3fc1ed6cadbc7a38`.
Its executed script SHA256 is
`8fcbe645943730e4473a050c6f54710892a502c55ae0ca42513e0002e176a880`.
The byte-exact data, executed source and protocol are packaged under
`docs/harbor-research/experiments/receipt-gap-20260920/`. A guarded fresh-run
entrypoint is `scripts/harbor-research/receipt_gap_experiment.py`; its new
provenance distinguishes reproductions from historical run-02.
One namespaced key and one ten-unit synthetic request per case; a fresh child
recovers once. The recovery policy sees only the sender journal and responses
to its own requests, not the receiver database. Controller inspection is an
oracle, not a product reconciliation feature. This is enumerated local process
crash testing, not statistical sampling, a power-loss test or a paid agent trial.

Two equal-sized folded journal records identify the concrete artifact; the
timelines encode event order, not elapsed time. Filled/empty markers and crash
crosses distinguish events redundantly with color. The lower matrix records
effect counts and sender state, so `2 / done` visibly differs from success.
The existing figure label is retained; this adds no new figure number.

Rejected alternative: the old pair of successful redelivery lanes made both
consumer convention and keyed receipts look equally sufficient, hiding the
missing-receipt window. A decorative key/lock would hide the atomic receiver
contract. A smooth probability curve would invent evidence absent from 12
enumerated cases. The atlas previously omitted this existing figure; its new
row closes only that known coverage gap, not the whole corpus inventory.

## Acceptance and limits

Five-second reading: same sender record, different effect; blind retry can
produce a duplicate, hold can remain unknown. Receiver deduplication in this
fixture completes each declared case once. Preserving at-most-once safety by
holding is distinct from recovering useful work.

Use the existing Suisse Book preamble, 4.5-inch body column, native 9-point
diagram labels, and one outside-margin caption. No source-owned measurements
are replaced by pictograms. Do not shrink or scale to fit. The final Book page
must be reviewed with its neighboring prose, margin notes and caption.

Review status: accepted locally by the parent for this figure, not author
approval or whole-Book approval. The native fragment measures 321.70 by
354.19 points within the 325.215-point gate. The parent inspected the final
Book figure on physical page 55 / folio 27 and its neighboring pages 54 and
56, including the single margin caption and ensuing stigmergy discussion.
No labels, number assignments or reference anchors changed in this batch.

The assembled proof is `.cache/book-receipt-gap-20260920/coordination-papers-mega-volume.pdf`,
SHA256 `8fe8a5fad2bf38d678ea26b89858bd745763d01f48d87ebb534cf482f04bb832`.
Its 693 pages have 1,364/1,364 placed margin objects, no registered margin
issues, and 232 captions with no placement failures. Seven figure regressions
pass, including all 12 data cells, deliberate corruptions, the actual page,
and an unchanged-number/anchor check over 2,170 auxiliary records. These
checks do not certify prose, all Book layouts, or the production runtime.
See `BOOK-RECEIPT-GAP-PASS-20260920.md` for the complete checkpoint.
