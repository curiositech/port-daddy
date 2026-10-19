# SQLite Durable Agent State

Procedural guidance and a deterministic auditor for local SQLite state that must survive package upgrades, concurrent writers, and crashes.

Use this skill when a daemon, CLI, or agent fleet needs a persistent local DB — either designing it fresh, reviewing a path/schema change before it ships, or recovering after a multi-`.db` fragmentation incident.

## Quick Start

1. Read `SKILL.md`.
2. Load `references/durable-path-and-wal-discipline.md` for canonical path selection, journal mode, and migration verification.
3. Load `references/fragmented-multidb-recovery.md` if the fragmentation already happened.
4. Assemble a plan shaped like `schemas/db-plan.schema.json` (canonical path, env pin, journal mode, migrations with `postVerify`, writer topology).
5. Run `node scripts/db_path_audit.mjs --input plan.json`.

Fix every `blocker`-severity finding before shipping the storage change. Warnings are worth reading but don't block.
