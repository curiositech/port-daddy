use pd_eventlog::{EventLogError, EventStore};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TsActorExport {
    pub id: String,
    pub label: String,
    pub identity: Option<String>,
    pub telos: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TsSessionExport {
    pub id: String,
    pub identity: String,
    pub purpose: String,
    pub worktree: Option<String>,
    pub started_at_ms: Option<i64>,
    pub ended_at_ms: Option<i64>,
    pub notes: Vec<TsNoteExport>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TsNoteExport {
    pub id: String,
    pub body: String,
    pub created_at_ms: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportReport {
    pub actors_imported: usize,
    pub sessions_imported: usize,
    pub notes_imported: usize,
}

pub struct CompatImporter<'store> {
    store: &'store EventStore,
}

impl<'store> CompatImporter<'store> {
    pub fn new(store: &'store EventStore) -> Self {
        Self { store }
    }

    /// Import a batch of TypeScript actor exports as append-only history events.
    ///
    /// The underlying event store is append-only: it has no cross-append
    /// transaction, so a failure partway through a batch leaves the events written
    /// before it already persisted. Rather than hide that behind an opaque error
    /// (which would leave the caller unable to tell what, if anything, was
    /// written), this reports partial progress explicitly: on failure it returns
    /// [`CompatError::PartialImport`] carrying the [`ImportReport`] of everything
    /// that *did* persist before the failing append, so a caller can reconcile or
    /// resume instead of guessing. On full success it returns the complete report.
    pub fn import_actors(&self, actors: &[TsActorExport]) -> Result<ImportReport, CompatError> {
        let mut report = ImportReport::default();
        for actor in actors {
            self.store
                .append("compat.actor.imported", &actor.id, actor)
                .map_err(|source| CompatError::PartialImport {
                    imported: report.clone(),
                    source,
                })?;
            report.actors_imported += 1;
        }
        Ok(report)
    }

    /// Import a batch of TypeScript session exports (and their notes) as
    /// append-only history events.
    ///
    /// Same partial-progress contract as [`Self::import_actors`]: the event store
    /// cannot roll back already-appended events, so on a mid-batch failure this
    /// returns [`CompatError::PartialImport`] with an [`ImportReport`] counting
    /// exactly the sessions and notes that persisted before the failing append.
    /// The report is never silently dropped on the error path — a caller that sees
    /// an error still learns precisely what was written.
    pub fn import_sessions(
        &self,
        sessions: &[TsSessionExport],
    ) -> Result<ImportReport, CompatError> {
        let mut report = ImportReport::default();
        for session in sessions {
            self.store
                .append("compat.session.imported", &session.id, session)
                .map_err(|source| CompatError::PartialImport {
                    imported: report.clone(),
                    source,
                })?;
            report.sessions_imported += 1;
            for note in &session.notes {
                self.store
                    .append(
                        "compat.session_note.imported",
                        &session.id,
                        serde_json::json!({
                            "session_id": session.id,
                            "note": note,
                        }),
                    )
                    .map_err(|source| CompatError::PartialImport {
                        imported: report.clone(),
                        source,
                    })?;
                report.notes_imported += 1;
            }
        }
        Ok(report)
    }
}

#[derive(Debug, Error)]
pub enum CompatError {
    #[error("compat imports are read-only; mutation bridges are intentionally unsupported")]
    MutationBridgeUnsupported,
    /// An append failed partway through a batch import. The append-only event
    /// store cannot roll back the events already written, so `imported` reports
    /// exactly what persisted before the failure. This makes partial success an
    /// explicit, machine-readable outcome instead of inconsistent state hidden
    /// behind an opaque error — the caller can reconcile against `imported`
    /// (e.g. skip the already-written prefix on retry) rather than guess.
    #[error("partial import: {imported:?} persisted before append failed: {source}")]
    PartialImport {
        imported: ImportReport,
        #[source]
        source: EventLogError,
    },
    #[error(transparent)]
    EventLog(#[from] EventLogError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use pd_eventlog::EventStore;
    use rusqlite::Connection;
    use tempfile::tempdir;

    fn session(id: &str, note_ids: &[&str]) -> TsSessionExport {
        TsSessionExport {
            id: id.to_owned(),
            identity: "port-daddy:agent".to_owned(),
            purpose: "old work".to_owned(),
            worktree: Some("~/coding/port-daddy".to_owned()),
            started_at_ms: Some(1),
            ended_at_ms: None,
            notes: note_ids
                .iter()
                .map(|n| TsNoteExport {
                    id: (*n).to_owned(),
                    body: "historical note".to_owned(),
                    created_at_ms: Some(2),
                })
                .collect(),
        }
    }

    /// Install a `BEFORE INSERT` trigger, via a *second* connection to the same
    /// on-disk DB, that aborts any append whose `subject` equals `fail_subject`.
    /// This injects a deterministic mid-batch append failure keyed on the failing
    /// record's data (not on timing), so the partial-import contract can be
    /// exercised end-to-end against the real event store.
    fn install_abort_trigger(db_path: &std::path::Path, fail_subject: &str) {
        let raw = Connection::open(db_path).unwrap();
        raw.execute_batch(&format!(
            "CREATE TRIGGER fail_on_subject BEFORE INSERT ON kernel_events \
             WHEN NEW.subject = '{fail_subject}' \
             BEGIN SELECT RAISE(ABORT, 'injected append failure'); END;"
        ))
        .unwrap();
    }

    #[test]
    fn imports_ts_sessions_as_history_events() {
        let store = EventStore::open_in_memory().unwrap();
        let importer = CompatImporter::new(&store);
        let report = importer
            .import_sessions(&[session("session-a", &["note-a"])])
            .unwrap();

        let events = store.load_all().unwrap();
        let projection = store.projection().unwrap();

        assert_eq!(report.sessions_imported, 1);
        assert_eq!(report.notes_imported, 1);
        assert_eq!(events.len(), 2);
        assert!(projection.transactions.contains("session-a"));
    }

    #[test]
    fn import_sessions_full_success_reports_all_counts() {
        let store = EventStore::open_in_memory().unwrap();
        let importer = CompatImporter::new(&store);
        let report = importer
            .import_sessions(&[
                session("session-a", &["note-a1", "note-a2"]),
                session("session-b", &["note-b1"]),
            ])
            .unwrap();

        assert_eq!(report.sessions_imported, 2);
        assert_eq!(report.notes_imported, 3);
        assert_eq!(report.actors_imported, 0);
        assert_eq!(store.load_all().unwrap().len(), 5);
    }

    #[test]
    fn import_sessions_partial_failure_reports_persisted_prefix() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("compat.db");
        let store = EventStore::open(&db_path).unwrap();

        // The second session's append will abort; the first session and its note
        // are already committed by then.
        install_abort_trigger(&db_path, "session-b");

        let importer = CompatImporter::new(&store);
        let err = importer
            .import_sessions(&[
                session("session-a", &["note-a"]),
                session("session-b", &["note-b"]),
            ])
            .expect_err("mid-batch append failure must surface as an error");

        match err {
            CompatError::PartialImport { imported, .. } => {
                // Exactly the prefix that persisted before the failing append.
                assert_eq!(imported.sessions_imported, 1);
                assert_eq!(imported.notes_imported, 1);
                assert_eq!(imported.actors_imported, 0);
            }
            other => panic!("expected PartialImport, got {other:?}"),
        }

        // And the store's real state matches the report: session-a + its note
        // persisted, nothing from session-b.
        let projection = store.projection().unwrap();
        assert!(projection.transactions.contains("session-a"));
        assert!(!projection.transactions.contains("session-b"));
        assert_eq!(store.load_all().unwrap().len(), 2);
    }

    #[test]
    fn import_actors_full_success_counts() {
        let store = EventStore::open_in_memory().unwrap();
        let importer = CompatImporter::new(&store);
        let report = importer
            .import_actors(&[
                TsActorExport {
                    id: "actor-a".to_owned(),
                    label: "A".to_owned(),
                    identity: None,
                    telos: None,
                },
                TsActorExport {
                    id: "actor-b".to_owned(),
                    label: "B".to_owned(),
                    identity: None,
                    telos: None,
                },
            ])
            .unwrap();
        assert_eq!(report.actors_imported, 2);
    }

    #[test]
    fn import_actors_partial_failure_reports_persisted_prefix() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("compat.db");
        let store = EventStore::open(&db_path).unwrap();
        install_abort_trigger(&db_path, "actor-b");

        let importer = CompatImporter::new(&store);
        let err = importer
            .import_actors(&[
                TsActorExport {
                    id: "actor-a".to_owned(),
                    label: "A".to_owned(),
                    identity: None,
                    telos: None,
                },
                TsActorExport {
                    id: "actor-b".to_owned(),
                    label: "B".to_owned(),
                    identity: None,
                    telos: None,
                },
            ])
            .expect_err("mid-batch append failure must surface as an error");

        match err {
            CompatError::PartialImport { imported, .. } => {
                assert_eq!(imported.actors_imported, 1);
            }
            other => panic!("expected PartialImport, got {other:?}"),
        }
        assert_eq!(store.load_all().unwrap().len(), 1);
    }
}
