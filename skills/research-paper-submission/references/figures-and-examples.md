# Figures, captions, and worked examples

**Read when** designing a figure for a theory paper, writing a caption, or
deciding how to use a running example.

Evidence tiers matter more here than anywhere else in this skill, because a lot
of figure advice is confidently asserted folklore. Each claim below is marked
**[experiment]**, **[expert opinion]**, or **[craft lore]**. Do not repeat a
craft-lore claim as if it were established.

## What is actually experimentally established

**Cleveland & McGill's perceptual-task ranking** — *JASA* 79(387):531–554, 1984;
summarised in *Science* 229:828–833, 1985. **[experiment]** Subjects judged
relative magnitude across encoding types; measured error produced a strict
accuracy ranking:

1. Position along a common aligned scale — most accurate
2. Position on identical non-aligned scales
3. Length
4. Angle / slope
5. Area
6. Volume, colour saturation
7. Colour hue — least accurate

This is the single most solid result in the whole figure literature, and it has
a direct consequence for theory figures: **in a regime diagram, the boundary
curve is doing the communicative work, not the fill colour.** Shading is a
redundant cue. If deleting all colour destroys the figure's claim, the claim was
riding on the weakest available channel.

**The worked-example effect** — Sweller & Cooper, *Cognition and Instruction*
2:59–89, 1985, and the subsequent cognitive-load literature. **[experiment,
repeatedly replicated]** Novices who *study* a worked example outperform novices
required to *solve* the equivalent problem, on both retention and transfer.
Mechanism: unguided problem-solving consumes working memory on means-ends search
instead of schema-building.

**Scope caveat, and state it when citing this.** The effect is established in
instructional settings — students learning a procedure — not for expert readers
skimming a paper. Extending it to paper-writing is a reasonable extrapolation,
since a strong reader is functionally a novice with respect to *this* paper's
formalism, but no study tested it there. Call it **[probable]**, not
[experiment], when using it as an argument about papers.

**Colour-blindness prevalence** — protanopia/deuteranopia affect ~8% of men and
~0.5% of women of Northern European descent (Deeb, *Clin. Genet.* 67:369–377,
2005, via Wong). **[experiment]** With three male reviewers of that ancestry the
chance at least one is red-green colourblind is ~22%. Your reviewers are part of
the audience you are designing for.

**Chartjunk is contested, not settled.** Bateman et al., CHI 2010, compared
embellished charts to plain ones: comprehension accuracy was no worse, and
recall two to three weeks later was *significantly better* for embellished
charts. **[experiment]** Tufte's data-ink ratio is **[expert opinion]** — his
work rests on his own qualitative judgement and historical case studies, not
controlled trials, a characterisation the visualisation-research literature
converges on. A 2021 VIS position paper argues the term "chartjunk" should be
retired outright.

Practical reading: "minimise non-data ink" is a fine default for dense
quantitative plots and a poor guide for relation maps and regime diagrams.
Cleveland–McGill is the principle to check against, not Tufte.

## The palette to use

The **Okabe–Ito / Wong 8-colour palette** (Wong, *Nature Methods* 8(6):441,
2011), designed for protanopia and deuteranopia and to survive greyscale
conversion. **[verified — exact values]**

| Name | RGB | Hex |
|---|---|---|
| Black | 0, 0, 0 | `#000000` |
| Orange | 230, 159, 0 | `#E69F00` |
| Sky blue | 86, 180, 233 | `#56B4E9` |
| Bluish green | 0, 158, 115 | `#009E73` |
| Yellow | 240, 228, 66 | `#F0E442` |
| Blue | 0, 114, 178 | `#0072B2` |
| Vermillion | 213, 94, 0 | `#D55E00` |
| Reddish purple | 204, 121, 167 | `#CC79A7` |

For sequential/continuous data use **viridis** (or inferno/plasma/cividis);
**ColorBrewer** for choropleth-style needs. **[probable]** Cap a qualitative
palette at **6–8 colours** — beyond that, distinguishable choices run out; use
shape or texture to extend. **[expert opinion]**

Concrete fix for a red/green figure: replace red with magenta, or green with
turquoise, rather than trying to adjust red/green directly.

## Conventions for theory figures

This is the weakest-evidenced area in the whole skill — essentially all
practitioner convention, no controlled studies. Marked **[craft lore]** unless
noted.

**Commutative diagrams** earn their space when the claim really is an equation
between composite morphisms *and* the diagram is used for a chase — tracing an
element through the square as part of a proof. A commutative diagram where
nothing commutes, placed to look formal, is the theory-paper equivalent of
chartjunk, and readers who know the convention will hunt for what commutes and
be confused when nothing does.

**State machines.** Circles for states, labelled directed edges, unambiguous
initial-state marker, double circles for accepting states. Documented mistakes:
missing or ambiguous initial state; self-loops masking a logic error; unreachable
states left in place; missing edge labels. **For a supervisory-control paper
specifically**: distinguish controllable from uncontrollable events visually —
solid versus dashed, or a marker on the label — because that distinction *is* the
paper's content, and a plain automaton diagram without it omits the claim.

**Regime diagrams.** Two parameters on the axes, threshold curves partitioning
the space, each region **labelled with text**, not colour alone. Put a
representative point or the boundary equation on the figure so the claim is
checkable at a glance.

