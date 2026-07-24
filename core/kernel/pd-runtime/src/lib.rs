//! Runtime primitives that turn kernel state into agent-executable work.
//!
//! # What this crate is
//!
//! Where [`pd_core`] defines the *nouns* of the kernel (transactions, jobs,
//! obligations, capabilities) and [`pd_eventlog`](../pd_eventlog/index.html) makes
//! those nouns durable, this crate provides the thin execution layer that sits
//! between them and a real agent backend. It answers two operational questions:
//!
//! 1. **"What should the agent know before it acts?"** — the [`ContextBroker`]
//!    distills a [`WorkTransaction`] into an [`AgentContextFrame`]: the rooms it
//!    touches, the *blocking* obligations it must respect, nearby similar work, and
//!    which backends have spare capacity. That frame renders into a prompt block
//!    that is injected into every turn.
//! 2. **"Who runs the next unit of work?"** — the [`JobQueue`] hands out
//!    time-limited *leases* on queued jobs so that exactly one actor owns a job at a
//!    time, while a crashed actor's lease can safely expire and be re-issued.
//!
//! It also defines the small typed wire protocol ([`LocalRequestFrame`] /
//! [`LocalResponseFrame`]) that a local client uses to talk to the daemon, and a
//! [`MockBackend`] that exercises the context-injection path without any network or
//! model call — useful in tests and as a reference for real backends.
//!
//! # Why leases instead of locks
//!
//! A naive "assign job to agent" scheme deadlocks the moment an agent dies holding
//! an assignment: the job is owned forever by a process that will never finish it.
//! A **lease** is an assignment with an expiry. The owning actor is expected to
//! finish (or renew) before the lease lapses; if it doesn't — because it crashed,
//! hung, or lost its network — the lease simply expires and [`JobQueue::lease`] will
//! hand the job to the next asker. This is the same self-healing pattern used by
//! DHCP address leases and distributed lock services: liveness is preserved without
//! a central failure detector, at the cost of possibly running a job twice if the
//! original owner was merely slow (so jobs should be idempotent).
//!
//! # Why inject context every turn
//!
//! Agents are stateless between turns and will happily mutate past a governance
//! boundary they cannot see. Re-deriving and re-injecting the
//! [`AgentContextFrame`] on every turn keeps the agent's view of its obligations
//! and environment fresh, so a blocking obligation added mid-task is visible on the
//! very next turn rather than after the agent has already acted.
//!
//! # Failure contract at a glance
//!
//! Nothing here performs blocking I/O, and no method panics on a well-formed call.
//! The two fallible operations —
//! [`ContextBroker`]/[`AgentContextFrame`] serialization and
//! [`JobQueue::complete`] on an unknown job — return [`RuntimeError`]. A
//! [`JobQueue::lease`] with no eligible job returns `None`, not an error, because
//! "nothing to do right now" is a normal outcome.

use pd_core::{
    now_ms, ActorId, EvidenceRef, Job, JobId, JobState, Obligation, RoomId, TransactionId,
    WorkTransaction,
};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use thiserror::Error;

/// Whether a backend is currently allowed to launch new work, and if not, why.
///
/// This is the readiness verdict a scheduler consults before dispatching a job to a
/// backend. It deliberately distinguishes two kinds of "not ready": [`Blocked`] is a
/// machine-decided refusal (quota exhausted, model offline), whereas [`ManualCheck`]
/// signals that a human must look before this backend is trusted to run. Only
/// [`Ready`] is launchable; see [`is_launchable`](BackendReadiness::is_launchable).
///
/// [`Ready`]: BackendReadiness::Ready
/// [`Blocked`]: BackendReadiness::Blocked
/// [`ManualCheck`]: BackendReadiness::ManualCheck
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum BackendReadiness {
    /// The backend may launch work now.
    Ready,
    /// The backend refuses work for a machine-determined reason (e.g. no capacity).
    Blocked {
        /// Human-readable explanation, surfaced to operators.
        reason: String,
    },
    /// The backend needs a human decision before it can be trusted to launch work.
    ManualCheck {
        /// Human-readable explanation of what needs checking.
        reason: String,
    },
}

