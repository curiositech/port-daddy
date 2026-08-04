//! Adversarial red-team / white-hat suite for the live-production capability-subset
//! verifier and Ed25519 harbor-card gate (`core/harbor-card-rs/src/lib.rs`), the hot
//! path behind `lib/arbiter.ts`.
//!
//! Authorized defensive security testing of OUR OWN credential verifier. Each
//! `#[test]` mounts a concrete attack (signature forgery, payload tampering, `alg`
//! confusion, capability escalation, timing-side-channel probing, malformed-FFI
//! fuzzing) and asserts a *named* invariant fails closed. A green run means every
//! attack was correctly rejected.
//!
//! Threat model reference: `~/.claude/skills/macaroon-capability-credentials`
//! (attenuate-but-never-broaden, exact-subset capability containment, constant-time
//! compare, fail-closed malformed input).

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use harbor_card_rs::*;
use std::os::raw::c_char;

// ─── token forging harness (we hold a signing key, i.e. we play the issuer) ──────

fn keypair(seed: u8) -> (SigningKey, HarborCardVerifier) {
    let signing_key = SigningKey::from_bytes(&[seed; 32]);
    let verifier = HarborCardVerifier {
        public_key: signing_key.verifying_key(),
    };
    (signing_key, verifier)
}

fn claims(cap: &[&str], exp: i64) -> HarborCardClaims {
    HarborCardClaims {
        sub: "agent-1".into(),
        harbor: "local".into(),
        cap: cap.iter().map(|s| s.to_string()).collect(),
        iat: 0,
        exp,
        jti: "jti-1".into(),
    }
}

/// Assemble `header.payload.sig`, signing over `header.payload` with `sk`.
fn sign_token(sk: &SigningKey, header_json: &[u8], claims: &HarborCardClaims) -> String {
    let header_b64 = URL_SAFE_NO_PAD.encode(header_json);
    let payload_b64 = URL_SAFE_NO_PAD.encode(serde_json::to_vec(claims).unwrap());
    let msg = format!("{header_b64}.{payload_b64}");
    let sig = sk.sign(msg.as_bytes());
    let sig_b64 = URL_SAFE_NO_PAD.encode(sig.to_bytes());
    format!("{header_b64}.{payload_b64}.{sig_b64}")
}