**Hasse diagrams** have the one genuinely fixed convention in this section: cover
relations only (transitive edges omitted), and **vertical position must encode
the order** — greater elements strictly higher, never violated. Get this wrong
and you have not drawn an inelegant diagram, you have drawn something that is not
a Hasse diagram.

**Proof-structure diagrams** — nodes are named results, edge A→B means B's proof
uses A. Placed early as a reader's roadmap so a reader can decide what to trust
and skip. Functionally a graphical abstract for a theory paper.

**Geometric intuition for algebraic statements.** Draw the smallest faithful
picture, and flag in the caption that it is a low-dimensional stand-in. The real
risk is that a figure implicitly asserts structure the theorem does not assume —
convexity, smoothness, an angle. Either construct it to avoid implying unstated
structure, or say in the caption which visual features are not part of the claim.

**Ologs** (Spivak) are worth knowing about for relation maps: a box is labelled
with a singular indefinite noun phrase ("a gene"), an arrow with a verb phrase,
such that box–arrow–box reads as a grammatical English sentence. **The diagram is
designed to be readable as prose**, which is exactly what a relation map for a
non-specialist wants.

## Community conventions differ

- **Economics / EC** — regime diagrams in parameter space, payoff-matrix
  figures; comfortable plotting a threshold as a function of a parameter even
  for a purely theoretical result.
- **PL / POPL** — the dominant "figure" is not a diagram at all but
  **Gentzen-style inference rules**: premises over a bar, conclusion below,
  syntax-directed. Commutative diagrams appear far less than a
  categorically-motivated reader would expect.
- **Security** — Alice-and-Bob message-sequence charts, and threat figures that
  mark **trust boundaries explicitly**. A threat diagram without a boundary
  marking is missing its central claim.
- **Distributed systems** — state diagrams plus message timelines, and a strong
  norm (explicit in Raft's design) of decomposing one result into several small
  figures rather than one large one.

## Captions

Two converging editorial sources, both **[expert opinion]** but from
independent editorial traditions:

- **Nature's figure guide**: legends should be understandable **in isolation from
  the main text**; caption starts with a brief title describing the figure as a
  whole, then a short statement of what is depicted.
- **Mensh & Kording, PLOS Comp Biol 13(9), Rule 7**: *"the title of the figure
  should communicate the conclusion of the analysis, and the legend should
  explain how it was done."* Their justification is the load-bearing part —
  readers skip from abstract to figures to save time, so the figure title is
  often the only sentence of the results such a reader sees.

The phrase "the caption is the figure's abstract" is a fair paraphrase of these
two, **not a sourced quotation** — do not attribute it.

**CS-conference style is terser**, and the absence of any comparable published
caption rule at POPL/USENIX/EC is itself informative: the convention there is one
or two sentences identifying what the figure shows, with surrounding prose
carrying interpretation.

**Which to use:** if your reader is a technically strong non-specialist, they
behave like Nature's skimming reader, not like a POPL reviewer who has already
read the formal statement. Write the self-contained caption.

## Worked examples

**One running example, introduced early, reused at each result** — rather than a
fresh example per result. **[craft lore, inferred]** The inference is from the
worked-example literature's finding that varying surface features across examples
raises extraneous load for a novice; a stable example lets the reader's effort go
into the new mechanism rather than re-orienting to new notation. No study tested
running examples in papers directly.

**The hand-checkable number** — give an instance small enough to verify with a
calculator. **[craft lore]** No source treats this as a studied phenomenon. It is
a well-motivated corollary of two things that *are* evidenced: a worked example
only reduces load if the reader can follow every step, and an instance too large
to check pushes the reader back into taking it on trust, defeating the purpose.
Say so plainly rather than implying it has been tested.

## Print specifications

**[verified, Nature's guide]** Prepare figures at **8pt text**. If the layout
would force you below **5–6pt Arial**, change the layout or drop the element —
do not shrink further. One typeface family per figure; serif for print, sans for
slide labels; no more than 2–3 type sizes. Single-letter variables italic,
multi-letter upright, vectors bold, units as superscripts (kJ mol⁻¹).

**Do not reuse a paper figure on a slide.** Projection needs thicker lines,
larger text and markers, higher contrast, no vertical text, and less detail,
because viewing time is not under the reader's control.

## Failure modes and their detection cues

| Failure | Detection cue |
|---|---|
| Figure restates the text | Does removing it lose information the caption and body don't already carry? If not, cut it |
| Colour is the only channel | Delete all colour. Can you still state the figure's claim? |
| Fails greyscale | Convert to greyscale and check every needed distinction survives |
| Radius-for-value encoding | Does the channel scale linearly with the value? Radius scales as √area, exaggerating ratios |
| Truncated axis | Does each axis start at a meaningful zero, or is the break explicitly flagged? Labelling it is not enough — bars remain the dominant cue |
| Unlabelled regime | Every shaded region has a text label, not just a colour key |
| Decorative formalism | Does every arrow and box correspond to something the proof uses? |
| Thin caption | Does the first sentence state the finding, or does it say "shown here is…"? |
| Example too large | Can a reader verify the claimed number with pen and calculator in a few minutes? |
