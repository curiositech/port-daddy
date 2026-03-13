use serde::{Deserialize, Serialize};
use ed25519_dalek::{VerifyingKey, Signature, Verifier};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum HarborError {
    #[error("Invalid encoding")]
    InvalidEncoding,
    #[error("Invalid signature")]
    InvalidSignature,
    #[error("Token expired")]
    Expired,
    #[error("Malformed token")]
    Malformed,
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HarborCardClaims {
    pub sub: String,        // Agent ID
    pub harbor: String,     // Harbor Name
    pub cap: Vec<String>,   // Capabilities
    pub iat: i64,           // Issued At
    pub exp: i64,           // Expiry
    pub jti: String,        // Unique Token ID
}

pub struct HarborCardVerifier {
    pub public_key: VerifyingKey,
}

impl HarborCardVerifier {
    pub fn new(pk_bytes: [u8; 32]) -> Result<Self, HarborError> {
        let public_key = VerifyingKey::from_bytes(&pk_bytes)
            .map_err(|_| HarborError::InvalidEncoding)?;
        Ok(Self { public_key })
    }

    pub fn verify(&self, token: &str, now_ts: i64) -> Result<HarborCardClaims, HarborError> {
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() != 3 {
            return Err(HarborError::Malformed);
        }

        let header_b64 = parts[0];
        let payload_b64 = parts[1];
        let signature_b64 = parts[2];

        // 1. Verify Signature
        let msg = format!("{}.{}", header_b64, payload_b64);
        
        // STUB TARGET: base64 decode
        let sig_bytes = URL_SAFE_NO_PAD.decode(signature_b64)
            .map_err(|_| HarborError::InvalidEncoding)?;
        
        let signature = Signature::from_slice(&sig_bytes)
            .map_err(|_| HarborError::InvalidSignature)?;

        // STUB TARGET: ed25519 verify
        self.public_key.verify(msg.as_bytes(), &signature)
            .map_err(|_| HarborError::InvalidSignature)?;

        // 2. Decode payload
        let payload_bytes = URL_SAFE_NO_PAD.decode(payload_b64)
            .map_err(|_| HarborError::InvalidEncoding)?;
        
        // STUB TARGET: serde_json (though usually safe, we can stub if it's too slow)
        let claims: HarborCardClaims = serde_json::from_slice(&payload_bytes)?;

        // 3. Time check
        if claims.exp < now_ts {
            return Err(HarborError::Expired);
        }

        Ok(claims)
    }
}

// ─── Kani Verification Layer ─────────────────────────────────────────────────

#[cfg(kani)]
mod stubs {
    use super::*;
    
    // Replacement for Ed25519 verification
    pub fn signature_verify_stub(_pk: &VerifyingKey, _msg: &[u8], _sig: &Signature) -> Result<(), ed25519_dalek::SignatureError> {
        if kani::any() { Ok(()) } else { Err(ed25519_dalek::SignatureError::default()) }
    }

    // Explicitly stub VerifyingKey::from_bytes too
    pub fn from_bytes_stub(_bytes: &[u8; 32]) -> Result<VerifyingKey, ed25519_dalek::SignatureError> {
        // Return a fixed dummy key to avoid complex validation
        Ok(VerifyingKey::from_bytes(&[0u8; 32]).unwrap())
    }

    pub fn base64_decode_stub(_engine: &base64::engine::general_purpose::GeneralPurpose, _input: &str) -> Result<Vec<u8>, base64::DecodeError> {
        if kani::any() {
            Ok(vec![0u8; 64])
        } else {
            Err(base64::DecodeError::InvalidLength(0))
        }
    }
}

#[cfg(kani)]
#[kani::proof]
#[kani::stub(ed25519_dalek::Verifier::verify, stubs::signature_verify_stub)]
#[kani::stub(ed25519_dalek::VerifyingKey::from_bytes, stubs::from_bytes_stub)]
#[kani::stub(base64::engine::Engine::decode, stubs::base64_decode_stub)]
#[kani::unwind(5)]
fn proof_verify_logic_only() {
    let pk_bytes: [u8; 32] = kani::any();
    if let Ok(verifier) = HarborCardVerifier::new(pk_bytes) {
        let token_bytes: [u8; 32] = kani::any();
        if let Ok(token_str) = std::str::from_utf8(&token_bytes) {
            kani::assume(token_str.contains('.'));
            let _ = verifier.verify(token_str, 0);
        }
    }
}
