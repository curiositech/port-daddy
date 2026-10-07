# Frozen handoff figure numbering prediction

This prediction was derived from the accepted Bonded-pass AUX, source order,
and the loaded caption/Hyperref behavior before inspecting the handoff Book
AUX. The archive copies the frozen artifacts byte-for-byte; it is not a map
fitted to a successful build.

- `baseline.aux`: SHA256
  `4e7a6b527194ec89c0cd415b4139aa4db06b813137f0e4ec8121fe11d1af65b9`.
- `migration.json`: SHA256
  `5cec4968435a6c69c8ecf4e99a7a0a7deb458226ea2616ce88ed7a2068c20b16`.

The insertion is Figure 5.5, `stp:fig:stp-handoff-coverage`, plus its cleveref
record. Ten following Chapter 5 figures increase by one. An ordinary float
also consumes one global Hyperref link-counter slot: 214 later labeled
`section*.N` destinations increase by one, as do 177 of the 271 separately
recorded unnumbered contents destinations. Every change is enumerated. This
does not authorize a family-wide exemption, deleted labels, or unrelated
number changes. The expected record count is 2,172, from 2,170 before.

The report retains source hashes, old figure order, the insertion seam, and
the counter-neutral prose present at derivation time. The parent subsequently
shortened that prose and added a FloatBarrier to repair reading order. Neither
change steps a counter. The report has not been regenerated.

Derivation and eight synthetic gate tests remain in the specialist sidecar:
`/Users/erichowens/coding/tmp/book-block-style-lab-20260920/handoff-migration/`.
Its README explains the cached caption/Hyperref source trace. The first
assembled handoff proof passed this frozen map but failed the independent
visual reading-order check: the figure appeared inside the following Identity
section. Numbering correctness is not page-layout acceptance.

Use the portable canonical gate with these three inputs:

```sh
python3 scripts/harbor-research/check_book_label_migration.py \
  --before-aux docs/harbor-research/exposition/figures/handoff-numbering-20260920/baseline.aux \
  --after-aux /path/to/coordination-papers-mega-volume.aux \
  --expected-report docs/harbor-research/exposition/figures/handoff-numbering-20260920/migration.json
```

The batch review record records the actual accepted proof, if any. This file
alone does not certify that the latest build passed or that the Book is ready
for publication.
