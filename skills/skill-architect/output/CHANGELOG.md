# Changelog: skill-architect

## v2.4.0 (2026-03-16)

### SKILL.md Further Compression (407 -> 381 lines)

**Platform Constraints section removed**: 16-line table was load-bearing duplication of content in `references/claude-extension-taxonomy.md`. Compressed to a 2-line inline note with pointer to the reference file.

**Common Rejection Causes table removed**: 15-line table duplicated what `validate_skill.py` catches automatically. Replaced with a 2-line compact "common mistakes" note in the Frontmatter Rules section, consolidating the most actionable gotchas.

**Description formula table trimmed**: Reduced from 5 bad/good examples to 3 (the full 7-example guide remains in `references/description-guide.md`).

### EVALUATION.md (Honest Scoring)

**Per-criterion before/after scoring**: Written with honest corrections to iter-2's inflated self-scores. Iter-2 self-reported 8.8/10 using a 6-dimension rubric; corrected to 7.4/10 using the 7-dimension meta-skill rubric with accurate scoring for Progressive Disclosure (6, not 8), Self-Containment (7, not 9), Visual Artifacts (7, not 9), and the new Self-Consistency dimension (5).

### Scoring Rubric Example Updated

**`references/scoring-rubric.md`**: Updated the skill-architect worked example to reflect the iter-3 scores (8.9/10 composite).

---

## v2.3.0 (2026-03-16)

### Self-Consistency Fixes (Meta-Skill Integrity)

**Invented frontmatter keys removed**: `dependencies`, `bundled-resources`, and `distribution` were listed as valid optional frontmatter keys in SKILL.md and `references/claude-extension-taxonomy.md`, but are NOT recognized by the Claude Code runtime. This directly contradicted the skill's own "Invalid Keys" section. Removed from all locations. The `validate_skill.py` script's `VALID_FRONTMATTER_KEYS` set was updated accordingly.

**HTML entities eradicated across all files**: Iter-2 claimed to have fixed "all" HTML entities but left 31+ instances across reference files. The most damaging were `--&gt;` inside Mermaid diagram examples in `references/visual-artifacts.md` (which breaks rendering), plus `&gt;` and `&lt;` in `references/subagent-design.md`, `references/skill-lifecycle.md`, `references/subagent-template.md`, and `references/self-contained-tools.md`. All replaced with plain `-->`, `>`, `<`.

**EVALUATION.md phantom reference problem solved**: `check_self_contained.py` was FAILING on iter-2 output because EVALUATION.md quoted file paths from the skill being evaluated (e.g., `scripts/analyze.py`, `references/X.md`), which the checker treated as live references. Added `META_DOCUMENT_NAMES` exclusion set to skip EVALUATION.md and CHANGELOG.md during self-containment checks, with tracking of skipped files in the report.

### Scoring Rubric

**7th dimension added for meta-skills**: `references/scoring-rubric.md` now includes **Self-Consistency (0-10)** as a 7th scoring dimension, applicable only to meta-skills. Composite formula updated: domain skills use /6, meta-skills use /7. Added worked example showing skill-architect's own score.

### SKILL.md Improvements

**Line count reduced**: From 467 to ~407 lines (compressed description formula, tightened When to Use section, removed emoji markers).

**Self-consistency checklist item added**: "Skill passes its own validation tools (meta-consistency)" now appears in the Validation Checklist.

### Validation Script Improvements

**`validate_skill.py`**: Removed `dependencies`, `bundled-resources`, `distribution` from `VALID_FRONTMATTER_KEYS`. Replaced emoji symbols in report output with plain text markers.

**`check_self_contained.py`**: Added `META_DOCUMENT_NAMES` set to skip EVALUATION.md and CHANGELOG.md. Added `files_skipped` field to report. Updated both human-readable and JSON output to show skipped files.

### Reference File Cleanup

**`references/self-contained-tools.md`**: Removed duplicate closing "Goal:" sentence.

**`references/claude-extension-taxonomy.md`**: Removed invented frontmatter keys (`dependencies`, `bundled-resources`, `distribution`) from the Skills section table.

