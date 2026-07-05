# Beautiful CLI Design

Treat the terminal as a real interface surface: hierarchy, feedback, accessibility, and fallback modes all matter — for branded setup flows, rich command output, terminal dashboards, and actionable errors.

Use this skill when designing or reviewing CLI/TUI output and interaction, choosing between a prompt library and a full TUI framework, or auditing whether a design is safe to ship into pipes, CI logs, and `NO_COLOR` environments.

## Quick Start

1. Read `SKILL.md` for the framework decision flow, the visual system rules, and the six anti-patterns.
2. Skim `references/00-charmbracelet-ecosystem-overview.md` for fast orientation across the Go/JS terminal-UI ecosystem, then load the specific reference that matches your runtime (Ink/React, Bubble Tea/Go, etc.).
3. Fill in `templates/output-template.md` when writing up a CLI/TUI design deliverable.
4. Build a CLI design spec JSON matching `schemas/cli-spec.schema.json` and audit it:

```bash
node scripts/cli_design_audit.mjs --input <your-cli-spec>.json
```

5. Compare against `examples/expected-output.md` to see a bad CLI design audited, then the same design fixed and passing.
