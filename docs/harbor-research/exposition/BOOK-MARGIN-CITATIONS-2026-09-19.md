# Book sidenotes: editorial correction in progress

The operator rejected the numbered margin-bibliography design on 19 September
2026. Its source accounting passed; its reader-facing design did not. The
Book source now enables unnumbered citations by default, but the complete Book
has not yet passed the revised sentence-level baseline and editorial review.
Do not publish the previous numbered proof as the current accepted design.

## Reader-facing contract

- Every cited source appears beside the discussion, with a complete work title
  at first use and an identifiable author/year repeat thereafter.
- No public source numbers, either superscript body callouts or bold margin
  prefixes. Repeat author/date credits link to the first entry. Optional page or
  section locators survive. Several mentions of one source on the same physical
  page may share one margin entry; a different locator still gets its own note.
- Prefer quiet author/date and a complete work title, not catalogue furniture.
  Use normal bibliographic abbreviations, not tiny type. Reviewed first-use
  forms preserve titles and years and retain useful source links/locators.
  Full original metadata remains in the build registry, even where redundant
  commentary or long author lists are edited for the printed margin.
- Captions, portraits and evidence drawings keep their measured margin boxes.
  A citation inside one of those objects belongs inside that box, not in a second
  independently placed note. Citation height does not reserve blank body space.
- A source may belong to an independently readable comparison, example, or
  qualification. `\pdsourceaside{...\pdcite{key}}` keeps that thought and its
  credit in one measured margin object. Do not manufacture a tangent for every
  source or repeat the body paragraph in a smaller column.
- Align the first baseline with the owning sentence. Page bounds alone are
  insufficient. Crowded pages need editing or recomposition, not silent stacking.
- The printed end bibliography is suppressed in the current Book source;
  complete archival metadata remains in the generated source registry.

## Implementation

`scripts/generate-mega-whitepaper.mjs` emits
`mega-volume-margin-references.tex`, preserving the sorted bibliography's
numbers rather than confusing them with `mega###` allocation order. It fails
on a missing repeat form or a stale reviewed first-use edit.

`whitepaper/citation-shortform-overrides.json` holds source-keyed authored
exceptions. `build_cite_shortforms.py` applies them when generating both twins
and rejects an override whose source no longer exists.

`whitepaper/citation-margin-entries.json` holds bibliographically edited first
entries together with exact original metadata. Original text is the match key;
the recorded `mega###` is traceability, not authority to attach the edit to a
different work after reordering.

