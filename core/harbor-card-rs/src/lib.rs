use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
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
    /// The token's header declares a signature algorithm this implementation does
    /// not support. Only [`SUPPORTED_ALG`] (`EdDSA`) is accepted; anything else —
    /// including `none` — is rejected fail-closed before the claims are trusted.
    #[error("Unsupported algorithm")]
    UnsupportedAlgorithm,
    /// The token's `iat` (issued-at) is further in the future than the permitted
    /// clock-skew window ([`MAX_CLOCK_SKEW_SECS`]). A token that claims to have
    /// been issued after "now" is either a clock-skew abuse or a forgery attempt.
    #[error("Token issued in the future")]
    IssuedInFuture,
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),
}

/// The one signature algorithm this verifier implements: Ed25519 (`EdDSA`).
///
/// The token header carries an `alg` field. This crate always verifies with
/// Ed25519 regardless of what the field claims, so [`HarborCardVerifier::verify`]
/// cross-checks the declared `alg` against this constant and rejects any mismatch.
/// That closes the "algorithm confusion" class (e.g. a token forged with
/// `alg: none` or a symmetric algorithm) fail-closed, rather than silently
/// EdDSA-verifying whatever the header claims.
pub const SUPPORTED_ALG: &str = "EdDSA";

/// Maximum tolerated clock skew, in seconds, for the `iat` not-before check.
///
/// A token whose `iat` exceeds `now + MAX_CLOCK_SKEW_SECS` is rejected as
/// future-dated. The window absorbs benign clock drift between the issuer and the
/// verifier while still rejecting tokens dated meaningfully into the future.
pub const MAX_CLOCK_SKEW_SECS: i64 = 60;

