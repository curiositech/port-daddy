//! Mesh daemon primitives — how one Port Daddy daemon lets *another* daemon in.
//!
//! Port Daddy is local-first: each daemon owns its own SQLite event log and runs alone by
//! default. This crate is the wire vocabulary for the optional next step — two daemons
//! forming an authenticated peer mesh so they can exchange room messages, event-log heads,
//! and job leases. It defines the *types and the trust gate*, not the transport: the QUIC
//! socket itself is a later slice, but the ALPN, handshake, envelope, and — critically — the
//! authentication decision all live here so they are testable in isolation.
//!
//! # The trust gate
//!
//! A peer is only admitted if it presents a valid, unexpired **Anchor card** (see the
//! `pd-anchor` crate) *and* that card carries the specific capability this node requires.
//! [`MeshAuthenticator`] is that gate: it turns an untrusted [`MeshPeer`] into an
//! [`AuthenticatedPeer`], or refuses. Authentication fails closed — a peer with a malformed,
//! expired, or under-scoped card is rejected with a [`MeshError`], never partially admitted.
//! This is the mesh-side mirror of the same anchor-capability model the whole kernel uses.
//!
//! # Wire types
//!
//! [`QuicMeshConfig`] is the listen-side configuration, [`HandshakeIntent`] is what a peer
//! sends to open a session, [`EventHead`] names a daemon's position in its own event log so
//! two peers can compare progress, and [`MeshEnvelope`] wraps a single routed message. All
//! are `Serialize`/`Deserialize` because they are literally what crosses the wire.

use pd_anchor::{verify_card, AnchorCard};
use pd_core::{now_ms, RoomId};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

/// Default ALPN protocol id advertised on the QUIC listener: `pd-mesh/1`.
///
/// ALPN (Application-Layer Protocol Negotiation) is how the TLS handshake agrees on which
/// protocol the connection speaks. Pinning a versioned constant here means a peer speaking a
/// future `pd-mesh/2` cannot be silently mistaken for a `pd-mesh/1` peer — the version is
/// negotiated in the handshake, not guessed after connecting.
pub const DEFAULT_MESH_ALPN: &[u8] = b"pd-mesh/1";

/// Listener-side configuration for the mesh QUIC endpoint.
///
/// The default binds to `127.0.0.1:0` (loopback, OS-assigned port) and **requires** anchor
/// auth — a safe, local-first posture: on a fresh config the mesh is reachable only from the
/// same host and admits no unauthenticated peers. Widening `bind_addr` to a routable address
/// is an explicit opt-in, never the default.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuicMeshConfig {
    /// Socket address to listen on. `"127.0.0.1:0"` by default (loopback, ephemeral port).
    pub bind_addr: String,
    /// ALPN protocol id to advertise; defaults to [`DEFAULT_MESH_ALPN`].
    pub alpn: Vec<u8>,
    /// If `true` (the default), peers must pass anchor authentication before admission.
    pub require_anchor_auth: bool,
}

impl Default for QuicMeshConfig {
    /// Loopback bind, `pd-mesh/1` ALPN, anchor auth required — the safe local-first default.
    ///
    /// ```
    /// use pd_mesh::{QuicMeshConfig, DEFAULT_MESH_ALPN};
    ///
    /// let cfg = QuicMeshConfig::default();
    /// assert_eq!(cfg.bind_addr, "127.0.0.1:0");
    /// assert_eq!(cfg.alpn, DEFAULT_MESH_ALPN);
    /// assert!(cfg.require_anchor_auth); // never admit unauthenticated peers by default
    /// ```
    fn default() -> Self {
        Self {
            bind_addr: "127.0.0.1:0".to_owned(),
            alpn: DEFAULT_MESH_ALPN.to_vec(),
            require_anchor_auth: true,
        }
    }
}

/// A daemon's position in its own append-only event log — its "you are here" marker.
///
/// `sequence` counts events; `root_hex` is a SHA-256 chain root over the log so far. Two
/// peers exchange their heads (via [`MeshEnvelopeKind::EventHeadExchange`]) to discover who
/// is ahead and what needs to be synced. The `root_hex` lets a peer detect divergence — same
/// sequence but different roots means the two logs disagree about history.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventHead {
    /// Stable id of the daemon that owns this log.
    pub daemon_id: String,
    /// Number of events appended so far (0 at genesis).
    pub sequence: i64,
    /// SHA-256 hex digest anchoring the log chain at this point.
    pub root_hex: String,
}

