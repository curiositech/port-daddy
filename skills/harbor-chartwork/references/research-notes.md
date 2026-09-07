# Sourced research notes on diagram craft

Gathered for the book's TikZ/PGF figure work (relation maps, regime diagrams,
state machines, ledgers, fork DAGs, protocol ladders, Hasse lattices, game
trees and matrices, timelines, automata, queueing pictures). This is a
research clerk's citation file, not a style guide: every claim below is
attributed, every excerpt is marked verbatim or paraphrase, and the "house
style" conclusions are left for the lead to draw. All URLs accessed
2026-09-06.

**Retrieval note.** In this environment, direct `WebFetch` of most external
domains (cerfacs.fr, texample.net, tikz.dev, tex.stackexchange.com,
en.wikipedia.org, feynmanlectures.caltech.edu, journals.plos.org, and others)
is blocked by the network egress policy. Content below was retrieved instead
through two working channels: Firecrawl's developer/general search, which
returns indexed passages from those same pages (often verbatim), and
`WebSearch`, which returns a synthesized answer plus source links. Where a
note's text traces to a `WebSearch` synthesis rather than a raw page fetch or
an exact Firecrawl passage, it is marked **Paraphrase** even if it reads like
a quotation, to avoid overclaiming verbatim accuracy. Where the underlying
book (Tufte's) was never fetched directly and the wording comes only through
a secondary site that quotes it, the source line says so explicitly.

Two house artifacts were read directly (not fetched) before this research and
are cited throughout as primary context, not as "sources" in the bibliographic
sense: `docs/harbor-research/figures/CONVENTION.md` (the two-figure-kind
convention: plain-`tikzpicture` relation maps vs. `pgfplots` regime diagrams,
both compiled from flat `.tex` fragments, no raster) and
`website-v2/public/whitepaper/figures/pd-palette.tex` (the ink/cream/accent
semantic palette, "one hue, one meaning").

---

## 1. TikZ/PGF craft

### 1.1 Galleries and courses

**[1.1a] CERFACS's own tutorial teaches consistency-by-style, not sizing.**
Source: CERFACS, "Creating Beautiful Diagrams with TikZ in LaTeX," The COOP
Blog, https://cerfacs.fr/coop/start_with_tikz, accessed 2026-09-06.
Excerpt (verbatim, code): the tutorial's "Example 3: Connecting Shapes with
Arrows" is given twice. First with each node sized and fonted by hand
(`\node[rectangle, ... , minimum width=2cm, minimum height=1cm] {\large
Start}`, then `{\Large Step 1}`, then `{\Huge Step 2 additional text}` — three
different font commands and three different box sizes for three boxes in one
diagram). It is then rewritten using `\tikzset{mynode/.style={...}, myarrow/
.style={...}}` so every node and arrow in the figure shares one definition.
Implication for the Harbor charts: this is the exact lesson the book's own
`CONVENTION.md` already encodes as `relnode`/`relarrow`/`regimebox` shared
styles — the tutorial is independent confirmation that one-off per-node sizing
is the first thing a TikZ course teaches you to stop doing, and it argues that
new diagram kinds (ladders, lattices, trees) should get their own named shared
style rather than sized-by-eye boxes.

**[1.1b] texample.net organizes its gallery by TikZ feature, not by picture
subject.** Source: TeXample.net, "About," https://texample.net/tikz/examples/
about/, accessed 2026-09-06 (retrieved via search synthesis, page itself not
directly fetchable). Paraphrase: the gallery is indexed by library and
technique — absolute positioning, angles/arcs, automata and Petri nets,
calendar, chains, circuits, clipping, coordinate calculations, decorations,
fadings, fit, foreach, forest, intersections, layers, markings, matrices,
mindmaps, node positioning, nodes and shapes, overlays. A second, independent
confirmation of the same library-first organizing habit: TeXample.net,
"Fancy arrows drawn with the PGF 3.0 arrows.meta library,"
https://texample.net/fancy-arrows/, accessed 2026-09-06 — Excerpt (verbatim):
"PGF 3.0 provides a new library called arrows.meta." — a single example page
named after the *library*, not the picture's subject matter.
Implication for the Harbor charts: a figure-authoring checklist for this book
should be organized the same way — "which libraries does this figure need"
(positioning, fit, calc, matrix, decorations, arrows.meta) rather than
"what does this figure look like" — since that is how the whole ecosystem
teaches and catalogs TikZ craft.

**[1.1c] tikz.net is a science-first gallery, and its own worked examples are
plain TikZ, not always a specialized package.** Source: WebSearch synthesis of
tikz.net, https://tikz.net/, accessed 2026-09-06. Paraphrase: tikz.net
describes itself as hosting "far more than a thousand science-focused TikZ
examples." Concretely: tikz.net's own timeline example is plain `tikzpicture`
with a drawn axis and annotated eras, not the `chronology` package —
https://tikz.net/timeline/, "History timeline and energy scale of particle
physics" (title, verbatim). Implication for the Harbor charts: tikz.net is
useful precisely because it shows the "hand-draw it in plain TikZ with a
consistent style" approach at large scale across many diagram kinds — the
same approach `CONVENTION.md` already commits this book to — rather than only
showing package-based shortcuts.

### 1.2 Positioning library

**[1.2a]** Claim: the `positioning` library exists to make node placement
readable by a human, not just correct for the compiler. Source: PGF/TikZ
Manual, "Tutorial: A Petri-Net for Hagen," §3.8 "Placing Nodes Using Relative
Placement," https://tikz.dev/tutorial-nodes, accessed 2026-09-06. Excerpt
(verbatim): "With the positioning library loaded, when an option like below
is followed by of, then the position of the node is shifted in such a manner
that it is placed at the distance node distance in the specified direction of
the given direction." And, on why this beats absolute coordinates: "Even
though the above code has the same effect as the earlier code, Hagen can pass
it to his colleagues who will be able to just read and understand it, perhaps
without even having to see the picture." Implication for the Harbor charts:
relation maps built from raw `(x,y)` coordinates (as several `docs/
harbor-research/figures/*.tex` fragments currently are, e.g. `fig-r1-relation.
tex`'s hand-placed `\node ... at (2.0,9.60)`) are harder for a future editor to
re-derive than ones built with `below=of`/`right=of`; worth it for new figures
even though the existing ones already work.

**[1.2b]** Claim: TeX.SE's own working answer confirms `right=of` is
positioning-library syntax distinct from the older `right of=` anchor syntax,
and the two are routinely confused. Source: TeX – LaTeX Stack Exchange,
"Difference between 'right of=' and 'right=of' in PGF/TikZ" (cross-referenced
from "The use of below/above right/left of node in Tikz"),
https://tex.stackexchange.com/questions/621054/the-use-of-below-above-right-left-of-node-in-tikz,
accessed 2026-09-06. Paraphrase: the two syntaxes look nearly identical but
belong to different libraries and produce different results; questions about
which one is "correct" are a FAQ. Implication for the Harbor charts: if a new
contributor is going to write positioning-library TikZ for this book, the
`positioning` library must be loaded explicitly and the two syntaxes should
not be mixed inside one fragment — worth a one-line note wherever the book
documents its `\usetikzlibrary` preamble.

### 1.3 Fit library

**[1.3a]** Claim: `fit` computes a bounding node from existing coordinates
after the fact, rather than requiring the box to be sized in advance. Source:
PGF/TikZ Manual, "Nodes and Edges," https://tikz.dev/tikz-shapes (fit
description, cross-referencing Ch. 54), accessed 2026-09-06. Excerpt
(verbatim): "The fit option expects a list of coordinates (one after the
other without commas) as its parameter. The effect will be that the node's
text area has exactly the necessary size so that it contains all the given
coordinates." Implication for the Harbor charts: this is the right tool for
drawing a dashed/shaded enclosure around "this chapter's dependency span" or
"the carrier half" in a stack-map figure — the kind of after-the-fact grouping
`fig-swk-stack-map.tex` currently does by hand with explicit rectangle
coordinates (`\fill[hhteal!8] (0,.58) rectangle (13.6,2.18)`), which must be
re-measured by hand every time a label inside changes width.

**[1.3b]** Claim: the community treats `fit` as the standard answer to "draw a
box around a group of nodes I already placed," rather than computing the box
by hand. Source: TeX – LaTeX Stack Exchange, "Tikz fit variable number of
nodes," https://tex.stackexchange.com/questions/173579/tikz-fit-variable-number-of-nodes,
accessed 2026-09-06. Paraphrase: the accepted approach is to draw the nodes
first and then fit a rectangle to their bounding box, rather than compute
corner coordinates manually, and this generalizes to grouping any subset of
nodes. Implication for the Harbor charts: relation maps that shade "which
nodes this chapter owns" (as in `fig-stp-stack-map.tex`'s ownership spans)
could use `fit` per group instead of the current fixed-coordinate rectangles,
making the figure survive relabeling without a second pass of arithmetic.

### 1.4 Calc library

**[1.4a]** Claim: `calc` lets a coordinate be *computed* from other named
coordinates inside the coordinate syntax itself, without a separate math
step. Source: PGF/TikZ Manual, "Math Library," https://tikz.dev/library-math,
accessed 2026-09-06. Excerpt (verbatim): "If the TikZ calc library is loaded,
coordinate calculations can be performed; the coordinate expression does not
have to be surrounded by ($…$)." Implication for the Harbor charts: several
existing fragments (e.g. `fig-r1-regime.tex`'s marker-and-callout placement,
`(axis cs:0.36,6.0) -- (axis cs:0.155,5.98)`) currently hardcode derived
offsets as literal numbers; `calc` expressions like `($(A)!0.5!(B)$)` (midpoint
of A and B) would keep the *relationship* in the source instead of a number
that silently goes stale if A or B moves.

**[1.4b]** Claim: the `calc` coordinate syntax (`($...$)`) is non-obvious
enough that "how does this syntax even work" is itself a live, frequently
re-asked question. Source: TeX – LaTeX Stack Exchange, "How do syntax and
coordinate calculations work with the Tikz library calc,"
https://tex.stackexchange.com/questions/653728/how-do-syntax-and-coordinate-calculations-work-with-the-tikz-library-calc,
accessed 2026-09-06. Paraphrase: even fluent TikZ users ask how the
parenthesis-and-`$`-delimited arithmetic is parsed; it is not "just LaTeX
math mode" despite the visual resemblance. Implication for the Harbor charts:
any new `calc`-based figure fragment should carry a one-line comment
explaining what a nontrivial `($...$)` expression computes (e.g. "40% along
the digest-rate curve"), the same way the book's existing fragments already
comment nontrivial derived numbers (see `fig-r1-relation.tex`'s header
comment deriving `log2 6 - log2 2 = 1.585 bits`).

### 1.5 Matrix library

**[1.5a]** Claim: a TikZ "matrix of nodes" is the tool for grid-aligned
figures — ledgers, tables-as-diagrams — because each cell is a real node you
can draw edges to or from. Source: PGF/TikZ Manual, "Matrix Library,"
https://tikz.dev/library-matrix, and "Matrices and Alignment,"
https://tikz.dev/tikz-matrices, accessed 2026-09-06. Excerpt (verbatim): "This
library package defines additional styles and options for creating matrices.
A matrix of nodes is a TikZ matrix in which each cell contains a node." And,
on spacing: "There are different ways of setting and adjusting the spacing
between columns and rows. First, you can use the options column sep and row
sep." Implication for the Harbor charts: a ledger figure (append-only log,
work-unit table) is naturally a matrix of nodes with edges drawn between
specific cells — this keeps row/column alignment automatic instead of
hand-tuning row heights the way `fig-r1-frontier.tex`-style hand-placed rows
currently must.

