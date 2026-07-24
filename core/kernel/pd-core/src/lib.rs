//! Port Daddy kernel — the domain model and authority layer.
//!
//! ## What this crate is
//!
//! `pd-core` is the *pure heart* of the Port Daddy kernel. It defines the canonical
//! data types that describe a unit of agent work and — more importantly — the rules
//! that decide **what an agent is allowed to do**. It performs no I/O: no sockets, no
//! files, no clock ticking in a background thread. Everything here is a plain value or
//! a pure function over values. That purity is deliberate: the crate is the single
//! source of truth for authority, lifecycle, and conflict semantics, and a source of
//! truth is far easier to trust when it cannot have side effects.
//!
//! Downstream kernel crates *consume* these types but never re-implement the rules:
//!
//! - `pd-runtime` brokers execution — it leases [`Job`]s to actors and composes the
//!   governance context that travels with an agent's prompt — but it asks *this* crate,
//!   via [`WorkTransaction::can_mutate`], whether a mutation is permitted.
//! - `pd-eventlog` persists [`KernelEvent`]s to an append-only SQLite log and folds
//!   them back into a read model.
//! - `pd-mesh`, `pd-anchor`, and `pd-tui` reuse the identity newtypes and [`now_ms`].
//!
//! Because the daemon is written in TypeScript and the console in Rust, these same
//! types are reached over a C ABI; keeping them free of environment coupling is what
//! makes that boundary cheap to cross.
//!
//! ## The central idea: a governed [`WorkTransaction`]
//!
//! Everything orbits [`WorkTransaction`] — one intent an actor is pursuing (e.g. "ship
//! the kernel"), together with the authority it was granted, the coordination
//! [`Claim`]s it holds, the [`Job`]s that carry it out, and the audit trail it leaves.
//! A transaction moves through a small, explicit state machine ([`TransactionState`])
//! whose legal edges are hard-coded in `is_valid_transition`; every other transition
//! is refused with a typed error. This means a transaction can never silently skip from
//! `Proposed` straight to `Completed` — the type system and the guard together make the
//! illegal path unrepresentable at runtime.
//!
//! ## Authority is checked at exactly one chokepoint
//!
//! The non-obvious design decision worth internalizing: **all three governance
//! mechanisms are enforced in one place**, [`WorkTransaction::can_mutate`]. They form a
//! conjunction — a mutating action is allowed only if *all* hold:
//!
//! 1. **[`CapabilityEnvelope`]** — a time-boxed grant of authority. It says "you may act
//!    until time *T*." When the clock passes *T*, the grant simply lapses.
//! 2. **[`Obligation`]** — a durable promise the actor owes (a review, a human
//!    acknowledgement, a credential). A *blocking* obligation (pending and
//!    [`Severity::High`] or above) stops mutating work until it is resolved.
//! 3. **[`HumanGate`]** — an explicit "a person must approve here" checkpoint.
//!
//! Read-only work ([`MutationKind::ReadOnly`]) always passes; the gate exists to protect
//! the world from *changes*, not from *observation*. Concentrating the check in a single
//! function is what lets the rest of the system stay simple: no caller has to remember
//! the rules, because no caller is trusted to.
//!
//! ## A tour in one example
//!
//! ```rust
//! use pd_core::{
//!     CapabilityEnvelope, MutationKind, Obligation, ObligationKind, Severity,
//!     TransactionSource, TransactionState, WorkResult, WorkTransaction,
//! };
//!
//! // A fresh transaction begins life as `Proposed` with a local 1-hour capability.
//! let envelope = CapabilityEnvelope::kernel_local("agent-a", vec!["work:mutate".into()]);
//! let mut tx = WorkTransaction::new(
//!     "tx-1",
//!     "ship the kernel",
//!     TransactionSource::Operator,
//!     "agent-a",
//!     envelope,
//! );
//! assert_eq!(tx.state, TransactionState::Proposed);
//!
//! // Read-only work is always allowed; mutating work is allowed here because nothing blocks it.
//! assert!(tx.can_mutate(MutationKind::ReadOnly).is_ok());
//! assert!(tx.can_mutate(MutationKind::LocalMutating).is_ok());
//!
//! // Attach a blocking obligation and the same mutation is now refused.
//! tx.add_obligation(Obligation::pending(
//!     "ob-1",
//!     ObligationKind::Review,
//!     Severity::High,
//!     "needs review before merge",
//! ));
//! assert!(tx.can_mutate(MutationKind::LocalMutating).is_err());
//!
//! // Walk the legal lifecycle to completion.
//! tx.transition(TransactionState::Ready).unwrap();
//! tx.transition(TransactionState::Running).unwrap();
//! tx.transition(TransactionState::Review).unwrap();
//! tx.complete(WorkResult { summary: "done".into(), evidence: Vec::new() }).unwrap();
//! assert_eq!(tx.state, TransactionState::Completed);
//! ```
//!
//! ## Related design records
//!
//! The governance model is spelled out across several ADRs: ADR-0040 (non-forgeable
//! actor identity), ADR-0041 (durable, monitored obligations), ADR-0038 (the claim tree
//! and multi-granularity conflict detection), and ADR-0095 (the agent-run saga that maps
//! onto [`TransactionState`]). This crate is the executable distillation of those
//! documents.

use serde::{Deserialize, Serialize};
use std::fmt::{Display, Formatter};
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

