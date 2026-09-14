# Craft rules

How a figure in the Harbor library is judged and drawn. The rules are in force for
every fragment under `whitepaper/figures/` and `website-v2/public/whitepaper/figures/`
and for every new figure. Mechanics are enforced by `scripts/tikz_precheck.py`
(source) and `scripts/figcheck.py` (rendered PDF); the judgment rules are applied by
the author on the rendered page, never on the fragment in isolation.

## 0. Before drawing: the brief and the atlas

No fragment is drawn or redrawn without a six-line brief (from
`tikz-figure-engineering`, Gate 0): the **reader question**; the **one-sentence claim**
with its direction explicit; the **evidence** (objects, cardinality, units, source
script); what the figure **must distinguish**; the **grammar chosen and the grammar
rejected**, with one sentence on why the rejected one would mislead; and the
**acceptance test**, what a five-second reader should be able to say. The chapter
specs under the audit directory carry these fields per figure.

Every canonical figure also has a row in
`skills/whitepaper-figure-system/references/semantic-figure-atlas.md` (stable id such
as `II/fig:swk-claim-lifecycle`). Look the row up first. Its prescribed grammar is
the default; it is overridden only with a written rationale in the triage table, and
the row is then updated in the same change. A deleted figure loses its row; a new
figure gains one; `check_atlas_coverage.py` is the drift gate.

## 1. The five-point legibility rubric

A figure stays in the book only if it passes all five on the page where it sits.
The default verdict is *fails*; a figure earns *keep*.

1. **One readable fact.** Write, in one sentence, what a reader reads off the drawing
   that the caption could not simply say. If that sentence *is* the caption, the
   content is a sentence or a table, not a figure. Dots on lines that show "there are
   events" fail; a Gantt band whose right edge meets commit 3 passes.
2. **Concrete instance.** Real labels: commit numbers, actor names, the worked example's
   own numbers, state names from the code. No anonymous dots, no unnamed steps, no
   axis without a unit or an ordering. Cleveland and McGill's ranking of perceptual
   tasks is the reason: position on a common scale is read accurately; colour value,
   area and unanchored length are not, so a fact that lives only in the width of a
   grey band is a fact the reader does not get.
3. **Anchored geometry.** Every mark sits on a guide or an axis; every band has a
   drawn edge; every axis says what it measures. Nothing floats. Regions are edged,
   not merely tinted.
4. **Print contrast at 100 %.** Fills at 24 % alpha or more with a drawn edge; hairlines
   0.5 pt or heavier; datum marks 2 pt radius or more; text `\footnotesize` or larger
   *at final scale*. `\resizebox` factors below 0.85 are forbidden because they take a
   legal 8 pt label to an illegal 6.8 pt one. Test the figure as a 150 dpi PNG at
   1.0×, which is what a phone PDF viewer shows.
5. **No collisions.** No line through text, no label over a label, no ink below the
   picture's own bottom bound inside the `figure` environment (the black-bar-through-
   the-caption class). figcheck T2–T4 and T8 clean.

## 2. Page role, decided before the drawing

Judge the page, then the figure. Name the page's one idea. Then classify the figure:

- **carries** — the idea is read off the figure; the prose points at it;
- **supports** — the figure adds an instance the prose needs but does not depend on;
- **decorates** — the figure repeats the prose or the adjacent table;
- **interrupts** — the figure splits an argument (an `[H]` float mid-sentence) or answers
  a question the page has not asked yet.

Only *carries* and *supports* survive. A *supports* figure next to a table saying the
same thing loses to the table. A page whose idea needs a visual and has none gets an
*add* row in the triage: a simulation result, a protocol ladder, a state machine, a
terminal session.

Dispositions: **keep** · **restyle** (same idea and layout, mechanics only) · **redraw**
(same idea, new kind) · **table** (the content is a classification or a list) ·
**delete** (the sentence already does the work) · **add**.

## 3. Choosing the kind

