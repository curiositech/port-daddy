---
name: harbor-book-rewriter
description: >-
  Rewrite, extend, and visually normalize The Harbor, the Person, and the
  Economy as one assembled textbook. Use for chapter rewrites, new examples,
  theorem exposition, figure redesign, marginalia, captions, reader pacing,
  and Book-wide visual QA. This is the focused integration layer above
  textbook-craft, Tufte evidence design, research-paper exposition, technical
  writing, and tikz-diagram-craft. NOT for standalone chapter PDFs, research-
  paper submission formatting, marketing copy, or unreviewed bulk restyling.
allowed-tools: Read,Write,Edit,Bash,Grep,Glob
metadata:
  category: Writing & Communication
  tags:
    - textbook
    - exposition
    - latex
    - tikz
    - marginalia
    - formal-systems
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: textbook-craft
      reason: Supplies chapter architecture, exercise design, and learning-science evidence.
    - skill: tufte-evidence-design
      reason: Supplies margin apparatus, evidence integrity, and analytical-design doctrine.
    - skill: tikz-diagram-craft
      reason: Draws and mechanically checks the figures selected by this skill.
    - skill: high-quality-latex-whitepaper
      reason: Owns durable LaTeX engineering and shared macro design.
    - skill: research-paper-submission
      reason: Supplies formal-exposition and figure/caption discipline.
  io-contract:
    kind: deliverable
    consumes:
      - kind: assembled-book-pdf
        format: pdf
      - kind: chapter-source
        format: latex
    produces:
      - kind: rewritten-book-source
        format: latex
      - kind: book-figure-set
        format: tikz
      - kind: visual-review-evidence
        format: pdf
---

# Harbor Book Rewriter

Rewrite the Book as a book. The unit of judgment is the assembled 7×10-inch
volume, not an isolated `.tex` fragment and not a standalone chapter PDF.

The reader should be able to enter through a concrete failure, understand one
worked instance, see the formal claim arrive as the name for what they just
understood, inspect the proof at their chosen depth, and leave knowing exactly
where the result stops. Figures, captions, marginalia, examples, and prose are
one argument—not separate production tracks.

## Non-negotiable Book contract

1. **Build only the assembled Book.** Chapter PDFs are retired. Shared source
   must survive the Book generator and the Book preamble.
2. **Share the grammar.** Typography, theorem kinds, captions, marginalia,
   plots, arrows, UML, sample transcripts, and exercise treatments belong in
   shared macros or styles whenever two chapters need them.
3. **Judge the printed size.** A source-level lint pass is not visual approval.
   Inspect the rendered Book page or a contact sheet at 100%.
4. **Assume every legacy figure is suspect.** Preserve its information, not
   its accidents. A passing compile does not prove the figure communicates.
5. **Never silently change epistemic status.** A theorem, design invariant,
   bounded model-check result, and empirical hypothesis are different kinds.
6. **Do not use the local Port Daddy runtime.** Ordinary Git, hosted CI, and
   native collaboration are sufficient for this work.

## The governing reader model

The Book serves two readers on the same page:

- The **newcomer** needs a scene, a worked example, local definitions, and a
  visible path through the machinery.
- The **expert** needs a short route to the claim, assumptions, proof idea,
  boundary, and evidence without being trapped inside tutorial prose.

Do not average these readers into one muddy middle. Build an **express lane**:
the claim and proof structure remain skimmable while examples and asides are
visibly optional. This is the practical consequence of the worked-example and
expertise-reversal effects.

Synthetic personas are pressure tests, not evidence. Use them to find divergent
failure modes; validate expensive or irreversible editorial decisions with
real readers.

## Rewrite sequence

Work top-down. Sentence polishing before structural repair wastes time and
usually makes the wrong structure harder to remove.

### 1. Name the chapter's one obligation

Write one sentence for each:

- **Condition:** what the reader does not yet understand or cannot yet trust.
- **Cost:** what breaks, confuses, or becomes unsafe without this chapter.
- **Claim:** what the chapter establishes.
- **Boundary:** what the claim does not establish.
- **Handoff:** what the next chapter must add.

If these cannot be written plainly, stop adding content. The chapter has a
goal problem, not a prose problem.

### 2. Rebuild the first spread

The first spread should contain, in order:

1. proposition-title;
2. at most one or two load-bearing epigraphs;
3. a concrete failure scene with a number in it;
4. the chapter's question in one sentence;
5. a short claim with its epistemic kind;
6. the three strongest objections;
7. the route and the expert express lane;
8. one hand-checkable worked example before the first general definition.

Do not open with an abstract, keyword list, estimator catalog, result table,
or notation dump.

### 3. Build each formal result as a teaching beat

For every major result:

