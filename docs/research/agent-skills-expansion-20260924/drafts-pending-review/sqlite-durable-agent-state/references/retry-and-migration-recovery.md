# Retry and migration recovery

A `busy_timeout` waits on one connection for a configured interval and may still return `SQLITE_BUSY`. Bound it by caller deadline. Distinguish writer contention from stale-snapshot upgrade failure. For a stale snapshot, roll back and rerun the whole transaction from fresh reads when safe and idempotent; do not retry only its final write. Cap retries and report busy/deadline outcomes. If a response is lost after possible commit, use an idempotency key or query authoritative operation state; generic retry is not exactly-once behavior.

For migrations, record path, SQLite version, journal mode, migration ID, and pre-state. Apply idempotently in a suitable transaction; verify target schema/data separately from migration history. If they disagree, stop automated progression and preserve the DB for a classified forward repair/restore. Attached DB transactions in WAL are not atomic across the set. Prefer one DB or durable intent/reconciliation. Back up WAL-aware, restore to a separate path, and query the restored state.

This is procedural guidance, not a tested recovery implementation. No SQLite concurrency, crash, migration, or restore test ran for this draft.

Sources: [transactions](https://www.sqlite.org/lang_transaction.html), [WAL](https://www.sqlite.org/wal.html), [busy timeout](https://www.sqlite.org/c3ref/busy_timeout.html), [backup API](https://www.sqlite.org/backup.html).
