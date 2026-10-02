# Book visual review: reader first

## Reset — 18 September 2026

The author rejected all five figures in the latest presented sample. This is
evidence against the review process, not a five-item repair list. Treat the
entire Book's diagrams, plots, inline exhibits and tables as **unvalidated**.
Earlier `keep` dispositions and automated `PASS` labels are historical records,
not approval of the current Suisse rendering. No blanket redesign is approved
merely because it adopts a named grammar such as UML.

The automated fragment run covers 130 input fragments. That is not a complete
inventory of the assembled Book: inline exhibits and tables also need review.
Use the Book's caption records and named PDF destinations to create the review
queue. Preserve an explicit gap for uncaptioned illustrations; do not claim
caption inventory proves complete visual coverage.

## What a rewrite must earn

1. Name one question a reader can answer from the exhibit. If a sentence or
   table answers it more clearly, replace or remove the drawing.
2. Read the adjacent definition, example or data source. Necessary conditions
   are not sufficient attacks; public signatures are not secret keys; a
   designed mechanism is not shipped behavior.
3. Choose the form for the relationship: common-scale position for quantities;
   aligned rows for comparison; messages for an interaction; states for legal
   transitions. A box list is not automatically a diagram.
4. Make the decisive fact direct. Do not repeat it as a heading, symbolic node,
   explanatory label, numbered legend and caption. No numbered all-caps row
   labels unless the number actually identifies a step the reader must follow.
5. Every arrow needs a named relation, a clear source/destination and a visible
   shaft at final size. Never hide a border or path behind a white label.
6. Use the shared Book fonts and semantic styles. One normal label voice and
   restrained emphasis are usually sufficient. Suisse does not fix a bad form.
7. Keep concrete examples tied to the chapter. Show input, decision and result
   where relevant. Label invented walkthroughs as illustrative, not executed.
8. Use a short outer-margin caption for the consequence or limitation. Put the
   mathematical derivation in the text when it would create another label tier.
9. Inspect the actual assembled page at reading size and zoomed in. Check the
   facing page too: margins, caption ownership, float placement and rhythm are
   part of the exhibit. Never shrink labels to obtain a green check.
10. Remove one element and ask whether anything meaningful was lost. Repeat.

## Evidence, not approval by lint

### Caption placement contract

All figure, plot, illustration, table and code-listing captions belong in the outside margin:
left on even printed pages, right on odd printed pages. This includes long
captions, starred captions, captions nested inside `center`/`minipage`, and
page-breaking tables and listings. There is no length-based return to an inline caption.

The shared Book margin layer (`pd-margin-layout.tex`) owns this rule. **Never
reserve the caption's height in the main column.** Prose resumes below the
exhibit even when its caption is longer. A caption must not create a blank
rectangle beside itself. The old max(exhibit, caption) reservation was a defect,
not a design rule; regression tests must reject it.

**Beside means beside the exhibit's top, not beside the next paragraph.** A
caption in the correct margin can still be detached from its owner. The shared
float wrapper must anchor its caption and exhibit at the same top. Allow only
a small collision adjustment (at most two caption lines), with actual vertical
overlap. Shorten competing notes or recompose the exhibit if this cannot fit;
do not reserve body space to make the margin stack look aligned.

Captioned diagrams must fit the body column at normal label size. Do not let a
wide diagram borrow its caption's margin, and never fall back to a caption
under the artwork. Record the true picture ink width before wrapping: a
column-width TeX box can conceal a much wider picture. Overwide ink fails the
placement audit even when the wrapper and caption themselves fit.

Every margin object, including portraits, Recall blocks and exercise pointers,
uses the same allocator. Positions come from anchors on the shipped page,
not source-time page counters or `pagetotal`. Measure complete boxes including
image descriptions. Keep notes disjoint and inside the text-height bounds;
raise the stack when a late portrait would cross the footer. If the entire
stack cannot fit, fail the build and edit the content. Never knowingly spill,
crop, overlap, or silently omit a note. Placement requires converged passes.