impl BackendReadiness {
    /// Returns `true` only when the backend is [`Ready`](BackendReadiness::Ready).
    ///
    /// This is the single predicate a scheduler should gate dispatch on, so that
    /// adding a new not-ready variant in the future cannot accidentally be treated
    /// as launchable.
    ///
    /// ```
    /// use pd_runtime::BackendReadiness;
    ///
    /// assert!(BackendReadiness::Ready.is_launchable());
    /// assert!(!BackendReadiness::Blocked { reason: "quota".into() }.is_launchable());
    /// ```
    pub fn is_launchable(&self) -> bool {
        matches!(self, Self::Ready)
    }
}

/// A snapshot of one backend's identity, readiness, and current load.
///
/// Carried inside an [`AgentContextFrame`] so an agent (or the scheduler composing
/// the frame) can reason about where work can go. `active_jobs` versus
/// `max_parallel_jobs` gives the spare capacity; `readiness` gives the hard
/// go/no-go. The fields are plain data — nothing here enforces that `active_jobs <=
/// max_parallel_jobs`; that invariant is the scheduler's to maintain.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackendCapacity {
    /// Stable identifier of the backend (e.g. `"anthropic"`, `"mock"`).
    pub backend_id: String,
    /// The model this capacity line refers to (e.g. `"opus"`, `"sonnet"`).
    pub model_id: String,
    /// Whether this backend may launch work right now.
    pub readiness: BackendReadiness,
    /// The most jobs this backend will run concurrently.
    pub max_parallel_jobs: u16,
    /// How many jobs it is running at this moment.
    pub active_jobs: u16,
}

impl BackendCapacity {
    /// Builds a [`Ready`](BackendReadiness::Ready) capacity line with zero active jobs.
    ///
    /// A convenience for the common "this backend is up and idle" case. The
    /// `impl Into<String>` arguments let you pass `&str` or `String` interchangeably.
    ///
    /// ```
    /// use pd_runtime::BackendCapacity;
    ///
    /// let cap = BackendCapacity::ready("anthropic", "opus", 4);
    /// assert_eq!(cap.max_parallel_jobs, 4);
    /// assert_eq!(cap.active_jobs, 0);
    /// assert!(cap.readiness.is_launchable());
    /// ```
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
}

/// A pointer to prior work that resembles the current transaction.
///
/// Surfaced to an agent so it can notice "someone already did something like this"
/// and avoid duplicating effort or conflicting with in-flight work. `confidence_bps`
/// is expressed in **basis points** (1 bp = 0.01%), so a value of `9000` means 90%
/// confidence — an integer representation that keeps the type `Eq`-comparable and
/// serialization-stable, unlike a float.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SimilarWorkNotice {
    /// The transaction judged similar to the current one.
    pub transaction_id: TransactionId,
    /// Short human-readable description of the similar work.
    pub summary: String,
    /// Similarity confidence in basis points (0–10000; 10000 = 100%).
    pub confidence_bps: u16,
}

/// The full briefing packet handed to an agent for one transaction.
///
/// This is what [`ContextBroker::compose`] produces and what
/// [`to_prompt_block`](AgentContextFrame::to_prompt_block) renders into the prompt.
/// It is a *derived snapshot*: everything in it was copied out of a
/// [`WorkTransaction`] and the broker's ambient knowledge at `generated_at_ms`, so a
/// frame is a point-in-time view, not a live handle. Notably, `obligations` holds
/// only the *blocking* ones (see [`ContextBroker::compose`]) — the agent is told
/// what would stop a mutation, not every housekeeping note.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentContextFrame {
    /// The transaction this frame briefs.
    pub transaction_id: TransactionId,
    /// The agent the frame is addressed to.
    pub agent_id: ActorId,
    /// Wall-clock time (ms since epoch) the frame was composed.
    pub generated_at_ms: i64,
    /// Rooms the transaction participates in.
    pub rooms: Vec<RoomId>,
    /// Only the *blocking* obligations — the ones that would gate a mutation.
    pub obligations: Vec<Obligation>,
    /// Nearby prior work the agent should be aware of.
    pub similar_work: Vec<SimilarWorkNotice>,
    /// Where work can currently be dispatched, and how much headroom each backend has.
    pub backend_capacity: Vec<BackendCapacity>,
    /// Evidence references carried by the transaction.
    pub evidence: Vec<EvidenceRef>,
}

