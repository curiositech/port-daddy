# Changelog

## 2026-04-20
- Shortened the activation description to clear the repo audit threshold while keeping explicit description-level `NOT for` boundaries.
- Added an inline Mermaid primitive-selection flow so the skill validates as diagram-bearing in strict validation and corpus audit.
- Normalized `metadata.tags`, `metadata.provenance.owners`, and `metadata.authorship.maintainers` to canonical YAML lists.

## 2026-04-19
- Normalized the in-body `NOT for` section heading after coordinator validation.
- Rewrote `SKILL.md` around the actual primitive-selection problem: skill vs subagent vs MCP.
- Added explicit `When NOT to Use`, decision points, failure modes, worked examples, and quality gates.
- Tightened the allowed-tool surface to scoped local scaffolding and validation commands plus inspection tools actually named in-body.
- Strengthened first-party provenance and authorship metadata while preserving recovery lineage.
- Replaced the generic Mermaid file with a primitive-selection flowchart.

## [2.0.0] - 2024-01-XX

### Changed
- **BREAKING**: Restructured from monolithic 602-line file to progressive disclosure architecture
- Fixed frontmatter format: `tools:` → `allowed-tools:` (comma-separated)
- Added NOT clause to description for precise activation boundaries
- Reduced SKILL.md from 602 lines to 150 lines (75% reduction)

### Added
- `references/agent-templates.md` - Technical Expert, Creative/Design, Orchestrator templates
- `references/mcp-integration.md` - MCP server template, official packages, creation steps
- `references/creation-process.md` - Rapid prototyping workflow, quality checklist
- Anti-patterns section with "What it looks like / Why wrong / Instead" format
- Quick reference table for agent templates
- 45-minute rapid prototyping workflow

### Removed
- Verbose template descriptions (moved to references)
- Inline MCP server code (moved to references)
- Redundant design philosophy sections

### Migration Guide
Reference files are now in `/references/` directory. Import patterns:
- Agent templates → `references/agent-templates.md`
- MCP server code → `references/mcp-integration.md`
- Creation workflow → `references/creation-process.md`

## 2026-04-19
- Recovered upgraded skill assets from `/Users/erichowens/coding/workgroup-ai/.claude/worktrees/agent-aa6fba4b/skills/agent-creator`