The same rule applies to body-frame page breaks: do not use `pagetotal` plus a
forced `newpage` after an earlier settle may have shipped the page. Reserve the
opening lines through the page builder and keep frames breakable. The 19 September
follow-up catches the two-line continuation pages this combination produced.
Its rendered regressions reject the old PDF, not just an old source spelling.

Fragment checks must inspect the drawing **beside** a margin caption. A legacy
"everything above the caption" crop can exclude all the relevant marks while
claiming clear checks. The figure lint now has deliberately overlapping labels
with captions on both sides as rejection fixtures. Automated results still do
not confer visual approval.

Terminal transcripts use the normal text column and a numbered explanatory
margin caption. Long commands wrap at a readable size. Sample-data blocks keep
their continuous-feed motif, but do not consume the explanatory margin either.
Float-only pages start at the top; they do not centre a shallow diagram in a
nearly empty page. Nor should a medium-height figure receive its own page just
because it occupies half the text height. The shared Book uses a .8 minimum
float-page fraction, .85 maximum top-float fraction and .1 minimum text
fraction, including the corresponding double-column float settings. Test a
deferred medium-height exhibit with real following prose: they must share a
page when space remains. Inspect chapter-end queues too; stricter float-page
admission is not permission to strand a backlog at a forced page break.
Protect paragraph starts and ends with shared club/widow penalties, and reject
page breaks inside hyphenated words. Check the actual page turns after changing
float flow: one line beneath a diagram is not adequate space for a run-in
heading and its paragraph. These protections must not be replaced by one-off
negative spacing or smaller type.
Chapter openers may begin on the left; keep part spreads.

Page-breaking tables must save the height of the **registered caption box**
from the active renderer. A replaced caption hook can leave the old reader
intact while silently removing its writer; then a cold-start reservation
persists on every build. Check converged auxiliary records and a short table
that fits in less than 40% of a page. Also compile the deliberately broken
no-persistence fixture: the rendered regression must reject it.

Protocol passages are text, not indivisible TikZ/minipage drawings. Use the
shared breakable protocol frame, preserve its counter and links, and reserve
only the heading plus its first lines. Worked examples need the same safe
start. Infinite page-break penalties inside splittable frames can defeat
their splitting algorithm; use strong finite preferences there and check the
final log for failed split retries, not just for a successful PDF build.
Keep a short chapter handoff together; tighten redundant wording before
allowing two closing lines to occupy a new page.

Evidence inventories are field/value records at the normal small-text size,
not five narrow columns of prose. Preserve every identifier, path, status,
CI job, retirement reason and supplied evidence policy. Keep short path groups
with their record; label long-list continuations so readers retain context.
Do not add trailing spacing rows that can strand a repeated table head alone.
Backmatter replaces all running heads on both page parities. Align the
physical leaf once before resetting frontmatter numbering.

Shorten repeated exposition instead of reducing caption type. Keep the
consequence, necessary limitation and evidence provenance. Put breakable source
paths in `\protect\path{...}` within moving caption arguments. An exhibit plus
caption that cannot fit a page is a build error, not permission to crop it.

Run `check_book_caption_margins.py BOOK.pdf` with its matching converged `.aux`.
It checks the entire numbered caption inventory, including appendix tables and code;
missing, duplicated, wrong-side and overflowing captions fail. The shared PDF
check runner invokes it in hosted CI with the build's inventory sidecar.
For recorded floating exhibits it also checks caption-to-owner adjacency and
unscaled PGF picture width from shipped owner anchors. Use the registered
caption box for adjacency: PDF text extraction can merge an unrelated note
into a caption and create false overlap. Width is the maximum picture/wrapper
width, not a union of all positioned ink; hidden offsets and non-PGF overhang
still require actual-page inspection and the separate page-overflow check.
Non-floating tables and listings
currently receive caption-bounds checks, not owner-adjacency certification;
report those coverage counts separately. Deliberately detached captions and
overwide ink must be rejected by regression tests.
`caption-layout-fixture.tex` tests long, nested, moved, wide, unnumbered and
page-breaking and listing cases using the actual Book preamble. Passing placement says
nothing about the quality or correctness of the underlying diagram. Inspect
full pages for collisions with other marginalia as well.

