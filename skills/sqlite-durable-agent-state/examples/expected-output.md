# Example Output: SQLite Durable Agent State

## Scenario

A daemon's storage plan is under review before a release. The legacy default path lives inside a Homebrew Cellar version directory, a snapshot exporter has its own "canonical" default under Application Support, WAL mode is on with no `busy_timeout`, one migration has no verification probe at all, and three writers (daemon, CLI, snapshot exporter) all write concurrently with no serialization strategy. This is the exact shape of the real port-daddy 7-.db incident (ADR-0090/0044).

## Input Plan (excerpt)

```json
{
  "envPin": { "varName": "PORT_DADDY_DB", "required": true },
  "candidatePaths": [
    { "path": "/opt/homebrew/Cellar/port-daddy/3.2.0/var/db.sqlite3", "canonical": true, "kind": "appdata" },
    { "path": "$HOME/Library/Application Support/port-daddy/snapshot.db", "canonical": true, "kind": "appdata" }
  ],
  "journalMode": "wal",
  "busyTimeoutMs": 0,
  "migrations": [
    { "id": "077_add_status_column", "postVerify": { "table": "items", "column": "status" } },
    { "id": "078_add_harbor_id", "postVerify": {} }
  ],
  "writerTopology": {
    "strategy": "none",
    "writers": [
      { "name": "daemon", "mode": "concurrent" },
      { "name": "cli-upsert", "mode": "concurrent" },
      { "name": "snapshot-exporter", "mode": "concurrent" }
    ]
  }
}
```

## Audit Report

```bash
node scripts/db_path_audit.mjs --input port-daddy-db-plan.json
```

```json
{
  "pass": false,
  "summary": {
    "candidatePathCount": 2,
    "canonicalPathCount": 2,
    "migrationCount": 2,
    "verifiedMigrationCount": 1,
    "writerCount": 3,
    "writerStrategy": "none",
    "blockerCount": 4,
    "warningCount": 1
  },
  "findings": [
    { "severity": "blocker", "code": "PATH_FRAGMENTATION", "message": "2 candidate paths are marked canonical. This is the exact shape of the port-daddy 7-.db incident..." },
    { "severity": "blocker", "code": "CELLAR_PATH_STORAGE", "message": "Canonical path \".../Cellar/port-daddy/3.2.0/var/db.sqlite3\" resolves under a Homebrew Cellar path (deleted on brew upgrade/cleanup)." },
    { "severity": "blocker", "code": "WAL_NO_BUSY_TIMEOUT", "message": "journalMode is \"wal\" but busyTimeoutMs is unset or 0..." },
    { "severity": "warning", "code": "MIGRATION_WEAK_VERIFY", "message": "Migration \"078_add_harbor_id\" postVerify names a table but has neither probeSql nor column..." },
    { "severity": "blocker", "code": "CONCURRENT_WRITERS_UNSAFE", "message": "3 writers are declared ... with writerTopology.strategy \"none\". Multiple writers without a single-writer/queue/serialized strategy is how \"upserts vanish across harbors\"..." }
  ],
  "recommendations": [
    "Collapse to exactly one canonical:true path and delete/redirect every other candidate before shipping.",
    "Move the canonical DB under a stable, tool-owned directory such as ~/.<product>/ or an XDG data dir -- never a Cellar/opt/version-manager/node_modules/cache/tmp/worktree path.",
    "Set PRAGMA busy_timeout to at least 2000-5000ms alongside PRAGMA journal_mode=WAL.",
    "Give every migration a postVerify probe (table + probeSql or column) and run it against the live DB after applying -- never trust migration-history \"applied\" rows alone.",
    "Route all writes through one process (the daemon) or a serialized queue; readers may stay concurrent under WAL."
  ]
}
```

## Fixed Plan Result

After collapsing to one env-pinned canonical path (`$HOME/.port-daddy/registry.db`), quarantining the Cellar fossil as non-canonical, setting `busyTimeoutMs: 5000`, adding `probeSql` to both migrations, and moving `writerTopology.strategy` to `single-writer` with the daemon `exclusive` and the CLI/exporter `serialized`:

```json
{
  "pass": true,
  "summary": {
    "candidatePathCount": 2,
    "canonicalPathCount": 1,
    "migrationCount": 2,
    "verifiedMigrationCount": 2,
    "writerCount": 3,
    "writerStrategy": "single-writer",
    "blockerCount": 0,
    "warningCount": 1
  },
  "findings": [
    { "severity": "warning", "code": "CELLAR_PATH_STORAGE", "message": "Candidate path \".../Cellar/port-daddy/3.2.0/var/db.sqlite3\" resolves under a Homebrew Cellar path (deleted on brew upgrade/cleanup)." }
  ],
  "recommendations": [
    "Quarantine (rename, do not delete) the non-canonical fossil path(s) flagged above once their data has been merged into the canonical DB."
  ]
}
```

`pass: true` with one residual warning is expected: the quarantined Cellar fossil is still listed (for the consolidation record) but is no longer canonical, so it downgrades from a blocker to a warning telling the reviewer to finish quarantining it.
