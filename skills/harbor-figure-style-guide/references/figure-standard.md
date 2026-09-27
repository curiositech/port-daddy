# The Harbor Figure Standard (v2)

This document is the normative rulebook behind the Harbor visual language defined in `figures/pd-figure-language.tex`. Every figure, plot, and diagram in the volume must comply with these specifications. In editorial and code reviews, cite rules by their identifier (e.g., *"Fails S2: font size below floor"*).

The 5-point legibility rubric in [`craft-rules.md`](craft-rules.md) applies in conjunction with these formal rules.

---

## S1. Page and Measure

- **Single-Column Figures (Default):** Drawn strictly to the 4.5 in (11.43 cm) column width (`\textwidth` in the 7 × 10 in trim).
- **Full-Width Figures (Wide):** May extend into the margin column up to 6.0 in (15.24 cm) only when the visual grammar requires horizontal span (e.g., multi-actor sequence lifelines, extended Gantt timelines). The author must explicitly justify full-width layout in the Gate 0 figure brief.
- **Forbidden Scaling:**
  - Never wrap a figure in `\resizebox{...}{...}`.
  - Never set `[scale=...]` or `[transform shape]` on the `tikzpicture` to force fitting.
  - Never rely on the preamble's overflow safety net (which scales down overflowing content, silently reducing 8 pt text to unreadable 5 pt glyphs).
  - All geometry must be authored directly to physical target dimensions (`x=1cm, y=1cm`).

---

## S2. Typography & The Typographic Law

- **The Single Size Rule:** Every named text role in a figure must use `\pdfiglabelsize` (`\footnotesize`, which resolves to 8.72 pt in the Book and 8.97 pt in standalone chapters).
  - **Hard Error:** `\tiny` (< 6 pt) and `\scriptsize` (< 7 pt) are strictly forbidden. Any glyph measuring under 7.0 pt in the rendered PDF fails the T1 geometry gate.
  - Do not use hardcoded `\fontsize{...}{...}\selectfont` inside individual nodes.
- **Typographic Voices:** A single figure may employ at most three voices:
  1. `pd title`: Bold head (`\bfseries`), used for panel headers, table column titles, and actor lifelines.
  2. `pd label`: Upright regular text (`\mdseries\upshape`), used for node descriptions, state names, and axis labels.
  3. `pd note`: Italic annotation (`\itshape`), strictly limited to at most *one* explanatory annotation per figure.
  - Supplemental marks: `pd tag` (knockout label on rules) and `pd kind` (small-caps category tag).
- **Font Family Uniformity:**
  - All diagram text must inherit the book's Swiss grotesk face (TeX Gyre Heros / Source Sans 3).
  - **Hard Error:** Never invoke `\rmfamily`, `\textrm`, `\normalfont`, or Computer Modern / Pagella serif faces inside a drawing.
  - `\texttt` is reserved exclusively for literal identifiers (code keywords, file paths, tool names).
  - Math mode (`$...$`) is reserved exclusively for formal mathematical variables and expressions; do not set ordinary English words or message names in math italics.
- **Text Formatting:**
  - Sentence case for titles and labels; never use ALL-CAPS for state names.
  - No hyphenation inside figures (`\hyphenpenalty=10000`). If a label wraps, declare an explicit `text width=` and break lines manually with natural phrasing.

---

## S3. Color & Hue Semantics

- **The Chapter Focus Hue:** The primary subject of the figure is drawn in `pd focus ...`, which dynamically resolves to the chapter's dominant hue:
  - Part I (Chapters 1–3): Cobalt (`pdcobalt` / `pdswissblue`)
  - Part II (Chapter 4): Teal (`pdteal`)
  - Part III (Chapters 5–6): Violet (`pdviolet` / `pdswissviolet`)
  - Part IV (Chapters 7–8): Gold (`pdgold`)
  - For standalone fragment compilation, declare `\pdfigurehue{pdcobalt}` immediately before `\begin{tikzpicture}`.
- **Concept Hues (Immutable Across Chapters):**
  - `pd truth` (`pdcobalt`): Ground truth, kernel state, authoritative specification.
  - `pd legible` (`pdteal`): Inspection, digest, human supervision.
  - `pd ready` (`pdhealth` / green): Admitted, verified, passing, active lease.
  - `pd protocol` (`pdindigo`): Federation, network wire, relay channel.
  - `pd identity` (`pdviolet`): Agent personhood, credentials, Macaroon harbor cards.
  - `pd reputation` (`pdrust`): Historical underwriting, earned track record.
  - `pd value` (`pdgold`): Escrow settlement, clearing, economic balance.
  - `pd breach` (`pderror` / red): Invariant violation, lease revocation, refusal, error.
  - `pd warn` (`pdamber`): Hazard boundary (used on rules and borders only; **never as text**).
