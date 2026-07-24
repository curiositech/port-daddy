//! Append-only event log for Port Daddy kernel events.
//!
//! # What this crate is
//!
//! An *event log* (or "event store") is a table you only ever append to. You never
//! `UPDATE` or `DELETE` a row; the truth of the system is the ordered sequence of
//! everything that has ever happened. To learn "what is the state right now?" you
//! don't read a mutable row — you *replay* the log from the beginning and fold each
//! event into an in-memory summary. That summary is called a **projection**.
//!
//! This is the same idea as a database's write-ahead log, git's commit history, or
//! bank ledger: the durable artifact is the history, and current state is a
//! derived, disposable view of it. The pattern is often called *event sourcing*.
//!
//! # Why the kernel is built this way
//!
//! Port Daddy coordinates many agents mutating shared state concurrently. If the
//! source of truth were a mutable row, a crash mid-write could leave state
//! half-updated and unrecoverable, and there would be no audit trail of *who* did
//! *what* *when*. An append-only log fixes both problems at once:
//!
//! - **Auditability** — every state change is a row that is never rewritten, so the
//!   full causal history is always inspectable after the fact.
//! - **Crash safety** — appending a single row is atomic. Either the event is
//!   durably recorded or it is not; state is never observed half-mutated.
//! - **Deterministic replay** — because events are totally ordered by an
//!   ever-increasing `sequence`, any two readers that replay the same log produce
//!   the same projection. State is reproducible, not just current.
//!
//! # The durability contract
//!
//! Events are stored in SQLite in **WAL** (write-ahead logging) mode with
//! `synchronous=NORMAL`. WAL lets readers proceed concurrently with a writer, and
//! the `sequence INTEGER PRIMARY KEY AUTOINCREMENT` column hands out a strictly
//! increasing identifier per append. Two guarantees follow, and callers may rely on
//! them:
//!
//! 1. **Total order** — `sequence` never repeats and never decreases. An event with
//!    a higher sequence happened-after one with a lower sequence.
//! 2. **Monotonic reads** — [`EventStore::load_since`] with a caller-held cursor
//!    only ever returns events strictly newer than that cursor, so a follower can
//!    tail the log incrementally without re-reading or missing anything.
//!
//! # Typical use
//!
//! ```
//! use pd_eventlog::{EventStore, KernelProjection};
//! use serde_json::json;
//!
//! // An in-memory store needs no files; it is ideal for tests and examples.
//! let store = EventStore::open_in_memory().unwrap();
//!
//! // Record two things that happened, in order.
//! store.append("transaction.created", "tx-1", json!({ "intent": "ship" })).unwrap();
//! store.append("job.created", "job-1", json!({ "transaction": "tx-1" })).unwrap();
//!
//! // Ask "what is the current state?" by folding the whole log into a projection.
//! let projection: KernelProjection = store.projection().unwrap();
//! assert_eq!(projection.event_count, 2);
//! assert!(projection.transactions.contains("tx-1"));
//! assert!(projection.jobs.contains("job-1"));
//! ```

use pd_core::{now_ms, KernelEvent, Provenance};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::Path;
use thiserror::Error;

/// A durable, append-only store of [`KernelEvent`]s backed by SQLite.
///
/// An `EventStore` owns a single SQLite [`Connection`]. All writes go through
/// [`append`](EventStore::append), which inserts exactly one row; there is
/// deliberately no update or delete API, because the log is the source of truth and
/// rewriting history would break replay determinism (see the crate-level docs).
///
/// # Invariants
///
/// - Every appended event receives a strictly increasing `sequence` from SQLite's
///   `AUTOINCREMENT`, establishing a total happened-before order.
/// - The backing table and indexes are created on open, so a freshly opened store
///   is immediately usable; opening an existing database is a no-op schema-wise.
///
/// # Failure contract
///
/// Constructors and every read/write method return [`EventLogError`] rather than
/// panicking. An error means the underlying SQLite operation or JSON
/// (de)serialization failed; the store is left untouched and the caller may retry
/// or surface the error. Nothing in this type panics on a well-formed call.
pub struct EventStore {
    connection: Connection,
}

