# Distribution And Installation

The skill is a product surface. It must ship where Port Daddy ships.

## Repo Source

- `skills/port-daddy-agent-skill/`

The signed release stages this path through `release-artifacts.json`, and the
Homebrew/GitHub binary installation exposes it through `pd setup`. It is also
included in the curated public export through `config/public-repo-export.json`.

## Tool Mirrors

Keep these mirrors in sync when the skill changes:

- `.codex/skills/port-daddy-agent-skill/`
- `.claude/skills/port-daddy-agent-skill/`
- `.agents/skills/port-daddy-agent-skill/`
- `.gemini/extensions/port-daddy/skills/port-daddy-agent-skill/`

The mirrors make the instruction manual available to agents that discover
tool-local skills before package-local skills.

## Cross-Tool Skill Union

`pd setup` also installs a user-level symlink union for the whole local skill
catalog, not only this Port Daddy skill. The source priority is:

1. `PORT_DADDY_SKILL_SOURCE_ROOTS`, when set.
2. `WINDAGS_HOME/skills` or `/opt/homebrew/opt/windags/libexec/skills`.
3. `~/coding/workgroup-ai/skills`.
4. Port Daddy's checked-in `skills/` and project Claude mirror.
5. `~/coding/some_claude_skills/.claude/skills`.
6. `~/.claude/skills`.
7. `~/.agents/skills`.

Port Daddy first-party skill ids (`port-daddy*`) are kept from a real
`port-daddy/skills` source even when a workgroup mirror appears earlier in the
catalog. If `PORT_DADDY_SKILL_SOURCE_ROOTS` intentionally omits a Port Daddy
checkout, its explicit roots define the catalog.

The union links each discovered `SKILL.md` bundle into user-level runtime
registries for Codex, Claude, Gemini, AGENTS-aware tools, Cursor, Continue,
Windsurf, Cline, Roo, OpenCode, Trae, Qoder, CodeBuddy, Agent, and Kiro. This
keeps Codex and Gemini aligned with the skills Claude sees while still letting
Homebrew or workgroup skill updates flow through by following symlinks.

Use `pd setup --status` to audit the source and target set without writing
links. Use `pd setup --dry-run --no-daemon --no-mcp --no-fleetbar --no-init`
to preview the link changes only.

## Plugin Metadata

Update `.claude-plugin/marketplace.json` when adding a shipped skill path.
Update `.claude-plugin/plugin.json` when the plugin catalog needs the skill name
listed for marketplace or installer UI.

## Release Checklist

- Validate the bundle with `scripts/validate_port_daddy_agent_skill.py`.
- Ensure diagrams, schemas, examples, templates, and scripts are referenced.
- Update `CHANGELOG.md`.
- Mirror the repo copy into every tracked tool install.
- Check release-manifest and public-export metadata.
- If website copy changed, verify the route renders and links to the product
  screenshots.
