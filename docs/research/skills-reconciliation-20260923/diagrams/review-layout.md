# Browser and render review

Opened `index.html` in bundled Playwright Chromium at 1440 × 1000 and 390 × 844, then inspected the rendered PNGs and both full-page screenshots with `view_image`.

At 1440 px, the evidence row measures 1,613 px inside a 1,096 px canvas and scrolls horizontally; the two top-to-bottom diagrams fit the canvas width. At 390 px, the scroll viewport is 354 px: evidence row 1,613 px, evaluation 621 px, recovery 1,037 px. Each canvas is keyboard-focusable. Images retain intrinsic size instead of scaling the whole graph to the viewport.

On narrow screens, evaluation and recovery canvases open centered on their main reading spines (`scrollLeft` 151 px and 275 px at 390 px viewport). Their first key labels are visible without moving sideways. The evidence row still opens on its first card. “Scroll sideways to trace branches” and a full-SVG link sit below each wide diagram. After simulated user scrolling, resizing from 390 px to 370 px preserved the user's evaluation position (175 px).

Review captures: [desktop](review-gallery-desktop.png) and [mobile](review-gallery-mobile.png). The corresponding standalone rendered diagrams are opaque-white PNGs: `research-evidence-classes.png`, `research-matched-budget-evaluation.png`, and `research-uncertain-effect-recovery.png`.

All three diagrams have editable Mermaid Markdown sources and visually matched DOT render sources. Graphviz rendered the committed SVG/PNG outputs because a Mermaid image renderer was not available. The Mermaid structure validator passed. Visual review found and corrected the recovery transition-label collision; the final image shows `success receipt` and `query receipt / state` labels separated. No agent runs, experiment results, or deployed behavior were tested here.