**[1.5b]** Claim: per-cell spacing overrides in a matrix are a real,
frequently-hit need (not just uniform `row sep`/`column sep`), and the
community's answer is scoped local overrides rather than one global value.
Source: TeX – LaTeX Stack Exchange, "Column spacing list in tikz,"
https://tex.stackexchange.com/questions/671788/column-spacing-list-in-tikz,
accessed 2026-09-06. Paraphrase: `column sep=1cm` sets a uniform distance, but
when nodes have different widths people commonly want to space by the
longest-width case rather than by a fixed constant, which needs an explicit
override per column. Implication for the Harbor charts: a ledger with a
"witness" or "digest" column that is much wider than the rest (as in the
book's own witness/ledger content) should set that column's spacing
explicitly rather than let one global `column sep` fight both a narrow and a
wide column.

### 1.6 `arrows.meta`

**[1.6a]** Claim: `arrows.meta` replaced the older arrow libraries and is now
the one to load for any new figure. Source: PGF/TikZ Manual, "Arrows,"
https://tikz.dev/tikz-arrows, accessed 2026-09-06. Excerpt (verbatim, partial
— source snippet truncated): "arrows.meta instead/additionally, which allows
you to do all that the old libraries offered, plus much …". Implication for
the Harbor charts: the book's existing custom arrow styles (`pd focus arrow`,
`pd caution arrow`, `\draw[->, line width=1.2pt]`) should be checked against
whichever arrow library `../tex/preamble.tex` actually loads — mixing the
legacy `<->` shorthand with `arrows.meta`-only tip names (`Stealth`, seen
already in `fig-r1-relation.tex`'s `\draw[<->,>=Stealth,...]`) is a common
source of "why did my arrowhead not change" bugs.

**[1.6b]** Claim: `arrows.meta` specifically enables bending arrows and
placing several tips on one line, which older arrow libraries could not do.
Source: TeXample.net, "Fancy arrows drawn with the PGF 3.0 arrows.meta
library," https://texample.net/fancy-arrows/, accessed 2026-09-06. Excerpt
(verbatim): "PGF 3.0 provides a new library called arrows.meta." Paraphrase of
the rest of that page's description: with it you can bend arrows, swap arrow
tips on the fly, and chain several arrow tips along one path. Implication for
the Harbor charts: fork-DAG figures (a commit forking into two continuations)
are exactly the case where one drawn path needs to visually "split" — worth
checking whether `arrows.meta`'s tip-chaining or its `to` path operations give
a cleaner fork than manually drawing two separate `\draw` calls from the same
start point, which is the book's current approach in relation maps.

### 1.7 Decorations library

**[1.7a]** Claim: decorations come in two families — ones that *morph* a
path's shape (zigzag, wave) and ones that *replace* the path with a new
element pattern (e.g., a coverage bracket) — and the choice between them
matters for what the mark can represent. Source: PGF/TikZ Manual, "Decoration
Library" (via GitHub-hosted copy of the manual source,
`pgfmanual-en-tikz-decorations.tex`, and https://tikz.dev/library-decorations),
accessed 2026-09-06. Excerpt (verbatim): "A path morphing decoration 'morphs'
or 'deforms' the to-be-decorated path. This means that what used to be a
straight line might afterwards be a snaking curve." Path-replacing
decorations, by contrast, discard the original path geometry entirely.
Implication for the Harbor charts: a "coverage" mark on a relation map (e.g.
the shaded m-subset brackets in `fig-r1-relation.tex`, currently drawn as
manually-positioned rounded rectangles) could become a `decorations.
pathreplacing` brace instead, which would auto-fit its span if the covered
points move — trading a small amount of visual control for one less thing to
re-measure by hand.

**[1.7b]** Claim: decorations apply to *any* path, including curves and
nodes, not just straight lines — this is what makes them usable for
annotating a pgfplots curve, not only a plain `\draw`. Source: TeXample.net,
"TikZ and PGF version 2.00," https://texample.net/pgf-version-2/, accessed
2026-09-06. Excerpt (verbatim): "Decorations are a new and powerful way of
decorating and morphing paths. Arbitrary paths can be decorated, including
curves and nodes." Implication for the Harbor charts: this generalizes note
1.9's `fillbetween`-shaded regime bands — a "this segment is uncertain"
dashed/hatched decoration could sit directly on the plotted curve in a
`pgfplots` regime diagram, which is closer to what the shaded band in
`fig-r1-regime.tex` is already gesturing at by hand with `fill opacity=0.08`.

### 1.8 `standalone`

**[1.8a]** Claim: `standalone`'s whole purpose is to crop the output to
exactly the figure, with none of a normal document's margins or page
furniture, so a figure can be iterated on in isolation before being `\input`
into the real document. Source: TeXdoc, "The standalone Package,"
https://texdoc.org/serve/standalone/0, accessed 2026-09-06. Excerpt
(verbatim): "The class uses by default the crop option to create an output
file which only contains the picture with no extra margins, page numbers or
anything else." Implication for the Harbor charts: this is precisely the
workflow `CONVENTION.md` needs but does not currently name — since "there is
no local LaTeX toolchain in the dev container" and CI is the only compiler,
a `standalone`-wrapped copy of a `.tex` fragment (or a CI job that compiles
each fragment standalone before the full-book build) would let a contributor
see one figure rendered without waiting on a whole-paper build, and would
catch clipping/overflow bugs (like the ymax-clipping bug the book's own
`fig-r1-regime.tex` comment already documents catching by eye) earlier.

**[1.8b]** Claim: `standalone` and the older `preview` package solve the same
cropping problem differently, and mixing their border/margin options is a
common source of "my figure is cropped too tight/too loose" bugs. Source:
TeX – LaTeX Stack Exchange, "preview and standalone crop too much of tikz
picture,"
https://tex.stackexchange.com/questions/63706/preview-and-standalone-crop-too-much-of-tikz-picture,
accessed 2026-09-06. Paraphrase: `\PreviewBorder=<length>` under `preview` is
the equivalent of the `border=<length>` class option under `standalone`; using
one package's syntax under the other silently does nothing rather than
erroring. Implication for the Harbor charts: if the book ever adds a
standalone-compile step, its border option should be documented once, in one
place, rather than re-discovered per figure.

### 1.9 `pgfplots`: shaded regions

**[1.9a]** Claim: shading the area between two plotted curves is a named,
three-step recipe (name the first curve's path, name the second's, then
invoke `fill between`), not an ad hoc closed polygon. Source: PGF/TikZ
Manual, "Fill between," https://tikz.dev/pgfplots/libs-fillbetween, and
pgfplots.net, "Filling an area between plots,"
https://pgfplots.net/fill-between-plots/, accessed 2026-09-06. Paraphrase (two
independent sources agree on the steps): load `\usepgfplotslibrary
{fillbetween}`; draw the first plot and save it with `name path=`; draw the
second and save it the same way; then draw a `\addplot fill between
[of=A and B]` (or use `soft clip`) to shade the region; each resulting segment
is its own path, so it can be patterned, shaded, or decorated independently,
and can be styled differently above/below the intersection with `every even
segment`/`every odd segment`. Implication for the Harbor charts: the shaded
"zero-miss possible" band in `fig-r1-regime.tex` is currently hand-built as a
single `\addplot ... \closedcycle` polygon that repeats the k=2 curve's
coordinates a second time — `fillbetween` would shade the same region against
the axis top without duplicating the coordinate list, so the shaded region
cannot silently drift out of sync with the curve it is supposed to track.

**[1.9b]** Claim: annotating a specific point on a plotted curve has a
documented, general mechanism (`axis cs:` coordinates and `pos=` along a
plotted path), and pgfplots's own manual flags that such annotations are
easy to accidentally clip off. Source: PGF/TikZ Manual, "Custom Annotations,"
https://tikz.dev/pgfplots/reference-annotations, and pgfplots Tutorial 2,
https://tikz.dev/pgfplots/tutorial2, accessed 2026-09-06. Paraphrase: a node
can be placed at a literal data coordinate with `(axis cs:x,y)`, or at a
fraction of a plotted path's length with `node[pos=0.25]`; the manual's own
worked example shows a label silently "clipped away" by the axis boundary and
gives three fixes (`clip=false`, `clip mode=individual`, or drawing the node
outside the `axis` environment). Implication for the Harbor charts: this is
the same failure class the book's own `fig-r1-regime.tex` header comment
independently documents catching ("the source's y-axis limit... cuts the top
off the k=4 curve... a reader sees the red curve run flat along the axis top
and reads that flat as data") — worth turning into an explicit item on
whatever pre-commit or review checklist this book uses for regime diagrams,
since it is a documented pgfplots gotcha, not a one-off mistake.

### 1.10 Known pitfalls

**[1.10a] Never `\resizebox` a `tikzpicture` — source 1.** Claim: scaling a
finished picture with `\resizebox` scales its fonts and line widths along
with the geometry, which is exactly the inconsistency a book wants to avoid
across many figures. Source: TeX – LaTeX Stack Exchange, "Correctly scaling a
tikzpicture,"
https://tex.stackexchange.com/questions/4338/correctly-scaling-a-tikzpicture,
accessed 2026-09-06. Excerpt (verbatim): "This is intended behaviour. It is
considered good typography because it ensures consistent font size and line
width throughout the document." (The thread's actual advice is the inverse
framing: don't fight the intended behavior by wrapping the whole picture in
`\resizebox`; instead scale the picture's own coordinate system, e.g. `x=`,
`y=`, or a `scale=` key set once per figure, so fonts stay at their real,
final point size.) Implication for the Harbor charts: this directly
contradicts two figures already in this repository — `website-v2/public/
whitepaper/figures/fig-stp-stack-map.tex` and `whitepaper/figures/
fig-swk-stack-map.tex` both wrap their entire `tikzpicture` in
`\resizebox{0.9x\textwidth}{!}{...}` — meaning both figures' node labels and
rule widths are rendered at some off-nominal scale rather than the font size
the rest of the book's body text uses.

**[1.10b] Never `\resizebox` a `tikzpicture` — source 2.** Claim:
`pgfplots` deliberately does *not* auto-scale its own text when the axis size
changes, specifically to keep font sizes consistent between different
figures in the same document. Source: PGF/TikZ Manual (pgfplots), "Font Size
and Line Width," https://tikz.dev/pgfplots/reference-markers §4.7.4, and
"Scaling Options," https://tikz.dev/pgfplots/reference-scaling §4.10, accessed
2026-09-06. Excerpt (verbatim): "Often, one wants to change line width and
font sizes for plots. This can be done using the following options of TikZ."
— i.e., font and line width are separate, explicit keys (`font=`, `line
width=`), not a side effect of resizing the axis; and the scaling reference
adds (paraphrase) that uniform-scale modes deliberately leave axis
descriptions unscaled "in order to keep consistent font sizes between"
figures. Implication for the Harbor charts: this is the pgfplots-specific
version of 1.10a and reaches the same conclusion from the opposite
direction — the package's own author chose not to auto-scale text
specifically so a book of many regime diagrams would read at one consistent
type size; a `\resizebox` around a `pgfplots` axis defeats that design intent
just as much as around a plain `tikzpicture`.

**[1.10c] Font size and line width belong at final scale — a second,
independent illustration.** Claim: authors hit this exact problem
symptom-first ("my bar chart's text got tiny after I scaled it") and the
community answer is always "set the coordinate scale before drawing, don't
resize the drawn output." Source: Stack Overflow, "How to scale a barplot in
tikz without scaling the text?,"
https://stackoverflow.com/questions/56920845/how-to-scale-a-barplot-in-tikz-without-scaling-the-text,
accessed 2026-09-06. Paraphrase: the asker wants to shrink a plot's width
without shrinking its labels; the standard fix is to control the axis's `x=`/
`y=` unit lengths or its `width=`/`height=` keys directly rather than scale
the rendered picture afterward. Implication for the Harbor charts: any figure
brief for this book should specify final print width up front (e.g. "this
regime diagram renders at 0.62\textwidth" as `fig-r1-regime.tex` already
does) so the axis is built at that width from the start, rather than drawn at
a convenient size and shrunk later.

**[1.10d] `text width` + `align` for multi-line nodes — source 1.** Claim:
there are three documented ways to wrap text inside a node, and manual line
breaks specifically require pairing `text width` (or an explicit `\\`) with
an `align` key, or the alignment silently defaults to something unintended.
Source: TeX – LaTeX Stack Exchange, "Manual/automatic line breaks and text
alignment in TikZ nodes,"
https://tex.stackexchange.com/questions/123671/manual-automatic-line-breaks-and-text-alignment-in-tikz-nodes,
accessed 2026-09-06. Excerpt (verbatim): "TikZ-PGF manual explains three ways
to achieve line breaking inside [nodes]... Use text width and \\ (and maybe
align, too)." Implication for the Harbor charts: the book's own
`fig-r1-relation.tex` already does this correctly and repeatedly (`\node
[align=center,font=\scriptsize,text width=2.5cm] {...}`) — worth keeping as
the template for every future multi-line node rather than re-deriving it, and
worth flagging any new fragment that sets `text width` without `align` (or
vice versa) in review.

**[1.10e] `text width` + `align` — source 2.** Claim: the PGF manual's own
tutorial introduces exactly this pairing, in narrative form, as the answer to
"how do I put two lines of text in one node." Source: PGF/TikZ Manual,
"Tutorial: A Petri-Net for Hagen," §3.12 "Adding the Snaked Line and
Multi-Line Text," https://tikz.dev/tutorial-nodes, accessed 2026-09-06.
Paraphrase: the tutorial's protagonist wants two lines of text in a node and
is told there are two ways to do it — specify `align=center` and insert `\\`
manually, or set `text width` and let TikZ wrap automatically. Implication
for the Harbor charts: this confirms 1.10d is not just a StackExchange
workaround but the manual's own recommended technique, so it is safe to
standardize on it (specifically the manual-break, `align`-plus-`text width`
form the book already uses) rather than treat it as a hack.

**[1.10f] `overlay`/`remember picture` — source 1.** Claim:
`remember picture`+`overlay` exist specifically to let a node reference an
absolute position on the physical page (via the special `current page`
node), breaking out of the picture's own local coordinate system. Source:
PGF/TikZ Manual, "Nodes and Edges" §17.13.2 "Referencing the Current Page
Node," https://tikz.dev/tikz-shapes, and "Nodes and Shapes" §106.4 "Special
Nodes," https://tikz.dev/base-nodes, accessed 2026-09-06. Excerpt (verbatim):
"the remember picture and the overlay options to a picture, you can position
nodes absolutely on a page." And, on the special node itself: "This node is
inside a virtual remembered picture. The size of this node is the size of
the current page." Implication for the Harbor charts: this technique needs a
second compilation pass to resolve (the position is only known after a first
pass records it) — worth flagging as incompatible with the book's stated
build model, where "CI is the only compiler available" and figures are
flattened into one `build/` directory per `CONVENTION.md`; a figure that
relies on `remember picture` across multiple `\input`s could behave
differently the first time CI renders it fresh versus a later incremental
build.

