# Margins that explain

The outer column is part of the argument. Put things there that a reader can
inspect: a small counterexample, exact values, a mechanism drawing, an annotated
specimen. It is not a parking area for prose displaced from the body. A caption
beside a body figure and a figure entirely in the margin are different elements.

## Choose a reading task

Name the owner paragraph and the question answered by looking sideways.

| Reader needs to… | Put in the margin | Keep in the body |
|---|---|---|
| Check a number | Exact-value table with units and denominator | Derivation and assumptions |
| Notice change | Sparkline or common-scale marks with named endpoints | What changes and why |
| Refute an overbroad claim | Smallest concrete counterexample | Corrected claim |
| Follow a local mechanism | Short sequence, cutaway or relation drawing | Full protocol and exceptions |
| Remember an abstraction | Clearly labelled physical analogy | Formal definition and analogy's limits |
| Compare many conditions | Explicitly identified local slice | Complete comparison at readable size |

Do not replace an unhelpful paragraph with an equally unhelpful box-and-arrow
diagram. A margin drawing need not miniaturize an existing body figure.

## Page contract

The Book currently has a 7-by-10-inch trim, 4.5-inch body column, 1.3-inch outer
column and 0.2-inch gutter. Verify the preamble before changing this. Keep the
purchased Suisse typography: these references inform composition, not a serif switch.

- Compose to the actual margin width. Preserve readable labels and visible arrow
  shafts. Simplify, split or move content that does not fit; never shrink it.
- Use one concise caption. Add a heading only if it provides information the
  caption does not repeat. For physical analogies, connect the depicted object
  directly to the book's mechanism: “Like our single-writer daemon, the platen
  handles jobs one after another.” Do not repeat the visible action as a title
  and then again as a caption, or append generic “the analogy concerns…” prose.
  Keep necessary technical qualifications where the claim is made.
  Avoid numbered all-caps phase labels, subtitle ladders, floating commentary
  and legends for obvious marks.
- Put qualifications beside evidence: analytic versus measured data; independence;
  finite horizon; bounded model check. Do not imply synthetic values are measurements.
- A body figure's caption starts beside its top and uses the whole outer column.
  Body text resumes below the figure, not below the end of a long caption.
  Move exposition out of captions; usually one or two sentences suffice.
- Terminal excerpts use the body column with a margin explanation. Wrap commands
  deliberately, rather than expanding across the margin.
- No illustration quota or uniform number of exhibits per chapter. Add evidence
  where it earns attention; crowding is not richness.
- Preserve the illustrated contents with chapter plates, two-page part openings,
  and left-page chapter openings without inserted empty versos.

## Implemented interfaces

### Source credits and authored sidenotes

The operator's September 2026 correction takes precedence over the earlier
numbered margin-citation design: moving an endnote list sideways does not
make useful marginalia. Ordinary sources use unnumbered author/date and work
title, beside the specific sentence. Global bibliography numbers stay internal.
For a substantive numbered note, use matching small, local superscripts only
when that explicit connection is needed; do not reuse global reference IDs.

An authored `\pdsourceaside{...\pdcite{key}}` may carry an independent example,
comparison or qualification. The source is part of that thought, not a second
box competing for space. Tangents must be useful and sourced; not every source
needs an essay. Full catalogue metadata remains in the archival source registry.

Prose-note acceptance includes first-baseline adjacency, not just fitting on
the same page. `audit_sidenote_baselines.py` exposes shifts caused by stacking.
Resolve them editorially or through page composition; never treat the allocator's
ability to squeeze everything above the footer as design acceptance.

Placement: website-v2/public/whitepaper/figures/pd-margin-layout.tex.
Reusable forms: figures/pd-margin-evidence.tex in that same directory.

~~~tex
\pdmarginexhibit{stable-id}{Short title}{
  % Native-size TikZ, compact tabular or image; no float environment.
}{What this establishes and where it stops.}
~~~

This registers title, content and caption as one measured object. The stable ID
and object number are written to the auxiliary file. Content uses
\marginparwidth; evidence drawings fail rather than auto-scale. Objects above
45% of text height fail for editorial reconsideration. That limit is not a target.

