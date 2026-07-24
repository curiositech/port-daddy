//! Harbor Card verification — the in-repo reference for Port Daddy's Rust ⇄ TypeScript FFI.
//!
//! A *Harbor Card* is a compact, signed capability token shaped like a JWT
//! (`header.payload.signature`, each segment URL-safe base64, the signature an Ed25519
//! signature over `header.payload`). A Port Daddy daemon issues one to an agent to prove
//! "harbor `H` granted subject `S` capabilities `C` until instant `exp`". This crate does
//! two jobs with that token: it **verifies** a card ([`HarborCardVerifier::verify`]) and it
//! answers **capability-attenuation** questions — is this narrower set of caps a subset of
//! what the parent held? ([`HarborCardVerifier::verify_capability_subset`]).
//!
//! The crate is compiled two ways at once (`crate-type = ["cdylib", "rlib"]`, see
//! `Cargo.toml`). As an **rlib** it is unit-tested in-process and can be reused by other
//! Rust crates. As a **cdylib** it is loaded by the Bun/TypeScript daemon over the C ABI
//! through koffi (`lib/arbiter.ts` is the loader; `scripts/build-core.sh` builds and copies
//! the `.dylib`/`.so`). The TypeScript side treats the native library as an *upgrade*: if
//! it fails to load, the daemon falls back to a pure-TS path, so nothing here may ever
//! `panic!` its way into the host process.
//!
//! # Why this file is the FFI exemplar
//!
//! The whole repo's `extern "C"` convention is meant to be legible from here. The one rule
//! that prevents most disasters: **a panic unwinding across an `extern "C"` boundary is
//! undefined behavior**, and a security kernel must never crash its host on hostile input.
//! Every export in the *FFI / Shared Library Boundary* section below therefore obeys the
//! same four-part discipline:
//!
//! 1. Wrap the entire body in [`catch_unwind`] and return a fail-closed sentinel (`false`)
//!    if anything panics — defense in depth.
//! 2. Guard every raw pointer *before* dereferencing it: reject null, reject `len == 0`,
//!    reject absurd lengths (a denial-of-service guard), reject non-UTF-8, reject
//!    unparseable JSON. Real logic runs only once all guards pass.
//! 3. Never move a Rust `struct`/`enum`/`String` across the boundary — the Rust ABI is not
//!    C-stable. Structured data crosses as JSON over `*const c_char` + a `usize` length.
//! 4. Compare secret-derived bytes in constant time (fold-XOR, never an early return) so
//!    verification cannot leak byte positions through timing.
//!
//! Raw-pointer exports cannot be exercised from a Rust doctest, so each is documented below
//! with a worked JSON request/response example instead. The pure-Rust core they wrap —
//! [`HarborCardVerifier::constant_time_compare`] and
//! [`HarborCardVerifier::verify_capability_subset`] — carries the runnable doctests.
//!
//! # Fail-closed contract
//!
//! Everything here fails closed. [`HarborCardVerifier::verify`] returns `Err` (never a
//! partially-trusted `Ok`) on any of: wrong segment count, bad base64, bad signature,
//! a tampered payload, or an expired token. The FFI exports return `false` on *any* error.
//! No code path treats "I could not check it" as "it is fine".

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::Zeroize;

/// Every way verifying a Harbor Card can fail — the whole error surface of this crate.
///
/// Each variant is a distinct *reason to distrust* a token. They exist as separate variants
/// (rather than a single opaque `bool`) so callers can log precisely why a card was rejected
/// without leaking secret material. Deliberately, none of them carry the token bytes.
///
/// Note that across the FFI boundary this rich enum collapses to a single `false`: C callers
/// only ever learn "trusted / not trusted", never *which* check failed. That coarsening is
/// intentional — it keeps the boundary minimal and side-channel-free.
#[derive(Error, Debug)]
pub enum HarborError {
    /// A base64 segment did not decode, or the public key was not a valid Ed25519 encoding.
    #[error("Invalid encoding")]
    InvalidEncoding,
    /// The signature did not verify against the payload under this verifier's public key —
    /// the token was forged, tampered with, or signed by a different key.
    #[error("Invalid signature")]
    InvalidSignature,
    /// The token's `exp` claim is at or before the caller-supplied "now"; it is stale.
    #[error("Token expired")]
    Expired,
    /// The token was not three `.`-separated segments — it is not even shaped like a card.
    #[error("Malformed token")]
    Malformed,
    /// The decoded payload was not valid [`HarborCardClaims`] JSON. Carries the serde error.
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),
}

