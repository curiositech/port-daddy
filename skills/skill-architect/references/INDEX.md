# Reference Index

Load only the file that matches the blocking question. Do not read the entire reference tree by default.

| File | Topic | Lines | When to load |
|---|---|---:|---|
| `references/guide.md` | Concise authoring contract (legacy wrapper copies) | 9 | Use when a legacy wrapper copy of `skill-architect` needs the minimal authoring contract. |
| `references/strategies.md` | Lightest-strategy decision table | 18 | Use when picking the smallest structural change that materially improves execution quality. |
| `references/activation-debugging.md` | Activation failure diagnosis | 189 | Use when a skill undertriggers, overtriggers, or collides with nearby skills. |
| `references/advanced-structure-and-sync.md` | Interface metadata, subagents, schemas, review artifacts, sync | 180 | Use when adding `agents/openai.yaml`, subagent prompts, schemas, visual boards, eval fixtures, HTML reports, or Port Daddy/workgroup sync. |
| `references/antipatterns.md` | Skill anti-pattern catalog | 570 | Use when auditing weak skills or naming failure modes and shibboleths. |
| `references/channels-and-scheduling.md` | Hooks, channels, scheduled-task adjacency | 49 | Use when deciding whether lifecycle automation belongs in metadata or runtime export. |
| `references/claude-code-runtime.md` | Official Claude Code runtime surface | 128 | Use when frontmatter, preprocessing, or lifecycle claims need runtime truth. |
| `references/claude-extension-taxonomy.md` | Skills vs plugins vs MCP vs other primitives | 52 | Use when routing a request to the right extension mechanism. |
| `references/description-guide.md` | Activation description writing | 219 | Use when improving trigger language, exclusions, and discoverability. |
| `references/deterministic-auditor-archetype.md` | Fail-closed scorer skill archetype | 95 | Use when the skill's deliverable is a spec/plan/contract that can be scored against known failure modes. |
| `references/expertise-elicitation.md` | ACTA, CDM, ShadowBox, L3 extraction | 111 | Use when extracting tacit expertise or deepening a skill beyond L1/L2. |
| `references/knowledge-engineering.md` | Encoding domain expertise | 279 | Use when deciding what judgment belongs in `SKILL.md` versus support files. |
| `references/mcp-template.md` | MCP design scaffolding | 271 | Use when a request is drifting into server/plugin territory rather than skill design. |
| `references/plugin-architecture.md` | Plugin and bundle architecture | 320 | Use when a skill interacts with plugin packaging or distribution boundaries. |
| `references/scoring-rubric.md` | Structural-upgrade scoring rubric | 92 | Use when grading skills or prioritizing the next upgrade pass. |
| `references/self-contained-tools.md` | Scripts, templates, examples, assets | 383 | Use when deciding whether support files materially improve determinism or reuse. |
| `references/skill-composition.md` | Skill composition patterns | 146 | Use when combining multiple skills or designing a layered workflow. |
| `references/skill-lifecycle.md` | Draft-to-archive lifecycle | 182 | Use when planning maintenance, deprecation, maturity, or compaction resilience. |
| `references/subagent-design.md` | Fork semantics and subagent preload rules | 103 | Use when the skill should recommend `context: fork`, preload, or isolation. |
| `references/subagent-template.md` | Subagent prompt structure | 450 | Use when designing specialist subagents or skillful agent prompts. |
| `references/visual-artifacts.md` | Mermaid and review-surface doctrine | 86 | Use when deciding Mermaid type, visual artifact need, or browser-open review value. |
