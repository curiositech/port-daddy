type: fixed

- **Legacy Parleys survive the Store0 cutover.** `lib/parley-store.ts` imports validated v3.30.2 tuple authority once under SQLite's writer lock, leaves source tuples untouched, preserves deterministic transcript/frontier/outcome evidence with a versioned receipt, and keeps migrated records readable across daemon restarts.
