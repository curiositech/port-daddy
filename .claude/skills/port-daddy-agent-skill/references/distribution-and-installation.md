# Distribution And Installation

The skill is a product surface. It must ship where Port Daddy ships.

## Repo Source

- `skills/port-daddy-agent-skill/`

This path is included in the npm package because `package.json` ships
`skills/`, and it is included in the curated public export through
`config/public-repo-export.json`.

## Tool Mirrors

Keep these mirrors in sync when the skill changes:

- `.codex/skills/port-daddy-agent-skill/`
- `.claude/skills/port-daddy-agent-skill/`
- `.agents/skills/port-daddy-agent-skill/`
- `.gemini/extensions/port-daddy/skills/port-daddy-agent-skill/`

The mirrors make the instruction manual available to agents that discover
tool-local skills before package-local skills.

## Plugin Metadata

Update `.claude-plugin/marketplace.json` when adding a shipped skill path.
Update `.claude-plugin/plugin.json` when the plugin catalog needs the skill name
listed for marketplace or installer UI.

## Release Checklist

- Validate the bundle with `scripts/validate_port_daddy_agent_skill.py`.
- Ensure diagrams, schemas, examples, templates, and scripts are referenced.
- Update `CHANGELOG.md`.
- Mirror the repo copy into every tracked tool install.
- Check package/export metadata.
- If website copy changed, verify the route renders and links to the product
  screenshots.
