//! One-way history bridge from the legacy TypeScript Port Daddy into the Rust kernel.
//!
//! The original Port Daddy is a TypeScript daemon; the Rust kernel is its successor. This
//! crate lets the kernel *inherit the past* without inheriting the old storage engine: it
//! takes records exported from the TS side (actors, sessions, notes) and replays them into
//! the Rust [`EventStore`] as append-only history events.
//!
//! # Read-only by design
//!
//! The bridge is **strictly one-way and history-only**. It appends events like
//! `"compat.session.imported"`; it never lets old TypeScript state *drive* new kernel
//! behavior. That is a deliberate boundary, not a missing feature — a two-way mutation bridge
//! would make the deprecated engine authoritative again, re-coupling the systems we are
//! trying to decouple. The [`CompatError::MutationBridgeUnsupported`] variant exists to name
//! that closed door explicitly.
//!
//! Each `import_*` call returns an [`ImportReport`] tallying what was ingested, and either
//! fully succeeds or returns a [`CompatError`] — there is no silent partial import to
//! misread as complete.

use pd_eventlog::{EventLogError, EventStore};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// An actor record as exported from the legacy TypeScript Port Daddy.
///
/// Field names and optionality mirror the TS export shape exactly, so a serialized TS actor
/// deserializes straight into this type. `identity` and `telos` are optional because older
/// exports predate those concepts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TsActorExport {
    /// Stable actor id, used as the event key on import.
    pub id: String,
    /// Human-readable label.
    pub label: String,
    /// Semantic identity string, if the export had one.
    pub identity: Option<String>,
    /// The actor's declared telos/purpose, if present.
    pub telos: Option<String>,
}

/// A work session as exported from the legacy TypeScript Port Daddy, with its notes inline.
///
/// Timestamps are optional and in milliseconds; `ended_at_ms == None` marks a session that
/// was still open when exported. The `notes` are nested here (rather than referenced) so a
/// single session import carries its full note history in one record.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TsSessionExport {
    /// Stable session id, used as the event key on import.
    pub id: String,
    /// Semantic identity the session ran under (e.g. `"port-daddy:agent"`).
    pub identity: String,
    /// What the session was for.
    pub purpose: String,
    /// Worktree path the session operated in, if any.
    pub worktree: Option<String>,
    /// Session start, Unix ms.
    pub started_at_ms: Option<i64>,
    /// Session end, Unix ms; `None` if it was still open at export time.
    pub ended_at_ms: Option<i64>,
    /// Notes recorded during the session, imported as their own history events.
    pub notes: Vec<TsNoteExport>,
}

/// A single session note as exported from the legacy TypeScript Port Daddy.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TsNoteExport {
    /// Stable note id.
    pub id: String,
    /// The note text.
    pub body: String,
    /// When the note was written, Unix ms.
    pub created_at_ms: Option<i64>,
}

/// Tally of what a single `import_*` call ingested.
///
/// Returned by every importer method so the caller can confirm the counts match its input.
/// Implements `Default` (all zero), which the importers use as the starting accumulator and
/// which callers can use as an empty baseline.
///
/// ```
/// use pd_compat::ImportReport;
///
/// let empty = ImportReport::default();
/// assert_eq!(empty.actors_imported, 0);
/// assert_eq!(empty.sessions_imported, 0);
/// assert_eq!(empty.notes_imported, 0);
/// ```
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportReport {
    /// Number of actor records appended.
    pub actors_imported: usize,
    /// Number of session records appended.
    pub sessions_imported: usize,
    /// Number of note records appended (across all imported sessions).
    pub notes_imported: usize,
}

/// Replays legacy TypeScript exports into a borrowed Rust [`EventStore`] as history events.
///
/// It borrows the store (`&'store EventStore`) rather than owning it: the importer is a
/// short-lived tool you point at an existing kernel log, not something that manages storage
/// lifetime. Construct one with [`CompatImporter::new`], then call the `import_*` methods.
pub struct CompatImporter<'store> {
    store: &'store EventStore,
}