`taxonomy.md` maps idea shapes to diagram kinds and TikZ idioms. Three rules override it:

- A **classification** (n things × m properties) is a `booktabs` table, never a dot
  matrix, never icons on a rail. Tables are read; matrices of dots are looked at.
- A **schematic curve** with no data behind it ("coordinates are schematic") is a
  sentence. If the shape matters, compute it from the chapter's script and plot the
  points.
- A **mechanism in time** is a sequence diagram or a Gantt with named participants and
  numbered steps, never an arrangement of arrows around a metaphor.

## 4. Mechanics (enforced)

Styles live in `figures/pd-figure-language.tex` (twins, byte-identical). Use them; do
not restyle inline. The file's own header carries the typographic law in full,
with the measurements behind it; this table is its index.

### The typographic law, in one line

**One size for every named text role — `\pdfiglabelsize`, which is `\footnotesize`
(8.72 pt in the Book, 8.97 pt in a standalone chapter, measured). Roles separate by
weight, slope, family and ink, never by size.** `\scriptsize` measures 6.97 pt in
the Book, under figcheck's 7 pt T1 floor before a single width promotion, which is
why it is an error rather than a preference.

| element | style | rule |
|---|---|---|
| panel titles | `pd panel title` | label size, bold |
| row / actor names | `pd row label` | label size, bold, anchored east of the row |
| row names on a dark band | `pd reverse row label` | as above, cream on ink |
| tick numerals, axis titles | `pd axis label` | label size, recessive ink |
| direct labels | `pd direct label` | label size, cream backing, never across a line |
| direct labels on a dark band | `pd reverse label` | label size, cream, no backing |
| identifiers, paths, literals | `pd mono label` | label size, monospace |
| a terminal outcome stamp | `pd verdict` | label size, bold (CLEAR, REJECT, CRASH) |
| notes | `pd note` | label size, italic, at most one per figure |
| legend entries | `pd legend` | label size, no frame, no fill |
| the whole pgfplots block | `pd axis` | title / labels / tick labels / legend / axis rule / ticks, one key |
| a gloss line under a heading, inside a node | `\pdfigsub` | same size, stepped down by slope and weight |
| math carrying a sub/superscript, inside a label | `\pdfigmath` | one notch up: a `\footnotesize` subscript measures 5.98 / 6.36 pt, under the floor |
| hairlines / guides | `pd hairline`, `pd guide` | 0.5 / 0.45 pt, grey 78 / 62 |
| rules | `pd rule`, `pd focus rule`, `pd caution rule` | 0.62 / 1.05 / 1.05 pt |
| marks | `pd datum`, `pd focus datum`, `pd caution datum` | 2.1 / 2.5 / 2.5 pt inner sep |
| regions | `pd focus fill`, `pd caution fill`, `pd neutral fill`, `pd ink fill` | 24 / 26 / 40 % with a drawn edge; solid ink |
| states | `pd state`, `pd terminal`, `pd decision` | ink outline, 30 % sand fill; decision is the diamond gate |

A fragment that needs a compound style of its own composes it from a role above
(`gate/.style={pd decision,minimum width=2cm}`) or from the `\pdfiglabel*` handles.
It never writes a raw size command.

Further rules the prechecker applies to the source:

- Multi-word node text needs `text width=` and `align=`.
- `\tiny` is an error; `\scriptsize` outside `pd axis label` is an error.
- A `\fill` with no matching `\draw` (a region without an edge) is an error.
- A node carrying a `pd *` style **and** its own `font=` is an error (P18): the
  style already fixes the font, and a local one silently replaces the whole role.
- Any `font=` naming a size command is an error (P19), including inside a
  pgfplots `tick label style={}` and inside a local `.style={}` definition.
- Painting a house ink through a bare `fill=`/`draw=`/colour token on a path with
  no `pd *` style in the same option list is an error (P20) — the `pd ... fill` and
  `pd ... rule` styles say the same thing and are what the Book's edition
  overrides (swiss, technical) restyle. `hhpaper` is exempt: it is the page
  ground, not an ink (a knockout backing, a halo ring).
