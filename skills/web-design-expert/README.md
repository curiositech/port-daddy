# Web Design Expert

Creates unique web visual systems: brand identity, color palettes, layout
composition, and responsive UI patterns for web applications.

Use this skill when developing brand identity, choosing a layout approach,
building a color strategy, or setting visual hierarchy for a web product. It
does not go deep on typography mechanics, color-theory math, design-system
tokens, or accessibility audits — those are handled by sibling skills named
in the NOT-FOR section of `SKILL.md`.

## Quick Start

1. Read `SKILL.md` for the decision trees (layout approach, color palette
   strategy, visual hierarchy) and the Quality Gates checklist.
2. Load `references/layout-systems.md` for the grid decision tree, spacing
   scale, and responsive breakpoints.
3. Load `references/color-accessibility.md` for the minimum viable palette,
   color psychology, dark-mode guidance, and the WCAG checklist.
4. Load `references/tooling-integration.md` when using 21st.dev/Figma MCP
   tools to go from design to code.
5. Fill `templates/output-template.md` (or write a plan matching
   `schemas/design-plan.schema.json` directly) to state what the design
   actually achieves, not just what it intends.
6. Run `node scripts/design_audit.mjs --input plan.json` to check the plan
   against this skill's Quality Gates and its five named failure modes
   before treating the design as ready to build.

A design plan that scores `pass: true` should mean a reviewer can trust the
Quality Gates were actually met, not just described. If it doesn't, fix the
design, not the auditor.
