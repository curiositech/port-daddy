# Skill Architect

The authoritative meta-skill for creating, auditing, and improving Agent Skills.

## What It Does

Skill Architect is a meta-skill that teaches Claude how to build other skills well. It combines:
- **Systematic workflow** (6-step creation process)
- **Domain expertise encoding** (shibboleths, anti-patterns, temporal knowledge)
- **Progressive disclosure architecture** (three-layer loading with lazy references)
- **Subagent-aware design** (skills that work well when consumed by subagents)
- **Operating-surface design** (`agents/openai.yaml`, subagent prompts,
  schemas, visual decision boards, eval fixtures, and sync plans)
- **Port Daddy-grounded coordination** (sessions, claims, notes, tuples, and
  workgroup/repo/user-level skill sync)

## Quick Start

**Creating a new skill**:
1. Gather 3-5 concrete example queries (what should/shouldn't trigger)
2. Plan reusable contents (scripts, references, templates, examples, agents,
   schemas, and assets when justified)
3. Initialize with `scripts/init_skill.py` and the skill name
4. Write deterministic support files first, references next, SKILL.md last
5. Validate with `scripts/validate_skill.py`
6. Iterate based on real-world use

**Improving an existing skill**:
1. Tighten description: `[What] [When] [Keywords]. NOT for [Exclusions]`
2. Check line count (<500 lines in SKILL.md)
3. Add anti-patterns with shibboleth template
4. Remove phantom references (files that don't exist)
5. Test activation with 5 should-trigger + 5 shouldn't-trigger queries

## Key Concepts

### Progressive Disclosure (Three Layers)

| Layer | Content | When Loaded |
|-------|---------|-------------|
| 1. Metadata | `name` + `description` | Always (catalog scan) |
| 2. SKILL.md | Core process, decision trees | On skill activation |
| 3. References | Deep dives, examples, specs | On-demand, per-file, lazy |

Reference files are NOT auto-loaded. The agent reads them only when relevant to the current step.

### Description Formula

`[What it does] [When to use] [Trigger keywords]. NOT for [Exclusions].`

The description is the single most important line for activation. See `references/description-guide.md` for 7 bad→good examples.

### Frontmatter Fields

Required: `name`, `description`

Optional: `allowed-tools`, `argument-hint`, `license`, `disable-model-invocation`, `user-invocable`, `context`, `metadata`

### Visual Artifacts

Skills should render processes, decision trees, architectures, and temporal knowledge as **Mermaid diagrams** instead of prose. Mermaid is text-based, version-controllable, and renders natively in GitHub, Docusaurus, and Claude's output.

16+ diagram types are available: flowchart, sequence, state, ER, timeline, mindmap, quadrant, gantt, gitgraph, class, user journey, sankey, XY chart, block, architecture, kanban, pie.

See `references/visual-artifacts.md` for the full catalog with examples and YAML configuration.

### Subagent-Aware Design

Skills consumed by subagents should have:
- Explicit "When to Use / NOT" sections
- Numbered steps (not prose)
- Output contracts (JSON schema or markdown template)
- QA/validation checklists
- Bounded write scopes, no-revert rules, and validation gates
- Port Daddy session/claim/note/tuple expectations when used in this repo

See `references/subagent-design.md` for full patterns.

### Advanced Operating Assets

First-party distributed skills should consider:

- `agents/openai.yaml` for user-facing catalog metadata
- agent prompt files for narrow delegated specialists
- `schemas/` for machine-checkable plans, scorecards, and sync records
- `templates/` for visual decision boards and repeatable handoffs
- `examples/` or `fixtures/` proving validators and activation boundaries
- audit scripts that catch deterministic drift

See `references/advanced-structure-and-sync.md`.

### Workgroup Sync

When a skill exists in workgroup, repo, and user-level locations, treat the
workgroup copy as authoritative. Merge useful local deltas into that source,
validate it, then mirror to repo-local copies and symlink or mirror user-level
registries. In Port Daddy repos, coordinate this with `pd status`, `pd
briefing`, `pd salvage`, a session, file claims, notes, and tuples when another
agent or watcher needs machine-readable sync state.

### Shibboleths

Expert knowledge that separates novices from experts:
- Framework evolution (React: Classes → Hooks → Server Components)
- Model limitations (CLIP can't count objects)
- Tool architecture (Script → MCP graduation path)
- Temporal traps (advice correct in 2023, harmful in 2025)

## Structure

```
skill-architect/
├── SKILL.md                          # Core instructions (<500 lines)
├── CHANGELOG.md                      # Version history
├── README.md                         # This file
├── agents/
│   ├── openai.yaml                   # User-facing skill UI metadata
│   ├── affordance-planner.md         # Support-asset planning agent
│   ├── sync-coordinator.md           # Workgroup/repo/user-level sync agent
│   └── cross-evaluator.md            # Cross-evaluation agent
├── schemas/
│   └── skill-sync-plan.schema.json   # Machine-checkable sync plan
├── templates/
│   ├── skill-scorecard.json          # Scorecard skeleton
│   ├── skill-sync-plan.md            # Sync plan template
│   └── visual-decision-board.md      # Human review board
├── scripts/
│   ├── audit_skill_operating_system.py # Advanced affordance audit
│   ├── validate_mermaid.py           # Mermaid syntax validator (structural, no renderer needed)
│   ├── validate_skill.py             # Comprehensive skill directory validator
│   ├── check_self_contained.py       # Phantom reference and orphan file detector
│   └── init_skill.py                 # Skill scaffolder (creates directory + templates)
└── references/
    ├── antipatterns.md               # Shibboleths and case studies
    ├── advanced-structure-and-sync.md # Interface/subagent/schema/sync doctrine
    ├── claude-extension-taxonomy.md  # Skills vs Plugins vs MCPs vs Hooks (7-type taxonomy)
    ├── description-guide.md          # How to write effective descriptions
    ├── knowledge-engineering.md      # KE methods for extracting expert knowledge
    ├── mcp-template.md               # Minimal MCP server starter
    ├── plugin-architecture.md        # Plugin creation and distribution
    ├── scoring-rubric.md             # Quantitative skill evaluation (0-10 scoring)
    ├── self-contained-tools.md       # Scripts, MCP, subagent patterns
    ├── skill-composition.md          # Cross-skill dependencies and composition
    ├── skill-lifecycle.md            # Maintenance, versioning, deprecation
    ├── subagent-design.md            # Designing skills for subagent consumption
    ├── subagent-template.md          # Agent definition format
    └── visual-artifacts.md           # Mermaid diagram catalog & configuration
```

## Anti-Patterns (Summary)

| # | Anti-Pattern | Fix |
|---|-------------|-----|
| 1 | Documentation Dump | Decision trees in SKILL.md, depth in references |
| 2 | Missing NOT clause | Always include exclusions in description |
| 3 | Phantom Tools | Only reference files that exist and work |
| 4 | Template Soup | Ship working code or nothing |
| 5 | Overly Permissive Tools | Least privilege, scoped Bash |
| 6 | Stale Temporal Knowledge | Date all advice, update quarterly |
| 7 | Catch-All Skill | Split by expertise type |
| 8 | Vague Description | Use the description formula |
| 9 | Eager Loading | Lazy-load references, never "read all first" |
| 10 | Prose-Only Processes | Use Mermaid for decision trees, workflows, architectures |

## Success Metrics

| Metric | Target |
|--------|--------|
| Correct activation | >90% |
| False positive rate | <5% |
| Token usage | <5k |
| Time to productive | <5 min |

## Version History

- **v2.4.0** (2026-04-24) — Workgroup-authoritative sync doctrine, Port Daddy coordination, `agents/openai.yaml`, subagent prompt assets, visual decision/sync templates, sync schema, and advanced operating-surface audit script
- **v2.3.1** (2026-04-18) — Metadata/authorship doctrine, reference index, scorecard/authorship updates, and Mermaid companion artifacts
- **v2.3.0** (2026-03-10) — HTML entity fixes across all files; EVALUATION.md phantom suppression; enhanced validators (HTML entity + ILLUSTRATIVE_MARKERS coverage)
- **v2.2.0** (2026-03-10) — Validation fixes (504→467 lines, phantom fixes, ILLUSTRATIVE_MARKERS); activation-debugging.md added; Visual Artifacts 6th rubric dimension; Mermaid in lifecycle/composition
- **v2.1.0** (2026-02-05) — Visual artifacts: Mermaid diagram guide, 16+ diagram types, YAML config, anti-pattern #10
- **v2.0.0** (2026-02-05) — Major rewrite: description guide, subagent design, frontmatter fields, lazy loading, trimmed to 350 lines
- **v1.0.0** (2026-01-14) — Initial unified meta-skill combining skill-coach + skill-creator

## Replaces

This skill unifies and replaces:
- **skill-coach** — Expertise encoding
- **skill-creator** — Systematic workflow
