# Margin-sketch corrections — 19 September 2026

## Delivered scope

Six revised margin drawings in the assembled Suisse Book. These are responses
to the author's specific corrections, not approval of the whole figure corpus.
All drawing text remains native size. No new data, model results, generated
art, or implementation claims were introduced.

The shared margin-exhibit command now accepts an empty heading without leaving
a blank title row. The six revised exhibits have one caption each. Other
exhibits retain their existing headings; this is not a completed title audit.

The expiry drawing now uses violet/circle for the card, blue/square for the
epoch, and rust/triangle for policy. All three retain direct labels. Colours
are category-specific rather than being replaced by the chapter's accent.

The first assembled proof exposed an adjacent defect: the settlement Recall
note occupied most of the admission page's margin and displaced the expiry
drawing. Its three questions were shortened and moved beside the settlement
discussion on the preceding page. The expiry drawing now begins beside the
admission paragraph, not beneath the next subsection.

## Figure briefs and representation decisions

The author requested `tikz-figure-engineering` and `whitepaper-figure-system`.
Their briefs, semantic atlas, layout, perception and quality-gate references
guided this pass. These small exhibits are not separately numbered canonical
atlas figures; the stable registered IDs below identify them. The applicable
atlas families are **Time, concurrency, and protocol**, **Quantitative
comparison**, **Allocation, conservation, and incentives**, and **Provenance
and evidence**. The no-mint sketch also preserves the debit/discount distinction
in `III/fig:stp-nomint-lineage`; it does not replace that larger figure.

| Stable ID | Reader question; encoded claim | Grammar and required marks | Rejected alternative / counter-reading |
|---|---|---|---|
| `wal-exposure-window` | Which interval remains exposed? Commit precedes WAL sync by an unspecified duration. | Interval: two named endpoints, double-ended span, square caliper marked `?`, time direction. | Two unconnected events hide the interval. A numerical time scale would invent a guarantee. |
| `heartbeat-suspicion` | Can a sample see silence while heartbeats continue? Yes, between pulses. | Pulse trace with four possible sampling guides, then an unresolved dashed continuation. | One timeout line hides the ordinary gaps. Silence must not be drawn as proof of death. |
| `heavy-tail-shape` | Can equal means conceal different tails? Yes. | Two computed survival curves; log-probability y axis; duration/mean x axis; ticks and line keys. | A density sketch would answer a different question. These are analytic examples, not measured service times. |
| `no-mint-split` | What do successors receive? Two 45-unit balances after division and discount. | Ledger transfer: parent 100, division by 2, two 50 shares, discount 0.9, two successor accounts holding 45; total 90. | A direct 100-to-45 fork hides the calculation. The objects are reputation-credit accounts, not duplicated skills, prompts or models. |
| `equivocation-pair` | What makes the evidence contradictory? Different signed roots with the same issuer and epoch. | Two aligned signed records with root and signature fields, common issuer/epoch, and an explicit root inequality. | A generic fork loses the record fields. Valid signatures do not establish an honest issuer; comparison still requires both records. |
| `certificate-lifetime` | Which expiry limits authority? The earliest applicable endpoint. | Aligned intervals, three category colours and endpoint shapes, direct labels, common time direction, policy cutoff. | One chapter colour conceals the categories. Later card expiry cannot override an expired epoch or policy; lengths are schematic. |

Reusable native-size signed-record and reputation-ledger marks live with the
margin sketch styles. Their geometry identifies the objects; it does not use
pictorial area as an unsupported quantitative scale.

## Rendered review

Final Book:
`.cache/book-sketch-revisions-20260919/build/coordination-papers-mega-volume.pdf`

SHA-256:
`a4e8d97447b81de82af272f9aa329a697ee810f6037b113d71727fa3f0bebd88`

Reviewed by the implementing assistant, not a human usability study or author
approval. Opened the contact sheet, all six actual Book pages, and the adjacent
settlement page after the placement repair. No text was shrunk to clear a gate.

| Exhibit | Physical PDF page / printed folio | Observed result |
|---|---|---|
| Commit/sync | 39 / 11 | The bracket and arrow delimit the same span; both endpoint labels are clear. |
| Heartbeats | 76 / 48 | Four sample guides remain visible; the sketch sits by the checkpoint discussion without touching the preceding figure caption. |
| Heavy tails | 232 / 204 | Both axes, log scale, ticks and line keys are readable; there is no headline above the plot. |
| Reputation split | 315 / 287 | Both 50-unit intermediate values and both 45-unit balances are visible; division and discount occupy separate steps. |
| Expiry | 562 / 534 | Violet, blue and rust lines retain circle, square and triangle endpoints; the drawing is beside the admission paragraph. |
| Conflicting roots | 572 / 544 | The two signed records share the issuer/epoch label; the root inequality and limitation caption are separate and readable. |

Claim, grammar, hierarchy, spacing, labels, colour, page fit and caption
independence were inspected for these six exhibits. Scope remains local to
this edition and these pages.

Review files: `.cache/book-sketch-revisions-20260919/review/` (extracted margin
exhibits and sheet), `pages/` (assembled pages), and `flow-review/` (the changed
page break). The extract tool preserves the source PDF rather than retypesetting.

## Automated evidence and limits

- 703 pages, unchanged from the preceding proof.
- 906 registered margin objects, all placed once; zero margin geometry issues.
- 230 numbered captions checked; 190 floating-owner adjacency checks; zero
  caption failures. The remaining captions do not acquire owner-adjacency
  certification from this result.
- No detected off-page loss, footer intrusion or margin text collisions.
- 31 existing full-width advisories remain, including intentional margin art.
- Eight source/arithmetic tests, six rendered revision tests, and sixteen
  typography tests pass. All four purchased Suisse text faces remain embedded.
- All six new rendered tests reject the preceding PDF. This includes the
  misplaced expiry drawing, absent intermediate values, repeated headings,
  missing explicit axis labels, single sampling marker and same-colour bars.
- The uncropped eight-page native-preamble fixture passes figcheck. Cropped
  PDF extracts retain invisible page furniture in their clipping streams,
  which makes their standalone T5/T7 checks unsuitable; those false positives
  were not reported as a design failure or quietly converted into a pass.

The whitespace inventory increased from 34 to 35 candidates. The additional
candidate is PDF page 564 / folio 536: a 104.7-point bottom gap before the tall
worked-example figure on page 565. Both pages were opened. The figure cannot
fit that remaining space; this is not a caption-height reservation or a new
blank page. The existing whole-book whitespace queue remains open.

These edits and proofs are local. The checkout already contains a substantial
unpublished change set; no broad staging, commit, PR mutation or runtime start
was performed in this pass. Margin citations, bare “Thesis” notes, chapter-end
cards and the wider research/editorial review are not completed by this record.
