# The Doctrines

Every principle below names its source book. See `references/sources.md` for the
citation and verification status of each. Read this file when you need the
*reasoning* behind a rule, not just the rule — the checklists in SKILL.md are the
compressed form of what's argued here.

## 1. Graphical integrity (VDQI)

The physical representation of a number on the page must be proportional to the
numerical quantity it represents. Tufte's diagnostic is the **Lie Factor**:

```
Lie Factor = (size of effect shown in the graphic) / (size of effect in the data)
```

An honest graphic has a Lie Factor between 0.95 and 1.05. Above that, the graphic
visually amplifies the data (a classic case: a 53% real increase in fuel-economy
standards drawn as a 783% increase in ink, Lie Factor 14.8, via a distorted
perspective icon). Below 0.95, it visually suppresses the data. Six related
integrity rules from VDQI:

1. Show data variation, not design variation. If two lines look different, it
   should be because the data differ, not because you chose different chart
   styles for them.
2. Use clearly and fully labeled scales in standard units, on the graphic itself.
3. Label the data directly — don't force the reader to a hunt-and-match legend
   when a line, bar, or point can carry its own name.
4. The number of dimensions depicted should not exceed the number of dimensions
   in the data (no 3D bar for a 1D quantity; no area/volume encoding a scalar
   when the reader will misjudge it as area/volume rather than the scalar).
5. Deflate any inflation adjustment (money and other indices) — show real, not
   nominal, values when the graphic's point is to compare across time.
6. Never quote data out of context in a way a viewer with the full context would
   find misleading.

## 2. Data-ink ratio, chartjunk, and their contested limit (VDQI)

**Data-ink** is "the non-erasable core of a graphic, the non-redundant ink
arranged in response to variation in the numbers represented." The **data-ink
ratio** is data-ink ÷ total ink. Tufte's maximization principle: erase non-data-ink,
within reason; erase redundant data-ink, within reason. **Chartjunk** is ink that
carries no information: heavy grids that compete with data, moiré/vibration
patterns, gratuitous 3D, ornamental "ducks" (Tufte's term, after the duck-shaped
duck stand, for a graphic whose form serves decoration over data), and
non-informative color.

**The contested edge** (see `references/critiques-and-limits.md`): Few, Wilke and
others argue Tufte's own worked redesigns sometimes over-erase — thin gridlines,
repeated axis labels, and a legend alongside direct labels can *reduce* the
reader's cognitive load even though they raise total ink. Read data-ink
maximization as "erase ink that does no work," not "erase ink until the ratio is
maximal by count." A single retained gridline that lets the eye estimate a value
without visually tracing to the axis is not chartjunk.

## 3. Small multiples (VDQI ch. 8, Envisioning Information ch. 4, Beautiful Evidence)

"Small multiples, whether tabular or pictorial, move to the heart of visual
reasoning — to see, distinguish, choose." A series of small, identically scaled,
identically framed panels — one variable changing across the grid — lets the
reader hold the comparison in view instead of in memory, because the design
resolves visually rather than statistically. The multiplication is of
*comparisons available to the eye at once*, not of chart types: same axes, same
scale, same size, one dimension varying (time, category, geography), arranged
so the panel-to-panel differences ARE the finding.

## 4. Sparklines (Beautiful Evidence)

"Datawords: data-intense, design-simple, word-sized graphics." A sparkline is a
small, intense, simple graphic set at the type size and location of the words
that surround it — inline, in a sentence, in a table cell — so it functions as a
word: "sales rose ▁▂▃▅▇ then fell." No axis, no legend, no gridlines; context and
current-value markers (a dot at the last point, a shaded band for the acceptable
range) are the only permitted embellishment because they carry data, not
decoration. Sparklines exist to intensify the density of a table or a paragraph,
not to replace a full chart when the reader needs to read off exact values.

## 5. Layering and separation, and micro/macro readings (Envisioning Information)

**Layering and separation**: stratify a design's visual weight into distinguishable
strata — value gradations (color, weight, texture) let a reader's eye choose
which layer to attend to, so more information can live on one page without
competing at the same visual intensity. The classic device: heavy for data, light
for reference grid.

**Micro/macro readings**: a display should reward both the ten-second glance (the
macro pattern: shape, trend, cluster) and the ten-minute study (the micro detail:
individual values, annotations, exceptions) from the same image, at different
zoom levels of attention — not two different displays.

