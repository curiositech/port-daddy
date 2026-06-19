use serde::{Deserialize, Serialize};
use ed25519_dalek::{VerifyingKey, Signature, Verifier};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use thiserror::Error;
use zeroize::Zeroize;

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
    pub sub: String,
    pub harbor: String,
    pub cap: Vec<String>,
    pub iat: i64,
    pub exp: i64,
    pub jti: String,
}

pub struct HarborCardVerifier {
    pub public_key: VerifyingKey,
}

impl HarborCardVerifier {
    pub fn new(pk_bytes: [u8; 32]) -> Result<Self, HarborError> {
        let public_key = Self::internal_pk_from_bytes(pk_bytes)?;
        Ok(Self { public_key })
    }

    fn internal_pk_from_bytes(bytes: [u8; 32]) -> Result<VerifyingKey, HarborError> {
        VerifyingKey::from_bytes(&bytes).map_err(|_| HarborError::InvalidEncoding)
    }

    fn internal_decode_b64(input: &str) -> Result<Vec<u8>, HarborError> {
        URL_SAFE_NO_PAD.decode(input).map_err(|_| HarborError::InvalidEncoding)
    }

    fn internal_verify_sig(&self, msg: &[u8], sig_bytes: &[u8]) -> Result<(), HarborError> {
        let signature = Signature::from_slice(sig_bytes).map_err(|_| HarborError::InvalidSignature)?;
        self.public_key.verify(msg, &signature).map_err(|_| HarborError::InvalidSignature)
    }

    pub fn constant_time_compare(a: &[u8], b: &[u8]) -> bool {
        if a.len() != b.len() {
            return false;
        }
        let mut result = 0u8;
        for i in 0..a.len() {
            result |= a[i] ^ b[i];
        }
        result == 0
    }

    pub fn verify_capability_subset(root_caps: &[String], sub_caps: &[String]) -> bool {
        for sub in sub_caps {
            if !root_caps.contains(sub) {
                return false;
            }
        }
        true
    }

    pub fn verify(&self, token: &str, now_ts: i64) -> Result<HarborCardClaims, HarborError> {
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() != 3 {
            return Err(HarborError::Malformed);
        }

        let header_b64 = parts[0];
        let payload_b64 = parts[1];
        let signature_b64 = parts[2];

        let msg = format!("{}.{}", header_b64, payload_b64);
        let mut sig_bytes = Self::internal_decode_b64(signature_b64)?;
        
        let sig_result = self.internal_verify_sig(msg.as_bytes(), &sig_bytes);
        sig_bytes.zeroize();
        sig_result?;

        let mut payload_bytes = Self::internal_decode_b64(payload_b64)?;
        let claims: HarborCardClaims = serde_json::from_slice(&payload_bytes)?;
        payload_bytes.zeroize();

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
    
    pub fn pk_from_bytes_stub(_bytes: [u8; 32]) -> Result<VerifyingKey, HarborError> {
        Ok(VerifyingKey::from_bytes(&[0u8; 32]).unwrap())
    }

    pub fn decode_b64_stub(_input: &str) -> Result<Vec<u8>, HarborError> {
        if kani::any() { Ok(vec![0u8; 32]) } else { Err(HarborError::InvalidEncoding) }
    }

    pub fn verify_sig_stub(_verifier: &HarborCardVerifier, _msg: &[u8], _sig: &[u8]) -> Result<(), HarborError> {
        if kani::any() { Ok(()) } else { Err(HarborError::InvalidSignature) }
    }
}

#[cfg(kani)]
#[kani::proof]
#[kani::stub(HarborCardVerifier::internal_pk_from_bytes, stubs::pk_from_bytes_stub)]
#[kani::stub(HarborCardVerifier::internal_decode_b64, stubs::decode_b64_stub)]
#[kani::stub(HarborCardVerifier::internal_verify_sig, stubs::verify_sig_stub)]
#[kani::unwind(10)]
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

#[cfg(kani)]
#[kani::proof]
fn proof_constant_time_behavior() {
    let a: [u8; 16] = kani::any();
    let b: [u8; 16] = kani::any();
    let _ = HarborCardVerifier::constant_time_compare(&a, &b);
}

#[cfg(kani)]
#[kani::proof]
fn proof_capability_attenuation() {
    let root = vec!["read".to_string(), "write".to_string()];
    let mut sub = vec!["read".to_string()];
    assert!(HarborCardVerifier::verify_capability_subset(&root, &sub));
    sub.push("admin".to_string());
    assert!(!HarborCardVerifier::verify_capability_subset(&root, &sub));
}

// ─── FFI / Shared Library Boundary ──────────────────────────────────────────

use std::os::raw::c_char;

/// FFI: Constant-time byte comparison.
#[no_mangle]
pub extern "C" fn harbor_constant_time_compare(
    a: *const u8, 
    a_len: usize, 
    b: *const u8, 
    b_len: usize
) -> bool {
    if a.is_null() || b.is_null() || a_len == 0 || b_len == 0 {
        return false;
    }
    // Prevent pathological sizes from causing out-of-memory or massive hangs
    if a_len > 1024 || b_len > 1024 {
        return false; 
    }
    
    let a_slice = unsafe { std::slice::from_raw_parts(a, a_len) };
    let b_slice = unsafe { std::slice::from_raw_parts(b, b_len) };
    HarborCardVerifier::constant_time_compare(a_slice, b_slice)
}

/// FFI: Verify if sub_caps JSON string is a subset of root_caps JSON string.
/// Returns true if valid, false if escalation detected or malformed.
#[no_mangle]
pub extern "C" fn harbor_verify_caps_subset_json(
    root_json: *const c_char,
    root_len: usize,
    sub_json: *const c_char,
    sub_len: usize
) -> bool {
    if root_json.is_null() || sub_json.is_null() || root_len == 0 || sub_len == 0 {
        return false;
    }
    
    let root_bytes = unsafe { std::slice::from_raw_parts(root_json as *const u8, root_len) };
    let sub_bytes = unsafe { std::slice::from_raw_parts(sub_json as *const u8, sub_len) };

    let root_str = match std::str::from_utf8(root_bytes) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let sub_str = match std::str::from_utf8(sub_bytes) {
        Ok(s) => s,
        Err(_) => return false,
    };
    
    let root_vec: Vec<String> = match serde_json::from_str(&root_str) {
        Ok(v) => v,
        Err(_) => return false,
    };
    
    let sub_vec: Vec<String> = match serde_json::from_str(&sub_str) {
        Ok(v) => v,
        Err(_) => return false,
    };
    
    HarborCardVerifier::verify_capability_subset(&root_vec, &sub_vec)
}
