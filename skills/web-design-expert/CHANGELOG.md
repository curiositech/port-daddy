# Changelog

All notable changes to the web-design-expert skill will be documented in this file.

## [2.1.0] - 2026-07-03

### Added
- `metadata.provenance`, `metadata.pairs-with` (structured, existence-verified),
  and `metadata.io-contract` in frontmatter, bringing the skill to the
  port-daddy agentic-family governance standard.
- Deterministic auditor `scripts/design_audit.mjs` exporting `auditWebDesign(plan)`,
  scoring a JSON design plan against this skill's Quality Gates and its five
  named failure modes (design-by-committee, decoration-over-function,
  mobile-afterthought, low-contrast, IA collapse).
- `schemas/design-plan.schema.json` (draft-07) and `examples/sample-input.json`
  (verified `pass: true`).
- `examples/expected-output.md` with a passing and a failing audit run.
- `README.md`, `templates/output-template.md`, `agents/openai.yaml`.
- `## References` table in `SKILL.md` linking every bundle file.

### Changed
- `pairs-with` moved from top-level prose into `metadata.pairs-with`
  structured entries. `typography-expert` was dropped (no skill directory in
  this repo; it remains named in the NOT-FOR boundaries prose). Added
  `agentic-coding-ux-designer`, `ideal-web-app-builder`,
  `color-theory-palette-harmony-expert`, and `ux-friction-analyzer` — the last
  two imported in the same batch and verified present in-repo.
- `category` moved under `metadata.category` and set to `Frontend & UI` to
  match this repo's category taxonomy.

## [2.0.0] - 2025-11-29

### Changed
- **SKILL.md restructured** for progressive disclosure (461 → ~140 lines)
- Design process streamlined into quick reference format

### Added
- `references/layout-systems.md` - Grid decision tree, spacing scale (8px base), breakpoints, mobile-first checklist
- `references/color-accessibility.md` - Minimum viable palette, color psychology, dark mode guidelines, WCAG checklist
- `references/tooling-integration.md` - 21st.dev MCP tools, Figma MCP integration, design-to-code workflow
- Common anti-patterns with fixes (decoration over function, ignoring the fold, etc.)
- Design trend evolution table (2019-2024+)

### Migration
- No changes to frontmatter or activation triggers
- MCP tool documentation now in dedicated reference file
- Main SKILL.md serves as design decision index

## [1.2.0] - 2025-11-26

### Added
- Figma Integration section with available MCPs table
- Design-to-code workflow using Figma MCP
- Anti-pattern: Manual Color Copying

### Changed
- Enhanced MCP integration documentation

## [1.1.0] - 2025-11-26

### Added
- Complete "When to Use This Skill" section with ✅/❌ checklists
- "When NOT to Use" with redirects to appropriate skills
- 21st.dev & Component Tooling section with MCP tools:
  - mcp__magic__21st_magic_component_builder
  - mcp__magic__21st_magic_component_inspiration
  - mcp__magic__21st_magic_component_refiner
  - mcp__magic__logo_search
- 6 common anti-patterns:
  - Design by Committee
  - Decoration Over Function
  - Ignoring the Fold
  - Low Contrast Text
  - Mobile as Afterthought
  - Stock Photo Overload
- Discovery phase with business context questions
- Visual direction development framework
- Design Principles checklists (Hierarchy, Consistency)
- Layout Systems with grid decision tree
- Spacing scale (8px base system)
- Color palette construction guide
- Color psychology quick reference table
- Dark mode considerations
- Responsive design strategy with breakpoints
- Mobile-first checklist
- Accessibility (WCAG 2.1 AA) checklist
- Design trend evolution (2015-Present)
- Brand styles reference (Brutalist, Neumorphic, Glassmorphic, Minimalist, Editorial)
- Output deliverables template
- Integration with other skills section

### Changed
- Expanded from 152 lines to 461 lines (3x growth)
- Added NOT clause to description for precise activation
- Enhanced description with activation keywords
- Added MCP tools to allowed-tools

## [1.0.0] - 2024-12-01

### Added
- Initial skill creation
- Basic web design guidance
