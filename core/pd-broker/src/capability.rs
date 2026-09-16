//! Versioned, domain-separated action capabilities issued by `pd-broker`.
//!
//! The capability is deliberately generic: the existing Git push operation is
//! one action, while future tenant-scoped Relay or remote operator adapters can
//! carry the same envelope after explicit attenuation. Every security-relevant
//! claim is inside the HMAC preimage. Callers cannot choose the issuer, clock,
//! nonce, or credential provenance; [`crate::broker::Broker`] derives them only
//! after authenticating the mint authority.

use hmac::{Hmac, Mac};
use pd_anchor::macaroon::is_canonical_actor_principal;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub use pd_anchor::macaroon::CANONICAL_ACTOR_ID_BYTES;

type HmacSha256 = Hmac<Sha256>;

/// Current wire schema. Unknown versions fail closed; there is no compatibility
/// parser because this capability has not shipped.
pub const ACTION_CAPABILITY_SCHEMA_VERSION: u16 = 1;

/// Cryptographic domain for capability tags. It is both carried in the envelope
/// and prepended to the signed preimage so a tag from another protocol cannot be
/// reinterpreted as an action capability.
pub const ACTION_CAPABILITY_DOMAIN: &str = "port-daddy/action-capability/v1";

/// Domain for the stable digest of an exact action scope.
pub const ACTION_DIGEST_DOMAIN: &str = "port-daddy/action-digest/v1";

/// Domain for the stable action identifier consumed by idempotent product
/// services. It deliberately excludes audience and bearer nonce so attenuation
/// and independently minted bearers for the same issuer/action converge.
pub const ACTION_ID_DOMAIN: &str = "port-daddy/action-id/v1";

/// Domain for the existing Git push resource adapter.
pub const PUSH_RESOURCE_DIGEST_DOMAIN: &str = "port-daddy/git-push-resource/v1";

/// Maximum lifetime of a minted action capability. This matches the existing
/// macaroon discharge window and is enforced at mint and verify time.
pub const MAX_CAPABILITY_TTL_MS: i64 = 20 * 60 * 1000;

/// Inspectable structural limits applied before HMAC verification.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ActionCapabilityLimits {
    /// Issuer, audience, actor, harbor, and tenant identifiers.
    pub max_identity_bytes: usize,
    /// Operation identifier (for example `push` or `parley.resolve`).
    pub max_operation_bytes: usize,
    /// Domain passed to [`resource_digest`].
    pub max_resource_domain_bytes: usize,
    /// Number of structural fields accepted by [`resource_digest`].
    pub max_resource_fields: usize,
    /// Maximum bytes in any one structural resource field.
    pub max_resource_field_bytes: usize,
    /// Fixed random nonce hex length.
    pub nonce_hex_bytes: usize,
    /// Fixed HMAC tag hex length.
    pub tag_hex_bytes: usize,
}

/// Conservative server-owned bounds. They are intentionally constants rather
/// than request options so a caller cannot buy unbounded hashing or storage.
pub const ACTION_CAPABILITY_LIMITS: ActionCapabilityLimits = ActionCapabilityLimits {
    max_identity_bytes: 256,
    max_operation_bytes: 96,
    max_resource_domain_bytes: 128,
    max_resource_fields: 16,
    max_resource_field_bytes: 2_048,
    nonce_hex_bytes: 64,
    tag_hex_bytes: 64,
};

const SHA256_DIGEST_PREFIX: &str = "sha256:";
const SHA256_DIGEST_BYTES: usize = SHA256_DIGEST_PREFIX.len() + 64;

/// How the broker authenticated the authority that minted this capability.
/// Only a one-way digest is carried; the source credential itself is never
/// copied into the capability or its debug representation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CredentialProvenanceKind {
    Macaroon,
    BrokerCapability,
}

/// Strict provenance record. A struct is used instead of an internally tagged
/// enum because Serde permits stray fields on unit variants; `deny_unknown_fields`
/// here closes that ambiguity at the wire boundary.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CredentialProvenance {
    pub kind: CredentialProvenanceKind,
    pub credential_digest: String,
}

