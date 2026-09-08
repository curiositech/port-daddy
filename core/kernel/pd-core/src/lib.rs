use serde::{Deserialize, Serialize};
use std::fmt::{Display, Formatter};
use thiserror::Error;
use time::OffsetDateTime;

macro_rules! id_type {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }
        }

        impl Display for $name {
            fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
                f.write_str(&self.0)
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self(value.to_owned())
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self(value)
            }
        }
    };
}

id_type!(ActorId);
id_type!(TransactionId);
id_type!(JobId);
id_type!(RoomId);
id_type!(ObligationId);
id_type!(EvidenceId);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Actor {
    pub id: ActorId,
    pub label: String,
    pub telos: String,
    pub capabilities: Vec<String>,
}

impl Actor {
    pub fn new(id: impl Into<ActorId>, label: impl Into<String>, telos: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            telos: telos.into(),
            capabilities: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityEnvelope {
    pub subject: String,
    pub capabilities: Vec<String>,
    pub issued_at_ms: i64,
    pub expires_at_ms: i64,
    pub provenance: Provenance,
}

impl CapabilityEnvelope {
    pub fn kernel_local(subject: impl Into<String>, capabilities: Vec<String>) -> Self {
        let issued_at_ms = now_ms();
        Self {
            subject: subject.into(),
            capabilities,
            issued_at_ms,
            expires_at_ms: issued_at_ms + 3_600_000,
            provenance: Provenance::kernel("local"),
        }
    }

    pub fn is_expired_at(&self, at_ms: i64) -> bool {
        self.expires_at_ms <= at_ms
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Provenance {
    pub source: String,
    pub observed_by: Option<ActorId>,
    pub recorded_at_ms: i64,
}

impl Provenance {
    pub fn kernel(source: impl Into<String>) -> Self {
        Self {
            source: source.into(),
            observed_by: None,
            recorded_at_ms: now_ms(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClaimMode {
    Read,
    Write,
    Exclusive,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Claim {
    pub path: String,
    pub symbol_path: Option<String>,
    pub start_line: Option<u32>,
    pub end_line: Option<u32>,
    pub mode: ClaimMode,
}

impl Claim {
    pub fn file_write(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            symbol_path: None,
            start_line: None,
            end_line: None,
            mode: ClaimMode::Write,
        }
    }

    pub fn symbol_write(path: impl Into<String>, symbol_path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            symbol_path: Some(symbol_path.into()),
            start_line: None,
            end_line: None,
            mode: ClaimMode::Write,
        }
    }
}

pub fn claims_conflict(left: &Claim, right: &Claim) -> bool {
    if left.path != right.path {
        return false;
    }
    if left.mode == ClaimMode::Read && right.mode == ClaimMode::Read {
        return false;
    }
    if let (Some(left_symbol), Some(right_symbol)) = (&left.symbol_path, &right.symbol_path) {
        return left_symbol == right_symbol;
    }
    if let (Some(left_range), Some(right_range)) = (claim_range(left), claim_range(right)) {
        return ranges_overlap(left_range, right_range);
    }
    true
}

fn claim_range(claim: &Claim) -> Option<(u32, u32)> {
    Some((claim.start_line?, claim.end_line?))
}

fn ranges_overlap(left: (u32, u32), right: (u32, u32)) -> bool {
    left.0 <= right.1 && right.0 <= left.1
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransactionSource {
    Operator,
    Roadmap,
    Agent,
    CompatImport,
    MeshPeer,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransactionState {
    Proposed,
    Ready,
    Running,
    Blocked,
    Review,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum MutationKind {
    ReadOnly,
    LocalMutating,
    Destructive,
    Network,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ObligationKind {
    HumanAcknowledgement,
    Review,
    Credential,
    ClaimConflict,
    BackendReadiness,
    MeshTrust,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ObligationStatus {
    Pending,
    Acknowledged,
    Deferred,
    Rejected,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Obligation {
    pub id: ObligationId,
    pub kind: ObligationKind,
    pub severity: Severity,
    pub summary: String,
    pub status: ObligationStatus,
    pub created_at_ms: i64,
    pub resolved_at_ms: Option<i64>,
}

impl Obligation {
    pub fn pending(
        id: impl Into<ObligationId>,
        kind: ObligationKind,
        severity: Severity,
        summary: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            kind,
            severity,
            summary: summary.into(),
            status: ObligationStatus::Pending,
            created_at_ms: now_ms(),
            resolved_at_ms: None,
        }
    }

    pub fn is_blocking(&self) -> bool {
        self.status == ObligationStatus::Pending && self.severity >= Severity::High
    }

    pub fn acknowledge(&mut self) {
        self.status = ObligationStatus::Acknowledged;
        self.resolved_at_ms = Some(now_ms());
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum JobState {
    Queued,
    Leased,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Job {
    pub id: JobId,
    pub transaction_id: TransactionId,
    pub summary: String,
    pub mutation_kind: MutationKind,
    pub state: JobState,
    pub attempts: u32,
    pub leased_by: Option<ActorId>,
    pub lease_expires_at_ms: Option<i64>,
}

impl Job {
    pub fn new(
        id: impl Into<JobId>,
        transaction_id: impl Into<TransactionId>,
        summary: impl Into<String>,
        mutation_kind: MutationKind,
    ) -> Self {
        Self {
            id: id.into(),
            transaction_id: transaction_id.into(),
            summary: summary.into(),
            mutation_kind,
            state: JobState::Queued,
            attempts: 0,
            leased_by: None,
            lease_expires_at_ms: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Room {
    pub id: RoomId,
    pub topic: String,
    pub participants: Vec<ActorId>,
    pub scoped_transaction: Option<TransactionId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceRef {
    pub id: EvidenceId,
    pub kind: String,
    pub uri: String,
    pub digest: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Telemetry {
    pub backend_id: String,
    pub model_id: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub duration_ms: u64,
    pub cost_micros: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HumanGate {
    pub label: String,
    pub acknowledged_by: Option<ActorId>,
    pub acknowledged_at_ms: Option<i64>,
}

impl HumanGate {
    pub fn pending(label: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            acknowledged_by: None,
            acknowledged_at_ms: None,
        }
    }

    pub fn is_pending(&self) -> bool {
        self.acknowledged_by.is_none()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkResult {
    pub summary: String,
    pub evidence: Vec<EvidenceRef>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorkTransaction {
    pub id: TransactionId,
    pub intent: String,
    pub source: TransactionSource,
    pub actor: ActorId,
    pub state: TransactionState,
    pub capability_envelope: CapabilityEnvelope,
    pub worktree: Option<String>,
    pub claims: Vec<Claim>,
    pub jobs: Vec<Job>,
    pub rooms: Vec<RoomId>,
    pub obligations: Vec<Obligation>,
    pub evidence: Vec<EvidenceRef>,
    pub telemetry: Vec<Telemetry>,
    pub human_gates: Vec<HumanGate>,
    pub result: Option<WorkResult>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

impl WorkTransaction {
    pub fn new(
        id: impl Into<TransactionId>,
        intent: impl Into<String>,
        source: TransactionSource,
        actor: impl Into<ActorId>,
        capability_envelope: CapabilityEnvelope,
    ) -> Self {
        let now = now_ms();
        Self {
            id: id.into(),
            intent: intent.into(),
            source,
            actor: actor.into(),
            state: TransactionState::Proposed,
            capability_envelope,
            worktree: None,
            claims: Vec::new(),
            jobs: Vec::new(),
            rooms: Vec::new(),
            obligations: Vec::new(),
            evidence: Vec::new(),
            telemetry: Vec::new(),
            human_gates: Vec::new(),
            result: None,
            created_at_ms: now,
            updated_at_ms: now,
        }
    }

    pub fn add_obligation(&mut self, obligation: Obligation) {
        self.obligations.push(obligation);
        self.updated_at_ms = now_ms();
    }

    pub fn pending_obligations(&self) -> Vec<&Obligation> {
        self.obligations
            .iter()
            .filter(|obligation| obligation.status == ObligationStatus::Pending)
            .collect()
    }

    pub fn can_mutate(&self, mutation_kind: MutationKind) -> Result<(), CoreError> {
        if mutation_kind == MutationKind::ReadOnly {
            return Ok(());
        }

        if let Some(obligation) = self
            .obligations
            .iter()
            .find(|obligation| obligation.is_blocking())
        {
            return Err(CoreError::BlockingObligation {
                obligation_id: obligation.id.clone(),
                summary: obligation.summary.clone(),
            });
        }

        if let Some(gate) = self.human_gates.iter().find(|gate| gate.is_pending()) {
            return Err(CoreError::PendingHumanGate {
                label: gate.label.clone(),
            });
        }

        if self.capability_envelope.is_expired_at(now_ms()) {
            return Err(CoreError::CapabilityExpired);
        }

        Ok(())
    }

    pub fn transition(&mut self, next: TransactionState) -> Result<(), CoreError> {
        if !is_valid_transition(self.state, next) {
            return Err(CoreError::InvalidTransition {
                from: self.state,
                to: next,
            });
        }
        self.state = next;
        self.updated_at_ms = now_ms();
        Ok(())
    }

    pub fn complete(&mut self, result: WorkResult) -> Result<(), CoreError> {
        self.transition(TransactionState::Completed)?;
        self.result = Some(result);
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct KernelEvent {
    /// Stable identity of this event, **derived from `sequence`** (see
    /// [`KernelEvent::derive_id`]). It is a function of the ordering key rather than
    /// an independently minted value, so the in-memory event and the
    /// persisted/replayed record for the same logical event always agree.
    pub id: String,
    /// The authoritative, strictly-increasing position of this event in the total
    /// order. Assigned by the append-only log; `id` is derived from it.
    pub sequence: i64,
    pub event_type: String,
    pub subject: String,
    pub payload: serde_json::Value,
    pub provenance: Provenance,
    pub created_at_ms: i64,
}

impl KernelEvent {
    /// Derives an event's identity deterministically from its `sequence`.
    ///
    /// `sequence` is the authoritative, strictly-increasing ordering key handed out
    /// by the append-only log (`pd-eventlog`'s `sequence INTEGER PRIMARY KEY
    /// AUTOINCREMENT`). Because `id` is *derived from* that key rather than minted
    /// independently, the same logical event can never end up with two different
    /// ids depending on whether you hold the in-memory value or a replayed record.
    /// This is the single source of truth for event identity — both `KernelEvent`
    /// construction and the persistence layer route through it.
    ///
    /// # Examples
    ///
    /// ```
    /// use pd_core::KernelEvent;
    ///
    /// assert_eq!(KernelEvent::derive_id(7), "event-7");
    /// ```
    pub fn derive_id(sequence: i64) -> String {
        format!("event-{sequence}")
    }

    /// Builds an event whose `id` is derived deterministically from `sequence` via
    /// [`KernelEvent::derive_id`], stamped with the current timestamp.
    ///
    /// The caller supplies the `sequence` (the position in the total order), the
    /// `event_type`, `subject`, `payload`, and `provenance`; `id` and
    /// `created_at_ms` are filled in here. Constructing an event with the same
    /// `sequence` always yields the same `id`, matching what `pd-eventlog` persists
    /// and replays for that position.
    ///
    /// # Examples
    ///
    /// ```
    /// use pd_core::{KernelEvent, Provenance};
    /// use serde_json::json;
    ///
    /// let ev = KernelEvent::new(
    ///     1,
    ///     "transaction.created",
    ///     "tx-1",
    ///     json!({ "intent": "ship it" }),
    ///     Provenance::kernel("test"),
    /// );
    /// assert_eq!(ev.sequence, 1);
    /// assert_eq!(ev.id, "event-1"); // derived from sequence, not a random UUID
    /// ```
    pub fn new(
        sequence: i64,
        event_type: impl Into<String>,
        subject: impl Into<String>,
        payload: serde_json::Value,
        provenance: Provenance,
    ) -> Self {
        Self {
            id: Self::derive_id(sequence),
            sequence,
            event_type: event_type.into(),
            subject: subject.into(),
            payload,
            provenance,
            created_at_ms: now_ms(),
        }
    }
}

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("invalid transaction transition from {from:?} to {to:?}")]
    InvalidTransition {
        from: TransactionState,
        to: TransactionState,
    },
    #[error("blocking obligation {obligation_id}: {summary}")]
    BlockingObligation {
        obligation_id: ObligationId,
        summary: String,
    },
    #[error("pending human gate: {label}")]
    PendingHumanGate { label: String },
    #[error("capability envelope expired")]
    CapabilityExpired,
}

pub fn now_ms() -> i64 {
    (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

fn is_valid_transition(from: TransactionState, to: TransactionState) -> bool {
    use TransactionState::*;
    matches!(
        (from, to),
        (Proposed, Ready)
            | (Proposed, Cancelled)
            | (Ready, Running)
            | (Ready, Blocked)
            | (Ready, Cancelled)
            | (Blocked, Ready)
            | (Running, Review)
            | (Running, Failed)
            | (Running, Cancelled)
            | (Review, Completed)
            | (Review, Running)
            | (Review, Failed)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tx() -> WorkTransaction {
        WorkTransaction::new(
            "tx-1",
            "ship the kernel",
            TransactionSource::Operator,
            "agent-a",
            CapabilityEnvelope::kernel_local("agent-a", vec!["work:mutate".to_owned()]),
        )
    }

    #[test]
    fn high_obligations_block_mutating_work_until_acknowledged() {
        let mut tx = tx();
        let mut obligation = Obligation::pending(
            "ob-1",
            ObligationKind::HumanAcknowledgement,
            Severity::High,
            "operator must approve destructive edit",
        );

        tx.add_obligation(obligation.clone());
        assert!(tx.can_mutate(MutationKind::LocalMutating).is_err());
        assert!(tx.can_mutate(MutationKind::ReadOnly).is_ok());

        obligation.acknowledge();
        tx.obligations[0] = obligation;
        assert!(tx.can_mutate(MutationKind::LocalMutating).is_ok());
    }

    #[test]
    fn pending_human_gate_blocks_mutation() {
        let mut tx = tx();
        tx.human_gates.push(HumanGate::pending("launch approval"));

        let err = tx.can_mutate(MutationKind::Network).unwrap_err();
        assert!(matches!(err, CoreError::PendingHumanGate { .. }));
    }

    #[test]
    fn transaction_transitions_are_deterministic() {
        let mut tx = tx();

        assert!(tx.transition(TransactionState::Completed).is_err());
        tx.transition(TransactionState::Ready).unwrap();
        tx.transition(TransactionState::Running).unwrap();
        tx.transition(TransactionState::Review).unwrap();
        tx.complete(WorkResult {
            summary: "done".to_owned(),
            evidence: Vec::new(),
        })
        .unwrap();

        assert_eq!(tx.state, TransactionState::Completed);
        assert_eq!(tx.result.as_ref().unwrap().summary, "done");
    }

    #[test]
    fn kernel_event_id_is_derived_from_sequence_and_never_diverges() {
        // Two events built independently for the same sequence must carry the same
        // id (deterministic), and that id must match the persistence-layer format
        // `event-{sequence}` that pd-eventlog uses when it persists/replays.
        let a = KernelEvent::new(
            42,
            "transaction.created",
            "tx-1",
            serde_json::json!({}),
            Provenance::kernel("test"),
        );
        let b = KernelEvent::new(
            42,
            "transaction.created",
            "tx-1",
            serde_json::json!({}),
            Provenance::kernel("test"),
        );

        assert_eq!(a.id, b.id);
        assert_eq!(a.id, KernelEvent::derive_id(42));
        assert_eq!(a.id, "event-42");
    }

    #[test]
    fn claim_conflicts_respect_path_symbol_and_range() {
        assert!(!claims_conflict(
            &Claim::file_write("src/a.rs"),
            &Claim::file_write("src/b.rs")
        ));
        assert!(!claims_conflict(
            &Claim {
                path: "src/a.rs".to_owned(),
                symbol_path: None,
                start_line: None,
                end_line: None,
                mode: ClaimMode::Read,
            },
            &Claim {
                path: "src/a.rs".to_owned(),
                symbol_path: None,
                start_line: None,
                end_line: None,
                mode: ClaimMode::Read,
            }
        ));
        assert!(!claims_conflict(
            &Claim::symbol_write("src/a.rs", "alpha"),
            &Claim::symbol_write("src/a.rs", "beta")
        ));
        assert!(claims_conflict(
            &Claim::symbol_write("src/a.rs", "alpha"),
            &Claim::symbol_write("src/a.rs", "alpha")
        ));
        assert!(!claims_conflict(
            &Claim {
                path: "src/a.rs".to_owned(),
                symbol_path: None,
                start_line: Some(1),
                end_line: Some(5),
                mode: ClaimMode::Write,
            },
            &Claim {
                path: "src/a.rs".to_owned(),
                symbol_path: None,
                start_line: Some(6),
                end_line: Some(10),
                mode: ClaimMode::Write,
            }
        ));
    }
}