**[1.10g] `overlay`/`remember picture` — source 2.** Claim: this same
mechanism is explicitly documented as unsafe to combine with PDF
externalization/bounding-box restriction, which matters for any pipeline
that pre-renders figures separately from the main document. Source: PGF/TikZ
Manual (pgfplots), "Bounding Box Restrictions," https://tikz.dev/pgfplots/
reference-bb-clip §4.20.1, accessed 2026-09-06. Excerpt (verbatim): "image
externalization (the external library) is more or less incompatible with
methods 1 to 4" — where method 1 in that list is exactly the `overlay`
option. Implication for the Harbor charts: since this book already treats
each figure as an independently-compiled flat fragment (`CONVENTION.md`'s
"flat filename... no `../` prefix" rule, functionally similar to
externalization), `remember picture`/`overlay` tricks are a poor fit for any
figure meant to be `\input`-ed standalone into different papers — prefer the
`fit`-library or plain relative-coordinate techniques (1.3) that stay local
to one picture.

**[1.10h] `every node/.style` — source 1.** Claim: `every node` is a style
hook installed automatically at the start of *every* node in a picture,
which is what makes one shared "house style" for all relation-map nodes
possible without repeating options on every `\node` call. Source: PGF/TikZ
Manual, "Nodes and Edges," https://tikz.dev/tikz-shapes, accessed 2026-09-06.
Excerpt (verbatim): "The following styles influence how nodes are rendered:
/tikz/every node (style, initially empty). This style is installed at the
beginning of every node." Implication for the Harbor charts: this is
presumably how `../tex/preamble.tex`'s `relnode`/`regimebox` styles are
wired in already; worth confirming they are applied via `every node` (or an
equivalent named style used consistently) rather than repeated per-figure,
since that repetition is exactly what let `fig-stp-stack-map.tex` and
`fig-swk-stack-map.tex` drift onto a third, separate `hh*`-prefixed color set
instead of the shared `pd-palette.tex` (see note 3.4).

**[1.10i] `every node/.style` — source 2.** Claim: a locally-scoped
`every node` style (e.g., set inside one `{scope}` or one sub-tree) can
silently override or fight a globally-set one, which is a well-known
source of "why did my node style not apply" confusion. Source: TeX – LaTeX
Stack Exchange, "Overriding node draw style inherited from every node style
messes up positioning,"
https://tex.stackexchange.com/questions/101005/overriding-node-draw-style-inherited-from-every-node-style-messes-up-positioning,
accessed 2026-09-06. Paraphrase: a node inherits whatever `every node` style
is active in its scope; setting a second, more specific `every node` locally
(to restyle just a subtree) can also change unrelated positioning behavior
that the outer style depended on. Implication for the Harbor charts: if a
new diagram kind (say, a Hasse lattice) needs its own node look distinct from
`relnode`, it should get its own explicitly-named style (`hassenode/.style=
{...}`) applied per-node or per-scope, rather than a second, competing
`every node` redefinition nested inside the shared preamble's scope.

**[1.10j] `inner sep` — source 1.** Claim: `inner sep` is the padding between
a node's text and its drawn border, defaults to roughly the width of a
normal space, and is a separate concept from `outer sep` (the minimum gap
*between* adjacent nodes/shapes). Source: LaTeXDraw (TikZBlog), "How the
inner separation for nodes works and how to use it: Part 1,"
https://latexdraw.com/inner-separation-for-nodes/, accessed 2026-09-06.
Paraphrase: the default node shape is a rectangle with roughly 1mm (0.3333em)
of inner padding by default; changing `inner sep` grows or shrinks the box
around fixed text, while `outer sep` (a separate key, default 0pt) adds
clearance beyond the drawn border, used e.g. as the minimum spacing between
neighboring shapes. Implication for the Harbor charts: ledger/matrix figures
with many small adjacent cells (note 1.5) are the case most sensitive to this
distinction — a too-small `inner sep` crowds text against a cell's border,
while `outer sep` (not `inner sep`) is the key to adjust if cells themselves
need more breathing room between them.

**[1.10k] `inner sep` — source 2.** Claim: the manual itself recommends
turning on `outer sep=auto` early, precisely because the historical default
(`outer sep=0pt`, kept for backward compatibility) is not the behavior most
users actually want. Source: PGF/TikZ Manual, "Nodes and Edges,"
https://tikz.dev/tikz-shapes, accessed 2026-09-06. Excerpt (verbatim): "In
general, it is a good idea to say outer sep=auto at some early stage. It is
not the default mainly for compatibility with earlier versions."
Implication for the Harbor charts: worth checking whether the shared
preamble already sets `outer sep=auto` (or an equivalent explicit spacing
rule) for `relnode`/`regimebox`, since the manual is flagging this as a case
where the factory default is known to surprise users, not a matter of taste.

**[1.10l] `line cap` — source 1.** Claim: `line cap` (butt, round, or rect)
controls how the *ends* of an open stroke are drawn, defaults to `butt`
(a hard, square-cut end exactly at the path's endpoint), and is set
independently of line width or color. Source: PGF/TikZ Manual, "Using
Paths" §104.2.2 "Graphic Parameter: Caps and Joins," https://tikz.dev/
base-actions, and "Actions on Paths" §15.3.1, https://tikz.dev/tikz-actions,
accessed 2026-09-06. Excerpt (verbatim): "/tikz/line cap=⟨type⟩ (no default,
initially butt)." Implication for the Harbor charts: the book's thick "rule"
styles (e.g. `fig-stp-stack-map.tex`'s `pd rule,line width=1.05pt` staircase
segments) are drawn with the default `butt` cap, which reads as a slightly
harder/sharper mark than `round`; a one-line style decision (butt for
technical/precise marks, round for softer narrative rules) would make that
choice deliberate rather than accidental.

**[1.10m] `line cap` — source 2, a genuine gotcha for arrow-tipped lines.**
Claim: TikZ resets `line cap` and `line join` every time it draws an arrow
tip, regardless of what the surrounding path's style set them to, so an
arrow-tipped line's cap/join must be set on the arrow tip itself, not (only)
on the line. Source: PGF/TikZ Manual, "Arrows" §16.3.7 "Line Styling,"
https://tikz.dev/tikz-arrows, accessed 2026-09-06. Excerpt (verbatim,
partial — source snippet truncated): "TikZ resets the line cap and line join
each time it draws an arrow tip" — with the manual providing dedicated arrow
keys (`/pgf/arrow keys/line cap=`, `line join=`, and the `round` shorthand
combining both) specifically to override that reset. Implication for the
Harbor charts: any of the book's custom arrow styles (`pd focus arrow`,
`myarrow` in the CERFACS example, or a future protocol-ladder arrow style)
that wants rounded, softer arrowheads must set `round` (or the arrow-specific
cap/join keys) on the arrow tip definition itself — setting `line cap=round`
only on the `\draw` line will visibly not reach the tip.

---

## 2. Diagram design

### 2.1 Tufte: data-ink, chartjunk, small multiples, sparklines

**[2.1a] Data-ink ratio.** Claim: Tufte's central minimalist rule is that
non-data ink should be erased whenever it can be, because every mark that
does not encode a value competes with the marks that do. Source: Tufte's own
wording, as quoted by GeeksforGeeks, "Mastering Tufte's Data Visualization
Principles," https://www.geeksforgeeks.org/data-visualization/mastering-tuftes-data-visualization-principles/,
and independently by InfoVis:Wiki, "Data-Ink Ratio," https://infovis-wiki.net/
wiki/Data-Ink_Ratio, both accessed 2026-09-06 (Tufte's book itself,
*The Visual Display of Quantitative Information*, was not fetched directly —
this is a secondary quotation). Excerpt (as quoted by both secondary
sources): "A large share of ink on a graphic should present
data-information, the ink changing as the data change. Data-ink is the
non-erasable core of a graphic, the non-redundant ink arranged in response to
variation in the numbers represented." Implication for the Harbor charts:
weighed against note 2.11 below (redundancy sometimes helps), but on its own
terms this argues for auditing the book's regime diagrams for ink that does
not track data — e.g., decorative gridlines, drop shadows, or a legend entry
that repeats a label already given in the caption.

**[2.1b] Chartjunk.** Claim: "chartjunk" names decorative graphical effects
(moiré vibration, heavy grids, self-congratulatory ornament) that add
visual noise without adding information. Source: as 2.1a, plus Chartbuddy,
"Tufte's 6 Principles for Graphical Integrity,"
https://chartbuddy.io/blog/tuftes-principles-for-graphical-integrity,
accessed 2026-09-06 (secondary quotation of Tufte). Paraphrase: Tufte devotes
a full chapter of his book to cataloging chartjunk by name. Implication for
the Harbor charts: this book's figures are already unusually disciplined
about this (flat fills, no gradients/shadows, no 3-D bar effects anywhere in
the sampled fragments) — the main risk is not classic chartjunk but the more
subtle version 2.9's contradiction section names: encoding redundancy added
for accessibility can visually resemble chartjunk if not deliberately
justified in a caption or convention note.

**[2.1c] Small multiples.** Claim: a grid of small, identically-scaled
panels lets a reader compare across a category or over time without
re-learning a new chart each time. Source: Tufte, quoted by Juice Analytics,
"Better Know a Visualization: Small Multiples,"
https://www.juiceanalytics.com/writing/better-know-visualization-small-multiples,
and (independently) Wikipedia's "Small multiple" article (retrieved via
search synthesis, https://en.wikipedia.org/wiki/Small_multiple), both
accessed 2026-09-06. Excerpt (as quoted by Juice Analytics): "Illustrations
of postage-stamp size are indexed by category or a label, sequenced over
time like the frames of a movie, or ordered by a quantitative variable not
used in the single image itself." Implication for the Harbor charts: the
book's own `fig-b1-frontier.tex` is already exactly this pattern — three
`minipage`-arranged `pgfplots` panels (A, B, C) sharing one caption and one
visual grammar — worth naming "small multiples" explicitly as the pattern to
reach for whenever a result needs 2-4 comparable regime diagrams side by
side, rather than one overloaded multi-series plot.

**[2.1d] Sparklines.** Claim: a sparkline is a small, word-sized graphic
meant to sit inline with text or numbers, not to stand alone as a full
figure. Source: Edward Tufte, "Sparkline theory and practice,"
https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/,
accessed 2026-09-06 (retrieved via search synthesis of Tufte's own site).
Excerpt (as retrieved): "small, high-resolution graphics embedded in a
context of words, numbers, and images," elsewhere described as "small,
intense, word-sized graphics with typographic resolution." Implication for
the Harbor charts: none of the book's current figure kinds (relation maps,
regime diagrams, ledgers) are sparkline-scale, but a future inline trend
mark — e.g., a tiny inline curve next to a claimed number in running prose,
matching this book's "hand-checkable numbers" habit — would need its own,
much lighter-weight style than any of the existing `regimebox`/`harbor
curve` styles, which are built for full-width figures.

### 2.2 Bertin's visual variables

