# Editorial Craft Rules & Legibility Rubric

This reference defines how figures, charts, and diagrams are evaluated, triaged, and authored for publication in *The Harbor, the Person, and the Economy*. While mechanics are audited by automated tooling (`check_figure_style.py`), editorial judgment dictates whether a figure belongs on the page at all.

---

## Gate 0: The Six-Line Figure Brief

No diagram or plot may be authored or revised without a written six-line brief in its fragment header or work notes. If you cannot answer these six questions concisely, the content is a paragraph or table, not a figure.

1. **Reader Question:** What specific decision, distinction, or comparison does the reader make from the geometry in under five seconds?
2. **One-Sentence Claim:** What is the core assertion, with the direction of cause and effect explicit?
3. **Evidence:** What concrete data, state names, actor identities, code identifiers, or simulation outputs substantiate the claim?
4. **Must Distinguish:** Which two or three entities, failure modes, or lifecycle phases must the visual geometry keep strictly separate?
5. **Grammar Chosen vs. Rejected:** What diagram kind was selected (from `taxonomy.md`), and why would the rejected alternatives mislead or clutter?
6. **Acceptance Test:** What should a reader who glances at the figure for five seconds without reading the prose be able to state aloud?

---

## The 5-Point Legibility Rubric

A figure earns its space on the printed page only if it satisfies all five criteria simultaneously:

### 1. One Readable Fact
The diagram must convey a concrete structural, temporal, or quantitative fact that cannot be stated as effectively in a single prose sentence or simple table.
- *Fails:* A node-link graph with boxes labelled "Agent 1", "Agent 2", and "Database" connected by arrows meaning "communicates with".
- *Passes:* A sequence diagram showing that Agent 1 holds an exclusive AST write lease until commit $t_3$, causing Agent 2's request at $t_2$ to trigger an immediate, non-blocking refusal.

### 2. Concrete Instance
Never draw abstract metaphors, empty cards, or anonymous placeholder dots.
- *Fails:* "Step A $\to$ Step B $\to$ Step C" with generic labels.
- *Passes:* Real commit hashes (`0x4a9b`), concrete tool permissions (`seatbelt:fs_read`), authentic agent identifiers (`orchestrator`, `contractor-1`), and exact numerical thresholds ($\$4.20$, $180\,\text{s}$).
- *Theoretical Basis:* Cleveland & McGill’s perceptual psychophysics demonstrates that readers extract meaning rapidly from position on an anchored scale, but cannot reliably decode abstract shapes without labels.

### 3. Anchored Geometry
Nothing floats in unanchored white space. Every node, path, and region must align to an explicit geometric datum or axis:
- In timelines/Gantt charts: every bar terminates at a marked timestamp or commit tick.
- In state machines: every transition originates and lands at an explicit state perimeter.
- In protocol ladders: messages run horizontally between vertical actor lifelines.
- Regions and hazard zones must feature drawn boundaries, not diffuse color clouds.

### 4. Print Contrast at 100%
Figures must be designed for 300+ DPI monochrome and color book print:
- Shaded fills must have $\ge 24\%$ opacity and be enclosed by a solid drawn edge of $\ge 0.5\,\text{pt}$.
- Hairline guides must measure $\ge 0.5\,\text{pt}$.
- Data points, markers, and badges must have a radius $\ge 2\,\text{pt}$.
- All typography must remain $\ge 7.0\,\text{pt}$ at final printed scale (minimum $8.7\,\text{pt}$ for standard body labels).
- Test criterion: The figure must be effortlessly legible when viewed as a 150 DPI PNG rendered at 1.0× scale on a smartphone screen.

### 5. Zero Collisions & Zero Occlusion
- No arrow or guide line may pass through a text label.
- No label may overlap or touch an adjacent label (minimum 5 pt clear gutter).
- No graphical element may extend past the declared bounding box (`\useasboundingbox`) or collide with the caption text beneath the drawing (figcheck T2–T4 and T8 clean).

---

## Page Role Classification

Before drawing, evaluate the relationship between the figure and its host page:

| Page Role | Definition | Editorial Action |
|---|---|---|
| **Carries** | The core theoretical idea is read directly off the visual geometry; the accompanying prose explicitly references and analyzes it. | **Retain & Polish.** Ensure geometry is authoritative. |
| **Supports** | The figure provides an authentic worked example or trace that reinforces an argument established in the prose. | **Retain.** Keep compact; avoid repeating prose verbatim. |
| **Decorates** | The figure merely illustrates what adjacent text or tables already state, providing visual filler. | **Delete.** Convert to a compact sentence or table. |
| **Interrupts** | An oversized or poorly positioned exhibit that splits a continuous sentence across a page break or introduces concepts not yet defined. | **Relocate or Refactor.** Move to top of next page (`[!t]`) or streamline. |

Only **Carries** and **Supports** survive into the published volume.

---

## Triage Dispositions

When auditing existing figures, assign one of six explicit dispositions:
1. **Keep:** Figure meets all 5 rubric points, adheres to the typographic law, and carries or supports the page.
2. **Restyle:** Semantic idea and layout are sound, but styling violates tokens (raw colors, wrong font size, missing border lines). Fix styles using `figures/pd-figure-language.tex`.
3. **Redraw:** Conceptual claim is valuable, but the visual grammar is defective (e.g., an architectural cartoon that should be a sequence diagram). Redraw from scratch on a clean modular grid.
4. **Table:** The content is primarily a categorization, property matrix, or parameter listing. Replace the TikZ drawing with a `booktabs` / `tabularx` table.
5. **Delete:** The diagram adds no insight beyond the caption or prose. Remove entirely.
6. **Add:** A critical theoretical transition lacks visual evidence. Draft a new figure following Gate 0.
