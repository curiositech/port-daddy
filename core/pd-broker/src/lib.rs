//! `pd-broker`: credential custody and one-use action capabilities.
//!
//! The protected raw credential never crosses the broker socket. A verified
//! existing push macaroon may mint a versioned, domain-separated capability;
//! an existing capability addressed to the broker may be atomically consumed to
//! mint a narrower audience/expiry bearer. Redemption truth is SQLite-durable.
//!
//! This crate does **not** treat Rust, loopback, a Unix socket mode, same-UID
//! possession, PID/name, Host, or XFF as confinement or operator authority. The
//! native code-signing/Keychain bootstrap is intentionally a typed refusal until
//! that separate lane exists. ADR-0087's separate-UID/forced-egress boundary also
//! remains required before raw credential custody becomes non-bypassable.

pub mod broker;
pub mod capability;
pub mod protocol;
mod redemption;
pub mod transport;

pub use broker::{Broker, BrokerConfig, BrokerError};
pub use capability::{
    action_digest, action_id, capability_fingerprint, push_resource_digest, resource_digest,
    ActionCapability, ActionCapabilitySigner, ActionExpectation, ActionIntent,
    CredentialProvenance, CredentialProvenanceKind, CANONICAL_ACTOR_ID_BYTES,
};
pub use protocol::{ActionReservation, MintAuthority, Request, Response};
pub use redemption::RedemptionError;