- Any `font=` naming a type family (`\sffamily`, `\rmfamily`, `\ttfamily`,
  `\fontfamily{..}`) is an error (P21). See §"One face, and it is the document's"
  below.
- `\pdfigmath` on a math group with no sub- or superscript is an error (P22).
  See §"What the 7 pt floor is a floor on" below for what it is and is not for.
- A `dotted`, `densely dotted` or `loosely dotted` key anywhere in a fragment or a
  style file is an error (P23). See §"A dash is stated in points" below.
- `\resizebox{f\textwidth}` with f < 0.85 is a warning; prefer drawing to the measure
  (`x=` scaled so the picture is at most `\linewidth`) and no `\resizebox` at all.
- Colours are the `hh*` house set only (`hhsand hhsanddeep hhebony hhink hhcobalt
  hhamber hhteal hhpaper hhgray`); `pd*` palette names belong to the page grammar,
  not to figures.
- No result codes (`R7`, `B6`) in titles or captions; name the idea.

### One face, and it is the document's

Figure type inherits the face the document is already setting — Palatino in the
Book, Computer Modern in a standalone chapter. Figures agreeing with *each other*
is not the goal; figures agreeing with the paragraph beside them is, and a corpus
that is internally consistent in a face the body text does not use is still wrong
on every page.

So a fragment never names a family. `\sffamily` against a Computer Modern page
resolves to Latin Modern Sans and reads as a foreign object on it — this is the
single most common way a figure looks pasted-in rather than set. An **edition**
may substitute a face: the Swiss and technical editions set `\pdfiglabelfamily`
to `\pdgrotesk`, because grotesk display is their declared character, and they do
it in one command in one file, so the substitution is a decision on the record.
The only family a fragment may ask for is the identifier one, and it asks by role
(`pd mono label`), never by `\ttfamily`.

Check it on a rendered page with a paragraph above the figure, not by reading the
style file.

### Identifiers get one spelling

A key, a cell id, a file name or any other literal a reader could type is set in
`pd mono label`, spelled exactly as the code spells it: `sk_A`, not `skA` and not
`sk` with a subscript `A`; `card0`, not a Unicode subscript zero. A figure that
shows one identifier two ways has told the reader they are two things. The
subscripted form belongs to *mathematics* (an index into a sequence) and the
literal form to *code*; one figure may use both, for different objects, never
both for the same one.

### Shape has to survive the print size

`pd datum`, `pd focus datum` and `pd caution datum` carry three different forms,
because the house palette is three low-chroma print inks and every distinction it
makes is doubled by something that is not colour. That only counts if the form is
still legible at 2.1–2.7 pt. The Swiss edition used to flatten all three to a
square, which left hue as the only separation — nothing in greyscale, nothing for
a colour-blind reader. An edition override that restyles a datum must keep three
distinguishable forms, and must be checked on a render at 1.0×, not reasoned
about from the point sizes.

### What the 7 pt floor is a floor on

T1 is a floor on **running text**, and it has a second, lower band for spans of
three glyphs or fewer — a sub/superscript, a tick numeral. Measured on this
repository's own styles:

| | base glyph | subscript | subscript / base |
|---|---|---|---|
| standalone chapter | 8.97 pt | **5.98 pt** | 66.7 % |
| Book | 8.72 pt | **6.36 pt** | 72.9 % |
| either, under `\pdfigmath` | 10.91 / 10.46 pt | **7.97 / 7.64 pt** | — |

The running-text floor is 7.0 pt; the short-span floor is 5.9 pt. Both subscripts
above therefore **pass** T1. An earlier version of this rule said they failed it,
and the correction matters: a subscript is set at roughly 70 % of its base by
every typesetter that has ever existed, so holding one to the running-text floor
would mean either no subscripts in figures at all or a figure whose base type is
larger than the paragraph beside it. The band is a decision about what T1
measures, not a loophole, and the finding now names which band it applied.

