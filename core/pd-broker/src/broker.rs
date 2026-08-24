//! Credential custody, authenticated capability minting, and durable redemption.
//!
//! Transport facts never enter authority resolution. The only successful mint
//! paths are a verified existing push macaroon or a verified, atomically consumed
//! parent capability. Native operator bootstrap is an explicit typed refusal
//! until a code-signed/Keychain credential lane exists.

use std::collections::HashSet;
use std::path::PathBuf;

use pd_anchor::keystore;
use pd_anchor::macaroon::{
    matches_actor_bound_push_grant_identifier, Caveat, Macaroon, RequestContext,
};
use sha2::{Digest, Sha256};

use crate::capability::{
    action_id, capability_fingerprint, push_resource_digest, resource_digest,
    validate_actor_principal, validate_identity, validate_intent, validate_time, ActionCapability,
    ActionCapabilitySigner, ActionExpectation, ActionIntent, CapabilityError, CredentialProvenance,
    MintedActionClaims, MAX_CAPABILITY_TTL_MS,
};
use crate::protocol::{
    ActionReservation, BootstrapRequirement, MintAuthority, RefusalCode, Request, RequestCtx,
    Response, ACTION_RESERVATION_DOMAIN, ACTION_RESERVATION_SCHEMA_VERSION,
};
use crate::redemption::{
    RedemptionError, RedemptionOutcome, RedemptionStore, ReservationAdmission, ReservationKind,
    ReservationRecord,
};

const ACTION_RESERVATION_REQUEST_DOMAIN: &str = "port-daddy/action-reservation-request/v1";
const ATTENUATION_REQUEST_DOMAIN: &str = "port-daddy/action-attenuation-request/v1";
const ATTENUATION_NONCE_DOMAIN: &str = "port-daddy/action-attenuation-nonce/v1";
const PUSH_OPERATION: &str = "push";

/// Inspectable pre-crypto bounds for macaroon credentials and server audience
/// configuration.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BrokerCredentialLimits {
    pub max_allowed_audiences: usize,
    pub max_discharges: usize,
    pub max_caveats_per_macaroon: usize,
    pub max_total_caveats: usize,
    pub max_macaroon_location_bytes: usize,
    pub max_macaroon_identifier_bytes: usize,
    pub max_caveat_id_bytes: usize,
    pub max_caveat_location_bytes: usize,
    pub max_request_context_bytes: usize,
}

/// Server-owned bounds applied before pd-anchor performs any HMAC chain work.
pub const BROKER_CREDENTIAL_LIMITS: BrokerCredentialLimits = BrokerCredentialLimits {
    max_allowed_audiences: 16,
    max_discharges: 16,
    max_caveats_per_macaroon: 64,
    max_total_caveats: 256,
    max_macaroon_location_bytes: 512,
    max_macaroon_identifier_bytes: 256,
    max_caveat_id_bytes: 1_024,
    max_caveat_location_bytes: 512,
    max_request_context_bytes: 2_048,
};

/// Protected credential storage. It is neither serializable nor readable from a
/// response-building path.
pub struct SecretVault {
    secret: Vec<u8>,
}

impl SecretVault {
    pub fn new(secret: impl Into<Vec<u8>>) -> Self {
        Self {
            secret: secret.into(),
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.secret.len()
    }
}

impl std::fmt::Debug for SecretVault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SecretVault(<{} bytes redacted>)", self.secret.len())
    }
}

/// Immutable broker configuration. All fields originate at broker startup, not
/// on an action request.
pub struct BrokerConfig {
    pub secret: Vec<u8>,
    pub capability_signing_key: Vec<u8>,
    pub capability_ttl_ms: i64,
    pub issuer: String,
    pub allowed_audiences: Vec<String>,
    pub redemption_db_path: PathBuf,
}

/// The credential broker state for one SQLite connection.
pub struct Broker {
    vault: SecretVault,
    capability_signer: ActionCapabilitySigner,
    capability_ttl_ms: i64,
    issuer: String,
    allowed_audiences: HashSet<String>,
    redemptions: RedemptionStore,
}

