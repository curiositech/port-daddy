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

## 7. Claims, notation and convention

These eight rules came out of one review of `fig:anchor-handshake-ladder`, but not one
of them is about that figure. Each names a class of defect that recurs. Rules marked
**(mechanized)** have a check in `scripts/tikz_precheck.py`; the rest are **human
rules** — no script can make them sound, and inventing one that pretends to would be
worse than leaving the judgment where it belongs.

### 7.1 Caption–drawing integrity **(mechanized, partly)**

Every sentence of a caption is a testable claim about ink. Before shipping, **enumerate
the caption's claims as a numbered list and verify each one against the render, one at a
time**, saying for each whether the render shows it. Put the list in the PR.

This is the rule the failure violated. The caption said "the daemon's lifeline is dotted
from that point down"; the fragment did contain a dot directive, so the claim was not a
lie in the source — but the dash pattern was 0.45 pt on / 1.0 pt off in a grey four
percent lighter than the solid hairlines beside it, and at 150 dpi it antialiased into a
continuous line. The author looked at the render, reported the dotted lifeline as the
figure's readable fact, and it was not readable. *Looking is not enough; you check
claims, one by one, against the thing the reader will hold.*

Two corollaries, both cheap and both about the same failure of nerve:

- **A styling word in a caption is a promise.** `dotted`, `dashed`, `shaded`, `bold`,
  `greyed`, `hatched` — if the caption says it, the fragment must contain the directive
  that draws it. Mechanized as `P15`.