/// The token header. Only the `alg` field is meaningful to this verifier; it is
/// cross-checked against [`SUPPORTED_ALG`] so the claimed algorithm cannot diverge
/// from the algorithm actually used.
#[derive(Debug, Deserialize)]
pub struct HarborCardHeader {
    pub alg: String,
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
        URL_SAFE_NO_PAD
            .decode(input)
            .map_err(|_| HarborError::InvalidEncoding)
    }

    fn internal_verify_sig(&self, msg: &[u8], sig_bytes: &[u8]) -> Result<(), HarborError> {
        let signature =
            Signature::from_slice(sig_bytes).map_err(|_| HarborError::InvalidSignature)?;
        self.public_key
            .verify(msg, &signature)
            .map_err(|_| HarborError::InvalidSignature)
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

    /// Verify a Harbor card token (`header.payload.signature`, each part
    /// URL-safe base64 without padding) against this verifier's public key and
    /// the supplied wall-clock time `now_ts` (unix seconds).
    ///
    /// The checks run fail-closed, in an order chosen so that no untrusted field
    /// is trusted before the signature is confirmed:
    ///
    /// 1. **Structure** — exactly three dot-separated parts, else [`HarborError::Malformed`].
    /// 2. **Signature** — Ed25519 over `header.payload`. A forged or tampered
    ///    token fails here ([`HarborError::InvalidSignature`]) before any claim
    ///    is read. The signature covers the header, so the `alg` field below is
    ///    authenticated, not attacker-chosen.
    /// 3. **Algorithm** — the header's `alg` must equal [`SUPPORTED_ALG`]. This
    ///    verifier only ever runs Ed25519; cross-checking the declared algorithm
    ///    closes the "alg confusion" class (`alg: none`, symmetric-key confusion)
    ///    fail-closed rather than silently EdDSA-verifying an arbitrary claim.
    /// 4. **Issued-at (`iat`)** — a not-before check. A token whose `iat` is more
    ///    than [`MAX_CLOCK_SKEW_SECS`] into the future is rejected
    ///    ([`HarborError::IssuedInFuture`]); a token whose `iat` is after its own
    ///    `exp` is incoherent and rejected as [`HarborError::Malformed`]. There is
    ///    deliberately no independent max-age bound: `exp` already bounds the
    ///    validity window, and an issuer-controlled lifetime should not be second-
    ///    guessed here.
    /// 5. **Expiry (`exp`)** — rejected as [`HarborError::Expired`] once `exp < now_ts`.
    ///
    /// ```
    /// # // Full happy-path verification needs the signing key, so it lives in the
    /// # // test module; this block pins the public policy constants the contract
    /// # // above refers to.
    /// use harbor_card_rs::{SUPPORTED_ALG, MAX_CLOCK_SKEW_SECS};
    /// assert_eq!(SUPPORTED_ALG, "EdDSA");
    /// assert_eq!(MAX_CLOCK_SKEW_SECS, 60);
    /// ```
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

        // The header is authenticated by the signature above, so its `alg` claim
        // is now trustworthy — but "trustworthy" still means "must say what we
        // actually verify with". Reject any algorithm other than Ed25519 so a
        // future format extension (or a mis-issued token) cannot slip a different
        // algorithm past a verifier that only ever runs one.
        let mut header_bytes = Self::internal_decode_b64(header_b64)?;
        let header: HarborCardHeader = serde_json::from_slice(&header_bytes)?;
        header_bytes.zeroize();
        if header.alg != SUPPORTED_ALG {
            return Err(HarborError::UnsupportedAlgorithm);
        }

        let mut payload_bytes = Self::internal_decode_b64(payload_b64)?;
        let claims: HarborCardClaims = serde_json::from_slice(&payload_bytes)?;
        payload_bytes.zeroize();

        // Issued-at validation. A token dated after its own expiry is incoherent;
        // a token dated meaningfully into the future is a clock-skew abuse or a
        // forgery attempt. Both are rejected before the token is honored.
        if claims.iat > claims.exp {
            return Err(HarborError::Malformed);
        }
        if claims.iat > now_ts.saturating_add(MAX_CLOCK_SKEW_SECS) {
            return Err(HarborError::IssuedInFuture);
        }

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
        if kani::any() {
            Ok(vec![0u8; 32])
        } else {
            Err(HarborError::InvalidEncoding)
        }
    }

    pub fn verify_sig_stub(
        _verifier: &HarborCardVerifier,
        _msg: &[u8],
        _sig: &[u8],
    ) -> Result<(), HarborError> {
        if kani::any() {
            Ok(())
        } else {
            Err(HarborError::InvalidSignature)
        }
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
use std::panic::{catch_unwind, AssertUnwindSafe};

/// FFI: Constant-time byte comparison.
///
/// # Safety
/// `a` must point to at least `a_len` readable bytes (or be null); same for `b`/`b_len`.
/// Never panics across the FFI boundary — any panic is caught and reported as `false`.
#[no_mangle]
pub unsafe extern "C" fn harbor_constant_time_compare(
    a: *const u8,
    a_len: usize,
    b: *const u8,
    b_len: usize,
) -> bool {
    catch_unwind(AssertUnwindSafe(|| {
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
    }))
    .unwrap_or(false)
}

/// FFI: Verify if sub_caps JSON string is a subset of root_caps JSON string.
/// Returns true if valid, false if escalation detected or malformed.
///
/// # Safety
/// `root_json` must point to at least `root_len` readable bytes (or be null); same for
/// `sub_json`/`sub_len`. Never panics across the FFI boundary — any panic is caught and
/// reported as `false`.
#[no_mangle]
pub unsafe extern "C" fn harbor_verify_caps_subset_json(
    root_json: *const c_char,
    root_len: usize,
    sub_json: *const c_char,
    sub_len: usize,
) -> bool {
    catch_unwind(AssertUnwindSafe(|| {
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

        let root_vec: Vec<String> = match serde_json::from_str(root_str) {
            Ok(v) => v,
            Err(_) => return false,
        };

        let sub_vec: Vec<String> = match serde_json::from_str(sub_str) {
            Ok(v) => v,
            Err(_) => return false,
        };

        HarborCardVerifier::verify_capability_subset(&root_vec, &sub_vec)
    }))
    .unwrap_or(false)
}

// ─── Unit tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{SecretKey, Signer, SigningKey};

    fn test_verifier() -> (SigningKey, HarborCardVerifier) {
        let seed: SecretKey = [7u8; 32];
        let signing_key = SigningKey::from_bytes(&seed);
        let public_key = signing_key.verifying_key();
        (signing_key, HarborCardVerifier { public_key })
    }

    fn issue_token(signing_key: &SigningKey, claims: &HarborCardClaims) -> String {
        issue_token_with_header(signing_key, br#"{"alg":"EdDSA"}"#, claims)
    }

    /// Issue a token with a caller-chosen header (still correctly signed over
    /// `header.payload`). Used to exercise the `alg` cross-check: an attacker who
    /// could influence the header would still have to produce a valid signature,
    /// so these tokens verify at the signature step and must be rejected at the
    /// algorithm step.
    fn issue_token_with_header(
        signing_key: &SigningKey,
        header_json: &[u8],
        claims: &HarborCardClaims,
    ) -> String {
        let header_b64 = URL_SAFE_NO_PAD.encode(header_json);
        let payload_json = serde_json::to_vec(claims).unwrap();
        let payload_b64 = URL_SAFE_NO_PAD.encode(payload_json);
        let msg = format!("{}.{}", header_b64, payload_b64);
        let sig = signing_key.sign(msg.as_bytes());
        let sig_b64 = URL_SAFE_NO_PAD.encode(sig.to_bytes());
        format!("{}.{}.{}", header_b64, payload_b64, sig_b64)
    }

    fn sample_claims(exp: i64) -> HarborCardClaims {
        claims_with(0, exp)
    }

    fn claims_with(iat: i64, exp: i64) -> HarborCardClaims {
        HarborCardClaims {
            sub: "agent-1".to_string(),
            harbor: "local".to_string(),
            cap: vec!["read".to_string()],
            iat,
            exp,
            jti: "abc123".to_string(),
        }
    }

    #[test]
    fn constant_time_compare_equal_bytes() {
        assert!(HarborCardVerifier::constant_time_compare(
            b"same-bytes",
            b"same-bytes"
        ));
    }

    #[test]
    fn constant_time_compare_different_length() {
        assert!(!HarborCardVerifier::constant_time_compare(
            b"short",
            b"much-longer"
        ));
    }

    #[test]
    fn constant_time_compare_same_length_different_content() {
        assert!(!HarborCardVerifier::constant_time_compare(
            b"aaaaaaaa",
            b"aaaaaaab"
        ));
    }

    #[test]
    fn constant_time_compare_empty_slices_are_equal() {
        assert!(HarborCardVerifier::constant_time_compare(b"", b""));
    }

    #[test]
    fn verify_capability_subset_true_for_subset() {
        let root = vec!["read".to_string(), "write".to_string()];
        let sub = vec!["read".to_string()];
        assert!(HarborCardVerifier::verify_capability_subset(&root, &sub));
    }

    #[test]
    fn verify_capability_subset_false_on_escalation() {
        let root = vec!["read".to_string()];
        let sub = vec!["read".to_string(), "admin".to_string()];
        assert!(!HarborCardVerifier::verify_capability_subset(&root, &sub));
    }

    #[test]
    fn verify_capability_subset_true_for_empty_sub() {
        let root = vec!["read".to_string()];
        let sub: Vec<String> = vec![];
        assert!(HarborCardVerifier::verify_capability_subset(&root, &sub));
    }

    #[test]
    fn verify_roundtrip_valid_token() {
        let (signing_key, verifier) = test_verifier();
        let claims = sample_claims(9_999_999_999);
        let token = issue_token(&signing_key, &claims);

        let verified = verifier
            .verify(&token, 0)
            .expect("valid token should verify");
        assert_eq!(verified.sub, "agent-1");
        assert_eq!(verified.cap, vec!["read".to_string()]);
    }

    #[test]
    fn verify_rejects_expired_token() {
        let (signing_key, verifier) = test_verifier();
        let claims = sample_claims(100);
        let token = issue_token(&signing_key, &claims);

        let err = verifier.verify(&token, 200).unwrap_err();
        assert!(matches!(err, HarborError::Expired));
    }

    #[test]
    fn verify_rejects_malformed_token_wrong_part_count() {
        let (_signing_key, verifier) = test_verifier();
        let err = verifier.verify("only.two", 0).unwrap_err();
        assert!(matches!(err, HarborError::Malformed));
    }

    #[test]
    fn verify_rejects_tampered_payload() {
        let (signing_key, verifier) = test_verifier();
        let claims = sample_claims(9_999_999_999);
        let token = issue_token(&signing_key, &claims);
        let parts: Vec<&str> = token.split('.').collect();
        let tampered_payload = URL_SAFE_NO_PAD.encode(br#"{"sub":"attacker"}"#);
        let tampered = format!("{}.{}.{}", parts[0], tampered_payload, parts[2]);

        let err = verifier.verify(&tampered, 0).unwrap_err();
        assert!(matches!(err, HarborError::InvalidSignature));
    }

    #[test]
    fn verify_rejects_wrong_signing_key() {
        let (_signing_key, verifier) = test_verifier();
        let other_seed: SecretKey = [9u8; 32];
        let other_key = SigningKey::from_bytes(&other_seed);
        let claims = sample_claims(9_999_999_999);
        let token = issue_token(&other_key, &claims);

        let err = verifier.verify(&token, 0).unwrap_err();
        assert!(matches!(err, HarborError::InvalidSignature));
    }

    // ─── alg-confusion hardening ──────────────────────────────────────────────

    #[test]
    fn verify_rejects_alg_none_even_when_signed() {
        // Classic "alg: none" forgery shape. The token is correctly Ed25519-signed
        // (so it passes the signature step), but its header claims no algorithm.
        // The cross-check must reject it rather than honoring the claims.
        let (signing_key, verifier) = test_verifier();
        let claims = sample_claims(9_999_999_999);
        let token = issue_token_with_header(&signing_key, br#"{"alg":"none"}"#, &claims);

        let err = verifier.verify(&token, 0).unwrap_err();
        assert!(matches!(err, HarborError::UnsupportedAlgorithm));
    }

    #[test]
    fn verify_rejects_symmetric_alg_confusion() {
        // A token declaring a symmetric algorithm (HS256) must be rejected: this
        // verifier only ever runs Ed25519, and must not let the header pretend
        // otherwise.
        let (signing_key, verifier) = test_verifier();
        let claims = sample_claims(9_999_999_999);
        let token = issue_token_with_header(&signing_key, br#"{"alg":"HS256"}"#, &claims);

        let err = verifier.verify(&token, 0).unwrap_err();
        assert!(matches!(err, HarborError::UnsupportedAlgorithm));
    }

    #[test]
    fn verify_rejects_missing_alg_field() {
        // A header with no `alg` at all is malformed JSON for HarborCardHeader.
        let (signing_key, verifier) = test_verifier();
        let claims = sample_claims(9_999_999_999);
        let token = issue_token_with_header(&signing_key, br#"{}"#, &claims);

        let err = verifier.verify(&token, 0).unwrap_err();
        assert!(matches!(err, HarborError::JsonError(_)));
    }

    // ─── iat (issued-at) validation ──────────────────────────────────────────

    #[test]
    fn verify_rejects_future_iat() {
        // Token dated well into the future relative to `now_ts`: clock-skew abuse.
        let (signing_key, verifier) = test_verifier();
        let claims = claims_with(10_000, 9_999_999_999);
        let token = issue_token(&signing_key, &claims);

        let err = verifier.verify(&token, 1_000).unwrap_err();
        assert!(matches!(err, HarborError::IssuedInFuture));
    }

    #[test]
    fn verify_accepts_iat_within_clock_skew() {
        // Token issued slightly ahead of the verifier's clock, inside the skew
        // window: benign drift, must still verify.
        let (signing_key, verifier) = test_verifier();
        let iat = 1_000 + MAX_CLOCK_SKEW_SECS - 1;
        let claims = claims_with(iat, 9_999_999_999);
        let token = issue_token(&signing_key, &claims);

        let verified = verifier
            .verify(&token, 1_000)
            .expect("iat within skew window should verify");
        assert_eq!(verified.sub, "agent-1");
    }

    #[test]
    fn verify_rejects_iat_after_exp() {
        // Incoherent token: issued after it expires. Rejected as malformed.
        let (signing_key, verifier) = test_verifier();
        let claims = claims_with(9_000, 8_000);
        let token = issue_token(&signing_key, &claims);

        // now_ts large enough that the future-iat and expiry checks don't fire
        // first — we want the iat>exp coherence check to be what rejects it.
        let err = verifier.verify(&token, 10_000).unwrap_err();
        assert!(matches!(err, HarborError::Malformed));
    }

    // ─── FFI wrapper tests (exercise the extern "C" boundary directly) ────────

    #[test]
    fn ffi_constant_time_compare_matches_safe_impl() {
        let a = b"identical".to_vec();
        let b = b"identical".to_vec();
        let result =
            unsafe { harbor_constant_time_compare(a.as_ptr(), a.len(), b.as_ptr(), b.len()) };
        assert!(result);
    }

    #[test]
    fn ffi_constant_time_compare_null_pointer_returns_false() {
        let result =
            unsafe { harbor_constant_time_compare(std::ptr::null(), 4, std::ptr::null(), 4) };
        assert!(!result);
    }

    #[test]
    fn ffi_constant_time_compare_oversized_input_returns_false() {
        let a = vec![0u8; 2048];
        let result =
            unsafe { harbor_constant_time_compare(a.as_ptr(), a.len(), a.as_ptr(), a.len()) };
        assert!(!result);
    }

    #[test]
    fn ffi_verify_caps_subset_json_valid_subset() {
        let root = b"[\"read\",\"write\"]".to_vec();
        let sub = b"[\"read\"]".to_vec();
        let result = unsafe {
            harbor_verify_caps_subset_json(
                root.as_ptr() as *const c_char,
                root.len(),
                sub.as_ptr() as *const c_char,
                sub.len(),
            )
        };
        assert!(result);
    }

    #[test]
    fn ffi_verify_caps_subset_json_rejects_escalation() {
        let root = b"[\"read\"]".to_vec();
        let sub = b"[\"read\",\"admin\"]".to_vec();
        let result = unsafe {
            harbor_verify_caps_subset_json(
                root.as_ptr() as *const c_char,
                root.len(),
                sub.as_ptr() as *const c_char,
                sub.len(),
            )
        };
        assert!(!result);
    }

    #[test]
    fn ffi_verify_caps_subset_json_rejects_malformed_json() {
        let root = b"not json".to_vec();
        let sub = b"[\"read\"]".to_vec();
        let result = unsafe {
            harbor_verify_caps_subset_json(
                root.as_ptr() as *const c_char,
                root.len(),
                sub.as_ptr() as *const c_char,
                sub.len(),
            )
        };
        assert!(!result);
    }

    #[test]
    fn ffi_verify_caps_subset_json_rejects_null() {
        let sub = b"[\"read\"]".to_vec();
        let result = unsafe {
            harbor_verify_caps_subset_json(
                std::ptr::null(),
                0,
                sub.as_ptr() as *const c_char,
                sub.len(),
            )
        };
        assert!(!result);
    }
}

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn constant_time_compare_agrees_with_equality(a: Vec<u8>, b: Vec<u8>) {
            let expected = a == b;
            prop_assert_eq!(HarborCardVerifier::constant_time_compare(&a, &b), expected);
        }

        #[test]
        fn subset_of_itself_is_always_true(caps: Vec<String>) {
            prop_assert!(HarborCardVerifier::verify_capability_subset(&caps, &caps));
        }

        #[test]
        fn appending_a_novel_cap_breaks_subset(root: Vec<String>, extra in "[a-z]{1,10}") {
            prop_assume!(!root.contains(&extra));
            let mut sub = root.clone();
            sub.push(extra);
            prop_assert!(!HarborCardVerifier::verify_capability_subset(&root, &sub));
        }
    }
}