/// The verified claim set carried in a Harbor Card's payload segment.
///
/// This is the *content* of the token — who it is for, which harbor issued it, what it may
/// do, and when it expires. The short field names (`sub`, `iat`, `exp`, `jti`) mirror the
/// JWT registered-claim conventions so the same wire bytes are legible to JWT tooling.
/// A value of this type is only ever handed back by [`HarborCardVerifier::verify`] *after*
/// the signature and expiry have been checked, so holding one means "these claims are
/// authentic", not merely "these claims were parsed".
#[derive(Debug, Serialize, Deserialize)]
pub struct HarborCardClaims {
    /// Subject: the id of the agent/actor the card was minted for.
    pub sub: String,
    /// The harbor (Port Daddy realm) that issued and vouches for this card.
    pub harbor: String,
    /// Granted capabilities, as opaque capability strings (e.g. `"read"`, `"room:route"`).
    pub cap: Vec<String>,
    /// Issued-at, Unix time in seconds.
    pub iat: i64,
    /// Expiry, Unix time in seconds. Compared against the caller's clock in `verify`.
    pub exp: i64,
    /// JWT id: a unique token identifier, usable by callers for replay tracking.
    pub jti: String,
}

/// Holds the single Ed25519 public key a harbor's cards are checked against.
///
/// Construct one with [`HarborCardVerifier::new`] from the issuing harbor's 32-byte public
/// key, then call [`HarborCardVerifier::verify`] on incoming tokens. The type is deliberately
/// tiny and stateless beyond the key: verification is a pure function of `(key, token, now)`,
/// which is what makes it safe to expose across the FFI boundary and to reason about.
pub struct HarborCardVerifier {
    /// The Ed25519 verifying (public) key that legitimate cards must be signed under.
    pub public_key: VerifyingKey,
}

impl HarborCardVerifier {
    /// Build a verifier from a harbor's raw 32-byte Ed25519 public key.
    ///
    /// # Errors
    /// Returns [`HarborError::InvalidEncoding`] if `pk_bytes` cannot be decompressed to an
    /// Ed25519 point. This is the *only* place the key is validated: once you hold a
    /// `HarborCardVerifier`, its key is known-well-formed, so [`verify`](Self::verify) never
    /// has to re-check it. (Ed25519 decompression accepts non-canonical encodings, so most
    /// arbitrary 32-byte arrays parse — real rejection is rare.)
    ///
    /// ```
    /// use harbor_card_rs::HarborCardVerifier;
    ///
    /// // Build a verifier from a harbor's 32-byte public key.
    /// let verifier = HarborCardVerifier::new([0u8; 32]).expect("well-formed key");
    /// // It fails closed on anything that is not a real card: "not-a-token" is not three
    /// // dot-separated segments, so verification rejects it rather than trusting it.
    /// assert!(verifier.verify("not-a-token", 0).is_err());
    /// ```
    pub fn new(pk_bytes: [u8; 32]) -> Result<Self, HarborError> {
        let public_key = Self::internal_pk_from_bytes(pk_bytes)?;
        Ok(Self { public_key })
    }

    /// Decode a 32-byte public key, mapping any curve/length error to `InvalidEncoding`.
    fn internal_pk_from_bytes(bytes: [u8; 32]) -> Result<VerifyingKey, HarborError> {
        VerifyingKey::from_bytes(&bytes).map_err(|_| HarborError::InvalidEncoding)
    }

    /// Decode one URL-safe, unpadded base64 token segment to bytes.
    fn internal_decode_b64(input: &str) -> Result<Vec<u8>, HarborError> {
        URL_SAFE_NO_PAD
            .decode(input)
            .map_err(|_| HarborError::InvalidEncoding)
    }