1. **Situation:** a developer, operator, or agent does something recognizable.
2. **Failure:** show the concrete bad outcome and its cost.
3. **Worked instance:** use actual names, paths, values, messages, or commands.
4. **Intuitive reading:** say what should be true before giving it a symbol.
5. **Local definitions:** define only the terms needed for the next claim.
6. **Formal claim:** one crisp statement with explicit assumptions and kind.
7. **Proof idea:** plain English before proof details.
8. **Proof or evidence:** structured, reproducible, and matched to the claim.
9. **Read-out:** translate the result back into the concrete instance.
10. **Boundary:** name one regime where the result fails, is bounded, or is
    untested.

Definitions belong immediately beside first use. The name is the punchline for
a mechanism the reader already understands, not an entrance fee.

### 4. Ground abstractions in modern AI-development scenes

Prefer a stable running example that can recur across chapters. A good scene
contains actors, artifacts, a race or decision, and an observable consequence.

Example shape:

> Three agents launched by cron jobs and a prototyping spree simultaneously
> edit `settings.json`. One edit is harmless, one immediately breaks the repo
> for another developer, and one survives because no relevant mutation test
> existed. The delayed bug is the expensive one.

Do not stop at a cute story. Carry the same actors through the state machine,
sequence diagram, theorem instance, counterexample, and repair. The repeated
surface details lower orientation cost while the mechanism changes.

### 5. Cut before decorating

Cut or relocate:

- repeated reader maps;
- surveys of alternatives the argument never uses;
- duplicate figures that make the same claim;
- unlabeled philosophical detours;
- definitions whose first use is many pages later;
- captions that repeat the body;
- ornamental theorem labels;
- boxes used only to announce importance.

At most one philosophical or historical **Interlude** per chapter: named,
bounded, and skippable without losing the argument.

## Figure grammar: choose the relation before the style

A figure begins with a reader question and one sentence that the figure makes
easier to know. If neither can be written, do not draw it.

| Reader question | Preferred grammar |
|---|---|
| What talks to what, and in what order? | Sequence diagram |
| Who owns each step? | Swimlane/activity diagram |
| Which states and transitions are legal? | UML state machine |
| What runs concurrently or over time? | Gantt/timeline |
| What depends on what? | Dependency DAG |
| What crosses a trust boundary? | Component/deployment diagram with explicit boundary |
| What entities and relations persist? | ERD/olog |
| Where does a threshold change the outcome? | Regime diagram |
| How does a metric vary? | Plot on aligned scales |
| How do repeated cases differ? | Small multiples |
| What exact values matter? | Table, optionally with sparklines |
| How does one concrete case execute? | Worked trace or annotated transcript |

Use multiple coordinated figures when one graphic would need to answer
different questions. A sequence diagram and an authority-envelope diagram can
both belong if one explains messages and the other explains attenuation.

## Figure composition rules

### One visual sentence

Every figure should support one declarative sentence. A reader should know
where to begin and where to end within five seconds.

### Spend an expressive ladder, not one flat fill

Swiss modernism does not mean solid chapter-colour boxes everywhere. Preserve
the edition's grotesk and right-angle discipline while expressing hierarchy
through a shared ladder:

1. white artifact with a quiet edge;
2. neutral pale state with a visible ink edge;
3. concept outline with white ground;
4. pale focus field with a stronger chapter-hue edge;
5. hatch or dot texture for a categorically different surface;
6. one solid climax state with knocked-out type.

Hue identifies the chapter or concept; it is not the only hierarchy channel.
Reserve the solid surface for the one culmination a reader should name after
five seconds. Breaches and terminal states may also be solid because their
meaning is categorical. A Swiss rendering that removes borders, texture, and
surface variation while maritime and technical retain them has failed the
edition, even if its palette is correct.

On the three-edition sheet, Swiss should still expose the same categorical
range: white artifact, neutral mechanism, hue outline, pale concept field,
patterned exception, and solid climax. Do not translate every non-white
maritime or technical surface into the same Swiss rectangle. When three or
more nodes of unlike roles share one style, redistribute them onto the ladder
before inventing another hue.

### Use the full field when needed

The Book offers a 4.5-inch text column and a 6.0-inch text-plus-margin field.
Do not crush a protocol, timeline, or proof journey into 4.5 inches merely to
keep a narrow float. Spend the margin when readable type or visible topology
requires it.

### Text and boxes

- One figure type family and no more than three type sizes.
- Final-size labels should remain comfortably readable; never rescue a crowded
  composition by shrinking type.
- Give text vertical breathing room with shared minimum height and `inner ysep`.
- Never place a tag, label, or white knockout over a box border.
- Do not let text wash out an edge. Move the text or route the edge.
- A panel title belongs outside the panel with a measured moat.

### Arrows and connectors

- An arrowhead must have a visible shaft before it. A triangle at a corner is
  not an arrow.
- Reserve at least 8–12 final-size points of straight shaft before the head.
- Route connectors on a background layer; place opaque nodes over them.
- Use explicit split and merge junctions for fan-out/fan-in.
- End arrowheads on a straight approach, not directly after an orthogonal turn.
- Do not cross text. If a crossing is unavoidable, add a bridge or change the
  layout.
- Direction, control status, trust, and failure must not depend on color alone.

### Plots

