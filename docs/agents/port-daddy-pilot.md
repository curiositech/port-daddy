# Port Daddy Pilot — the ideal Port Daddy agent

A single operating persona — *coordinate before you cut, leave durable evidence,
keep listening, tell the truth* — rendered into every local LLM runtime's native
agent format and installable as a Claude managed (cloud) agent.

This is the agent analog of the HTTP-agent system prompt: one canonical source,
many transports.

## Canonical source (edit here, only here)

```
agents/port-daddy-pilot/
├── AGENT.md                  # the persona / system prompt (between the BEGIN/END markers)
├── agent.config.json         # single source of truth: model, tools, skills, multiagent roster
└── agent.config.schema.json  # JSON schema for the config
```

Everything else is **generated** from these two files. Never hand-edit a
rendered copy — `pd setup` overwrites it on the next install.

## Install matrix

| Runtime | Rendered to | Format | How it's invoked |
| --- | --- | --- | --- |
| Claude Code / Desktop | `~/.claude/agents/port-daddy-pilot.md` | frontmatter + body | `--agent port-daddy-pilot`, or auto via SessionStart hook |
| Codex CLI | `~/.codex/agents/port-daddy-pilot.toml` | `name`/`description`/`developer_instructions` | Codex agent picker |
| Gemini CLI | `~/.gemini/commands/pd-pilot.toml` | custom command | `/pd-pilot` |
| Antigravity (`agy`) | `~/.gemini/extensions/port-daddy/commands/pd-pilot.toml` | gemini extension command | `agy plugin import gemini` then `/pd-pilot` |
| Generic AGENTS-aware | `~/.agents/agents/port-daddy-pilot.md` | universal markdown | runtime-specific |
| Claude cloud | `config/managed-agents.json` (id + version) | managed agent | session referencing the agent ID |

## Installing

`pd setup` (run automatically on every `brew install/upgrade port-daddy`)
renders and installs all local definitions. `pd mcp install` does the same Pilot
definition refresh when you only want to reconnect agent tools:

```bash
pd setup                 # render + install the Pilot into every local runtime
pd mcp install           # configure MCP + refresh the shared skill and Pilot
pd setup --no-agents     # skip the Pilot (skills/MCP only)
pd mcp install --no-agents  # configure MCP + skill only
bunx tsx scripts/install-pilot-agents.ts --dry-run   # preview, write nothing
```

The Homebrew formula ships the canonical source and the SessionStart hook into
`$(brew --prefix)/share/port-daddy/{agents,hooks}`, so the renderer reads from a
stable path across upgrades.

> **Antigravity note:** `agy plugin import gemini` stages the Port Daddy
> extension (including the `/pd-pilot` command). If the import errors with
> `stat …/skills/<name>: no such file or directory`, that is a pre-existing
> dangling skill symlink in `~/.gemini/extensions/port-daddy/skills` (from skill
> sync), not the Pilot command. Re-run `pd setup` to refresh skill links, then
> re-import.

### Cloud managed agent

```bash
ANTHROPIC_API_KEY=sk-ant-… bunx tsx scripts/create-managed-agent.ts
```

Creates (or, on re-run, version-updates) the Pilot as a Claude managed agent and
records its `id` + `version` in the committed `config/managed-agents.json`.
Without the key it records a `pending` entry — it never fabricates an ID. The
local definitions don't need the cloud agent.

The live agent is `agent_01S8bG1GPXWgReKrNL9meD5V` (version 1), carrying the
agent toolset plus the custom `pd_preflight` / `pd_note` / `pd_status` tools and
the full persona as its system prompt. Reference it when starting a session:
`POST /v1/sessions` with `{"agent_id": "agent_01S8bG1GPXWgReKrNL9meD5V"}`.

> **Skills follow-up:** the cloud `skills` array references Anthropic pre-built
> skills or *workspace-uploaded* custom skills (by `skill_*` id). The Pilot's
> skills (`port-daddy-agent-skill`, `multi-agent-coordination`, `next-move`) are
> local filesystem skills, so they are **omitted** from the cloud agent for now —
> the discipline is already embedded in the system prompt. To attach them, upload
> each as a custom skill, then set `cloudSkills` in `agent.config.json` to the
> returned `{type:"custom", skill_id:"skill_…"}` entries and re-run the script
> (it generates a new agent version).

## SessionStart steering

In a Port Daddy-active project, `pd init` wires a SessionStart hook
(`hooks/sessionstart-pilot.mjs`) into `.claude/settings.json`. On every new
session it injects context steering the agent to operate as the Port Daddy Pilot
for the rest of the session — **unless** a non-default agent was explicitly
selected (`--agent <other>`) or `PD_PILOT_DISABLE=1` is set. The hook is
dependency-free and daemon-independent, so it works on a cold session, and it
preserves any existing SessionStart hooks (e.g. `pd attention`).

## Tools & multi-agent design

See [port-daddy-pilot-multiagent.md](./port-daddy-pilot-multiagent.md) for the
coordinator/implementer/adversarial-reviewer/coordination-keeper topology, the
context-splitting and adversarial-review patterns, and the rationale for the
toolset and permission policy.

## Regenerating after an edit

```bash
# 1. edit agents/port-daddy-pilot/AGENT.md or agent.config.json
# 2. re-render every local runtime
bunx tsx scripts/install-pilot-agents.ts
# 3. (optional) push the change to the cloud agent — generates a new version
ANTHROPIC_API_KEY=sk-ant-… bunx tsx scripts/create-managed-agent.ts
# 4. tests
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/unit/pilot-agent-render.test.ts
```
