# Book layout follow-up — 19 September 2026

## Local artifact

`.cache/book-layout-followup-20260919/build/coordination-papers-mega-volume.pdf`

703 pages, Suisse Intl. SHA-256:
`cbe9a0ab947080ba7dec448912ddc8717a2d7e4b5a90a3f574df408df6281799`

This is a local, uncommitted revision in the existing dirty Book worktree. It is
not a publication or blanket approval of the Book's existing figures.

The preceding artifact had 705 pages and SHA-256
`e7d2f8f617b8bec85808ccd590909c0d4b023ab6a20215c76fcdfcfbb670bd54`.
Its original audit and screenshots remain available for comparison.

## Repairs

1. **Two nearly empty pages removed.** The shared boundary environment compared
   source-time page totals and forced a page turn after settling earlier content.
   That could ship the preceding page and then eject a two-line continuation.
   It now reserves four opening lines with `Needspace`; the frame remains
   breakable and margin placement remains the shipped-page allocator's job.
   Both copies of `pd-pedagogy.tex` match. Old physical pages 184 and 194 each
   had a 561.9-point empty lower body. The passages now flow on physical pages
   184 and 192, with their boundary discussion on the same page.
2. **Dependency diagram recomposed at native type size.** The uncaptioned,
   overwide horizontal rail is now `fig-stp-dependency-spine.tex`, Figure 5.1
   on physical page 307 / folio 279. Open stops and visible arrow shafts show
   prerequisite order; aligned prose states each capability's implementation
   boundary. The outside caption explicitly denies sufficiency and an
   operational-market claim. No scaling, tiny labels or floating commentary.
3. **Sanction arithmetic corrected.** A score falling from 90 to 60 loses 30,
   while remaining 10 above a newcomer's score of 50. The prior text confused
   those two differences. The equation and surrounding claim are unchanged.
4. **Table 6.5's caption corrected.** The market-status table had a copied
   legibility/authority/operator-model caption. Its new caption describes the
   actual implementation gaps. It stays in the margin beside the first table
   segment, now on physical page 441 / folio 413. Table status claims were not
   reverified against a running system in this layout pass.
5. **Backmatter headers corrected.** References and image credits get their own
   running furniture. The last credits leaf ships before the local header
   definitions expire; it no longer says “Solutions to the exercises.”
6. **Figure-checker blind spot closed.** Its old crop assumed a caption below a
   drawing. With the Book's side captions, that could discard nearly the entire
   picture and append figure labels to the extracted caption. The crop now
   recognizes the side column, retains the picture and separates caption text.
   Deliberately overprinted labels below the caption top fail on either side.
   A drawing without labels and a conventional bottom caption are also tested.

The first redraw used close-spaced process boxes. After rendering, it was
replaced with open stops so that connectors have visible shafts rather than
just arrowheads squeezed between boxes. Only the open-stop version is delivered.

## Exact-artifact checks

- 230 numbered captions checked; zero placement failures, including owner
  adjacency and true exhibit-width checks.
- 896 margin objects registered and 896 placed; zero margin geometry issues.
- Zero off-page ink loss, margin-text collisions or footer intrusions.
- 20 legacy width advisories remain, corresponding to intentional margin
  illustrations/evidence and portraits; the old dependency-rail advisory is gone.
- Illustrated contents, chapter plates, four part spreads, epigraphs and actual
  Suisse font routing pass the rendered tests.
- 13 layout tests pass, including rendered continuation/header checks. The old
  705-page PDF fails both continuation subcases and the final-header check.
- 12 editorial/arithmetic tests, 16 typography tests, 6 contents tests and 66
  generator/contents tests pass. The caption suite has 17 passing tests and five
  optional rendered-fixture tests skipped; the complete-Book caption audit ran.
- Three-edition fragment checks for the new diagram are clear, with ink widths
  3.96 inches (Swiss), 3.84 (maritime) and 3.85 (technical). The corrected lint
  has no findings on these three versions. This does not validate other figures.
- The figure-checker/review-status suite has 17 passing tests, including the
  new negative controls. `git diff --check` is clear.

Actual inspection: all five contact sheets of the original 43 whitespace flags
were opened, then the changed Book pages and their neighbors were checked at
reading size. The three-edition dependency sheet was opened after the final
redraw and again after fixing the lint. The full Book, not a chapter PDF, is
the acceptance artifact. The reports and images are under
`.cache/book-layout-followup-20260919/`.

## Remaining whitespace review

The heuristic now lists 38 pages, not 38 confirmed defects. All its remaining
gaps are below content, not caption-height rectangles between body passages.
The original candidate pages were visually triaged; the table below records
their corresponding positions in this artifact. Small gaps near headings or
table records are retained rather than forcing unreadable fits.

| Physical PDF pages in this artifact | Disposition |
|---|---|
| 7, 29, 207, 381 | Blank alignment leaves before retained spreads; preserve. |
| 8 | Facing reader-route spread; preserve its composition. |
| 15, 16, 18, 20, 25, 26 | Illustrated complete contents and chapter/part grouping; preserve the plates and navigation. |
| 6 | Short reader-route ending; can be tightened editorially, not a caption-placement failure. |
| 99, 106, 112 | About 101–105 pt before exercises, a subsection or a chapter appendix. Check heading/prose fit before changing. |
| 115, 168, 301, 588 | Chapter endings/handoffs. Retain for now; do not manufacture filler. |
| 149 | Large chapter-2 conclusion-to-appendix gap; editorial rebalancing remains open. |
| 150 | Chapter-2 appendix introduction before a long table; review the first table chunk. |
| 176 | Diagram/legend followed by a worked example; native-size figure fit. |
| 206 | Chapter-3 ending and handoff; flow improved, but the short ending remains an editorial candidate. |
| 297, 378 | End of a table or chapter discussion before an appendix. Not a caption-height reservation. |
| 392, 413, 491, 566 | Approximately 103–110 pt before a subsection or figure. Retain readable headings and exhibits. |
| 440, 518, 585 | Large conclusion-to-appendix gaps in chapters 6–8; prioritize editorial balancing. |
| 445 | Short chapter-6 proof ending and handoff; still a substantial balance problem. |
| 655 | Last solution continuation before the Book appendices; still a substantial balance problem. |
| 658, 659, 668 | Appendix record/table breaks; inspect record grouping before moving content. |
| 703 | Final image-credit leaf. Header repaired; ordinary end-of-book white space remains. |

Next review priorities are the short ending leaves at 445, 518 and 655, then
conclusion-to-appendix transitions. Do not “fix” them by reducing type, removing
chapter art or making a margin caption determine body height. The rest of the
Book still needs figure-by-figure semantic and visual review.

Two additional observations from the neighboring-page inspection: Figure 3.11
(physical page 193) crowds the 32 and 35 x-axis labels; Table 6.5's continued
page 442 gives the status column generous width while wrapping the mechanism
and grounding columns heavily. The caption is repaired, but that table's column
proportions and the plot's tick labeling still need recomposition.

## Guidance and delegation

The Tufte evidence skill and all five references plus both examples informed
this pass. The diagram-craft standard, tree/DAG template, chartwork rubric,
figure-system atlas and evidence-writing guidance were also read. The durable
margin guidance now records the forced-break lesson and the checker crop trap.

Two lower-cost native reviewer launches were rejected by the environment's
isolation requirement; no additional agents started. Review in this follow-up
was performed by the lead, not independently certified. No Port Daddy runtime
was started and no licensed font files were copied into the repository.
