//! Durable, SQLite-atomic one-use reservation for action capabilities.
//!
//! Replay truth lives in SQLite, not process memory. A unique `(issuer, nonce)`
//! reservation and `BEGIN IMMEDIATE` make two broker processes converge on one
//! authoritative result. Exact authenticated retries recover that original
//! result without creating fresh authority. Reservations are retained for a
//! fixed period beyond capability expiry, swept in a fixed-size batch, and
//! capped by a server-owned row ceiling.

use std::fs::{self, DirBuilder, OpenOptions, Permissions};
use std::io;
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};

use crate::capability::ActionCapability;

/// Replay tombstones remain after capability expiry so clock skew or delayed
/// deliveries cannot resurrect an already-spent bearer.
pub const REDEMPTION_RETENTION_MS: i64 = 24 * 60 * 60 * 1000;

/// Inspectable durable-ledger bounds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RedemptionLimits {
    pub max_records: i64,
    pub cleanup_batch: i64,
    pub retention_ms: i64,
}

/// Fixed server policy: at most 100k retained one-use facts, with at most 256
/// unrelated expired rows reclaimed by any redemption.
pub const REDEMPTION_LIMITS: RedemptionLimits = RedemptionLimits {
    max_records: 100_000,
    cleanup_batch: 256,
    retention_ms: REDEMPTION_RETENTION_MS,
};

const SQLITE_SIDECAR_SUFFIXES: [&str; 3] = ["-wal", "-shm", "-journal"];

/// Purpose bound into a one-use reservation. Reusing the same bearer for a
/// different purpose is a conflict, never a second authorization.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReservationKind {
    Action,
    Attenuation,
}

impl ReservationKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Action => "action",
            Self::Attenuation => "attenuation",
        }
    }

    fn parse(value: &str) -> Result<Self, RedemptionError> {
        match value {
            "action" => Ok(Self::Action),
            "attenuation" => Ok(Self::Attenuation),
            _ => Err(RedemptionError::CorruptMetadata),
        }
    }
}

/// Whether the caller has independently established current-time admission.
/// Expired capabilities may recover an existing result but can never create one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReservationAdmission {
    AllowNew,
    ReplayOnly,
}

/// One exact broker-authenticated reservation attempt. Grouping these fields
/// keeps the durable identity, purpose, replay admission, and server clock from
/// drifting across positional call sites.
pub struct ReservationRequest<'a> {
    pub capability: &'a ActionCapability,
    pub capability_digest: &'a str,
    pub kind: ReservationKind,
    pub request_digest: &'a str,
    pub new_result_expires_at_ms: Option<i64>,
    pub admission: ReservationAdmission,
    pub now_ms: i64,
}

/// Broker-owned durable facts needed to reconstruct the original response.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReservationRecord {
    pub reserved_at_ms: i64,
    pub result_expires_at_ms: Option<i64>,
    pub recover_until_ms: i64,
}

/// Durable result for one `(issuer, nonce)` reservation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RedemptionOutcome {
    Reserved(ReservationRecord),
    Replayed(ReservationRecord),
    Missing,
    NonceCollision,
    ReservationConflict,
}

/// Storage failure. Database internals are not returned over the broker wire.
#[derive(Debug, thiserror::Error)]
pub enum RedemptionError {
    #[error("redemption state path is unsafe: {0}")]
    UnsafePath(&'static str),
    #[error("redemption state filesystem is unavailable")]
    Filesystem(#[source] io::Error),
    #[error("redemption database unavailable")]
    Storage(#[source] rusqlite::Error),
    #[error("redemption retention overflow")]
    RetentionOverflow,
    #[error("redemption ledger reached its server-owned capacity")]
    Capacity,
    #[error("redemption ledger metadata is inconsistent")]
    CorruptMetadata,
    #[error("redemption clock regressed below its durable high-water mark")]
    ClockRegression,
    #[error("reservation request metadata is malformed")]
    MalformedReservation,
}

/// One SQLite connection to the shared redemption ledger. `Connection` is
/// process-local, while uniqueness and writer serialization are database-level.
pub struct RedemptionStore {
    connection: Connection,
    limits: RedemptionLimits,
}

impl std::fmt::Debug for RedemptionStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RedemptionStore")
            .field("connection", &"<redacted>")
            .field("limits", &self.limits)
            .finish()
    }
}

impl RedemptionStore {
    /// Open or initialize the durable ledger at `path`.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, RedemptionError> {
        Self::open_with_limits(path, REDEMPTION_LIMITS)
    }