/// Declares a newtype wrapper around `String` used as a typed identifier.
///
/// Port Daddy has many kinds of identifier — actors, transactions, jobs, rooms — and
/// they must never be confused for one another. A bare `String` would let you
/// accidentally pass a [`JobId`] where an [`ActorId`] is expected; the compiler would
/// say nothing. Wrapping each in its own zero-cost newtype (a struct with a single
/// `String` field) recovers that safety: the types are distinct even though the runtime
/// representation is identical.
///
/// This teaches a core Rust idiom, the **newtype pattern**. The macro generates, for
/// each id type:
///
/// - `#[serde(transparent)]` so the wrapper serializes as the bare string, not as
///   `{"0": "..."}` — the JSON stays clean and the daemon side sees a plain string.
/// - a `new` constructor accepting anything `Into<String>`.
/// - a [`Display`] impl that writes the inner string (so `format!("{id}")` just works).
/// - `From<&str>` and `From<String>` so ergonomic `"literal".into()` conversions
///   compile everywhere an id is needed.
///
/// The derived `Ord`/`Hash` make ids usable as `BTreeMap`/`HashMap` keys, which the
/// event-log projection and claim bookkeeping rely on.
macro_rules! id_type {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl $name {
            /// Constructs the identifier from anything convertible into a `String`.
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

/// A participant that can hold authority and be held to account.
///
/// An actor is any principal the kernel governs — a human operator, a fleet agent, or
/// the kernel itself acting on someone's behalf. Identity is *non-forgeable* by design
/// (ADR-0040): the [`ActorId`] is the anchor to which [`CapabilityEnvelope`]s,
/// [`Obligation`]s, and [`Job`] leases bind, so that a completed action can always be
/// traced back to who was responsible for it.
///
/// The `telos` field (Greek for "purpose/end") records *why* this actor exists — its
/// charter. `capabilities` is the coarse set of things it is allowed to attempt; the
/// per-transaction [`CapabilityEnvelope`] is the finer, time-boxed grant.
///
/// # Examples
///
/// ```rust
/// use pd_core::Actor;
///
/// let actor = Actor::new("agent-a", "Kernel Builder", "ship the kernel safely");
/// assert_eq!(actor.id.to_string(), "agent-a");
/// assert!(actor.capabilities.is_empty()); // capabilities are granted, not assumed
/// ```
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Actor {
    /// The non-forgeable identity this actor's actions are attributed to.
    pub id: ActorId,
    /// A short human-readable name for display.
    pub label: String,
    /// The actor's charter — the purpose it was created to serve.
    pub telos: String,
    /// Coarse-grained capabilities this actor may attempt (starts empty).
    pub capabilities: Vec<String>,
}

impl Actor {
    /// Creates an actor with the given identity, display label, and charter.
    ///
    /// Capabilities start empty: authority in Port Daddy is *granted*, never assumed at
    /// construction. Add capabilities explicitly, or scope them per transaction with a
    /// [`CapabilityEnvelope`].
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::Actor;
    ///
    /// let actor = Actor::new("agent-a", "Builder", "do good work");
    /// assert_eq!(actor.label, "Builder");
    /// assert_eq!(actor.telos, "do good work");
    /// ```
    pub fn new(id: impl Into<ActorId>, label: impl Into<String>, telos: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            telos: telos.into(),
            capabilities: Vec::new(),
        }
    }
}

/// A time-boxed grant of authority to a subject.
///
/// A capability envelope answers one question: *"is this actor still permitted to
/// act?"* It carries a `subject`, the `capabilities` granted (strings such as
/// `"work:mutate"`), and a validity window bounded by `issued_at_ms` and
/// `expires_at_ms`. When the wall clock passes the expiry, the grant simply lapses —
/// this is the "permission that decays" half of the authority model, distinct from an
/// [`Obligation`] (a promise the actor must actively resolve).
///
/// The envelope is one of the three checks in [`WorkTransaction::can_mutate`]: an
/// expired envelope refuses all mutating work with [`CoreError::CapabilityExpired`].
///
/// All times are Unix epoch milliseconds (see [`now_ms`]).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityEnvelope {
    /// The actor (or logical subject) this grant is issued to.
    pub subject: String,
    /// The capability strings conferred by this grant.
    pub capabilities: Vec<String>,
    /// When the grant became valid, in Unix epoch milliseconds.
    pub issued_at_ms: i64,
    /// When the grant lapses, in Unix epoch milliseconds. See [`Self::is_expired_at`].
    pub expires_at_ms: i64,
    /// Where this grant came from, for audit.
    pub provenance: Provenance,
}

impl CapabilityEnvelope {
    /// Mints a locally-issued grant valid for one hour from now.
    ///
    /// This is the convenience constructor for kernel-local work where no external
    /// signing authority is involved — the grant is stamped with
    /// [`Provenance::kernel`] and given a fixed 3,600,000 ms (one hour) lifetime. For
    /// externally-signed authority, construct the struct directly with the real
    /// issue/expiry times.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::CapabilityEnvelope;
    ///
    /// let env = CapabilityEnvelope::kernel_local("agent-a", vec!["work:mutate".into()]);
    /// // The window is exactly one hour wide.
    /// assert_eq!(env.expires_at_ms - env.issued_at_ms, 3_600_000);
    /// // It is not yet expired at the instant it was issued.
    /// assert!(!env.is_expired_at(env.issued_at_ms));
    /// ```
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

    /// Returns `true` if the grant has lapsed at the given instant.
    ///
    /// Expiry is *inclusive of the boundary*: at exactly `expires_at_ms` the envelope is
    /// already considered expired (`expires_at_ms <= at_ms`). Passing an explicit
    /// timestamp keeps this pure and testable — the caller supplies "now", so the check
    /// never reaches for a clock of its own.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::CapabilityEnvelope;
    ///
    /// let env = CapabilityEnvelope::kernel_local("agent-a", vec![]);
    /// assert!(!env.is_expired_at(env.expires_at_ms - 1)); // one ms before: alive
    /// assert!(env.is_expired_at(env.expires_at_ms));      // at the boundary: expired
    /// assert!(env.is_expired_at(env.expires_at_ms + 1));  // after: expired
    /// ```
    pub fn is_expired_at(&self, at_ms: i64) -> bool {
        self.expires_at_ms <= at_ms
    }
}

/// The origin story of a value — who or what produced it, and when.
///
/// Provenance is the kernel's honesty mechanism. Every governance-relevant value
/// (envelopes, events) carries one so the audit trail can answer "where did this come
/// from?" without guessing. `observed_by` is `None` for values the kernel itself
/// minted; it names an [`ActorId`] when a specific actor's observation produced the
/// value.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Provenance {
    /// A label for the origin, e.g. `"local"` or `"pd-eventlog"`.
    pub source: String,
    /// The actor whose observation produced this, if any; `None` for kernel-minted values.
    pub observed_by: Option<ActorId>,
    /// When this provenance was recorded, in Unix epoch milliseconds.
    pub recorded_at_ms: i64,
}