**[2.2a]** Claim: Bertin's *Sémiologie Graphique* (1967; English
*Semiology of Graphics*, 1983) names a fixed set of "retinal variables" —
position, size, shape, value (lightness/darkness), color (hue), orientation,
and texture — and the book's contribution was showing which variables suit
nominal, ordinal, or quantitative data. Source: Wikipedia, "Visual variable"
(retrieved via search synthesis, https://en.wikipedia.org/wiki/Visual_variable),
accessed 2026-09-06. Paraphrase: hue is best suited to *nominal* (categorical)
distinctions, while value/size are better suited to *ordered* data, because
the eye reads hue as "different" rather than "more or less." Implication for
the Harbor charts: this is the formal justification for `pd-palette.tex`'s
own stated rule — hue (cobalt, teal, indigo, violet, rust, gold, ...) for
categorical story-threads, reserving lightness/value changes (`!70!black`,
opacity) for ordering or emphasis within one thread — Bertin is the named
source the book could cite for that already-adopted convention.

**[2.2b]** Claim: Bertin's seven variables are still taught as the base
vocabulary of information-graphic design, not a historical curiosity.
Source: Klaus Mueller, "The Semiology of Graphics" (course slides, CSE 564
Visualization), https://www3.cs.stonybrook.edu/~mueller/teaching/cse564/
bertin.pdf, accessed 2026-09-06. Paraphrase: the slides restate Bertin's
variables as the standard first lecture in a graduate visualization course.
Implication for the Harbor charts: when the lead writes the house style,
naming which of the seven variables each figure kind is allowed to use (a
relation map: position + shape + hue for category; a regime diagram:
position + value for the quantity, hue only for series identity) would give
a checkable rule rather than a vague "make it look consistent."

### 2.3 Gestalt grouping

**[2.3a]** Claim: elements placed close together are read as one group
before any other cue is considered — proximity is the most immediately
legible grouping signal. Source: Nielsen Norman Group, "Proximity Principle
in Visual Design," https://www.nngroup.com/articles/gestalt-proximity/,
accessed 2026-09-06 (retrieved via search synthesis). Paraphrase: proximity
is described as the most obvious Gestalt principle because grouping by
closeness is a pre-attentive, near-automatic read. Implication for the
Harbor charts: in a relation map, two nodes drawn close together will read
as related *even without a drawn edge* — a risk in dense figures like
`fig-r1-relation.tex`'s three-row layout, where accidental proximity between
unrelated row-1 and row-2 elements could be misread as a relationship the
figure did not intend to draw.

**[2.3b]** Claim: "uniform connectedness" — elements linked by a visible
line — is one of the strongest Gestalt cues, and can override proximity or
similarity when they conflict. Source: Wikipedia, "Principles of grouping"
(retrieved via search synthesis, https://en.wikipedia.org/wiki/Principles_of_grouping),
accessed 2026-09-06. Paraphrase: a series of dots connected by a line is
perceived as one object, not several separate dots, even when the dots
themselves are visually dissimilar or spaced apart. Implication for the
Harbor charts: this is the formal justification for why a relation map's
drawn arrows (`relarrow`) do the real work of asserting a relationship, and
why proximity alone (2.3a) is a weaker, riskier substitute for an explicit
drawn edge when two things must read as connected.

**[2.3c] Diagram-specific empirical corroboration.** Claim: in actual
node-link diagrams (not abstract Gestalt demonstrations), minimizing edge
crossings is empirically the single most important readability factor —
more important than symmetry, bends, or orthogonality. Source: Helen C.
Purchase's user studies on graph-drawing aesthetics, as summarized in
"Effective information visualization: A study of graph drawing aesthetics
and algorithms," https://www.researchgate.net/publication/222563534, and
"The State of the Art in Empirical User Evaluation of Graph Drawing,"
https://eprints.gla.ac.uk/227646/1/227646.pdf, accessed 2026-09-06.
Paraphrase: across several user studies, "edge crossings" is identified as
by far the most important aesthetic for a viewer's ability to understand a
graph's structure, while the evidence for symmetry mattering is weaker and
mixed. Implication for the Harbor charts: for relation maps and fork-DAG
figures specifically, a review checklist item "does any edge cross another
edge unnecessarily" is better evidence-backed than a vaguer "make it look
balanced/symmetric" instruction.

### 2.4 Miro's diagram-design guide

**[2.4a]** Claim: a diagram should fix its typography and arrow style once
and hold it constant; any deviation from that fixed style should carry a
specific, stated meaning (e.g., a different arrow color per team), not be
incidental. Source: Miro, "Diagram design 101: Tips for effective visual
diagrams," https://miro.com/blog/diagram-design/, accessed 2026-09-06
(retrieved via search synthesis). Paraphrase: keep the same typography and
arrow styles throughout a diagram; any style change should have a specific
meaning; avoid overcrowding; label all components and connections. Implication
for the Harbor charts: this is a plain-language restatement of what
`every node/.style` (note 1.10h) already makes mechanically possible — the
design rule and the TikZ mechanism point at the same practice from two
different literatures (design guidance vs. package documentation), which is
reassuring cross-corroboration rather than a new claim.

**[2.4b]** Claim: refer to established symbol/notation standards where one
exists, rather than inventing new shape conventions per diagram. Source:
Miro, "Master Network Topology Diagrams: Guide & Best Practices,"
https://miro.com/diagramming/what-is-a-network-topology-diagram/, accessed
2026-09-06 (retrieved via search synthesis; same publisher as 2.4a, offered
here as the second, sibling source on the same guidance page family rather
than a fully independent outlet). Paraphrase: reach for standard symbol sets
and label every component and connection rather than inventing new pictorial
conventions per diagram. Implication for the Harbor charts: this is the
argument for using the specialized packages named in 2.5-2.9 (automata,
tikz-cd, forest/istgame, pgf-umlsd/msc) when a diagram kind matches one of
those established notations exactly, rather than hand-rolling a look-alike
in plain `tikzpicture` — see the Contradictions section for the tension this
creates with the book's own plain-TikZ convention.

### 2.5 State machines (`automata` library)

**[2.5a]** Claim: the `automata` library exists specifically so finite
automata and Turing machines can be drawn with named semantic options
(`state`, `accepting`, `initial`) instead of styled by hand, and is
explicitly scoped to "most finite automata... found in text books," not
every diagram imaginable. Source: PGF/TikZ Manual, "Automata Drawing
Library," https://tikz.dev/library-automata (Ch. 43), accessed 2026-09-06.
Excerpt (verbatim): "This packages provides shapes and styles for drawing
finite state automata and Turing machines... It does not cover every
situation imaginable, but most finite automata and Turing machines found in
text books can be drawn in a nice and convenient fashion using this
library." Implication for the Harbor charts: for a genuine finite-state
automaton or Turing machine figure, this library's `accepting`/`initial`
options are a real semantic win over hand-drawn double circles and
free-floating arrows; for a *state machine that is not really an automaton*
(e.g., a protocol's lifecycle states with no accept/reject semantics), plain
`tikzpicture` with the book's existing `relnode`/`relarrow` may fit the
content better than forcing automaton vocabulary onto it.

**[2.5b]** Claim: this is a peer-published, not just crowd-sourced,
consensus — a TeX Users Group journal article treats the automata library as
the standard tool for typesetting finite automata. Source: Marco A. Prado,
"An introduction to automata design with TikZ's automata library," TUGboat
44:1 (2023), https://www.tug.org/TUGboat/tb44-1/tb136prado-automata.pdf,
accessed 2026-09-06. Paraphrase: the article is framed as a quick
introduction to the library specifically for the design and typesetting of
finite automata in LaTeX, aimed at readers who would otherwise hand-draw
these diagrams. Implication for the Harbor charts: gives the lead a citable,
non-StackExchange authority if the house style needs to justify pulling in a
new dependency (`\usetikzlibrary{automata}`) beyond what `CONVENTION.md`
currently lists.

**[2.5c]** Claim: the general TikZ/Overleaf consensus is that the
`positioning` library (not just `automata`) is what makes any node-and-edge
diagram — automaton or not — practical to write and read. Source: Overleaf,
"TikZ package," https://www.overleaf.com/learn/latex/TikZ_package, accessed
2026-09-06. Excerpt (verbatim): "For this positioning system to work you
have to add \usetikzlibrary{positioning} to your preamble." Second,
independent confirmation of the community's practical default: TeX – LaTeX
Stack Exchange, "How to draw finite state automata in TikZ?,"
https://tex.stackexchange.com/questions/584873/how-to-draw-finite-state-automata-in-tikz,
accessed 2026-09-06 — paraphrase: the standard preamble combines
`automata`, `positioning`, and `arrows` together, not `automata` alone.
Implication for the Harbor charts: any state-machine figure the book adds
should load `positioning` alongside `automata`, matching the combination
already implicit in the book's other relation maps.

### 2.6 Commutative diagrams (`tikz-cd`)

**[2.6a]** Claim: `tikz-cd` provides a dedicated matrix-plus-arrow DSL for
commutative diagrams, including arrow tips deliberately matched to Computer
Modern math fonts, rather than requiring hand-built TikZ matrices with
manually-styled arrows. Source: CTAN, "Package tikz-cd,"
https://ctan.org/pkg/tikz-cd?lang=en, accessed 2026-09-06. Paraphrase:
"TikZ can be used to typeset commutative diagrams. This package also
includes an arrow tip library that match closely the arrows present in the
Computer Modern fonts." Implication for the Harbor charts: the book has not
yet needed a commutative-diagram-shaped figure (a functorial or
compositional argument drawn as objects-and-morphisms), but if one arises,
`tikz-cd`'s `\arrow` command inside `{tikzcd}` is the standard tool, not a
hand-rolled matrix of nodes.

**[2.6b]** Claim: `tikz-cd`'s core primitive is a single `\arrow` command
whose argument string encodes direction and style, used inside a matrix
environment that is implicitly math mode throughout. Source: TeXdoc,
"tikzcd: Commutative diagrams with TikZ,"
https://texdoc.org/serve/tikz-cd/0, accessed 2026-09-06. Excerpt (verbatim,
partial): "Arrows between matrix entries can be created with the \arrow
command described below... Everything inside {tikzcd} is typeset in math
mode." Implication for the Harbor charts: because `{tikzcd}` is always math
mode, any category-theory-flavored figure would need its own separate
convention from the book's mostly-text `relnode` labels — worth deciding
explicitly rather than discovering the mode mismatch mid-figure.

### 2.7 Hasse diagrams

**[2.7a]** Claim: for a general-purpose Hasse (poset) diagram, the community
consensus is plain TikZ node-and-edge placement, not a specialized package —
"TikZ is very good at drawing bunches of nodes" is treated as sufficient.
Source: TeX – LaTeX Stack Exchange, "How to draw a poset Hasse Diagram using
TikZ?," https://tex.stackexchange.com/questions/47392/how-to-draw-a-poset-hasse-diagram-using-tikz,
accessed 2026-09-06. Paraphrase: the accepted approach places nodes by level
(rank) and draws covering-relation edges between them directly, using the
same node/edge primitives as any other relation map. Implication for the
Harbor charts: this is good news for consistency — a Hasse lattice can use
the book's existing `relnode`/`relarrow` styles unmodified, needing only a
by-rank layout convention (nodes at the same lattice level share a row),
rather than a new dependency.

**[2.7b]** Claim: the one dedicated Hasse-diagram package that exists is
narrowly scoped to a specific mathematical object (root posets of simple Lie
algebras), not general posets — confirming there is no general-purpose
package filling the gap that 2.7a's plain-TikZ answer fills instead. Source:
CTAN, "Package lie-hasse," https://ctan.org/pkg/lie-hasse?lang=en, accessed
2026-09-06. Paraphrase: "This package draws Hasse diagrams of the partially
ordered sets of the simple roots of any complex simple Lie algebra." (It
depends on the separate Dynkin-diagrams package, itself domain-specific.)
Implication for the Harbor charts: confirms 2.7a is not a gap in the
research but an accurate description of the ecosystem — there is genuinely
no reason to add a Hasse-specific dependency for a general lattice figure.

### 2.8 Game trees (`istgame`, `forest`)

**[2.8a]** Claim: `istgame` exists specifically because plain TikZ tree
primitives handle extensive-form games with information sets (dashed
ellipses linking nodes a player cannot distinguish between) badly, and the
community actively steers people to it over hand-rolled TikZ trees. Source:
TeX – LaTeX Stack Exchange, "How can I create this game-tree in Latex (with
information sets)?,"
https://tex.stackexchange.com/questions/434694/how-can-i-create-this-game-tree-in-latex-with-information-sets,
accessed 2026-09-06. Excerpt (verbatim): "Check out the istgame package,
which is designed for this sort of tree. The core TikZ tree drawing methods
are almost always the least practical" (for this specific case). Implication
for the Harbor charts: if the book ever draws a genuine extensive-form game
with information sets (not just a plain decision tree), `istgame` is the
named, community-endorsed tool — a case where the answer to "package or
plain TikZ" (see Contradictions) actually favors the package, because the
notation (dashed information-set ellipses across non-adjacent nodes) is
genuinely awkward to hand-build.

**[2.8b]** Claim: `istgame`'s core mechanic is "completing" a whole tree
shape from a small set of primitives, then styling payoffs/labels onto it
separately, rather than drawing each branch by hand. Source: `istgame`
package documentation, "istgame.sty: Draw Game Trees with TikZ,"
https://ctan.org/pkg/istgame?lang=en, accessed 2026-09-06. Paraphrase: "the
main idea underlying its core macros is the completion of a whole tree by
using a" (small, declarative specification of branching), separating tree
*shape* from node/edge *styling*. Second, more general alternative for game
trees without information sets: the `forest` package, "a pgf/TikZ-based
package for drawing linguistic (and other kinds of) trees," with "a packing
algorithm" for automatic layout — https://texdoc.org/serve/forest/0,
accessed 2026-09-06. Implication for the Harbor charts: a plain decision
tree (no information sets) is `forest`'s use case; a game tree with hidden
information specifically needs `istgame`. Worth distinguishing the two in
whatever the house style says about game trees, since they solve different
problems.

### 2.9 Sequence / protocol diagrams (`pgf-umlsd`, `msc`)

**[2.9a]** Claim: `pgf-umlsd` provides ready-made macros specifically for
UML-style sequence/protocol-ladder diagrams (lifelines, activation bars,
messages), built on top of pgf rather than plain TikZ paths. Source:
TeXample.net, "UML sequence diagrams," https://texample.net/pgf-umlsd/,
accessed 2026-09-06. Excerpt (verbatim): "Demonstration of pgf-umlsd.sty, a
set of convenient macros for drawing UML sequence diagrams." Second,
independent confirmation: CTAN, "Package pgf-umlsd,"
https://ctan.org/pkg/pgf-umlsd?lang=en, accessed 2026-09-06 — "Draw UML
Sequence Diagrams[:] LaTeX macros to draw UML diagrams using pgf."
Implication for the Harbor charts: a protocol ladder (two or more parties
exchanging typed messages over time) is exactly `pgf-umlsd`'s target case —
worth adopting for that diagram kind rather than hand-drawing lifelines as
parallel `\draw` verticals with manually-positioned message arrows.

