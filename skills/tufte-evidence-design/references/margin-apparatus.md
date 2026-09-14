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

Defines the pedagogic apparatus, gated by `\ifpdmargincolumn` (true only in the
Book; standalone A4 chapter PDFs have no margin column and every macro below
degrades to an inline, run-in form so the same chapter source compiles both
ways):

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
  `\pitfall`, `\scene`, `\xrefbox`: a small-caps label in the margin (Book) or a
  bold run-in head (standalone). This is the closest existing thing to a
  "sidenote head" and is the right macro to extend if `\pdgloss` is ever added
  — it would likely be `\pd@marginhead{Term}` plus a `\marginnote` body.
- **`\pdrecitation`, `\pdexercise`/`\pdSolution`, `\pdsession`** — margin-column
  pointers for retrieval prompts, exercise solution page numbers, and (for
  `\pdsession`) a full-width transcript block (`\pd@sessionwidth` adds
  `\marginparsep+\marginparwidth` to `\linewidth` when `\ifpdmargincolumn`).
  These are the repo's other full-width and margin devices beyond figures.
- **`\pdboundary`** — the "Where this stops" honest-limit box: a left ink bar,
  no fill, head in the margin. This is where doctrine 11 (Snow's cholera map:
  praise the design and name its assumption) should land structurally in a
  chapter — a `pdboundary` block naming a figure's own simplifying assumption.

### Net comparison to upstream tufte-latex

| Feature | tufte-latex | This repo's Book |
|---|---|---|
| Sidenote (numbered, inline) | `\sidenote` | not implemented — `\pd@marginhead` + `\marginnote` covers the labeled-aside case; no numbered-footnote-in-margin equivalent |
| Unnumbered margin note | `\marginnote` | `\marginnote` (same package, used directly and via `\pd@marginhead`) |
| Margin figure | `marginfigure` env | `\pdmarginfigure{slug}{caption}` — a portrait/plate when the slug is keyed to `plates/marginalia/`, otherwise a small multiple, sparkline, or regime strip; only the former is rationed one per section |
| Margin table | `margintable` env | not implemented |
| Full width | `fullwidth` env / `figure*` | `\pdfullwidth` length + automatic TikZ promotion hook; `\pdsession` computes its own full width |
| Measure | 26pc text / 12pc margin (~46%) | 4.5in text / 1.3in margin (~29%) |
| Short gloss/definition | none built in | `\pdgloss{Term}{one-line definition}` — bold term in text, definition in the margin (Book) or a parenthetical (standalone) |

## 3. Where each Book chapter should carry marginalia — reading the current state

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
