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

#[derive(Debug, Error)]
pub enum CompatError {
    #[error("compat imports are read-only; mutation bridges are intentionally unsupported")]
    MutationBridgeUnsupported,
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