## 6. Escaping flatland (Envisioning Information ch. 1)

"All of the interesting worlds — physical, biological, imaginary, human — are
inevitably multivariate in nature, a condition at odds with the flatlands of our
information displays." The chapter argues for using every visual dimension
available on a flat page — position, size, shape, value, color, texture,
orientation, and time-as-an-implied-dimension via motion or sequence — rather
than reducing a multivariate phenomenon to a single-variable chart because that's
the easy default.

## 7. Narratives of space and time (Envisioning Information ch. 6)

Displays that fuse a map or diagram (space) with a chronology (time) into one
image, so cause, sequence, and geography read together instead of requiring the
reader to hold a timeline in one hand and a map in the other. Minard's map (§9) is
the canonical instance. The doctrine generalizes: whenever an argument's force
depends on "this, in that place, at that time, caused that," draw the space and
the time in one figure rather than splitting them into a map and a separate
timeline.

## 8. The smallest effective difference (Beautiful Evidence)

"The Occam's razor of information design": make every visual distinction — a
line weight, a color step, a type-size jump, a border — as small as it can be
while remaining clearly detectable, and no smaller. Applied to typography: use
the minimum contrast (small caps instead of bold, a hairline instead of a boxed
rule, italics instead of a colored callout) that still lets the reader instantly
tell two things apart. This is the general form of the data-ink ratio applied to
every visual encoding, not only marks that carry data.

## 9. The fundamental principles of analytical design (Beautiful Evidence)

Analytical graphics should serve the cognitive tasks of reasoning about evidence.
Six principles:

1. **Show comparisons, contrasts, differences.** The fundamental analytical
   question is "Compared with what?" A number alone answers nothing; a number
   next to its baseline, its alternative, or its trend answers something.
2. **Show causality, mechanism, explanation, systematic structure.** Where a
   causal story exists, the display should carry it, not just correlate it — a
   diagram that shows the mechanism (temperature → O-ring resilience →
   leak probability) is stronger evidence than the same numbers as an unordered
   table.
3. **Show multivariate data** — more than one or two variables, because that is
   how the interesting relationships live.
4. **Completely integrate words, numbers, images, diagrams.** Evidence is
   multi-modal; segregating it into separate figure/prose/table zones loses the
   integration that makes evidence legible (see doctrine 12 below).
5. **Thoroughly describe the evidence.** Documentation: sources, issues of data
   quality, characterization of uncertainty — a display's credibility rests on
   what it discloses about itself.
6. **Content counts most of all.** "Analytical presentations ultimately stand or
   fall depending on the quality, relevance, and integrity of their content" —
   no amount of design craft rescues weak or dishonest evidence, and no amount of
   design failure fully buries strong evidence, though it can badly delay it (see
   the Challenger case, doctrine 11).

## 10. Minard's Napoleon map — the worked example the whole doctrine points at

Tufte (VDQI): the map "may well be the best statistical graphic ever produced."
Six variables in one image — the army's geographic position (two spatial
dimensions), its size (band width), the direction of movement (band shading:
tan for the advance, black for the retreat), temperature on the retreat
(a companion time-series axis beneath, tied to the same horizontal scale), and
time (dates marked along the retreat). It is the doctrine's proof of concept:
comparisons (advance vs. retreat band width), causality (temperature drops
track troop losses), multivariate (six variables), integration (map, chart, and
a few words of label, no separate legend block), space-and-time narrative in one
image, and content that carries itself — a catastrophe, not a decoration.

## 11. Snow's cholera map — evidence with an honestly disclosed limit

Tufte (Visual Explanations): John Snow's 1854 dot map of Broad Street cholera
deaths, overlaid on a street map with the Broad Street pump marked, is presented
as a model of visual argument that changed a scientific consensus (from miasma
theory to waterborne contagion) — but Tufte also names its limitation: it is a
dot map that implicitly assumes uniform population density, so a house with no
dot reads ambiguously as "no cases" when it might mean "no people live there."
The lesson for this skill: praise a design's argument and name its assumption in
the same breath — that is graphical integrity applied to your own figure, not
just to the ones you critique.

## 12. The Challenger O-ring argument and the Cognitive Style of PowerPoint