- Position on a common scale beats area, hue, or decoration.
- Direct-label series and regimes when space permits.
- Keep scales aligned across small multiples.
- Show the threshold, baseline, or counterfactual the claim compares against.
- A table beats a plot when the reader needs fewer than roughly twenty exact
  values; combine a table and sparkline when exact values and trend both matter.
- State provenance: generated script and seed, model-checked artifact, internal
  derivation, or hand-derived arithmetic.

### Captions

The first sentence states the finding, not “shown here.” Keep the margin caption
pithy; move derivation, provenance detail, and caveats into source prose or a
separate note when the margin cannot carry them legibly. Captions and all other
margin material must occupy the outer margin: left on even pages, right on odd
pages.

### Marginalia

Use the margin for material that can be ignored without breaking the sentence:

- a first-use gloss in plain English;
- a portrait where the person's idea does real argumentative work;
- a one-line aside or warning;
- a tiny comparison, sparkline, or regime strip;
- provenance and cross-reference pointers.

Do not use portraits as wallpaper or to repair a wall of text. Use a worked
example, session, boundary, or figure for that.

## Sample-data and transcript grammar

Sample material must never masquerade as theory or live evidence. Give all
Maya/operator excerpts and synthetic records one shared continuous-feed-paper
treatment:

- monospaced type;
- light paper tint, not a theorem-box tint;
- perforated tractor-feed strips or sprocket holes at both sides;
- a visible label such as `SAMPLE`, `SYNTHETIC`, or `RECORDED SESSION`;
- source and time/seed when available;
- no implication that synthetic dialogue is an actual interview.

Use the shared `pdsampledata` environment. Its optional argument records the
source, status, and seed; the environment supplies monospaced type, the
`SAMPLE DATA` head, paper tint, and tractor-feed edges. Use `pdsession` only
for checked-in captured transcripts. Do not draw a fresh faux-paper frame in
each chapter.

## Page grammar and pacing

- A page should normally contain no more than three content kinds.
- Avoid runs of more than four body pages without a figure, table, worked
  example, or transcript.
- Keep important claims adjacent to their intuition and evidence.
- Prefer one stable apparatus to a chapter-specific callout invention.
- Exercises belong at chapter end, grouped by the section they test, with
  margin pointers at the original point of use.
- Close with Review of the Key Ideas, Exercises, History and references, and
  the explicit handoff.

## Book-only implementation route

1. Read `whitepaper/textbook.json` to find canonical chapter order and part hue.
2. Edit canonical source and shared twins carefully; twins must remain
   byte-identical where the repository contract requires it.
3. Compile focused figure fragments with the **Book preamble** in Swiss,
   maritime, and technical editions.
4. Generate the assembled Book with
   `scripts/generate-mega-whitepaper.mjs`.
5. Compile the generated Book root. Do not build standalone chapter PDFs.
6. Render relevant Book pages and a contact sheet at final size.
7. Inspect manually for hierarchy, clipping, collisions, tiny type, broken
   arrow shafts, washed borders, bad page parity, and wasted space.
8. Run mechanical checks only after the human question is answered. A green
   checker is evidence that a picture compiled, not that it communicates.

## Rewrite output contract

Every rewrite pass should leave:

1. a short statement of the reader problem fixed;
2. the source files changed;
3. the rendered Book pages or contact sheet reviewed;
4. the epistemic status and provenance of any new claim or number;
5. the before/after information difference, not merely a style difference;
6. known boundaries and remaining jank;
7. a clean, scoped commit suitable for review.

## Stop conditions

Do not call a rewrite finished when any of these remain:

- the figure needs its caption to reveal where reading begins;
- an arrowhead looks detached from its shaft;
- a label clips or masks a box border;
- a formal term appears before its concrete use;
- a worked example cannot be redone by hand;
- a theorem has no intuitive reading or proof idea;
- a sample transcript could be mistaken for actual evidence;
- a caption falls into the inner margin or into the body only because the
  margin version overflowed;
- the Book has not been rebuilt and visually inspected.

## Deeper references

Read these source skills when the pass needs their full apparatus:

- `skills/textbook-craft/SKILL.md` and all of its `references/` for chapter
  structure, learning science, exercises, and canon.
- `skills/tufte-evidence-design/SKILL.md` and all of its `references/` for
  analytical design, margins, critiques, and evidence integrity.
- `skills/tikz-diagram-craft/SKILL.md` and
  `references/figure-standard.md` for implementation and QA.
- `skills/high-quality-latex-whitepaper/SKILL.md` for shared LaTeX machinery.
- `research-paper-submission/references/exposition-craft.md`,
  `figures-and-examples.md`, and `exemplar-structures.md` for local formal
  exposition and community-aware figure practice.
- `port-daddy-expository-writer/SKILL.md` and its references for warm,
  technically precise explanation of formal systems.
- `technical-writer/SKILL.md` for Diataxis and documentation completeness.

This skill decides how those systems compose inside this Book. It does not
replace their deeper reference material.