#[derive(Debug, thiserror::Error)]
pub enum BrokerError {
    #[error("secret is empty")]
    EmptySecret,
    #[error(transparent)]
    Capability(#[from] CapabilityError),
    #[error("capability TTL must be between 1 and {MAX_CAPABILITY_TTL_MS}ms")]
    InvalidCapabilityTtl,
    #[error("allowed audiences must be unique, bounded, and include the broker issuer")]
    InvalidAudiences,
    #[error(transparent)]
    Redemption(#[from] RedemptionError),
}

impl Broker {
    /// Construct a broker and open its durable redemption ledger.
    pub fn new(config: BrokerConfig) -> Result<Self, BrokerError> {
        if config.secret.is_empty() {
            return Err(BrokerError::EmptySecret);
        }
        if !(1..=MAX_CAPABILITY_TTL_MS).contains(&config.capability_ttl_ms) {
            return Err(BrokerError::InvalidCapabilityTtl);
        }
        validate_identity(&config.issuer, "issuer")?;
        if config.allowed_audiences.is_empty()
            || config.allowed_audiences.len() > BROKER_CREDENTIAL_LIMITS.max_allowed_audiences
        {
            return Err(BrokerError::InvalidAudiences);
        }
        let mut allowed_audiences = HashSet::new();
        for audience in &config.allowed_audiences {
            validate_identity(audience, "audience")?;
            if !allowed_audiences.insert(audience.clone()) {
                return Err(BrokerError::InvalidAudiences);
            }
        }
        // A parent capability must explicitly target this broker before it can
        // authorize attenuation.
        if !allowed_audiences.contains(&config.issuer) {
            return Err(BrokerError::InvalidAudiences);
        }

        Ok(Self {
            vault: SecretVault::new(config.secret),
            capability_signer: ActionCapabilitySigner::new(config.capability_signing_key)?,
            capability_ttl_ms: config.capability_ttl_ms,
            issuer: config.issuer,
            allowed_audiences,
            redemptions: RedemptionStore::open(config.redemption_db_path)?,
        })
    }

    /// Number of protected bytes held internally. The bytes themselves have no
    /// response-reachable accessor.
    pub fn secret_len(&self) -> usize {
        self.vault.len()
    }

    /// Handle one request with an injected trusted clock.
    pub fn handle(&mut self, request: Request, now_ms: i64) -> Response {
        match request {
            Request::Ping => Response::Pong,
            Request::MintActionCapability { authority, intent } => {
                self.mint_action(*authority, *intent, now_ms)
            }
            Request::RedeemActionCapability {
                capability,
                expected,
            } => self.redeem_action(&capability, &expected, now_ms),
        }
    }

    /// O(1) retained-row diagnostic used by tests and operator instrumentation.
    pub fn retained_redemptions(&self) -> Result<i64, RedemptionError> {
        self.redemptions.retained_count()
    }

    fn mint_action(
        &mut self,
        authority: MintAuthority,
        intent: ActionIntent,
        now_ms: i64,
    ) -> Response {
        if now_ms <= 0 {
            return Response::refused(RefusalCode::Malformed, "broker clock is unavailable");
        }
        if let Err(error) = self.validate_intent_and_audience(&intent) {
            return capability_refusal(error);
        }

        match authority {
            MintAuthority::Macaroon {
                grant,
                discharges,
                ctx,
            } => self.mint_from_macaroon(&grant, &discharges, &ctx, intent, now_ms),
            MintAuthority::BrokerCapability { capability } => {
                self.attenuate_capability(&capability, intent, now_ms)
            }
            MintAuthority::NativeOperatorBootstrap => Response::BootstrapRequired {
                requirement: BootstrapRequirement::CodeSignedKeychainOperatorCredential,
                reason: "native operator capability minting requires a separately authenticated code-signed/Keychain credential; transport locality grants no authority".into(),
            },
        }
    }

    fn mint_from_macaroon(
        &mut self,
        grant: &Macaroon,
        discharges: &[Macaroon],
        ctx: &RequestCtx,
        intent: ActionIntent,
        now_ms: i64,
    ) -> Response {
        // Bound every attacker-controlled credential collection/string before
        // pd-anchor performs chained HMAC work.
        if let Err(reason) = preflight_macaroon_bundle(grant, discharges) {
            return Response::refused(RefusalCode::Malformed, reason);
        }
        if let Err(reason) = preflight_request_ctx(ctx) {
            return Response::refused(RefusalCode::Malformed, reason);
        }
        if ctx.op.as_deref() != Some(intent.operation.as_str()) {
            return Response::refused(
                RefusalCode::ScopeMismatch,
                "action operation does not match the macaroon request context",
            );
        }
        // The only current daemon-owned exact-resource adapter is Git push.
        // A caller-chosen digest is not authority for a future operation; each
        // additional operation must land with its own typed adapter or signed
        // exact-resource caveat before this gate is widened.
        if intent.operation != PUSH_OPERATION {
            return Response::refused(
                RefusalCode::Unauthorized,
                "macaroon authority currently supports only the exact push action adapter",
            );
        }
        let Some(repo) = ctx.repo.as_deref() else {
            return Response::refused(RefusalCode::Malformed, "push repo is required");
        };
        let Some(branch) = ctx.branch.as_deref() else {
            return Response::refused(RefusalCode::Malformed, "push branch is required");
        };
        let Some(actor) = ctx.actor.as_deref() else {
            return Response::refused(RefusalCode::Malformed, "canonical action actor is required");
        };
        if let Err(error) = validate_actor_principal(actor) {
            return capability_refusal(error);
        }
        let Some(session) = ctx.session.as_deref() else {
            return Response::refused(RefusalCode::Malformed, "action session is required");
        };
        if !matches_actor_bound_push_grant_identifier(grant, actor, repo, session) {
            return Response::refused(
                RefusalCode::Unauthorized,
                "macaroon is not a daemon-minted actor-bound push authority",
            );
        }

        // These exact caveats must agree with the root-signed actor-bound
        // identifier above. Presence alone would be insufficient because a
        // bearer may append attenuating caveats; the identifier is what makes
        // actor/tenant/harbor derivation issuer-backed rather than self-asserted.
        for required in [
            format!("op = {}", intent.operation),
            format!("repo = {repo}"),
            format!("actor = {actor}"),
            format!("session = {session}"),
        ] {
            if !has_exact_first_party_caveat(grant, &required) {
                return Response::refused(
                    RefusalCode::Unauthorized,
                    "macaroon lacks an exact required scope caveat",
                );
            }
        }

        let expected_resource = match push_resource_digest(repo, branch) {
            Ok(digest) => digest,
            Err(error) => return capability_refusal(error),
        };
        if intent.resource_digest != expected_resource {
            return Response::refused(
                RefusalCode::ScopeMismatch,
                "push resource digest does not match the exact repo and branch",
            );
        }
        let Some((tenant, repo_name)) = repo.split_once('/') else {
            return Response::refused(
                RefusalCode::Malformed,
                "push repository must be tenant-qualified",
            );
        };
        if tenant.is_empty() || repo_name.is_empty() || repo_name.contains('/') {
            return Response::refused(
                RefusalCode::Malformed,
                "push repository must have canonical tenant/repository form",
            );
        }

        let request_context = RequestContext {
            op: ctx.op.clone(),
            repo: ctx.repo.clone(),
            branch: ctx.branch.clone(),
            host: ctx.host.clone(),
            spend_usd: ctx.spend_usd,
            session: ctx.session.clone(),
            now_ms,
        };
        // Key custody and actor provenance remain in pd-anchor. No caller or
        // broker startup option can inject a root/discharge key or substitute a
        // session/alias for the daemon-minted actor stored with this grant.
        let outcome = keystore::authorize(grant, discharges, actor, &request_context);
        if !outcome.ok {
            return Response::refused(RefusalCode::Unauthorized, outcome.reason);
        }

        let Some(credential_expiry) = credential_expiry_ceiling(grant, discharges) else {
            return Response::refused(
                RefusalCode::Unauthorized,
                "verified push credential lacks a bounded expiry",
            );
        };
        let Some(server_expiry) = now_ms.checked_add(self.capability_ttl_ms) else {
            return Response::refused(RefusalCode::Internal, "capability clock overflow");
        };
        let expires_at_ms = server_expiry.min(credential_expiry);
        if expires_at_ms <= now_ms {
            return Response::refused(RefusalCode::Expired, "mint authority has expired");
        }
        let credential_digest = macaroon_bundle_digest(grant, discharges);
        self.mint_resolved(
            MintedActionClaims {
                issuer: self.issuer.clone(),
                audience: intent.audience,
                operation: intent.operation,
                actor: actor.to_owned(),
                harbor: repo.to_owned(),
                tenant: tenant.to_owned(),
                resource_digest: intent.resource_digest,
            },
            CredentialProvenance::macaroon(credential_digest),
            now_ms,
            expires_at_ms,
        )
    }

    fn attenuate_capability(
        &mut self,
        parent: &ActionCapability,
        intent: ActionIntent,
        now_ms: i64,
    ) -> Response {
        // Parent audience is fixed to this issuer: merely possessing an action
        // addressed to another service cannot turn it into a mint credential.
        let expected_parent = ActionExpectation {
            issuer: self.issuer.clone(),
            audience: self.issuer.clone(),
            operation: parent.operation.clone(),
            actor: parent.actor.clone(),
            harbor: parent.harbor.clone(),
            tenant: parent.tenant.clone(),
            resource_digest: parent.resource_digest.clone(),
        };
        if let Err(error) = self
            .capability_signer
            .authenticate(parent, &expected_parent)
        {
            return capability_refusal(error);
        }
        if intent.operation != parent.operation || intent.resource_digest != parent.resource_digest
        {
            return Response::refused(
                RefusalCode::ScopeMismatch,
                "attenuation cannot change operation or resource",
            );
        }
        let parent_digest = match capability_fingerprint(parent) {
            Ok(digest) => digest,
            Err(error) => return capability_refusal(error),
        };
        let request_digest = match attenuation_request_digest(&parent_digest, &intent) {
            Ok(digest) => digest,
            Err(error) => return capability_refusal(error),
        };
        let (admission, new_result_expires_at_ms) = match validate_time(parent, now_ms) {
            Ok(()) => {
                let Some(server_expiry) = now_ms.checked_add(self.capability_ttl_ms) else {
                    return Response::refused(RefusalCode::Internal, "capability clock overflow");
                };
                let expires_at_ms = server_expiry.min(parent.expires_at_ms);
                if expires_at_ms <= now_ms {
                    return Response::refused(
                        RefusalCode::Expired,
                        "parent capability has expired",
                    );
                }
                // Prove the deterministic result is constructible before the
                // one-use transaction commits. After a crash, the durable
                // timestamps below reconstruct these exact bytes.
                if let Err(error) = self.build_attenuated_capability(
                    parent,
                    &intent,
                    &parent_digest,
                    &request_digest,
                    now_ms,
                    expires_at_ms,
                ) {
                    return capability_refusal(error);
                }
                (ReservationAdmission::AllowNew, Some(expires_at_ms))
            }
            Err(CapabilityError::Expired) => (ReservationAdmission::ReplayOnly, None),
            Err(error) => return capability_refusal(error),
        };

        match self.redemptions.reserve(
            parent,
            &parent_digest,
            ReservationKind::Attenuation,
            &request_digest,
            new_result_expires_at_ms,
            admission,
            now_ms,
        ) {
            Ok(RedemptionOutcome::Reserved(record)) => self.attenuated_capability_response(
                parent,
                &intent,
                &parent_digest,
                &request_digest,
                record,
                false,
            ),
            Ok(RedemptionOutcome::Replayed(record)) => self.attenuated_capability_response(
                parent,
                &intent,
                &parent_digest,
                &request_digest,
                record,
                true,
            ),
            Ok(RedemptionOutcome::Missing) => capability_refusal(CapabilityError::Expired),
            Ok(RedemptionOutcome::NonceCollision) => Response::refused(
                RefusalCode::NonceCollision,
                "parent capability nonce conflicts with another bearer",
            ),
            Ok(RedemptionOutcome::ReservationConflict) => Response::refused(
                RefusalCode::ReservationConflict,
                "parent capability is reserved for a different exact request",
            ),
            Err(error) => redemption_refusal(error),
        }
    }

    fn attenuated_capability_response(
        &self,
        parent: &ActionCapability,
        intent: &ActionIntent,
        parent_digest: &str,
        request_digest: &str,
        record: ReservationRecord,
        replayed: bool,
    ) -> Response {
        let Some(expires_at_ms) = record.result_expires_at_ms else {
            return Response::refused(
                RefusalCode::StorageUnavailable,
                "durable reservation state is unavailable",
            );
        };
        match self.build_attenuated_capability(
            parent,
            intent,
            parent_digest,
            request_digest,
            record.reserved_at_ms,
            expires_at_ms,
        ) {
            Ok(capability) => Response::Capability {
                capability: Box::new(capability),
                replayed,
            },
            Err(_) => Response::refused(
                RefusalCode::StorageUnavailable,
                "durable reservation result cannot be reconstructed",
            ),
        }
    }

    fn build_attenuated_capability(
        &self,
        parent: &ActionCapability,
        intent: &ActionIntent,
        parent_digest: &str,
        request_digest: &str,
        reserved_at_ms: i64,
        expires_at_ms: i64,
    ) -> Result<ActionCapability, CapabilityError> {
        let reserved_at = reserved_at_ms.to_string();
        let nonce_digest = resource_digest(
            ATTENUATION_NONCE_DOMAIN,
            &[parent_digest, request_digest, &reserved_at],
        )?;
        let nonce = nonce_digest
            .strip_prefix("sha256:")
            .ok_or(CapabilityError::Malformed("attenuation nonce"))?
            .to_owned();
        self.capability_signer.mint(
            MintedActionClaims {
                issuer: self.issuer.clone(),
                audience: intent.audience.clone(),
                operation: intent.operation.clone(),
                actor: parent.actor.clone(),
                harbor: parent.harbor.clone(),
                tenant: parent.tenant.clone(),
                resource_digest: intent.resource_digest.clone(),
            },
            CredentialProvenance::broker_capability(parent_digest.to_owned()),
            reserved_at_ms,
            expires_at_ms,
            nonce,
        )
    }

    fn mint_resolved(
        &self,
        claims: MintedActionClaims,
        provenance: CredentialProvenance,
        now_ms: i64,
        expires_at_ms: i64,
    ) -> Response {
        let nonce = match random_nonce() {
            Ok(nonce) => nonce,
            Err(response) => return response,
        };
        match self
            .capability_signer
            .mint(claims, provenance, now_ms, expires_at_ms, nonce)
        {
            Ok(capability) => Response::Capability {
                capability: Box::new(capability),
                replayed: false,
            },
            Err(error) => capability_refusal(error),
        }
    }

    fn redeem_action(
        &mut self,
        capability: &ActionCapability,
        expected: &ActionExpectation,
        now_ms: i64,
    ) -> Response {
        if expected.issuer != self.issuer || !self.allowed_audiences.contains(&expected.audience) {
            return Response::refused(
                RefusalCode::ScopeMismatch,
                "redemption issuer or audience is not configured for this broker",
            );
        }
        if let Err(error) = self.capability_signer.authenticate(capability, expected) {
            return capability_refusal(error);
        }
        let admission = match validate_time(capability, now_ms) {
            Ok(()) => ReservationAdmission::AllowNew,
            Err(CapabilityError::Expired) => ReservationAdmission::ReplayOnly,
            Err(error) => return capability_refusal(error),
        };
        let digest = match capability_fingerprint(capability) {
            Ok(digest) => digest,
            Err(error) => return capability_refusal(error),
        };
        let request_digest = match action_reservation_request_digest(&digest, expected) {
            Ok(digest) => digest,
            Err(error) => return capability_refusal(error),
        };
        match self.redemptions.reserve(
            capability,
            &digest,
            ReservationKind::Action,
            &request_digest,
            None,
            admission,
            now_ms,
        ) {
            Ok(RedemptionOutcome::Reserved(record)) => {
                action_reserved_response(capability, &digest, record, false)
            }
            Ok(RedemptionOutcome::Replayed(record)) => {
                action_reserved_response(capability, &digest, record, true)
            }
            Ok(RedemptionOutcome::Missing) => capability_refusal(CapabilityError::Expired),
            Ok(RedemptionOutcome::NonceCollision) => Response::refused(
                RefusalCode::NonceCollision,
                "action capability nonce conflicts with another bearer",
            ),
            Ok(RedemptionOutcome::ReservationConflict) => Response::refused(
                RefusalCode::ReservationConflict,
                "action capability is reserved for a different exact request",
            ),
            Err(error) => redemption_refusal(error),
        }
    }

    fn validate_intent_and_audience(&self, intent: &ActionIntent) -> Result<(), CapabilityError> {
        validate_intent(intent)?;
        if !self.allowed_audiences.contains(&intent.audience) {
            return Err(CapabilityError::ScopeMismatch("audience"));
        }
        Ok(())
    }
}

fn action_reservation_request_digest(
    capability_digest: &str,
    expected: &ActionExpectation,
) -> Result<String, CapabilityError> {
    resource_digest(
        ACTION_RESERVATION_REQUEST_DOMAIN,
        &[
            capability_digest,
            &expected.issuer,
            &expected.audience,
            &expected.operation,
            &expected.actor,
            &expected.harbor,
            &expected.tenant,
            &expected.resource_digest,
        ],
    )
}

fn attenuation_request_digest(
    parent_digest: &str,
    intent: &ActionIntent,
) -> Result<String, CapabilityError> {
    resource_digest(
        ATTENUATION_REQUEST_DOMAIN,
        &[
            parent_digest,
            &intent.audience,
            &intent.operation,
            &intent.resource_digest,
        ],
    )
}

fn action_reserved_response(
    capability: &ActionCapability,
    capability_digest: &str,
    record: ReservationRecord,
    replayed: bool,
) -> Response {
    let action_id = match action_id(&capability.issuer, &capability.action_digest) {
        Ok(action_id) => action_id,
        Err(error) => return capability_refusal(error),
    };
    Response::ActionReserved {
        reservation: Box::new(ActionReservation {
            schema_version: ACTION_RESERVATION_SCHEMA_VERSION,
            domain: ACTION_RESERVATION_DOMAIN.into(),
            action_id,
            capability_digest: capability_digest.to_owned(),
            action_digest: capability.action_digest.clone(),
            issuer: capability.issuer.clone(),
            audience: capability.audience.clone(),
            operation: capability.operation.clone(),
            actor: capability.actor.clone(),
            harbor: capability.harbor.clone(),
            tenant: capability.tenant.clone(),
            resource_digest: capability.resource_digest.clone(),
            credential_provenance: capability.credential_provenance.clone(),
            reserved_at_ms: record.reserved_at_ms,
            capability_expires_at_ms: capability.expires_at_ms,
            recover_until_ms: record.recover_until_ms,
        }),
        replayed,
    }
}

fn capability_refusal(error: CapabilityError) -> Response {
    let code = match &error {
        CapabilityError::NotYetValid => RefusalCode::NotYetValid,
        CapabilityError::Expired => RefusalCode::Expired,
        CapabilityError::ScopeMismatch(_) => RefusalCode::ScopeMismatch,
        CapabilityError::AuthenticationFailed => RefusalCode::Unauthorized,
        CapabilityError::UnsupportedVersion
        | CapabilityError::DomainMismatch
        | CapabilityError::Malformed(_)
        | CapabilityError::LifetimeOutOfBounds
        | CapabilityError::SigningKeyTooShort => RefusalCode::Malformed,
    };
    Response::refused(code, error.to_string())
}

fn redemption_refusal(error: RedemptionError) -> Response {
    match error {
        RedemptionError::Capacity => Response::refused(
            RefusalCode::Capacity,
            "redemption ledger reached its server-owned capacity",
        ),
        RedemptionError::ClockRegression => Response::refused(
            RefusalCode::ClockRegression,
            "redemption clock is behind durable state",
        ),
        RedemptionError::UnsafePath(_)
        | RedemptionError::Filesystem(_)
        | RedemptionError::Storage(_)
        | RedemptionError::RetentionOverflow
        | RedemptionError::MalformedReservation
        | RedemptionError::CorruptMetadata => Response::refused(
            RefusalCode::StorageUnavailable,
            "durable redemption state is unavailable",
        ),
    }
}

fn random_nonce() -> Result<String, Response> {
    let mut bytes = [0_u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|_| {
        Response::refused(
            RefusalCode::Internal,
            "secure capability nonce generation failed",
        )
    })?;
    Ok(hex::encode(bytes))
}

fn preflight_request_ctx(ctx: &RequestCtx) -> Result<(), &'static str> {
    for value in [
        ctx.op.as_deref(),
        ctx.repo.as_deref(),
        ctx.branch.as_deref(),
        ctx.host.as_deref(),
        ctx.actor.as_deref(),
        ctx.session.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if !bounded_text(value, BROKER_CREDENTIAL_LIMITS.max_request_context_bytes) {
            return Err("request context contains a malformed or oversized field");
        }
    }
    if ctx
        .spend_usd
        .is_some_and(|spend| !spend.is_finite() || spend < 0.0)
    {
        return Err("request context spend must be finite and nonnegative");
    }
    Ok(())
}

fn preflight_macaroon_bundle(
    grant: &Macaroon,
    discharges: &[Macaroon],
) -> Result<(), &'static str> {
    if discharges.len() > BROKER_CREDENTIAL_LIMITS.max_discharges {
        return Err("too many discharge macaroons");
    }
    let total_caveats = grant.caveats.len().checked_add(
        discharges
            .iter()
            .map(|discharge| discharge.caveats.len())
            .sum(),
    );
    if total_caveats.is_none_or(|count| count > BROKER_CREDENTIAL_LIMITS.max_total_caveats) {
        return Err("too many total macaroon caveats");
    }
    validate_macaroon(grant)?;
    let mut identifiers = HashSet::new();
    for discharge in discharges {
        validate_macaroon(discharge)?;
        if !identifiers.insert(discharge.identifier.as_str()) {
            return Err("duplicate discharge macaroon identifier");
        }
    }
    Ok(())
}

