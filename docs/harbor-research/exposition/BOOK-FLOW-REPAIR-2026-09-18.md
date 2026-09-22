# Book page-flow repair — 18 September 2026

Local layout repair, not publication or author approval of the diagrams.

## Reported defect and cause

The author's Figure 6.8 screenshot showed a caption below its graph and a
mostly empty page. The preceding 723-page Suisse build had repaired caption
adjacency, but still stranded this medium-height exhibit on a float-only page.
The shared layout retained LaTeX's .5 float-page threshold: a half-page figure
could take a whole page even with prose waiting behind it.

The Book now requires .8 of the text height for an ordinary float-only page,
allows top floats up to .85, and leaves at least .1 for text. Both ordinary and
double-column settings are explicit. Existing top-aligned float pages,
independent margin flow, chapter breaks and part spreads are retained. No
caption-height reservation, type shrinking or per-figure negative spacing was
introduced.

The independent page review then found a stranded run-in heading, a one-line
paragraph tail and a word split across a page turn. Shared club, widow,
display-widow and broken-word penalties now prevent those page breaks. Page
count is not the optimization target: these protections can add pages while
improving the reading sequence.

Repagination exposed one collision between Figure 4.6's caption and its next
Recall block. Three Recall questions were shortened without removing their
requests to evaluate sole ownership at zero attention budget, state the two
limits of the aggregation function, and explain both failure directions of
the alternative. This restores the caption's top alignment.
Table 7.5's caption was also shortened: it states dominance, the unique
equilibrium and the gain from mutual truth without repeating the payoff cells
and the immediately following explanation. It can now stay beside the table
without crossing the footer.

The Book layout and TikZ engineering guidance informed the decision to fix
shared pagination, retain readable labels and inspect complete assembled pages.
An existing native agent separately reviewed the old sparse-page examples and
the new chapter-end float behavior; no Port Daddy runtime was used.

## Verified artifact

Historical snapshot: the output path below has since been rebuilt. See
BOOK-PAGINATION-REPAIR-2026-09-18.md for the current 705-page artifact, exact
hash, subsequent repairs and remaining review scope.

- Book: `.cache/book-flow-20260918/coordination-papers-mega-volume.pdf`
- SHA-256: `4ebc2e6fd4c46e3de691928b40ccca21b9f620101a4bf174b415bafa069c9198`
- 720 pages, down from 723 with the same purchased Suisse typography.
- PDF metadata reports `font profile: suisse`; Regular, Regular Italic,
  Semibold and Semibold Italic are embedded. Source Sans 3 is absent.
- 230 numbered captions checked for bounds, duplication and margin side.
- 189 floating exhibit owners checked for adjacency and measured width;
  zero failures. The other 41 table/listing captions receive bounds checks,
  not owner-adjacency certification.
- All 886 registered margin objects placed exactly once; zero detected
  collisions or text-height violations.
- No detected off-page ink loss, margin-text collision or footer intrusion.
- Eight matching chapter plates remain in the one complete contents, with
  correct chapter destinations. Part spreads remain present.

### Actual pages inspected

| Exhibit | Before: printed folio / PDF page | After: printed folio / PDF page | Page-flow result |
|---|---|---|---|
| Figures 1.12–1.13, capability and reference monitor | 31 / 61 | 30 / 60 | The two diagrams share a page with prose between and below them. |
| Table 2.5, verified properties | 120 / 150 | 117 / 147 | The next subsection and worked example occupy the lower page. |
| Figure 4.2, consent lifecycle | 196 / 226 | 193 / 223 | The protocol and its diagram share one page. |
| Figure 4.6, escalation band | — | 212 / 242 | Shorter Recall questions let the caption stay beside the diagram's top. |
| Figure 5.12, deterrence regime | 359 / 389 | 335 / 365 | The plot now appears with its discussion, not in the chapter-end figure queue. |
| Figure 6.8, cold-start pricing | 403 / 433 | 399 / 429 | The caption starts beside the graph and continuing prose fills the lower page. |
| Table 7.5, one-shot signaling | — | 454 / 484 | The shorter caption starts beside its table and clears the footer. |

The seven-page `flow-proof.pdf` contains these actual Book pages, not separately
typeset chapters. `flow-proof.json` records the source hash and every numbered
exhibit's stable identity. A correctly placed caption is not a design verdict.

The independent agent's second page-turn review covered PDF pages 59–61 and
365–366 of the 720-page build immediately before Table 7.5's caption-only edit.
It confirmed the three page-turn defects were addressed. Final regenerated
pages, including Table 7.5 and the reported Figure 6.8, were inspected by the
main agent after that edit. A short final line still follows an ordinary
within-page hyphenation of “theorem” on PDF page 61; this is no longer a
word split across a page turn, but remains an editorial polish candidate.

## Checks and reproducibility

The rendered caption fixture now includes a deferred medium-height exhibit
followed by real paragraphs. Its test requires continuing prose on the same
page as the exhibit, in addition to the existing long-caption, portrait,
nested-caption, listing and moved-float cases.

- 18 caption regression tests pass against this Book and the rendered fixture.
- 14 typography tests pass with the expected face set to `SuisseIntl`.
- Seven shared-layout tests and two chapter-plate generator tests pass.
- Four review-inventory tests pass; the proof and contents report agree on
  the final Book hash.

The private font configuration still lives in `.cache/book-suisse-20260918`.
Compilation into this new output directory must retain that directory as the
Tectonic search path. One intermediate run omitted it and used the open-proof
font profile; that run was rejected. All final audit and proof files were
regenerated from the Suisse artifact identified above.

Audits beside the Book:

- `caption-audit.json`
- `layout-audit.json`
- `overflow-audit.json`
- `flow-proof.pdf` and `flow-proof.json`
- `contents-proof/` and `contents-proof-result.json`

## Remaining work

Sparse-page flags fell from 79 to 58. These are review candidates, not 58
confirmed defects: the list includes deliberate openings, chapter endings,
contents pages and tall-row evidence tables. Eleven wide-ink advisories remain
(ten marginal images and one drawing); they are not off-page loss reports.

Some inspected exhibits still need editorial redesign. Table 2.5 has a narrow
property column; the consent drawing retains numbered guard lookups; Figure
6.8 is a qualitative schematic with repeated explanatory text. Better page
flow does not validate their visual form, evidence or prose. Uncaptioned art,
translated/non-PGF overhang and non-floating caption adjacency still require
separate page review. The whole Book remains unvalidated for design acceptance.
