# Harbor build agents — DAG branch → specialist

Authored with `skillful-subagent-creator` (4-section prompts) + `skillful-node-prompt`
(hypertree branches). Each maps to one chain of `docs/HARBOR-CONSOLE-DAG.md`.

| Agent | DAG branch | Preloaded skills | Standing kit (always) |
|-------|-----------|------------------|----------------------|
| `harbor-loop-ui` | Operator Loop UI (A*) | beautiful-gui-design · frontend-design · rust-gpui-motion · rust-with-claude-code | windags graft · port-daddy |
| `harbor-editor` | Harbor Editor (B*, capstone) | build-coop-ide-gpui · rust-with-claude-code · agent-conversation-protocols | windags graft · port-daddy |
| `harbor-viz` | Ambient Viz (C*) | gpui-shaders · vello-parley-rendering · metal-text-pipeline · rust-gpui-motion | windags graft · port-daddy |
| `harbor-fleetbar` | FleetBar (D*) | ios-engineer · beautiful-gui-design | windags graft · port-daddy |
| `harbor-coordination` | Coordination/backend (E*) | backend-authoritative-runtime-refactor · runtime-verification-for-agents · nygard-2018-release-it | windags graft · port-daddy |

## Standing kit (baked into every agent)
- **windags skill graft** — `mcp__windags__windags_skill_graft` (count≈2): graft expert
  knowledge on demand for anything the preloaded skills don't cover. Graft, don't guess.
- **port-daddy coordination** — `mcp__port-daddy__*` + `pd` CLI: begin → scope note →
  claim smallest surface → re-read live sessions → `pd guard check --staged` → `pd note` result.
- Tools: `tools` frontmatter omitted ⇒ agents inherit ALL tools, so the windags + port-daddy
  MCP servers and the Skill tool are always reachable.

## Orchestration
Fan-out across branches (independent), nested-sequential inside `harbor-editor` (coupled
P-phases). Each returns the JSON output contract so the orchestrator can chain waves.
De-conflict via port-daddy before editing shared files (notably `app.rs`, co-owned with
session 2579bfb0; and `lib/`/`routes/`, contended by many sessions).