- **A claim you cannot see at 1.0× / 150 dpi is not a claim, it is a hope.** If the
  distinction matters, give it a second channel (§4's colour rule, generalized): weight,
  position, an enclosing region, a mark that is present or absent. A dash pattern finer
  than roughly 1.5 pt on / 1.5 pt off does not survive the page.

### 7.2 Caption vocabulary is the drawing's vocabulary **(mechanized)**

No word in a caption may name a thing the drawing does not contain. A caption that says
`jti` when no label says `jti` sends the reader hunting for ink that is not there. Either
put the thing in the drawing or take it out of the caption. Mechanized for identifiers as
`P17`.

### 7.3 One notation per entity, across figure *and* prose **(mechanized within a fragment)**

A key, token or identifier gets one spelling everywhere it appears: node labels, message
labels, caption, and the chapter's body text. **Decide the referent first, then spell it
once.** `card0` / `card₀` / `card_0`, or `sk_A` / `skA` / `\texttt{sk\_A}`, is not a
typography nit — it is three names for one object, and the reader must do the merging.

When figure and prose disagree about *what the referent is* — here, whether the root
authority was the Harbor or the Daemon — that is a **content bug in the chapter**, not a
figure defect, and it is fixed in the chapter. Settle it from the artifact that executes,
not from the prose that describes it: the pseudocode, then the models, then the
implementation. Say plainly in the commit that the chapter was wrong and where.

Mechanized as `P16`, which catches two spellings of one identifier *inside a fragment*:
`card0` against `card_0`, `skA` against `sk_A` — splits that survive any typeface.

Register discipline follows from this and is a **human rule, not mechanized**:
**identifiers in `\texttt{}` with literal underscores, matching the listings; prose in
the figure's body font.** Mixing `$\mathrm{card}_0$` into a diagram whose sibling labels
are `\texttt{card\_0}` is the same defect wearing maths — but `P16` compares spellings
after markup is stripped, so to it those two are one spelling. Telling them apart needs
per-occurrence mode tracking the linter does not have; a version that inferred the mode
from the surrounding node was tried, produced five false positives on this corpus, and
was removed rather than shipped. **Check register by eye.**

Figure-versus-chapter disagreement is also a **human rule**: the prechecker reads one
file and has no way to know which of two spellings the chapter meant.

### 7.4 Show data variation, not design variation

Every visual difference in a drawing is read as a difference in the thing drawn. A teal
arrow among black arrows says *this message is a different kind of message*. If it is
not, the colour is a lie the reader has to unlearn. So:

- **Uniform marks for uniform things.** One arrow style for every communication, one
  lifeline style for every participant, one node shape per role. A second style must earn
  its place by encoding a second kind, and then the legend or a direct label says so.
- **No decoration that encodes nothing.** A filled badge behind every label is not
  emphasis, it is noise — and an opaque patch hides the marks it sits on. If a label
  needs a backing to stay legible, the label is in the wrong place: **wrap it to fit its
  own lane** rather than paving over the drawing.
- **Even rhythm unless the spacing means something.** Uneven gaps between rows of a
  ladder read as uneven time. If the intervals are not data, make them equal.

### 7.5 Use the convention before inventing one

Established grammars are cheaper to read than anything hand-rolled, because the reader
already knows them. Sequence diagrams in particular have a settled vocabulary, and the
house corpus should use it:

| you want to show | the convention | not |
|---|---|---|
| a participant is working | a slender activation box on its lifeline | a wide text box |
| the participant does something alone | a reflex self-message (out and back on its own lifeline) | an arrow to nowhere |
| a repeated or conditional stretch | a `loop` / `alt` / `ref` frame | prose in the margin |
| an aside about one element | a note with a drawn leader to that element | floating italics |
| a participant is idle | no activation box | a second line style |

**A text box run through a lifeline is not a convention, it is a collision.** The original
impaled the verifier's lifeline on a prose rectangle and then broke the lifeline around it
to hide the damage; a 2 mm activation box plus a short label beside it says the same thing
and obscures nothing.

*When to reach for a package.* `pgf-umlsd` and `tikz-uml` are worth the dependency when a
figure needs more than about six participants, nested `alt`/`loop` frames, or a dozen-plus
messages whose vertical positions you would otherwise be hand-computing — they own the
bookkeeping. Below that, hand TikZ over the house `pd` styles is preferable: it keeps the
one visual language, it renders identically in every edition, and neither package is
currently in any Harbor preamble, so adopting one is a corpus-wide decision and not a
figure-level one. **Either way the grammar is UML's; only the drawing mechanism is at
stake.**

### 7.6 Encode the boundary, don't annotate it

A region the reader must *perceive* — "offline after message 1", "inside the trust
boundary", "the regime where the bound is tight" — is **drawn**: a shaded band with a
drawn edge, a divider rule, a change of rule weight, a frame. It is not written in a
sentence set loose under the picture. Prose next to a drawing is read after the drawing,
and a boundary that arrives second has already failed.

A note is the fallback for what the geometry genuinely cannot carry, and then:

- it is **anchored** — a drawn leader to the element it explains, or placement *inside*
  the region it names (a label running up a band's own gutter is inside; a line of italics
  below the picture is not);
- there is **at most one** per figure (§4);
- it never states the figure's readable fact. If the note carries the fact, the drawing
  does not, and the drawing is the thing being shipped.

### 7.7 The caption states the claim; the drawing carries the mechanics

If the caption has to narrate the steps — "Message 2 is minted by agent A alone; it binds
the whole parent card…" — the drawing is under-labelled. **Fix the drawing, then cut the
caption.** Structured message labels (`m1  card_0 = Sign(sk_daemon, jti, {db:read,
db:write})`) put the mechanics where the reader is already looking, and the caption
shrinks to what the drawing cannot say: what kind of drawing it is, what claim it
supports, and the provenance bracket.

A caption of five sentences over a four-message ladder is a symptom, not a style.

### 7.8 Termination padding

Arrowheads stop short of the lifeline or box they address — about 0.15 cm at 1.0×. An
arrowhead touching a lifeline reads as a join; a small gap reads as an arrival. The same
applies to a leader meeting its referent and to a rule meeting an axis.

### 7.9 The figure's type is the document's type, per edition

Diagram text is set in the document's own body face, not in whatever TikZ inherits by
default. A drawing whose labels are Computer Modern on a Palatino page announces that it
was made somewhere else.

In this corpus that binding is **not the fragment's job**: `pd figure` and the per-edition
overrides (`figures/pd-figure-language-<edition>.tex`) set the family, and the Book selects
the edition. The rule for a fragment is therefore negative and absolute: **a fragment never
sets a font family, a font size, or a font shape.** It names house styles and lets the
edition decide. A fragment that reaches for `\sffamily`, `\ttfamily` outside an identifier,
or `\small`/`\footnotesize` is overriding a decision that is not local to it, and it will
be wrong in at least one edition.

Two consequences worth stating, because they get mistaken for defects:

- A deliberate edition contrast is not a mismatch. The swiss edition sets diagram labels in
  grotesk against a serif body *on purpose*. Report a suspected mismatch to whoever owns
  `pd-figure-language.tex` rather than patching it in a figure; a font fixed in one
  fragment is a font that drifts from the other eighty.
- `\texttt{}` around an identifier is register, not typography, and stays (§7.3).

## 8. Sources behind the rules

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