impl AgentContextFrame {
    /// Renders the frame into a delimited prompt block for injection into a turn.
    ///
    /// The output is the frame's pretty-printed JSON fenced between
    /// `BEGIN PD AGENT CONTEXT` and `END PD AGENT CONTEXT` sentinel lines, so a
    /// backend can reliably locate and, if desired, strip the block. The sentinels
    /// are fixed strings and are part of this method's contract — a real backend
    /// (and [`MockBackend`]) prepends this block to the operator's prompt.
    ///
    /// # Errors
    ///
    /// Returns [`RuntimeError::Serde`] if the frame cannot be serialized to JSON,
    /// which in practice only happens if a contained value has a non-serializable
    /// shape.
    ///
    /// ```
    /// use pd_runtime::{AgentContextFrame, ContextBroker};
    /// use pd_core::{ActorId, CapabilityEnvelope, TransactionSource, WorkTransaction};
    ///
    /// let tx = WorkTransaction::new(
    ///     "tx-1", "demo", TransactionSource::Operator, "agent-a",
    ///     CapabilityEnvelope::kernel_local("agent-a", vec!["job:run".into()]),
    /// );
    /// let frame = ContextBroker::new().compose(&tx, ActorId::from("agent-a"));
    ///
    /// let block = frame.to_prompt_block().unwrap();
    /// assert!(block.starts_with("BEGIN PD AGENT CONTEXT"));
    /// assert!(block.ends_with("END PD AGENT CONTEXT"));
    /// ```
    pub fn to_prompt_block(&self) -> Result<String, RuntimeError> {
        Ok(format!(
            "BEGIN PD AGENT CONTEXT\n{}\nEND PD AGENT CONTEXT",
            serde_json::to_string_pretty(self)?
        ))
    }
}

/// The kind of local request a client is making to the daemon over the wire.
///
/// Tagging the request with an enum (rather than switching on a free-form string)
/// keeps the local protocol closed and typo-proof: only these five operations are
/// expressible, and adding one is a deliberate change to this enum.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum LocalRequestKind {
    /// Ask for daemon/kernel status.
    Status,
    /// Append an event to the log.
    AppendEvent,
    /// List known jobs.
    ListJobs,
    /// Lease the next available job.
    LeaseJob,
    /// List known rooms.
    ListRooms,
}

/// A single request on the local client↔daemon protocol.
///
/// `request_id` is echoed back in the matching [`LocalResponseFrame`] so a client
/// can correlate responses to requests over a multiplexed connection. `payload`
/// carries operation-specific arguments as free-form JSON, kept untyped here so the
/// frame envelope stays stable while individual operations evolve.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LocalRequestFrame {
    /// Caller-chosen id, echoed in the response for correlation.
    pub request_id: String,
    /// Which operation is being requested.
    pub kind: LocalRequestKind,
    /// Operation-specific arguments; `{}` when the operation takes none.
    pub payload: serde_json::Value,
}

impl LocalRequestFrame {
    /// Builds a [`Status`](LocalRequestKind::Status) request with an empty payload.
    ///
    /// A convenience for the most common request; other kinds are constructed with a
    /// struct literal since they carry a meaningful `payload`.
    ///
    /// ```
    /// use pd_runtime::{LocalRequestFrame, LocalRequestKind};
    ///
    /// let req = LocalRequestFrame::status("req-1");
    /// assert_eq!(req.kind, LocalRequestKind::Status);
    /// assert_eq!(req.payload, serde_json::json!({}));
    /// ```
    pub fn status(request_id: impl Into<String>) -> Self {
        Self {
            request_id: request_id.into(),
            kind: LocalRequestKind::Status,
            payload: serde_json::json!({}),
        }
    }

