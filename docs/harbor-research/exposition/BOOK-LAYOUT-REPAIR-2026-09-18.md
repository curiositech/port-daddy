# Book layout repair — 18 September 2026

This is a local layout-validation record, not publication or author approval.
The shared design rules live in `BOOK-VISUAL-REVIEW.md`.

This records the earlier height/overflow repair. Its artifact and counts are
superseded by `BOOK-CAPTION-ADJACENCY-REPAIR-2026-09-18.md`. The later pass fixes
the detached-caption failure that this earlier bounds-only check missed.

## Causes repaired

- Margin captions previously reserved the greater of their own height and the
  artwork's height in the main column. A short figure with a long caption could
  therefore consume an entire page. The Book now lays out those columns
  independently, using positions measured on the shipped page.
- Portraits, Recall blocks and captions had separate placement paths. A late
  portrait could start at the paragraph's baseline and extend beyond the paper.
  One allocator now measures every complete margin object, including image
  descriptions, separates neighbouring objects, and raises a stack that would
  cross the footer. An impossible stack fails the build instead of clipping.
- Terminal excerpts used the full page width, consuming the explanatory margin.
  They now wrap in the text column with numbered explanatory margin captions.
- Recall blocks forced main-column page breaks; section float barriers and
  centred float pages compounded the whitespace. Those Book-specific causes
  are removed. Part spreads remain; chapter openers need not force a right page.
- Captions were shortened without turning proposed mechanisms into shipped
  ones. Repeated under-diagram exposition was removed in the reported recovery
  figure. The single-writer diagram was narrowed, the sealed-room pipeline
  recomposed in the main column, and the parity exercise table fitted to it.

## Verified local artifact

Full Book: `.cache/book-suisse-20260918/coordination-papers-mega-volume.pdf`

SHA-256: `a4c78ff26e68db06dcd48164d91014ae810a7449d521bcd07dd9fc5cc100d4ba`

- 726 pages, down from the saved 779-page pre-repair build.
- 886 registered margin objects, each shipped exactly once; no detected margin
  object collisions or text-height boundary violations.
- 230 numbered captions checked against the matching Book inventory; none
  missing, duplicated, in the wrong margin, or outside caption bounds.
- No detected page-edge ink loss, margin-text collisions, or footer intrusions.
- The deliberately near-foot portrait, tall caption, moved float, nested table,
  longtable, listing and terminal regression fixture passes rendered checks.
- Five dependency-free generator adversarial tests pass. The Jest wrapper was
  not run successfully because its dependencies are absent in this worktree.

The eight-page `book-layout-repair-proof.pdf` is extracted from that actual
Book, not separately typeset chapters. Its accompanying JSON identifies the
source PDF and page mapping. It includes the reported portrait, terminal,
durability table, recovery diagram, single-writer diagram and ticket-lock gap.

## Still unvalidated or requiring redesign

The all-page whitespace scan flags 82 pages. Contact sheets of this queue were
visually inspected; these flags are **not** 82 confirmed defects. They include
intentional part/chapter space and chapter endings, but also remaining problems:

- Some wide diagrams still consume the margin and put their caption below the
  artwork. They need narrower composition or split panels, not smaller type.
- Float-only tables and chapter-end bridges can leave sparse pages.
- The mechanized-evidence appendix has tall rows caused by narrow prose/path
  columns. It needs a different entry format rather than pagination patches.
- Twenty-five wide-ink advisories remain; these include intentional marginal
  portraits as well as wide diagrams. No blanket clearance is claimed.
- Safe caption bounds do not establish proximity to the right exhibit, good
  arrow geometry, legibility, factual correctness, or design acceptance.

Run both the caption inventory check and the all-object layout audit with the
matching converged `.aux` and `.log`. Review the full-page result after every
change to type metrics, content or geometry. Do not revive the old caption-height
reservation to fix a crowded margin.