    fn open_with_limits(
        path: impl AsRef<Path>,
        limits: RedemptionLimits,
    ) -> Result<Self, RedemptionError> {
        let path = prepare_state_path(path.as_ref())?;
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_NOFOLLOW;
        let connection =
            Connection::open_with_flags(&path, flags).map_err(RedemptionError::Storage)?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(RedemptionError::Storage)?;
        connection
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA synchronous = FULL;
                 CREATE TABLE IF NOT EXISTS action_capability_reservations (
                   id INTEGER PRIMARY KEY,
                   issuer TEXT NOT NULL,
                   nonce TEXT NOT NULL,
                   capability_digest TEXT NOT NULL,
                   use_kind TEXT NOT NULL,
                   request_digest TEXT NOT NULL,
                   reserved_at_ms INTEGER NOT NULL,
                   result_expires_at_ms INTEGER,
                   retain_until_ms INTEGER NOT NULL,
                   UNIQUE (issuer, nonce)
                 );
                 CREATE INDEX IF NOT EXISTS idx_action_capability_reservations_expiry
                   ON action_capability_reservations (retain_until_ms, id);
                 CREATE UNIQUE INDEX IF NOT EXISTS idx_action_capability_reservations_nonce
                   ON action_capability_reservations (issuer, nonce);
                 CREATE TABLE IF NOT EXISTS action_capability_redemption_state (
                   singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                   record_count INTEGER NOT NULL CHECK (record_count >= 0),
                   clock_high_water_ms INTEGER NOT NULL CHECK (clock_high_water_ms >= 0)
                 );
                 CREATE TRIGGER IF NOT EXISTS trg_action_capability_reservation_insert
                   AFTER INSERT ON action_capability_reservations
                   BEGIN
                     UPDATE action_capability_redemption_state
                       SET record_count = record_count + 1 WHERE singleton = 1;
                   END;
                 CREATE TRIGGER IF NOT EXISTS trg_action_capability_reservation_delete
                   AFTER DELETE ON action_capability_reservations
                   BEGIN
                     UPDATE action_capability_redemption_state
                       SET record_count = record_count - 1 WHERE singleton = 1;
                   END;",
            )
            .map_err(RedemptionError::Storage)?;
        secure_sqlite_artifacts(&path)?;

        // This is a new, unshipped table: there are no historical rows to scan or
        // backfill. Initialize metadata only when the ledger is empty. If rows
        // exist without metadata, fail closed rather than inventing a count.
        connection
            .execute(
                "INSERT OR IGNORE INTO action_capability_redemption_state
                   (singleton, record_count, clock_high_water_ms)
                 SELECT 1, 0, 0
                 WHERE NOT EXISTS (
                   SELECT 1 FROM action_capability_reservations LIMIT 1
                 )",
                [],
            )
            .map_err(RedemptionError::Storage)?;
        let has_state = connection
            .query_row(
                "SELECT 1 FROM action_capability_redemption_state WHERE singleton = 1",
                [],
                |_| Ok(()),
            )
            .optional()
            .map_err(RedemptionError::Storage)?
            .is_some();
        if !has_state {
            return Err(RedemptionError::CorruptMetadata);
        }