\pdevidencetable{column specification}{rows} supplies compact table spacing.
Align numeric columns and state units. Inspect the rendered result: a tabular can
overflow even if its enclosing box has the correct width.

\pdmarginanalogy{id}{title}{asset-stem}{caption} loads an inspected illustration
from plates/margin-evidence/ and fails on a missing asset. Print only the authored
caption; do not append production-method labels. Save exact prompt, model and
checksum alongside the image. Do not
generate graphs, audit records, historical portraits or product screenshots and
present them as observations. Mathematical and numerical evidence stays typeset.

Existing interfaces remain distinct:

- \pdgloss{Term}{definition} defines a term at first use; do not repeat the same
  gloss throughout a chapter.
- \pdmarginfigure{slug}{caption} is the legacy portrait/title-page interface.
  Missing images still silently disappear, so verify assets and clearance
  sidecars. At most one portrait per section, tied to substantive ideas.
- Normal figure/table/listing captions are intercepted by the Book apparatus.
  Do not manually position them with negative skips.

## Measure the finished Book

The allocator records anchors with zref-savepos, gathers measured boxes by
physical page, separates neighbours, and lifts the stack to keep it above the
footer. It fails if their total height exceeds the page. It does not reserve
caption-height blank space in the body.

Never resurrect source-time \pagetotal placement: a paragraph or float may move
after that value is read. Source-line distance and an absent “Marginpar on page”
warning are not safety evidence. An on-page note can still be too far from its
owner; adjacency needs its own check.

Boundary frames must not force a second page turn after an earlier settle has
already shipped the page. Reserve their opening lines with `\Needspace` and let
the breakable frame follow the page builder. A `\pagetotal` / `\pagegoal` guess
followed by `\newpage` stranded two-line continuations on otherwise empty pages
in the Book. Keep a rendered regression that locates those passages by text,
not by page number; check the following frame as well.

Use `pdrecitationbody` when long recall questions need the body measure. Never
wrap breakable body material in `\pdmargincolumnfalse` to borrow standalone
formatting: the page may ship while the flag is false, suppressing an already
registered margin object. The 21 September fifth proof lost an exercise pointer
this way even though caption checks passed. The dedicated body environment leaves
margin shipout enabled; registration/placement parity remains a separate gate.

Fragment lint must distinguish a caption beside a figure from one below it.
Cropping at the top of a margin caption can exclude the entire drawing and
produce an empty check. Verify the inspected region with a deliberately
overprinted label below that caption's top before trusting the lint result.

The preamble retains an old spill/scale branch for some other inline artwork.
That is not a recommended authoring feature. Captioned figures must fit the body;
new margin evidence fails rather than entering the shrink path.

## Acceptance

1. Record reader question, source/derivation, assumptions, owner paragraph and
   five-second reading test in docs/harbor-research/exposition/MARGINALIA-PLACEMENT.md.
2. Check arithmetic separately. A smooth curve does not prove its formula or
   denominator. Show useful negative controls alongside positive cases.
3. Build the **complete Book** to stable references in the selected font profile.
   Chapter PDFs are not acceptance evidence.
4. Run check_book_caption_margins.py, audit_book_layout.py and page_overflow.py on
   that exact PDF. Inspect registration/placement records for lost exhibits.
   Reject off-page images, footer intrusions, detached captions and collisions.
5. Open the pages at reading size, including neighbours. Check title wraps, table
   widths, arrow shafts and captions. Check grayscale when color separates cases.
   A passing geometry test does not certify a good drawing.
6. Record the actual scope inspected. Do not call a whole-book redesign finished
   after reviewing only the additions.

## Lessons from the supplied references

[Tufte CSS](https://edwardtufte.github.io/tufte-css/) keeps related text and images
close while separating optional notes from the main reading path. Responsive
toggles are a web solution, not a print rule.
[The RStudio handout](https://rstudio.github.io/tufte/) gives margin figures and
arbitrary margin content straightforward authoring interfaces. Borrow that
convenience, not automatic scaling or optional caption omission.

The attached pages suggest a wider vocabulary: mathematical counterexamples beside
propositions, lookup tables beside equations, cutaways beside spatial reasoning,
recognizable instruments beside analogies, and occasional large art plates.
These are observations of supplied excerpts, not claims to have read their books.
