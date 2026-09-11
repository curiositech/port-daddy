# Changelog

All notable changes to the native-app-designer skill will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-07-04

### Added
- **Imported into the port-daddy repo** (`skills/native-app-designer/`) from the Jury-rig global skill store and upgraded to the repo's agentic-family standard.
- Family-standard frontmatter: `license: Apache-2.0`, block-style `metadata.provenance` (first-party/port-daddy), `metadata.pairs-with` (`metal-shader-expert`, `web-design-expert`, `beautiful-gui-design`), `metadata.io-contract` (consumes a native-app design brief + native-ui spec, produces an iOS/macOS design + a native-design audit).
- Deterministic auditor `scripts/native_design_audit.mjs` exporting `auditNativeDesign(spec)` — scores a native-ui-spec against Apple HIG and repo-hard rules: SF Symbols vs emoji icons, 14pt readable-text floor + Dynamic Type, 44pt tap targets, WCAG 4.5:1 contrast, light/dark, safe areas, system materials. Fails closed.
- `schemas/native-ui-spec.schema.json` (draft-07), `examples/sample-input.json` (passing), `examples/failing-input.json` (emoji icons + 11pt caption + no Dynamic Type + sub-44pt targets + low contrast + light-only — failing).
- `README.md`, `agents/openai.yaml`, `templates/output-template.md`, `examples/expected-output.md` to complete the bundle.
- Three new "HIG/repo-rule" anti-patterns in `SKILL.md` (Emoji Icons Instead of SF Symbols, Tiny Fonts / No Dynamic Type, Sub-44pt Tap Targets), each wired to the auditor's finding IDs.
- A `## References` table in `SKILL.md` covering every file in the bundle.

## [2.0.0] - 2025-11-26

### Changed
- **BREAKING**: Refactored from single 787-line file to modular structure
- Reduced SKILL.md from 787 lines to 189 lines (76% reduction)
- Moved detailed code patterns to `/references/` directory
- Updated frontmatter to standard `allowed-tools` format
- Simplified description with proper NOT clause

### Added
- **When to Use This Skill** section with clear scope boundaries
- **Do NOT use for** section with skill alternatives
- **MCP Integrations** section:
  - 21st Century Dev for component inspiration
  - Stability AI for design assets
  - Firecrawl for pattern research
  - Apple Developer Docs MCP (community)
- **Common Anti-Patterns** section (5 patterns):
  - Generic Card Syndrome
  - Linear Animation Death
  - Rainbow Vomit
  - Animation Overload
  - Inconsistent Spacing
- **App Personality Types** table for design direction
- **Spring Physics Cheat Sheet** for quick reference
- Created `/references/swiftui-patterns.md` - Full SwiftUI component examples
- Created `/references/react-patterns.md` - React/Vue animation patterns
- Created `/references/custom-shaders.md` - Metal and WebGL shader effects

### Removed
- Redundant Vue template code (moved to references)
- Extensive SwiftUI examples (moved to references)
- Shader code blocks (moved to references)
- Custom YAML frontmatter format (triggers, integrates_with, official_mcps)

### Improved
- Progressive disclosure: essential concepts in SKILL.md, code in references
- Cross-references to related skills
- Motion design principles condensed to actionable cheat sheet

## [1.0.0] - 2024-XX-XX

### Added
- Initial native-app-designer skill
- SwiftUI design patterns and components
- React/Vue animation patterns with Framer Motion
- Physics-based animation guidelines
- Color psychology for native apps
- Typography with personality
- Custom shader examples (Metal/WebGL)
- Anti-AI aesthetic philosophy
- Design tool recommendations