impl Provenance {
    /// Stamps a kernel-originated provenance with the current time and no observer.
    ///
    /// Use this for values the kernel produces on its own behalf. Because there is no
    /// observing actor, `observed_by` is `None`.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::Provenance;
    ///
    /// let p = Provenance::kernel("pd-eventlog");
    /// assert_eq!(p.source, "pd-eventlog");
    /// assert!(p.observed_by.is_none());
    /// ```
    pub fn kernel(source: impl Into<String>) -> Self {
        Self {
            source: source.into(),
            observed_by: None,
            recorded_at_ms: now_ms(),
        }
    }
}

/// The access level a [`Claim`] asserts over a region of state.
///
/// Coordination between agents is *advisory* — a claim announces intent, it does not
/// take a lock — but the conflict rules still follow the familiar reader/writer
/// discipline: many readers may coexist, but a writer excludes everyone else touching
/// the same region. `Exclusive` is the strongest assertion (sole access).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClaimMode {
    /// Non-mutating access. Two `Read` claims never conflict.
    Read,
    /// Mutating access. Conflicts with any overlapping non-`Read` claim.
    Write,
    /// Sole access to the region.
    Exclusive,
}

/// An advisory assertion that an actor intends to work on a region of state.
///
/// Claims implement multi-granularity coordination (ADR-0038): the same file can be
/// claimed at three levels of precision — the whole `path`, a specific `symbol_path`
/// (e.g. a function name), or a line range (`start_line`..=`end_line`). Two agents
/// editing *different symbols* in the same file do not conflict, which is what lets a
/// fleet parallelize inside one file instead of serializing on it. See
/// [`claims_conflict`] for the exact rule.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Claim {
    /// The file path being claimed.
    pub path: String,
    /// An optional symbol (e.g. function or type name) narrowing the claim within the file.
    pub symbol_path: Option<String>,
    /// The first line of a claimed range (1-based), if this is a range claim.
    pub start_line: Option<u32>,
    /// The last line of a claimed range (inclusive), if this is a range claim.
    pub end_line: Option<u32>,
    /// The access level asserted.
    pub mode: ClaimMode,
}

impl Claim {
    /// Claims write access to an entire file.
    ///
    /// This is the coarsest write claim: it conflicts with any other non-read claim on
    /// the same path, regardless of symbol or line range, because a whole-file write
    /// could touch anything in it.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::{Claim, ClaimMode};
    ///
    /// let c = Claim::file_write("src/lib.rs");
    /// assert_eq!(c.mode, ClaimMode::Write);
    /// assert!(c.symbol_path.is_none());
    /// ```
    pub fn file_write(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            symbol_path: None,
            start_line: None,
            end_line: None,
            mode: ClaimMode::Write,
        }
    }

    /// Claims write access to a single named symbol within a file.
    ///
    /// Two symbol writes on the same file conflict only if they name the *same* symbol —
    /// this is the fine-grained path that lets multiple agents edit one file at once.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::{Claim, claims_conflict};
    ///
    /// let alpha = Claim::symbol_write("src/lib.rs", "alpha");
    /// let beta = Claim::symbol_write("src/lib.rs", "beta");
    /// assert!(!claims_conflict(&alpha, &beta)); // different symbols: no conflict
    /// ```
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

/// Decides whether two [`Claim`]s conflict — the heart of advisory coordination.
///
/// The rule is evaluated most-specific-first, and errs toward *reporting* a conflict
/// when precision is missing (fail-safe): if the two claims describe overlapping work at
/// different granularities and there is not enough information to prove they are
/// disjoint, they are treated as conflicting.
///
/// The decision procedure:
///
/// 1. **Different paths never conflict.** Distinct files are independent.
/// 2. **Two reads never conflict.** Observation does not exclude observation.
/// 3. **Both name a symbol → conflict iff the symbols are equal.** This is the
///    fine-grained case that lets agents edit different symbols in one file in parallel.
/// 4. **Both name a line range → conflict iff the ranges overlap** (inclusive).
/// 5. **Otherwise → conflict.** One side is a whole-file claim (or under-specified), so
///    we conservatively assume overlap.
///
/// # Examples
///
/// ```rust
/// use pd_core::{Claim, claims_conflict};
///
/// // Different files: independent.
/// assert!(!claims_conflict(&Claim::file_write("a.rs"), &Claim::file_write("b.rs")));
///
/// // Same symbol in the same file: a real conflict.
/// assert!(claims_conflict(
///     &Claim::symbol_write("a.rs", "foo"),
///     &Claim::symbol_write("a.rs", "foo"),
/// ));
///
/// // A whole-file write vs. a symbol write on the same file: conservatively a conflict.
/// assert!(claims_conflict(
///     &Claim::file_write("a.rs"),
///     &Claim::symbol_write("a.rs", "foo"),
/// ));
/// ```
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

/// Extracts a `(start, end)` line range from a claim, if it is a range claim.
///
/// Returns `None` unless *both* `start_line` and `end_line` are present — the `?`
/// operator short-circuits on the first missing bound, so a half-specified range is
/// treated as "not a range claim" rather than a malformed one.
fn claim_range(claim: &Claim) -> Option<(u32, u32)> {
    Some((claim.start_line?, claim.end_line?))
}

/// Returns `true` if two inclusive `(start, end)` line ranges overlap.
///
/// Uses the standard interval-overlap test: `left.start <= right.end && right.start <=
/// left.end`. Both endpoints are inclusive, so ranges that merely touch at a shared line
/// count as overlapping.
fn ranges_overlap(left: (u32, u32), right: (u32, u32)) -> bool {
    left.0 <= right.1 && right.0 <= left.1
}