**[2.9b]** Claim: the older, ITU-standard notation this style ultimately
derives from is the Message Sequence Chart (MSC), and a dedicated `msc`
LaTeX package exists to typeset that standard notation directly, separate
from the UML-flavored `pgf-umlsd`. Source: S. Mauw and M.A. Reniers
(package); summary via Mauw & L. Bos, "Drawing Message Sequence Charts with
LaTeX," Semantic Scholar,
https://www.semanticscholar.org/paper/Drawing-Message-Sequence-Charts-with-LATEX-Mauw-Bos/c7d01c92962893368d455e4185f25b48e65723ba,
accessed 2026-09-06. Paraphrase: the `msc` macro package lets LaTeX users
include Message Sequence Charts in running text directly. Implication for
the Harbor charts: if the book's protocol ladders are meant to read as
formal MSC notation (with the standard's own conventions for
coregions/conditions), `msc` is the standards-accurate choice; if they are
meant to read as informal illustration in the book's own house style,
`pgf-umlsd`'s more decorative UML look — or plain TikZ matching the rest of
the book — fits better. This is a real branch point, not a solved question.

### 2.10 Timelines

**[2.10a]** Claim: a dedicated `chronology` package exists for horizontal
timelines with per-day-granularity event labeling, aimed at chronologies
with many discrete dated events. Source: CTAN, "Package chronology,"
https://ctan.org/pkg/chronology, accessed 2026-09-06. Paraphrase:
"Chronology – Provides a horizontal timeline... allows labelling of events
with per-day granularity." Implication for the Harbor charts: this fits a
literal calendar-dated history (e.g., a project/paper timeline with real
dates), which is a narrower case than a conceptual "stages of the argument"
timeline.

**[2.10b]** Claim: for a *conceptual* timeline (eras/regimes over a
continuous axis, not discrete calendar dates), the community's own worked
examples are plain TikZ, matching a regime diagram more than a scheduling
chart. Source: tikz.net, "History timeline and energy scales" (title,
verbatim), https://tikz.net/timeline/, accessed 2026-09-06. Paraphrase: the
example draws a single annotated axis spanning cosmological history with
labeled regimes (particle-physics energy scales), built from plain
`tikzpicture` drawing commands, not a specialized timeline package.
Implication for the Harbor charts: a conceptual timeline in this book (e.g.,
"stages of the argument" or "maturity over calendar time" as in the
`fig-stp-stack-map.tex` staircase, which is already timeline-shaped) is
closer in spirit to a regime diagram than to a scheduling chart, and should
probably stay in plain TikZ with the book's existing rule/label styles
rather than adopt `chronology`'s discrete-event model.

### 2.11 Redundancy for comprehension (a counterweight to 2.1)

**[2.11a]** Claim: repeating information across more than one visual channel
can *speed up* finding and interpreting it, when the repetition narrows what
the viewer has to search for — directly in tension with pure data-ink
minimization. Source: "When more is more: redundant modifiers can facilitate
visual search," PMC7889780,
https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7889780/, accessed 2026-09-06
(author names not resolved from the metadata available to this search).
Excerpt (verbatim, from the abstract): "Redundant (non-contrastive)
information may facilitate real-world search if it narrows the spatial
scope under consideration, or improves target template specificity."
Implication for the Harbor charts: a category label repeated as both a hue
*and* a text tag on a relation-map node (seemingly "redundant" by Tufte's
count) can make the node faster to find and correctly classify, not merely
decorative — the redundancy should be judged by whether it narrows the
reader's search, not by ink count alone.

**[2.11b]** Claim: presenting the same content through two channels (verbal
+ visual) can strengthen retention, but only when it reduces ambiguity
rather than merely duplicating the same information verbatim in both
places. Source: general summaries of Paivio's dual-coding theory, e.g. BCL
Learning Library, "Dual Coding Theory,"
https://bcltraining.com/learning-library/dual-coding-theory/, accessed
2026-09-06. Paraphrase: dual coding is deliberately using verbal and visual
channels *together*; the same secondary literature (e.g. multimedia-learning
research on "redundant text") warns that low-quality redundancy — restating
a caption's sentence as a text label inside the figure, with no added
distinguishing information — can hurt more than help. Implication for the
Harbor charts: this cuts both ways for caption-writing (Section 4) — a
caption should not simply re-narrate what a node's own label already says,
but a node's color *and* its label together, encoding the same category two
different ways, is the useful kind of redundancy this note is about.

---

## 3. Print color

### 3.1 Accessible contrast for print

**[3.1a]** Claim: the standard machine-checkable contrast floor is a ratio of
at least 4.5:1 between text and its background for normal-size text (3:1 for
large text, ≥18pt or ≥14pt bold), computed from relative luminance on a
1:1–21:1 scale. Source: W3C Web Accessibility Initiative, "G18: Ensuring
that a contrast ratio of at least 4.5:1 exists between text... and
background," https://www.w3.org/WAI/WCAG22/Techniques/general/G18, accessed
2026-09-06 (retrieved via search synthesis). Paraphrase: WCAG 2.x level AA
requires ≥4.5:1 for normal text and ≥3:1 for large text; level AAA raises
normal text to ≥7:1. Implication for the Harbor charts: this is a screen
accessibility standard, but it is also the only widely agreed, checkable
number available for "is this text legible," so it is a reasonable floor to
hold print figure text to as well, even though the book is printed rather
than screen-read. Computed directly from the book's own `pd-palette.tex`
values (not from any external source, using the WCAG relative-luminance
formula this note cites): `pdink` (#121212) on `pdcream` (#F2EEE6) works out
to a contrast ratio of approximately 16:1 — comfortably clearing even the
7:1 AAA floor for body text — while `pd-palette.tex`'s own comment already
independently flags `pdamber` at 3.71:1 on cream as below the AA floor and
restricts it to "stripes, dots, and display only, never small text." The
sourced rule and the book's already-recorded practice agree.

**[3.1b]** Claim: contrast ratio is a fixed mathematical scale (not a
subjective judgment call) running from 1:1 (identical colors) to 21:1 (pure
black on pure white), which is what makes it possible to state a numeric
floor at all. Source: WebAIM, "Contrast Checker,"
https://webaim.org/resources/contrastchecker/, accessed 2026-09-06
(retrieved via search synthesis). Paraphrase: the tool computes the same
relative-luminance-based ratio W3C's technique document specifies, letting
any two hex colors be checked against the 4.5:1/3:1/7:1 thresholds directly.
Implication for the Harbor charts: any new accent color added to
`pd-palette.tex` in the future should be run through this exact check against
`pdcream` (and, for reversed/inverted marks, against `pdink`) before being
approved for use as small text, the same way the file's own comment already
does for `pdamber`, `pdviolet`, and `pdgold`.

### 3.2 Ink-on-cream / why print doesn't get a dark mode

**[3.2a]** Claim: pure-white paper reflects more light and produces more
glare over long reading sessions than cream/off-white stock, which is why
mainstream long-form print defaults to cream rather than bright white.
Source: "In Praise of Cream Paper," https://pianodao.com/2024/09/22/in-praise-of-cream-paper/,
accessed 2026-09-06 (a self-publishing/print-industry explainer, retrieved
via search synthesis; this specific glare/eye-strain claim was not
independently confirmed against a print-science source, so treat it as
industry practice rather than settled optical science). Paraphrase: cream
paper reflects less light, reducing glare and eye strain especially for
extended reading; most mainstream fiction printing uses cream stock rather
than pure white for exactly this reason. Implication for the Harbor charts:
directly validates the book's `pdcream` (#F2EEE6) ground over pure white as
the print-appropriate choice for a text-heavy book, independent of the
contrast-ratio math in 3.1.

**[3.2b]** Claim: print economics themselves push toward light grounds with
dark ink, not the reverse — "knockout" (light text on a dark fill) uses far
more toner/ink than the same area in dark-text-on-light. Source: Matthew
Butterick, "Color," Practical Typography, https://practicaltypography.com/
color.html, accessed 2026-09-06 (retrieved via search synthesis; note that
this source's specific, confirmed claims are about black body text and
toner cost, not about cream vs. white paper specifically — the search result
explicitly noted the page does not address off-white backgrounds, so that
part of the claim rests on 3.2a alone, not on Butterick). Paraphrase: body
text should always be set in a dark, high-contrast color with no exceptions,
and reversed (light-on-dark) type in a laser-printed document can use on the
order of 20x more toner than normal text — a print-cost argument for a
light-ground, dark-ink default that is independent of, and additional to,
the readability argument in 3.2a. Implication for the Harbor charts: this
book's ink/cream/accent system (dark text on a light ground, with saturated
color reserved for rules/fills/marks per `pd-palette.tex`'s own stated
discipline) is the print-economical choice as well as the accessible one —
a book-wide dark-mode variant of the figures, if ever produced for a digital
release, is not simply "invert the existing figures" but a genuinely
separate design problem.

### 3.3 Colorblind-safe pairings

**[3.3a]** Claim: color maps with uneven perceptual steps (rainbow/jet-style)
distort the data they are meant to show, and red-green color maps
specifically are unreadable to a large fraction of color-vision-deficient
readers; both problems are avoidable with color maps designed against
measured human color perception rather than chosen for vividness. Source:
Fabio Crameri, Grace E. Shephard & Philip J. Heron, "The misuse of colour in
science communication," *Nature Communications* 11, 5444 (2020),
https://www.nature.com/articles/s41467-020-19160-7 (also PubMed 33116149),
accessed 2026-09-06 (retrieved via search synthesis of the abstract, not the
full text). Paraphrase: colour maps that visually distort data through
uneven colour gradients, or that are unreadable to those with colour-vision
deficiency, remain prevalent in science, including rainbow-like and
red-green colour maps; the paper's "Scientific colour map" initiative
provides free, perceptually-derived alternatives. Implication for the
Harbor charts: this is the direct citation for why `pd-palette.tex`
deliberately avoids a raw red/green pairing for its status colors (`pderror`
red and `pdhealth` green are far enough apart in both hue *and* lightness
to survive a red-green simulation, unlike a naive red/green pair would be) —
worth confirming that claim by running the palette through a simulator
rather than assuming it, since the file itself doesn't record having done
so.

