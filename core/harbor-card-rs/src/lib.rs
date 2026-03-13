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

    /// Verifies a Harbor Card JWT string.
    /// 
    /// Strictly enforces:
    /// 1. Three-part JWT structure.
    /// 2. Ed25519 signature validity.
    /// 3. Current time is before 'exp'.
    pub fn verify(&self, token: &str, now_ts: i64) -> Result<HarborCardClaims, HarborError> {
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() != 3 {
            return Err(HarborError::Malformed);
        }

        let header_b64 = parts[0];
        let payload_b64 = parts[1];
        let signature_b64 = parts[2];

        // 1. Verify Signature FIRST (Algorithmic Pinning)
        // We ignore the 'alg' in the header and FORCE Ed25519 check.
        let msg = format!("{}.{}", header_b64, payload_b64);
        let sig_bytes = URL_SAFE_NO_PAD.decode(signature_b64)
            .map_err(|_| HarborError::InvalidEncoding)?;
        
        let signature = Signature::from_slice(&sig_bytes)
            .map_err(|_| HarborError::InvalidSignature)?;

        self.public_key.verify(msg.as_bytes(), &signature)
            .map_err(|_| HarborError::InvalidSignature)?;

        // 2. Decode and check claims
        let payload_bytes = URL_SAFE_NO_PAD.decode(payload_b64)
            .map_err(|_| HarborError::InvalidEncoding)?;
        
        let claims: HarborCardClaims = serde_json::from_slice(&payload_bytes)?;

        // 3. Time check
        if claims.exp < now_ts {
            return Err(HarborError::Expired);
        }

        Ok(claims)
    }
}

#[cfg(kani)]
#[kani::proof]
fn check_verify_no_panic() {
    let verifier = HarborCardVerifier::new([0u8; 32]).unwrap();
    // Use a fixed length byte array and convert to str safely
    let bytes: [u8; 64] = kani::any();
    if let Ok(token) = std::str::from_utf8(&bytes) {
        let _ = verifier.verify(token, 0);
    }
}