`website-v2/public/whitepaper/figures/pd-book-citations.tex` replaces both
`cite` and `pdcite` only in the Book candidate. It uses saved physical-page
positions, not source-time page counters. Contents/list replay emits no notes or marks.
Table width trials cannot consume first use or register invisible citation boxes.
The trial flag is scoped inside the discarded `tabularx` trial box; see the
[LaTeX tools source](https://github.com/latex3/latex2e/blob/develop/required/tools/tabularx.dtx).

The normal Book root enables `\pdEnableMarginCitations` before loading the
renderer. The production margin allocator still
rejects over-capacity pages. The separate, local `book-diagnostic.tex` driver
turns those errors into warnings solely to expose every offending page at once.
It is NOT an acceptance build and must never be published as the Book.

## Corrections discovered during migration

- Separate Locke's *Second Treatise* from *An Essay Concerning Human
  Understanding*: a reused local key had given the identity chapter the consent
  book's repeat title.
- Identify previously missing source forms and repair generic labels such as
  “Protocol”, “Group”, and an ISO identifier followed by a duplicated year.
- Restore the authors and 2026 date of the Bernoulli rate-distortion paper from
  [its arXiv record](https://arxiv.org/abs/2601.11919); do not use a different
  2025 research line as this work's publication year.
- Move the competitive-insurance contributor note out of a moving heading;
  cite its sources in the discussion, not in the contents/bookmark replay.
- Shorten duplicated table-caption explanations and long recall prompts where
  they compete with citations, without dropping the mathematical qualification.
- Keep the first author when a partially expanded author list ends in et al.;
  the old parser credited Zhuang instead of Zheng for the MT-Bench paper.
  The named authors and 2022 revision of the Stanford Hobbes entry are now
  recorded rather than crediting its host encyclopedia as an unnamed author.
- Retire Spawn's duplicate end-of-chapter source inventory after proving all
  41 sources are cited elsewhere in that chapter; retain its reproducibility
  instructions. Its four estimator-table marks also duplicated the immediately
  preceding source-bearing discussion. No distinct source was removed.
- Suppress the generic Thesis margin tag in both shared pedagogy files without
  deleting the prose. A meaningful authored margin claim remains an option.
- Correct the verification reading guide's TLS/Tamarin attribution and the
  Economy guide's overbroad inference from FLP; see primary sources in the
  external handoff. Editorial source redistribution must not preserve a known
  false claim merely to keep the original page count.

## Verification and restart

### Fresh-build convergence

Do not put another Book build directory on the TeX search path. It can supply
an old, same-named `.aux` file and silently seed unrelated page positions.
Only source/asset paths belong there. A reused successful PDF is not evidence
that a fresh build works.

Prepare the purchased-font configuration separately with
`scripts/prepare-book-fonts.py`. This migration's clean proof uses
`.cache/book-margin-citations-20260919/font-config/`, containing only the font
configuration and its hash receipt. Removing the old build search path without
replacing that configuration selected Source Sans, not Suisse, and produced
four real capacity failures in the alternate face. Do not "fix" Suisse pages
using an unlabelled alternate-font render. Never copy the font binaries into
the repository or preview directory.

Same-page citation sharing reserves an allocator ID even when it emits no
second note. The reserved slot has no height, box or printed ink. Otherwise
every later margin object changes identity between the first and second passes.
The two-page `stable-slot-fixture.tex` proves IDs 3 and 5 remain 3 and 5 before
and after the repeated source shares its entry.

Capacity is judged after the auxiliary file has settled, using the documented
[LaTeX afteraux hook](https://tug.ctan.org/macros/latex/base/lthooks-doc.pdf).
An intermediate pass records `PD-MARGIN-CONVERGENCE: pending`; it cannot be an
accepted PDF. A stable overfull page still raises a fatal package error. The
citation auditor rejects pending geometry, and `build-whitepapers.sh` refuses
to copy such a PDF to the publication destination even if the renderer reaches
its rerun limit. The deliberately overfull fixture still rejects; the valid
stable-slot fixture completes and accounts for all four actual margin objects.

`audit_book_citations.py` checks every occurrence, full-entry uniqueness,
registered/shipped objects, physical-page capacity, and named PDF destinations.
Its `--measurement-only` mode explicitly does not certify placement.
`test_audit_book_citations.py` constructs missing-occurrence, lost-first-use,
unplaced-box and over-capacity counterexamples.

The six-page actual-preamble proof preserves 12 citation occurrences, four
embedded sources and eleven margin objects: occurrence 3 shares its earlier
source on page one. A separate table proof has three occurrences and two margin
objects, proving that width trials and the repeated mark create no ghost notes.
Missing-source and overfull-margin fixtures must still reject.

Full-build outputs and current audit queue:
`.cache/book-margin-citations-20260919/` in the canonical Book workspace.
The adjacent external handoff and selected-page preview, under the conversation's
visualizations directory, record the exact final inspection scope. Passing the
small proofs or source accounting alone does not finish the Book migration.

## Revised acceptance: baseline adjacency

`audit_sidenote_baselines.py` checks the allocator's recorded first-baseline
displacement independently of capacity. It rejects absent measurements,
unconverged geometry, and displacement in either direction above 1pt. The
first baseline is measured from a shipped paragraph marker, not a guessed
font ascent or vtop height (which can be zero after color/link whatsits).
The current allocator still moves collisions; this audit makes that debt
visible rather than certifying it as acceptable. Whole-Book remediation remains.

First edited example: the generative-agents paragraph in
`agent-transactions-whitepaper.tex` now keeps the evidence/recovery argument in
the body and places the simulated-party example in an authored sidenote.
Four source credits (Park, Rao/Georgeff, Dennis/Van Horn, Birgisson) use quiet
author/date and complete titles. The other first-use credits still need review.

The complete unnumbered Suisse build retains 281 sources/553 occurrences over
682 pages. All 1428 margin objects ship, 231 caption bounds and 191 recorded
floating-owner adjacency checks pass, and no page-edge loss, text collision or
footer intrusion is detected. Nevertheless, 293 of 542 measured prose notes
are displaced by more than 1pt, on 112 folios. This is a failed editorial
adjacency gate, not a finished migration. The next pass must address the
source-bearing passages and shorten/group credits without losing attribution.
Two table captions exposed by reflow (4.7/4.8) were shortened and their actual
pages inspected. No publication occurred.
