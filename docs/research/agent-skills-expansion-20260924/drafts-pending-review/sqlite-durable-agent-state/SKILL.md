---
name: sqlite-durable-agent-state
description: >-
  Design durable local SQLite state for multi-agent developer tooling that survives package
  upgrades, concurrent writers, and crashes: canonical env-pinned paths, WAL/busy_timeout
  discipline, idempotent verified migrations, and safe writer topology. Use when a daemon, CLI,
  or agent fleet needs a persistent local DB, when reviewing a schema/path change before it ships,
  or when diagnosing an already-fragmented multi-.db mess. NOT for relational schema/query design
  (use daemon-development for the daemon's broader lifecycle), server-based Postgres/MySQL
  durability, or deciding whether SQLite is the right engine at all.
license: Apache-2.0
allowed-tools: Read,Write,Edit,Bash,Grep,Glob
metadata:
  category: Data & Storage
  tags:
    - sqlite
    - durable-state
    - wal-mode
    - migration-integrity
    - multi-writer-safety
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: port-daddy-internal-dev
      reason: Port Daddy's own 7-.db fragmentation (ADR-0090/0044) is the canonical case this skill prevents and recovers from.
    - skill: daemon-development
      reason: The daemon process is usually the single writer that must enforce serialization and PRAGMA discipline.
    - skill: runtime-verification-for-agents
      reason: Post-migration verification must check live schema state, not migration-history metadata.
  io-contract:
    kind: deliverable
    consumes:
      - kind: db-plan
        format: json
    produces:
      - kind: db-audit-report
        format: json
      - kind: consolidation-plan
        format: markdown
---

# SQLite Durable Agent State

Design local SQLite state for multi-agent daemons and CLIs that survives `brew upgrade`, npm reinstall, concurrent writers, and crashes — and recover when it already hasn't.

## Use This For

- Picking a canonical SQLite path for a daemon/CLI pair, pinned by one env var, before the first line of storage code is written.
- Choosing journal mode (WAL vs DELETE) and `busy_timeout` for a daemon with a CLI, a snapshot exporter, and a web API all touching the same DB.
- Designing idempotent, atomic migrations with a real post-apply verification probe instead of trusting a migration-history "applied" row.
- Reviewing a `pd-fleet.yml`, ADR, or storage design doc before it reintroduces a Cellar-path, per-worktree, or per-tool-default DB regression.
- Diagnosing an already-fragmented multi-`.db` mess where CLI/snapshot/export tooling see different counts for the same entity.

## Do Not Use This For

- General relational schema design, indexing strategy, or query tuning — that's data modeling, not durability engineering.
- Postgres/MySQL server-based durability, where WAL, replication, and connection pooling mean something structurally different.
- Deciding whether SQLite is the right engine versus a client-server DB — this skill assumes SQLite is already the choice for a local, mostly-single-daemon store.

## Durability Design Loop

```mermaid
flowchart TD
  A[Resolve canonical DB path and conflicting config policy] --> B[Choose journal mode for platform and access topology]
  B --> C[Set caller-deadline timeout and explicit busy/stale-snapshot handling]
  C --> D[Design idempotent migration and target-state verification]
  D --> E[Declare writer serialization, checkpoint, and backup plan]
  E --> F[Run static plan audit and inspect its exact version]
  F --> G{Plan findings or unresolved assumptions?}
  G -->|Yes| H[Revise plan or hold change]
  H --> A
  G -->|No| I[Still require local migration, contention, crash, and restore tests]
```

1. Name exactly one canonical path, resolved by every reader and writer through the same env var (e.g. `PORT_DADDY_DB`). No per-tool fallback default — that is how CLI/snapshot/export tooling end up reading three different files.
2. Choose journal mode: `WAL` for a single writer with concurrent readers (the common daemon shape); `DELETE`/`TRUNCATE` only for a genuinely single-connection tool.
3. If using WAL, declare a per-connection busy-handling policy that fits the caller deadline and transaction semantics: a bounded `busy_timeout`, safe caller retry, serialized writes, or a justified combination. WAL permits readers with one writer; it does not serialize application-level multi-step operations. Handle `SQLITE_BUSY` and stale-snapshot cases explicitly.
4. Write migrations as idempotent, transaction-wrapped SQL. If a transaction spans attached databases, consult SQLite’s journal-mode atomicity limits: transactions across attached databases are not atomic as a set in WAL mode. Use one database or a durable intent/reconciliation protocol when cross-file consistency is required.
5. Attach a post-apply verification probe to every migration that queries the actual target table/column, not the migration-history table. A migration-history update alone does not prove target schema/data changed; inspect the tool behavior and query the target.
6. Declare writer topology explicitly: `single-writer`, `queue`, or `serialized`. More than one writer without a serialization/transaction plan can produce contention or application-level lost-update bugs; demonstrate the exact schedule rather than claiming upserts generally disappear.
7. Run `scripts/db_path_audit.mjs` on the assembled plan before shipping. Any blocker finding means don't ship yet.

## Output Contract

`scripts/db_path_audit.mjs` returns:

The bundled auditor's result shape and blocker taxonomy are local tool contracts; inspect its source/schema version before relying on a specific code or promotion meaning. Static plan validation is not a test of SQLite concurrency, migration application, backup restoration, or runtime state. Inspect `scripts/db_path_audit.mjs` and its schema for the exact output fields. Do not infer SQL execution, crash safety, or runtime state from a pass.

Use `scripts/db_path_audit.mjs` to inspect a `db-plan.schema.json`-shaped plan. Read its source/schema and inspect output: a static pass is not evidence that a migration ran, concurrency is safe, backup restores, or the daemon uses that path.

## Anti-Patterns

### Cellar/Version Path As Home

**Novice**: Lets the DB default resolve inside a Homebrew Cellar, an `nvm`/`pyenv` version directory, or `node_modules` because that's where the running binary already lives.
**Expert**: Pins the canonical path to a dotfile-home or app-support directory via a single env var, independent of the installed tool's version — so `brew upgrade`/reinstall never touches it.
**Detection**: The raw candidate path string (not the self-declared `kind` field) matches `/Cellar/`, a version-manager `versions/` segment, `node_modules/`, or a cache/tmp/worktree directory.

### Migration History Is Not Migration

**Novice**: Runs `migration repair --status applied` (or equivalent) after a migration mismatch and treats the green output as proof the schema changed.
**Expert**: Runs the migration SQL directly, then queries the actual target table/column to confirm it exists before trusting the history table's "applied" state.
**Detection**: A migration entry has no `postVerify` probe, or the probe only re-reads the migrations/history table instead of the target schema object.

### WAL Makes Concurrency Free

**Novice**: "We're in WAL mode, so the daemon and three CLIs can all write whenever they want."
**Expert**: Declares caller-deadline-bounded waiting, safe transaction retry, or write serialization as appropriate; WAL permits readers alongside one writer but does not remove contention or make multi-step operations atomic.
**Detection**: writer topology lacks an application-level serialization plan, or the caller’s configured wait/transaction policy does not handle `SQLITE_BUSY` and fresh-snapshot retries.

## References

| File | Load When |
| --- | --- |
| `references/durable-path-and-wal-discipline.md` | Choosing a canonical path, journal mode, timeout, WAL checkpoint, backup, or migration verification. |
| `references/retry-and-migration-recovery.md` | Handling SQLITE_BUSY, stale snapshots, idempotent retries, or mismatched target/history state. |
| `references/fragmented-multidb-recovery.md` | The fragmentation already happened: diagnosing scattered `.db` files and planning a safe consolidation. |
| `examples/expected-output.md` | Need a finished, filled-in audit report and consolidation note for a realistic scenario. |
| `templates/output-template.md` | Need a reusable template for a db-plan review or consolidation writeup. |
| `schemas/db-plan.schema.json` | Need to validate a `--input` plan's shape before running the script. |
| `scripts/db_path_audit.mjs` | Need a static candidate-path and plan-shape review. |
| `agents/openai.yaml` | Need a subagent descriptor for delegated durable-state review. |

<!-- BEGIN BUNDLE INDEX (auto: index_references.py) -->

## Skill Bundle Index

*Every file in this skill, and when to open it. Auto-generated; run `scripts/index_references.py --fix`.*

**root**
- [`CHANGELOG.md`](CHANGELOG.md) — SQLite Durable Agent State — Changelog — - Initial skill creation - Core process defined - Reference files and deterministic db_path_audit.mjs script added
- [`README.md`](README.md) — SQLite Durable Agent State — Procedural guidance and a deterministic auditor for local SQLite state that must survive package upgrades, concurrent writers, and crashes.

**`agents/`**
- [`agents/openai.yaml`](agents/openai.yaml) — openai (data/schema)

**`examples/`**
- [`examples/expected-output.md`](examples/expected-output.md) — Example Output: SQLite Durable Agent State — A daemon's storage plan is under review before a release.
- [`examples/sample-input.json`](examples/sample-input.json) — sample input (data/schema)

**`references/`**
- [`references/durable-path-and-wal-discipline.md`](references/durable-path-and-wal-discipline.md) — Durable Path Selection And Journaling Discipline — Use this when choosing where a daemon's SQLite file lives, which journal mode it runs in, and how migrations get applied and verified.
- [`references/retry-and-migration-recovery.md`](references/retry-and-migration-recovery.md) — Retry and migration recovery — Use this for bounded SQLITE_BUSY handling, stale-snapshot retries, idempotency, or mismatched migration history/target state.
- [`references/fragmented-multidb-recovery.md`](references/fragmented-multidb-recovery.md) — Diagnosing And Consolidating An Already-Fragmented Multi-DB Mess — Use this when the damage is already done: several `.db` files exist, different tools report different counts for "the same" data, and nobody

**`schemas/`**
- [`schemas/db-plan.schema.json`](schemas/db-plan.schema.json) — db plan.schema (data/schema)

**`scripts/`**
- [`scripts/db_path_audit.mjs`](scripts/db_path_audit.mjs)

**`templates/`**
- [`templates/output-template.md`](templates/output-template.md) — SQLite Durable State Review — [db name] — - Env pin: `[ENV_VAR_NAME]` - Canonical path: `[path]` - Non-canonical/fossil paths found: `[path list, or none]` | Setting | Value | Ration

<!-- END BUNDLE INDEX -->


## SQLite behavior and recovery boundary

`busy_timeout` is configured per connection and waits up to the requested bound; it may still return `SQLITE_BUSY`. Select it from the caller deadline and retry contract, not a universal floor. WAL permits concurrent readers with a writer but serializes writers; a stale read transaction that tries to upgrade may need a full transaction restart from fresh state. Keep WAL on a supported same-host filesystem, account for checkpoints, and make backup/copy procedures WAL-aware. Attached-database transactions have a WAL-mode atomicity limitation across the database set. A migration-history row is not target-state truth.

The bundled auditor/schema can evaluate plan shape only. No SQLite stress schedule, backup restore, or migration execution is implied by that static result. Sources: [SQLite WAL](https://www.sqlite.org/wal.html), [transactions](https://www.sqlite.org/lang_transaction.html), [busy timeout](https://www.sqlite.org/c3ref/busy_timeout.html), [backup API](https://www.sqlite.org/backup.html), [WAL-reset fix](https://www.sqlite.org/forum/forumpost/8dc0d0055e).

- [WAL reader/writer schedule and safe retry](diagrams/research-sql01-wal-reader-writer-schedule-and-safe-retry.md)
- [Migration verification and history separation](diagrams/research-sql02-migration-verification-and-history-separation.md)