fn validate_macaroon(macaroon: &Macaroon) -> Result<(), &'static str> {
    if !bounded_text(
        &macaroon.location,
        BROKER_CREDENTIAL_LIMITS.max_macaroon_location_bytes,
    ) || !bounded_text(
        &macaroon.identifier,
        BROKER_CREDENTIAL_LIMITS.max_macaroon_identifier_bytes,
    ) || macaroon.signature_hex.len() != 64
        || !is_lower_hex(&macaroon.signature_hex)
        || macaroon.caveats.len() > BROKER_CREDENTIAL_LIMITS.max_caveats_per_macaroon
    {
        return Err("malformed or oversized macaroon");
    }
    for caveat in &macaroon.caveats {
        validate_caveat(caveat)?;
    }
    Ok(())
}

fn validate_caveat(caveat: &Caveat) -> Result<(), &'static str> {
    if !bounded_text(&caveat.cid, BROKER_CREDENTIAL_LIMITS.max_caveat_id_bytes) {
        return Err("malformed or oversized macaroon caveat");
    }
    if let Some(vid) = &caveat.vid {
        if vid.len() != 64 || !is_lower_hex(vid) {
            return Err("malformed macaroon caveat commitment");
        }
    }
    if caveat.cl.as_deref().is_some_and(|location| {
        !bounded_text(location, BROKER_CREDENTIAL_LIMITS.max_caveat_location_bytes)
    }) {
        return Err("malformed or oversized macaroon caveat location");
    }
    Ok(())
}

