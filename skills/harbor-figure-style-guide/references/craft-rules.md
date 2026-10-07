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

### 6. Vector Reconstruction & Collision Invariants (Production Lessons)
Hard-won lessons from reconstructing complex raster prototypes into native Swiss TikZ:
1. **The Single-Node Compound Label Rule:** Never split a title and its accompanying descriptive subtitle into two separate `\node` declarations with a hardcoded $\Delta y$. If the title wraps due to `text width`, its lower line will collide directly into the subtitle node below it. Instead, format them inside a **single** `\node[align=left]` using `\textbf{Title}\\{\color{pdink!80!black}\mdseries Subtitle}`. This guarantees that TeX's layout engine manages leading (`\baselineskip`) naturally, completely eliminating self-collision.
2. **The Coordinate Budget Law (`\pdfullwidth = 15.0cm`):** In Tufte-style full-width book layouts, all graphical elements and text must reside strictly within $[0.0, 14.8]\,\text{cm}$. Anchor leftmost callouts at $x \ge 0.0$ with `anchor=west`. Anchoring at $x = 0.8$ with `anchor=east` causes text to project into negative coordinates ($x \approx -1.2\,\text{cm}$), which silently expands the bounding box and forces right-hand marginal elements past the page edge.
3. **The Strict Sentence-Case Doctrine:** Prototype raster diagrams frequently employ ALL-CAPS for titles and labels. During vector reconstruction, convert all text to strict sentence case (`Concurrent processes`, `Serial funnel`, `Multi-stream event firehose`). ALL-CAPS forms dense, ink-heavy geometric rectangles that impair readability and violate Tufte data-ink principles.
4. **Central Hub Routing Clearance:** In topologies featuring a central processing hub (e.g., attention filter hexagon, supervisor, dispatcher), return/feedback paths must route strictly along the *outer* perimeter of the hub before turning horizontally. Never allow lines to penetrate the hub interior or cross through internal status text.
5. **Stacked Bracket Partitioning:** When annotating groups with curly brackets on the margin, ensure brackets partition the vertical domain (e.g., bracket 1 covers entries 1–2; bracket 2 covers entries 3–5). Never place labels for separate brackets at identical vertical coordinates ($y$).
6. **Descent Clearance Above Enclosures:** Arrows dropping from an outer authority envelope into a nested child container must terminate with clear vertical clearance above the child title ($y_{\text{arrow end}} \ge y_{\text{title}} + 0.35\,\text{cm}$) to prevent arrowheads from impaling letter ascenders.
7. **Knockout Dimensioning:** Any dimension rule or callout arrow passing through an annotation zone must use `\node[..., fill=pdpage, inner sep=2pt]` to knock out underlying rules and preserve pristine typography.
8. **No Embedded Canvas Titles:** Never embed title banners (e.g., `Figure 0.4: Attention Filter`) inside the TikZ canvas. Titles belong exclusively in the caption (`\pdwidecaption{...}`) or running header.

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
