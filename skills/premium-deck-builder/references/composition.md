# Composition, Layout & Hierarchy for Slides

Load when laying out a new deck or auditing slide-type discipline.

## Grid systems — pick one, hold it across the deck

| System | Use | Source |
|---|---|---|
| **Consulting 4-column** | Dense, printable "ghost decks." Page splits into 4 vertical columns + top action-title band + bottom source/footnote band. Charts and exhibits snap to 1, 2, or 4 columns. | McKinsey, BCG, Bain |
| **Swiss 12-column** | Safe modern default. 12 divides cleanly into halves, thirds, quarters, sixths. Maps directly to 16:9 widescreen. | Josef Müller-Brockmann, *Grid Systems in Graphic Design*, 1981 |
| **Golden ratio / rule-of-thirds** | Image-led title and section slides. Place subject and headline on the 1/3 lines, not centered. | Tufte; classical photography |
| **Duarte modular** | Start with 6 or 12 modular units with explicit margin and gutter tokens BEFORE any content lands. | Nancy Duarte, *Slide:ology*, O'Reilly 2008, ch. 4 |

Stick to one grid for the whole deck. Visible inconsistency between slides reads as a sloppy maker, not a generous designer.

## Focal hierarchy — pick a mode per slide, not per deck

Three established modes for what a slide is *doing*. Each comes from a different tradition:

### LIVE mode (Reynolds — *Presentation Zen*, 2008)
- One idea per slide.
- Generous negative space.
- Image-led; speaker carries the message verbally.
- Body floor: 24pt. Word count: 15–20 max.
- For live, in-room delivery.

### SLIDEDOC mode (Duarte — *Slidedocs*, 2014)
- High-density hybrid of slide + document.
- Designed to be **read** asynchronously, not presented.
- Explicitly NOT for projection.
- ~75–150 words per page; sidebars, captions, footnotes, full sentences allowed.
- For board memos, leave-behinds, sales packets.

### CONSULTING EXEC-SUMMARY mode (McKinsey / Minto's *Pyramid Principle*)
- **Action title** at top: full sentence conclusion, NOT a topic label.
- **"So what" callout box** stating the implication.
- **Supporting exhibits** below: charts, tables, evidence.
- Source line at the bottom in mono.
- Answer first, then support — Minto's pyramid logic.

## Assertion-Evidence framework (Alley)

Replace the topic-phrase title + bullets pattern with:

1. **Sentence-headline assertion** stating the slide's single claim.
2. **Visual evidence** (chart, diagram, image, equation) supporting it — **not bullets**.

Source: Michael Alley, *The Craft of Scientific Presentations*, Springer, 2nd ed. 2013. Alley/Garner/Zappe (*IEEE Trans. Prof. Comm.* 2009) demonstrated assertion-evidence beat topic-phrase-plus-bullets on **both** comprehension AND retention.

Default body bullets to **last resort**. Bullets only when content is genuinely enumerable and parallel ("the three guarantees we offer," "five eligibility criteria").

## Density limits and when to break them

- **Live talk:** one idea, ≤15–20 words of body text, image or chart does the work.
- **Slidedoc:** density is the *point* — sidebars, captions, footnotes, full sentences.
- **Decide *before* designing which mode a deck is.** Mixing modes produces slides that fail at both.

## Slide types — choose deliberately, don't default

| Type | Purpose | Pattern |
|---|---|---|
| Title | Deck title, presenter, date, audience | Image-led OK; minimal text |
| Section divider | Palate-cleanser between acts | Large numeral or word; one accent color |
| Content (assertion-evidence) | Carry a single argument | Sentence-headline title + visual evidence; bullets only if genuinely enumerable |
| Comparison (split) | Show A vs B vs C | 2 or 3 columns, equal weight, parallel structure top-to-bottom |
| Data / chart | Convey a quantitative finding | One chart + one headline conclusion + redundant encodings stripped + source line |
| Quote / pullquote | Land a single idea attributed to a person | Large type + attribution + single sentence |
| Image-led | Carry meaning visually | Full-bleed + headline overlaid on a calm region with sufficient contrast |
| Transitional | Bridge between sections | Restate where we are in the argument |
| Agenda / tracker | Set expectations | Show once up front; optionally a persistent footer marker |
| Closer / Q&A | Land the takeaway | Single takeaway or CTA — **never "Thank you!" alone** |

## Handling charts, tables, quotes, images

- **Tables:** only when readers must look up cells; otherwise convert to a chart. Right-align numerics, align decimals, dim gridlines.
- **Charts:** one comparison per chart. Conclusion in the title — Cole Knaflic, *Storytelling with Data*, Wiley 2015. Strip chartjunk per Tufte. If you can't write the action title, delete the chart.
- **Quotes:** attribute fully. Pull a single sentence, not a paragraph. Large type at 36–48pt for live; pull-quote size for slidedoc.
- **Images:** full-bleed or hard-aligned to grid. Never floating, never drop-shadowed, never stretched off-aspect. Crop tight to a single subject.

## The 6×6 rule (and 7×7, 5×5) is wrong

The "6 bullets, 6 words per bullet" rule encodes the bullet-slide default Alley and Tufte spent careers attacking. Edward Tufte, *The Cognitive Style of PowerPoint: Pitching Out Corrupts Within* (Graphics Press, 2nd ed. 2006), argues bullet hierarchies fragment reasoning and hide evidence. His Columbia/NASA case study is the canonical example.

Replace 6×6 with: **one assertion per slide; evidence carries the load; bullets only when content is genuinely a list.**

## Margins, white space, breathing room

- Outer margins ≥ 8–10% of slide width on left/right.
- Top/bottom margins ≥ 6% of slide height.
- Target 40–60% of the slide as negative space. **If a slide is more than 60% "filled," cut content.**
- McKinsey/BCG decks routinely use 80–100px outer margins on a 1920px canvas.

## Anti-patterns

### Title-then-bullets default
Reaching for the bullet layout because it's the template's first option. Force a choice between assertion-evidence, comparison, chart, image-led, or quote BEFORE any bullets appear.

### Lorem-ipsum chart / decorative chart
A chart present for visual weight but not actually read — unlabeled axes, no source, conclusion not in the title. If you can't write the action title, delete the chart.

### Topic-phrase title ("Q3 Results")
Replace with the conclusion: *"Q3 revenue grew 18%, driven by enterprise renewals"* (Alley; Minto).

### Walls of text projected live
Slidedoc density on a projector. Either split into one-idea slides OR convert the deck to a written slidedoc and don't project it.

### "Thank you" / "Questions?" closer
Wastes the highest-recall slot in the deck. End on the single takeaway or the call to action.

### Mystery-meat agenda persistence
A tiny tracker bar nobody can read. Either make it legible (≥14px in slide-mode, ≥18pt in live-mode) or drop it and use section dividers.

## Sources

- Josef Müller-Brockmann, *Grid Systems in Graphic Design* (1981).
- Nancy Duarte, *Slide:ology* (O'Reilly 2008); *Resonate* (Wiley 2010); *Slidedocs* (Duarte Press 2014, free PDF).
- Garr Reynolds, *Presentation Zen*, 2nd ed. (New Riders 2011).
- Edward Tufte, *The Cognitive Style of PowerPoint*, 2nd ed. (Graphics Press 2006).
- Michael Alley, *The Craft of Scientific Presentations*, 2nd ed. (Springer 2013); Alley/Garner/Zappe, *IEEE Trans. Prof. Comm.* (2009).
- Barbara Minto, *The Pyramid Principle* (1987).
- Cole Nussbaumer Knaflic, *Storytelling with Data* (Wiley 2015).