impl<'store> CompatImporter<'store> {
    /// Wrap a borrowed [`EventStore`] so exports can be replayed into it.
    ///
    /// A runnable example that opens an in-memory store and imports a session lives in this
    /// crate's `tests` module (`imports_ts_sessions_as_history_events`); constructing an
    /// `EventStore` pulls in the `pd-eventlog` dependency, which a doctest cannot reach.
    pub fn new(store: &'store EventStore) -> Self {
        Self { store }
    }

    /// Append each actor in `actors` to the event log as a `"compat.actor.imported"` event,
    /// keyed by the actor's id.
    ///
    /// # Errors
    /// Returns [`CompatError::EventLog`] if any append fails; on success the returned
    /// [`ImportReport`] has `actors_imported == actors.len()`.
    pub fn import_actors(&self, actors: &[TsActorExport]) -> Result<ImportReport, CompatError> {
        for actor in actors {
            self.store
                .append("compat.actor.imported", &actor.id, actor)?;
        }
        Ok(ImportReport {
            actors_imported: actors.len(),
            ..ImportReport::default()
        })
    }

    /// Append each session and its inline notes to the event log.
    ///
    /// Every session becomes a `"compat.session.imported"` event keyed by session id, and
    /// each of its notes becomes a `"compat.session_note.imported"` event carrying both the
    /// session id and the note. The returned [`ImportReport`] counts sessions and notes
    /// separately so the caller can verify the full nested structure was ingested.
    ///
    /// # Errors
    /// Returns [`CompatError::EventLog`] if any append fails. Because appends happen in order,
    /// a mid-list failure means earlier records are already persisted — the report is only
    /// returned on full success.
    pub fn import_sessions(
        &self,
        sessions: &[TsSessionExport],
    ) -> Result<ImportReport, CompatError> {
        let mut report = ImportReport::default();
        for session in sessions {
            self.store
                .append("compat.session.imported", &session.id, session)?;
            report.sessions_imported += 1;
            for note in &session.notes {
                self.store.append(
                    "compat.session_note.imported",
                    &session.id,
                    serde_json::json!({
                        "session_id": session.id,
                        "note": note,
                    }),
                )?;
                report.notes_imported += 1;
            }
        }
        Ok(report)
    }
}

/// Failure modes of the compat bridge.
#[derive(Debug, Error)]
pub enum CompatError {
    /// Sentinel for the intentionally-closed door: this bridge is import/history only, and a
    /// two-way mutation bridge is unsupported on purpose (see the module docs). It exists to
    /// give that boundary a name a caller can match on rather than being an undocumented gap.
    #[error("compat imports are read-only; mutation bridges are intentionally unsupported")]
    MutationBridgeUnsupported,
    /// An underlying event-log append failed; transparently wraps the `pd-eventlog` error.
    #[error(transparent)]
    EventLog(#[from] EventLogError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use pd_eventlog::EventStore;

    #[test]
    fn imports_ts_sessions_as_history_events() {
        let store = EventStore::open_in_memory().unwrap();
        let importer = CompatImporter::new(&store);
        let report = importer
            .import_sessions(&[TsSessionExport {
                id: "session-a".to_owned(),
                identity: "port-daddy:agent".to_owned(),
                purpose: "old work".to_owned(),
                worktree: Some("/tmp/port-daddy".to_owned()),
                started_at_ms: Some(1),
                ended_at_ms: None,
                notes: vec![TsNoteExport {
                    id: "note-a".to_owned(),
                    body: "historical note".to_owned(),
                    created_at_ms: Some(2),
                }],
            }])
            .unwrap();

        let events = store.load_all().unwrap();
        let projection = store.projection().unwrap();

        assert_eq!(report.sessions_imported, 1);
        assert_eq!(report.notes_imported, 1);
        assert_eq!(events.len(), 2);
        assert!(projection.transactions.contains("session-a"));
    }
}
