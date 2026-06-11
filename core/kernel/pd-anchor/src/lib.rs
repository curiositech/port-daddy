use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use pd_core::now_ms;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnchorSubject {
    pub id: String,
}

impl AnchorSubject {
    pub fn new(id: impl Into<String>) -> Self {
        Self { id: id.into() }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnchorCard {
    pub subject: AnchorSubject,
    pub public_key_hex: String,
    pub capabilities: Vec<String>,
    pub issued_at_ms: i64,
    pub expires_at_ms: i64,
    pub signature_hex: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignedCapabilityEnvelope {
    pub card: AnchorCard,
    pub audience: String,
    pub nonce: String,
    pub capabilities: Vec<String>,
    pub issued_at_ms: i64,
    pub expires_at_ms: i64,
    pub signature_hex: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MerkleEvidence {
    pub root_hex: String,
    pub leaf_count: usize,
}

pub struct AnchorKeypair {
    signing_key: SigningKey,
}

impl AnchorKeypair {
    pub fn from_seed(seed: [u8; 32]) -> Self {
        Self {
            signing_key: SigningKey::from_bytes(&seed),
        }
    }

    pub fn public_key_hex(&self) -> String {
        hex::encode(self.signing_key.verifying_key().to_bytes())
    }

    pub fn sign_card(
        &self,
        subject: AnchorSubject,
        capabilities: Vec<String>,
        ttl_ms: i64,
    ) -> Result<AnchorCard, AnchorError> {
        let issued_at_ms = now_ms();
        let mut capabilities = capabilities;
        capabilities.sort();
        capabilities.dedup();
        let public_key_hex = self.public_key_hex();
        let expires_at_ms = issued_at_ms + ttl_ms;
        let payload = CardSigningPayload {
            subject: &subject,
            public_key_hex: &public_key_hex,
            capabilities: &capabilities,
            issued_at_ms,
            expires_at_ms,
        };
        let bytes = serde_json::to_vec(&payload)?;
        let signature = self.signing_key.sign(&bytes);

        Ok(AnchorCard {
            subject,
            public_key_hex,
            capabilities,
            issued_at_ms,
            expires_at_ms,
            signature_hex: hex::encode(signature.to_bytes()),
        })
    }

    pub fn issue_envelope(
        &self,
        card: AnchorCard,
        audience: impl Into<String>,
        nonce: impl Into<String>,
        capabilities: Vec<String>,
        ttl_ms: i64,
    ) -> Result<SignedCapabilityEnvelope, AnchorError> {
        verify_card(&card, now_ms())?;

        let issued_at_ms = now_ms();
        let mut capabilities = capabilities;
        capabilities.sort();
        capabilities.dedup();
        let envelope = EnvelopeSigningPayload {
            card_hash_hex: card_hash_hex(&card)?,
            audience: audience.into(),
            nonce: nonce.into(),
            capabilities,
            issued_at_ms,
            expires_at_ms: issued_at_ms + ttl_ms,
        };
        let bytes = serde_json::to_vec(&envelope)?;
        let signature = self.signing_key.sign(&bytes);

        Ok(SignedCapabilityEnvelope {
            card,
            audience: envelope.audience,
            nonce: envelope.nonce,
            capabilities: envelope.capabilities,
            issued_at_ms,
            expires_at_ms: envelope.expires_at_ms,
            signature_hex: hex::encode(signature.to_bytes()),
        })
    }
}

#[derive(Default, Debug)]
pub struct ReplayGuard {
    seen_nonces: HashSet<String>,
}

impl ReplayGuard {
    pub fn verify_fresh(&mut self, nonce: &str) -> Result<(), AnchorError> {
        if !self.seen_nonces.insert(nonce.to_owned()) {
            return Err(AnchorError::Replay {
                nonce: nonce.to_owned(),
            });
        }
        Ok(())
    }
}

pub fn verify_card(card: &AnchorCard, now_ms: i64) -> Result<(), AnchorError> {
    if card.expires_at_ms <= now_ms {
        return Err(AnchorError::Expired);
    }

    let verifying_key = verifying_key_from_hex(&card.public_key_hex)?;
    let signature = signature_from_hex(&card.signature_hex)?;
    let payload = CardSigningPayload {
        subject: &card.subject,
        public_key_hex: &card.public_key_hex,
        capabilities: &card.capabilities,
        issued_at_ms: card.issued_at_ms,
        expires_at_ms: card.expires_at_ms,
    };
    let bytes = serde_json::to_vec(&payload)?;
    verifying_key
        .verify(&bytes, &signature)
        .map_err(|_| AnchorError::InvalidSignature)?;
    Ok(())
}

pub fn verify_envelope(
    envelope: &SignedCapabilityEnvelope,
    guard: &mut ReplayGuard,
    now_ms: i64,
) -> Result<(), AnchorError> {
    if envelope.expires_at_ms <= now_ms {
        return Err(AnchorError::Expired);
    }
    verify_card(&envelope.card, now_ms)?;

    for capability in &envelope.capabilities {
        if !envelope.card.capabilities.contains(capability) {
            return Err(AnchorError::CapabilityNotGranted {
                capability: capability.clone(),
            });
        }
    }

    let verifying_key = verifying_key_from_hex(&envelope.card.public_key_hex)?;
    let signature = signature_from_hex(&envelope.signature_hex)?;
    let payload = EnvelopeSigningPayload {
        card_hash_hex: card_hash_hex(&envelope.card)?,
        audience: envelope.audience.clone(),
        nonce: envelope.nonce.clone(),
        capabilities: envelope.capabilities.clone(),
        issued_at_ms: envelope.issued_at_ms,
        expires_at_ms: envelope.expires_at_ms,
    };
    let bytes = serde_json::to_vec(&payload)?;
    verifying_key
        .verify(&bytes, &signature)
        .map_err(|_| AnchorError::InvalidSignature)?;

    guard.verify_fresh(&envelope.nonce)?;
    Ok(())
}

pub fn merkle_evidence(leaves: &[impl AsRef<[u8]>]) -> MerkleEvidence {
    let mut layer: Vec<[u8; 32]> = leaves
        .iter()
        .map(|leaf| Sha256::digest(leaf.as_ref()).into())
        .collect();

    if layer.is_empty() {
        return MerkleEvidence {
            root_hex: hex::encode(Sha256::digest([])),
            leaf_count: 0,
        };
    }

    while layer.len() > 1 {
        let mut next = Vec::with_capacity(layer.len().div_ceil(2));
        for pair in layer.chunks(2) {
            let right = pair.get(1).unwrap_or(&pair[0]);
            let mut hasher = Sha256::new();
            hasher.update(pair[0]);
            hasher.update(right);
            next.push(hasher.finalize().into());
        }
        layer = next;
    }

    MerkleEvidence {
        root_hex: hex::encode(layer[0]),
        leaf_count: leaves.len(),
    }
}

pub fn card_hash_hex(card: &AnchorCard) -> Result<String, AnchorError> {
    Ok(hex::encode(Sha256::digest(serde_json::to_vec(card)?)))
}

#[derive(Serialize)]
struct CardSigningPayload<'a> {
    subject: &'a AnchorSubject,
    public_key_hex: &'a str,
    capabilities: &'a [String],
    issued_at_ms: i64,
    expires_at_ms: i64,
}

#[derive(Serialize)]
struct EnvelopeSigningPayload {
    card_hash_hex: String,
    audience: String,
    nonce: String,
    capabilities: Vec<String>,
    issued_at_ms: i64,
    expires_at_ms: i64,
}

fn verifying_key_from_hex(public_key_hex: &str) -> Result<VerifyingKey, AnchorError> {
    let bytes: [u8; 32] = hex::decode(public_key_hex)?
        .try_into()
        .map_err(|_| AnchorError::InvalidKey)?;
    VerifyingKey::from_bytes(&bytes).map_err(|_| AnchorError::InvalidKey)
}

fn signature_from_hex(signature_hex: &str) -> Result<Signature, AnchorError> {
    let bytes: [u8; 64] = hex::decode(signature_hex)?
        .try_into()
        .map_err(|_| AnchorError::InvalidSignature)?;
    Ok(Signature::from_bytes(&bytes))
}

#[derive(Debug, Error)]
pub enum AnchorError {
    #[error("anchor payload expired")]
    Expired,
    #[error("invalid anchor public key")]
    InvalidKey,
    #[error("invalid anchor signature")]
    InvalidSignature,
    #[error("capability not granted: {capability}")]
    CapabilityNotGranted { capability: String },
    #[error("replayed capability envelope nonce: {nonce}")]
    Replay { nonce: String },
    #[error(transparent)]
    Hex(#[from] hex::FromHexError),
    #[error(transparent)]
    Serde(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keypair() -> AnchorKeypair {
        AnchorKeypair::from_seed([7_u8; 32])
    }

    #[test]
    fn signed_cards_verify() {
        let keypair = keypair();
        let card = keypair
            .sign_card(
                AnchorSubject::new("daemon-a"),
                vec!["mesh:peer".to_owned(), "room:write".to_owned()],
                60_000,
            )
            .unwrap();

        verify_card(&card, now_ms()).unwrap();
    }

    #[test]
    fn expired_cards_are_rejected() {
        let keypair = keypair();
        let card = keypair
            .sign_card(
                AnchorSubject::new("daemon-a"),
                vec!["mesh:peer".to_owned()],
                -1,
            )
            .unwrap();

        let err = verify_card(&card, now_ms()).unwrap_err();
        assert!(matches!(err, AnchorError::Expired));
    }

    #[test]
    fn capability_envelopes_verify_and_reject_replay() {
        let keypair = keypair();
        let card = keypair
            .sign_card(
                AnchorSubject::new("daemon-a"),
                vec!["mesh:peer".to_owned(), "room:write".to_owned()],
                60_000,
            )
            .unwrap();
        let envelope = keypair
            .issue_envelope(
                card,
                "daemon-b",
                "nonce-1",
                vec!["room:write".to_owned()],
                10_000,
            )
            .unwrap();
        let mut guard = ReplayGuard::default();

        verify_envelope(&envelope, &mut guard, now_ms()).unwrap();
        let err = verify_envelope(&envelope, &mut guard, now_ms()).unwrap_err();
        assert!(matches!(err, AnchorError::Replay { .. }));
    }

    #[test]
    fn envelope_rejects_ungranted_capability() {
        let keypair = keypair();
        let card = keypair
            .sign_card(
                AnchorSubject::new("daemon-a"),
                vec!["mesh:peer".to_owned()],
                60_000,
            )
            .unwrap();
        let envelope = keypair
            .issue_envelope(
                card,
                "daemon-b",
                "nonce-2",
                vec!["room:write".to_owned()],
                10_000,
            )
            .unwrap();
        let mut guard = ReplayGuard::default();

        let err = verify_envelope(&envelope, &mut guard, now_ms()).unwrap_err();
        assert!(matches!(err, AnchorError::CapabilityNotGranted { .. }));
    }

    #[test]
    fn merkle_root_is_stable() {
        let first = merkle_evidence(&[b"event-1", b"event-2", b"event-3"]);
        let second = merkle_evidence(&[b"event-1", b"event-2", b"event-3"]);

        assert_eq!(first, second);
        assert_eq!(first.leaf_count, 3);
    }
}
