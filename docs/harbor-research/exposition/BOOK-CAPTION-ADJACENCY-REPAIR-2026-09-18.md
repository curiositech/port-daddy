# Caption adjacency repair — 18 September 2026

Local Book repair and review record. Not publication, author acceptance, or a
claim that every illustration is now well designed.

The result below remains a historical 723-page build. The subsequent
[Book flow repair](BOOK-FLOW-REPAIR-2026-09-18.md) supersedes its pagination and
audit totals, while retaining the caption-adjacency changes documented here.

## What was wrong

The shared wide-figure fallback deliberately placed the margin caption after
the artwork. The caption could be entirely inside the correct margin while
starting beside the following paragraph. The existing test treated that as
success. Several diagrams also borrowed the caption column because their
unscaled artwork was wider than the body column.

The source-time height reservation had already been removed; restoring it
would bring back the blank rectangles under shallow figures. These are separate
defects, not alternate solutions.

## Changes

- The shared float wrapper anchors caption and exhibit at the same top. It
  has no wide-figure branch that moves captions below the artwork. Main-column
  prose still follows the artwork independently of caption height.
- Captioned PGF diagrams must fit the body column at normal label size. Their
  unscaled bounding widths are recorded before the wrapper can conceal them.
  Oversized diagrams trigger a warning and fail the matching PDF audit.
- Wide diagrams were recomposed with wrapped headers, narrower coordinate
  grids, or stacked panels. The receipt-provenance diagram now uses one binding
  bus; the transfer ceremony uses four actors and two cross-boundary messages.
  Margin placement does not justify shrinking the type.
- Figure 6.9 now separates log-risk from linear cost, with aligned reviewer
  counts and numeric axes. Perfectly shared detection is an explicit limiting
  comparison, not a claim about every kind of correlation. Five independent
  reviewers leave 1.024% residual risk; adjacent prose now gives the exact
  0.01024 rather than an equality to a rounded 0.010.
- Caption audits use measured, shipped owner anchors and the registered
  caption box. A neighboring Recall cannot lend its text height to a detached
  caption. Extracted text remains a conservative overflow check.
- Page inspection caught further collisions after narrowing. Guards no longer
  repeat their descriptions beside the migration spine; transfer badges clear
  their event boxes; labels clear tick values, curves and message paths; the
  lineage comparison gives the copy-fork panel a separate row.
- The figure-system and TikZ engineering guidance informed the separate risk
  and cost plots, normal-size labels, visible arrow shafts and actual-page
  checks. An agent redrew assurance and separately challenged the audit. These
  are agent reviews, not reader interviews or author approval.

## Reproducible local result

Book: `.cache/book-suisse-20260918/coordination-papers-mega-volume.pdf`

SHA-256: `b574bdadcb3ac7bcf961d9f823af8967cf2404e25e011e385f47ad651847dd57`

- 723 pages. The saved preceding build had 726 pages.
- 230 numbered captions: no missing, duplicate, wrong-margin or bounds failures.
- 189 recorded floating exhibits: no same-page, adjacency or measured-width
  failures. The other 41 non-floating table/listing captions receive bounds
  checks only, not owner-adjacency certification.
- 886 registered margin objects, each placed once; no detected object collision
  or text-height boundary violation.
- No detected off-page ink loss, margin-text collision or footer intrusion.
- All eight chapter plates remain in the single complete contents, with the
  correct chapter links; part and chapter openers are retained.
- 18 caption regression tests pass, including actual Book and rendered layout
  fixture checks. Five layout tests, four inventory tests and two chapter-plate
  generator tests also pass.

The main repaired example is Figure 6.9, printed folio 417 / PDF page 447.
Its registered caption and exhibit both start at 217.58 PDF points.
Other previously detached examples now share their tops:

| Figure | Printed folio / PDF page | Shared top (PDF pt) |
|---|---|---:|
| 2.1, Anchor's four phases | 93 / 123 | 248.63 |
| 6.2, debit and escrow commit | 376 / 406 | 283.79 |
| 8.4, revocation | 527 / 557 | 61.20 |

The eight-page `caption-adjacency-proof.pdf` is extracted from this actual Book,
not independently typeset chapters. `caption-adjacency-proof.json` records the
source hash and all exhibit identities. The assurance page and changed diagram
details were opened at reading size and enlarged. The review addressed the
reported placement and label-clearance defects, not a comprehensive semantic
or aesthetic acceptance of those diagrams.

Audit artifacts in the same build directory:

- `caption-adjacency-audit.json`
- `adjacency-layout-audit.json`
- `adjacency-overflow-audit.json`
- `contents-final-proof/` (complete actual contents, plate identities and links)

## Remaining limits and review queue

- Seventy-nine pages have large whitespace bands for review; this count includes
  intentional opening/closing pages and is not a count of confirmed defects.
- Twelve wide-ink advisories remain: ten marginal images and two drawings.
  They are not evidence that every inline illustration is body-column safe.
- Width instrumentation records the maximum PGF picture/wrapper width, not a
  union of all translated or non-PGF ink. Hidden offsets still need full-page
  checks. Owner height is float height, not a tight crop of visible marks.
- Unnumbered exhibits are not covered by the numbered inventory. The rendered
  fixture checks a starred caption, but does not certify every unlisted object.
- Non-floating table/listing adjacency, sparse chapter-end pages, the tall-row
  evidence appendix and the non-captioned inline full-width fallback remain
  separate review work.
- Figure 5.10's qualitative curves, missing numeric log-axis values and stacked
  formula notes still warrant redesign. Moving its x-axis label clear of the
  ticks does not resolve those issues. Other plots likewise remain unvalidated
  until their meaning and actual-page composition receive their own review.

Keep bounds, adjacency, meaningful quantitative encoding and author acceptance
as separate evidence. A passing placement audit must never become a design
approval label.
