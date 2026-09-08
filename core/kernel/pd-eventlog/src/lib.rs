use pd_core::{now_ms, KernelEvent, Provenance};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::Path;
use thiserror::Error;

pub struct EventStore {
    connection: Connection,
}

impl EventStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, EventLogError> {
        let connection = Connection::open(path)?;
        let store = Self { connection };
        store.initialize()?;
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self, EventLogError> {
        let connection = Connection::open_in_memory()?;
        let store = Self { connection };
        store.initialize()?;
        Ok(store)
    }

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
            id: KernelEvent::derive_id(sequence),
            sequence,
            event_type,
            subject,
            payload,
            provenance,
            created_at_ms,
        })
    }

    pub fn load_all(&self) -> Result<Vec<KernelEvent>, EventLogError> {
        self.load_since(0)
    }

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
                id: KernelEvent::derive_id(sequence),
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

    pub fn projection(&self) -> Result<KernelProjection, EventLogError> {
        let events = self.load_all()?;
        Ok(KernelProjection::from_events(&events))
    }

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

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct KernelProjection {
    pub last_sequence: i64,
    pub event_count: usize,
    pub transactions: BTreeSet<String>,
    pub jobs: BTreeSet<String>,
    pub rooms: BTreeSet<String>,
    pub obligations: BTreeSet<String>,
}

impl KernelProjection {
    pub fn from_events(events: &[KernelEvent]) -> Self {
        let mut projection = Self::default();
        for event in events {
            projection.apply(event);
        }
        projection
    }

    /// Folds a single event into the projection, **idempotently**.
    ///
    /// Event logs are replayed for recovery and rebuild, so the same event slice can
    /// be applied more than once. `sequence` is the authoritative, strictly-increasing
    /// ordering key (see [`pd_core::KernelEvent`]), so an event whose sequence has
    /// already been folded is skipped rather than counted a second time. Applying the
    /// same ordered slice twice therefore yields exactly the same projection as
    /// applying it once. Events are expected to arrive in non-decreasing `sequence`
    /// order, which the store's `load_all` / `load_since` (`ORDER BY sequence ASC`)
    /// always guarantee.
    ///
    /// # Examples
    ///
    /// ```
    /// use pd_core::{KernelEvent, Provenance};
    /// use pd_eventlog::KernelProjection;
    /// use serde_json::json;
    ///
    /// let ev = KernelEvent::new(1, "job.created", "job-1", json!({}), Provenance::kernel("t"));
    /// let mut projection = KernelProjection::default();
    /// projection.apply(&ev);
    /// projection.apply(&ev); // replayed — must not double-count
    /// assert_eq!(projection.event_count, 1);
    /// assert_eq!(projection.last_sequence, 1);
    /// ```
    pub fn apply(&mut self, event: &KernelEvent) {
        if event.sequence <= self.last_sequence {
            // Already folded (or out of order): replaying it must not mutate state.
            return;
        }
        self.last_sequence = event.sequence;
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

fn json_to_sql_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

#[derive(Debug, Error)]
pub enum EventLogError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
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

    #[test]
    fn replaying_the_same_slice_twice_does_not_double_count() {
        let store = EventStore::open_in_memory().unwrap();
        store
            .append("transaction.created", "tx-1", json!({ "intent": "ship" }))
            .unwrap();
        store
            .append("job.created", "job-1", json!({ "transaction": "tx-1" }))
            .unwrap();
        store
            .append("obligation.created", "ob-1", json!({}))
            .unwrap();

        let events = store.load_all().unwrap();

        // Baseline: fold the slice exactly once.
        let once = KernelProjection::from_events(&events);

        // Recovery/rebuild scenario: fold the same slice a second time into a
        // projection that already holds it. This must be a no-op, not a double count.
        let mut twice = KernelProjection::from_events(&events);
        for event in &events {
            twice.apply(event);
        }

        assert_eq!(once.event_count, 3);
        assert_eq!(twice, once);
        assert_eq!(twice.event_count, 3);
        assert_eq!(twice.last_sequence, once.last_sequence);
    }

    #[test]
    fn kernel_event_id_matches_derive_id_after_persist_and_reload() {
        let store = EventStore::open_in_memory().unwrap();
        let appended = store
            .append("transaction.created", "tx-1", json!({}))
            .unwrap();

        let reloaded = store.load_all().unwrap();

        assert_eq!(appended.id, KernelEvent::derive_id(appended.sequence));
        assert_eq!(reloaded[0].id, appended.id);
    }
}
