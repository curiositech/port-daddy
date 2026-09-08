use pd_core::{
    now_ms, ActorId, EvidenceRef, Job, JobId, JobState, Obligation, RoomId, TransactionId,
    WorkTransaction,
};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum BackendReadiness {
    Ready,
    Blocked { reason: String },
    ManualCheck { reason: String },
}

impl BackendReadiness {
    pub fn is_launchable(&self) -> bool {
        matches!(self, Self::Ready)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackendCapacity {
    pub backend_id: String,
    pub model_id: String,
    pub readiness: BackendReadiness,
    pub max_parallel_jobs: u16,
    pub active_jobs: u16,
}

impl BackendCapacity {
    pub fn ready(
        backend_id: impl Into<String>,
        model_id: impl Into<String>,
        max_parallel_jobs: u16,
    ) -> Self {
        Self {
            backend_id: backend_id.into(),
            model_id: model_id.into(),
            readiness: BackendReadiness::Ready,
            max_parallel_jobs,
            active_jobs: 0,
        }
    }

    /// Builds a capacity line, enforcing the invariant `active_jobs <= max_parallel_jobs`.
    ///
    /// The type's core meaning is "a backend running `active_jobs` of at most
    /// `max_parallel_jobs`". Rather than leave that invariant to the caller, this
    /// constructor rejects an over-committed line with
    /// [`RuntimeError::CapacityExceeded`], consistent with the crate's fail-closed
    /// contract (fallible operations return an error; nothing silently clamps).
    ///
    /// # Examples
    ///
    /// ```
    /// use pd_runtime::{BackendCapacity, BackendReadiness};
    ///
    /// let ok = BackendCapacity::new("mock", "mid", BackendReadiness::Ready, 2, 1).unwrap();
    /// assert_eq!(ok.active_jobs, 1);
    ///
    /// // 3 active against a ceiling of 2 is not a valid capacity line.
    /// assert!(BackendCapacity::new("mock", "mid", BackendReadiness::Ready, 2, 3).is_err());
    /// ```
    pub fn new(
        backend_id: impl Into<String>,
        model_id: impl Into<String>,
        readiness: BackendReadiness,
        max_parallel_jobs: u16,
        active_jobs: u16,
    ) -> Result<Self, RuntimeError> {
        let backend_id = backend_id.into();
        if active_jobs > max_parallel_jobs {
            return Err(RuntimeError::CapacityExceeded {
                backend_id,
                requested: active_jobs,
                max: max_parallel_jobs,
            });
        }
        Ok(Self {
            backend_id,
            model_id: model_id.into(),
            readiness,
            max_parallel_jobs,
            active_jobs,
        })
    }

    /// Whether the backend can take on at least one more job right now.
    ///
    /// ```
    /// use pd_runtime::BackendCapacity;
    ///
    /// let cap = BackendCapacity::ready("mock", "mid", 1);
    /// assert!(cap.has_capacity());
    /// ```
    pub fn has_capacity(&self) -> bool {
        self.active_jobs < self.max_parallel_jobs
    }

    /// Sets `active_jobs`, enforcing `active_jobs <= max_parallel_jobs`.
    ///
    /// Returns [`RuntimeError::CapacityExceeded`] (leaving `active_jobs` unchanged)
    /// if the new value would breach the ceiling.
    ///
    /// ```
    /// use pd_runtime::BackendCapacity;
    ///
    /// let mut cap = BackendCapacity::ready("mock", "mid", 2);
    /// cap.set_active_jobs(2).unwrap();
    /// assert!(cap.set_active_jobs(3).is_err());
    /// assert_eq!(cap.active_jobs, 2); // rejected value did not take effect
    /// ```
    pub fn set_active_jobs(&mut self, active_jobs: u16) -> Result<(), RuntimeError> {
        if active_jobs > self.max_parallel_jobs {
            return Err(RuntimeError::CapacityExceeded {
                backend_id: self.backend_id.clone(),
                requested: active_jobs,
                max: self.max_parallel_jobs,
            });
        }
        self.active_jobs = active_jobs;
        Ok(())
    }

    /// Reserves one slot (`active_jobs += 1`), rejecting at the ceiling.
    ///
    /// ```
    /// use pd_runtime::BackendCapacity;
    ///
    /// let mut cap = BackendCapacity::ready("mock", "mid", 1);
    /// cap.reserve().unwrap();
    /// assert_eq!(cap.active_jobs, 1);
    /// assert!(cap.reserve().is_err()); // full — cannot exceed max_parallel_jobs
    /// cap.release();
    /// assert!(cap.has_capacity());
    /// ```
    pub fn reserve(&mut self) -> Result<(), RuntimeError> {
        self.set_active_jobs(self.active_jobs.saturating_add(1))
    }

    /// Releases one slot (`active_jobs -= 1`), saturating at zero so it can never
    /// underflow.
    pub fn release(&mut self) {
        self.active_jobs = self.active_jobs.saturating_sub(1);
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SimilarWorkNotice {
    pub transaction_id: TransactionId,
    pub summary: String,
    pub confidence_bps: u16,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentContextFrame {
    pub transaction_id: TransactionId,
    pub agent_id: ActorId,
    pub generated_at_ms: i64,
    pub rooms: Vec<RoomId>,
    pub obligations: Vec<Obligation>,
    pub similar_work: Vec<SimilarWorkNotice>,
    pub backend_capacity: Vec<BackendCapacity>,
    pub evidence: Vec<EvidenceRef>,
}

impl AgentContextFrame {
    pub fn to_prompt_block(&self) -> Result<String, RuntimeError> {
        Ok(format!(
            "BEGIN PD AGENT CONTEXT\n{}\nEND PD AGENT CONTEXT",
            serde_json::to_string_pretty(self)?
        ))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum LocalRequestKind {
    Status,
    AppendEvent,
    ListJobs,
    LeaseJob,
    ListRooms,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LocalRequestFrame {
    pub request_id: String,
    pub kind: LocalRequestKind,
    pub payload: serde_json::Value,
}

impl LocalRequestFrame {
    pub fn status(request_id: impl Into<String>) -> Self {
        Self {
            request_id: request_id.into(),
            kind: LocalRequestKind::Status,
            payload: serde_json::json!({}),
        }
    }

    pub fn encode_json(&self) -> Result<Vec<u8>, RuntimeError> {
        Ok(serde_json::to_vec(self)?)
    }

    pub fn decode_json(bytes: &[u8]) -> Result<Self, RuntimeError> {
        Ok(serde_json::from_slice(bytes)?)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LocalResponseFrame {
    pub request_id: String,
    pub ok: bool,
    pub payload: serde_json::Value,
    pub error: Option<String>,
}

impl LocalResponseFrame {
    pub fn ok(request_id: impl Into<String>, payload: serde_json::Value) -> Self {
        Self {
            request_id: request_id.into(),
            ok: true,
            payload,
            error: None,
        }
    }

    pub fn err(request_id: impl Into<String>, error: impl Into<String>) -> Self {
        Self {
            request_id: request_id.into(),
            ok: false,
            payload: serde_json::json!({}),
            error: Some(error.into()),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct ContextBroker {
    backend_capacity: Vec<BackendCapacity>,
    similar_work: Vec<SimilarWorkNotice>,
}

impl ContextBroker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_backend_capacity(mut self, capacity: Vec<BackendCapacity>) -> Self {
        self.backend_capacity = capacity;
        self
    }

    pub fn with_similar_work(mut self, similar_work: Vec<SimilarWorkNotice>) -> Self {
        self.similar_work = similar_work;
        self
    }

    pub fn compose(&self, transaction: &WorkTransaction, agent_id: ActorId) -> AgentContextFrame {
        AgentContextFrame {
            transaction_id: transaction.id.clone(),
            agent_id,
            generated_at_ms: now_ms(),
            rooms: transaction.rooms.clone(),
            obligations: transaction
                .obligations
                .iter()
                .filter(|obligation| obligation.is_blocking())
                .cloned()
                .collect(),
            similar_work: self.similar_work.clone(),
            backend_capacity: self.backend_capacity.clone(),
            evidence: transaction.evidence.clone(),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct JobQueue {
    jobs: VecDeque<Job>,
}

impl JobQueue {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, job: Job) {
        self.jobs.push_back(job);
    }

    pub fn lease(&mut self, actor_id: ActorId, now_ms: i64, lease_duration_ms: i64) -> Option<Job> {
        for job in &mut self.jobs {
            let lease_expired = job
                .lease_expires_at_ms
                .map(|expires| expires <= now_ms)
                .unwrap_or(false);
            if job.state == JobState::Queued || (job.state == JobState::Leased && lease_expired) {
                job.state = JobState::Leased;
                job.leased_by = Some(actor_id.clone());
                job.lease_expires_at_ms = Some(now_ms + lease_duration_ms);
                job.attempts += 1;
                return Some(job.clone());
            }
        }
        None
    }

    pub fn complete(&mut self, job_id: &JobId) -> Result<(), RuntimeError> {
        let job = self
            .jobs
            .iter_mut()
            .find(|job| &job.id == job_id)
            .ok_or_else(|| RuntimeError::JobNotFound(job_id.clone()))?;
        job.state = JobState::Completed;
        job.lease_expires_at_ms = None;
        Ok(())
    }

    pub fn snapshot(&self) -> Vec<Job> {
        self.jobs.iter().cloned().collect()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MockRun {
    pub backend_id: String,
    pub effective_prompt: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MockBackend {
    pub backend_id: String,
}

impl MockBackend {
    pub fn new(backend_id: impl Into<String>) -> Self {
        Self {
            backend_id: backend_id.into(),
        }
    }

    pub fn run(
        &self,
        frame: &AgentContextFrame,
        user_prompt: impl AsRef<str>,
    ) -> Result<MockRun, RuntimeError> {
        let context = frame.to_prompt_block()?;
        Ok(MockRun {
            backend_id: self.backend_id.clone(),
            effective_prompt: format!("{context}\n\n{}", user_prompt.as_ref()),
        })
    }
}

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("job not found: {0}")]
    JobNotFound(JobId),
    #[error("backend {backend_id} capacity exceeded: requested {requested} active job(s) but max_parallel_jobs is {max}")]
    CapacityExceeded {
        backend_id: String,
        requested: u16,
        max: u16,
    },
    #[error(transparent)]
    Serde(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;
    use pd_core::{
        CapabilityEnvelope, MutationKind, Obligation, ObligationKind, Severity, TransactionSource,
    };

    fn tx() -> WorkTransaction {
        WorkTransaction::new(
            "tx-1",
            "test runtime",
            TransactionSource::Operator,
            "agent-a",
            CapabilityEnvelope::kernel_local("agent-a", vec!["job:run".to_owned()]),
        )
    }

    #[test]
    fn broker_composes_blocking_obligations_into_context_frame() {
        let mut tx = tx();
        tx.rooms.push(RoomId::from("room-a"));
        tx.add_obligation(Obligation::pending(
            "ob-1",
            ObligationKind::Review,
            Severity::Critical,
            "review before mutation",
        ));
        let broker = ContextBroker::new()
            .with_backend_capacity(vec![BackendCapacity::ready("mock", "mid", 2)]);

        let frame = broker.compose(&tx, ActorId::from("agent-a"));

        assert_eq!(frame.transaction_id, TransactionId::from("tx-1"));
        assert_eq!(frame.obligations.len(), 1);
        assert_eq!(frame.rooms, vec![RoomId::from("room-a")]);
        assert!(frame.backend_capacity[0].readiness.is_launchable());
    }

    #[test]
    fn mock_backend_injects_context_frame_into_every_turn() {
        let tx = tx();
        let frame = ContextBroker::new().compose(&tx, ActorId::from("agent-a"));
        let backend = MockBackend::new("mock");

        let run = backend.run(&frame, "do the task").unwrap();

        assert!(run.effective_prompt.starts_with("BEGIN PD AGENT CONTEXT"));
        assert!(run
            .effective_prompt
            .contains("\"transaction_id\": \"tx-1\""));
        assert!(run.effective_prompt.ends_with("do the task"));
    }

    #[test]
    fn job_leases_expire_and_can_be_reissued() {
        let mut queue = JobQueue::new();
        queue.push(Job::new(
            "job-1",
            "tx-1",
            "mutate safely",
            MutationKind::LocalMutating,
        ));

        let first = queue.lease(ActorId::from("agent-a"), 1000, 100).unwrap();
        assert_eq!(first.leased_by, Some(ActorId::from("agent-a")));

        let second = queue.lease(ActorId::from("agent-b"), 1050, 100);
        assert!(second.is_none());

        let third = queue.lease(ActorId::from("agent-b"), 1200, 100).unwrap();
        assert_eq!(third.leased_by, Some(ActorId::from("agent-b")));
        assert_eq!(third.attempts, 2);
    }

    #[test]
    fn backend_capacity_enforces_active_jobs_ceiling() {
        // Constructor rejects an over-committed line.
        assert!(BackendCapacity::new("mock", "mid", BackendReadiness::Ready, 2, 3).is_err());
        let mut cap = BackendCapacity::new("mock", "mid", BackendReadiness::Ready, 2, 1).unwrap();
        assert_eq!(cap.active_jobs, 1);

        // Reserve up to the ceiling, then the boundary is enforced, not merely documented.
        assert!(cap.has_capacity());
        cap.reserve().unwrap();
        assert_eq!(cap.active_jobs, 2);
        assert!(!cap.has_capacity());

        let err = cap.reserve().unwrap_err();
        assert!(matches!(err, RuntimeError::CapacityExceeded { max: 2, requested: 3, .. }));
        assert_eq!(cap.active_jobs, 2, "rejected reserve must not mutate active_jobs");

        // A direct over-ceiling set is rejected and leaves state untouched.
        assert!(cap.set_active_jobs(5).is_err());
        assert_eq!(cap.active_jobs, 2);

        // Release frees a slot and saturates at zero.
        cap.release();
        assert_eq!(cap.active_jobs, 1);
        cap.release();
        cap.release();
        assert_eq!(cap.active_jobs, 0);
    }

    #[test]
    fn local_request_frames_round_trip_as_typed_json() {
        let request = LocalRequestFrame::status("req-1");
        let encoded = request.encode_json().unwrap();
        let decoded = LocalRequestFrame::decode_json(&encoded).unwrap();

        assert_eq!(decoded.request_id, "req-1");
        assert_eq!(decoded.kind, LocalRequestKind::Status);
    }
}