impl std::fmt::Debug for CredentialProvenance {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CredentialProvenance")
            .field("kind", &self.kind)
            .field("credential_digest", &"<redacted>")
            .finish()
    }
}

impl CredentialProvenance {
    fn digest(&self) -> &str {
        &self.credential_digest
    }

    fn kind_name(&self) -> &'static str {
        match self.kind {
            CredentialProvenanceKind::Macaroon => "macaroon",
            CredentialProvenanceKind::BrokerCapability => "broker-capability",
        }
    }

    pub(crate) fn macaroon(credential_digest: String) -> Self {
        Self {
            kind: CredentialProvenanceKind::Macaroon,
            credential_digest,
        }
    }

    pub(crate) fn broker_capability(credential_digest: String) -> Self {
        Self {
            kind: CredentialProvenanceKind::BrokerCapability,
            credential_digest,
        }
    }
}

/// The caller-selectable, attenuating portion of a mint request. Actor,
/// tenant, and harbor are deliberately absent: the authenticated authority
/// supplies those facts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionIntent {
    /// Service that may consume the capability. The broker checks a server-owned
    /// allowlist before minting.
    pub audience: String,
    /// Exact operation being authorized.
    pub operation: String,
    /// Canonical `sha256:<lower-hex>` digest of the exact target resource.
    pub resource_digest: String,
}

/// Exact public scope a consumer must supply when redeeming a capability.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionExpectation {
    pub issuer: String,
    pub audience: String,
    pub operation: String,
    /// Canonical daemon-minted actor ULID, never a session id or alias.
    pub actor: String,
    pub harbor: String,
    pub tenant: String,
    pub resource_digest: String,
}

/// Claims supplied internally to the signer after authority resolution.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MintedActionClaims {
    pub issuer: String,
    pub audience: String,
    pub operation: String,
    pub actor: String,
    pub harbor: String,
    pub tenant: String,
    pub resource_digest: String,
}

/// Signed bearer authorization for exactly one action. The HMAC tag is omitted
/// from `Debug` because a log line must never become a usable credential.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionCapability {
    pub schema_version: u16,
    pub domain: String,
    pub issuer: String,
    pub audience: String,
    pub operation: String,
    pub actor: String,
    pub harbor: String,
    pub tenant: String,
    pub resource_digest: String,
    pub action_digest: String,
    pub not_before_ms: i64,
    pub expires_at_ms: i64,
    pub nonce: String,
    pub credential_provenance: CredentialProvenance,
    pub tag_hex: String,
}

impl std::fmt::Debug for ActionCapability {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ActionCapability")
            .field("schema_version", &self.schema_version)
            .field("domain", &self.domain)
            .field("issuer", &self.issuer)
            .field("audience", &self.audience)
            .field("operation", &self.operation)
            .field("actor", &self.actor)
            .field("harbor", &self.harbor)
            .field("tenant", &self.tenant)
            .field("resource_digest", &self.resource_digest)
            .field("action_digest", &self.action_digest)
            .field("not_before_ms", &self.not_before_ms)
            .field("expires_at_ms", &self.expires_at_ms)
            .field("nonce", &self.nonce)
            .field("credential_provenance", &self.credential_provenance)
            .field("tag_hex", &"<redacted>")
            .finish()
    }
}

impl ActionCapability {
    /// Return the exact scope a consumer must independently expect.
    pub fn expectation(&self) -> ActionExpectation {
        ActionExpectation {
            issuer: self.issuer.clone(),
            audience: self.audience.clone(),
            operation: self.operation.clone(),
            actor: self.actor.clone(),
            harbor: self.harbor.clone(),
            tenant: self.tenant.clone(),
            resource_digest: self.resource_digest.clone(),
        }
    }
}