---

## v2.2.0 (2026-03-10)

### Validation Fixes

**SKILL.md line count**: Reduced from 504 lines to 467 by compressing the Visual Artifacts Mermaid table from 23 types to the 8 most relevant (full catalog remains in `references/visual-artifacts.md`) and removing script entries from the Reference Files table (scripts are not references).

**HTML entities**: Replaced all `&lt;` with `<` and `&gt;` with `>` throughout SKILL.md and references -- entities were rendering incorrectly in some viewers.

**Phantom references resolved**: `check_self_contained.py` was generating false positives on illustrative example paths in prose. Fixed via two approaches:
1. Removed backtick-quoted paths from illustrative anti-pattern prose in `references/self-contained-tools.md`, `references/knowledge-engineering.md`, `references/subagent-design.md`, and `references/claude-extension-taxonomy.md`
2. Added `ILLUSTRATIVE_MARKERS` detection to `scripts/check_self_contained.py` to skip lines containing "e.g.," "for example," "What it looks like," etc.

Both validators now pass: `validate_skill.py` 0 errors, `check_self_contained.py` 0 phantoms.

### New Reference File

**`references/activation-debugging.md`**: Comprehensive guide for diagnosing skill activation failures. Covers undertrigger and overtrigger failure modes, systematic debugging steps with a Mermaid decision flowchart, activation test matrix template, temporal keyword decay, frontmatter-level rejection causes, and recall limit guidance. Closes the gap between "skill doesn't activate" and "what to do about it."

### Mermaid Diagrams

**`references/skill-lifecycle.md`**: Replaced ASCII art state diagram with a proper `stateDiagram-v2` Mermaid diagram encoding the Draft -> Active -> Mature -> Deprecated -> Archived lifecycle.

**`references/skill-composition.md`**: Replaced all ASCII art dependency diagrams with proper Mermaid flowcharts -- Sequential (flowchart LR with labeled edge), Parallel (fan-out/fan-in flowchart), Hierarchical (graph TD tree), Circular anti-pattern (flowchart with red styling), and full example pipeline.

### Scoring Rubric

**`references/scoring-rubric.md`**: Added 6th scoring dimension -- **Visual Artifacts (0-10)** -- measuring whether complex processes are encoded in Mermaid diagrams rather than prose. Updated composite formula to divide by 6. Fixed HTML entities in score criteria. Updated example evaluation with Visual Artifacts score.

---

## v2.1.1 (2026-02-05)

### Clarifications

**Agent parseability** -- Clarified that Mermaid works for both agents AND humans. Agents read Mermaid as a text-based graph DSL with explicit edge semantics (`A -->|Yes| B`); they don't need rendered pictures. Added "Can Agents Actually Interpret Mermaid?" section to `references/visual-artifacts.md` explaining why formal graph notation is actually more precise for agents than equivalent prose.

**YAML frontmatter is optional** -- Demoted YAML frontmatter from "here's how to configure" to "this is purely for rendering customization; agents ignore it; skip it unless publishing polished docs." Updated both SKILL.md and `references/visual-artifacts.md`.

