//! Versioned NDJSON protocol for minting and redeeming action capabilities.
//!
//! The transport contributes no authority. Every mint request carries either a
//! macaroon proof, a parent broker capability, or the explicit native-bootstrap
//! placeholder that always refuses in this slice. Unix socket possession, peer
//! UID, PID/name, loopback, Host, and forwarding headers are not protocol facts.

use pd_anchor::macaroon::Macaroon;
use serde::{de, Deserialize, Deserializer, Serialize};

use crate::capability::{ActionCapability, ActionExpectation, ActionIntent, CredentialProvenance};

/// Existing macaroon request facts. The broker supplies its own clock and never
/// accepts one from the wire. These values are presented by an untrusted client;
/// they become authoritative only when they exactly match the root-signed
/// actor-bound push grant and its caveats.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequestCtx {
    pub op: Option<String>,
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub host: Option<String>,
    pub spend_usd: Option<f64>,
    /// Claimed canonical daemon actor principal. This is independently bound by
    /// the grant identifier plus an exact `actor = ...` caveat; this field alone
    /// grants nothing and `session` cannot substitute.
    pub actor: Option<String>,
    /// Coordination lineage only. It is never copied into the capability's
    /// actor claim.
    pub session: Option<String>,
}

/// Credential that authorizes a mint. Variants are mutually exclusive, so an
/// invalid credential cannot fall through to a weaker source.
#[derive(Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum MintAuthority {
    /// A pd-anchor macaroon and its request-bound discharges. The broker requires
    /// exact operation/repository/session caveats and derives identity and tenancy
    /// from those signed facts. `push` additionally uses the canonical Git adapter.
    Macaroon {
        grant: Box<Macaroon>,
        #[serde(default)]
        discharges: Vec<Macaroon>,
        ctx: Box<RequestCtx>,
    },
    /// Attenuate a broker-issued capability. The parent must target this broker,
    /// match the exact action scope, and is atomically consumed during mint.
    BrokerCapability { capability: Box<ActionCapability> },
    /// Typed placeholder for the separate code-signing/Keychain lane. It carries
    /// no caller identity and always yields `BootstrapRequired` here.
    NativeOperatorBootstrap,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MacaroonAuthorityWire {
    kind: String,
    grant: Box<Macaroon>,
    #[serde(default)]
    discharges: Vec<Macaroon>,
    ctx: Box<RequestCtx>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BrokerCapabilityAuthorityWire {
    kind: String,
    capability: Box<ActionCapability>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeOperatorAuthorityWire {
    kind: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum MintAuthorityWire {
    Macaroon(MacaroonAuthorityWire),
    BrokerCapability(BrokerCapabilityAuthorityWire),
    NativeOperator(NativeOperatorAuthorityWire),
}

impl<'de> Deserialize<'de> for MintAuthority {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        match MintAuthorityWire::deserialize(deserializer)? {
            MintAuthorityWire::Macaroon(wire) if wire.kind == "macaroon" => Ok(Self::Macaroon {
                grant: wire.grant,
                discharges: wire.discharges,
                ctx: wire.ctx,
            }),
            MintAuthorityWire::BrokerCapability(wire) if wire.kind == "broker-capability" => {
                Ok(Self::BrokerCapability {
                    capability: wire.capability,
                })
            }
            MintAuthorityWire::NativeOperator(wire) if wire.kind == "native-operator-bootstrap" => {
                Ok(Self::NativeOperatorBootstrap)
            }
            _ => Err(de::Error::custom("unknown mint authority kind")),
        }
    }
}

impl std::fmt::Debug for MintAuthority {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Macaroon { .. } => f.write_str("Macaroon(<credential redacted>)"),
            Self::BrokerCapability { capability } => {
                f.debug_tuple("BrokerCapability").field(capability).finish()
            }
            Self::NativeOperatorBootstrap => f.write_str("NativeOperatorBootstrap"),
        }
    }
}

/// A request from an untrusted client. Unknown variants/fields fail at parsing;
/// the specialized legacy ticket request is intentionally absent.
#[derive(Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Request {
    /// Authenticate and mint a new action capability.
    MintActionCapability {
        authority: Box<MintAuthority>,
        intent: Box<ActionIntent>,
    },
    /// Verify and atomically consume one exact capability.
    RedeemActionCapability {
        capability: Box<ActionCapability>,
        expected: Box<ActionExpectation>,
    },
    /// Liveness probe. It carries no authority.
    Ping,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MintActionRequestWire {
    #[serde(rename = "type")]
    request_type: String,
    authority: Box<MintAuthority>,
    intent: Box<ActionIntent>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RedeemActionRequestWire {
    #[serde(rename = "type")]
    request_type: String,
    capability: Box<ActionCapability>,
    expected: Box<ActionExpectation>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PingRequestWire {
    #[serde(rename = "type")]
    request_type: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum RequestWire {
    Mint(MintActionRequestWire),
    Redeem(RedeemActionRequestWire),
    Ping(PingRequestWire),
}

impl<'de> Deserialize<'de> for Request {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        match RequestWire::deserialize(deserializer)? {
            RequestWire::Mint(wire) if wire.request_type == "mint-action-capability" => {
                Ok(Self::MintActionCapability {
                    authority: wire.authority,
                    intent: wire.intent,
                })
            }
            RequestWire::Redeem(wire) if wire.request_type == "redeem-action-capability" => {
                Ok(Self::RedeemActionCapability {
                    capability: wire.capability,
                    expected: wire.expected,
                })
            }
            RequestWire::Ping(wire) if wire.request_type == "ping" => Ok(Self::Ping),
            _ => Err(de::Error::custom("unknown broker request type")),
        }
    }
}

impl std::fmt::Debug for Request {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MintActionCapability { authority, intent } => f
                .debug_struct("MintActionCapability")
                .field("authority", authority)
                .field("intent", intent)
                .finish(),
            Self::RedeemActionCapability {
                capability,
                expected,
            } => f
                .debug_struct("RedeemActionCapability")
                .field("capability", capability)
                .field("expected", expected)
                .finish(),
            Self::Ping => f.write_str("Ping"),
        }
    }
}