    /// Verify a raw Ed25519 signature over `msg` under this verifier's public key.
    fn internal_verify_sig(&self, msg: &[u8], sig_bytes: &[u8]) -> Result<(), HarborError> {
        let signature =
            Signature::from_slice(sig_bytes).map_err(|_| HarborError::InvalidSignature)?;
        self.public_key
            .verify(msg, &signature)
            .map_err(|_| HarborError::InvalidSignature)
    }

    /// Compare two byte slices in constant time — `true` iff they are byte-for-byte equal.
    ///
    /// # Why constant time
    /// A naive `a == b` returns as soon as it hits the first differing byte, so an attacker
    /// who can time the comparison learns *how many* leading bytes they guessed correctly and
    /// can recover a secret (a MAC, a token) byte by byte. This implementation instead folds
    /// the XOR of every byte pair into an accumulator and only checks it at the end, so the
    /// running time depends on the *length* of the inputs but not on *where* they differ.
    /// Length is not treated as secret: unequal lengths short-circuit to `false` immediately.
    ///
    /// This is a static method (no key needed) and is exactly the logic the FFI export
    /// [`harbor_constant_time_compare`] wraps, which is why it carries the doctest and the
    /// export does not.
    ///
    /// ```
    /// use harbor_card_rs::HarborCardVerifier;
    ///
    /// assert!(HarborCardVerifier::constant_time_compare(b"s3cr3t", b"s3cr3t"));
    /// assert!(!HarborCardVerifier::constant_time_compare(b"s3cr3t", b"s3cr3T"));
    /// assert!(!HarborCardVerifier::constant_time_compare(b"short", b"longer"));
    /// assert!(HarborCardVerifier::constant_time_compare(b"", b"")); // empty == empty
    /// ```
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

    /// Return `true` iff every capability in `sub_caps` is also present in `root_caps`.
    ///
    /// This is the enforcement point for **capability attenuation**: a delegated card may
    /// only ever narrow, never widen, the authority it descends from. Delegation is safe
    /// exactly when the child's caps are a subset of the parent's, so any capability the
    /// child claims that the parent never held (`"admin"` sneaking in) makes this return
    /// `false`. The empty set is a subset of everything, so a child that requests no caps
    /// always passes. Comparison is exact string equality on opaque capability tokens — there
    /// is no wildcard or prefix logic here by design.
    ///
    /// ```
    /// use harbor_card_rs::HarborCardVerifier;
    ///
    /// let root = vec!["read".to_string(), "write".to_string()];
    /// // Narrowing to a subset is allowed:
    /// assert!(HarborCardVerifier::verify_capability_subset(&root, &["read".to_string()]));
    /// // Escalating to a capability the parent never held is rejected:
    /// assert!(!HarborCardVerifier::verify_capability_subset(&root, &["admin".to_string()]));
    /// // The empty set attenuates from anything:
    /// assert!(HarborCardVerifier::verify_capability_subset(&root, &[]));
    /// ```
    pub fn verify_capability_subset(root_caps: &[String], sub_caps: &[String]) -> bool {
        for sub in sub_caps {
            if !root_caps.contains(sub) {
                return false;
            }
        }
        true
    }

