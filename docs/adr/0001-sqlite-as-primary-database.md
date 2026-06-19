# 0001. SQLite as Primary Database

## Status

Accepted

## Context

Port Daddy is a local development daemon — a process that runs on a developer's machine and coordinates port assignments, agent state, sessions, locks, and messaging across multiple concurrent processes (AI agents, CLI invocations, the dashboard browser tab). The daemon needs durable storage that:

- Survives daemon restarts without losing port assignments
- Supports atomic multi-table operations (claim + log, session start + file claims)
- Allows multiple processes to read and write simultaneously
- Requires zero infrastructure setup for a developer tool

The early prototype used an in-memory JavaScript Map, which lost all state on every restart. This made the system unreliable: a restarted daemon meant every agent had to re-claim ports, causing conflicts with services still listening on the old ports.

The storage layer also needed to be queryable. Patterns like `myapp:*` (release all ports for a project) and `pd salvage --project myapp` (find all dead agents for a project) required indexed lookups, not linear scans.

## Decision Drivers

- **Zero setup**: Developers should not need to install or configure a separate database server to use Port Daddy.
- **Persistence**: State must survive daemon restarts.
- **Atomicity**: Multi-step operations (claim a port, record in the activity log, emit a webhook) must not leave partial state on failure.
- **Concurrent access**: Multiple CLI processes and the dashboard can hit the daemon simultaneously, plus the CLI's direct-DB mode accesses the file directly without going through the daemon.
- **Queryability**: Pattern-based queries, JOINs between sessions and notes, and aggregations over the activity log are required.
- **Portability**: Works identically on macOS and Linux with no per-machine configuration.
- **Embeddable**: Must run inside the Node.js process, not as a separate service.

## Considered Options

### Option A: SQLite (better-sqlite3)

A file-based relational database embedded directly in the process. The single database file (`port-registry.db`) lives at the project root.

**Pros:**
- Zero infrastructure — just a file
- Full SQL: JOINs, indexes, transactions, CASCADE deletes
- Survives restarts
- WAL mode enables concurrent readers
- Excellent Node.js bindings (`better-sqlite3`)

**Cons:**
- Write-lock contention under heavy concurrent writes (mitigated by WAL mode and `busy_timeout`)
- Not suitable for multi-machine distributed use (but Port Daddy is explicitly a local tool)

### Option B: PostgreSQL or MySQL

A full client-server database.

**Pros:**
- True concurrent writes, horizontal scaling
- Rich ecosystem

**Cons:**
- Requires the developer to install and run a database server — a significant friction point for a developer tool
- Overkill for single-machine local state
- Adds an external dependency that can be misconfigured, version-mismatched, or unavailable

### Option C: Redis

An in-memory data structure store with optional persistence.

**Pros:**
- Fast pub/sub (Port Daddy has a pub/sub system)
- Simple key-value model

**Cons:**
- Requires a running Redis server — same infrastructure friction as Option B
- Persistence (AOF/RDB) is optional and requires configuration
- No relational model: JOINs, pattern queries, and CASCADE deletes require application-level workarounds
- Port Daddy already implements its own pub/sub over SQLite's messages table — no benefit

### Option D: JSON files (e.g., a flat `state.json`)

**Pros:**
- No dependencies
- Human-readable

**Cons:**
- No atomicity without careful file-locking discipline
- No indexes — pattern queries require full scans
- Concurrent writes from multiple processes require external mutex management
- Does not scale beyond trivial state

### Option E: LevelDB / RocksDB

Embedded key-value stores with good concurrent-write performance.

**Pros:**
- Embedded, no server required
- Good concurrent write throughput

**Cons:**
- No relational model — all JOIN-like operations must be done in application code
- No SQL; queries require custom iterators
- Less mature Node.js bindings compared to `better-sqlite3`

## Decision

Use **SQLite via `better-sqlite3`** as the sole storage layer.

The database file lives at `<project-root>/port-registry.db` by default, overridable with the `PORT_DADDY_DB` environment variable. WAL mode (`PRAGMA journal_mode = WAL`) is enabled at startup to allow concurrent readers during daemon writes. A `busy_timeout` of 5 seconds prevents immediate failures when the write lock is briefly held.

## Rationale

Port Daddy's design principle is "zero infrastructure". A developer should be able to run `npm install -g port-daddy` and immediately have a working coordinator — no Docker, no Postgres, no Redis. SQLite is the only option that satisfies this while still providing full relational semantics.

The concurrent-write concern (multiple CLI processes writing simultaneously) is addressed by:

1. WAL mode, which allows readers to proceed while a write is in progress
2. `busy_timeout = 5000` — the CLI waits up to 5 seconds for a lock rather than failing immediately
3. The daemon being the primary write path; direct-DB mode (used by the CLI for Tier 1 commands) is careful about what it modifies

The fact that SQLite is not distributed is a feature, not a bug. Port Daddy is explicitly scoped to a single developer machine. The architectural constraints that would require a distributed database (multiple machines sharing state) are out of scope.

## Consequences

### Positive

- No external dependencies beyond Node.js
- Full SQL available: the codebase freely uses `JOIN`, `CASCADE`, indexed `LIKE` patterns, and transactions
- In-memory SQLite (`:memory:`) enables extremely fast unit tests — `tests/setup-unit.js` provides a `createTestDb()` factory that every unit test suite uses
- WAL checkpoint on daemon shutdown (`PRAGMA wal_checkpoint(TRUNCATE)`) keeps the database file compact
- `sqlite3` CLI can be used directly for debugging: `sqlite3 port-registry.db ".tables"` and ad-hoc queries work without any special tooling

### Negative

- SQLite's write serialization means high-frequency concurrent writes (many agents claiming ports simultaneously) will queue. In practice, port claims are infrequent and the 5-second busy timeout is more than sufficient.
- Database files left behind in project roots can surprise developers. The `.gitignore` entry for `port-registry*.db` must be maintained.
- Database corruption, while rare, requires a `pd doctor --repair` workflow (integrity check is run on every startup).

### Neutral

- The schema is owned by `lib/db.ts` (`CORE_SCHEMA_SQL`), with individual modules running their own `CREATE TABLE IF NOT EXISTS` statements when they initialize. This self-initializing pattern means schema migrations are handled inline via `ALTER TABLE` with `try/catch` to handle already-applied cases.
- Three separate database files exist: `port-registry.db` (production), `port-registry-test.db` (integration tests), and `port-registry-security-test.db` (security tests). This isolation prevents test runs from corrupting production state.