/// Where a [`WorkTransaction`] came from — its channel of origin.
///
/// The source is provenance for the *intent itself*, distinct from the [`Provenance`]
/// stamped on individual values. It records whether a human operator asked for the work,
/// the roadmap scheduled it, an agent proposed it autonomously, it was imported from a
/// legacy/compat path, or it arrived from a peer across the mesh.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransactionSource {
    /// A human operator initiated the work.
    Operator,
    /// The curated roadmap scheduled the work.
    Roadmap,
    /// An agent proposed the work autonomously.
    Agent,
    /// Imported from a legacy or compatibility path.
    CompatImport,
    /// Arrived from a peer over the mesh.
    MeshPeer,
}

/// The lifecycle state of a [`WorkTransaction`].
///
/// A transaction is a small state machine. Legal edges are enumerated in
/// `is_valid_transition`, and [`WorkTransaction::transition`] refuses any edge not on
/// that list — so the state can never take an illegal jump. The happy path is:
///
/// `Proposed → Ready → Running → Review → Completed`
///
/// with escape hatches: `Ready`/`Running` may become `Blocked` or `Cancelled`, a
/// `Blocked` transaction returns to `Ready`, and `Running`/`Review` may end in `Failed`.
/// `Review` may also loop back to `Running` when changes are requested. This maps onto
/// the agent-run saga of ADR-0095.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransactionState {
    /// Newly created; not yet admitted for execution. The starting state.
    Proposed,
    /// Admitted and eligible to run.
    Ready,
    /// Actively executing.
    Running,
    /// Halted on an unmet precondition; can return to `Ready`.
    Blocked,
    /// Execution finished, awaiting review/approval.
    Review,
    /// Successfully finished; carries a [`WorkResult`]. Terminal.
    Completed,
    /// Ended in failure. Terminal.
    Failed,
    /// Abandoned before completion. Terminal.
    Cancelled,
}

/// How dangerous an action is — the axis [`WorkTransaction::can_mutate`] gates on.
///
/// The kernel does not protect the world from *reading* it, only from *changing* it.
/// [`MutationKind::ReadOnly`] is therefore always permitted; every other variant is
/// subject to the full authority check (obligations, human gates, capability expiry).
/// The finer variants let higher layers apply escalating scrutiny (e.g. host-safety
/// gating for `Destructive`, network policy for `Network`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum MutationKind {
    /// Observes state without changing it. Always allowed by `can_mutate`.
    ReadOnly,
    /// Changes local state (e.g. edits a file).
    LocalMutating,
    /// Performs an irreversible or destructive action.
    Destructive,
    /// Reaches out over the network.
    Network,
}

/// Ordered severity of an [`Obligation`].
///
/// The ordering is meaningful — the derived `PartialOrd`/`Ord` follow declaration order
/// (`Low < Medium < High < Critical`), and [`Obligation::is_blocking`] compares against
/// `High` with `>=`. Deriving `Ord` on an enum whose variants are written in ascending
/// order of importance is a compact Rust idiom for "these levels have a natural rank."
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Severity {
    /// Informational; never blocks on its own.
    Low,
    /// Notable but non-blocking.
    Medium,
    /// Blocking when pending — mutating work must wait.
    High,
    /// The most serious level; blocking when pending.
    Critical,
}

/// The nature of an [`Obligation`] — what kind of promise is owed.
///
/// Obligations are the "did the agent keep its word?" side of governance (ADR-0041).
/// Each kind names a different debt the actor must settle before mutating work may
/// proceed: a human must acknowledge, a review must happen, a credential must be
/// presented, a claim conflict must be resolved, a backend must be ready, or mesh trust
/// must be established.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ObligationKind {
    /// A human must explicitly acknowledge before proceeding.
    HumanAcknowledgement,
    /// Work must be reviewed.
    Review,
    /// A credential must be presented.
    Credential,
    /// A conflicting [`Claim`] must be resolved.
    ClaimConflict,
    /// A backend must reach readiness.
    BackendReadiness,
    /// Trust with a mesh peer must be established.
    MeshTrust,
}

/// The resolution status of an [`Obligation`].
///
/// An obligation begins `Pending` and is settled by moving to one of the terminal
/// states. Only a `Pending` obligation can block (and only then if its [`Severity`] is
/// high enough) — see [`Obligation::is_blocking`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ObligationStatus {
    /// Not yet resolved. The starting state; the only status that can block.
    Pending,
    /// Satisfied by acknowledgement.
    Acknowledged,
    /// Deliberately postponed.
    Deferred,
    /// Refused.
    Rejected,
}

/// A durable commitment that must be resolved before mutating work proceeds.
///
/// Obligations encode the promises an actor owes (ADR-0041). Crucially they are
/// *violable and monitored*, not physically prevented: the kernel cannot make it
/// impossible to skip a review, so instead it records the obligation and refuses
/// mutating work while a blocking one is outstanding. An obligation blocks only while it
/// is both [`ObligationStatus::Pending`] and at least [`Severity::High`] — see
/// [`Self::is_blocking`].
///
/// Times are Unix epoch milliseconds; `resolved_at_ms` is `None` until the obligation is
/// settled.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Obligation {
    /// This obligation's identity.
    pub id: ObligationId,
    /// What kind of promise is owed.
    pub kind: ObligationKind,
    /// How serious it is; governs whether it blocks.
    pub severity: Severity,
    /// A human-readable description of what must happen.
    pub summary: String,
    /// The current resolution status.
    pub status: ObligationStatus,
    /// When the obligation was created, in Unix epoch milliseconds.
    pub created_at_ms: i64,
    /// When it was resolved, if it has been.
    pub resolved_at_ms: Option<i64>,
}

impl Obligation {
    /// Creates a new, unresolved (`Pending`) obligation stamped with the current time.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::{Obligation, ObligationKind, ObligationStatus, Severity};
    ///
    /// let ob = Obligation::pending("ob-1", ObligationKind::Review, Severity::High, "review me");
    /// assert_eq!(ob.status, ObligationStatus::Pending);
    /// assert!(ob.resolved_at_ms.is_none());
    /// ```
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

