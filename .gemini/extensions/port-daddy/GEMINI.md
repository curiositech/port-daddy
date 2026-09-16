# Port Daddy Gemini Extension

This extension integrates Port Daddy into Gemini CLI, providing direct access
to the Port Daddy daemon for coordination, service discovery, pub/sub,
sessions, claims, locks, and durable notes.

## Skill Catalog

`pd setup` installs a symlinked skill union into this extension's `skills/`
directory, including `port-daddy-agent-skill`. The union is built from the
Port Daddy first-party catalog, explicitly configured
`PORT_DADDY_SKILL_SOURCE_ROOTS`, and the user's Claude and shared AGENTS skill
libraries. Because user-level entries are symlinks, updates to those declared
source catalogs are visible to Gemini without recopying Markdown.

Use `pd jury-rig query "<task>"` for native hybrid skill discovery and
`pd jury-rig reference <skill-id> <path>` for guarded reference reads. Catalog
selection never authorizes a third-party skill's scripts, hooks, MCP servers,
subagents, or planning pipeline to execute. Planning remains under Port Daddy's
session plan; Seamanship is the future native planning module, not a currently
shipped Gemini command.

## MCP

The bundled `gemini-extension.json` and `mcp.json` register the Port Daddy MCP
server:

```json
{
  "mcpServers": {
    "port-daddy": {
      "command": "pd",
      "args": ["mcp"]
    }
  }
}
```

Ensure the Port Daddy daemon is running locally (`pd start`) before using the
MCP tools.