impl EventStore {
    /// Opens (or creates) an on-disk event log at `path` and ensures its schema exists.
    ///
    /// If the file does not exist it is created; if it does, its existing events are
    /// preserved and the schema-creation step is idempotent (`CREATE TABLE IF NOT
    /// EXISTS`). WAL mode is enabled here, which also creates the sidecar `-wal` and
    /// `-shm` files next to the database.
    ///
    /// # Errors
    ///
    /// Returns [`EventLogError::Sqlite`] if the file cannot be opened (e.g. bad path
    /// or permissions) or the schema batch fails.
    ///
    /// ```no_run
    /// use pd_eventlog::EventStore;
    /// // Opens a real file on disk, so this example is compiled but not run.
    /// let store = EventStore::open("/var/lib/port-daddy/events.db").unwrap();
    /// let events = store.load_all().unwrap();
    /// assert!(events.is_empty());
    /// ```
    pub fn open(path: impl AsRef<Path>) -> Result<Self, EventLogError> {
        let connection = Connection::open(path)?;
        let store = Self { connection };
        store.initialize()?;
        Ok(store)
    }

    /// Opens a transient event log held entirely in RAM and ensures its schema exists.
    ///
    /// The store vanishes when dropped — nothing touches the filesystem. This is the
    /// right constructor for unit tests, examples, and any ephemeral projection work
    /// where durability is not required.
    ///
    /// # Errors
    ///
    /// Returns [`EventLogError::Sqlite`] only if SQLite fails to allocate the
    /// in-memory database or run the schema batch, which in practice does not happen
    /// on a healthy process.
    ///
    /// ```
    /// use pd_eventlog::EventStore;
    /// let store = EventStore::open_in_memory().unwrap();
    /// assert!(store.load_all().unwrap().is_empty());
    /// ```
    pub fn open_in_memory() -> Result<Self, EventLogError> {
        let connection = Connection::open_in_memory()?;
        let store = Self { connection };
        store.initialize()?;
        Ok(store)
    }

    /// Appends one event to the log and returns the fully-formed [`KernelEvent`] it wrote.
    ///
    /// The `payload` is any serializable value; it is stored as JSON text. The
    /// event's `provenance` is stamped as originating from the `pd-eventlog` kernel
    /// component, and `created_at_ms` is taken at call time. The returned event
    /// carries the `sequence` SQLite assigned, so the caller immediately knows this
    /// event's position in the total order without a follow-up read.
    ///
    /// # Ordering guarantee
    ///
    /// The `sequence` is drawn from `last_insert_rowid()` after the row is committed,
    /// so it is strictly greater than every previously appended event's sequence.
    ///
    /// # Errors
    ///
    /// Returns [`EventLogError::Serde`] if `payload` cannot be serialized to JSON, or
    /// [`EventLogError::Sqlite`] if the `INSERT` fails. On error nothing is appended.
    ///
    /// ```
    /// use pd_eventlog::EventStore;
    /// use serde_json::json;
    ///
    /// let store = EventStore::open_in_memory().unwrap();
    /// let first = store.append("room.created", "room-1", json!({ "topic": "kernel" })).unwrap();
    /// let second = store.append("room.created", "room-2", json!({ "topic": "ops" })).unwrap();
    ///
    /// // Sequences are strictly increasing.
    /// assert_eq!(first.sequence, 1);
    /// assert_eq!(second.sequence, 2);
    /// assert_eq!(first.event_type, "room.created");
    /// ```
    pub fn append(
        &self,
        event_type: impl Into<String>,
        subject: impl Into<String>,
        payload: impl Serialize,
    ) -> Result<KernelEvent, EventLogError> {
        let event_type = event_type.into();
        let subject = subject.into();
        let payload = serde_json::to_value(payload)?;
        let provenance = Provenance::kernel("pd-eventlog");
        let created_at_ms = now_ms();

        self.connection.execute(
            "INSERT INTO kernel_events (event_type, subject, payload_json, provenance_json, created_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                event_type,
                subject,
                serde_json::to_string(&payload)?,
                serde_json::to_string(&provenance)?,
                created_at_ms
            ],
        )?;
        let sequence = self.connection.last_insert_rowid();

