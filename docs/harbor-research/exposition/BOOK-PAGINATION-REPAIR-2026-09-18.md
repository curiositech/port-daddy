# Book pagination repair — 18 September 2026

This pass follows the 720-page Suisse snapshot recorded in
BOOK-FLOW-REPAIR-2026-09-18.md. It repairs shared composition, not the
meaning or design of every plot. Chapter PDFs were not built.

## Shared defects repaired

- **Lost table measurements.** The active margin-caption renderer replaced
  the older longtable renderer but omitted its caption-height write. The
  reader remained active, so all later passes reserved a guessed 40% of a
  page. The active renderer now saves the actual registered box height.
  Sixteen table measurements survive into the converged auxiliary file.
- **Indivisible protocol prose.** The two chapter-specific protocol variants
  used TikZ nodes containing minipages. They now share a breakable text frame,
  with their counters and links retained. A long protocol can use the rest of
  a page and continue without shrinking its text.
- **Worked-example splitting.** Strong finite penalties inside frames allow
  legal splits. A worked example reserves its heading and first lines when
  starting independently; it does not issue another page break immediately
  after a section heading. Ordinary body paragraphs keep strict widow/orphan
  and broken-word protection.
- **Small prose spill pages.** Repetitive introductory wording was tightened;
  the short chapter handoffs stay together. Chapters 5 and 7 no longer put
  only two closing lines on a new page.
- **Frontmatter parity.** Align the physical verso once before resetting the
  page counter. Keep the facing part spreads and left-hand chapter openers.
- **Cramped evidence appendix.** Replace five narrow columns with wide
  field/value records. Preserve every supplied identifier, path, status,
  CI job, retirement reason and evidence policy. Short path groups stay with
  their record; the long script inventory repeats its identity on continuation
  pages. No smaller font is used to make rows fit.
- **Stale running heads.** One shared backmatter header function clears
  chapter heads on both sides for solutions and appendices.

The Book layout and TikZ guidance required actual assembled-page inspection,
normal-size labels, shared fixes, and separate geometry/design judgments.
An independent native agent reviewed all 31 flagged body pages from the
720-page baseline, then inspected the repaired tables, handoffs, protocols and
appendix continuations. It caught an orphaned subsection heading in an
intermediate build; a rendered fixture now tests that interaction.

## Regression evidence

The real Book-preamble fixture covers short and long captions, direct
longtable and xltabular, moved figures, ordinary and nested listings,
late-page portraits, medium floats sharing a page with prose, splittable
examples and protocols, protocol destinations, and headings followed by
framed examples.

caption-layout-no-persistence-fixture.tex is deliberately broken: only the
active table-height persistence is disabled. It must fail both the missing
measurement check and the rendered short-table placement check. It is a test
witness, not a publication target.

The generator tests preserve all manifest fields and the single complete
illustrated contents. The rendered Book test also checks that all 41 artifact
records remain present exactly once, excluding repeated continuation heads.

## Review boundary

The earlier 720-page body review is recorded in
.cache/book-flow-20260918/body-whitespace-4ebc2e6f-classification.md.
Its absolute page numbers belong only to that frozen baseline.

Not every large gap was caused by the missing measurement. The independent
review found remaining gaps around Tables 2.6, 5.10 and 6.5, including tall
unbreakable rows. Some chapter conclusions still end on sparse pages.
Intentional opening spreads and parity blanks must remain.

Geometry acceptance is not diagram acceptance. Figure 6.8 now has its caption
beside its top and body text below it, but its schematic and repeated labels
still need editorial redesign. The wider per-figure and prose review remains
unfinished. Non-floating caption adjacency and uncaptioned art still require
visual inspection; current exhaustive adjacency checks cover floating owners.

## Final artifact

- Assembled Book: .cache/book-flow-20260918/coordination-papers-mega-volume.pdf
- SHA256: 04c052f49e543037d73cd229e4ba2d9436c1d09979ce0fed724bf58bdcdc9b9e
- 705 pages, compared with the 720-page baseline. No typography shrinkage.
- Purchased Suisse profile; Regular, Regular Italic, Semibold and Semibold
  Italic embedded. No Source Sans substitution.
- All eight chapter plates appear exactly once in the single illustrated
  contents and link to the correct chapter; all four part spreads retained.
- All 41 evidence-manifest records preserved.
- 230 numbered captions: zero bounds/duplication/margin-side failures.
  189 floating owners also pass adjacency and measured-width checks.
  The other 41 captions receive bounds checks, not automatic adjacency approval.
- All 886 margin objects ship once; zero detected collisions or text-height
  violations. No detected off-page ink loss or footer intrusion.
- Zero overfull vertical boxes, failed frame-splitting retries, or insufficient
  running-head-height warnings. Horizontal overfull and underfull box warnings
  remain; this is not a clean TeX log.
- 42 whitespace-review candidates, down from 58. This includes deliberate
  openings and ends; it is not a count of confirmed defects.
- Eleven wide-ink advisories remain, including ten marginal images. These are
  not off-page loss reports and still require visual judgment.

### Checks on the final files

22 caption/layout-fixture tests, 16 typography/content-preservation tests,
nine shared-layout tests, four review-inventory tests, and 66 generator/art
tests pass. The deliberately broken fixture fails exactly the two intended
checks: missing measurements and a short table displaced from its source page.
The whole-Book test is intentionally skipped for that fixture-only run.

The audit files, flow-proof inventory and contents-proof receipt were
regenerated from the exact final PDF and its converged auxiliary file.
The shared Book/pedagogy sources remain synchronized between source trees.

### Actual page checks

| Final PDF page / folio | Inspected result |
|---|---|
| 28 / xxviii | Introduction ends here; no three-line spill page. |
| 246–247 / 218–219 | Canary protocol continues cleanly between adjudication bullets. |
| 298 / 270 | Table 4.16 starts under its introduction; its caption remains marginal. |
| 363–364 / 335–336 | Tombstone protocol uses the former gap. Subsection 5.12.2 stays with its example heading and four opening lines; continuation is readable below Figure 5.13. |
| 382 / 354 | Chapter 5 handoff stays below its final table, without a two-line spill. |
| 423 / 395 | Figure 6.8 caption is beside the plot top; continuing prose occupies the lower page. This is placement acceptance, not figure-design approval. |
| 527 / 499 | Chapter 7 handoff stays with its closing discussion. |
| 668–670 / 640–642 | Evidence records and continuation identifiers readable; short path groups stay with their owners. |

The independent agent confirmed the final subsection/example turn at
363–364, including complete text and clearance above the foot, against the
final hash. The main reviewer opened the repaired pages at reading size.

Review artifacts beside the Book:

- pagination-proof.pdf: ten actual Book pages, with original page/folio
  bookmarks and the source hash in its metadata.
- flow-proof.pdf and flow-proof.json: eleven actual pages and the full
  numbered-exhibit inventory, explicitly design-unvalidated.
- contents-proof/: the one complete illustrated contents and chapter-art
  destination checks.
- caption-audit.json, layout-audit.json, overflow-audit.json: geometry results.

The persistent authoring contract is BOOK-VISUAL-REVIEW.md. Private font
configuration remains in .cache/book-suisse-20260918; compilation into another
output directory must retain that search path. No Port Daddy runtime was
started and no external publication was performed.
