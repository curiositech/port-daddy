use pd_anchor::{verify_card, AnchorCard};
use pd_core::{now_ms, RoomId};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const DEFAULT_MESH_ALPN: &[u8] = b"pd-mesh/1";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuicMeshConfig {
    pub bind_addr: String,
    pub alpn: Vec<u8>,
    pub require_anchor_auth: bool,
}

impl Default for QuicMeshConfig {
    fn default() -> Self {
        Self {
            bind_addr: "127.0.0.1:0".to_owned(),
            alpn: DEFAULT_MESH_ALPN.to_vec(),
            require_anchor_auth: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventHead {
    pub daemon_id: String,
    pub sequence: i64,
    pub root_hex: String,
}

impl EventHead {
    pub fn genesis(daemon_id: impl Into<String>) -> Self {
        let daemon_id = daemon_id.into();
        Self {
            root_hex: hex_digest(format!("{daemon_id}:0").as_bytes()),
            daemon_id,
            sequence: 0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeshPeer {
    pub peer_id: String,
    pub endpoint: String,
    pub card: AnchorCard,
    pub scopes: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HandshakeIntent {
    pub peer_id: String,
    pub endpoint: String,
    pub event_head: EventHead,
    pub nonce: String,
    pub requested_scopes: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum MeshEnvelopeKind {
    RoomMessage,
    EventHeadExchange,
    JobLeaseRequest,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeshEnvelope {
    pub from_peer: String,
    pub to_peer: String,
    pub room_id: Option<RoomId>,
    pub kind: MeshEnvelopeKind,
    pub payload_json: serde_json::Value,
    pub event_head: EventHead,
}

pub struct MeshAuthenticator {
    required_capability: String,
}

impl MeshAuthenticator {
    pub fn new(required_capability: impl Into<String>) -> Self {
        Self {
            required_capability: required_capability.into(),
        }
    }

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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthenticatedPeer {
    pub peer_id: String,
    pub subject: String,
    pub endpoint: String,
    pub scopes: Vec<String>,
}

fn hex_digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[derive(Debug, Error)]
pub enum MeshError {
    #[error("missing mesh capability {capability} for peer {peer_id}")]
    MissingCapability { peer_id: String, capability: String },
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