- **Palette Discipline:**
  - A single figure may contain at most **2 to 4 hues**. If a diagram requires 5 hues, it is overloaded and must be partitioned into two figures.
  - **No Raw Colors:** Never use raw LaTeX/TikZ colors (`blue`, `red`, `black!30`, `hhteal`, `pdcobalt!40`, `#hex`). Always use semantic tokens so edition overrides function correctly.
- **Redundant Encoding (Accessibility & Print Safety):**
  - Every hue must be doubled by a secondary physical channel:
    - `pd breach` must be dashed, carry diamond markers, or feature an explicit label.
    - `pd warn` must use dashed line styling.
    - Regions must carry explicit text labels, not mere color fills.

---

## S4. The Line Weight Ladder

Lines in all diagrams must strictly conform to the 1 : 1.8 : 3.2 weight hierarchy:
1. **0.5 pt (`pd hairline` / `pd guide`):** Alignment guides, grid ticks, artifact edges, fill outlines, badge borders.
2. **0.9 pt (`pd rule` / `pd msg` / `pd state`):** Standard flow arrows, state borders, protocol sequence messages, table dividers.
3. **1.6 pt (`pd spine` / `pd focus rule` / `pd focus state`):** The primary causal spine, focus transitions, highlighted state boundaries.
- **Arrowheads:** Scale automatically with stroke width (`-{Stealth[length=...,width=...]}`). Never mix arbitrary arrow tips.

---

## S5. Surfaces, Fills, and Borders

- **Surface Hierarchy:**
  - `pd state`: Base neutral element (white ground, crisp 0.9 pt dark ink border).
  - `pd artifact`: Subordinate entity (white ground, 0.5 pt subtle grey border).
  - `pd focus state` / `X state`: Active subject (24% color tint, enclosed by a 1.6 pt same-hue border).
  - `pd climax state` / `pd terminal`: Decisive outcome (solid color fill with crisp white knockout type).
- **Enclosure Invariant:**
  - **Every fill must have a drawn boundary.** Bare color washes with un-edged boundaries bleed into surrounding white space and fail print contrast.
  - Text on pale and focus fills must remain dark ink (`pdink`). White knockout text is strictly reserved for solid climax states and terminal breaches.

---

## S6. Ground & Knockouts

- The page background is pure white (`pdpage`).
- **No Parchment / Cream Stickers:** Never tint background frames in cream, sand, or ivory on white book pages. A tinted rectangle reads as an unintegrated sticker.
- **Knockouts:** Use `pd tag` (white knockout background) when a text label must cross a horizontal rule or lifeline. In all other cases, position labels in clear negative space.

---

## S7. Layout & Geometry

- **Grid Discipline:** Declare coordinate pitch upfront using `\def` constants (e.g. `\def\dx{3.2}`, `\def\dy{1.4}`). Position every node relative to the grid or via relative positioning (`right=of ...`).
- **Equal Geometry:** Nodes sharing equal semantic roles must have identical widths, heights, and padding.
- **Orthogonal Routing:** Arrow lines should be straight or follow 90° Manhattan bends. Diagonal crossings and unconstrained curves are banned unless the intersection itself represents the conceptual claim.
- **Clearance:** Maintain a minimum 5–8 pt margin between text and any enclosing rule or adjacent arrow.
- **Legends:** Never embed explanatory prose blocks inside the TikZ drawing area. Format legends as ruled `tabular` / `booktabs` tables positioned directly beneath the drawing within the `figure` environment.

---

## S8. Concrete Content

- **No Anonymous Placeholders:** Every node, step, and axis must use concrete instances from the chapter: real actor identities, authentic git commit SHAs, real API endpoints, and exact measured metrics.
- **No Metaphorical Arrows:** Avoid arrows pointing into ambiguous white space. Every edge must originate at a concrete source and terminate at an explicit target.

---

## S9. Captions and Provenance

- **Self-Contained Captions:** Captions must state the primary finding or takeaway in full, not merely describe the topic.
- **Provenance Header:** Every fragment `.tex` file must begin with a structured header comment stating the figure label, target trim, and source script/data.