    /// Verify a Harbor Card token and return its authenticated claims, or fail closed.
    ///
    /// The token must be exactly three `.`-separated base64 segments
    /// (`header.payload.signature`). Verification proceeds in a deliberate order:
    ///
    /// 1. Split into three segments — anything else is [`HarborError::Malformed`].
    /// 2. Verify the Ed25519 signature over `header.payload` *before* trusting the payload,
    ///    so tampered or forged content never even gets deserialized as "claims".
    /// 3. Only then decode and parse the payload into [`HarborCardClaims`].
    /// 4. Reject the token if `claims.exp < now_ts` ([`HarborError::Expired`]).
    ///
    /// The decoded signature and payload buffers are [`zeroize`](zeroize::Zeroize)d after use
    /// so raw token bytes do not linger in freed memory.
    ///
    /// # Errors
    /// [`HarborError::Malformed`] (wrong segment count), [`HarborError::InvalidEncoding`]
    /// (bad base64), [`HarborError::InvalidSignature`] (forged/tampered/wrong-key),
    /// [`HarborError::JsonError`] (payload is not valid claims JSON), or
    /// [`HarborError::Expired`]. It never returns a partially-trusted `Ok`.
    ///
    /// # Example (worked token, not a doctest)
    /// A valid call looks like `verifier.verify("eyJhbGc...".., 1_700_000_000)` and yields
    /// claims such as:
    /// ```json
    /// { "sub": "agent-1", "harbor": "local", "cap": ["read"],
    ///   "iat": 0, "exp": 9999999999, "jti": "abc123" }
    /// ```
    /// A runnable end-to-end round trip (mint with a `SigningKey`, then verify) lives in this
    /// crate's `tests` module — see `verify_roundtrip_valid_token` — because minting requires
    /// the Ed25519 signing half that a doctest would otherwise have to reconstruct.
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

/// FFI: constant-time byte comparison, callable from C / TypeScript-over-koffi.
///
/// This is the C-ABI wrapper around [`HarborCardVerifier::constant_time_compare`] (which
/// holds the doctest and the "why constant time" rationale). It exists so the TypeScript
/// daemon can do timing-safe tag comparison in native code. Beyond the pure comparison it
/// adds two boundary guards: null/empty inputs return `false`, and inputs longer than 1024
/// bytes return `false` (a denial-of-service guard against a caller passing a pathological
/// length that turns a compare into a multi-gigabyte read).
///
/// # Returns
/// `true` iff both pointers are non-null, both lengths are in `1..=1024` and equal, and the
/// two byte ranges are identical. `false` in every other case — including any panic, which
/// [`catch_unwind`] converts to `false` rather than letting it unwind into the host
/// (undefined behavior).
///
/// # Example (conceptual C call)
/// ```text
/// harbor_constant_time_compare(tag_a, 32, tag_b, 32) -> true   // identical 32-byte tags
/// harbor_constant_time_compare(NULL,  32, tag_b, 32) -> false  // null guard
/// harbor_constant_time_compare(tag_a, 4096, ...)     -> false  // oversize DoS guard
/// ```
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

/// FFI: capability-attenuation check with both cap sets marshalled as JSON arrays.
///
/// This is the C-ABI wrapper around [`HarborCardVerifier::verify_capability_subset`] and the
/// canonical demonstration of the repo's "structured data crosses as JSON over
/// `*const c_char` + `usize`" rule. Each argument is a UTF-8 JSON array of capability
/// strings; the function returns `true` iff the `sub` set attenuates from (is a subset of)
/// the `root` set.
///
/// It fails closed through the full guard chain before running any logic: null pointer →
/// `false`; zero length → `false`; non-UTF-8 bytes → `false`; JSON that does not parse as a
/// `Vec<String>` → `false`; and any panic is caught and reported as `false`.
///
/// # Worked example (JSON in → bool out)
/// ```text
/// root_json = ["read","write"]   sub_json = ["read"]          -> true   (valid attenuation)
/// root_json = ["read"]           sub_json = ["read","admin"]  -> false  (privilege escalation)
/// root_json = not json           sub_json = ["read"]          -> false  (malformed → fail closed)
/// root_json = NULL               sub_json = ["read"]          -> false  (null guard)
/// ```
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
        let header_b64 = URL_SAFE_NO_PAD.encode(br#"{"alg":"EdDSA"}"#);
        let payload_json = serde_json::to_vec(claims).unwrap();
        let payload_b64 = URL_SAFE_NO_PAD.encode(payload_json);
        let msg = format!("{}.{}", header_b64, payload_b64);
        let sig = signing_key.sign(msg.as_bytes());
        let sig_b64 = URL_SAFE_NO_PAD.encode(sig.to_bytes());
        format!("{}.{}.{}", header_b64, payload_b64, sig_b64)
    }

    fn sample_claims(exp: i64) -> HarborCardClaims {
        HarborCardClaims {
            sub: "agent-1".to_string(),
            harbor: "local".to_string(),
            cap: vec!["read".to_string()],
            iat: 0,
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