impl EventHead {
    /// The genesis head for a brand-new daemon log: `sequence == 0` with a deterministic
    /// root derived from `"{daemon_id}:0"`.
    ///
    /// Determinism matters: the same `daemon_id` always yields the same genesis root, so two
    /// daemons can agree on a starting point without any prior communication.
    ///
    /// ```
    /// use pd_mesh::EventHead;
    ///
    /// let head = EventHead::genesis("local-daemon");
    /// assert_eq!(head.daemon_id, "local-daemon");
    /// assert_eq!(head.sequence, 0);
    /// assert_eq!(head.root_hex.len(), 64); // SHA-256 hex is always 64 chars
    /// // Deterministic: same id in, same root out.
    /// assert_eq!(head.root_hex, EventHead::genesis("local-daemon").root_hex);
    /// ```
    pub fn genesis(daemon_id: impl Into<String>) -> Self {
        let daemon_id = daemon_id.into();
        Self {
            root_hex: hex_digest(format!("{daemon_id}:0").as_bytes()),
            daemon_id,
            sequence: 0,
        }
    }
}

/// An *untrusted* peer as first presented to this node, before authentication.
///
/// It carries the peer's self-claimed id and endpoint plus the [`AnchorCard`] it offers as
/// proof and the room scopes it wants. Nothing here is trusted until [`MeshAuthenticator`]
/// validates the card — hold a [`MeshPeer`] and you hold a *claim*, not a verified identity.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeshPeer {
    /// The peer's self-declared id (only trustworthy once its card verifies).
    pub peer_id: String,
    /// Where to reach the peer (e.g. `"127.0.0.1:9901"`).
    pub endpoint: String,
    /// The signed anchor card the peer offers as proof of its capabilities.
    pub card: AnchorCard,
    /// Room scopes the peer wishes to participate in.
    pub scopes: Vec<String>,
}

/// The opening message a peer sends to start a mesh session.
///
/// It bundles the peer's identity, its current [`EventHead`] (so sync can begin immediately),
/// a `nonce` for replay protection, and the scopes it is requesting.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HandshakeIntent {
    /// The initiating peer's id.
    pub peer_id: String,
    /// The initiating peer's reachable endpoint.
    pub endpoint: String,
    /// The peer's event-log head at handshake time.
    pub event_head: EventHead,
    /// A one-time value; the responder rejects a nonce it has seen before (replay guard).
    pub nonce: String,
    /// Room scopes the peer asks to join.
    pub requested_scopes: Vec<String>,
}

/// What a [`MeshEnvelope`] carries — the three kinds of traffic the mesh routes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum MeshEnvelopeKind {
    /// A message addressed to a room, to be delivered to that room's participants.
    RoomMessage,
    /// A peer sharing its [`EventHead`] so the two logs can be reconciled.
    EventHeadExchange,
    /// A request to lease a job for execution on the requesting peer.
    JobLeaseRequest,
}

/// A single routed message between two authenticated peers.
///
/// The `kind` selects how `payload_json` is interpreted, `room_id` scopes room traffic, and
/// the enclosed `event_head` lets the receiver keep sync bookkeeping current on every message
/// rather than only during a dedicated exchange.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeshEnvelope {
    /// Sender peer id.
    pub from_peer: String,
    /// Recipient peer id.
    pub to_peer: String,
    /// Room this message is scoped to, if any.
    pub room_id: Option<RoomId>,
    /// Discriminates how `payload_json` should be read.
    pub kind: MeshEnvelopeKind,
    /// Kind-specific body, kept as opaque JSON so the envelope shape is stable across kinds.
    pub payload_json: serde_json::Value,
    /// The sender's event-log head, piggybacked for continuous sync.
    pub event_head: EventHead,
}

/// The admission gate: verifies a peer's anchor card and required capability.
///
/// One authenticator is configured with the single capability this node insists every peer
/// prove (e.g. `"mesh:peer"`). It is the only path from an untrusted [`MeshPeer`] to a
/// trusted [`AuthenticatedPeer`].
pub struct MeshAuthenticator {
    required_capability: String,
}

impl MeshAuthenticator {
    /// Create a gate that requires peers to carry `required_capability` in their card.
    ///
    /// ```
    /// use pd_mesh::MeshAuthenticator;
    ///
    /// // Configure the gate; peers must present a card bearing "mesh:peer" to be admitted.
    /// let _gate = MeshAuthenticator::new("mesh:peer");
    /// ```
    pub fn new(required_capability: impl Into<String>) -> Self {
        Self {
            required_capability: required_capability.into(),
        }
    }