        Ok(Self { connection, limits })
    }

    /// Atomically reserve a capability nonce or recover its original result.
    /// The capability must already have passed structural, exact-scope, and
    /// HMAC authentication. `AllowNew` additionally means the broker verified
    /// current-time admission; `ReplayOnly` can only read an existing result.
    pub fn reserve(
        &mut self,
        request: ReservationRequest<'_>,
    ) -> Result<RedemptionOutcome, RedemptionError> {
        let ReservationRequest {
            capability,
            capability_digest,
            kind,
            request_digest,
            new_result_expires_at_ms,
            admission,
            now_ms,
        } = request;
        if !is_sha256_digest(capability_digest) || !is_sha256_digest(request_digest) {
            return Err(RedemptionError::MalformedReservation);
        }
        match (kind, admission, new_result_expires_at_ms) {
            (ReservationKind::Action, _, Some(_))
            | (ReservationKind::Attenuation, ReservationAdmission::AllowNew, None) => {
                return Err(RedemptionError::MalformedReservation);
            }
            _ => {}
        }
        let retain_until_ms = capability
            .expires_at_ms
            .checked_add(self.limits.retention_ms)
            .ok_or(RedemptionError::RetentionOverflow)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(RedemptionError::Storage)?;

        let clock_high_water_ms = tx
            .query_row(
                "SELECT clock_high_water_ms
                 FROM action_capability_redemption_state
                 WHERE singleton = 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(RedemptionError::Storage)?
            .ok_or(RedemptionError::CorruptMetadata)?;
        if now_ms <= 0 || now_ms < clock_high_water_ms {
            return Err(RedemptionError::ClockRegression);
        }
        // Persist the high-water in the same transaction before any cleanup.
        // A future wall-clock jump can therefore delete old tombstones only if
        // the durable clock also advances; a later rollback fails closed even
        // after process restart and cannot resurrect a spent bearer.
        tx.execute(
            "UPDATE action_capability_redemption_state
             SET clock_high_water_ms = ?1
             WHERE singleton = 1",
            params![now_ms],
        )
        .map_err(RedemptionError::Storage)?;

        // The requested key is authoritative even when more than one cleanup
        // batch has expired. It may be reused only after its own tombstone's
        // bounded retention elapsed.
        tx.execute(
            "DELETE FROM action_capability_reservations
             WHERE issuer = ?1 AND nonce = ?2 AND retain_until_ms <= ?3",
            params![capability.issuer, capability.nonce, now_ms],
        )
        .map_err(RedemptionError::Storage)?;

        // Reclaim only a fixed batch of unrelated history per hot-path call.
        tx.execute(
            "DELETE FROM action_capability_reservations
             WHERE id IN (
               SELECT id FROM action_capability_reservations
               WHERE retain_until_ms <= ?1
               ORDER BY retain_until_ms, id
               LIMIT ?2
             )",
            params![now_ms, self.limits.cleanup_batch],
        )
        .map_err(RedemptionError::Storage)?;

        let existing = tx
            .query_row(
                "SELECT capability_digest, use_kind, request_digest,
                        reserved_at_ms, result_expires_at_ms, retain_until_ms
                 FROM action_capability_reservations
                 WHERE issuer = ?1 AND nonce = ?2",
                params![capability.issuer, capability.nonce],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, Option<i64>>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                },
            )
            .optional()
            .map_err(RedemptionError::Storage)?;
        if let Some((
            existing_capability_digest,
            existing_kind,
            existing_request_digest,
            reserved_at_ms,
            result_expires_at_ms,
            existing_retain_until_ms,
        )) = existing
        {
            if !is_sha256_digest(&existing_capability_digest)
                || !is_sha256_digest(&existing_request_digest)
                || reserved_at_ms <= 0
                || existing_retain_until_ms <= reserved_at_ms
            {
                return Err(RedemptionError::CorruptMetadata);
            }
            let existing_kind = ReservationKind::parse(&existing_kind)?;
            if existing_capability_digest != capability_digest {
                tx.commit().map_err(RedemptionError::Storage)?;
                return Ok(RedemptionOutcome::NonceCollision);
            }
            if reserved_at_ms < capability.not_before_ms
                || reserved_at_ms >= capability.expires_at_ms
                || existing_retain_until_ms != retain_until_ms
            {
                return Err(RedemptionError::CorruptMetadata);
            }
            match (existing_kind, result_expires_at_ms) {
                (ReservationKind::Action, None) => {}
                (ReservationKind::Attenuation, Some(expires_at_ms))
                    if expires_at_ms > reserved_at_ms
                        && expires_at_ms <= capability.expires_at_ms => {}
                _ => return Err(RedemptionError::CorruptMetadata),
            }
            tx.commit().map_err(RedemptionError::Storage)?;
            if existing_kind != kind || existing_request_digest != request_digest {
                return Ok(RedemptionOutcome::ReservationConflict);
            }
            return Ok(RedemptionOutcome::Replayed(ReservationRecord {
                reserved_at_ms,
                result_expires_at_ms,
                recover_until_ms: existing_retain_until_ms,
            }));
        }

        if admission == ReservationAdmission::ReplayOnly {
            tx.commit().map_err(RedemptionError::Storage)?;
            return Ok(RedemptionOutcome::Missing);
        }

        let record_count = tx
            .query_row(
                "SELECT record_count FROM action_capability_redemption_state
                 WHERE singleton = 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(RedemptionError::Storage)?
            .ok_or(RedemptionError::CorruptMetadata)?;
        if record_count >= self.limits.max_records {
            return Err(RedemptionError::Capacity);
        }

        if new_result_expires_at_ms.is_some_and(|expires_at_ms| {
            expires_at_ms <= now_ms || expires_at_ms > capability.expires_at_ms
        }) {
            return Err(RedemptionError::MalformedReservation);
        }
        tx.execute(
            "INSERT INTO action_capability_reservations
               (issuer, nonce, capability_digest, use_kind, request_digest,
                reserved_at_ms, result_expires_at_ms, retain_until_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                capability.issuer,
                capability.nonce,
                capability_digest,
                kind.as_str(),
                request_digest,
                now_ms,
                new_result_expires_at_ms,
                retain_until_ms
            ],
        )
        .map_err(RedemptionError::Storage)?;
        tx.commit().map_err(RedemptionError::Storage)?;
        Ok(RedemptionOutcome::Reserved(ReservationRecord {
            reserved_at_ms: now_ms,
            result_expires_at_ms: new_result_expires_at_ms,
            recover_until_ms: retain_until_ms,
        }))
    }

    /// Read the trigger-maintained count in O(1), used by focused tests and
    /// operator diagnostics without scanning retained history.
    pub fn retained_count(&self) -> Result<i64, RedemptionError> {
        self.connection
            .query_row(
                "SELECT record_count FROM action_capability_redemption_state
                 WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .map_err(RedemptionError::Storage)
    }
}

fn is_sha256_digest(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn prepare_state_path(path: &Path) -> Result<PathBuf, RedemptionError> {
    if !path.is_absolute()
        || path.file_name().is_none()
        || path
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return Err(RedemptionError::UnsafePath(
            "database path must be absolute and normalized",
        ));
    }
    let parent = path
        .parent()
        .filter(|parent| parent != &Path::new("/"))
        .ok_or(RedemptionError::UnsafePath(
            "database must live below a private state directory",
        ))?;
    ensure_private_parent(parent)?;

    // macOS commonly exposes `/var` as a symlink to `/private/var`. The state
    // parent itself has already been checked with `symlink_metadata`; resolve
    // only its ancestor spelling before passing the path to SQLite NOFOLLOW.
    let canonical_parent = fs::canonicalize(parent).map_err(RedemptionError::Filesystem)?;
    ensure_private_parent(&canonical_parent)?;
    let secure_path = canonical_parent.join(
        path.file_name()
            .ok_or(RedemptionError::UnsafePath("database filename is missing"))?,
    );

    match fs::symlink_metadata(&secure_path) {
        Ok(metadata) => validate_owned_regular(&metadata)?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(RedemptionError::Filesystem(error)),
    }

    // Pre-create through O_NOFOLLOW with an owner-only mode. SQLite repeats the
    // no-follow check below; the private 0700 parent excludes other UIDs from
    // swapping the target between these operations. Same-UID possession remains
    // explicitly outside the confinement claim.
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(&secure_path)
        .map_err(RedemptionError::Filesystem)?;
    validate_owned_regular(&file.metadata().map_err(RedemptionError::Filesystem)?)?;
    file.set_permissions(Permissions::from_mode(0o600))
        .map_err(RedemptionError::Filesystem)?;
    for suffix in SQLITE_SIDECAR_SUFFIXES {
        secure_existing_file(&with_suffix(&secure_path, suffix), false)?;
    }
    Ok(secure_path)
}

fn ensure_private_parent(parent: &Path) -> Result<(), RedemptionError> {
    match fs::symlink_metadata(parent) {
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let mut builder = DirBuilder::new();
            builder.mode(0o700);
            match builder.create(parent) {
                Ok(()) => {}
                Err(create_error) if create_error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(create_error) => return Err(RedemptionError::Filesystem(create_error)),
            }
        }
        Err(error) => return Err(RedemptionError::Filesystem(error)),
    }
    let metadata = fs::symlink_metadata(parent).map_err(RedemptionError::Filesystem)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.permissions().mode() & 0o777 != 0o700
    {
        return Err(RedemptionError::UnsafePath(
            "state parent must be an owner-owned 0700 directory, not a symlink",
        ));
    }
    Ok(())
}