Visual Explanations: the night before the Challenger launch, Morton Thiokol
engineers argued against launching in cold weather using 13 hand-drawn charts,
ordered by launch date (chronology) rather than by the causally relevant variable
(temperature), with cluttered typography that buried the O-ring damage counts.
Tufte's redesign — one scatter plot, temperature on the x-axis, damage severity on
the y-axis, every launch plotted, including the ones with no damage (comparison:
show ALL the data, not only the failures) — makes the correlation visible in one
image. *The Cognitive Style of PowerPoint* generalizes the diagnosis to slideware
itself: a template built from nested bullets forces every argument into a shallow
hierarchy, discards the comparison-enabling detail (a bullet can't hold a
six-variable scatter plot), and privileges the presenter's performance over the
content's integrity. Tufte's fix is procedural, not typographic: replace the
slide deck with a dense written document (a "handout"), let the audience read it
silently for the first several minutes of the meeting (Tufte's one-day-course
rule: "every meeting begins with a document and a study hall"), and reserve the
verbal time for discussion, not recitation of bullets the audience can already
read.

## 13. Sentences beat bullets

A corollary practice, not a separate book: a claim written as a complete sentence
carries its own logical connective (because, therefore, unless, compared to) that
a bullet fragment discards. "Latency rose because queue depth crossed the SLA
threshold" is checkable and falsifiable; "• Latency ↑" is not. Prefer prose
paragraphs — captions included — over bulleted fragments wherever the point is an
argument rather than a checklist of independent, unordered items.

## 14. Words, numbers, images — together (Beautiful Evidence ch. 4)

The chapter's evidence (Galileo's sunspot letters, the 15th-century
*Hypnerotomachia Poliphili*) argues that segregating text, numbers, and images
into separate zones of a page or document is a production-era convention, not a
cognitive one — readers integrate all three as one argument, and the strongest
evidence presentations set them together at the point of use (a number inline in
a sentence, a sparkline inline in a table cell, a figure beside the paragraph
that interprets it) rather than banished to a captioned float three pages away.

## 15. Tables versus graphics

Tufte's standing rule of thumb: for data of 20 numbers or fewer that a reader may
need to look up an exact value from, a well-set table beats a chart — a table has
a higher effective data-ink ratio for exact lookups and lets a reader compare any
two cells directly. A graphic earns its place when the reader's task is pattern,
trend, or comparison across many more values than a table can hold legibly, or
when relative magnitude (not exact value) is the point. When both tasks matter —
exact value AND trend — combine them: a table with a sparkline column, or a
chart with printed value labels at key points (see the decision tree in
SKILL.md).

## 16. Typography and the smallest effective difference in type

Applying doctrine 8 to type itself: prefer weight and case changes (small caps,
a single bold run-in head) over color blocks or boxed callouts to mark a change
in kind; keep one serif text face and reserve contrast for what's actually
different; a caption in the same size as body text but italic is a smaller,
equally effective difference than a caption in a different color in a tinted box.
Tufte's own books are set this way: sidenotes in a smaller size of the same face,
not a different face or a shaded background.

## 17. The supergraphic

A "supergraphic" (Tufte's term, used loosely across his books for very
large-format, very high-resolution, information-dense displays — wall charts,
posters, foldout maps) trades the small multiple's repetition for raw density at
one scale: everything the reader might want to compare is present at once, at a
size that rewards close reading with a magnifying glass and a distant reading
with an overview. The web/print analogy in this repository: a documentation page
that lets the reader zoom (browser zoom, a "click to enlarge" full-resolution
figure) rather than pre-deciding one fixed resolution for every reader.

## 18. The one-day course's practical rules

Practical, non-bookish rules Tufte gave the live "Presenting Data and
Information" course (see `references/sources.md` for the attendee-account
sources):

- Ask what the data means before you decide how to display it — never start from
  "which chart type."
- Let the viewer see and hold ALL the data before or during the presentation, not
  a curated subset chosen to make the point look better than the full data would.
- "Every meeting begins with a document and a study hall" — give the room the
  full written argument first; talk after everyone has read it.
- The point of information design is to assist thinking, not to entertain or to
  perform designer skill.
- When in doubt, favor the design that would survive an adversarial reader who
  wants to find the flaw in your evidence.