    /// Serializes the frame to a JSON byte buffer for transmission.
    ///
    /// Pairs with [`decode_json`](LocalRequestFrame::decode_json); the two round-trip
    /// losslessly.
    ///
    /// # Errors
    ///
    /// Returns [`RuntimeError::Serde`] if serialization fails.
    ///
    /// ```
    /// use pd_runtime::LocalRequestFrame;
    ///
    /// let bytes = LocalRequestFrame::status("req-1").encode_json().unwrap();
    /// let decoded = LocalRequestFrame::decode_json(&bytes).unwrap();
    /// assert_eq!(decoded.request_id, "req-1");
    /// ```
    pub fn encode_json(&self) -> Result<Vec<u8>, RuntimeError> {
        Ok(serde_json::to_vec(self)?)
    }

    /// Parses a frame from a JSON byte buffer received off the wire.
    ///
    /// The inverse of [`encode_json`](LocalRequestFrame::encode_json).
    ///
    /// # Errors
    ///
    /// Returns [`RuntimeError::Serde`] if `bytes` is not valid JSON for this frame
    /// shape — meaning the caller received a malformed or mistyped request.
    pub fn decode_json(bytes: &[u8]) -> Result<Self, RuntimeError> {
        Ok(serde_json::from_slice(bytes)?)
    }
}

/// A single response on the local client↔daemon protocol.
///
/// The `ok` flag plus the `error` option form a small result envelope: on success
/// `ok` is `true`, `payload` carries the result, and `error` is `None`; on failure
/// `ok` is `false`, `payload` is `{}`, and `error` holds a message. Use the
/// [`ok`](LocalResponseFrame::ok) / [`err`](LocalResponseFrame::err) constructors
/// rather than building the struct by hand, so these two states stay consistent.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LocalResponseFrame {
    /// The `request_id` this response answers.
    pub request_id: String,
    /// `true` on success, `false` on failure.
    pub ok: bool,
    /// The result on success, or `{}` on failure.
    pub payload: serde_json::Value,
    /// The error message on failure, or `None` on success.
    pub error: Option<String>,
}

impl LocalResponseFrame {
    /// Builds a success response carrying `payload`.
    ///
    /// ```
    /// use pd_runtime::LocalResponseFrame;
    ///
    /// let res = LocalResponseFrame::ok("req-1", serde_json::json!({ "status": "up" }));
    /// assert!(res.ok);
    /// assert!(res.error.is_none());
    /// ```
    pub fn ok(request_id: impl Into<String>, payload: serde_json::Value) -> Self {
        Self {
            request_id: request_id.into(),
            ok: true,
            payload,
            error: None,
        }
    }

    /// Builds a failure response carrying an error message and an empty payload.
    ///
    /// ```
    /// use pd_runtime::LocalResponseFrame;
    ///
    /// let res = LocalResponseFrame::err("req-1", "job not found");
    /// assert!(!res.ok);
    /// assert_eq!(res.error.as_deref(), Some("job not found"));
    /// assert_eq!(res.payload, serde_json::json!({}));
    /// ```
    pub fn err(request_id: impl Into<String>, error: impl Into<String>) -> Self {
        Self {
            request_id: request_id.into(),
            ok: false,
            payload: serde_json::json!({}),
            error: Some(error.into()),
        }
    }
}

/// Assembles per-transaction [`AgentContextFrame`]s from ambient runtime knowledge.
///
/// The broker holds the environment-level facts an individual transaction does not
/// know about itself — currently the set of backends and their capacity, and any
/// similar-work notices — and folds them together with a transaction's own state to
/// produce the frame injected into an agent's turn. It is built with a fluent
/// `with_*` builder so a caller can attach only the context it has.
///
/// The broker is cheap to clone and holds no I/O handles; compose as often as you
/// like (ideally once per turn, so the frame stays fresh).
#[derive(Clone, Debug, Default)]
pub struct ContextBroker {
    backend_capacity: Vec<BackendCapacity>,
    similar_work: Vec<SimilarWorkNotice>,
}

