# Agent Personas

Known-good fleet personas the skill ships. Spawn them via `pd spawn` or schedule them via cron / `pd-fleet.yml`.

| Persona | Role | When to spawn |
|---|---|---|
| [openai.yaml](openai.yaml) | Default OpenAI-backed runner | Multi-purpose; tune the prompt to your task |
| [salvage-watcher.yaml](salvage-watcher.yaml) | Drains the salvage queue | Schedule every 15 min; or one-shot when queue >50 |
| [lookout.yaml](lookout.yaml) | Release-surface drift watcher | Schedule every 2h; or before a release |
| [freshness-prober.yaml](freshness-prober.yaml) | Pre-promotion liveness/parity check | On-demand before stable promotion or main merge |
| [subagent-fork-template.yaml](subagent-fork-template.yaml) | Base for forking sub-agents | Copy + fill `task_specific` block |

## Persona invariants

Every persona ships with:

- A `prologue:` step that runs prologue scripts (or equivalent `pd briefing`).
- `system_prompt:` that explicitly forbids skipping the operating loop.
- `allowed_tools:` constrained to what the persona actually needs.
- `stop_conditions:` so a misbehaving agent terminates cleanly.

When you write a new persona, follow the same shape. See `subagent-fork-template.yaml` for the canonical layout.

## Spawn examples

```bash
# Schedule (declarative — preferred for persistent agents):
# In pd-fleet.yml at the project root:
agents:
  - persona: skills/port-daddy-agent-skill/agents/salvage-watcher.yaml
    schedule: "*/15 * * * *"

# Imperative one-shot:
pd spawn --backend claude-cli \
  --persona skills/port-daddy-agent-skill/agents/freshness-prober.yaml \
  --foreground

# Background, with parent context (for sub-agent forks):
pd spawn --backend claude-cli \
  --persona ./my-task-fork.yaml \
  --parent-session "$(pd whoami | grep Session: | awk '{print $2}')" \
  --background
```

## Why ship personas with the skill

- Personas codify the coordination obligations from `SKILL.md` so spawned agents inherit them.
- They are version-controlled, reviewed, and tested alongside the skill.
- New agent types start from `subagent-fork-template.yaml` and stay aligned with repo conventions.
- `pd-fleet.yml` references these by path, so the same fleet config works in any project that has the skill installed.

## Related

- `decisions/should-i-fork-subagent.md` — when forking is even the right move.
- `subagent-fork/` — the parent agent's obligations when forking.
- `examples/04-fleet-from-zero.md` — bootstrapping a fleet using these personas.
- `references/coordination-theory.md` — actor model that personas align with.