fn has_exact_first_party_caveat(macaroon: &Macaroon, required: &str) -> bool {
    macaroon
        .caveats
        .iter()
        .any(|caveat| caveat.vid.is_none() && caveat.cid == required)
}

fn credential_expiry_ceiling(grant: &Macaroon, discharges: &[Macaroon]) -> Option<i64> {
    std::iter::once(grant)
        .chain(discharges.iter())
        .flat_map(|macaroon| macaroon.caveats.iter())
        .filter(|caveat| caveat.vid.is_none())
        .filter_map(|caveat| {
            let mut fields = caveat.cid.split_whitespace();
            match (fields.next(), fields.next(), fields.next(), fields.next()) {
                (Some("expires"), Some("="), Some(value), None) => value.parse::<i64>().ok(),
                _ => None,
            }
        })
        .min()
}

fn macaroon_bundle_digest(grant: &Macaroon, discharges: &[Macaroon]) -> String {
    let mut hasher = Sha256::new();
    hash_field(&mut hasher, "port-daddy/macaroon-provenance/v1");
    hash_macaroon(&mut hasher, grant);
    let mut ordered: Vec<&Macaroon> = discharges.iter().collect();
    ordered.sort_by(|left, right| left.identifier.cmp(&right.identifier));
    for discharge in ordered {
        hash_macaroon(&mut hasher, discharge);
    }
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn hash_macaroon(hasher: &mut Sha256, macaroon: &Macaroon) {
    for field in [
        macaroon.location.as_str(),
        macaroon.identifier.as_str(),
        macaroon.signature_hex.as_str(),
    ] {
        hash_field(hasher, field);
    }
    hasher.update((macaroon.caveats.len() as u32).to_be_bytes());
    for caveat in &macaroon.caveats {
        hash_field(hasher, &caveat.cid);
        hash_field(hasher, caveat.vid.as_deref().unwrap_or(""));
        hash_field(hasher, caveat.cl.as_deref().unwrap_or(""));
    }
}

fn hash_field(hasher: &mut Sha256, field: &str) {
    hasher.update((field.len() as u32).to_be_bytes());
    hasher.update(field.as_bytes());
}

fn bounded_text(value: &str, max_bytes: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_bytes
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn is_lower_hex(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