    /// Authenticate a peer, consuming its [`MeshPeer`] claim and returning a trusted
    /// [`AuthenticatedPeer`] — or refusing.
    ///
    /// Two checks, in order, both fail-closed:
    /// 1. The card's signature and expiry must verify (`verify_card` against the current
    ///    clock) — otherwise [`MeshError::Anchor`].
    /// 2. The verified card must actually contain the required capability — otherwise
    ///    [`MeshError::MissingCapability`].
    ///
    /// Only when both pass is the peer's self-claimed identity promoted to trusted: the
    /// returned `subject` comes from the *card*, not from the peer's self-declared fields.
    ///
    /// # Errors
    /// [`MeshError::Anchor`] if the card is invalid/expired; [`MeshError::MissingCapability`]
    /// if it verifies but lacks the required capability. A runnable end-to-end example (mint a
    /// card with an `AnchorKeypair`, then authenticate) is in this crate's `tests` module —
    /// `anchor_authenticated_peer_is_accepted` — since minting needs the `pd-anchor` signing
    /// half that a doctest cannot reach.
    pub fn authenticate_peer(&self, peer: MeshPeer) -> Result<AuthenticatedPeer, MeshError> {
        verify_card(&peer.card, now_ms()).map_err(MeshError::Anchor)?;
        if !peer.card.capabilities.contains(&self.required_capability) {
            return Err(MeshError::MissingCapability {
                peer_id: peer.peer_id,
                capability: self.required_capability.clone(),
            });
        }

        Ok(AuthenticatedPeer {
            peer_id: peer.peer_id,
            subject: peer.card.subject.id,
            endpoint: peer.endpoint,
            scopes: peer.scopes,
        })
    }
}

/// A peer that has passed [`MeshAuthenticator::authenticate_peer`] — a trusted identity.
///
/// The key field is `subject`: it is the identity asserted by the *verified anchor card*, not
/// the peer's self-declared `peer_id`. Downstream routing and authorization should key off
/// `subject`, because that is the part cryptography vouches for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthenticatedPeer {
    /// The peer's transport-level id (as it announced itself).
    pub peer_id: String,
    /// The cryptographically vouched-for identity from the anchor card. Trust this one.
    pub subject: String,
    /// The peer's reachable endpoint.
    pub endpoint: String,
    /// The room scopes carried over from the peer's request.
    pub scopes: Vec<String>,
}

/// SHA-256 of `bytes`, hex-encoded. Shared helper for event-log chain roots.
fn hex_digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Why a peer was refused admission to the mesh.
///
/// Both variants mean "not trusted". They are distinct only so the node can log *why* a peer
/// was turned away — a bad card versus a valid-but-under-scoped one are different operational
/// signals. `Anchor` transparently wraps the underlying `pd-anchor` verification error.
#[derive(Debug, Error)]
pub enum MeshError {
    /// The card verified, but it does not carry the capability this node requires.
    #[error("missing mesh capability {capability} for peer {peer_id}")]
    MissingCapability {
        /// The rejected peer's id.
        peer_id: String,
        /// The capability that was required but absent.
        capability: String,
    },
    /// The anchor card itself failed to verify (bad signature, expired, malformed).
    #[error(transparent)]
    Anchor(#[from] pd_anchor::AnchorError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use pd_anchor::{AnchorKeypair, AnchorSubject};

    #[test]
    fn anchor_authenticated_peer_is_accepted() {
        let keypair = AnchorKeypair::from_seed([9_u8; 32]);
        let card = keypair
            .sign_card(
                AnchorSubject::new("daemon-a"),
                vec!["mesh:peer".to_owned(), "room:route".to_owned()],
                60_000,
            )
            .unwrap();
        let peer = MeshPeer {
            peer_id: "peer-a".to_owned(),
            endpoint: "127.0.0.1:9901".to_owned(),
            card,
            scopes: vec!["room:kernel".to_owned()],
        };

        let authenticated = MeshAuthenticator::new("mesh:peer")
            .authenticate_peer(peer)
            .unwrap();

        assert_eq!(authenticated.subject, "daemon-a");
        assert_eq!(authenticated.scopes, vec!["room:kernel"]);
    }

    #[test]
    fn peer_without_required_capability_is_rejected() {
        let keypair = AnchorKeypair::from_seed([10_u8; 32]);
        let card = keypair
            .sign_card(
                AnchorSubject::new("daemon-a"),
                vec!["room:route".to_owned()],
                60_000,
            )
            .unwrap();
        let peer = MeshPeer {
            peer_id: "peer-a".to_owned(),
            endpoint: "127.0.0.1:9901".to_owned(),
            card,
            scopes: Vec::new(),
        };

        let err = MeshAuthenticator::new("mesh:peer")
            .authenticate_peer(peer)
            .unwrap_err();

        assert!(matches!(err, MeshError::MissingCapability { .. }));
    }
}
