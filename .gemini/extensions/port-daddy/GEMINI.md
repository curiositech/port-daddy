# Port Daddy Gemini Extension

This extension integrates Port Daddy into Gemini CLI, providing direct access
to the Port Daddy daemon for coordination, service discovery, pub/sub,
sessions, claims, locks, and durable notes.

## Skill Catalog

`pd setup` installs a symlinked skill union into this extension's `skills/`
directory, including `port-daddy-agent-skill`. The union is built from the
stable WinDAGs/Homebrew catalog,
`~/coding/workgroup-ai/skills`, Port Daddy's own skill surfaces, the user's
Claude skills, and the shared AGENTS skill mirror. Because user-level entries
are symlinks, updates to the source catalogs are visible to Gemini without
recopying Markdown.

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