So `\pdfigmath` is **not** a way to pass T1. It exists because 5.98 pt clears
5.9 pt by 0.08 pt, and 0.08 pt is not a margin — a font substitution, an edition
that nudges `\pdfigbasesize`, or a chapter loading a different math font puts
that subscript under the band with nobody having decided anything. Promotion puts
it at 7.97 / 7.64 pt, over even the running-text floor. Used on math that carries
no subscript it buys nothing at all and just sets one label larger than its
neighbours, which is what P22 catches.

### A dash is stated in points

`densely dotted` expands to `dash pattern=on \pgflinewidth off 1pt`, and
`\pgflinewidth` is read when the **key** is processed, not when the path is
stroked. So a style that sets `line width=` *after* the dotted key — or an
edition override that appends a new width later — changes the stroke and leaves
the dash at the width it had already baked in. That is not a hypothetical: it is
how `pd guide` came to ship a 0.448 pt dot on a 0.498 pt stroke in the canonical
Book, and neither the source nor the caption could show it.

So every dash in this corpus is written `dash pattern=on Xpt off Ypt`, in
absolute points. The `dashed` family is already absolute (`on 3pt off 3pt`) and
is fine; the `dotted` family is not and is banned (P23).

**The floor, measured at 1.0× / 150 dpi** — the resolution at which someone reads
a PDF on a screen without zooming. 1 pt = 2.083 px.

| | on | gap | stroke | peak ink per dot, over 12 sub-pixel phase offsets |
|---|---|---|---|---|
| `pd guide` before, Book (Swiss) | 0.448 pt = **0.93 px** | 0.996 pt = 2.08 px | 0.498 pt = 1.04 px | 0.184 → 0.302 (**1.6× swing**) |
| `pd guide` before, technical | 0.600 pt = 1.25 px | 1.200 pt = 2.50 px | 0.299 pt = **0.62 px** | 0.353 → 0.553 (**1.6× swing**) |
| `pd guide` after, all editions | 1.200 pt = 2.50 px | 2.000 pt = 4.17 px | 0.697 pt = 1.45 px | flat: 0.894 / 0.937 / 1.337 |

A mark under one device pixel is at the rasteriser's Nyquist limit: its weight
depends on where it lands on the pixel grid, so the line antialiases into nothing
at one phase and, on any renderer that snaps a thin stroke to a one-pixel
minimum, merges into a solid line at another. Two pixels is the first on-length
that renders at the same weight wherever it falls. **figcheck's T9** enforces
on ≥ 2 px, gap ≥ 2 px and stroke ≥ 1 px at `--dash-dpi` (default 150), reading
the dash array straight off the compiled PDF — the only place the numbers exist.

T9 decides whether a dash *can* resolve. It cannot decide whether it *reads* as
dotted against a particular background, or at arm's length. Clearing it is
necessary, not sufficient; look at the render.

### A dash that means nothing is the first ink you lose

`pd guide` is a **construction line** — a drop line to an axis, a leader to an
annotation, a projection, a waterfall connector, the bound of an interval. Its
dottedness is doing semantic work: it tells the reader this line is not a drawn
edge. `pd lattice` is the **background rule work** a figure stands on — column
separators, row baselines, a time grid — and there, dotted-versus-solid
distinguishes nothing at all.

Thirteen of the corpus's twenty-three guide users were lattices. Spending a
semantic channel on background grid is what made its failure invisible: nobody
looks hard at a grid line, so nobody noticed the channel had stopped working in
the figures where it mattered. A lattice is continuous and quiet; a guide is
discontinuous and definite. Reach for `pd guide` only where the reader must see
that the line is not an edge.

One consequence worth stating plainly: **a caption verified against a shared
style expires when that style moves.** Any figure whose caption was checked
against the old `pd guide` needs re-reading after a change like this one — a
verification that silently goes stale is the same defect class as a claim
nothing checks.