Run `audit_book_layout.py BOOK.pdf --log BOOK.log --out REPORT.json` too. It
accounts for every registered margin object, checks missing/duplicate placement,
collisions and page bounds, and inventories large empty main-column bands on
**every page**. Whitespace flags require visual review: a part opener is not
the same as an accidental empty figure page. A safe margin is not, by itself,
proof that a caption is close enough to its drawing.

### Separate records

Keep three independent records: automated geometry checks; a named review of
meaning and final-page readability; the author's response. None implies the
next. Record the PDF hash, stable label, page, reviewer, observed defect,
disposition (`retain`, `rebuild`, `table`, `cut`) and unresolved risk. Changed
font metrics, content or geometry require fresh page review. Agent-simulated
reader feedback is not a human usability study or author approval.

Before generating a review proof, verify the requested font profile in the
actual PDF, not only the source configuration. For the purchased edition, run
the rendered typography tests with `BOOK_TYPOGRAPHY_FACE=SuisseIntl`; all four
Suisse text faces must be embedded and Source Sans 3 must not appear. Keep the
private font configuration search path when changing build output directories.
A fallback-font build invalidates pagination comparisons and must not be
presented as a layout improvement. Rebuild and regenerate every dependent
audit, inventory and proof from the matching PDF and auxiliary files.

The QA tools retain their legacy Boolean `pass` for machine compatibility;
it means automated checks only. Review sheets say **design unreviewed** and
do not present a green design verdict. Warnings stay visible.

Review every chapter, not only flagged fragments. Include quantitative plots
(units, scale, uncertainty, derivation), interaction diagrams (participants,
direction, ordering), state machines (guards, reachability), comparisons and
unlabelled inline exhibits. Preserve art plates and chapter/part openers.

## Initial redesign briefs — candidates, not accepted exemplars

| Stable identity | Reader question and claim | Relation and required evidence | Rejected form / counter-reading |
|---|---|---|---|
| `tab:bonded-custody-access` (legacy `fig:bonded-key-custody`) | What access does each attack require? The four attacks require different access. | Comparison: daemon private key; session key; email **and** passphrase; KMS complicity. Retain the same-user exclusion. | Four symbolic attack trees require a legend and falsely claim sufficient minimal cuts. A public witness signature is not a secret. |
| `fig:bonded-merkle-forest` | How does an inclusion check connect one note to the signed root? Reconstruct the session root, then the harbor root. | Provenance: one continuous path; 7 and 14 sibling hashes for 100 notes and 10,000 sessions. Keep the 736-byte calculation in adjacent prose. | Four separately numbered rows plus side notes and arithmetic obscure the one path. Inclusion does not certify truth of the note. |
| `fig:fh-sovereignty-fence` | Must Bob accept Alice's valid card? No: Bob has not trusted Alice's issuer key. | Interaction: Alice's agent presents a `db:write` card; Bob's daemon refuses it. This occurs **before** a transfer ceremony. | Five vocabulary boxes inside a fence repeat the definition. Do not depict this refusal as a completed transfer. |
| `tab:he-three-purchases` (legacy `fig:he-three-sided`) | How does Bob's purchasing choice change the seller's exposure? Compare the same refactor bought three ways. | Comparison: 400 cr fleet bounty and sub-bonds; 90 cr specialist rental and reputation; 0.5 cr/file skill fee conditional on settlement. Rental/licensing remain designed. | Rails, numbered badges and a separate hidden-information table falsely suggest a flow. These are alternatives, not cumulative payments. |

These briefs intentionally override the older atlas's flow prescription for
the economic comparison. Its separate discussion still explains conservation
and the three reputation keys; no information is silently redefined as geometry.

## Further sample inspected during the reset

These are direct observations of the Swiss renders in `.cache/qa-suisse-final`,
not reader studies or complete page approvals. All eight had cleared the
automated failure checks. This demonstrates why that result is inadequate.