impl ContextBroker {
    /// Creates an empty broker with no backend capacity and no similar-work notices.
    ///
    /// ```
    /// use pd_runtime::ContextBroker;
    /// let broker = ContextBroker::new();
    /// let _ = broker; // ready to compose frames
    /// ```
    pub fn new() -> Self {
        Self::default()
    }

    /// Attaches the set of backends (and their capacity) the broker knows about.
    ///
    /// Consumes and returns `self` for chaining. Replaces any previously set
    /// capacity list.
    ///
    /// ```
    /// use pd_runtime::{BackendCapacity, ContextBroker};
    ///
    /// let broker = ContextBroker::new()
    ///     .with_backend_capacity(vec![BackendCapacity::ready("mock", "mid", 2)]);
    /// let _ = broker;
    /// ```
    pub fn with_backend_capacity(mut self, capacity: Vec<BackendCapacity>) -> Self {
        self.backend_capacity = capacity;
        self
    }

    /// Attaches notices about prior work similar to the transactions being composed.
    ///
    /// Consumes and returns `self` for chaining. Replaces any previously set list.
    pub fn with_similar_work(mut self, similar_work: Vec<SimilarWorkNotice>) -> Self {
        self.similar_work = similar_work;
        self
    }

    /// Composes the briefing frame for `transaction`, addressed to `agent_id`.
    ///
    /// The frame copies the transaction's rooms and evidence verbatim, stamps
    /// `generated_at_ms` with the current time, and folds in the broker's backend
    /// capacity and similar-work notices. Crucially, it filters obligations down to
    /// only the **blocking** ones (those an agent must clear before mutating), via
    /// [`Obligation::is_blocking`], so the agent's briefing highlights what would
    /// actually stop it rather than every note on the transaction.
    ///
    /// This never fails and does no I/O; it is a pure projection of its inputs.
    ///
    /// ```
    /// use pd_runtime::ContextBroker;
    /// use pd_core::{
    ///     ActorId, CapabilityEnvelope, Obligation, ObligationKind, Severity,
    ///     TransactionSource, WorkTransaction,
    /// };
    ///
    /// let mut tx = WorkTransaction::new(
    ///     "tx-1", "demo", TransactionSource::Operator, "agent-a",
    ///     CapabilityEnvelope::kernel_local("agent-a", vec!["job:run".into()]),
    /// );
    /// // A Critical/Pending obligation is blocking and will appear in the frame.
    /// tx.add_obligation(Obligation::pending(
    ///     "ob-1", ObligationKind::Review, Severity::Critical, "review first",
    /// ));
    ///
    /// let frame = ContextBroker::new().compose(&tx, ActorId::from("agent-a"));
    /// assert_eq!(frame.obligations.len(), 1);
    /// assert_eq!(frame.agent_id, ActorId::from("agent-a"));
    /// ```
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

/// An in-memory FIFO queue of jobs with expiring, single-owner leases.
///
/// Jobs are held in insertion order. [`lease`](JobQueue::lease) scans from the front
/// and hands out the first *eligible* job — one that is either still `Queued` or was
/// `Leased` but whose lease has since expired — guaranteeing that a live lease is
/// owned by exactly one actor at a time while a dead owner's job becomes reclaimable.
///
/// # Durability note
///
/// This queue is purely in-memory: it is not itself persisted. In the kernel the
/// durable record of job state lives in the event log; this structure is the working
/// set a scheduler operates on. Restarting the process loses the queue unless it is
/// rebuilt from the log.
#[derive(Clone, Debug, Default)]
pub struct JobQueue {
    jobs: VecDeque<Job>,
}

impl JobQueue {
    /// Creates an empty queue.
    ///
    /// ```
    /// use pd_runtime::JobQueue;
    /// let queue = JobQueue::new();
    /// assert!(queue.snapshot().is_empty());
    /// ```
    pub fn new() -> Self {
        Self::default()
    }

