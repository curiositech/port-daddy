# 0006. Synchronous SQLite Queries via `better-sqlite3`

## Status

Accepted

## Context

Port Daddy uses SQLite as its database (see ADR-0001). The Node.js SQLite ecosystem offers two main choices: `sqlite3` (callback/promise-based, asynchronous) and `better-sqlite3` (synchronous). This ADR records the decision to use `better-sqlite3` and its synchronous query API.

This decision is more significant than it might first appear. Node.js is a single-threaded event loop runtime. By convention, all I/O in Node.js is asynchronous — file reads, HTTP requests, DNS lookups all return Promises or use callbacks. Choosing a synchronous database library breaks this convention. The decision requires careful justification.

## Decision Drivers

- **Simplicity**: Async database code requires `async/await` or Promise chains throughout every function that touches the database. Synchronous code reads as straight-line imperative logic.
- **Atomicity**: Multi-step operations that must be atomic require transactions. Synchronous transactions are straightforward; async transactions require careful Promise chaining to avoid releasing the write lock mid-operation.
- **Prepared statements**: The `stmts` pattern (see ADR-0002) prepares all statements at module creation time. `better-sqlite3` prepared statements are synchronous objects — they work cleanly in the closure pattern without needing async initialization.
- **Performance**: For a local dev tool, SQLite queries against a small database (hundreds to thousands of rows) complete in microseconds. The async overhead of scheduling microtasks adds latency with no benefit.
- **Error handling**: Synchronous errors propagate as thrown exceptions through normal try/catch, not through rejected Promises or missing `.catch()` handlers.

## Considered Options

### Option A: `better-sqlite3` (synchronous)

The `better-sqlite3` library provides a synchronous, blocking API for SQLite. All queries (`stmt.run()`, `stmt.get()`, `stmt.all()`) block the calling code until the query completes.

```typescript
// Synchronous — reads naturally as imperative code
const lock = stmts.get.get(name) as LockRow | undefined;
if (lock) {
  return { success: false, error: 'lock is held', holder: lock.owner };
}
stmts.acquire.run(name, owner, pid, now, expiresAt, metadata);
return { success: true, name, owner };
```

**Pros:**
- No async/await or Promise boilerplate
- Transactions work exactly as expected: `db.transaction(fn)()` wraps a function and commits or rolls back atomically
- Errors throw synchronously and propagate naturally
- Significantly faster than async alternatives for the query sizes Port Daddy uses (benchmarks in the `better-sqlite3` README show 5-10x faster than `sqlite3` for typical usage)
- Prepared statements are plain objects, not Promises, so they work cleanly in the factory pattern's `stmts` object

**Cons:**
- Blocks the Node.js event loop during the query. For a busy web server processing thousands of concurrent requests, this would be catastrophic. For a local dev tool processing one request every few seconds, this is acceptable.
- Cannot run multiple queries concurrently on the same database — but SQLite's write lock means true concurrency is not possible anyway
- Requires native compilation (`node-gyp`) — a common pain point for npm packages on developer machines

### Option B: `sqlite3` (async, callback-based)

The original Node.js SQLite binding, using the Node.js callback convention.

```typescript
db.get('SELECT * FROM locks WHERE name = ?', [name], (err, row) => {
  if (err) { callback(err); return; }
  if (row) { callback(null, { success: false, error: 'lock is held' }); return; }
  db.run('INSERT INTO locks ...', [...], (err2) => {
    // ...
  });
});
```

**Pros:**
- Async — does not block the event loop
- The original, most battle-tested Node.js SQLite binding

**Cons:**
- Callback nesting makes multi-step operations difficult to read
- Error handling requires checks at every callback level
- Transactions with multiple async steps require careful Promise wrapping

### Option C: `@databases/sqlite` or Drizzle ORM with async SQLite

Higher-level async abstractions.

**Pros:**
- Type-safe query building
- Promise-based

**Cons:**
- Additional dependencies with their own release cycles and potential incompatibilities
- The abstraction layer hides the actual SQL, making it harder to optimize queries and understand what indexes are being hit
- Port Daddy's queries are simple enough that a query builder adds boilerplate rather than removing it

### Option D: SQLite via `sql.js` (WebAssembly)

SQLite compiled to WebAssembly, running in the same process without native code.

**Pros:**
- No native compilation required
- Cross-platform including Windows and browser environments

**Cons:**
- Significantly slower than native SQLite for real I/O (WASM has overhead for file access)
- The database lives in memory unless explicitly serialized to disk — persistence requires additional code
- No WAL mode support

## Decision

Use **`better-sqlite3`** for all database access. All queries are synchronous.

This is implemented throughout the codebase: every module's `stmts` object contains `better-sqlite3` prepared statement objects. Query results are returned immediately as plain values, not Promises:

```typescript
// lib/locks.ts
const existing = stmts.get.get(name) as LockRow | undefined;
// existing is immediately a LockRow or undefined — no await, no .then()
```

Transactions use `better-sqlite3`'s `db.transaction()` wrapper where atomicity is required. The `sugar` module's `begin()` function — which must register an agent and start a session atomically with rollback on failure — uses explicit sequential calls with manual rollback rather than a database transaction, because the rollback logic (calling `agents.unregister()`) involves application-level compensation, not just SQL undo.

## Rationale

The key insight is that Port Daddy is not a general-purpose web server. It is a local coordination daemon. Its clients are developers and AI agents on the same machine. The database is never more than a few thousand rows. Queries complete in under 1 millisecond.

The event loop blocking concern — the standard objection to synchronous I/O in Node.js — is real but irrelevant at Port Daddy's scale. A 1ms blocking query on a daemon that receives at most a few dozen requests per minute is not a bottleneck. The benefit of synchronous code — readable, auditable, exception-based error handling — substantially outweighs the theoretical event loop cost.

The `better-sqlite3` README makes this case explicitly: "If your Node process is running intensive, CPU-heavy computations, you might want to use asynchronous APIs to avoid blocking the event loop. But for I/O-heavy workloads, or when you just need fast queries, synchronous APIs are fine and often preferable."

Port Daddy's workload is light I/O with simple queries. Synchronous is the right choice.

## Consequences

### Positive

- Module code reads as straight-line imperative logic throughout `lib/` — no async/await, no Promise chains, no callback pyramids
- Errors propagate as thrown exceptions and are caught at route level with a single global error handler
- Unit tests run without any async test infrastructure — `await` is not needed to test database operations
- The `stmts` pattern is clean: prepared statements are synchronous objects stored in a plain object, initialized once at factory creation time
- `db.transaction()` makes atomic multi-statement operations trivial to write correctly

### Negative

- `better-sqlite3` requires native compilation via `node-gyp`. This can fail on machines with unusual compiler configurations. The workaround is to ensure Node.js LTS (>=20) and build tools are installed — which Port Daddy requires anyway (it is in `engines`).
- Any rogue query that does a full table scan on a very large table (unlikely given Port Daddy's typical data sizes, but theoretically possible) would block all other requests for the duration

### Neutral

- WAL mode (`PRAGMA journal_mode = WAL`) is set at startup to maximize concurrent read performance. With WAL, readers (GET requests) never block writers (POST/DELETE), which is the dominant concurrency pattern.
- The `busy_timeout = 5000` pragma means that if a write is in progress, other writes wait up to 5 seconds rather than failing immediately. This is appropriate for a tool where occasional serialization is expected and 5 seconds is far shorter than any human-noticeable timeout.
