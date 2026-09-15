# Margin Apparatus: Sidenotes, Margin Figures, Full-Width, and the Measure

Tufte's own books are laid out with a narrow text column and a wide outer margin
carrying notes, small figures, and dates — the reader never leaves the page to
consult a note. This file covers how `tufte-latex` implements that, and, more
important for this repository, exactly how the Book already implements it and
where it does not yet.

## 1. How tufte-latex implements it (upstream reference)

Source: https://github.com/Tufte-LaTeX/tufte-latex — `tufte-common.def`,
`tufte-book.cls`, `sample-book.tex` (fetched directly this pass; see
`references/sources.md`).

**Geometry** (Letter default): a 26-pica (~4.33in) text column, a 2-pica
`\marginparsep`, and a 12-pica (~2in) `\marginparwidth` — the margin column is
roughly half the width of the text column, wide enough for a full sentence or a
small figure. Base type is 10pt on 14pt leading; margin type is smaller
(`\footnotesize`).

**Commands**:
- `\sidenote[num][offset]{text}` — a numbered note, printed in the margin at
  (approximately) the line where it's called, not at the foot of the page. The
  optional `offset` (a length, often a negative multiple of `\baselineskip`)
  hand-nudges vertical placement when LaTeX's automatic placement collides with
  another note.
- `\marginnote[offset]{text}` — the unnumbered form: an aside with no
  superscript marker in the body text.
- `\begin{marginfigure}[offset] ... \end{marginfigure}` /
  `\begin{margintable}[offset] ... \end{margintable}` — a figure or table
  environment scoped to `\marginparwidth` instead of `\textwidth`.
- `\begin{fullwidth} ... \end{fullwidth}` — expands a block across the text
  column AND the margin column, for a wide table, a long quotation, or a figure
  that needs the full page width. `figure*` / `table*` are the float-numbered
  equivalent.

**The measure**: `tufte-latex`'s 26-pica column at 10pt is chosen to land in
Bringhurst's recommended 45–75-characters-per-line range for body text — the
margin column is not there to widen the measure, it exists so annotation never
interrupts the primary reading column's width or rhythm.

## 2. How this repository's Book implements it (read directly this pass)

Two files carry the apparatus:

### `website-v2/public/whitepaper/coordination-papers-mega-volume-preamble.tex`

Sets the geometry directly (not via tufte-latex; this is a hand-rolled
equivalent using `geometry`, `marginnote`, and a custom overflow hook):

```
\geometry{paperwidth=7in,paperheight=10in,left=0.8in,right=1.7in,
  top=0.85in,bottom=0.95in,textwidth=4.5in,marginparsep=0.2in,marginparwidth=1.3in}
```

A 7×10in trim, 4.5in text column, 0.2in `marginparsep`, 1.3in `marginparwidth` —
proportionally close to tufte-latex's ratio (margin column is roughly 29% of the
text column here vs. tufte-latex's ~46%, i.e., this repo's margin column is
narrower relative to the text — it fits a portrait or a short note, not a long
sidenote paragraph). `\pdfullwidth` is defined as
`\textwidth + \marginparsep + \marginparwidth` (line ~788) — this repo's
equivalent of `fullwidth`/`figure*`.

A `pgfsys@typesetpicturebox` hook (lines ~789–817) makes full-width promotion
**automatic** for any TikZ picture: a picture wider than `\linewidth` is
typeset across the full `\pdfullwidth` if it fits, or scaled down and logged
with a `PackageWarning` if it's still too wide. This is stronger than
tufte-latex's manual `figure*` — a chartwork author never has to remember to
declare full width; an over-wide figure gets it for free and leaves a build-log
trace (the repo-root script `scripts/harbor-research/page_overflow.py` <!-- phantom-ok -->
reads that trace, per its own header comment — see the `harbor-chartwork` skill).

### `website-v2/public/whitepaper/figures/pd-pedagogy.tex` (and its byte-identical
twin `whitepaper/figures/pd-pedagogy.tex` — checked by the repo-root test
`scripts/generate-mega-whitepaper.test.mjs` <!-- phantom-ok -->)

Defines the pedagogic apparatus. Every macro below renders into the margin
column unconditionally: there is one margin system, and the Book is the only
artifact that renders it. There is no second, in-column form to fall back to
and no switch selecting between them — `\ifpdmargincolumn` and its eighteen
branch sites were removed once the standalone A4 chapter PDFs were retired. A
device that cannot fit a particular page's column still says so itself (see
`\pdmargincaption` and `\pdsidenote` below); that is a per-page fit decision
inside the one system, not a second rendering mode:

