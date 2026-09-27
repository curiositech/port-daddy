# Example Output: SQLite Durable Agent State

## Scenario

A daemon's storage plan is under review before a release. The legacy default path lives inside a Homebrew Cellar version directory, a snapshot exporter has its own "canonical" default under Application Support, WAL mode is on with no `busy_timeout`, one migration has no verification probe at all, and three writers (daemon, CLI, snapshot exporter) all write concurrently with no serialization strategy. This is an illustrative pattern drawn from the Port Daddy 7-.db incident (ADR-0090/0044).

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
    "blockerCount": 3,
    "warningCount": 2
  },
  "findings": [
    {
      "severity": "blocker",
      "code": "PATH_FRAGMENTATION",
      "message": "2 candidate paths are marked canonical. This is the exact shape of the port-daddy 7-.db incident: CLI, snapshot, and export tooling each resolved a different \"canonical\" path and silently diverged (7 vs 48 vs 89 items).",
      "detail": {
        "canonicalPaths": [
          "/opt/homebrew/Cellar/port-daddy/3.2.0/var/db.sqlite3",
          "$HOME/Library/Application Support/port-daddy/snapshot.db"
        ]
      }
    },
    {
      "severity": "blocker",
      "code": "CELLAR_PATH_STORAGE",
      "message": "Canonical path \"/opt/homebrew/Cellar/port-daddy/3.2.0/var/db.sqlite3\" resolves under a Homebrew Cellar path (deleted on brew upgrade/cleanup).",
      "detail": {
        "path": "/opt/homebrew/Cellar/port-daddy/3.2.0/var/db.sqlite3",
        "declaredKind": "appdata"
      }
    },
    {
      "severity": "warning",
      "code": "WAL_BUSY_POLICY_UNDECLARED",
      "message": "WAL may return SQLITE_BUSY under writer contention. Declare a caller-deadline-bounded busy timeout or an explicit safe retry/serialization policy.",
      "detail": {
        "busyTimeoutMs": 0,
        "busyHandlingPolicy": "unspecified"
      }
    },
    {
      "severity": "warning",
      "code": "MIGRATION_WEAK_VERIFY",
      "message": "Migration \"078_add_harbor_id\" postVerify names a table but has neither probeSql nor column, so the probe cannot distinguish \"table exists\" from \"table has the expected shape\".",
      "detail": {
        "migrationId": "078_add_harbor_id",
        "postVerify": {}
      }
    },
    {
      "severity": "blocker",
      "code": "CONCURRENT_WRITERS_UNSAFE",
      "message": "3 writers are declared (daemon, cli-upsert, snapshot-exporter) with writerTopology.strategy \"none\". Multiple writers without a single-writer/queue/serialized strategy is how \"upserts vanish across harbors\": two writers race a non-atomic read-modify-write and the loser's write is silently lost.",
      "detail": {
        "writers": [
          {
            "name": "daemon",
            "mode": "concurrent"
          },
          {
            "name": "cli-upsert",
            "mode": "concurrent"
          },
          {
            "name": "snapshot-exporter",
            "mode": "concurrent"
          }
        ],
        "strategy": "none"
      }
    }
  ],
  "recommendations": [
    "Collapse to exactly one canonical:true path and delete/redirect every other candidate before shipping.",
    "Move the canonical DB under a stable, tool-owned directory such as ~/.<product>/ or an XDG data dir -- never a Cellar/opt/version-manager/node_modules/cache/tmp/worktree path.",
    "Declare a caller-deadline-bounded busy timeout or an explicit safe retry/serialization policy for SQLITE_BUSY.",
    "Give every migration a postVerify probe (table + probeSql or column) and run it against the live DB after applying -- never trust migration-history \"applied\" rows alone.",
    "Route all writes through one process (the daemon) or a serialized queue; readers may stay concurrent under WAL."
  ]
}
```

This plan intentionally declares no busy-handling policy. The audit reports that as a warning, since WAL can still return `SQLITE_BUSY` under writer contention; a caller-deadline-bounded timeout, safe caller retry, or serialized writer policy are alternatives to evaluate against the transaction and deadline contract.

## Fixed Plan Result

After collapsing to one env-pinned canonical path (`$HOME/.port-daddy/registry.db`), marking the Cellar path as non-canonical for quarantine tracking, declaring `busyHandlingPolicy: "serialized_writer"`, adding `probeSql` to both migrations, and moving `writerTopology.strategy` to `single-writer` with the daemon `exclusive` and the CLI/exporter `serialized`:

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
    "warningCount": 0
  },
  "findings": [],
  "recommendations": [
    "Plan shape looks consistent: single canonical env-pinned path, declared busy handling, verified migrations, and a serialized writer topology."
  ]
}
```

The sample has no residual warning because its serialization policy is declared and every migration has a shape-specific verification probe. The Cellar path remains visible as a non-canonical candidate; in a real migration, verify and quarantine any legacy copy only after reconciling its data.
