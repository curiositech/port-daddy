# Durable Path Selection And Journaling Discipline

Use this when choosing where a daemon's SQLite file lives, which journal mode it runs in, and how migrations get applied and verified.

## Path Selection Ladder

Pick the highest tier your platform supports; never fall to a lower tier "just for now."

| Tier | Example | Survives brew/npm upgrade | Survives OS reboot | Survives version manager switch | Notes |
| --- | --- | --- | --- | --- | --- |
| 1. XDG/dotfile home dir, env-pinned | `~/.port-daddy/registry.db` resolved from `$PORT_DADDY_DB` | Yes | Yes | Yes | Preferred. Create the parent dir at first run, `chmod 700`. |
| 2. Platform app-support dir | `~/Library/Application Support/<app>/db.sqlite3` (macOS) | Yes | Yes | Yes | Fine, but still pin the resolved path through one env var so tooling agrees. |
| 3. Repo `.data/` dir (dev only) | `<repo>/.data/dev.db` | N/A (not installed) | Yes | Yes | Only for local dev fixtures, never for anything a real agent depends on across sessions. |
| 0. Anything else | Homebrew Cellar, npm `node_modules`, `nvm`/`pyenv` version dir, OS cache dir, `/tmp`, a git worktree path | **No** | Varies | **No** | Never. Each of these is a directory some other tool considers disposable. |

The port-daddy incident this skill is built from: the daemon's default DB path resolved into a Homebrew Cellar version directory. `brew upgrade port-daddy` deletes the old Cellar version wholesale — including any state a naive default put inside it. The fix (ADR-0090/0044) was tier 1: one dotfile-home path, pinned by `PORT_DADDY_DB`, with the Cellar-relative default removed entirely, not just "also" pointed elsewhere.

## The Env-Pin Rule

Every process that opens the DB — daemon, CLI, snapshot exporter, backup job, test harness — must resolve the path through the **same single env var**, with no independent fallback default that differs between tools. Concretely:

```bash
export PORT_DADDY_DB="$HOME/.port-daddy/registry.db"
```

```ts
// every entry point, no exceptions
const dbPath = process.env.PORT_DADDY_DB ?? die('PORT_DADDY_DB is not set');
```

A "smart" per-tool default (`~/.port-daddy/registry.db` in the CLI, `~/.config/port-daddy/db` in the daemon, `./dev.db` in the exporter) is exactly how one daemon ends up backed by 7 scattered `.db` files with silently divergent row counts (7 vs 48 vs 89 items across CLI/snapshot/export in the real incident). If two tools can compute two different paths for "the" database, they will, eventually, under some environment.

## Journal Mode Decision Table

| Situation | journal_mode | Why |
| --- | --- | --- |
| One daemon process writes, multiple CLIs/readers read concurrently | `WAL` | Readers don't block the writer and vice versa; this is the common port-daddy shape. |
| Single process, single connection, no concurrent access ever | `DELETE` (default) or `TRUNCATE` | WAL adds a `-wal`/`-shm` file pair and checkpoint complexity you don't need. |
| Ephemeral test fixture, throwaway | `MEMORY` or `:memory:` | Never for anything meant to survive a process restart. |

Set both PRAGMAs on every connection open, not just once at install time — some SQLite drivers reset PRAGMAs per-connection:

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;   -- milliseconds; NOT optional in WAL mode with >1 writer
PRAGMA synchronous = NORMAL;  -- safe pairing with WAL; use FULL only if you distrust the disk/fs
```

## WAL Is Not Free Concurrency

WAL lets readers proceed while a writer holds the write lock, and lets one writer proceed while readers read a consistent snapshot. It does **not** let two writers commit simultaneously. Without `busy_timeout`, a second writer that finds the DB locked gets `SQLITE_BUSY` immediately instead of waiting — which under load looks like a crash-loop (open → busy → crash → supervisor restarts → busy → crash), which is exactly the WAL+WAL non-atomic tiering failure mode this skill is named for. `busy_timeout` converts that hard failure into a bounded wait; it does not remove the need for a real writer-serialization strategy (single writer process, or an in-process write queue) when write volume is high.

WAL also needs periodic checkpointing (`PRAGMA wal_checkpoint(TRUNCATE)` or automatic checkpoint on the default threshold) or the `-wal` file grows unbounded and reads slow down. A long-running reader transaction can starve checkpointing — watch for a `-wal` file that never shrinks.

## Migration Discipline

1. **Idempotent, versioned SQL files**, applied in a transaction per migration (`BEGIN IMMEDIATE; ...; COMMIT;`), tracked in a `schema_migrations` (or equivalent) table.
2. **Atomicity across two DBs is not automatic.** If a "migration" involves writing to two separate SQLite files (e.g. a hot DB and a cold/tiering DB), a crash between the two commits leaves them inconsistent — this is the literal WS-2 crash-loop bug: WAL+WAL non-atomic tiering between two files with no cross-file transaction. Either merge to one file, or add a durable intent log/outbox row in one file that the second write replays from.
3. **Never trust `migration repair --status applied`-style commands as proof of anything except history-table state.** These commands (Supabase CLI, and the equivalent port-daddy tooling) exist to reconcile a mismatched history table — they do not execute the migration's SQL. Running one against a migration that was never actually applied leaves the schema unchanged while the tooling reports success.
4. **Every migration needs a post-apply verification probe** that queries the actual target object, not the migration-history table:
   ```sql
   SELECT count(*) FROM pragma_table_info('items') WHERE name = 'status';
   -- or, for a new table:
   SELECT count(*) FROM sqlite_master WHERE type='table' AND name='items';
   ```
   If the probe returns 0, the migration did not apply — regardless of what the history table says.
5. **Run the verification in the same script/CI step that ran the migration**, so a false "applied" never survives to the next deploy.

## Quick Command Reference

```bash
# Inspect current journal mode / busy_timeout live
sqlite3 "$PORT_DADDY_DB" 'PRAGMA journal_mode; PRAGMA busy_timeout;'

# Force a WAL checkpoint (before backup, or if -wal is growing unbounded)
sqlite3 "$PORT_DADDY_DB" 'PRAGMA wal_checkpoint(TRUNCATE);'

# Verify a migration actually landed (ground truth, not history)
sqlite3 "$PORT_DADDY_DB" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='items';"
```