fn valid_token(sk: &SigningKey) -> String {
    sign_token(sk, br#"{"alg":"EdDSA"}"#, &claims(&["read"], 9_999_999_999))
}

// ===========================================================================
// Category 1 — Ed25519 signature forgery
// ===========================================================================

#[test]
fn forged_signature_bitflip_rejected() {
    let (sk, verifier) = keypair(7);
    let token = valid_token(&sk);
    let parts: Vec<&str> = token.split('.').collect();
    let mut sig_bytes = URL_SAFE_NO_PAD.decode(parts[2]).unwrap();
    sig_bytes[0] ^= 0x01; // flip one bit of the signature
    let forged = format!(
        "{}.{}.{}",
        parts[0],
        parts[1],
        URL_SAFE_NO_PAD.encode(&sig_bytes)
    );
    let err = verifier.verify(&forged, 0).unwrap_err();
    assert!(matches!(err, HarborError::InvalidSignature), "got {err:?}");
}

#[test]
fn truncated_signature_rejected() {
    let (sk, verifier) = keypair(7);
    let token = valid_token(&sk);
    let parts: Vec<&str> = token.split('.').collect();
    let mut sig_bytes = URL_SAFE_NO_PAD.decode(parts[2]).unwrap();
    sig_bytes.truncate(16); // not a 64-byte Ed25519 signature
    let forged = format!(
        "{}.{}.{}",
        parts[0],
        parts[1],
        URL_SAFE_NO_PAD.encode(&sig_bytes)
    );
    let err = verifier.verify(&forged, 0).unwrap_err();
    assert!(matches!(err, HarborError::InvalidSignature), "got {err:?}");
}

#[test]
fn signature_from_a_different_message_rejected() {
    // Sign a DIFFERENT payload, then splice that signature onto the victim payload.
    let (sk, verifier) = keypair(7);
    let victim = sign_token(
        &sk,
        br#"{"alg":"EdDSA"}"#,
        &claims(&["read"], 9_999_999_999),
    );
    let other = sign_token(
        &sk,
        br#"{"alg":"EdDSA"}"#,
        &claims(&["read", "admin"], 9_999_999_999),
    );
    let vp: Vec<&str> = victim.split('.').collect();
    let op: Vec<&str> = other.split('.').collect();
    let spliced = format!("{}.{}.{}", vp[0], vp[1], op[2]); // victim body, other's sig
    let err = verifier.verify(&spliced, 0).unwrap_err();
    assert!(matches!(err, HarborError::InvalidSignature), "got {err:?}");
}

#[test]
fn token_signed_by_wrong_key_rejected() {
    let (attacker_sk, _) = keypair(9);
    let (_, verifier) = keypair(7); // verifier trusts key 7, not 9
    let token = valid_token(&attacker_sk);
    let err = verifier.verify(&token, 0).unwrap_err();
    assert!(matches!(err, HarborError::InvalidSignature), "got {err:?}");
}

// ===========================================================================
// Category 2 — Claims / payload tampering
// ===========================================================================

#[test]
fn escalated_capability_in_payload_rejected() {
    // Attacker rewrites the payload to grant themselves "admin" but reuses the
    // original signature — the signed message changes, so verification fails.
    let (sk, verifier) = keypair(7);
    let token = valid_token(&sk);
    let parts: Vec<&str> = token.split('.').collect();
    let evil = URL_SAFE_NO_PAD
        .encode(serde_json::to_vec(&claims(&["read", "admin"], 9_999_999_999)).unwrap());
    let tampered = format!("{}.{}.{}", parts[0], evil, parts[2]);
    let err = verifier.verify(&tampered, 0).unwrap_err();
    assert!(matches!(err, HarborError::InvalidSignature), "got {err:?}");
}

#[test]
fn wrong_part_count_rejected_as_malformed() {
    let (_, verifier) = keypair(7);
    assert!(matches!(
        verifier.verify("only.two", 0).unwrap_err(),
        HarborError::Malformed
    ));
    assert!(matches!(
        verifier.verify("a.b.c.d", 0).unwrap_err(),
        HarborError::Malformed
    ));
    assert!(matches!(
        verifier.verify("nodots", 0).unwrap_err(),
        HarborError::Malformed
    ));
}

// ===========================================================================
// Category 8 — `alg` header confusion
// ===========================================================================

#[test]
fn tampered_alg_header_rejected_by_signature_binding() {
    // The header (incl. `alg`) is inside the signed message. Rewriting `alg` to
    // "none" — the classic JWT downgrade — while keeping the original signature
    // breaks the signature. There is no alg=none code path to reach.
    let (sk, verifier) = keypair(7);
    let token = valid_token(&sk);
    let parts: Vec<&str> = token.split('.').collect();
    let evil_header = URL_SAFE_NO_PAD.encode(br#"{"alg":"none"}"#);
    let downgraded = format!("{}.{}.{}", evil_header, parts[1], parts[2]);
    let err = verifier.verify(&downgraded, 0).unwrap_err();
    assert!(
        matches!(err, HarborError::InvalidSignature),
        "an alg-downgrade must be caught by the signature over the header: got {err:?}"
    );
}

// NOTE (KNOWN GAP / DEPENDENCY, not tested here): `verify` validates `exp` but does
// NOT validate `iat` — a token with an absurdly future `iat` still verifies so long
// as it is validly signed and unexpired. This is NOT attacker-forgeable (the issuer
// controls `iat` and must sign it), so it is a defense-in-depth hardening gap, not an
// exploitable bypass. The `iat`-policy fix is a sibling agent's work; when it lands, a
// test asserting stale/future `iat` rejection belongs here. Reported as a dependency.

// ===========================================================================
// Category 7 — Capability escalation (verify_capability_subset — live hot path)
// ===========================================================================

#[test]
fn superset_presented_as_subset_rejected() {
    let root = vec!["read".to_string(), "write".to_string()];
    let sub = vec!["read".to_string(), "write".to_string(), "admin".to_string()];
    assert!(
        !HarborCardVerifier::verify_capability_subset(&root, &sub),
        "a superset must never verify as a subset"
    );
}

#[test]
fn single_unauthorized_capability_rejected() {
    let root = vec!["read".to_string()];
    assert!(!HarborCardVerifier::verify_capability_subset(
        &root,
        &["admin".to_string()]
    ));
}

#[test]
fn empty_root_grants_nothing() {
    // From an empty root you can attenuate to nothing (empty⊆empty), but you can
    // never derive a capability — no empty-root escalation.
    let empty: Vec<String> = vec![];
    assert!(HarborCardVerifier::verify_capability_subset(&empty, &[]));
    assert!(!HarborCardVerifier::verify_capability_subset(
        &empty,
        &["read".to_string()]
    ));
}

#[test]
fn empty_sub_is_valid_attenuation_not_a_bypass() {
    // Requesting zero capabilities is the maximal attenuation: it grants nothing, so
    // it is correctly `true` and is not a bypass (you get no authority from it).
    let root = vec!["read".to_string(), "write".to_string()];
    assert!(HarborCardVerifier::verify_capability_subset(&root, &[]));
}

#[test]
fn capability_match_is_case_sensitive_exact() {
    // If the compare were case-insensitive an attacker could slip "Admin" past an
    // "admin" grant (or vice-versa). It must be exact.
    let root = vec!["admin".to_string()];
    assert!(!HarborCardVerifier::verify_capability_subset(
        &root,
        &["Admin".to_string()]
    ));
    assert!(!HarborCardVerifier::verify_capability_subset(
        &root,
        &["ADMIN".to_string()]
    ));
}

#[test]
fn capability_match_rejects_whitespace_and_nul_tricks() {
    let root = vec!["read".to_string()];
    assert!(!HarborCardVerifier::verify_capability_subset(
        &root,
        &[" read".to_string()]
    ));
    assert!(!HarborCardVerifier::verify_capability_subset(
        &root,
        &["read ".to_string()]
    ));
    assert!(!HarborCardVerifier::verify_capability_subset(
        &root,
        &["read\t".to_string()]
    ));
    assert!(!HarborCardVerifier::verify_capability_subset(
        &root,
        &["read\0".to_string()]
    ));
    assert!(!HarborCardVerifier::verify_capability_subset(
        &root,
        &["read\nadmin".to_string()]
    ));
}

#[test]
fn duplicate_authorized_capability_is_allowed() {
    // Duplicates of an already-authorized cap grant nothing new; they must not flip
    // the verdict to false (a subtle DoS / logic-error probe).
    let root = vec!["read".to_string(), "write".to_string()];
    let sub = vec!["read".to_string(), "read".to_string(), "read".to_string()];
    assert!(HarborCardVerifier::verify_capability_subset(&root, &sub));
}

// ===========================================================================
// Category 5 — Constant-time compare (direct fold-XOR assertions)
// ===========================================================================

#[test]
fn constant_time_compare_full_width_semantics() {
    // Equal → true. Differing content at ANY single position → false, and the
    // position of the difference does not change the answer (the impl folds XOR over
    // the whole length; no early return leaks where the first mismatch is).
    assert!(HarborCardVerifier::constant_time_compare(
        b"same-32-byte-tag-aaaaaaaaaaaaaaaa",
        b"same-32-byte-tag-aaaaaaaaaaaaaaaa"
    ));

    let base = b"same-32-byte-tag-aaaaaaaaaaaaaaaa";
    // Differ only in the FIRST byte.
    let mut first = *base;
    first[0] ^= 0xFF;
    // Differ only in the LAST byte.
    let mut last = *base;
    let n = last.len() - 1;
    last[n] ^= 0xFF;
    assert!(
        !HarborCardVerifier::constant_time_compare(base, &first),
        "first-byte diff must be false"
    );
    assert!(
        !HarborCardVerifier::constant_time_compare(base, &last),
        "last-byte diff must be false"
    );
}

#[test]
fn constant_time_compare_length_mismatch_is_false() {
    assert!(!HarborCardVerifier::constant_time_compare(
        b"short",
        b"much-longer"
    ));
    assert!(!HarborCardVerifier::constant_time_compare(b"", b"x"));
}

#[test]
fn constant_time_compare_empty_equal() {
    assert!(HarborCardVerifier::constant_time_compare(b"", b""));
}

// ===========================================================================
// Category 6 — FFI boundary: capability-subset + compare must fail closed
// ===========================================================================

fn caps_subset_ffi(root: &[u8], sub: &[u8]) -> bool {
    unsafe {
        harbor_verify_caps_subset_json(
            root.as_ptr() as *const c_char,
            root.len(),
            sub.as_ptr() as *const c_char,
            sub.len(),
        )
    }
}

#[test]
fn ffi_caps_subset_escalation_rejected() {
    assert!(!caps_subset_ffi(b"[\"read\"]", b"[\"read\",\"admin\"]"));
}

#[test]
fn ffi_caps_subset_valid_subset_accepted() {
    assert!(caps_subset_ffi(b"[\"read\",\"write\"]", b"[\"read\"]"));
}

#[test]
fn ffi_caps_subset_malformed_json_fails_closed() {
    // Every malformed shape must return false (fail closed), never true and never a
    // crash across the boundary.
    assert!(!caps_subset_ffi(b"not json", b"[\"read\"]"));
    assert!(!caps_subset_ffi(b"[\"read\"]", b"not json"));
    assert!(!caps_subset_ffi(b"{}", b"[\"read\"]")); // object, not string array
    assert!(!caps_subset_ffi(b"[1,2,3]", b"[\"read\"]")); // wrong element type
    assert!(!caps_subset_ffi(b"", b"[\"read\"]")); // empty
    assert!(!caps_subset_ffi(&[0xff, 0xfe], b"[\"read\"]")); // non-UTF8
}

#[test]
fn ffi_caps_subset_null_pointer_fails_closed() {
    let sub = b"[\"read\"]";
    let r = unsafe {
        harbor_verify_caps_subset_json(
            std::ptr::null(),
            0,
            sub.as_ptr() as *const c_char,
            sub.len(),
        )
    };
    assert!(!r, "null root pointer must fail closed");
}

#[test]
fn ffi_constant_time_compare_guards() {
    let a = b"identical";
    assert!(unsafe { harbor_constant_time_compare(a.as_ptr(), a.len(), a.as_ptr(), a.len()) });
    // null
    assert!(!unsafe { harbor_constant_time_compare(std::ptr::null(), 4, std::ptr::null(), 4) });
    // oversized (> 1024 guard)
    let big = vec![0u8; 4096];
    assert!(!unsafe {
        harbor_constant_time_compare(big.as_ptr(), big.len(), big.as_ptr(), big.len())
    });
    // zero length
    assert!(!unsafe { harbor_constant_time_compare(a.as_ptr(), 0, a.as_ptr(), 0) });
}

// ===========================================================================
// Category 6b — property-based FFI fuzzing (never panic, never wrongly accept)
// ===========================================================================

use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig { cases: 2048, ..ProptestConfig::default() })]

    // Random bytes at the caps-subset FFI must never panic; and since a random
    // string almost never parses as a JSON string-array subset of another, the only
    // `true` results are genuine subsets — never a crash, never UB.
    #[test]
    fn ffi_caps_subset_random_bytes_never_panic(root in proptest::collection::vec(any::<u8>(), 0..256),
                                                sub in proptest::collection::vec(any::<u8>(), 0..256)) {
        let _ = caps_subset_ffi(&root, &sub); // reaching here without abort/UB is the assertion
    }

    // A subset drawn from the root must always verify true; adding a novel cap must
    // always flip it to false. Property form of attenuate-but-never-broaden.
    #[test]
    fn caps_subset_monotone_under_attenuation(root in proptest::collection::vec("[a-z]{1,8}", 0..8),
                                              extra in "[A-Z]{1,8}") {
        prop_assume!(!root.contains(&extra));
        prop_assert!(HarborCardVerifier::verify_capability_subset(&root, &root));
        let mut escalated = root.clone();
        escalated.push(extra);
        prop_assert!(!HarborCardVerifier::verify_capability_subset(&root, &escalated));
    }
}

// ===========================================================================
// Positive control — a valid token still verifies
// ===========================================================================

#[test]
fn positive_control_valid_token_verifies() {
    let (sk, verifier) = keypair(7);
    let token = valid_token(&sk);
    let out = verifier
        .verify(&token, 0)
        .expect("a valid, unexpired, correctly-signed token must verify");
    assert_eq!(out.sub, "agent-1");
    assert_eq!(out.cap, vec!["read".to_string()]);
}

#[test]
fn positive_control_expired_token_rejected() {
    let (sk, verifier) = keypair(7);
    let token = sign_token(&sk, br#"{"alg":"EdDSA"}"#, &claims(&["read"], 100));
    assert!(matches!(
        verifier.verify(&token, 200).unwrap_err(),
        HarborError::Expired
    ));
}
