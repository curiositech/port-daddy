# Port Daddy Pilot — canonical agent source

The **ideal Port Daddy agent**, defined once and rendered into every LLM
runtime's native format. This directory is the single source of truth.

- `AGENT.md` — the persona / system prompt. The text between the
  `BEGIN/END SYSTEM PROMPT` marker lines is embedded verbatim into every
  runtime. Edit this to change how the agent behaves.
- `agent.config.json` — model, tools (Port Daddy MCP + custom),
  skills, permission policy, and the multi-agent roster.
- `agent.config.schema.json` — JSON schema for the config.

**Do not edit the rendered copies** (`~/.claude/agents/port-daddy-pilot.md`,
`~/.codex/agents/port-daddy-pilot.toml`, `~/.gemini/commands/pd-pilot.toml`,
`~/.agents/agents/port-daddy-pilot.md`). They are generated and overwritten on
the next `pd setup`. Edit here, then re-render:

```bash
npx tsx scripts/install-pilot-agents.ts
```

Full docs: [`docs/agents/port-daddy-pilot.md`](../../docs/agents/port-daddy-pilot.md)
and [`docs/agents/port-daddy-pilot-multiagent.md`](../../docs/agents/port-daddy-pilot-multiagent.md).