fn validate_owned_regular(metadata: &fs::Metadata) -> Result<(), RedemptionError> {
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.nlink() != 1
    {
        return Err(RedemptionError::UnsafePath(
            "database artifacts must be owner-owned regular files without links",
        ));
    }
    Ok(())
}

fn secure_sqlite_artifacts(path: &Path) -> Result<(), RedemptionError> {
    secure_existing_file(path, true)?;
    for suffix in SQLITE_SIDECAR_SUFFIXES {
        secure_existing_file(&with_suffix(path, suffix), false)?;
    }
    Ok(())
}

fn secure_existing_file(path: &Path, required: bool) -> Result<(), RedemptionError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => validate_owned_regular(&metadata)?,
        Err(error) if !required && error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(RedemptionError::Filesystem(error)),
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(RedemptionError::Filesystem)?;
    validate_owned_regular(&file.metadata().map_err(RedemptionError::Filesystem)?)?;
    file.set_permissions(Permissions::from_mode(0o600))
        .map_err(RedemptionError::Filesystem)
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    value.into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    use crate::capability::{
        capability_fingerprint, push_resource_digest, ActionCapabilitySigner, CredentialProvenance,
        MintedActionClaims,
    };

    fn private_db_path(root: &tempfile::TempDir, name: &str) -> PathBuf {
        let parent = root.path().join("broker-state");
        if !parent.exists() {
            fs::create_dir(&parent).unwrap();
        }
        fs::set_permissions(&parent, Permissions::from_mode(0o700)).unwrap();
        parent.join(name)
    }

    fn capability(nonce: &str, not_before_ms: i64, expires_at_ms: i64) -> ActionCapability {
        capability_for(nonce, "feat/x", not_before_ms, expires_at_ms)
    }

    fn capability_for(
        nonce: &str,
        branch: &str,
        not_before_ms: i64,
        expires_at_ms: i64,
    ) -> ActionCapability {
        ActionCapabilitySigner::new(b"redemption-test-key-is-at-least-32-bytes".to_vec())
            .unwrap()
            .mint(
                MintedActionClaims {
                    issuer: "port-daddy:broker".into(),
                    audience: "port-daddy:egress".into(),
                    operation: "push".into(),
                    actor: "01K3YR6M1WPZB8Q6V1J8K7D4MC".into(),
                    harbor: "tenant/repo".into(),
                    tenant: "tenant".into(),
                    resource_digest: push_resource_digest("tenant/repo", branch).unwrap(),
                },
                CredentialProvenance::macaroon(
                    crate::capability::resource_digest("test/credential/v1", &["grant"]).unwrap(),
                ),
                not_before_ms,
                expires_at_ms,
                nonce.into(),
            )
            .unwrap()
    }

    fn request_digest(capability: &ActionCapability) -> String {
        let fingerprint = capability_fingerprint(capability).unwrap();
        crate::capability::resource_digest("test/action-reservation-request/v1", &[&fingerprint])
            .unwrap()
    }

    fn reserve_action(
        store: &mut RedemptionStore,
        capability: &ActionCapability,
        now_ms: i64,
        admission: ReservationAdmission,
    ) -> Result<RedemptionOutcome, RedemptionError> {
        let fingerprint = capability_fingerprint(capability).unwrap();
        let request_digest = request_digest(capability);
        store.reserve(ReservationRequest {
            capability,
            capability_digest: &fingerprint,
            kind: ReservationKind::Action,
            request_digest: &request_digest,
            new_result_expires_at_ms: None,
            admission,
            now_ms,
        })
    }

    #[test]
    fn target_expiry_is_authoritative_beyond_cleanup_batch() {
        let dir = tempfile::tempdir().unwrap();
        let path = private_db_path(&dir, "redemptions.sqlite3");
        let limits = RedemptionLimits {
            max_records: 32,
            cleanup_batch: 2,
            retention_ms: 10,
        };
        let mut store = RedemptionStore::open_with_limits(&path, limits).unwrap();
        let now = 1_000;

        for index in 0..5_u8 {
            let cap = capability(&format!("{index:02x}{}", "ab".repeat(31)), 1, 1_000);
            assert!(matches!(
                reserve_action(&mut store, &cap, now - 1, ReservationAdmission::AllowNew).unwrap(),
                RedemptionOutcome::Reserved(_)
            ));
        }

        // This target sorts after the first fixed cleanup batch. Its exact-key
        // deletion still makes it reusable once retention has elapsed.
        let target = capability(&format!("ff{}", "ab".repeat(31)), 1, 1_000);
        assert!(matches!(
            reserve_action(&mut store, &target, now - 1, ReservationAdmission::AllowNew).unwrap(),
            RedemptionOutcome::Reserved(_)
        ));
        assert_eq!(
            reserve_action(
                &mut store,
                &target,
                now + 20,
                ReservationAdmission::ReplayOnly
            )
            .unwrap(),
            RedemptionOutcome::Missing
        );
        let replacement = capability_for(&target.nonce, "feat/reused", now + 1, now + 1_000);
        assert!(matches!(
            reserve_action(
                &mut store,
                &replacement,
                now + 20,
                ReservationAdmission::AllowNew
            )
            .unwrap(),
            RedemptionOutcome::Reserved(_)
        ));
    }

    #[test]
    fn forward_cleanup_then_restart_and_clock_rollback_cannot_resurrect_a_spent_bearer() {
        let dir = tempfile::tempdir().unwrap();
        let path = private_db_path(&dir, "redemptions.sqlite3");
        let limits = RedemptionLimits {
            max_records: 32,
            cleanup_batch: 2,
            retention_ms: 10,
        };
        let spent = capability(&"ab".repeat(32), 1_000, 2_000);
        let future = capability(&"cd".repeat(32), 2_000, 3_000);

        let mut first = RedemptionStore::open_with_limits(&path, limits).unwrap();
        assert!(matches!(
            reserve_action(&mut first, &spent, 1_001, ReservationAdmission::AllowNew).unwrap(),
            RedemptionOutcome::Reserved(_)
        ));
        // The forward observation is beyond the first tombstone's retention and
        // is therefore permitted to reclaim it, but the same transaction also
        // persists the durable clock high-water before cleanup.
        assert!(matches!(
            reserve_action(&mut first, &future, 2_011, ReservationAdmission::AllowNew).unwrap(),
            RedemptionOutcome::Reserved(_)
        ));
        assert_eq!(first.retained_count().unwrap(), 1);
        drop(first);

        let mut restarted = RedemptionStore::open_with_limits(&path, limits).unwrap();
        assert!(matches!(
            reserve_action(
                &mut restarted,
                &spent,
                1_002,
                ReservationAdmission::ReplayOnly
            ),
            Err(RedemptionError::ClockRegression)
        ));
        assert_eq!(restarted.retained_count().unwrap(), 1);
    }

    #[test]
    fn same_nonce_with_a_different_valid_capability_is_a_collision() {
        let dir = tempfile::tempdir().unwrap();
        let path = private_db_path(&dir, "redemptions.sqlite3");
        let mut store = RedemptionStore::open(&path).unwrap();
        let nonce = "ab".repeat(32);
        let first = capability(&nonce, 1_000, 2_000);
        let second = capability_for(&nonce, "feat/y", 1_000, 2_000);
        assert!(matches!(
            reserve_action(&mut store, &first, 1_001, ReservationAdmission::AllowNew).unwrap(),
            RedemptionOutcome::Reserved(_)
        ));
        assert_eq!(
            reserve_action(&mut store, &second, 1_002, ReservationAdmission::AllowNew).unwrap(),
            RedemptionOutcome::NonceCollision
        );
        assert_eq!(store.retained_count().unwrap(), 1);
    }

    #[test]
    fn clean_private_parent_is_created_and_database_sidecars_are_owner_only() {
        let root = tempfile::tempdir().unwrap();
        let parent = root.path().join("broker-state");
        let path = parent.join("redemptions.sqlite3");
        assert!(!parent.exists());

        let store = RedemptionStore::open(&path).unwrap();
        assert_eq!(store.retained_count().unwrap(), 0);
        assert_eq!(
            fs::symlink_metadata(&parent).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::symlink_metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        for suffix in ["-wal", "-shm"] {
            let sidecar = with_suffix(&path, suffix);
            assert!(sidecar.exists(), "expected {}", sidecar.display());
            assert_eq!(
                fs::symlink_metadata(sidecar).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn hostile_parent_symlink_and_mode_are_refused() {
        let root = tempfile::tempdir().unwrap();
        let real_parent = root.path().join("real-state");
        fs::create_dir(&real_parent).unwrap();
        fs::set_permissions(&real_parent, Permissions::from_mode(0o700)).unwrap();
        let linked_parent = root.path().join("linked-state");
        symlink(&real_parent, &linked_parent).unwrap();
        assert!(matches!(
            RedemptionStore::open(linked_parent.join("state.sqlite3")),
            Err(RedemptionError::UnsafePath(_))
        ));

        let broad_parent = root.path().join("broad-state");
        fs::create_dir(&broad_parent).unwrap();
        fs::set_permissions(&broad_parent, Permissions::from_mode(0o755)).unwrap();
        assert!(matches!(
            RedemptionStore::open(broad_parent.join("state.sqlite3")),
            Err(RedemptionError::UnsafePath(_))
        ));
    }

    #[test]
    fn symlink_and_non_regular_database_artifacts_are_refused() {
        let root = tempfile::tempdir().unwrap();
        let parent = root.path().join("broker-state");
        fs::create_dir(&parent).unwrap();
        fs::set_permissions(&parent, Permissions::from_mode(0o700)).unwrap();
        let victim = parent.join("victim");
        fs::write(&victim, b"not a database").unwrap();
        let linked_db = parent.join("linked.sqlite3");
        symlink(&victim, &linked_db).unwrap();
        assert!(matches!(
            RedemptionStore::open(&linked_db),
            Err(RedemptionError::UnsafePath(_))
        ));

        let directory_db = parent.join("directory.sqlite3");
        fs::create_dir(&directory_db).unwrap();
        assert!(matches!(
            RedemptionStore::open(&directory_db),
            Err(RedemptionError::UnsafePath(_))
        ));

        let sidecar_db = parent.join("sidecar.sqlite3");
        let hostile_wal = with_suffix(&sidecar_db, "-wal");
        symlink(&victim, &hostile_wal).unwrap();
        assert!(matches!(
            RedemptionStore::open(&sidecar_db),
            Err(RedemptionError::UnsafePath(_))
        ));
    }

    #[test]
    fn permissive_existing_database_is_repaired_before_sqlite_use() {
        let root = tempfile::tempdir().unwrap();
        let parent = root.path().join("broker-state");
        fs::create_dir(&parent).unwrap();
        fs::set_permissions(&parent, Permissions::from_mode(0o700)).unwrap();
        let path = parent.join("state.sqlite3");
        fs::write(&path, []).unwrap();
        fs::set_permissions(&path, Permissions::from_mode(0o666)).unwrap();

        let store = RedemptionStore::open(&path).unwrap();
        assert_eq!(store.retained_count().unwrap(), 0);
        assert_eq!(
            fs::symlink_metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn capacity_is_fixed_and_expired_rows_are_reclaimed_in_a_bounded_batch() {
        let dir = tempfile::tempdir().unwrap();
        let path = private_db_path(&dir, "redemptions.sqlite3");
        let limits = RedemptionLimits {
            max_records: 3,
            cleanup_batch: 1,
            retention_ms: 10,
        };
        let mut store = RedemptionStore::open_with_limits(&path, limits).unwrap();
        for index in 0..3_u8 {
            let cap = capability(&format!("{index:02x}{}", "cd".repeat(31)), 1, 1_000);
            assert!(matches!(
                reserve_action(&mut store, &cap, 999, ReservationAdmission::AllowNew).unwrap(),
                RedemptionOutcome::Reserved(_)
            ));
        }
        let overflow = capability(&format!("ff{}", "cd".repeat(31)), 1, 2_000);
        assert!(matches!(
            reserve_action(&mut store, &overflow, 999, ReservationAdmission::AllowNew),
            Err(RedemptionError::Capacity)
        ));

        // At t=1011 all three old records are expired, but one hot-path call
        // reclaims only the configured batch of one before admitting the new row.
        assert!(matches!(
            reserve_action(&mut store, &overflow, 1_011, ReservationAdmission::AllowNew).unwrap(),
            RedemptionOutcome::Reserved(_)
        ));
        assert_eq!(store.retained_count().unwrap(), 3);
    }
}