**Raw vs. quoted Mermaid** -- Added guidance: use raw ` ```mermaid ` blocks in SKILL.md (operative content the agent interprets). Only use outer ` ````markdown ` fences in docs *about* Mermaid (illustrative examples). Added SKILL.md's own 6-step process as a raw Mermaid flowchart -- eating our own cooking.

---

## v2.1.0 (2026-02-05)

### Visual Artifacts

**New section in SKILL.md**: "Visual Artifacts: Mermaid Diagrams & Code" -- encourages skills to render decision trees, workflows, architectures, timelines, and data models as Mermaid diagrams. Includes quick-reference table mapping content types to diagram types.

**New reference**: `references/visual-artifacts.md` -- comprehensive guide to all 16+ Mermaid diagram types with:
- "Can Agents Interpret Mermaid?" section (yes -- it's a text DSL with explicit graph structure)
- Raw vs. quoted Mermaid guidance
- Full YAML frontmatter configuration (optional -- for rendering only)
- Concrete examples for every diagram type: flowchart, sequence, state, ER, gantt, mindmap, timeline, pie, quadrant, gitgraph, class, user journey, sankey, XY chart, block, architecture, kanban
- Node shapes, edge styles, and features for each diagram type
- Decision matrix: which diagram type for which skill content
- Best practices for Mermaid in progressive-disclosure skills

**Anti-pattern #10**: "Prose-Only Processes" -- if a skill describes a decision tree or workflow in paragraph form when it could be a Mermaid diagram, that's an improvement opportunity.

**Updated validation checklist**: Now includes "Decision trees/workflows use Mermaid diagrams, not prose."

**Updated Step 4**: Skill creation now explicitly calls out visual artifacts and Mermaid as part of the writing process.

---

## v2.0.0 (2026-02-05)

### Major Improvements

**SKILL.md rewrite** -- Reduced from 637 lines to 350 lines (was violating its own <500 line rule). Restructured for clarity and actionability.

**Description Formula** -- Expanded with concrete bad->good examples covering 7 common failure modes: too vague, overlapping, mini-manual, missing exclusions, wrong keywords, name mismatch, catch-all. Full guide moved to `references/description-guide.md`.

**Frontmatter Documentation** -- Added newly documented optional fields: `argument-hint`, `disable-model-invocation`, `user-invocable`, `context` (fork), and `metadata`. Previous version was incomplete about what's valid.

**Subagent-Aware Skill Design** -- New section covering how to design skills that subagents consume effectively: three loading layers (preloaded, dynamic, execution-time), subagent prompt structure (identity, skill rules, task loop, constraints), and orchestrator patterns (single-specialist, chain, parallel).

**Progressive Disclosure** -- Enhanced with specific lazy-loading rules: reference files are NOT auto-loaded, teach agents to load on-demand per-step, never instruct "read all files first."

**Anti-Pattern #9** -- Added "Eager Loading" to the anti-pattern catalog.

### New Reference Files

- `references/description-guide.md` -- Comprehensive guide to writing skill descriptions with bad->good examples, keyword strategy, length guidelines, and testing checklist
- `references/subagent-design.md` -- Full guide to designing skills for subagent consumption, including three loading layers, subagent prompt structure, orchestrator patterns, input/output contracts, and lazy-loading best practices

### Updated Reference Files

- `references/subagent-template.md` -- Added four-section prompt structure (Identity, Skill Usage Rules, Task-Handling Loop, Constraints), YAML config with skill references, and skill-aware example patterns

### Removed (Deduplicated)

- Case studies removed from SKILL.md (were already duplicated in `references/antipatterns.md`)
- Verbose code examples moved to reference files where they belong
- Redundant script example removed (already in `references/self-contained-tools.md`)

### Philosophy Update

From "progressive disclosure machines" to "progressive disclosure machines with lazy-loaded references" -- emphasizing that reference files are only loaded when the agent decides they're relevant to the current step, not eagerly.

---

## v1.0.0 (2026-01-14)

### Created
- **Unified meta-skill** combining skill-coach and skill-creator
- Merged systematic workflow from skill-creator
- Merged domain expertise encoding from skill-coach
- Consolidated best practices from both skills

### Features
- 6-step skill creation process
- Shibboleth encoding (expert knowledge patterns)
- Anti-pattern catalog with case studies
- Self-contained tool implementation (scripts, MCP, subagents)
- Progressive disclosure design principles
- Activation debugging workflows
- Comprehensive validation checklists

### References Added
- `antipatterns.md` - Shibboleths and anti-pattern catalog
- `self-contained-tools.md` - Scripts, MCP, and subagent patterns
- `mcp-template.md` - Minimal MCP server starter
- `subagent-template.md` - Agent definition format

### Philosophy
"Great skills are progressive disclosure machines that encode real domain expertise, not just surface instructions."

### Replaces
- skill-coach (v2.x) - Expertise encoding focus
- skill-creator (v1.x) - Systematic workflow focus

### Migration
Users of skill-coach or skill-creator should switch to skill-architect for the unified experience.
