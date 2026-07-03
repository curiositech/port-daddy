# macOS Launchd Supervision

Author correct launchd plists for long-lived local daemons, and design the external supervision-integrity check that catches what `KeepAlive` cannot self-heal.

Use this skill when writing or reviewing a LaunchAgent/LaunchDaemon plist, debugging a daemon that silently died after a `brew upgrade` or logout, or fixing launchd's minimal-PATH `command not found` failures.

## Quick Start

1. Read `SKILL.md`.
2. Load `references/agent-vs-daemon-and-integrity.md` to decide LaunchAgent vs LaunchDaemon and see the annotated plist example.
3. Load `references/plist-field-reference.md` for exact key semantics and load/unload commands.
4. Describe the intended job as JSON matching `schemas/launchd-plan.schema.json`.
5. Run `node scripts/plist_lint.mjs --input launchd-plan.json`.

Fix every `critical` finding before you ever run `launchctl bootstrap`.