    /// Returns `true` if this obligation currently blocks mutating work.
    ///
    /// An obligation blocks only when it is *both* still [`ObligationStatus::Pending`]
    /// *and* at least [`Severity::High`]. A pending but `Low`/`Medium` obligation is
    /// recorded and visible but does not stop work; a resolved obligation never blocks.
    /// This is the exact predicate [`WorkTransaction::can_mutate`] scans for.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::{Obligation, ObligationKind, Severity};
    ///
    /// let high = Obligation::pending("a", ObligationKind::Review, Severity::High, "x");
    /// assert!(high.is_blocking());
    ///
    /// let low = Obligation::pending("b", ObligationKind::Review, Severity::Low, "x");
    /// assert!(!low.is_blocking()); // pending, but not severe enough to block
    ///
    /// let mut ack = high.clone();
    /// ack.acknowledge();
    /// assert!(!ack.is_blocking()); // resolved obligations never block
    /// ```
    pub fn is_blocking(&self) -> bool {
        self.status == ObligationStatus::Pending && self.severity >= Severity::High
    }

    /// Marks the obligation `Acknowledged` and records the resolution time.
    ///
    /// After acknowledgement the obligation is no longer [`Self::is_blocking`], so any
    /// mutating work it was gating becomes eligible again (assuming no other blocker).
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::{Obligation, ObligationKind, ObligationStatus, Severity};
    ///
    /// let mut ob = Obligation::pending("ob-1", ObligationKind::Review, Severity::High, "x");
    /// ob.acknowledge();
    /// assert_eq!(ob.status, ObligationStatus::Acknowledged);
    /// assert!(ob.resolved_at_ms.is_some());
    /// ```
    pub fn acknowledge(&mut self) {
        self.status = ObligationStatus::Acknowledged;
        self.resolved_at_ms = Some(now_ms());
    }
}

/// The lifecycle state of a [`Job`] — the sub-lifecycle beneath a transaction.
///
/// A [`Job`] runs *inside* a [`WorkTransaction`] but has its own state independent of
/// [`TransactionState`]. The lease-bearing states (`Leased`, `Running`) are what make
/// dead-agent recovery possible: if the actor holding a lease dies, its expiry passes
/// and another actor can re-lease the job (see `pd-runtime`'s job queue).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum JobState {
    /// Waiting to be leased. The starting state.
    Queued,
    /// Leased to an actor but not yet started.
    Leased,
    /// Actively executing under a lease.
    Running,
    /// Finished successfully. Terminal.
    Completed,
    /// Finished in failure. Terminal.
    Failed,
    /// Abandoned. Terminal.
    Cancelled,
}

/// A unit of executable work carried out on behalf of a [`WorkTransaction`].
///
/// Where a transaction is the *intent*, a job is a concrete *task* an actor leases and
/// runs. It records the `mutation_kind` (which the authority gate cares about), how many
/// `attempts` have been made, and — while leased — who holds it (`leased_by`) and when
/// that lease lapses (`lease_expires_at_ms`). The lease fields are the mechanism by
/// which `pd-runtime` reclaims work from an agent that never came back.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Job {
    /// This job's identity.
    pub id: JobId,
    /// The transaction this job advances.
    pub transaction_id: TransactionId,
    /// A human-readable description of the task.
    pub summary: String,
    /// How dangerous the work is; drives authority checks.
    pub mutation_kind: MutationKind,
    /// The current job state.
    pub state: JobState,
    /// How many times this job has been leased/attempted.
    pub attempts: u32,
    /// The actor currently holding the lease, if any.
    pub leased_by: Option<ActorId>,
    /// When the current lease expires, in Unix epoch milliseconds, if leased.
    pub lease_expires_at_ms: Option<i64>,
}

impl Job {
    /// Creates a fresh `Queued` job with no lease and zero attempts.
    ///
    /// A newly-created job is unleased and waiting: `state` is [`JobState::Queued`],
    /// `attempts` is 0, and both lease fields are `None`. Leasing (in `pd-runtime`) is
    /// what stamps `leased_by` and `lease_expires_at_ms` and bumps `attempts`.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::{Job, JobState, MutationKind};
    ///
    /// let job = Job::new("job-1", "tx-1", "run the tests", MutationKind::ReadOnly);
    /// assert_eq!(job.state, JobState::Queued);
    /// assert_eq!(job.attempts, 0);
    /// assert!(job.leased_by.is_none());
    /// ```
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

/// A conversational scope in which actors collaborate on a transaction.
///
/// A room groups participating actors around a `topic`, optionally bound to a specific
/// [`TransactionId`] via `scoped_transaction`. Rooms are how coordination *talk* is
/// partitioned; `pd-runtime` copies a transaction's rooms into the context frame it
/// hands to a backend so the agent knows which conversations it belongs to.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Room {
    /// This room's identity.
    pub id: RoomId,
    /// What the room is about.
    pub topic: String,
    /// The actors participating in the room.
    pub participants: Vec<ActorId>,
    /// The transaction this room is scoped to, if any.
    pub scoped_transaction: Option<TransactionId>,
}

/// A pointer to a piece of evidence backing a claim of work done.
///
/// Evidence is how a transaction proves what it did. Rather than inlining large blobs,
/// an `EvidenceRef` holds a `kind`, a `uri` locating the artifact, and an optional
/// content `digest` so the reference can be integrity-checked. This keeps the audit
/// record lightweight while remaining verifiable.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceRef {
    /// This evidence reference's identity.
    pub id: EvidenceId,
    /// What kind of artifact this points to (e.g. `"log"`, `"diff"`).
    pub kind: String,
    /// Where to find the artifact.
    pub uri: String,
    /// An optional content digest for integrity verification.
    pub digest: Option<String>,
}