Rendered checks (`figcheck.py`): T1 minimum text 7 pt · T2 text escaping its box ·
T3 pairwise overlap > 5 % · T4 line through text · T5 ink outside the mediabox ·
T6 dead canvas · T7 width over `\textwidth` · T8 ink below the picture inside the figure ·
T9 a dash too small to resolve at 150 dpi.

### What the screen rules give us, and what they do not

Most of this section's rules are the print form of a screen data-viz method, and
the translation is not uniform. The **invariant** half transfers whole: choose
the form from the data's job before choosing colour; one axis, never two; direct
labels before a legend and a legend before a second axis; no chartjunk; small
multiples over one overloaded panel; erase ink that does no work.

The **interaction** half does not transfer at all, and its absence is not a
defect to design around. A page has no tooltip, no hover, no filter row. Do not
add one, and do not read "the value is not reachable on hover" as a finding. What
does survive is the tooltip rule's *intent* — every value is reachable without
gating — and on the page it is discharged elsewhere: the value is in the caption,
in the margin apparatus, or in the chapter's own worked example. So a label that
will not fit inside its mark moves outside the mark or drops to the caption. It
is never shrunk to fit (there is nothing below the label size to shrink to) and
never clipped.

One screen rule is suspended here with its reason. "Text never wears the data
colour" exists because a light categorical hue is illegible as text on a light
surface. The house hues are print inks — ink `#1B1712`, teal `#00564C`, amber
`#6B4500` — and all three clear text contrast on cream, so a label may wear its
series' ink to bind itself to a curve. That is direct labelling, and it saves a
legend. What survives is the reason behind the rule: text wears one of those
three inks at full strength, or `hhink!80!hhgray` for recessive furniture, and
nothing else. A tint (`text=hhgray`, `text=hhteal!60`) is not a role, it is a
fade.

### Colour is never the only cue

The house figure hues are ink `#1B1712`, teal `#00564C` and amber `#6B4500`. Run
through the dataviz palette validator as a categorical set they fail the screen
checks on purpose: they are dark and low-chroma for print, and teal against amber
separates by only ΔE 13.3 for normal vision (8.2 protan). So the palette is a scale
of three *and every distinction it carries is doubled by a second channel*: caution
is dashed as well as amber; caution marks are diamonds where focus marks are circles;
regions are edged and labelled, never told apart by tint alone; series in a plot are
named at their ends. A figure whose meaning survives conversion to grey passes; one
that does not is redrawn.

## 5. Caption grammar

First sentence: what is drawn (kind, axes, participants). Second: what it shows, with
the number. Then the idealisation, if any, named plainly (Feynman's "this is wrong
because…"). Provenance in square brackets at the end: `[verified, a7_experiment.py]` or
`[internal]`. No sentence in a caption may be the figure's only readable fact.

## 6. Typography on the page around a figure

Bold only for the defined term and the run-in heads of claims; italic for the one
question and at most one emphasis a page; small caps for kind tags and running heads;
monospace for identifiers and sessions only. A figure's labels never use bold except
row labels.

## 7. Sources behind the rules

Quoted in `research-notes.md` §"Legibility and print sources": Cleveland and McGill
(1984) for the perceptual-task ranking behind rule 2 and the taxonomy's channel
ordering; Munzner's marks-and-channels ranking; Bertin's visual variables (which are
ordered, which merely selective); Wilke, *Fundamentals of Data Visualization* (ugly /
bad / wrong; direct labelling; larger axis labels; redundant coding; proportions);
Few on table versus graph; Science's figure instructions (6 pt symbols, 0.5 pt lines
at final size) and IEEE's (8–10 pt labels) behind rule 4; offset-print tint guidance
(10–20 % minimum screen) behind the 24 % fill floor; Bringhurst on the 45–75 character
measure behind the Book's 4.5 in column; the Mermaid catalogue as the checklist of
kinds in `taxonomy.md`.