**[3.3b]** Claim: a specific 8-color qualitative palette (Okabe & Ito, 2008)
is the most widely recommended colorblind-safe categorical set because it
stays separable under both red-green and blue-yellow deficiency *and* spans
a wide luminance range, so it also survives conversion to grayscale.
Source: summarized at sci-draw.com, "Okabe-Ito Colorblind-Safe Palette,"
https://sci-draw.com/blog/colorblind-safe-palettes-okabe-ito-reference,
accessed 2026-09-06 (retrieved via search synthesis; the original is Okabe,
M. & Ito, K., "Color Universal Design," 2008, not independently fetched).
Paraphrase: the eight colors (orange #E69F00, sky blue #56B4E9, bluish green
#009E73, yellow #F0E442, blue #0072B2, vermillion #D55E00, reddish purple
#CC79A7, black) span luminance from near-zero to high, giving a working
grayscale/print fallback even when a color-vision simulation collapses two
hues together. Implication for the Harbor charts: this is a concrete
benchmark to check `pd-palette.tex`'s ten hues against — the palette should
be auditable the same way (does each pair stay separable in lightness alone,
not only in hue), which is a check the file's own comments do not currently
record having run.

### 3.4 Consistent hue-to-category mapping across a document

**[3.4a]** Claim: readers are disconcerted when the same visual
representation — including the same color — is reused inconsistently across
a set of related figures, and building "consistent language and
representations" across a document's figures is explicitly named as a goal
for scientific illustrators. Source: Bang Wong, "Points of view: Color
coding," *Nature Methods* 7, 573 (2010), https://www.nature.com/articles/
nmeth0810-573 (PDF mirror consulted for phrasing:
https://static1.squarespace.com/static/587e7412be6594f2dc02480f/t/63e0d7f70f60c8044b65b900/1675679747977/Bang_Wong_Point-of-view_collection.pdf),
accessed 2026-09-06 (the mirrored PDF's text extraction is garbled by OCR
artifacts around this phrase; the following fragment reads clean and
complete in the extracted text and is quoted on that basis). Excerpt
(verbatim, isolated clean fragment from an otherwise garbled extraction):
"consistent language and representations so readers can more easily follow
the story." Implication for the Harbor charts: this is the direct
justification for `pd-palette.tex`'s own header comment, "One hue, one
meaning" — but the book does not yet follow its own rule across its full
corpus. Three separate, non-interoperating color-naming systems currently
coexist in this repository: the `pd*` semantic palette in `pd-palette.tex`
(the newer, documented system); a `harborblue`/`shipred`/`seagreen` triad
`\definecolor`'d directly in `docs/harbor-research/figures/../tex/
preamble.tex` per `CONVENTION.md`; and a separately-defined `hh*` palette
(`hhcobalt`, `hhamber`, `hhteal`, `hhink`, `hhpaper`, `hhsand`, `hhgray`)
`\definecolor`'d locally inside individual whitepaper `.tex` files (e.g.
`whitepaper/single-writer-kernel.tex`) even though a byte-identical twin of
`pd-palette.tex` already sits in the same `whitepaper/figures/` directory.
The values have drifted apart under near-matching names — `hhcobalt`
(#003FB8) happens to equal `pdcobalt` exactly, but `hhink` (#1B1712) is not
`pdink` (#121212), `hhamber` (#6B4500) is not `pdamber` (#A66F00), and
`hhteal` (#00564C) is not `pdteal` (#006B5F) — meaning a reader moving
between an `hh*`-styled figure and a `pd*`-styled one is looking at two
different, uncoordinated near-duplicates of what is meant to be one
semantic color system.

**[3.4b]** Claim: for continuous/ordered data, the color function itself
must have a shape that matches the data's shape — monotonic lightness for
one-directional (sequential) data with no natural middle, a lightness
*peak or trough at a meaningful center* for data that diverges around a
reference value — and this shape, not just the choice of hue, is what must
stay fixed for a given data type across a work. Source: Fabio Crameri,
"Scientific colour maps" user guide, https://www.fabiocrameri.ch/ws/
media-library/ce2eb6eee7c345f999e61c02e2733962/readme_scientificcolourmaps.pdf,
and Crameri et al. 2020 (as 3.3a), accessed 2026-09-06 (retrieved via search
synthesis). Paraphrase: sequential colormaps encode "more vs. less" with
monotonic lightness and no implied midpoint; diverging colormaps encode
"above vs. below a reference" and must have their lightness extremum sit at
that reference value, not off-center. Implication for the Harbor charts:
`pd-palette.tex` fixes hue-to-category mappings (cobalt = kernel/truth, teal
= legibility, etc.) but does not yet say anything about which *shape* of
color function a regime diagram should use when its axis is a magnitude
(sequential) versus a signed deviation (diverging) — worth deciding once,
centrally, rather than per-figure, the same way the categorical hue mapping
already is.

---

## 4. Captions and figure-text relations

### 4.1 Caption craft: name what is drawn, then what it shows

**[4.1a]** Claim: a caption's job is to explain how to read the figure and
to supply the precision a picture cannot show on its own — effectively
pre-answering the questions a live audience would ask about it. Source:
Nicolas P. Rougier, Michael Droettboom & Philip E. Bourne, "Ten Simple Rules
for Better Figures," *PLOS Computational Biology* 10(9): e1003833 (2014),
https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1003833
(PMC4161295), accessed 2026-09-06 (retrieved via search synthesis; full text
not directly fetchable in this environment, and the paper's own full text is
not indexed for passage retrieval by the research tools available here).
Paraphrase: the caption should explain how to read the figure and add
precision that cannot be graphically represented; think of it as what you
would say standing in front of a poster, except you must anticipate the
questions in advance rather than answer them live. Implication for the
Harbor charts: this book's existing captions already do a version of this —
`fig-stp-stack-map.tex`'s caption names the figure's structure ("the series
accumulates evidence from left to right") *before* stating its claim ("this
chapter owns the two decisive transformations") — worth keeping that
name-then-claim order as an explicit rule rather than an accident of this
one caption.

**[4.1b]** Claim: a caption's opening sentence should do one of two jobs —
either orient the reader to what information the figure conveys, or
summarize the key finding it shows — and good practice keeps the whole
caption to roughly two sentences doing those jobs in sequence. Source: "How
to Write Figure Captions for Graphs, Charts, Photos, Drawings, and Maps,"
https://erinwrightwriting.com/how-to-write-figure-captions/, and the Caltech
Hixon Writing Center handout, "Composing Effective Figure Captions in
Scientific Articles and Posters," https://writing.caltech.edu/documents/
27629/HWC-FigureCaptionHandout.1-2024.pdf, accessed 2026-09-06 (both
retrieved via search synthesis). Paraphrase: an opening sentence should
either orient (what the figure shows) or summarize (the key finding),
followed by supporting detail; two concise sentences are typically enough.
Implication for the Harbor charts: several of the book's captions run
considerably longer than two sentences (e.g. `fig-b1-frontier.tex`'s
three-panel caption, which is necessarily longer because it describes three
sub-figures) — the two-sentence guideline is a good default for a
single-panel figure, but the book's own small-multiples convention (note
2.1c) will legitimately need a longer, per-panel caption structure, which is
a case this guidance doesn't cover.

### 4.2 Stating idealizations in the introducing sentence

**[4.2a]** Claim: Feynman names the model's central idealization in the very
first substantive sentence of the chapter, before any equation appears, and
reinforces it with a chapter title that states the idealization as bluntly
as possible. Source: Feynman, Leighton & Sands, *The Feynman Lectures on
Physics*, Vol. II, Ch. 40, "The Flow of Dry Water,"
https://www.feynmanlectures.caltech.edu/II_40.html, accessed 2026-09-06.
Excerpt (verbatim): "We suppose that the elementary properties of water are
already known to you... In this chapter we will consider only situations in
which the viscous effects can be ignored." The chapter's own title names the
idealization as "dry" water — inviscid, non-physical water — rather than
burying "we ignore viscosity" in a footnote. Implication for the Harbor
charts: a figure whose model idealizes something away (e.g. a regime diagram
that assumes noiseless measurement, or a relation map that assumes
single-writer semantics) should name that idealization in the caption's
first sentence or in the figure's title label, the way `fig-r1-relation.tex`
already does with its explicit "[verified]"/"[internal]" provenance tags —
Feynman is the citable precedent for stating the idealization *before* the
claim, not after.

**[4.2b]** Claim: Feynman explicitly re-names an earlier idealization at the
exact moment he is about to relax it, rather than leaving the reader to
notice the change unannounced. Source: Feynman, Leighton & Sands, *The
Feynman Lectures on Physics*, Vol. II, Ch. 41, "The Flow of Wet Water,"
https://www.feynmanlectures.caltech.edu/II_41.html, accessed 2026-09-06.
Excerpt (verbatim): "In our 'dry' water approximation we left out the last
term, so we were neglecting all viscous effects." Implication for the Harbor
charts: when a later figure in the book extends or relaxes an earlier
figure's idealization (e.g., a second regime diagram that adds a noise term
a first one assumed away), the later caption should name the earlier
idealization explicitly before dropping it — "the floor above assumed X;
here we add X back in" — rather than silently presenting a more general
model as if it were the original one.

### 4.3 Figure numbering and cross-referencing (Chicago Manual of Style)

**[4.3a]** Claim: figures are numbered sequentially in Arabic numerals in
their own sequence (kept separate from any table numbering), and text
should refer to a specific figure number ("Figure 3 shows...") rather than
its position on the page ("the figure above/below"). Source: The Chicago
Manual of Style Online, Manuscript Preparation FAQ,
https://www.chicagomanualofstyle.org/qanda/data/faq/topics/ManuscriptPreparation/faq0224.html,
and the CMOS/Turabian tip sheet, "Figure and Figure Caption,"
https://www.chicagomanualofstyle.org/dam/jcr:1068177f-911e-4bdd-a5ed-6349c53652d3/Turabian-Tip-Sheet-9.pdf,
accessed 2026-09-06 (both retrieved via search synthesis). Paraphrase:
figures get their own numbering sequence, referenced by number rather than
relative position; a single unnumbered figure may still carry a working
number in the manuscript stage even if the published version omits it.
Implication for the Harbor charts: worth confirming the book's cross-reference
convention (`\label{fig:...}` names like `fig:r1rel`, `fig:swk-stack-map`
already seen in the sampled fragments) consistently produces "Figure N shows
X" prose rather than "the figure above" — a mechanical grep for "figure
above" / "figure below" / "the following figure" across the book's prose
would catch violations of this rule directly.

**[4.3b]** Claim: this is standard, widely-taught guidance, not a
CMOS-specific idiosyncrasy — independent style guides restate the same
numbering and cross-reference rules. Source: La Trobe University Library,
"Images, figures and tables — Chicago," https://latrobe.libguides.com/
chicago/images, and CSUSB Library, "Captions — Chicago Style,"
https://libguides.csusb.edu/chicago/captions, accessed 2026-09-06 (both
retrieved via search synthesis, both independently restating CMOS). Implication
for the Harbor charts: gives the lead two citable, easily-checked authorities
(the primary CMOS FAQ plus at least one independent library guide) if the
house style needs to justify a numbering/cross-reference convention to a
copyeditor unfamiliar with the book's internal `\label` scheme.

---

## Not reached

No source this research attempted to use returned nothing at all — every
attempted URL yielded either a direct passage (via Firecrawl's indexed
search) or a synthesized paraphrase with source links (via `WebSearch`),
even where direct `WebFetch` of the page itself was blocked by this
environment's network egress policy (see the retrieval note at the top of
this file). Two honesty caveats belong here instead of a true "not reached"
list:

- Edward Tufte's own books (*The Visual Display of Quantitative Information*,
  *Envisioning Information*, *Beautiful Evidence*) were never fetched
  directly. Every Tufte quotation in Section 2.1 is a secondary quotation via
  a site that cites him (GeeksforGeeks, InfoVis:Wiki, Chartbuddy, Juice
  Analytics, or Tufte's own edwardtufte.com notebook page as surfaced by
  search). The wording is consistent across independent secondary sources
  for each quote, which is reassuring, but the lead should treat these as
  "widely and consistently attributed to Tufte," not as this researcher's own
  page-in-hand verification of Tufte's text.
- Rougier, Droettboom & Bourne's "Ten Simple Rules for Better Figures" (note
  4.1a) could not be retrieved as full text by any tool available in this
  session (PLOS's own site is blocked to direct fetch, and the paper is not
  indexed for full-text passage retrieval by the research-paper tools used
  here). The claims cited from it are a `WebSearch` synthesis of its
  abstract and secondary discussion, not a direct reading of its ten rules
  in full — worth a direct read by the lead before leaning on it heavily,
  since only two of its ten rules (captions, chartjunk) were usefully
  surfaced here.

## Contradictions between sources

Stated neutrally, without resolving them — that is the lead's call.

1. **Minimalism vs. redundancy.** Tufte's data-ink ratio (2.1a) says erase
   every mark that does not track a data value. The visual-search and
   accessibility literature (2.11a-b, 3.3a-b) says a figure should
   deliberately repeat a category's identity across more than one channel
   (color *and* shape, or color *and* a text label) specifically so a
   colorblind reader or a grayscale photocopy is not stranded. That second
   channel is, by Tufte's own accounting, non-data ink that could be erased —
   the two traditions give opposite advice about whether to erase it.

2. **Specialized packages vs. one plain-TikZ house style.** The general TikZ
   ecosystem's default answer to "how do I draw an X" is almost always "load
   the package for X" — `automata` for state machines, `tikz-cd` for
   commutative diagrams, `istgame`/`forest` for game trees, `pgf-umlsd`/`msc`
   for sequence diagrams (Sections 2.5-2.9), and Miro's guidance (2.4b)
   explicitly endorses reaching for established notations. This book's own
   `CONVENTION.md`, and the CERFACS course's own worked lesson (1.1a), instead
   solve the same consistency problem by hand-styling plain `tikzpicture`
   nodes and edges with one shared style vocabulary (`relnode`/`relarrow`/
   `regimebox`) across every figure kind. Adopting a new specialized package
   per diagram type would gain built-in semantics (e.g. `istgame`'s
   information-set ellipses) at the cost of introducing a visual grammar that
   does not match the rest of the book's figures; staying in plain TikZ keeps
   one visual grammar at the cost of hand-building things a package would
   give for free.

3. **Hue-for-category vs. lightness-does-the-real-work.** Bertin's framework
   (2.2a) treats hue as the variable best suited to nominal/categorical
   distinctions, which is the stated basis for `pd-palette.tex`'s "one hue,
   one meaning" rule. The colorblind-safe and scientific-colormap literature
   (3.3a-b, 3.4b) treats *lightness/value* as the variable that must carry
   the real signal whenever a figure might be viewed by a colorblind reader
   or printed in grayscale, with hue reduced to a secondary, non-load-bearing
   cue (Okabe-Ito's palette is explicitly luminance-spread; Crameri's
   sequential maps are defined by a monotonic lightness ramp, not by hue at
   all). A category system built primarily around distinct hues (as
   `pd-palette.tex`'s ten colors are) needs a second audit — do the hues also
   separate in lightness — that a purely Bertin-style "assign a hue per
   category" process would not by itself guarantee.

4. **Caption economy vs. caption self-sufficiency.** Chicago Manual of Style
   (4.3a) treats the caption as a short pointer — a number and a label, with
   "Figure 3 shows..." leaning on the surrounding prose for the actual
   explanation. "Ten Simple Rules for Better Figures" (4.1a) treats the
   caption as a stand-alone explanation that must anticipate every question a
   viewer might ask *without* access to the body text, the way a caption must
   function if the figure is later reused in a slide deck or shared as a
   standalone image. A book whose figures might also circulate independently
   (as this book's figures already do, rendered as standalone PDFs per
   `CONVENTION.md`) sits between these two conventions rather than cleanly
   inside either one.

5. **Real-data discipline vs. generic diagram-craft freedom.** Almost none of
   the general TikZ/diagram-design sources gathered here (texample.net,
   tikz.net, Miro, the CERFACS course) treat a diagram's coordinates as
   needing to trace back to a real, re-run computation — they are optimized
   for visual clarity and balance, and a coordinate is "correct" if it looks
   right. This book's own `CONVENTION.md` imposes a stricter, additional
   discipline on top of all of the above: every plotted number must be
   "real, recomputed directly from the figure's source script," tagged
   `[verified]` or `[internal]`, on pain of exactly the kind of fabricated-
   or clipped-curve bugs its own header comments describe catching. None of
   the general diagram-craft literature gathered in Sections 1-2 argues
   against this — it simply never raises the question, because it is not a
   problem general diagram craft needs to solve. Applying the sourced
   craft advice (e.g. `fillbetween` in note 1.9a) to this book's figures
   still has to pass through the book's own, stricter falsification-first
   gate before it is safe to use.


---

# Legibility and print sources (gathered 2026-09-06)

Quotations with URLs, gathered for the five-point legibility rubric in `craft-rules.md` and the kind table in `taxonomy.md`. Section numbers below are the gatherer's.


**Methodology note on access.** The sandbox's network egress proxy blocks direct `WebFetch` to several of the required domains outright (`clauswilke.com`, `mermaid.js.org` / `mermaid.ai`, `edwardtufte.com`, `perceptualedge.com`, `www.cs.ubc.ca`, `pdfs.semanticscholar.org`, `nature.com`, `arxiv.org`, `ux.stackexchange.com` — all returned `EGRESS_BLOCKED` or a fetch refusal). For every such domain I instead used the Firecrawl search tool, which returned full page text indexed directly from the cited URL (the URL shown below is the page the quoted text actually came from, per the search tool's own result metadata — not a URL I rendered myself with a browser). Where I could not get the exact URL's own text this way, I say so and cite the closest reachable secondary reproduction instead, per instructions. Dates fetched are all 2026-09-06 unless noted.

---

## 1. Claus Wilke, *Fundamentals of Data Visualization* (clauswilke.com/dataviz)

All URLs below are on `clauswilke.com`; content retrieved via Firecrawl search index (direct WebFetch blocked by egress proxy) on 2026-09-06.

**Directory of visualizations** — https://clauswilke.com/dataviz/directory-of-visualizations.html (§5, "Amounts")
> "The most common approach to visualizing amounts (i.e., numerical values shown for some set of categories) is using bars, either vertically or horizontally arranged"

Same page, §5.3 "Proportions":
> "Proportions can be visualized as pie charts, side-by-side bars, or stacked bars ... and as in the case for amounts, bars can be arranged either vertically or horizontally."

Same page, §5.6 "Uncertainty":
> "Error bars are meant to indicate the range of likely values for some estimate or measurement."

**Ugly, bad, and wrong figures** — https://clauswilke.com/dataviz/introduction.html (Ch. 1, "Ugly, bad, and wrong figures")
> "ugly—A figure that has aesthetic problems but otherwise is clear and informative."
> "bad—A figure that has problems related to perception; it may be unclear, confusing, overly complicated, or deceiving."
> "wrong—A figure that has problems related to mathematics; it is objectively incorrect."

**Redundant coding** — https://clauswilke.com/dataviz/redundant-coding.html (Ch. 20)
> "The general solution in all these scenarios is to use color to enhance the visual appearance of the figure without relying entirely on color to convey key information."
> "I refer to this design principle as redundant coding, because it prompts us to encode data redundantly, using multiple different aesthetic dimensions."

**Direct labeling** — same page, §20.2 "Designing figures without legends"
> "The general strategy we can employ is called direct labeling, whereby we place appropriate text labels or other visual elements that serve as guideposts to the rest of the figure."

**Multi-panel figures** — https://clauswilke.com/dataviz/multi-panel-figures.html (Ch. 21, §21.2 "Compound figures")
> "Sometimes we simply want to combine several independent panels into a combined figure that conveys one overarching point."

Same page, on labeling compound-figure panels:
> "The labels should not be the first thing you see when you look at a compound figure. In fact, they don't need to stand out at all."

**Avoid line drawings** — https://clauswilke.com/dataviz/avoid-line-drawings.html (Ch. 25)
> "Whenever possible, visualize your data with solid, colored shapes rather than with lines that outline those shapes."

**Don't go 3D** — https://clauswilke.com/dataviz/no-3d.html (Ch. 26, §26.1)
> "3D is used simply to decorate and adorn the plot. I consider this use of 3D as gratuitous. It is unequivocally bad and should be erased from the visual vocabulary of data scientists."

**Balance the data and the context** — https://clauswilke.com/dataviz/balance-data-context.html (Ch. 23, §23.1 "Providing the appropriate amount of context") — page snippet only, truncated by the indexer:
> "The idea that distinguishing between data and non-data ink may be useful was popularized by Edward Tufte in ..."
(Could not retrieve the rest of this sentence past the ellipsis; the full chapter text was not returned by the search index and direct fetch is blocked. Best alternative: the same idea is covered fully under Tufte, item 5 below.)

**Use larger axis labels** — https://clauswilke.com/dataviz/small-axis-labels.html (Ch. 24) — also truncated by the indexer, corroborated by a secondary reproduction (academia.edu, "Praise for Fundamentals of Data Visualization" preview):
> "If you take away only one single lesson from this book, make it this one: pay attention to your axis labels, axis tick labels, and ..."
A further passage from the same chapter, reached via a full-text mirror (dokumen.pub, "Citation preview" of the O'Reilly edition), 2026-09-06:
> "Importantly, we can overdo it and make the labels too big ... The text elements are fairly large, and their size may be appropriate if the figure is meant to be reproduced at a very small scale."

**Color pitfalls** — https://clauswilke.com/dataviz/color-pitfalls.html (Ch. 19, §19.1)
> "One common mistake is trying to give color a job that is too big for it to handle, by encoding too many different items in different colors."
> "Use direct labeling instead of colors when you need to distinguish between more than about eight categorical items."

**Visualizing proportions** (why pie is limited) — via dokumen.pub full-text mirror of the O'Reilly edition (Ch. 10 / Ch. 17 "The principle of proportional ink"), corroborating https://clauswilke.com/dataviz/proportional-ink.html:
> "Even though technically the data values are mapped onto angles ... in practice we are typically not judging the angles of a pie chart."
> "Because the area of each pie wedge is proportional to its angle ... pie charts satisfy the principle of proportional ink. However, we perceive the area in a pie chart differently from the same area in a bar plot."
And from the Directory of visualizations page directly:
> "When visualizing multiple sets of proportions or changes in proportions across conditions, pie charts tend to be space-inefficient and often obscure relationships."

**Visualizing uncertainty** — https://clauswilke.com/dataviz/visualizing-uncertainty.html (Ch. 16)
> "Whenever you visualize uncertainty with error bars, you must specify what quantity and/or confidence level the error bars represent."
> "Statistics textbooks and online tutorials sometimes publish rules of thumb of how to judge significance from the extent to which error bars do or don't overlap. However, these rules of thumb are not reliable and should be avoided."

---

## 2. Cleveland & McGill (1984), "Graphical Perception: Theory, Experimentation, and Application to the Development of Graphical Methods"

Primary text (author-uploaded full text), fetched via ResearchGate, 2026-09-06 — https://www.researchgate.net/publication/6062457_Graphical_Perception_and_Graphical_Methods_for_Analyzing_Scientific_Data
> "judgment of position along a common scale is stipulated to be more accurate than judgment of position along identical, non-aligned scales."

Same page, the paper's own ranking table (reproduced verbatim as tabulated in the source text):
> "Rank Aspect judged / 1 Position along a common scale / 2 Position on identical but nonaligned scales / 3 Length / 4 Angle – Slope (with θ not too close to 0, π/2, or π radians) / 5 Area / 6 Volume – Density – Color saturation / 7 Color hue"

Scholarly summary quoting the same ranking, JSTOR record page, fetched 2026-09-06 — https://www.jstor.org/stable/43094719 ("Guidelines for Evaluating Graphical Designs: A Framework...")
> "the following list shows the Cleveland and McGill ordering of the elementary perceptual tasks from most to least accurate: 1. Position along a common scale. 2 ..."

---

## 3. Bertin's visual variables (selective / ordered / quantitative)

Axis Maps cartography guide, fetched 2026-09-06 — https://www.axismaps.com/guide/visual-variables
> "Jacques Bertin proposed an original set of "retinal variables" in Semiology of Graphics (1967): Position, Size, Shape, Value (lightness), Color hue, Orientation, Texture"
> "A selective variable allows us to immediately isolate a group of signs based on a change in the variable."
> "Shape is the only one of Bertin's variables that he thought is never selective, along with orientation when used for area representation"
> "Size and value, for example, have an immediately perceptible order ... Color hue is an example of a non-ordered variable: there is no clear ordering of, say, red, green, and blue."
> "Besides position, where we can guess the measurable distance between symbols, Bertin considered only size variation to be quantitative."

International Encyclopedia of Geography entry ("Visual Variables," Robert E. Roth, Wiley 2017), fetched via ResearchGate-hosted PDF, 2026-09-06 — https://www.researchgate.net/publication/317266613_Visual_Variables
> "Bertin (1967/1983) originally identified seven visual variables that can be manipulated to encode information."
> "Bertin believed location, size, color value, and texture to be ordered visual variables ... Bertin believed quantitative perception to be restricted to location and size only."

---

## 4. Tamara Munzner, *Visualization Analysis and Design* — marks/channels effectiveness ranking

Munzner's own course slide PDF, hosted at UBC, fetched via Firecrawl search index 2026-09-06 (direct WebFetch to cs.ubc.ca blocked) — https://www.cs.ubc.ca/~tmm/talks/vad/436V-22-4x4.pdf ("Visualization Analysis & Design," Ch. 1/5 slides)
> "Channels: Rankings — Magnitude Channels: Ordered Attributes / Identity Channels: Categorical Attributes — Position on common scale, Position on unaligned scale, Length (1D size), Area (2D size)"

Book text (same ranking, fuller list), reached via a full-text mirror of the CRC Press edition, dokumen.pub, 2026-09-06 — https://dokumen.pub/visualization-analysis-and-design-9781466508934-1466508930.html
> "Position on common scale / Position on unaligned scale / Length (1D size) / Area (2D size) / Depth (3D position) / Color luminance / Color saturation / Curvature / Volume (3D size)"
> "Ordered data should be shown with the magnitude channels, and categorical data with the identity channels."
> "Cleveland and McGill's experiments on the magnitude channels [Cleveland and McGill 84a] showed that aligned position against a common scale is most accurately perceived, followed by unaligned position against an identical scale, followed by length, followed by angle."

---

## 5. Tufte — data-ink ratio, chartjunk, small multiples, "smallest effective difference"

`edwardtufte.com` itself is blocked by the egress proxy and did not surface the relevant notebook pages via the search index either, so all quotations below are Tufte's own words as reproduced by secondary/course sources; I disclose this rather than presenting edwardtufte.com as fetched.

Chartjunk — course reading page quoting *The Visual Display of Quantitative Information*, fetched 2026-09-06 — https://mikem-radicalresearch.quarto.pub/environmental-data-visualization/chartJunk.html
> "The interior decoration of graphics generates a lot of ink that does not tell the viewer anything new."

Data-ink ratio — "The Gospel According to Tufte," course PDF quoting Tufte directly, fetched 2026-09-06 — https://www-personal.umich.edu/~jpboyd/eng403_chap2_tuftegospel.pdf
> ""Above all else show the data" — Edward Tufte (1983)"
> "data-ink ratio = total ink used to print the graphic = the proportion of a graphic's ink devoted to the non-redundant display of data-information"
> "Above all else show the data. ... Erase non-data-ink."

Data-ink definition — InfoVis:Wiki, fetched 2026-09-06 — https://infovis-wiki.net/wiki/Data-Ink_Ratio
> "Data-ink is the non-erasable core of a graphic, the non-redundant ink arranged in response to variation in the numbers represented."

Smallest effective difference — secondary summary (Visual Cinnamon book-review page), fetched 2026-09-06 — https://www.visualcinnamon.com/resources/learning-data-visualization/books/, quoting *Visual Explanations*:
> "make all visual distinctions as subtle as possible, but still clear and effective"

Small multiples — **not reached as an exact Tufte quotation.** `edwardtufte.com` is blocked and the search index did not return the *Envisioning Information* small-multiples passage verbatim; the closest reachable material was a secondary paraphrase (a GitHub-hosted style guide summarizing, not quoting, the chapter), which I am not presenting as a Tufte quotation per the no-paraphrase instruction. Flagging as a gap rather than fabricating a quote.

---

## 6. Stephen Few (perceptualedge.com) — table vs. graph

`perceptualedge.com`'s PDFs are blocked for direct WebFetch, but Firecrawl's search index returned full text from one PDF on that domain directly:

Fetched 2026-09-06 — https://www.perceptualedge.com/articles/visual_business_intelligence/save_the_pies_for_dessert.pdf ("Save the Pies for Dessert," Visual Business Intelligence Newsletter, Aug 2007)
> "Of all the graphs that play major roles in the lexicon of quantitative communication, however, the pie chart is by far the least effective."
> "Pie charts only make it easy to judge the magnitude of a slice when it is close to 0%, 25%, 50%, 75%, or 100%."
> "Graphs are useful when a picture of the data makes meaningful relationships visible (patterns, trends, and exceptions) that could not be easily discerned from a table of the same data."

The table-vs-graph rule specifically, from "Designing Effective Tables and Graphs" (perceptualedge.com/images/Effective_Chart_Design.pdf) — that exact URL did not return text through the index, so quoted here from a direct reproduction of the same PDF, Perceptual Edge's own document as re-hosted on Yumpu, fetched 2026-09-06 — https://www.yumpu.com/en/document/view/28778259/designing-effective-tables-and-graphs-perceptual-edge
> "A table works best when: It is used to look up individual values [and] the values must be expressed precisely."
> "A graph works best when [ ] the message is contained in the shape of the data (patterns, trends ..."

---

## 7. Mermaid diagram catalogue

`mermaid.js.org` now redirects its docs to `mermaid.ai/open-source/...`; direct WebFetch to both hosts is blocked by the egress proxy, so all entries below were retrieved via the Firecrawl search index, which returned the indexed page text from the specific `mermaid.ai/open-source/syntax/*.html` URL cited (current canonical location of the docs formerly at mermaid.js.org). Fetched 2026-09-06.

| Diagram type | Docs say it shows | URL |
|---|---|---|
| Flowchart | "Flowcharts are composed of nodes (geometric shapes) and edges (arrows or lines)." | https://mermaid.ai/open-source/syntax/flowchart.html |
| Sequence diagram | "A Sequence diagram is an interaction diagram that shows how processes operate with one another and in what order." | https://mermaid.ai/open-source/syntax/sequenceDiagram.html |
| Class diagram | Docs page itself is styling-only prose; a secondary guide states: "Mermaid class diagrams model the static structure of a codebase using UML notation." (macmdviewer.com) | https://mermaid.ai/open-source/syntax/classDiagram.html |
| State diagram | ""A state diagram is a type of diagram used in computer science and related fields to describe the behavior of systems ... composed of a finite number of states" [Wikipedia, quoted in-page]" | https://mermaid.ai/open-source/syntax/stateDiagram.html |
| Entity Relationship diagram | "An entity–relationship model (or ER model) describes interrelated things of interest in a specific domain of knowledge ... specifies relationships that can exist between entities" | https://mermaid.ai/open-source/syntax/entityRelationshipDiagram.html |
| User Journey diagram | "User journeys describe at a high level of detail exactly what steps different users take to complete a specific task within a system, application or website." | https://mermaid.ai/open-source/syntax/userJourney.html |
| Gantt chart | "Gantt Charts will record each scheduled task as one continuous bar that extends from the left to the right." | https://mermaid.ai/open-source/syntax/gantt.html |
| Pie chart | "A pie chart (or a circle chart) is a circular statistical graphic, which is divided into slices to illustrate numerical proportion." | https://mermaid.ai/open-source/syntax/pie.html |
| Quadrant Chart | Docs are syntax-only; no "what it shows" prose sentence was returned — the closest is the mechanical description: "quadrant-[1,2,3,4] determine what text would be displayed inside the quadrants." | https://mermaid.ai/open-source/syntax/quadrantChart.html |
| Requirement diagram | "A Requirement diagram provides a visualization for requirements and their connections, to each other and other documented elements." | https://mermaid.ai/open-source/syntax/requirementDiagram.html |
| GitGraph (Git) diagram | "Mermaid syntax for a gitgraph is very straight-forward and simple ... Each gitgraph[sic], is initialized with main branch." | https://mermaid.ai/open-source/syntax/gitgraph.html |
| C4 diagram | "C4 Diagram: This is an experimental diagram for now ... 5 types of C4 charts are supported." | https://mermaid.ai/open-source/syntax/c4.html |
| Mindmap | "The syntax for creating Mindmaps is simple and relies on indentation for setting the levels in the hierarchy ... a text outline to generate a hierarchical mindmap." | https://mermaid.ai/open-source/syntax/mindmap.html |
| Timeline | ""A timeline is a type of diagram used to illustrate a chronology of events, dates, or periods of time. A basic timeline presents a list of events in chronological order"" | https://mermaid.ai/open-source/syntax/timeline.html |
| ZenUML | "Mermaid can render sequence diagrams with ZenUML. Note that ZenUML uses a different syntax than the original Sequence Diagram in mermaid." | https://mermaid.ai/open-source/syntax/zenuml.html |
| Sankey diagram | "A sankey diagram is a visualization used to depict a flow from one set of values to another." | https://mermaid.ai/open-source/syntax/sankey.html |
| XY chart | Docs are example-only; no definitional sentence returned by the index (v11.17.0+ legend example shown instead). | https://mermaid.ai/open-source/syntax/xyChart.html |
| Block diagram | Section heading only: "Introduction to Block Diagrams ... In Mermaid, these blocks are easily created using simple text labels." | https://mermaid.ai/open-source/syntax/block.html |
| Packet diagram | "A packet diagram is a visual representation used to illustrate the structure and contents of a network packet." | https://mermaid.ai/open-source/syntax/packet.html |
| Kanban | "A Kanban diagram in Mermaid starts with the kanban keyword, followed by the definition of columns (stages) and tasks within those columns." | https://mermaid.ai/open-source/syntax/kanban.html |
| Architecture diagram | Docs page is syntax/config only (grid-layout examples); no definitional sentence returned by the index. | https://mermaid.ai/open-source/syntax/architecture.html |
| Radar diagram | Docs page is syntax-only (axis/curve keyword reference); no definitional sentence returned by the index. | https://mermaid.ai/open-source/syntax/radar.html |
| Treemap | "A treemap diagram displays hierarchical data as a set of nested rectangles. Each branch of the tree is represented by a rectangle, which is then tiled with..." | https://mermaid.ai/open-source/syntax/treemap.html |

Full current inventory (for cross-check against the list above), from the syntax-reference index page and a third-party diagram-notation comparison, both fetched 2026-09-06:
> "Block Diagram · Packet · Kanban · Architecture · Radar · Event Modeling · Treemap · Venn · Ishikawa · Wardley ..." (https://mermaid.ai/open-source/intro/syntax-reference.html)
> "The supported types now include flowchart, sequence, class, state, entity-relationship, Gantt, pie, gitGraph, requirement, user journey, timeline, mindmap, Sankey, C4 (experimental), quadrant chart, ZenUML, block, packet, kanban, architecture, radar, treemap, venn, ishikawa, and tree-view diagrams." (https://hidekazu-konishi.com/entry/diagramming_c4_plantuml_mermaid_selection_guide.html)

---

## 8. LaTeX/TikZ idioms

All fetched 2026-09-06.

**pgfgantt** (Gantt) — https://texdoc.org/serve/pgfgantt/0
> "The pgfgantt package provides the ganttchart environment, which draws a Gantt chart within a TikZ picture."

**pgf-umlsd** (sequence diagrams) — https://ctan.org/pkg/pgf-umlsd
> "PGF-umlsd – Draw UML Sequence Diagrams — LaTeX macros to draw UML diagrams using pgf"

**tikz-uml** (sequence/class/state diagrams, alternative) — https://tikzuml.pages.math.cnrs.fr/userguide.html
> "the package contains definitions of complete class diagrams, use case diagrams, sequence diagrams, state diagrams, and object diagrams."
(Related standalone package on CTAN, `UML`, fetched via https://ctan.org/pkg/UML : "Draw UML diagrams in LaTeX for writing UML (Unified Modelling Language) diagrams in LaTeX. Currently, it implements a subset of class...")

**TikZ automata library** (state machines) — https://tikz.dev/library-automata (web mirror of the official pgfmanual)
> "This package[sic] provides shapes and styles for drawing finite state automata and Turing machines. For each state of the automaton, there should be one node with ..."

**sankey** (CTAN package literally named `sankey`) — https://ctan.org/pkg/sankey?lang=en
> "This package provides macros and an environment for creating Sankey diagrams, i.e. flow diagrams in which the width of the arrows is proportional to the flow ..."

**pgfplots** (xy, bar, quadrant-style plots) — https://ctan.org/pkg/pgfplots?lang=en
> "PGFPlots draws high-quality function plots in normal or logarithmic scaling with a user-friendly interface directly in TeX."

**tikz-cd** (commutative diagrams) — https://ctan.org/pkg/tikz-cd?lang=en
> "The general-purpose drawing package TikZ can be used to typeset commutative diagrams and other kinds of mathematical pictures, generating high-quality results."

**forest** (trees) — https://ctan.org/pkg/forest?lang=en
> "The package provides a PGF/TikZ-based mechanism for drawing linguistic (and other kinds of) trees."

**smartdiagram** — https://ctan.org/pkg/smartdiagram?lang=en
> "The package will create smart diagrams from lists of items, for simple documents and for presentations."

**pgf-pie** — https://ctan.org/pkg/pgf-pie?lang=en
> "The package provides the means to draw pie (and variant) charts, using PGF/TikZ."

**TikZ `matrix` for tables-as-figures** — **not reached.** Searches for the pgfmanual's own prose on the `matrix` library (used for grid/table-like figures) either returned no definitional sentence or were blocked; the only material surfaced was a code example (`\matrix[matrix of nodes, ...]`) on a Hugging Face dataset page (https://huggingface.co/datasets/nllg/datikz), which is example code, not a documentation quotation about what the feature is for. Flagging as a gap rather than fabricating a quote.

---

## 9. Print legibility numbers

All fetched 2026-09-06.

**Minimum type size, figure labels/captions:**

Nature-family journals (Communications Materials / Communications Physics formatting guidelines) — https://www.nature.com/commsmat/submit/formatting-guidelines
> "All lines should be at least 0.1 mm (0.3 pt) wide."
(Same page also states, per the search index's description snippet: "Do not use faint lines and/or lettering and check that all lines and lettering within the figures are legible at final size.")

Science/AAAS submission instructions — https://www.science.org/content/page/instructions-preparing-initial-manuscript ("Preparation of figures," General guidelines)
> "Size symbols so that they will be distinguishable when the figure is reduced (6 point minimum). Line widths should be legible upon reduction (minimum of 0.5 point at the final reduced size)."

IEEE paper-preparation template, reproduced on arXiv (direct arxiv.org WebFetch blocked; text retrieved via search index) — https://arxiv.org/html/2412.20320v2 ("Preparation of Papers for IEEE TRANSACTIONS and JOURNALS")
> "Figure labels should be legible, approximately 8 to 10 point type."
> "Labels should appear centered below each subfigure in 8 point Times New Roman font"

**Minimum line weight for print:**

University of Michigan prepress/print specification PDF — https://record.umich.edu/sites/default/files/mwp_four_color_specifications.pdf
(directly addresses tint, see below; for line weight the best reached source is a secondary practitioner summary rather than a publisher's own page)
Secondary summary, fetched 2026-09-06 — https://graphicdesign.stackexchange.com/questions/24768/what-should-be-considered-when-using-very-thin-lines-on-a-print-piece
> "In most cases, a minimum line weight for commercial printing is .25pt."
Amazon KDP's own line-thickness guidance was not returned in fetchable form directly; a community forum thread paraphrasing it was the closest reached: "According to the submission guidelines, minimum line thickness should be 0.75 point/0.01"/0.3 mm." (https://www.kdpcommunity.com/s/question/0D52T00005QrAbtSAF/minimum-line-thickness) — flagging this one as a paraphrase-of-a-guideline rather than the guideline's own text, since KDP's own help page text was not retrieved.

**Minimum tint percentage (offset):**

University of Michigan print specifications PDF, fetched 2026-09-06 — https://record.umich.edu/sites/default/files/mwp_four_color_specifications.pdf
> "Recommended screen tint minimum 10%-20% and maximum 70%-80%. A 75% screen tint will print solid. The combined screen tints not to exceed 260%."

---

## 10. Textbook typography measure

**Bringhurst, characters per line** — full-text scan of *The Elements of Typographic Style*, fetched 2026-09-06 — https://readings.design/PDF/the_elements_of_typographic_style.pdf (§2.1.2, "Choose a comfortable measure")
> "Anything from 45 to 75 characters is widely regarded as a satisfactory length of line for a single-column page set in a serifed text face in a text size."
> "The 66-character line (counting both letters and spaces) is widely regarded as ideal."
Same source, on copyfitting:
> "A typical lowercase alphabet length for a 10 pt text font is 128 pt, and the copyfitting table tells us that such a font set to a 25-pica measure will yield roughly 65 characters per line."

**Standard textbook trim sizes:**

Amazon KDP (a working book-publishing platform's own specification page), fetched 2026-09-06 — https://kdp.amazon.com/help/topic/GVBQ3CMEQW3W2VL6
> "The most common trim size for books in the US is 6" x 9" (152.4 x 228.6 mm), but you have several other options."
Same page lists 7" x 10" and 8" x 10" as available standard trim sizes alongside 6"x9", 8.5"x8.5", and 8.5"x11".

Blurb.com book-dimensions guide, fetched 2026-09-06 — https://www.blurb.com/book-dimensions
> "Textbooks and academic books: Sizes typically range from 6 x 9 in up to 8.5 x 11 in."