/// A record of one backend turn's resource usage and cost.
///
/// Telemetry lets a transaction account for what it spent: which `backend_id`/`model_id`
/// ran, the token counts, wall-clock `duration_ms`, and `cost_micros` (cost in
/// millionths of a currency unit — integer micros avoid floating-point drift when
/// summing many small charges). A transaction accumulates a `Vec<Telemetry>`, one entry
/// per turn.
///
/// Note: this type derives `PartialEq` but not `Eq`, unlike most types here — a
/// deliberate consequence of the numeric fields being safe to compare structurally while
/// leaving room for future float-bearing fields.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Telemetry {
    /// Which backend produced this turn.
    pub backend_id: String,
    /// Which model was used.
    pub model_id: String,
    /// Input (prompt) token count.
    pub input_tokens: u64,
    /// Output (completion) token count.
    pub output_tokens: u64,
    /// Wall-clock duration of the turn, in milliseconds.
    pub duration_ms: u64,
    /// Cost in millionths of a currency unit.
    pub cost_micros: u64,
}

/// An explicit human-in-the-loop checkpoint on a transaction.
///
/// A human gate is a waypoint that says "a person must approve here." It is `pending`
/// until a human acknowledges it (stamping `acknowledged_by` and `acknowledged_at_ms`).
/// While any gate is pending, [`WorkTransaction::can_mutate`] refuses mutating work with
/// [`CoreError::PendingHumanGate`]. Gates are distinct from [`Obligation`]s: an
/// obligation is a debt the *actor* owes, whereas a gate is approval the *operator* must
/// grant.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HumanGate {
    /// A description of what the human is approving.
    pub label: String,
    /// The actor (human) who acknowledged, if acknowledged.
    pub acknowledged_by: Option<ActorId>,
    /// When it was acknowledged, in Unix epoch milliseconds, if acknowledged.
    pub acknowledged_at_ms: Option<i64>,
}

impl HumanGate {
    /// Creates an unacknowledged gate awaiting human approval.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::HumanGate;
    ///
    /// let gate = HumanGate::pending("approve launch");
    /// assert!(gate.is_pending());
    /// ```
    pub fn pending(label: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            acknowledged_by: None,
            acknowledged_at_ms: None,
        }
    }

    /// Returns `true` while the gate still needs a human's acknowledgement.
    ///
    /// A gate is pending exactly when no one has acknowledged it (`acknowledged_by` is
    /// `None`). This is the predicate [`WorkTransaction::can_mutate`] uses to decide
    /// whether to block.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::HumanGate;
    ///
    /// let gate = HumanGate::pending("approve launch");
    /// assert!(gate.is_pending());
    /// ```
    pub fn is_pending(&self) -> bool {
        self.acknowledged_by.is_none()
    }
}

/// The outcome attached to a transaction when it completes.
///
/// A work result is the final answer: a `summary` of what was accomplished plus the
/// `evidence` that backs it. It is set exactly once, by [`WorkTransaction::complete`],
/// as the transaction transitions into [`TransactionState::Completed`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkResult {
    /// A description of what was accomplished.
    pub summary: String,
    /// Evidence backing the summary.
    pub evidence: Vec<EvidenceRef>,
}

/// The central aggregate: one governed unit of agent work.
///
/// A `WorkTransaction` binds together everything about a single intent — who is pursuing
/// it (`actor`), why (`intent`), where it came from (`source`), the authority it holds
/// (`capability_envelope`), the coordination [`Claim`]s it asserts, the [`Job`]s that
/// carry it out, the [`Room`]s it talks in, the [`Obligation`]s and [`HumanGate`]s that
/// constrain it, and the [`EvidenceRef`]/[`Telemetry`]/[`WorkResult`] it produces. Its
/// state ([`TransactionState`]) advances only along the edges `is_valid_transition`
/// permits.
///
/// This type is the reason the crate exists: it is where authority
/// ([`Self::can_mutate`]) and lifecycle ([`Self::transition`]) are decided. Higher
/// layers hold and mutate transactions, but they defer *every* "may I?" question to the
/// methods here.
///
/// Note: derives `PartialEq` but not `Eq`, because it transitively contains
/// [`Telemetry`] (which is `PartialEq`-only).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorkTransaction {
    /// This transaction's identity.
    pub id: TransactionId,
    /// The human-readable goal being pursued.
    pub intent: String,
    /// The channel this work originated from.
    pub source: TransactionSource,
    /// The actor responsible for the work.
    pub actor: ActorId,
    /// The current lifecycle state.
    pub state: TransactionState,
    /// The time-boxed authority grant governing this work.
    pub capability_envelope: CapabilityEnvelope,
    /// The worktree path this transaction operates in, if isolated to one.
    pub worktree: Option<String>,
    /// Coordination claims this transaction asserts.
    pub claims: Vec<Claim>,
    /// The jobs carrying out this transaction.
    pub jobs: Vec<Job>,
    /// The rooms this transaction participates in.
    pub rooms: Vec<RoomId>,
    /// Obligations constraining this transaction.
    pub obligations: Vec<Obligation>,
    /// Evidence produced by this transaction.
    pub evidence: Vec<EvidenceRef>,
    /// Per-turn resource/cost telemetry.
    pub telemetry: Vec<Telemetry>,
    /// Human approval checkpoints.
    pub human_gates: Vec<HumanGate>,
    /// The final result, set on completion.
    pub result: Option<WorkResult>,
    /// When the transaction was created, in Unix epoch milliseconds.
    pub created_at_ms: i64,
    /// When it was last modified, in Unix epoch milliseconds.
    pub updated_at_ms: i64,
}

impl WorkTransaction {
    /// Creates a new transaction in the [`TransactionState::Proposed`] state.
    ///
    /// The transaction starts empty of claims, jobs, obligations, and so on — those are
    /// added as the work is elaborated. `created_at_ms` and `updated_at_ms` are both
    /// stamped with the current time.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::{CapabilityEnvelope, TransactionSource, TransactionState, WorkTransaction};
    ///
    /// let env = CapabilityEnvelope::kernel_local("agent-a", vec![]);
    /// let tx = WorkTransaction::new("tx-1", "ship it", TransactionSource::Operator, "agent-a", env);
    /// assert_eq!(tx.state, TransactionState::Proposed);
    /// assert!(tx.jobs.is_empty());
    /// assert_eq!(tx.created_at_ms, tx.updated_at_ms);
    /// ```
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

