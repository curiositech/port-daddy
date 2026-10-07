# Book R1 page-architecture report

Date: 2026-09-17

Scope: page architecture and front matter only. No commit or push was made, and
no local Port Daddy runtime or coordination command was used.

## Result

The Book remains 7 by 10 inches (504 by 720 PDF points) with a 4.5-inch text
measure. It now composes as a real two-sided book: the inner margin is 0.8 inch,
the outer apparatus is 1.7 inches, headers and marginalia mirror by leaf, and
full-width art expands toward the physical outside edge instead of shrinking the
text column.

The reader map is a guaranteed verso/recto construction. The generated argument
map is now a two-page Swiss-modern contents spread using the part colours,
grotesk type, large Roman part numerals, and hard rules of the part and chapter
plates. The standalone first-edition-numbering concordance is no longer
rendered; the old numerals remain data-only historical citation metadata.

The chapter 7 passage formerly at PDF pages 413-414 now uses fixed theorem skips,
ragged-bottom composition, and a concise outer-margin table caption. This keeps
the property/prose transitions on an authored cadence and lets the consent table
follow on the next leaf without a full-width caption consuming the page.

## Page readback

| Surface | Before (published PDF) | After (Tectonic proof) |
|---|---|---|
| Reader map | physical 6-7, folios iii-iv; consecutive pages but logical parity and one-sided geometry disagreed with the leaves | physical 6-7, folios vi-vii; forced even verso / odd recto |
| Argument map | physical 11, one page | physical 10-11, true facing contents spread |
| First-edition concordance | physical 12 | removed; detailed contents now begins on physical 12 |
| Part I plate | not guaranteed to open as a spread | physical 20-21, even verso / odd recto; both halves inspected |
| Chapter 1 plate | not guaranteed recto | physical 23, odd recto |
| Target chapter 7 passage | physical 413-414, printed 395-396 | physical 422-424, printed 404-406 |
| Consent table caption | conventional caption below the table | concise numbered caption in the outer left margin of even physical page 424 |

The nine-page body shift is the expected cost of true part spreads and recto
chapter openings. Tectonic resolved the resulting internal references after its
automatic reruns.

## Source and macro changes

- `coordination-papers-mega-volume.tex`: enables `twoside`, aligns Roman folios
  with physical leaves, forces reader-map and contents verso openings, and starts
  the Arabic body on a recto.
- `coordination-papers-mega-volume-preamble.tex`: changes fixed left/right
  geometry to inner/outer geometry; mirrors running heads; adds
  `\cleartoleftpage`; makes `\pdpart` a facing spread and `\pdchapter` a recto
  opener; adds `\pdcontentsspreadbegin`, `\pdcontentsspreadbreak`,
  `\pdcontentsbackmatter`, and the revised contents band macros; gives theorem
  styles fixed vertical skips; enables `\raggedbottom`; and makes sanctioned
  full-width TikZ art spill into the actual outer margin.
- `pd-pedagogy.tex` in both shared locations: adds
  `\pdmargincaption[short]{text}`. In the Book it numbers the current figure or
  table, writes its list entry, and uses the collision-aware outer-margin
  allocator. If the caption exceeds one quarter of the text height it falls
  back to an ordinary caption. In standalone papers it delegates directly to
  `\caption`.
- `fig-book-reader-map.tex`: replaces the long conventional caption with the
  concise margin-caption path.
- `agent-transactions-whitepaper.tex`: moves the consent table to the new
  concise margin-caption path.
- `generate-mega-whitepaper.mjs`: emits the two-page semantic contents spread
  and no concordance page. The generator test asserts all eight chapter rows,
  exactly one spread break, and absence of concordance copy.
- `test_page_overflow.py`: reads the new inner/outer geometry keys while deriving
  and checking the unchanged 4.5-inch measure.

## Build and inspection

Canonical command attempted:

```sh
scripts/build-whitepapers.sh coordination-papers-mega-volume
```

The installed BasicTeX tree stops before the Book source with
`File 'xltabular.sty' not found`.

Independent full-book proof:

```sh
node scripts/generate-mega-whitepaper.mjs \
  .cache/whitepaper-build/coordination-papers-mega-volume
cd website-v2/public/whitepaper
tectonic -X compile coordination-papers-mega-volume.tex \
  --outdir ../../../build/page-architecture/tectonic \
  --keep-intermediates --keep-logs
```

Result: 653 pages, 504 by 720 points. The proof PDF is at
`build/page-architecture/tectonic/coordination-papers-mega-volume.pdf`.

Rendered evidence is in `build/page-architecture/after/`:

- `reader-map-spread.png`
- `contents-spread.png`
- `part-spread.png`
- `rhythm-contact.png`

The reader map, contents, Part I spread, Chapter 1 plate, and chapter 7 pages
421-424 were inspected at raster resolution. The inspected even-page caption is
left/outside and the inspected odd-page caption and portrait are right/outside.

Validation:

- `node --test scripts/generate-mega-whitepaper.test.mjs`: 46/46 pass.
- Shared `pd-pedagogy.tex` copies are byte-identical.
- Targeted `git diff --check`: clean.
- PDF text readback finds the reader map on 6, contents on 10, chapter 7 section
  on 422, consent section on 423, and no first-edition-concordance copy.

## Remaining risks

- The canonical XeLaTeX build cannot be certified on this machine until the
  repository's expected TeX package set includes `xltabular`; Tectonic is the
  successful full-book witness for this patch.
- The existing full Book still reports legacy underfull/overfull boxes,
  duplicate PDF destinations, and some link annotations outside the MediaBox.
  The requested spreads were visually checked, but this slice was not a
  book-wide overflow cleanup.
- `python3 -m unittest tests.harbor-research.test_page_overflow` could not run in
  the default Python because `pymupdf` is not installed. The geometry was
  instead checked from the source and the built PDF MediaBox.
- The long-caption fallback compiled as part of the shared macro but was not
  forced with an artificial over-quarter-page caption in this round.
- The worktree already contained unrelated LFS-visible figure changes. They
  were not normalized, staged, or otherwise touched by this slice.