    /// Appends a job to the back of the queue.
    ///
    /// The job keeps whatever state it was constructed with (typically
    /// `Queued`); this method does not lease or run it.
    ///
    /// ```
    /// use pd_runtime::JobQueue;
    /// use pd_core::{Job, MutationKind};
    ///
    /// let mut queue = JobQueue::new();
    /// queue.push(Job::new("job-1", "tx-1", "do the thing", MutationKind::LocalMutating));
    /// assert_eq!(queue.snapshot().len(), 1);
    /// ```
    pub fn push(&mut self, job: Job) {
        self.jobs.push_back(job);
    }

    /// Leases the first eligible job to `actor_id`, or returns `None` if none is available.
    ///
    /// A job is eligible when it is `Queued`, or when it is `Leased` but its lease
    /// expired at or before `now_ms`. On success the job is transitioned to
    /// `Leased`, stamped with `leased_by = actor_id` and
    /// `lease_expires_at_ms = now_ms + lease_duration_ms`, its `attempts` counter is
    /// incremented, and a clone of the updated job is returned. The queue's own copy
    /// is mutated in place, so a subsequent `lease` within the window will skip it.
    ///
    /// Returning `None` is not an error — it simply means no job is currently
    /// leaseable. Because an expired lease makes a job eligible again, a job may be
    /// leased more than once (hence `attempts`); callers must therefore treat job
    /// execution as idempotent.
    ///
    /// ```
    /// use pd_runtime::JobQueue;
    /// use pd_core::{ActorId, Job, MutationKind};
    ///
    /// let mut queue = JobQueue::new();
    /// queue.push(Job::new("job-1", "tx-1", "work", MutationKind::LocalMutating));
    ///
    /// // agent-a takes a 100ms lease at t=1000.
    /// let first = queue.lease(ActorId::from("agent-a"), 1000, 100).unwrap();
    /// assert_eq!(first.leased_by, Some(ActorId::from("agent-a")));
    ///
    /// // agent-b asks while the lease is still live (t=1050) -> nothing to take.
    /// assert!(queue.lease(ActorId::from("agent-b"), 1050, 100).is_none());
    ///
    /// // After expiry (t=1200) agent-b reclaims it; this is the second attempt.
    /// let reclaimed = queue.lease(ActorId::from("agent-b"), 1200, 100).unwrap();
    /// assert_eq!(reclaimed.leased_by, Some(ActorId::from("agent-b")));
    /// assert_eq!(reclaimed.attempts, 2);
    /// ```
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

    /// Marks the job identified by `job_id` as `Completed` and clears its lease.
    ///
    /// A completed job is no longer eligible for leasing (its state is terminal and
    /// its `lease_expires_at_ms` is cleared to `None`), so it will be skipped by all
    /// future [`lease`](JobQueue::lease) scans.
    ///
    /// # Errors
    ///
    /// Returns [`RuntimeError::JobNotFound`] if no job in the queue has that id. The
    /// queue is left unchanged in that case.
    ///
    /// ```
    /// use pd_runtime::{JobQueue, RuntimeError};
    /// use pd_core::{ActorId, Job, JobId, MutationKind};
    ///
    /// let mut queue = JobQueue::new();
    /// queue.push(Job::new("job-1", "tx-1", "work", MutationKind::LocalMutating));
    /// queue.lease(ActorId::from("agent-a"), 0, 100);
    ///
    /// queue.complete(&JobId::from("job-1")).unwrap();
    /// // A subsequent lease finds nothing: the only job is Completed.
    /// assert!(queue.lease(ActorId::from("agent-a"), 1000, 100).is_none());
    ///
    /// // Completing an unknown job is a typed error, not a panic.
    /// assert!(matches!(
    ///     queue.complete(&JobId::from("nope")),
    ///     Err(RuntimeError::JobNotFound(_)),
    /// ));
    /// ```
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