    /// Attaches an obligation and bumps `updated_at_ms`.
    ///
    /// If the obligation is blocking (see [`Obligation::is_blocking`]), this immediately
    /// tightens the [`Self::can_mutate`] gate — the very next mutating check will refuse.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::{
    ///     CapabilityEnvelope, MutationKind, Obligation, ObligationKind, Severity,
    ///     TransactionSource, WorkTransaction,
    /// };
    ///
    /// let env = CapabilityEnvelope::kernel_local("agent-a", vec![]);
    /// let mut tx = WorkTransaction::new("tx-1", "x", TransactionSource::Agent, "agent-a", env);
    /// assert!(tx.can_mutate(MutationKind::LocalMutating).is_ok());
    ///
    /// tx.add_obligation(Obligation::pending("ob-1", ObligationKind::Review, Severity::High, "review"));
    /// assert!(tx.can_mutate(MutationKind::LocalMutating).is_err());
    /// ```
    pub fn add_obligation(&mut self, obligation: Obligation) {
        self.obligations.push(obligation);
        self.updated_at_ms = now_ms();
    }

    /// Returns references to every obligation still in the `Pending` status.
    ///
    /// Note this returns *all* pending obligations regardless of severity — it is a
    /// broader view than [`Obligation::is_blocking`], which additionally requires
    /// `High`+ severity. Use this to surface everything outstanding; use `can_mutate` to
    /// learn what actually blocks.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::{
    ///     CapabilityEnvelope, Obligation, ObligationKind, Severity,
    ///     TransactionSource, WorkTransaction,
    /// };
    ///
    /// let env = CapabilityEnvelope::kernel_local("agent-a", vec![]);
    /// let mut tx = WorkTransaction::new("tx-1", "x", TransactionSource::Agent, "agent-a", env);
    /// tx.add_obligation(Obligation::pending("a", ObligationKind::Review, Severity::Low, "x"));
    /// tx.add_obligation(Obligation::pending("b", ObligationKind::Review, Severity::High, "y"));
    /// assert_eq!(tx.pending_obligations().len(), 2); // both, even the non-blocking Low one
    /// ```
    pub fn pending_obligations(&self) -> Vec<&Obligation> {
        self.obligations
            .iter()
            .filter(|obligation| obligation.status == ObligationStatus::Pending)
            .collect()
    }

    /// The authority chokepoint: decides whether a mutation of the given kind is allowed.
    ///
    /// This is the single most important function in the crate. It short-circuits for
    /// [`MutationKind::ReadOnly`] (observation is always fine), then enforces the three
    /// governance mechanisms *in order*, returning the first violation it finds:
    ///
    /// 1. any blocking [`Obligation`] → [`CoreError::BlockingObligation`];
    /// 2. any pending [`HumanGate`] → [`CoreError::PendingHumanGate`];
    /// 3. an expired [`CapabilityEnvelope`] → [`CoreError::CapabilityExpired`].
    ///
    /// # Errors
    ///
    /// Returns the corresponding [`CoreError`] variant when any gate is closed. A caller
    /// receiving `Err` must not perform the mutation — the error names precisely what to
    /// resolve first. `Ok(())` means all three checks passed at this instant.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::{
    ///     CapabilityEnvelope, CoreError, HumanGate, MutationKind,
    ///     TransactionSource, WorkTransaction,
    /// };
    ///
    /// let env = CapabilityEnvelope::kernel_local("agent-a", vec![]);
    /// let mut tx = WorkTransaction::new("tx-1", "x", TransactionSource::Agent, "agent-a", env);
    ///
    /// // Read-only always passes, even with a pending gate.
    /// tx.human_gates.push(HumanGate::pending("approve"));
    /// assert!(tx.can_mutate(MutationKind::ReadOnly).is_ok());
    ///
    /// // A mutating kind is refused, and the error says why.
    /// let err = tx.can_mutate(MutationKind::Network).unwrap_err();
    /// assert!(matches!(err, CoreError::PendingHumanGate { .. }));
    /// ```
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

    /// Advances the transaction to `next`, if that edge is legal.
    ///
    /// The set of legal edges lives in `is_valid_transition`; any edge not on that list
    /// is refused, leaving the state untouched. On success the state is updated and
    /// `updated_at_ms` is refreshed.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::InvalidTransition`] (carrying both `from` and `to`) when the
    /// requested edge is not permitted. The transaction is left unchanged in that case,
    /// so a caller can safely retry a different transition.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::{
    ///     CapabilityEnvelope, CoreError, TransactionSource, TransactionState, WorkTransaction,
    /// };
    ///
    /// let env = CapabilityEnvelope::kernel_local("agent-a", vec![]);
    /// let mut tx = WorkTransaction::new("tx-1", "x", TransactionSource::Agent, "agent-a", env);
    ///
    /// // Legal: Proposed -> Ready.
    /// tx.transition(TransactionState::Ready).unwrap();
    /// assert_eq!(tx.state, TransactionState::Ready);
    ///
    /// // Illegal: Ready -> Completed skips the middle of the lifecycle.
    /// let err = tx.transition(TransactionState::Completed).unwrap_err();
    /// assert!(matches!(err, CoreError::InvalidTransition { .. }));
    /// assert_eq!(tx.state, TransactionState::Ready); // unchanged on failure
    /// ```
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

