# Craft rules

How a figure in the Harbor library is judged and drawn. The rules are in force for
every fragment under `whitepaper/figures/` and `website-v2/public/whitepaper/figures/`
and for every new figure. Mechanics are enforced by `scripts/tikz_precheck.py`
(source) and `scripts/figcheck.py` (rendered PDF); the judgment rules are applied by
the author on the rendered page, never on the fragment in isolation.

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
not restyle inline.

| element | style | rule |
|---|---|---|
| row / actor names | `pd row label` | `\footnotesize\bfseries`, anchored east of the row |
| tick numerals | `pd axis label` | `\footnotesize`, the only place `\scriptsize` was ever allowed and it no longer is |
| direct labels | `pd direct label` | `\footnotesize`, cream backing, never across a line |
| notes | `pd note` | `\footnotesize\itshape`, at most one per figure |
| hairlines / guides | `pd hairline`, `pd guide` | 0.5 / 0.45 pt, grey 78 / 62 |
| rules | `pd rule`, `pd focus rule`, `pd caution rule` | 0.62 / 1.05 / 1.05 pt |
| marks | `pd datum`, `pd focus datum`, `pd caution datum` | 2.1 / 2.5 / 2.5 pt inner sep |
| regions | `pd focus fill`, `pd caution fill`, `pd neutral fill` | 24 / 26 / 40 % with a drawn edge |
| states | `pd state`, `pd terminal` | ink outline, 30 % sand fill |

Further rules the prechecker applies to the source:

- Multi-word node text needs `text width=` and `align=`.
- `\tiny` is an error; `\scriptsize` outside `pd axis label` is an error.
- A `\fill` with no matching `\draw` (a region without an edge) is an error.
- `\resizebox{f\textwidth}` with f < 0.85 is a warning; prefer drawing to the measure
  (`x=` scaled so the picture is at most `\linewidth`) and no `\resizebox` at all.
- Colours are the `hh*` house set only (`hhsand hhsanddeep hhebony hhink hhcobalt
  hhamber hhteal hhpaper hhgray`); `pd*` palette names belong to the page grammar,
  not to figures.
- No result codes (`R7`, `B6`) in titles or captions; name the idea.

Rendered checks (`figcheck.py`): T1 minimum text 7 pt · T2 text escaping its box ·
T3 pairwise overlap > 5 % · T4 line through text · T5 ink outside the mediabox ·
T6 dead canvas · T7 width over `\textwidth` · T8 ink below the picture inside the figure.

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