/// Stable machine-readable refusal categories.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RefusalCode {
    Unauthorized,
    Malformed,
    ScopeMismatch,
    NotYetValid,
    Expired,
    NonceCollision,
    ReservationConflict,
    Capacity,
    ClockRegression,
    StorageUnavailable,
    Internal,
}

/// Missing native trust primitive. This is a requirement, never a fallback.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BootstrapRequirement {
    CodeSignedKeychainOperatorCredential,
}

/// Current broker-owned action reservation schema. There is no compatibility
/// parser because this contract has not shipped.
pub const ACTION_RESERVATION_SCHEMA_VERSION: u16 = 1;

/// Domain carried in every action reservation result.
pub const ACTION_RESERVATION_DOMAIN: &str = "port-daddy/action-reservation/v1";

/// Durable result of directly presenting one authenticated action capability to
/// the broker. `action_id` is the product idempotency key. This object is not a
/// bearer credential and no broker request accepts it as authority; downstream
/// action services must call the broker themselves and transactionally record
/// `action_id` with the first effect/outcome.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionReservation {
    pub schema_version: u16,
    pub domain: String,
    pub action_id: String,
    pub capability_digest: String,
    pub action_digest: String,
    pub issuer: String,
    pub audience: String,
    pub operation: String,
    pub actor: String,
    pub harbor: String,
    pub tenant: String,
    pub resource_digest: String,
    pub credential_provenance: CredentialProvenance,
    pub reserved_at_ms: i64,
    pub capability_expires_at_ms: i64,
    pub recover_until_ms: i64,
}

/// A broker response. It never contains the protected raw credential.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Response {
    /// Mint succeeded. The bearer tag is serialized for delivery but redacted by
    /// `ActionCapability`'s `Debug` implementation.
    Capability {
        capability: Box<ActionCapability>,
        /// True only when an exact attenuation retry recovered the original
        /// child capability. Macaroon-backed minting is always a fresh mint.
        replayed: bool,
    },
    /// First reservation and exact authenticated retries share this response;
    /// `replayed` tells telemetry whether SQLite inserted or recovered it.
    ActionReserved {
        reservation: Box<ActionReservation>,
        replayed: bool,
    },
    /// Authentication, scope, lifecycle, replay, or storage refusal.
    Refused { code: RefusalCode, reason: String },
    /// Native operator authority is intentionally unavailable in this slice.
    BootstrapRequired {
        requirement: BootstrapRequirement,
        reason: String,
    },
    /// Invalid wire shape.
    BadRequest { reason: String },
    /// Liveness reply.
    Pong,
}

impl Response {
    /// Construct a refusal without accidentally embedding credential material.
    pub fn refused(code: RefusalCode, reason: impl Into<String>) -> Self {
        Self::Refused {
            code,
            reason: reason.into(),
        }
    }

    /// Serialize as one NDJSON line. Serialization failure becomes a bounded
    /// `bad-request` response rather than a panic.
    pub fn to_ndjson_line(&self) -> String {
        match serde_json::to_string(self) {
            Ok(mut serialized) => {
                serialized.push('\n');
                serialized
            }
            Err(_) => "{\"type\":\"bad-request\",\"reason\":\"serialize failed\"}\n".to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_pong_roundtrip() {
        let request = Request::Ping;
        let line = serde_json::to_string(&request).unwrap();
        let parsed: Request = serde_json::from_str(&line).unwrap();
        assert_eq!(request, parsed);
        assert_eq!(Response::Pong.to_ndjson_line(), "{\"type\":\"pong\"}\n");
    }

    #[test]
    fn native_bootstrap_has_no_identity_claim() {
        let request = Request::MintActionCapability {
            authority: Box::new(MintAuthority::NativeOperatorBootstrap),
            intent: Box::new(ActionIntent {
                audience: "port-daddy:operator-actions".into(),
                operation: "parley.resolve".into(),
                resource_digest: format!("sha256:{}", "ab".repeat(32)),
            }),
        };
        let serialized = serde_json::to_string(&request).unwrap();
        assert!(!serialized.contains("actor"));
        assert!(!serialized.contains("operator_id"));
    }

    #[test]
    fn stale_specialized_ticket_request_is_not_parsed() {
        let old = r#"{"type":"broker-credential","grant":{},"ctx":{}}"#;
        assert!(serde_json::from_str::<Request>(old).is_err());
    }

    #[test]
    fn unknown_request_fields_fail_closed() {
        assert!(serde_json::from_str::<Request>(r#"{"type":"ping","actor":"operator"}"#).is_err());

        let forged_native = r#"{
          "type":"mint-action-capability",
          "authority":{"kind":"native-operator-bootstrap","actor":"operator"},
          "intent":{"audience":"a","operation":"b","resource_digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
        }"#;
        assert!(serde_json::from_str::<Request>(forged_native).is_err());
    }

    #[test]
    fn caller_supplied_receipt_or_reservation_is_never_authority() {
        for forged in [
            r#"{
              "type":"redeem-action-capability",
              "receipt":{"capability_digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
            }"#,
            r#"{
              "type":"redeem-action-capability",
              "reservation":{
                "schema_version":1,
                "domain":"port-daddy/action-reservation/v1",
                "action_id":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
              }
            }"#,
        ] {
            assert!(serde_json::from_str::<Request>(forged).is_err());
        }
    }
}
