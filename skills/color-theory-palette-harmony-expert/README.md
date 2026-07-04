# Color Theory & Palette Harmony Expert

Design harmonized, diversity-aware color palettes for computational photo
composition, using perceptual color science (LAB space, CIEDE2000) and
optimal transport (Earth-Mover Distance, Sinkhorn) rather than naive
RGB/HSV distance.

Use this skill when selecting or arranging a subset of photos/colors for a
collage, sequence, or grid, when you need to avoid picking a "diversity
collapsed" set (all similar dominant colors), or when you need a warm/cool
or hue-sorted arrangement that reads as intentional rather than jarring.

## Quick Start

1. Read `SKILL.md` for the decision trees, failure modes, and quality gates.
2. Load `references/perceptual-color-spaces.md` for the LAB/LCH rationale
   and CIEDE2000 formulation.
3. Load `references/optimal-transport.md` for the Earth-Mover
   Distance/Wasserstein formulation and Sinkhorn epsilon tuning.
4. Load `references/temperature-classification.md`,
   `references/arrangement-patterns.md`, and
   `references/diversity-algorithms.md` for the specific arrangement or
   selection strategy the decision tree points to.
5. Fill `templates/output-template.md` for the task at hand, or write a
   palette-selection plan matching `schemas/palette-plan.schema.json`
   directly.
6. Run `node scripts/palette_audit.mjs --input plan.json`.

A plan that scores `pass: true` should already satisfy the skill's own
quality gates (LAB space, CIEDE2000, diversity, saturation spread,
temperature coherence, Sinkhorn convergence, blend-ratio authenticity). If
it doesn't, fix the plan — not the auditor.