        Ok(KernelEvent {
            id: format!("event-{sequence}"),
            sequence,
            event_type,
            subject,
            payload,
            provenance,
            created_at_ms,
        })
    }

    /// Loads the entire log, oldest event first.
    ///
    /// Equivalent to [`load_since(0)`](EventStore::load_since) since sequences begin
    /// at 1. Use this to build a projection from scratch; for large logs prefer
    /// tailing with `load_since` and a saved cursor.
    ///
    /// # Errors
    ///
    /// Returns [`EventLogError`] if the query fails or a stored row cannot be
    /// deserialized back into a [`KernelEvent`].
    ///
    /// ```
    /// use pd_eventlog::EventStore;
    /// use serde_json::json;
    ///
    /// let store = EventStore::open_in_memory().unwrap();
    /// store.append("job.created", "job-1", json!({})).unwrap();
    /// let events = store.load_all().unwrap();
    /// assert_eq!(events.len(), 1);
    /// assert_eq!(events[0].subject, "job-1");
    /// ```
    pub fn load_all(&self) -> Result<Vec<KernelEvent>, EventLogError> {
        self.load_since(0)
    }

    /// Loads every event whose `sequence` is strictly greater than `sequence`, oldest first.
    ///
    /// This is the incremental-tail primitive: a follower persists the highest
    /// sequence it has already applied, then calls `load_since(that_sequence)` to
    /// fetch only what is new. Because the query is `sequence > ?1` and results are
    /// ordered ascending, no event is ever returned twice and none is skipped, as
    /// long as the caller advances its cursor to the last returned event's sequence.
    ///
    /// # Errors
    ///
    /// Returns [`EventLogError`] if the query fails or a row cannot be deserialized.
    ///
    /// ```
    /// use pd_eventlog::EventStore;
    /// use serde_json::json;
    ///
    /// let store = EventStore::open_in_memory().unwrap();
    /// store.append("transaction.created", "tx-1", json!({})).unwrap();
    /// store.append("transaction.created", "tx-2", json!({})).unwrap();
    ///
    /// // Skip everything up to and including sequence 1; only tx-2 remains.
    /// let fresh = store.load_since(1).unwrap();
    /// assert_eq!(fresh.len(), 1);
    /// assert_eq!(fresh[0].subject, "tx-2");
    /// ```
    pub fn load_since(&self, sequence: i64) -> Result<Vec<KernelEvent>, EventLogError> {
        let mut statement = self.connection.prepare(
            "SELECT sequence, event_type, subject, payload_json, provenance_json, created_at_ms
             FROM kernel_events
             WHERE sequence > ?1
             ORDER BY sequence ASC",
        )?;
        let rows = statement.query_map(params![sequence], |row| {
            let sequence: i64 = row.get(0)?;
            let payload_json: String = row.get(3)?;
            let provenance_json: String = row.get(4)?;
            Ok(KernelEvent {
                id: format!("event-{sequence}"),
                sequence,
                event_type: row.get(1)?,
                subject: row.get(2)?,
                payload: serde_json::from_str(&payload_json).map_err(json_to_sql_error)?,
                provenance: serde_json::from_str(&provenance_json).map_err(json_to_sql_error)?,
                created_at_ms: row.get(5)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(EventLogError::Sqlite)
    }

    /// Replays the whole log and folds it into a [`KernelProjection`] of current state.
    ///
    /// A convenience for `KernelProjection::from_events(&self.load_all()?)`. This is
    /// how a caller answers "what transactions/jobs/rooms/obligations exist right
    /// now?" without maintaining any mutable state of its own.
    ///
    /// # Errors
    ///
    /// Propagates any [`EventLogError`] from the underlying [`load_all`](EventStore::load_all).
    ///
    /// ```
    /// use pd_eventlog::EventStore;
    /// use serde_json::json;
    ///
    /// let store = EventStore::open_in_memory().unwrap();
    /// store.append("obligation.created", "ob-1", json!({})).unwrap();
    /// let projection = store.projection().unwrap();
    /// assert!(projection.obligations.contains("ob-1"));
    /// ```
    pub fn projection(&self) -> Result<KernelProjection, EventLogError> {
        let events = self.load_all()?;
        Ok(KernelProjection::from_events(&events))
    }

    /// Creates the `kernel_events` table and its indexes, and enables WAL journaling.
    ///
    /// Called once by every constructor. Uses `IF NOT EXISTS` throughout so it is
    /// safe to run against an already-initialized database. `PRAGMA journal_mode=WAL`
    /// and `synchronous=NORMAL` trade a sliver of fsync durability for concurrent
    /// reader/writer throughput — the appropriate balance for an event log whose
    /// individual appends are already atomic.
    fn initialize(&self) -> Result<(), EventLogError> {
        self.connection.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS kernel_events (
               sequence INTEGER PRIMARY KEY AUTOINCREMENT,
               event_type TEXT NOT NULL,
               subject TEXT NOT NULL,
               payload_json TEXT NOT NULL,
               provenance_json TEXT NOT NULL,
               created_at_ms INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_kernel_events_type ON kernel_events(event_type);
             CREATE INDEX IF NOT EXISTS idx_kernel_events_subject ON kernel_events(subject);",
        )?;
        Ok(())
    }
}

/// A derived, in-memory summary of the log's current state — the *projection*.
///
/// A projection is the folded result of replaying every event. It holds no
/// authority of its own: it is disposable and always reconstructible from the log.
/// This particular projection tracks which entity ids the kernel has seen, grouped
/// by kind, plus a running event count and the highest sequence applied.
///
/// The id sets are [`BTreeSet`]s (not `HashSet`) on purpose: their ordered iteration
/// makes any downstream serialization or diff deterministic, matching the
/// determinism the log itself provides.
///
/// `last_sequence` doubles as the resume cursor: feed it to
/// [`EventStore::load_since`] to continue folding only newer events into an existing
/// projection via [`apply`](KernelProjection::apply).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct KernelProjection {
    /// Highest `sequence` folded in so far; also the cursor for incremental catch-up.
    pub last_sequence: i64,
    /// Total number of events applied (including ones that matched no known type).
    pub event_count: usize,
    /// Subjects of `transaction.created` / `compat.session.imported` events.
    pub transactions: BTreeSet<String>,
    /// Subjects of `job.created` / `job.leased` / `job.completed` events.
    pub jobs: BTreeSet<String>,
    /// Subjects of `room.created` / `room.message.imported` events.
    pub rooms: BTreeSet<String>,
    /// Subjects of `obligation.created` / `.acknowledged` / `.deferred` events.
    pub obligations: BTreeSet<String>,
}

impl KernelProjection {
    /// Folds a slice of events into a fresh projection, applying them in order.
    ///
    /// The events should already be sequence-ordered (as they come from
    /// [`EventStore::load_all`]); [`apply`](KernelProjection::apply) is idempotent
    /// with respect to set membership but counts every event, so replaying the same
    /// slice twice would double `event_count`.
    ///
    /// ```
    /// use pd_eventlog::KernelProjection;
    /// use pd_core::{KernelEvent, Provenance};
    /// use serde_json::json;
    ///
    /// let events = vec![
    ///     KernelEvent::new(1, "transaction.created", "tx-1", json!({}), Provenance::kernel("test")),
    ///     KernelEvent::new(2, "job.created", "job-1", json!({}), Provenance::kernel("test")),
    /// ];
    /// let projection = KernelProjection::from_events(&events);
    /// assert_eq!(projection.event_count, 2);
    /// assert_eq!(projection.last_sequence, 2);
    /// assert!(projection.transactions.contains("tx-1"));
    /// assert!(projection.jobs.contains("job-1"));
    /// ```
    pub fn from_events(events: &[KernelEvent]) -> Self {
        let mut projection = Self::default();
        for event in events {
            projection.apply(event);
        }
        projection
    }

    /// Folds a single event into this projection, mutating it in place.
    ///
    /// Advances `last_sequence` to the max of its current value and the event's
    /// sequence, increments `event_count`, and routes the event's `subject` into the
    /// matching id set based on its `event_type`. Event types the kernel does not
    /// model here are counted but otherwise ignored — an unknown type is not an
    /// error, because the log may legitimately carry events this projection does not
    /// care about.
    ///
    /// ```
    /// use pd_eventlog::KernelProjection;
    /// use pd_core::{KernelEvent, Provenance};
    /// use serde_json::json;
    ///
    /// let mut projection = KernelProjection::default();
    /// projection.apply(&KernelEvent::new(
    ///     5, "room.created", "room-9", json!({}), Provenance::kernel("test"),
    /// ));
    /// // An unmodeled event type still advances the counters, but adds no id.
    /// projection.apply(&KernelEvent::new(
    ///     6, "telemetry.recorded", "n/a", json!({}), Provenance::kernel("test"),
    /// ));
    /// assert_eq!(projection.last_sequence, 6);
    /// assert_eq!(projection.event_count, 2);
    /// assert!(projection.rooms.contains("room-9"));
    /// ```
    pub fn apply(&mut self, event: &KernelEvent) {
        self.last_sequence = self.last_sequence.max(event.sequence);
        self.event_count += 1;
        match event.event_type.as_str() {
            "transaction.created" | "compat.session.imported" => {
                self.transactions.insert(event.subject.clone());
            }
            "job.created" | "job.leased" | "job.completed" => {
                self.jobs.insert(event.subject.clone());
            }
            "room.created" | "room.message.imported" => {
                self.rooms.insert(event.subject.clone());
            }
            "obligation.created" | "obligation.acknowledged" | "obligation.deferred" => {
                self.obligations.insert(event.subject.clone());
            }
            _ => {}
        }
    }
}

/// Wraps a JSON deserialization failure as a rusqlite row-conversion error.
///
/// [`Connection::query_map`]'s row-mapper closure must return
/// [`rusqlite::Error`], but the stored payload/provenance columns are JSON that can
/// fail to parse. This adapter lets `?`-style propagation inside the mapper surface
/// a JSON error as a `FromSqlConversionFailure`, so the failure travels out through
/// the normal SQLite error channel instead of panicking.
fn json_to_sql_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

/// Everything that can go wrong reading from or writing to an [`EventStore`].
///
/// Both variants are `#[from]`-convertible, so store methods can use the `?`
/// operator over SQLite and serde failures uniformly. An error never leaves the
/// store in a partially-mutated state: a failed append inserts nothing, and a failed
/// load returns no partial vector.
#[derive(Debug, Error)]
pub enum EventLogError {
    /// The underlying SQLite operation failed (open, schema, insert, query, or a
    /// row-mapping conversion — including JSON columns that failed to parse).
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    /// A payload or provenance value failed to serialize on the way in.
    #[error(transparent)]
    Serde(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn append_only_events_replay_to_projection() {
        let store = EventStore::open_in_memory().unwrap();

        store
            .append("transaction.created", "tx-1", json!({ "intent": "ship" }))
            .unwrap();
        store
            .append("job.created", "job-1", json!({ "transaction": "tx-1" }))
            .unwrap();
        store
            .append("room.created", "room-1", json!({ "topic": "kernel" }))
            .unwrap();

        let events = store.load_all().unwrap();
        let projection = KernelProjection::from_events(&events);

        assert_eq!(events.len(), 3);
        assert_eq!(projection.last_sequence, 3);
        assert!(projection.transactions.contains("tx-1"));
        assert!(projection.jobs.contains("job-1"));
        assert!(projection.rooms.contains("room-1"));
    }

    #[test]
    fn load_since_returns_only_new_events() {
        let store = EventStore::open_in_memory().unwrap();
        store
            .append("transaction.created", "tx-1", json!({}))
            .unwrap();
        store
            .append("transaction.created", "tx-2", json!({}))
            .unwrap();

        let events = store.load_since(1).unwrap();

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].subject, "tx-2");
    }
}