/// Validation or authentication failure. Errors intentionally name only the
/// failed public invariant and never include credential bytes or HMAC material.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum CapabilityError {
    #[error("capability signing key must contain at least 32 bytes")]
    SigningKeyTooShort,
    #[error("unsupported action capability schema version")]
    UnsupportedVersion,
    #[error("action capability domain mismatch")]
    DomainMismatch,
    #[error("malformed action capability field: {0}")]
    Malformed(&'static str),
    #[error("action capability lifetime exceeds the server limit")]
    LifetimeOutOfBounds,
    #[error("action capability is not yet valid")]
    NotYetValid,
    #[error("action capability has expired")]
    Expired,
    #[error("action capability scope mismatch: {0}")]
    ScopeMismatch(&'static str),
    #[error("action capability authentication failed")]
    AuthenticationFailed,
}

/// Broker-held HMAC signer/verifier. The key is never serializable or debuggable.
pub struct ActionCapabilitySigner {
    signing_key: Vec<u8>,
}

impl ActionCapabilitySigner {
    /// Construct a signer from at least 256 bits of independent secret material.
    pub fn new(signing_key: impl Into<Vec<u8>>) -> Result<Self, CapabilityError> {
        let signing_key = signing_key.into();
        if signing_key.len() < 32 {
            return Err(CapabilityError::SigningKeyTooShort);
        }
        Ok(Self { signing_key })
    }

    /// Mint a capability from authenticated claims and server-owned time/nonce.
    pub(crate) fn mint(
        &self,
        claims: MintedActionClaims,
        provenance: CredentialProvenance,
        not_before_ms: i64,
        expires_at_ms: i64,
        nonce: String,
    ) -> Result<ActionCapability, CapabilityError> {
        let action_digest = action_digest(
            &claims.operation,
            &claims.actor,
            &claims.harbor,
            &claims.tenant,
            &claims.resource_digest,
        )?;
        let mut capability = ActionCapability {
            schema_version: ACTION_CAPABILITY_SCHEMA_VERSION,
            domain: ACTION_CAPABILITY_DOMAIN.to_owned(),
            issuer: claims.issuer,
            audience: claims.audience,
            operation: claims.operation,
            actor: claims.actor,
            harbor: claims.harbor,
            tenant: claims.tenant,
            resource_digest: claims.resource_digest,
            action_digest,
            not_before_ms,
            expires_at_ms,
            nonce,
            credential_provenance: provenance,
            tag_hex: String::new(),
        };
        validate_structure(&capability, false)?;
        let tag = self.tag(&capability);
        capability.tag_hex = hex::encode(tag);
        Ok(capability)
    }

    /// Verify shape, exact consumer scope, HMAC tag, and current validity.
    /// Structural bounds run before any HMAC work. `verify_slice` performs the
    /// tag comparison in constant time.
    pub fn verify(
        &self,
        capability: &ActionCapability,
        expected: &ActionExpectation,
        now_ms: i64,
    ) -> Result<(), CapabilityError> {
        self.authenticate(capability, expected)?;
        validate_time(capability, now_ms)
    }

    /// Authenticate a bounded capability and its exact expected scope without
    /// admitting a new action at the caller's current time. The broker uses this
    /// narrower primitive only to look up an already durable reservation after a
    /// lost response; an absent reservation still requires [`Self::verify`].
    pub(crate) fn authenticate(
        &self,
        capability: &ActionCapability,
        expected: &ActionExpectation,
    ) -> Result<(), CapabilityError> {
        validate_structure(capability, true)?;
        validate_expectation(expected)?;
        compare_expectation(capability, expected)?;

        let presented = decode_fixed_lower_hex(&capability.tag_hex, "tag_hex")?;
        let mut mac = HmacSha256::new_from_slice(&self.signing_key)
            .expect("HMAC accepts every key length accepted by the constructor");
        mac.update(&capability_preimage(capability));
        mac.verify_slice(&presented)
            .map_err(|_| CapabilityError::AuthenticationFailed)
    }

    fn tag(&self, capability: &ActionCapability) -> [u8; 32] {
        let mut mac = HmacSha256::new_from_slice(&self.signing_key)
            .expect("HMAC accepts every key length accepted by the constructor");
        mac.update(&capability_preimage(capability));
        mac.finalize().into_bytes().into()
    }
}

/// Compute a domain-separated digest over an ordered list of exact resource
/// fields. Length prefixes prevent field-boundary ambiguity. Inputs are rejected
/// rather than truncated or normalized.
pub fn resource_digest(domain: &str, fields: &[&str]) -> Result<String, CapabilityError> {
    validate_text(
        domain,
        ACTION_CAPABILITY_LIMITS.max_resource_domain_bytes,
        "resource domain",
    )?;
    if fields.is_empty() || fields.len() > ACTION_CAPABILITY_LIMITS.max_resource_fields {
        return Err(CapabilityError::Malformed("resource fields"));
    }
    let mut bytes = Vec::new();
    push_field(&mut bytes, domain);
    for field in fields {
        validate_text(
            field,
            ACTION_CAPABILITY_LIMITS.max_resource_field_bytes,
            "resource field",
        )?;
        push_field(&mut bytes, field);
    }
    Ok(format!(
        "{SHA256_DIGEST_PREFIX}{}",
        hex::encode(Sha256::digest(bytes))
    ))
}

/// Canonical digest for the exact repository and concrete branch affected by a
/// Git push. This is the adapter that expresses the existing push operation in
/// the generalized contract.
pub fn push_resource_digest(repo: &str, branch: &str) -> Result<String, CapabilityError> {
    resource_digest(PUSH_RESOURCE_DIGEST_DOMAIN, &[repo, branch])
}

/// Stable digest of the exact action independent of transport audience. A Relay
/// or Slack projection can therefore attenuate audience/expiry without changing
/// the action identity, while the outer HMAC still binds those attenuations.
pub fn action_digest(
    operation: &str,
    actor: &str,
    harbor: &str,
    tenant: &str,
    resource_digest_value: &str,
) -> Result<String, CapabilityError> {
    validate_text(
        operation,
        ACTION_CAPABILITY_LIMITS.max_operation_bytes,
        "operation",
    )?;
    validate_actor_principal(actor)?;
    for (value, field) in [(harbor, "harbor"), (tenant, "tenant")] {
        validate_text(value, ACTION_CAPABILITY_LIMITS.max_identity_bytes, field)?;
    }
    validate_sha256_digest(resource_digest_value, "resource_digest")?;
    resource_digest(
        ACTION_DIGEST_DOMAIN,
        &[operation, actor, harbor, tenant, resource_digest_value],
    )
}

/// Stable, domain-separated product idempotency identifier for one issuer's
/// exact action. Audience and bearer nonce are intentionally absent: a broker
/// attenuation changes delivery scope, not the product action being performed.
pub fn action_id(issuer: &str, action_digest_value: &str) -> Result<String, CapabilityError> {
    validate_identity(issuer, "issuer")?;
    validate_sha256_digest(action_digest_value, "action_digest")?;
    resource_digest(ACTION_ID_DOMAIN, &[issuer, action_digest_value])
}

/// Stable digest of the entire signed bearer, used only as a replay/collision
/// identifier. The tag is included so two independently valid capabilities with
/// a nonce collision cannot be mistaken for the same redemption.
pub fn capability_fingerprint(capability: &ActionCapability) -> Result<String, CapabilityError> {
    validate_structure(capability, true)?;
    let mut bytes = capability_preimage(capability);
    push_field(&mut bytes, &capability.tag_hex);
    Ok(format!(
        "{SHA256_DIGEST_PREFIX}{}",
        hex::encode(Sha256::digest(bytes))
    ))
}

pub(crate) fn validate_intent(intent: &ActionIntent) -> Result<(), CapabilityError> {
    validate_text(
        &intent.audience,
        ACTION_CAPABILITY_LIMITS.max_identity_bytes,
        "audience",
    )?;
    validate_text(
        &intent.operation,
        ACTION_CAPABILITY_LIMITS.max_operation_bytes,
        "operation",
    )?;
    validate_sha256_digest(&intent.resource_digest, "resource_digest")
}

pub(crate) fn validate_identity(value: &str, field: &'static str) -> Result<(), CapabilityError> {
    validate_text(value, ACTION_CAPABILITY_LIMITS.max_identity_bytes, field)
}

pub(crate) fn validate_actor_principal(actor: &str) -> Result<(), CapabilityError> {
    if !is_canonical_actor_principal(actor) {
        return Err(CapabilityError::Malformed("actor"));
    }
    Ok(())
}

fn validate_expectation(expected: &ActionExpectation) -> Result<(), CapabilityError> {
    for (value, field) in [
        (expected.issuer.as_str(), "issuer"),
        (expected.audience.as_str(), "audience"),
        (expected.harbor.as_str(), "harbor"),
        (expected.tenant.as_str(), "tenant"),
    ] {
        validate_identity(value, field)?;
    }
    validate_actor_principal(&expected.actor)?;
    validate_text(
        &expected.operation,
        ACTION_CAPABILITY_LIMITS.max_operation_bytes,
        "operation",
    )?;
    validate_sha256_digest(&expected.resource_digest, "resource_digest")
}

fn validate_structure(
    capability: &ActionCapability,
    require_tag: bool,
) -> Result<(), CapabilityError> {
    if capability.schema_version != ACTION_CAPABILITY_SCHEMA_VERSION {
        return Err(CapabilityError::UnsupportedVersion);
    }
    if capability.domain != ACTION_CAPABILITY_DOMAIN {
        return Err(CapabilityError::DomainMismatch);
    }
    let expectation = capability.expectation();
    validate_expectation(&expectation)?;
    validate_sha256_digest(&capability.action_digest, "action_digest")?;
    let recomputed = action_digest(
        &capability.operation,
        &capability.actor,
        &capability.harbor,
        &capability.tenant,
        &capability.resource_digest,
    )?;
    if capability.action_digest != recomputed {
        return Err(CapabilityError::Malformed("action_digest"));
    }
    if capability.not_before_ms <= 0
        || capability.expires_at_ms <= capability.not_before_ms
        || capability
            .expires_at_ms
            .checked_sub(capability.not_before_ms)
            .is_none_or(|ttl| ttl > MAX_CAPABILITY_TTL_MS)
    {
        return Err(CapabilityError::LifetimeOutOfBounds);
    }
    if capability.nonce.len() != ACTION_CAPABILITY_LIMITS.nonce_hex_bytes
        || !is_lower_hex(&capability.nonce)
    {
        return Err(CapabilityError::Malformed("nonce"));
    }
    validate_sha256_digest(
        capability.credential_provenance.digest(),
        "credential provenance digest",
    )?;
    if require_tag {
        if capability.tag_hex.len() != ACTION_CAPABILITY_LIMITS.tag_hex_bytes
            || !is_lower_hex(&capability.tag_hex)
        {
            return Err(CapabilityError::Malformed("tag_hex"));
        }
    } else if !capability.tag_hex.is_empty() {
        return Err(CapabilityError::Malformed("tag_hex"));
    }
    Ok(())
}

pub(crate) fn validate_time(
    capability: &ActionCapability,
    now_ms: i64,
) -> Result<(), CapabilityError> {
    if now_ms <= 0 {
        return Err(CapabilityError::Malformed("verification clock"));
    }
    if now_ms < capability.not_before_ms {
        return Err(CapabilityError::NotYetValid);
    }
    if now_ms >= capability.expires_at_ms {
        return Err(CapabilityError::Expired);
    }
    Ok(())
}

fn compare_expectation(
    capability: &ActionCapability,
    expected: &ActionExpectation,
) -> Result<(), CapabilityError> {
    for (actual, wanted, field) in [
        (&capability.issuer, &expected.issuer, "issuer"),
        (&capability.audience, &expected.audience, "audience"),
        (&capability.operation, &expected.operation, "operation"),
        (&capability.actor, &expected.actor, "actor"),
        (&capability.harbor, &expected.harbor, "harbor"),
        (&capability.tenant, &expected.tenant, "tenant"),
        (
            &capability.resource_digest,
            &expected.resource_digest,
            "resource_digest",
        ),
    ] {
        if actual != wanted {
            return Err(CapabilityError::ScopeMismatch(field));
        }
    }
    Ok(())
}

fn capability_preimage(capability: &ActionCapability) -> Vec<u8> {
    let mut bytes = Vec::new();
    push_field(&mut bytes, ACTION_CAPABILITY_DOMAIN);
    bytes.extend_from_slice(&capability.schema_version.to_be_bytes());
    for field in [
        capability.domain.as_str(),
        capability.issuer.as_str(),
        capability.audience.as_str(),
        capability.operation.as_str(),
        capability.actor.as_str(),
        capability.harbor.as_str(),
        capability.tenant.as_str(),
        capability.resource_digest.as_str(),
        capability.action_digest.as_str(),
        capability.nonce.as_str(),
        capability.credential_provenance.kind_name(),
        capability.credential_provenance.digest(),
    ] {
        push_field(&mut bytes, field);
    }
    bytes.extend_from_slice(&capability.not_before_ms.to_be_bytes());
    bytes.extend_from_slice(&capability.expires_at_ms.to_be_bytes());
    bytes
}

fn push_field(bytes: &mut Vec<u8>, field: &str) {
    let len = u32::try_from(field.len()).expect("all structural fields are bounded below u32::MAX");
    bytes.extend_from_slice(&len.to_be_bytes());
    bytes.extend_from_slice(field.as_bytes());
}

fn validate_text(
    value: &str,
    max_bytes: usize,
    field: &'static str,
) -> Result<(), CapabilityError> {
    if value.is_empty()
        || value.len() > max_bytes
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(CapabilityError::Malformed(field));
    }
    Ok(())
}