    /// Returns a cloned snapshot of every job in the queue, in insertion order.
    ///
    /// A read-only view for inspection or projection; mutating the returned `Vec`
    /// does not affect the queue.
    ///
    /// ```
    /// use pd_runtime::JobQueue;
    /// use pd_core::{Job, MutationKind};
    ///
    /// let mut queue = JobQueue::new();
    /// queue.push(Job::new("job-1", "tx-1", "a", MutationKind::ReadOnly));
    /// queue.push(Job::new("job-2", "tx-1", "b", MutationKind::ReadOnly));
    /// let snap = queue.snapshot();
    /// assert_eq!(snap.len(), 2);
    /// assert_eq!(snap[0].id.to_string(), "job-1");
    /// ```
    pub fn snapshot(&self) -> Vec<Job> {
        self.jobs.iter().cloned().collect()
    }
}

/// The recorded result of a [`MockBackend`] "running" a turn.
///
/// Captures which backend ran and the exact `effective_prompt` it would have sent —
/// i.e. the injected context block followed by the operator's prompt. Because it is
/// pure data with no side effects, tests can assert on the composed prompt directly.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MockRun {
    /// The id of the backend that produced this run.
    pub backend_id: String,
    /// The full prompt after context injection: context block, blank line, user prompt.
    pub effective_prompt: String,
}

/// A no-op backend that composes the effective prompt without calling any model.
///
/// It exists to exercise and document the context-injection contract — that every
/// turn is prefixed with the [`AgentContextFrame`]'s prompt block — without network
/// access, credentials, or nondeterminism. Real backends follow the same shape:
/// render the frame, prepend it to the user's prompt, then dispatch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MockBackend {
    /// The identifier this mock reports in its [`MockRun`]s.
    pub backend_id: String,
}

impl MockBackend {
    /// Creates a mock backend that reports the given `backend_id`.
    ///
    /// ```
    /// use pd_runtime::MockBackend;
    /// let backend = MockBackend::new("mock");
    /// assert_eq!(backend.backend_id, "mock");
    /// ```
    pub fn new(backend_id: impl Into<String>) -> Self {
        Self {
            backend_id: backend_id.into(),
        }
    }

    /// "Runs" a turn: renders `frame` into a prompt block and prepends it to `user_prompt`.
    ///
    /// The resulting `effective_prompt` is `"<context block>\n\n<user prompt>"`,
    /// demonstrating the invariant that context is injected ahead of every turn's
    /// instruction. No model is called and nothing is persisted.
    ///
    /// # Errors
    ///
    /// Returns [`RuntimeError::Serde`] if the frame cannot be rendered (see
    /// [`AgentContextFrame::to_prompt_block`]).
    ///
    /// ```
    /// use pd_runtime::{ContextBroker, MockBackend};
    /// use pd_core::{ActorId, CapabilityEnvelope, TransactionSource, WorkTransaction};
    ///
    /// let tx = WorkTransaction::new(
    ///     "tx-1", "demo", TransactionSource::Operator, "agent-a",
    ///     CapabilityEnvelope::kernel_local("agent-a", vec!["job:run".into()]),
    /// );
    /// let frame = ContextBroker::new().compose(&tx, ActorId::from("agent-a"));
    ///
    /// let run = MockBackend::new("mock").run(&frame, "do the task").unwrap();
    /// assert!(run.effective_prompt.starts_with("BEGIN PD AGENT CONTEXT"));
    /// assert!(run.effective_prompt.ends_with("do the task"));
    /// ```
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

/// Everything that can go wrong in the runtime layer.
///
/// The variants are intentionally few because this layer does no I/O: an operation
/// either references a job that is not in the queue, or fails to (de)serialize a
/// frame. [`Serde`](RuntimeError::Serde) is `#[from]`-convertible so frame methods
/// can use `?` over serde failures directly. A returned error never leaves a
/// [`JobQueue`] partially mutated.
#[derive(Debug, Error)]
pub enum RuntimeError {
    /// A [`JobQueue`] operation named a job id that is not present in the queue.
    #[error("job not found: {0}")]
    JobNotFound(JobId),
    /// A frame failed to serialize or deserialize.
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
    fn local_request_frames_round_trip_as_typed_json() {
        let request = LocalRequestFrame::status("req-1");
        let encoded = request.encode_json().unwrap();
        let decoded = LocalRequestFrame::decode_json(&encoded).unwrap();

        assert_eq!(decoded.request_id, "req-1");
        assert_eq!(decoded.kind, LocalRequestKind::Status);
    }
}