    /// Completes the transaction, transitioning to `Completed` and attaching `result`.
    ///
    /// This is a guarded convenience over [`Self::transition`]: it only succeeds if the
    /// current state legally reaches [`TransactionState::Completed`] (in practice, from
    /// `Review`). The `result` is stored *only after* the transition succeeds, so a
    /// failed completion never leaves a half-finished transaction carrying a result it
    /// did not earn.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::InvalidTransition`] if the transaction is not in a state that
    /// can legally complete; in that case `result` is dropped and the transaction is
    /// unchanged.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use pd_core::{
    ///     CapabilityEnvelope, TransactionSource, TransactionState, WorkResult, WorkTransaction,
    /// };
    ///
    /// let env = CapabilityEnvelope::kernel_local("agent-a", vec![]);
    /// let mut tx = WorkTransaction::new("tx-1", "x", TransactionSource::Agent, "agent-a", env);
    /// tx.transition(TransactionState::Ready).unwrap();
    /// tx.transition(TransactionState::Running).unwrap();
    /// tx.transition(TransactionState::Review).unwrap();
    ///
    /// tx.complete(WorkResult { summary: "done".into(), evidence: Vec::new() }).unwrap();
    /// assert_eq!(tx.state, TransactionState::Completed);
    /// assert_eq!(tx.result.unwrap().summary, "done");
    /// ```
    pub fn complete(&mut self, result: WorkResult) -> Result<(), CoreError> {
        self.transition(TransactionState::Completed)?;
        self.result = Some(result);
        Ok(())
    }
}

/// One entry in the kernel's append-only audit log.
///
/// A `KernelEvent` is an immutable fact: something happened, at a point in a total
/// order. The `sequence` field is that order — `pd-eventlog` assigns it monotonically as
/// events are appended, and the read model is rebuilt by folding events in `sequence`
/// order. `payload` is an untyped `serde_json::Value` so the log can carry any event
/// shape without the core crate needing to know every event type up front.
///
/// The `id` here is a fresh UUID (see [`Self::new`]); note that the persistence layer
/// (`pd-eventlog`) derives its own `id` from the storage sequence, so the two ids can
/// differ — the `sequence` is the authoritative key for ordering, not `id`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct KernelEvent {
    /// A unique identifier for this event (a UUID when built via [`Self::new`]).
    pub id: String,
    /// The monotonic position of this event in the total order.
    pub sequence: i64,
    /// A dotted event type, e.g. `"transaction.created"`.
    pub event_type: String,
    /// The subject the event concerns (e.g. a transaction id).
    pub subject: String,
    /// The event body — an untyped JSON value.
    pub payload: serde_json::Value,
    /// Where the event came from.
    pub provenance: Provenance,
    /// When the event was created, in Unix epoch milliseconds.
    pub created_at_ms: i64,
}

impl KernelEvent {
    /// Builds an event with a freshly generated UUID `id` and the current timestamp.
    ///
    /// The caller supplies the `sequence` (the position in the total order), the
    /// `event_type`, `subject`, `payload`, and `provenance`; `id` and `created_at_ms`
    /// are filled in here.
    ///
    /// # Examples
    ///
    /// ```rust
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
    /// assert_eq!(ev.event_type, "transaction.created");
    /// assert!(!ev.id.is_empty()); // a UUID was generated
    /// ```
    pub fn new(
        sequence: i64,
        event_type: impl Into<String>,
        subject: impl Into<String>,
        payload: serde_json::Value,
        provenance: Provenance,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            sequence,
            event_type: event_type.into(),
            subject: subject.into(),
            payload,
            provenance,
            created_at_ms: now_ms(),
        }
    }
}

/// The typed error surface of the kernel core.
///
/// Every fallible operation in this crate returns a `CoreError` rather than panicking,
/// so failures are values a caller must handle. Each variant is a specific, actionable
/// governance outcome — an illegal lifecycle edge, or one of the three closed authority
/// gates — and the `#[error(...)]` messages (via `thiserror`) render to human-readable
/// strings for logs and operator surfaces.
#[derive(Debug, Error)]
pub enum CoreError {
    /// A [`WorkTransaction::transition`] was requested along an edge not permitted by
    /// `is_valid_transition`. Carries the attempted `from`/`to` states.
    #[error("invalid transaction transition from {from:?} to {to:?}")]
    InvalidTransition {
        /// The state the transaction was in.
        from: TransactionState,
        /// The state that was illegally requested.
        to: TransactionState,
    },
    /// A mutating action was refused because a blocking [`Obligation`] is outstanding.
    #[error("blocking obligation {obligation_id}: {summary}")]
    BlockingObligation {
        /// The obligation that must be resolved.
        obligation_id: ObligationId,
        /// Its human-readable summary.
        summary: String,
    },
    /// A mutating action was refused because a [`HumanGate`] awaits acknowledgement.
    #[error("pending human gate: {label}")]
    PendingHumanGate {
        /// The label of the gate awaiting approval.
        label: String,
    },
    /// A mutating action was refused because the [`CapabilityEnvelope`] has expired.
    #[error("capability envelope expired")]
    CapabilityExpired,
}

/// Returns the current wall-clock time as Unix epoch milliseconds.
///
/// This is the crate's one concession to the outside world: a single, centralized clock
/// read. Every timestamp field in this crate (`*_at_ms`) is populated from here, which
/// keeps the time unit consistent (milliseconds) and gives one obvious place to reason
/// about time. Pure predicates like [`CapabilityEnvelope::is_expired_at`] deliberately
/// take an explicit instant instead of calling this, so they stay testable.
///
/// # Examples
///
/// ```rust
/// use pd_core::now_ms;
///
/// let a = now_ms();
/// let b = now_ms();
/// assert!(b >= a); // monotonic within a run (time does not go backwards here)
/// assert!(a > 1_600_000_000_000); // comfortably after 2020 in epoch millis
/// ```
pub fn now_ms() -> i64 {
    (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

/// Returns `true` if a transaction may legally move from `from` to `to`.
///
/// This function *is* the transaction state machine — the entire legal edge set is a
/// single `matches!` pattern, which makes the machine auditable at a glance and
/// impossible to extend by accident. Anything not listed is illegal. The permitted
/// edges:
///
/// - `Proposed → Ready | Cancelled`
/// - `Ready → Running | Blocked | Cancelled`
/// - `Blocked → Ready` (unblock and retry)
/// - `Running → Review | Failed | Cancelled`
/// - `Review → Completed | Running | Failed` (approve, request changes, or fail)
///
/// The terminal states (`Completed`, `Failed`, `Cancelled`) have no outgoing edges.
/// `is_valid_transition(s, s)` is `false` for every `s`: self-loops are not modeled as
/// legal transitions.
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