fn validate_sha256_digest(value: &str, field: &'static str) -> Result<(), CapabilityError> {
    if value.len() != SHA256_DIGEST_BYTES
        || !value.starts_with(SHA256_DIGEST_PREFIX)
        || !is_lower_hex(&value[SHA256_DIGEST_PREFIX.len()..])
    {
        return Err(CapabilityError::Malformed(field));
    }
    Ok(())
}

fn decode_fixed_lower_hex(value: &str, field: &'static str) -> Result<Vec<u8>, CapabilityError> {
    if value.len() != 64 || !is_lower_hex(value) {
        return Err(CapabilityError::Malformed(field));
    }
    hex::decode(value).map_err(|_| CapabilityError::Malformed(field))
}

fn is_lower_hex(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &[u8] = b"action-capability-signing-key-32-bytes";
    const NOW: i64 = 1_000_000;

    fn signer() -> ActionCapabilitySigner {
        ActionCapabilitySigner::new(KEY.to_vec()).unwrap()
    }

    fn claims() -> MintedActionClaims {
        MintedActionClaims {
            issuer: "port-daddy:broker".into(),
            audience: "port-daddy:egress".into(),
            operation: "push".into(),
            actor: "01K3YR6M1WPZB8Q6V1J8K7D4MC".into(),
            harbor: "curiositech/port-daddy".into(),
            tenant: "curiositech".into(),
            resource_digest: push_resource_digest("curiositech/port-daddy", "feat/x").unwrap(),
        }
    }

    fn provenance() -> CredentialProvenance {
        CredentialProvenance::macaroon(resource_digest("test/credential/v1", &["grant-1"]).unwrap())
    }

    fn capability() -> ActionCapability {
        signer()
            .mint(claims(), provenance(), NOW, NOW + 60_000, "ab".repeat(32))
            .unwrap()
    }

    #[test]
    fn minted_capability_verifies_against_exact_scope() {
        let capability = capability();
        signer()
            .verify(&capability, &capability.expectation(), NOW)
            .unwrap();
    }

    #[test]
    fn field_boundary_shifts_change_resource_digest() {
        let a = resource_digest("test/resource/v1", &["a", "bc"]).unwrap();
        let b = resource_digest("test/resource/v1", &["ab", "c"]).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn debug_redacts_bearer_tag_and_provenance_digest() {
        let capability = capability();
        let debug = format!("{capability:?}");
        assert!(!debug.contains(&capability.tag_hex));
        assert!(!debug.contains(capability.credential_provenance.digest()));
        assert!(debug.contains("<redacted>"));
    }

    #[test]
    fn tag_tamper_fails_constant_time_authentication_path() {
        let mut capability = capability();
        capability.tag_hex.replace_range(..1, "c");
        let error = signer()
            .verify(&capability, &capability.expectation(), NOW)
            .unwrap_err();
        assert_eq!(error, CapabilityError::AuthenticationFailed);
    }

    #[test]
    fn signed_field_tamper_cannot_be_laundered_with_a_matching_expectation() {
        let mut capability = capability();
        capability.operation = "parley.resolve".into();
        capability.action_digest = action_digest(
            &capability.operation,
            &capability.actor,
            &capability.harbor,
            &capability.tenant,
            &capability.resource_digest,
        )
        .unwrap();
        let error = signer()
            .verify(&capability, &capability.expectation(), NOW)
            .unwrap_err();
        assert_eq!(error, CapabilityError::AuthenticationFailed);
    }

    #[test]
    fn issuer_audience_actor_harbor_tenant_operation_and_resource_are_exact() {
        let capability = capability();
        for index in 0..7 {
            let mut expected = capability.expectation();
            match index {
                0 => expected.issuer = "other:issuer".into(),
                1 => expected.audience = "other:audience".into(),
                2 => expected.actor = "01K3YR6M1WPZB8Q6V1J8K7D4MD".into(),
                3 => expected.harbor = "other/harbor".into(),
                4 => expected.tenant = "other-tenant".into(),
                5 => expected.operation = "other.operation".into(),
                6 => {
                    expected.resource_digest =
                        resource_digest("test/resource/v1", &["other"]).unwrap()
                }
                _ => unreachable!(),
            }
            assert!(matches!(
                signer().verify(&capability, &expected, NOW),
                Err(CapabilityError::ScopeMismatch(_))
            ));
        }
    }

    #[test]
    fn domain_and_version_confusion_fail_before_authentication() {
        let mut wrong_domain = capability();
        wrong_domain.domain = "port-daddy/other-capability/v1".into();
        assert_eq!(
            signer()
                .verify(&wrong_domain, &wrong_domain.expectation(), NOW)
                .unwrap_err(),
            CapabilityError::DomainMismatch
        );

        let mut wrong_version = capability();
        wrong_version.schema_version = 2;
        assert_eq!(
            signer()
                .verify(&wrong_version, &wrong_version.expectation(), NOW)
                .unwrap_err(),
            CapabilityError::UnsupportedVersion
        );
    }

    #[test]
    fn not_before_expiry_and_ttl_are_hard_walls() {
        let live_capability = capability();
        assert_eq!(
            signer()
                .verify(&live_capability, &live_capability.expectation(), NOW - 1)
                .unwrap_err(),
            CapabilityError::NotYetValid
        );
        assert_eq!(
            signer()
                .verify(
                    &live_capability,
                    &live_capability.expectation(),
                    live_capability.expires_at_ms
                )
                .unwrap_err(),
            CapabilityError::Expired
        );

        let mut overlong = capability();
        overlong.expires_at_ms = overlong.not_before_ms + MAX_CAPABILITY_TTL_MS + 1;
        assert_eq!(
            signer()
                .verify(&overlong, &overlong.expectation(), NOW)
                .unwrap_err(),
            CapabilityError::LifetimeOutOfBounds
        );
    }

    #[test]
    fn malformed_and_oversized_fields_fail_before_hmac() {
        let mut oversized = capability();
        oversized.actor = "A".repeat(CANONICAL_ACTOR_ID_BYTES + 1);
        assert_eq!(
            signer()
                .verify(&oversized, &oversized.expectation(), NOW)
                .unwrap_err(),
            CapabilityError::Malformed("actor")
        );

        for non_principal in [
            "session-abc",
            "spark",
            "operator:local",
            "81K3YR6M1WPZB8Q6V1J8K7D4MC",
            "01k3yr6m1wpzb8q6v1j8k7d4mc",
        ] {
            let mut forged = capability();
            forged.actor = non_principal.into();
            assert_eq!(
                signer()
                    .verify(&forged, &forged.expectation(), NOW)
                    .unwrap_err(),
                CapabilityError::Malformed("actor")
            );
        }

        let mut whitespace = capability();
        whitespace.tenant = " tenant".into();
        assert_eq!(
            signer()
                .verify(&whitespace, &whitespace.expectation(), NOW)
                .unwrap_err(),
            CapabilityError::Malformed("tenant")
        );

        let mut bad_nonce = capability();
        bad_nonce.nonce = "AB".repeat(32);
        assert_eq!(
            signer()
                .verify(&bad_nonce, &bad_nonce.expectation(), NOW)
                .unwrap_err(),
            CapabilityError::Malformed("nonce")
        );

        let mut bad_number = capability();
        bad_number.not_before_ms = -1;
        assert_eq!(
            signer()
                .verify(&bad_number, &bad_number.expectation(), NOW)
                .unwrap_err(),
            CapabilityError::LifetimeOutOfBounds
        );
    }

    #[test]
    fn provenance_tamper_breaks_authentication_without_exposing_source_credential() {
        let mut capability = capability();
        capability.credential_provenance = CredentialProvenance::macaroon(
            resource_digest("test/credential/v1", &["other-grant"]).unwrap(),
        );
        assert_eq!(
            signer()
                .verify(&capability, &capability.expectation(), NOW)
                .unwrap_err(),
            CapabilityError::AuthenticationFailed
        );
    }

    #[test]
    fn audience_attenuation_preserves_action_identity_but_changes_bearer_tag() {
        let signer = signer();
        let first = signer
            .mint(claims(), provenance(), NOW, NOW + 60_000, "ab".repeat(32))
            .unwrap();
        let mut second_claims = claims();
        second_claims.audience = "port-daddy:relay".into();
        let second = signer
            .mint(
                second_claims,
                provenance(),
                NOW,
                NOW + 60_000,
                "ab".repeat(32),
            )
            .unwrap();
        assert_eq!(first.action_digest, second.action_digest);
        assert_eq!(
            action_id(&first.issuer, &first.action_digest).unwrap(),
            action_id(&second.issuer, &second.action_digest).unwrap()
        );
        assert_ne!(first.tag_hex, second.tag_hex);
    }

    #[test]
    fn resource_digest_rejects_empty_excessive_and_noncanonical_inputs() {
        assert!(resource_digest("test/resource/v1", &[]).is_err());
        let too_many = vec!["x"; ACTION_CAPABILITY_LIMITS.max_resource_fields + 1];
        assert!(resource_digest("test/resource/v1", &too_many).is_err());
        assert!(resource_digest("test/resource/v1", &[" x"]).is_err());
        assert!(resource_digest(
            "test/resource/v1",
            &[&"x".repeat(ACTION_CAPABILITY_LIMITS.max_resource_field_bytes + 1)]
        )
        .is_err());
    }

    #[test]
    fn short_signing_key_is_refused() {
        assert!(matches!(
            ActionCapabilitySigner::new(vec![7; 31]),
            Err(CapabilityError::SigningKeyTooShort)
        ));
    }
}