| Exhibit | Observed issue | Next disposition |
|---|---|---|
| `fig-swk-marker-decay` | The curves, threshold and 29/59 ticks communicate the comparison. The long caption restates the graph and explains its construction. | Retain the measured plot provisionally; shorten the caption and inspect its final page. Not approved yet. |
| `legible-swarm-sdt` | “criterion” floats beside the dashed distribution rather than being directly attached to the vertical criterion; the false-alarm tail is very small while its label spans a large area. | Recompose annotations and distinguish the two error areas directly; keep the two-distribution comparison. |
| `fig-he-assurance` | Formula, reviewer-count labels, percentages and caption repeat the same calculation. The cost axis has no ticks; the log-risk axis has no tick values. | Rebuild with readable numeric axes and one encoding per fact. State the independence assumption without a paragraph beneath the plot. |
| `fig-stp-nomint-lineage` | The initial “1” has the same live-node style as the three descendants, but the printed live total 2.439 excludes it. Middle-column debit labels crowd the copy-fork panel. | Separate initial evidence from counted claims, check totals against the model, and give the panels real independent label space. |
| `fig-swk-workunit-machine` | State transitions, journal writes, numbered guards and a counterexample table compete in one exhibit. The “from any phase” bracket requires interpretation across these relations. | Split the lifecycle from the guard/counterexample comparison; do not just renumber the legend. |
| `fig-sealed-pillar-pipeline` | The work-order box almost touches the monitor, leaving no useful entry shaft. “From the fences” / “from gated release” do not visibly bind each lower property card to its producer. | Simplify the route and give property-to-mechanism/checker information an explicit aligned comparison. |
| `fig-anchor-handshake-ladder` | Multiline token expressions stretch the sequence vertically; a large shaded area and rotated offline sentence compete with the message flow. | Keep the sequence relation; separate token anatomy from the short messages and reduce the offline annotation. Check signature semantics against the protocol. |
| `legible-swarm-specialization` | Axes and regimes are visible, but the worked point is nearly on the boundary and the caption contains workshop commentary (“now filled and edged”). | Keep the quantitative comparison provisionally; make the point's decision legible and remove editorial history from the reader's caption. |

The atlas coverage check also found 54 current source figure identities missing
before this reset. The two newly rewritten diagrams now have rows; 52 others
remain uncovered. Do not weaken the coverage gate or mark them approved to
obtain a clean result.

## Review output

### Illustrated contents contract

Keep one complete contents, with the existing part art and each chapter's own
plate beside its title and summary. The image must be the same edition-specific
asset used by that chapter's opener and link to that chapter, not a generic part
thumbnail. Keep section/subsection titles and page links intact. Do not remove
the part spreads or chapter opener pages to make room for the contents art.

`textbook.json` supplies chapter identity to the shared contents renderer;
never hand-place eight unrelated images in generated contents. Missing plates
must fail the build. `build_book_contents_proof.py BOOK.pdf --out DIRECTORY`
matches all eight image digests in the actual contents, checks page bounds and
chapter destinations, and extracts the complete contents from that same Book.
It creates review pages, not independently typeset chapter PDFs. Open the
rendered pages; the tests do not judge composition.

### Editorial and reader-review contract

State the mechanism and its limits without repeatedly praising the argument as
honest, rigorous, sharp or complete. Preserve real assumptions, negative cases,
implementation status and uncertainty. An attractive example is not proof of
deployment; an observed case is not a universal result. Avoid stacking several
institutional or maritime metaphors before naming the actual operation.

Give short reading routes a question, first example, prerequisite, stopping
decision and resume point. Keep expert routes to definitions and proof. Persona
simulations can expose likely confusion, but their scores, follow-ups and
synthetic responses are not real interviews, measured comprehension or adoption
evidence. Do not claim independent reviews if delegation was blocked.

The current [24-persona review](BOOK-READER-REVIEW-2026-09-18.md) and
[language edit record](book-human-language-2026-09-18.json) document a targeted
pass across all chapters. They do not certify every page as edited or approved.

### Extracting exhibit pages

`scripts/harbor-research/export_book_visual_review.py BOOK.pdf --inventory FILE.json`
records every captioned figure/table, including inline source entries, as
unreviewed. Add `--output REVIEW.pdf` to extract their actual Book pages, or
`--labels LABEL ...` for a focused review. The PDF and `.aux` must be from the
same converged build. No chapter PDFs are produced. The inventory does not
promote anything to reviewed and does not replace inspection of uncaptioned art.