- **`\pdmarginfigure{slug}{caption}`** (implemented, verified by direct read) —
  a duotone portrait or plate. Looks for `plates/marginalia/<slug>.jpg`; if the
  file doesn't exist, it silently no-ops (`{}`) rather than erroring, so a
  chapter can call it speculatively. In the margin column it places a
  `\marginpar` sized and raised so the image top aligns with the calling line;
  outside the margin column (standalone chapters) it does nothing — **there is
  no fallback inline image**, so a standalone-chapter build simply loses the
  portrait, which is why `MARGINALIA-PLACEMENT.md` calls itself "Book only."
  Only a slug that resolves to a real file under `plates/marginalia/` is a
  PORTRAIT in the sense the "one per section" rule below means — the Book's
  margin column is meant to be used generously, not sparingly, and the same
  macro also carries small multiples, sparklines, and regime strips in the
  margin, which face no such quota; only the person/idea portraits and title
  pages under `plates/marginalia/` are rationed one per section.
- **`\pdgloss{Term}{one-line definition}` is now implemented** (read directly
  this pass, added alongside `\pd@marginglyph` in the "Shared helpers"
  section). It sets `Term` bold at its point of definition in the running
  text — the Book's convention for a term of art — and carries the definition
  itself as a margin note: in the Book, one combined `\marginnote` holding a
  small-caps repeat of `Term` above the definition, at the same
  `\marginfont` (`\footnotesize`) sidenote size every other margin note in
  the file uses; outside the margin column (a standalone chapter build) the
  definition folds back into the sentence as an italic parenthetical, so no
  content is lost either way. It deliberately does not call
  `\pd@marginhead` and a separate `\marginnote` back to back — two
  independent margin boxes issued at the same source line would risk
  colliding, exactly what `\pdmarginfigure` avoids by building one combined
  box for its image and caption — so `\pdgloss` reuses `\pd@marginhead`'s
  small-caps head convention inline inside a single `\marginnote` call
  instead. No box, no rule. Call it as `\pdgloss{Stigmergy}{coordination
  through traces left in a shared environment rather than direct messages.}`
  at each house term's first use in a chapter — the programme is a gloss at
  the first use of EVERY term of art, so one chapter is expected to carry
  many `\pdgloss` calls, one per term; the defect is glossing the SAME term
  twice, not glossing more than one term (see `scripts/margin_lint.py`,
  which checks this and also checks that a glossed term is not a stranger
  to the chapter's own running prose).
- **`\pd@marginhead{label}`** — the shared primitive behind `\keyidea`,
  `\pitfall`, `\scene`, `\xrefbox`: a small-caps label in the margin. This is the closest existing thing to a
  "sidenote head" and is the right macro to extend if `\pdgloss` is ever added
  — it would likely be `\pd@marginhead{Term}` plus a `\marginnote` body.
- **`\pdrecitation`, `\pdexercise`/`\pdSolution`, `\pdsession`** — margin-column
  pointers for retrieval prompts, exercise solution page numbers, and (for
  `\pdsession`) a full-width transcript block (`\pd@sessionwidth` adds
  `\marginparsep+\marginparwidth` to `\linewidth`, always).
  These are the repo's other full-width and margin devices beyond figures.
- **`\pdboundary`** — the "Where this stops" honest-limit box: a left ink bar,
  no fill, head in the margin. This is where doctrine 11 (Snow's cholera map:
  praise the design and name its assumption) should land structurally in a
  chapter — a `pdboundary` block naming a figure's own simplifying assumption.

### Net comparison to upstream tufte-latex

| Feature | tufte-latex | This repo's Book |
|---|---|---|
| Sidenote (numbered, inline) | `\sidenote` | `\pdsidenote{text}` — a superscript number in the text, the note in the margin (Book); exactly `\footnote` in a standalone chapter |
| Unnumbered margin note | `\marginnote` | `\marginnote` (same package, used directly and via `\pd@marginhead`) |
| Margin caption | `\sidecaption` (sidenotes pkg) | `\pdmargincaption[anchor]{claim}` — replaces `\caption` inside a float; the float keeps the text column, the caption rides the margin; exactly `\caption` in a standalone chapter |
| Margin figure | `marginfigure` env | `\pdmarginfigure{slug}{caption}` — a portrait/plate when the slug is keyed to `plates/marginalia/`, otherwise a small multiple, sparkline, or regime strip; only the former is rationed one per section |
| Margin table | `margintable` env | not implemented |
| Full width | `fullwidth` env / `figure*` | `\pdfullwidth` length + automatic TikZ promotion hook; `\pdsession` computes its own full width |
| Measure | 26pc text / 12pc margin (~46%) | 4.5in text / 1.3in margin (~29%) |
| Short gloss/definition | none built in | `\pdgloss{Term}{one-line definition}` — bold term in text, definition in the margin (Book) or a parenthetical (standalone) |
| Short-form citation | short forms in the sidenote | `\pdcite{key}` + the generated `figures/pd-cite-shortforms.tex` table — **margin copy currently suppressed**, see §3.3 |

## 3. What belongs in the Book's margin, in priority order

This is the prescriptive section. It replaces an earlier version of this file
that treated portraits and glosses as the apparatus and captions, notes and
citations as things that happened to live in the column.

### 3.0 The measurement that forced the rewrite

Counted directly over the eight chapter sources named in
`whitepaper/textbook.json`, TeX comments stripped first (the counting script is
five lines of `re.finditer`;
`scripts/harbor-research/captions_to_margin.py --check --json` <!-- phantom-ok -->
reports the caption and footnote halves of it):

| In the margin | calls | In the text column | calls |
|---|---:|---|---:|
| `\pdmarginfigure` (all 10 resolve to a portrait plate) | 10 | `\caption` | 61 |
| `\pdgloss` | 0 | `\footnote` | 9 |
| | | `\pdcite` / `\cite` at the point of use | 519 |

Ten portraits and no glosses in the margin; 589 captions, notes and citations
in the column. Tufte's books run the other way round, by roughly the same
factor. That inversion is the defect this section exists to prevent
recurring — not the presence of the portraits, which are fine, but their
having been the *whole* apparatus.

The order below is the order of first claim on the margin column. When two
kinds want the same vertical band, the one higher in this list wins and the
lower one moves or is dropped (`\pd@placemarginopt` already implements
"dropped" for the second-copy devices).

### 3.1 Figure, table and listing captions — the default, not the exception

**Rule.** A caption goes in the margin. Write `\pdmargincaption{...}` where
you would have written `\caption{...}`; the float itself stays in the text
column at full measure, and the caption sits beside it in the margin.
`scripts/harbor-research/captions_to_margin.py` <!-- phantom-ok --> performs and re-checks the
conversion mechanically, so a new float that reaches for `\caption` is a lint
finding, not a style preference.

**The anchor argument.** `\pdmargincaption` takes an optional anchor:

- `top` (the default) for a caption written at the float's top — after
  `\begin{table}[H]` and an optional `\centering`/`\small`/`\arraystretch` and
  nothing else. The margin block hangs downward from that line, running down
  the margin beside the table. No page position is read, so nothing about it
  can be stale. 38 of the Book's 54 convertible captions are this shape.
- `foot` for a caption written *below* its content — the three
  `\begin{figure}[H]` captions that follow their `\includegraphics`, and every
  table whose `\caption` sits after the `tabular`. The block is raised by its
  own measured height so its last line lands on the caption's line and it runs
  *up* the margin beside the content. The raise is a box measurement, not a
  page measurement, so it is exact. 16 captions are this shape.

The converter decides the anchor by looking at what sits between the float's
`\begin` and its `\caption`; do not set it by hand unless you are writing a
float whose shape the converter misreads, and if you are, fix the converter.

**When a caption stays in the column.** Three cases, and only three:

1. **A full-bleed plate.** A float that reaches past the text column —
   `\pdfullwidth`, an `adjustwidth` that cancels the margin, `\paperwidth`, an
   `\AddToShipoutPicture` — has no margin beside it to put a caption in. Its
   caption stays a `\caption` under the plate.
2. **A `longtable` / `xltabular` caption.** That `\caption` is longtable's own:
   it must sit in its own row followed by `\\`, and it heads a table that spans
   pages. One margin block beside page one of a three-page table points at the
   wrong content. Seven of the Book's 61 captions are these.
3. Nothing else. "It is a long caption" is not a case — see the next
   paragraph.

**The measured end state — do not "finish the job".** After the conversion the
eight chapters hold **7** `\caption` calls and 54 `\pdmargincaption` calls, and
all 7 of those residuals are case 2: the `xltabular` status tables in
`anchor-protocol` (1), `legible-swarm` (1), `spawn-to-person` (2),
`harbor-economy` (1), `agent-transactions` (1) and `federated-harbor` (1).
Case 1 has zero instances in the chapters as of this pass. None of the 7 was
skipped for an incidental reason — not a pattern miss, not a parse failure —
so there is no residue to mop up later. Converting any of them would put one
margin block beside page one of a table that spans three pages, which is the
defect the carve-out exists to prevent. `margin_lint.py` and
`captions_to_margin.py` agree on this set by construction: the lint imports
the converter and asks it which captions are eligible rather than re-deriving
the rule, so the two can never drift apart.

Note that the "16" in the `foot` bullet above counts captions that *move
position* within their float, not captions left in the column. The two numbers
are easy to conflate; the in-column residual is 7.

**What a margin caption must contain.** The *claim*, as a sentence, per this
skill's own checklist: "X stays flat until Y crosses Z, then rises linearly"
and not "Figure 3: X vs Y". The Book is already mostly right about this — 54 of
its 61 captions open with a claim sentence — and the handful that do not
(`How the harbor economy sits relative to the nearest prior art on each axis.`,
`What the commons borrows from each prior body of work, where it departs, and
why.`) are noun phrases naming a subject rather than sentences making a claim.
Those are the ones `margin_lint.py`'s `caption-states-a-claim` rule flags.

**The width discipline is the point, not a side effect.** The margin is 1.3in,
which is about 23 characters a line at `\marginfont`. A caption that was
comfortable at 4.5in becomes visibly long at 1.3in, and that is the mechanism
doing its job: a five-line full-measure caption restating what the drawing
already labels is a caption that was never edited, because nothing was pushing
back on it. Do not widen the margin to fit the caption; cut the caption. The
one thing you may not do is move it back to the column.

### 3.2 Sidenotes replacing footnotes

**Rule.** Every `\footnote` in a chapter body becomes `\pdsidenote`. The reader
never leaves the page to read a note. `\pdsidenote` sets a superscript number
in the running text and the note itself in the margin beside the line that
called it; outside the margin column it is exactly `\footnote`, so the
standalone chapter PDFs keep their foot notes unchanged.

**The one exception**, and it is real rather than a hedge: a note with no line
of running prose to sit beside. A margin note anchors to the line that issued
it, so a note issued from inside a float, a `longtable`, a `tabular`, a
listing/verbatim block, or a **section-family heading's title argument**
anchors to that box and points the reader at the wrong content. The heading
case is the one the Book actually contains: the bonded-commons chapter carries
`\subsubsection{Competitive-Insurance Pricing Mechanism\protect\footnote{This
subsection contributed by Thomas Youle...}}`. A heading title is a moving
argument — it is written to the `.toc` and the `.aux` — and a margin device
expanded there does not merely look wrong, it ends the build: converting it
produced 100 `Missing \endcsname inserted` errors and a 360-page torso of the
549-page Book. That is also the right editorial answer independently, because
a heading's margin line already belongs to `\pd@marginhead`, and because the
note attaches to a *section*, not to a sentence. Eight of the Book's nine
footnotes convert; that one stays a footnote.

**Why `\pdsidenote` is top-anchored.** The Book's footnotes run 90 to 400
characters, which is 8 to 18 lines at `\marginparwidth`. That is a tall block,
and a sidenote is called mid-sentence where `\pagetotal` is stale by the lines
of the current paragraph. This file's own rule (see "Where a margin block is
anchored" below) is that a tall block does not compute an upward offset from a
number it cannot trust. `\pdsidenote` therefore goes through
`\pd@placemargintop`: no raise at all, so no stale page position can lift it
off the paper, with the foot clamp and occupancy caps still applying downward.

### 3.3 Short-form citations at the point of use

**Rule.** A citation is `\pdcite{key}`, never a bare `\cite{key}`, and the
short form ("Lamport 1978") belongs in the margin beside the clause that cites
it while the full entry stays in the back matter.
`scripts/harbor-research/promote_cites.py` <!-- phantom-ok --> already promotes every eligible
`\cite` to `\pdcite`, and `build_cite_shortforms.py` already generates the
per-key short-form table. 513 of the Book's 519 point-of-use citations are
already `\pdcite`.

**Eligible excludes the margin itself, including the margin twins.** A `\cite`
inside `\caption`, `\footnote`, a heading, the bibliography, or another margin
device's own argument is not eligible, and neither is one inside
`\pdsidenote{...}` or `\pdmargincaption{...}` — they are the same note and the
same caption, set in the column rather than at the foot or under the float.
This matters when you move apparatus: converting a `\footnote` that contains a
citation into a `\pdsidenote` does not make that citation newly promotable, and
if the promoter's protected list knows only the in-column names it will say it
did. Four citations came loose exactly that way on the commit that moved the
footnotes, and `promote_cites.py --check` — correctly — went red.

**Standing defect, stated so nobody re-derives it.** `\pdcite`'s margin copy is
currently *switched off* in `figures/pd-pedagogy.tex`: the macro emits the
`\cite` and then `\relax`. The reason is recorded there and is not a
disagreement with this rule — it is an allocator problem. There are 505 of
these calls, all issued mid-sentence, and every placement decision in that file
is arithmetic on `\pagetotal`, which mid-paragraph is stale by however much of
the paragraph has been set. The notes printed on each other 132 times and off
the paper 7 times on the merge that brought them in.

The fix on record is `\marginpar` rather than better arithmetic: `\marginpar`
stacks notes in reading order, never overlaps, and never runs off the foot,
and it has to own the whole column to do it — a `\marginnote` block is
invisible to the page builder, so a mixed column collides by construction. That
conversion is a separate piece of work with its own fixture
(`website-v2/public/whitepaper/margin-apparatus-fixture.tex`, whose real cases
live at `tests/harbor-research/fixtures/margin-apparatus-fixture.tex`). Until
it lands, the short-form table and its freshness check stay exactly as they
are, and **the margin caption work does not make this worse**: a margin caption
is issued inside a float box, in vertical mode, and computes no page position
at all, so it is not another client of the arithmetic that failed.

### 3.4 Small explanatory graphics

**Rule.** A graphic whose only job is to explain the sentence beside it belongs
in the margin, not in the column. A graphic the argument turns on belongs in
the column. The test is whether the reader who skips it loses the argument or
only loses a confirmation.

**The size envelope.** The margin column is 1.3in wide (93.6pt) and the text
block is 8.2in tall, so the hard ceiling is 1.3in × 8.2in and the useful
ceiling is much lower, because a margin graphic that is taller than the
paragraph it explains has stopped being marginal. In practice:

| Kind | Size | Notes |
|---|---|---|
| Sparkline | ~1.3in × one line (≈13pt) | Set inline in the sentence or table cell, at word size (doctrine 4). If it needs its own row it is a chart. |
| Regime strip | ~1.3in × 0.25–0.4in | One horizontal band, regimes direct-labelled, no axis. |
| Small multiple grid | ~1.3in × up to 1.5in | 2×2 or 2×3 at most at this width; same scale and frame across panels (doctrine 3). More panels than that means the column, not the margin. |
| A single 2cm explanatory plot | ~1.3in × 0.8in | One series, direct-labelled, no legend, no gridlines. |

Anything wider than 1.3in is not a margin graphic. Do not scale a column
figure down to fit — a figure that is only legible at 4.5in is illegible at
1.3in, and `references/critiques-and-limits.md` §Accessibility is explicit that
shrinking is not a free operation. Redraw it smaller with fewer marks, or leave
it in the column.

That envelope is enforced, not merely advised: `margin_lint.py`'s
`margin-graphic-fits` rule reads the declared width of any `\includegraphics`
or `tikzpicture` inside a margin device's argument — resolving a `\textwidth`
or `\linewidth` fraction against the Book's 4.5in measure — and fails a
chapter that declares anything wider than the 1.3in `\marginparwidth`. It
checks what the SOURCE declares; a graphic whose *natural* size exceeds its
declared width is the rendered-figure checkers' business, not this rule's.

**Mechanism.** `\pdmarginfigure{slug}{caption}` carries these as well as
portraits; a slug that does not resolve under `plates/marginalia/` is by
construction not a portrait and faces no quota. There is no per-section limit
on small multiples, sparklines or regime strips in the margin — the Book's
margin column is meant to be used generously.

### 3.5 Glosses — first use only

Unchanged from the previous specification, and still correct.
`\pdgloss{Term}{one-line definition}` at the term's first use in a chapter,
one per term, many per chapter; never the same term twice
(`margin_lint.py`'s `gloss-not-repeated`), and the term must appear in the
chapter's own running prose (`gloss-term-in-prior-prose`). A gloss repeated at
every mention crowds the column and stops meaning anything special the second
time.

The Book currently has **zero** `\pdgloss` calls across all eight chapters. The
macro exists and the lint rules exist; the calls do not. That is a real gap,
but adding one is an editorial decision about which first use carries the
argument, so it is not something this file's converter will ever do
mechanically.

### 3.6 Portraits — rationed, and last

Unchanged in its rules, changed in its standing. A portrait is the **last**
claim on the margin, not the first. At most one PORTRAIT per `\section` (a
`\pdmarginfigure` slug that resolves to a real file under
`plates/marginalia/<slug>.jpg`), the plate must be cleared (no
`.NOT-CLEARED.json` sidecar), the person's *idea* — not just their name — must
carry the sentence it is anchored to, and a bibliography-adjacent mention is
explicitly not a home. `docs/harbor-research/exposition/MARGINALIA-PLACEMENT.md`
records the ten placements and the two held back (Lovelace: no anchor; Coase:
no cleared image and no citation).

What changes is precedence. When a portrait and a caption, a sidenote, or a
short-form citation want the same band of margin, the portrait moves. A
portrait is a garnish on an apparatus; it is not the apparatus. A chapter whose
margin carries portraits and nothing else has an empty margin apparatus with
decoration in it, which is what `margin_lint.py`'s `margin-carries-the-caption`
rule measures.

## 4. Where each Book chapter should carry marginalia — the placement record

`docs/harbor-research/exposition/MARGINALIA-PLACEMENT.md` (read directly this
pass) is the standing, lead-approved-pending proposal for `\pdmarginfigure`
placement. As of this pass:

- **Placed/proposed** (one portrait per section, per the "at most one PORTRAIT
  per section" rule in `HANDOFF-TEXTBOOK.md` §4 — the quota is on the person/
  idea plates under `plates/marginalia/`, not on `\pdmarginfigure` calls in
  general; small multiples, sparklines, and regime strips in the margin are
  unlimited): Lampson and Wonham in *The
  Single-Writer Kernel* (two different subsections of the same section — flagged
  as a soft conflict the lead should resolve); Lamport (anchored to a weaker but
  still genuine citation to avoid doubling up with Wonham); Ostrom and Aumann in
  *The Bonded Commons*; Parfit in *From Spawn to Person*; Hobbes and Scott in
  *The Legible Swarm* (two portraits, different sections); Shannon in *The
  Legible Swarm* (a third); Wald in *The Sealed Harbor*.
- **Held back**: Lovelace (no chapter cites her — no anchor to attach a portrait
  to) and Coase (image not cleared AND no citation in `harbor-economy.tex` to
  caption even if it were).
- **What kind of marginalia belongs where, going forward**: a `\pdmarginfigure`
  is textually justified only where the person's *idea*, not just their name, is
  doing real work in the surrounding paragraph — a bibliography-adjacent mention
  (Ostrom's stray citation in `harbor-economy.tex` line 2315) is explicitly
  rejected as a home. When adding a new chapter's marginalia, search the chapter
  source for the surname first (as this proposal did), confirm the sentence
  actually depends on the cited work's substance, and check it isn't the second
  portrait in the same section.
- **Where `pdboundary` (not a portrait) should go**: `READING-FLOW-AUDIT.md`'s
  finding F5 names five body runs of more than four pages with nothing to look
  at in chapter 7 and two in chapter 8 — these are reading-flow failures, not
  marginalia gaps, and the fix on record is sessions and figures (a `pdsession`
  transcript or a redrawn figure), not a portrait. Don't reach for
  `\pdmarginfigure` to fix a "wall of text" finding; that's what `pdboundary`,
  `pdexample`, and `pdsession` are for.
- **Where a gloss/definition margin note (`\pdgloss`, now implemented) would
  help most**: chapters that introduce a term of art mid-paragraph and never
  define it in the margin today — this is a real, still-open gap; `\pdgloss`
  now exists to fill it, but adding a call to any given chapter is an
  editorial decision for the lead, not a mechanical one, since it means
  picking the one first use where the term carries the argument the way `MARGINALIA-PLACEMENT.md`
  picked each portrait's home.

## 4. Practical checklist for adding marginalia to a chapter

1. Find the sentence the term carries (not just a name-drop) — search the chapter
   `.tex` for the surname or term, as `MARGINALIA-PLACEMENT.md` did.
2. Check the "at most one PORTRAIT per section" rule before adding a second
   portrait (a `\pdmarginfigure` slug that resolves under `plates/marginalia/`)
   to a section that already has one — this quota does not apply to a small
   multiple, sparkline, or regime strip in the margin, which the Book is free
   to use as often as the material calls for. Even so, two margin figures of
   any kind placed within about a dozen source lines of each other are likely
   to collide on the printed page; `scripts/margin_lint.py` flags this as
   advisory, but the actual gate is the Book build log's "Marginpar on page"
   count.
3. Confirm the plate is cleared (`plates/marginalia/<slug>.jpg` exists, no
   `.NOT-CLEARED.json` sidecar) before writing `\pdmarginfigure{slug}{...}`
   for a portrait.
4. Write the caption as one sentence that states why the idea matters *here*,
   not a biography — match the register of the existing captions in
   `MARGINALIA-PLACEMENT.md`.
5. For a defined term rather than a person, use `\pdgloss{Term}{one-line
   definition}` at the term's first use — not `\pd@marginhead{Term}` by hand.
   A chapter may carry many `\pdgloss` calls, one per term; the rule
   `scripts/margin_lint.py` enforces is not glossing the SAME term twice, and
   that a glossed term actually appears in the chapter's own running prose,
   not only inside the gloss call itself.
6. If the finding is "too much text, no visual" rather than "an uncredited
   idea," reach for `\pdsession`, `\pdexample`, or a redrawn figure — see
   `references/web-application.md` and `skills/harbor-chartwork`, not this file.

## Where a margin block is anchored, and why it differs by kind

Every margin device computes its vertical offset from `\pagetotal`, which is
the truth about the page TeX is *currently filling* — not necessarily the page
the block prints on. When a block is issued in a paragraph that then breaks to
the next page, the offset is measured against one page's geometry and applied
on another. That is not a bug in any one device; it is a property of the
information available at macro time, and it is why the anchoring choice is a
per-kind decision rather than a house default.

**Foot-anchored** (`\pd@placemargin`: `\pdgloss`, `\pdprov`, `\pdprovedon`,
the Recall blocks). The block is raised so its *last line* sits on the line
that issued it. This is right for a note read beside its sentence: a gloss
belongs level with the term it defines, and a citation short-form level with
the clause that cites it. The raise is the block's height less one line, so
for the two- or three-line notes these devices produce it is small, and being
wrong about the page costs a few points of drift.

**Top-anchored** (`\pd@placemargintop`: `\pdmarginfigure`). The block's *top*
sits on the issuing line and it extends downward. A portrait has no reading
relationship with the citation line that needs its last line level with it —
"beside the paragraph" is the whole requirement — and its height is 100 pt or
more, so the raise a foot anchor would compute is large enough that being
wrong about the page puts the block off the paper entirely. Ostrom's portrait
printed with 88 pt of its 117 pt above the top of p. 343 for exactly this
reason: issued after `\paragraph{Commons governance.}`, whose paragraph began
the following page.

**The rule.** Do not compute an upward offset from `\pagetotal` for a block
tall enough that being wrong about the page matters. Top-anchoring satisfies
this by computing no raise at all. A clamp does not: a clamp is arithmetic on
the same untrustworthy number, so bounding the result into `[0, printable
height]` re-derives the fault it is meant to prevent. This was tried — a
shared clamp applied to both placements put the same portrait back off the
page, at y = −65.4 — and reverted. Height, not kind, is the criterion: a new
device that sets a tall block belongs on the top anchor whatever it contains.

Both placements share the occupancy bookkeeping (`\pd@lastheadbottom`,
`\pd@blockbottom`) and both record where their block came to rest, so a later
block steps below it. In the top-anchored path the foot clamp may never reduce
the offset below `\pd@blockfloor`, the position the occupancy caps established:
reducing past it re-collides the block with whatever it was just moved clear
of, which is the failure that produced 132 collisions on one merge. A block
too tall to satisfy both is left at the floor and overruns the foot, where
`page_overflow.py` reports it — a measured overrun is worth more than a silent
overlap.
