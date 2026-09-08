//! Adversarial red-team / white-hat suite for the macaroon discharge gate
//! (`core/kernel/pd-anchor/src/macaroon.rs`) and its C-ABI boundary
//! (`core/kernel/pd-anchor/src/ffi.rs`).
//!
//! This is authorized, defensive security testing of OUR OWN capability kernel:
//! every `#[test]` mounts a concrete attack against the credential system and
//! asserts a *named* invariant fails closed. A green run means the attack was
//! correctly rejected — i.e. the defense holds. The test names double as a
//! machine-readable threat model (forged HMAC, caveat injection, cross-grant
//! replay, discharge confusion, timing-side-channel intent, FFI fail-closed).
//!
//! Threat model reference: `~/.claude/skills/macaroon-capability-credentials`
//! and macaroon.rs's own module rustdoc (per-hop verify, HMAC-commitment `vid`,
//! `prepare_for_request` binding = `HMAC(BIND0, root_sig || discharge_sig)`,
//! constant-time tag compare, depth-bounded recursion, fail-closed clock).
//!
//! These tests use the byte-parity `verify` path (caller supplies keys) so an
//! attacker's forgeries can be constructed explicitly. The kernel-custody path
//! (`keystore`) is exercised by its own inline suite; here we attack the
//! primitive directly, which is strictly the harder target.

use pd_anchor::ffi::{pd_macaroon_verify_json, pd_string_free};
use pd_anchor::macaroon::*;
use std::ffi::{c_char, CStr};

const ROOT: &[u8] = b"root-key-32-bytes-padding-padxxx";
const CKEY: &[u8] = b"caveat-key-32-bytes-padding-padx";
const RENT_LOC: &str = "pd://daemon/rent";

fn always(_: &str) -> bool {
    true
}
fn no_key(_: &str) -> Option<Vec<u8>> {
    None
}

/// A standard, valid push grant + its known caveat key (we supply it, so we know
/// it). Attacks mutate the grant or its discharge and assert rejection.
fn grant_with(root: &[u8], grant_id: &str, session: &str, nonce: &str) -> PushGrant {
    mint_push_grant(MintPushGrant {
        root_key: root,
        grant_id,
        repo: "curiositech/port-daddy",
        session,
        expires_ms: 2_000_000,
        caveat_key: CKEY.to_vec(),
        rent_nonce: nonce,
        protected_branch: "main",
    })
    .unwrap()
}

fn std_grant() -> PushGrant {
    grant_with(ROOT, "grant-1", "session-abc", "nonce-1")
}

fn push_ctx() -> RequestContext {
    RequestContext {
        op: Some("push".into()),
        repo: Some("curiositech/port-daddy".into()),
        branch: Some("feat/dom-daddy-x".into()),
        session: Some("session-abc".into()),
        now_ms: 1_000_000,
        ..Default::default()
    }
}

/// Paid discharge, request-bound to the given grant — the only thing that
/// legitimately authorizes a push.
fn bound_paid_discharge(g: &PushGrant) -> Macaroon {
    let d = discharge_rent_paid(
        CKEY,
        &g.rent_caveat_id,
        RentVerdict::Paid,
        1_000_000,
        DISCHARGE_TTL_MS,
    )
    .unwrap()
    .expect("paid rent yields a discharge");
    g.macaroon.prepare_for_request(&d).unwrap()
}

// ===========================================================================
// Category 1 — Signature forgery
// ===========================================================================

#[test]
fn forged_hmac_signature_bitflip_rejected() {
    // Flip one nibble of the running signature (keeping it valid 64-char hex so it
    // decodes) — the chained HMAC no longer matches the recomputed value.
    let m = Macaroon::mint(ROOT, "g", "loc");
    let mut forged = m.clone();
    let first = forged.signature_hex.remove(0);
    let flipped = if first == 'a' { 'b' } else { 'a' };
    forged.signature_hex.insert(0, flipped);
    let res = verify(&forged, ROOT, &[], &always, &no_key);
    assert!(!res.ok, "a single-bit signature forgery must be rejected");
    assert!(
        res.reason.contains("signature mismatch"),
        "reason: {}",
        res.reason
    );
}

#[test]
fn truncated_signature_rejected_as_malformed() {
    // A 32-byte tag is exactly 64 hex chars; a short tag must be refused by the
    // bounded decoder, never zero-extended into a matchable value.
    let mut m = Macaroon::mint(ROOT, "g", "loc");
    m.signature_hex.truncate(62);
    let res = verify(&m, ROOT, &[], &always, &no_key);
    assert!(!res.ok, "a truncated signature must fail closed");
    assert!(res.reason.contains("malformed"), "reason: {}", res.reason);
}

#[test]
fn signature_lifted_from_a_different_grant_rejected() {
    // The signature seeds from HMAC(root, identifier); a signature minted for a
    // *different* grant id cannot authorize this one.
    let victim = Macaroon::mint(ROOT, "grant-victim", "loc");
    let other = Macaroon::mint(ROOT, "grant-other", "loc");
    let mut forged = victim.clone();
    forged.signature_hex = other.signature_hex.clone();
    assert!(
        !verify(&forged, ROOT, &[], &always, &no_key).ok,
        "a signature from a different grant id must not verify"
    );
}

#[test]
fn oversized_hex_signature_rejected_not_decoded() {
    // A pathologically long hex string must be rejected by length before any large
    // decode (fail-fast), not accepted.
    let mut m = Macaroon::mint(ROOT, "g", "loc");
    m.signature_hex = "ab".repeat(10_000); // 20k hex chars
    let res = verify(&m, ROOT, &[], &always, &no_key);
    assert!(
        !res.ok && res.reason.contains("malformed"),
        "reason: {}",
        res.reason
    );
}

// ===========================================================================
// Category 2 — Caveat injection / tampering (HMAC chain integrity)
// ===========================================================================

#[test]
fn caveat_appended_after_signing_is_detected() {
    // Attacker bolts an extra caveat onto the vec but keeps the stale signature.
    // The recomputed chain now covers the extra caveat and diverges.
    let m = Macaroon::mint(ROOT, "g", "loc")
        .add_first_party_caveat("op = push")
        .unwrap();
    let mut forged = m.clone();
    forged.caveats.push(Caveat {
        cid: "spend_usd <= 999999".into(),
        vid: None,
        cl: None,
    });
    assert!(
        !verify(&forged, ROOT, &[], &always, &no_key).ok,
        "an injected caveat with a stale signature must be detected"
    );
}

#[test]
fn caveat_removed_after_signing_is_detected() {
    // Strip the last caveat but keep the signature that covered it.
    let m = Macaroon::mint(ROOT, "g", "loc")
        .add_first_party_caveat("op = push")
        .unwrap()
        .add_first_party_caveat("branch = feat/x")
        .unwrap();
    let mut forged = m.clone();
    forged.caveats.pop();
    assert!(
        !verify(&forged, ROOT, &[], &always, &no_key).ok,
        "removing a caveat must break the chained signature"
    );
}

#[test]
fn caveats_reordered_is_detected() {
    // The HMAC chain is order-sensitive: swapping two caveats without re-signing
    // must be caught (sig binds the exact sequence).
    let m = Macaroon::mint(ROOT, "g", "loc")
        .add_first_party_caveat("op = push")
        .unwrap()
        .add_first_party_caveat("repo = a/b")
        .unwrap();
    let mut forged = m.clone();
    forged.caveats.swap(0, 1);
    assert!(
        !verify(&forged, ROOT, &[], &always, &no_key).ok,
        "reordering caveats must be rejected"
    );
}

#[test]
fn caveat_duplicated_is_detected() {
    let m = Macaroon::mint(ROOT, "g", "loc")
        .add_first_party_caveat("op = push")
        .unwrap();
    let mut forged = m.clone();
    forged.caveats.push(forged.caveats[0].clone());
    assert!(
        !verify(&forged, ROOT, &[], &always, &no_key).ok,
        "duplicating a caveat must be rejected"
    );
}

#[test]
fn caveat_predicate_content_tampered_is_detected() {
    // Loosen an existing caveat's text in place (broaden the spend ceiling) without
    // re-signing — the chain covers the exact bytes and diverges.
    let m = Macaroon::mint(ROOT, "g", "loc")
        .add_first_party_caveat("spend_usd <= 2.00")
        .unwrap();
    let mut forged = m.clone();
    forged.caveats[0].cid = "spend_usd <= 999999.00".into();
    assert!(
        !verify(&forged, ROOT, &[], &always, &no_key).ok,
        "editing a caveat's predicate must break the signature"
    );
}

// ===========================================================================
// Category 3 — Cross-grant discharge replay
// ===========================================================================

#[test]
fn discharge_replayed_across_grants_rejected() {
    // Two grants identical except for the root key (so they share a rent caveat id,
    // and a discharge minted for one is *found* under the other). A discharge bound
    // to grant A must NOT authorize grant B: the request-binding folds in the root's
    // signature, which differs, so the bound value mismatches.
    let a = grant_with(ROOT, "g", "session-abc", "nonce-1");
    let b = grant_with(
        b"OTHER-root-32-bytes-padding-padx",
        "g",
        "session-abc",
        "nonce-1",
    );
    assert_eq!(
        a.rent_caveat_id, b.rent_caveat_id,
        "test setup: shared caveat id"
    );

    let bound_to_a = bound_paid_discharge(&a);
    let check = |p: &str| check_caveat(p, &push_ctx());
    let resolve = |id: &str| (id == b.rent_caveat_id).then(|| CKEY.to_vec());
    let res = verify(
        &b.macaroon,
        b"OTHER-root-32-bytes-padding-padx",
        &[bound_to_a],
        &check,
        &resolve,
    );
    assert!(
        !res.ok,
        "a discharge bound to grant A must not authorize grant B"
    );
    assert!(
        res.reason.contains("signature mismatch"),
        "reason: {}",
        res.reason
    );
}

#[test]
fn discharge_for_near_miss_caveat_id_rejected() {
    // A discharge whose identifier is the real rent id plus one extra char must not
    // resolve — lookup is exact, never a prefix/fuzzy match.
    let g = std_grant();
    let near = format!("{}x", g.rent_caveat_id);
    let d = Macaroon::mint(CKEY, near, RENT_LOC)
        .add_first_party_caveat(expires_caveat(1_000_000 + DISCHARGE_TTL_MS))
        .unwrap();
    let bound = g.macaroon.prepare_for_request(&d).unwrap();
    let check = |p: &str| check_caveat(p, &push_ctx());
    let resolve = |id: &str| (id == g.rent_caveat_id).then(|| CKEY.to_vec());
    let res = verify(&g.macaroon, ROOT, &[bound], &check, &resolve);
    assert!(
        !res.ok,
        "a near-miss discharge id must not satisfy the caveat"
    );
    assert!(
        res.reason.contains("no discharge macaroon"),
        "reason: {}",
        res.reason
    );
}

#[test]
fn discharge_with_prefix_of_caveat_id_rejected() {
    // The truncated-prefix twin of the near-miss test: an id that is a strict prefix
    // of the real rent id must not match.
    let g = std_grant();
    let prefix = &g.rent_caveat_id[..g.rent_caveat_id.len() - 1];
    let d = Macaroon::mint(CKEY, prefix, RENT_LOC)
        .add_first_party_caveat(expires_caveat(1_000_000 + DISCHARGE_TTL_MS))
        .unwrap();
    let bound = g.macaroon.prepare_for_request(&d).unwrap();
    let check = |p: &str| check_caveat(p, &push_ctx());
    let resolve = |id: &str| (id == g.rent_caveat_id).then(|| CKEY.to_vec());
    assert!(
        !verify(&g.macaroon, ROOT, &[bound], &check, &resolve).ok,
        "a prefix of the caveat id must not resolve a discharge"
    );
}

// ===========================================================================
// Category 4 — Third-party caveat / discharge confusion
// ===========================================================================

#[test]
fn unbound_discharge_rejected() {
    // A discharge presented WITHOUT prepare_for_request binding must be refused —
    // an unbound discharge is exactly the stolen-and-replayed shape.
    let g = std_grant();
    let d = discharge_rent_paid(
        CKEY,
        &g.rent_caveat_id,
        RentVerdict::Paid,
        1_000_000,
        DISCHARGE_TTL_MS,
    )
    .unwrap()
    .unwrap();
    let check = |p: &str| check_caveat(p, &push_ctx());
    let resolve = |id: &str| (id == g.rent_caveat_id).then(|| CKEY.to_vec());
    assert!(
        !verify(&g.macaroon, ROOT, &[d], &check, &resolve).ok,
        "an unbound discharge must not authorize"
    );
}

#[test]
fn wrong_caveat_key_at_resolver_rejected() {
    // The vid is a binding commitment HMAC(chain_sig, caveat_key). If the key store
    // yields a DIFFERENT key than the one committed, the commitment check fails.
    let g = std_grant();
    let bound = bound_paid_discharge(&g);
    let check = |p: &str| check_caveat(p, &push_ctx());
    let wrong =
        |id: &str| (id == g.rent_caveat_id).then(|| b"WRONG-key-32-bytes-padding-padxx".to_vec());
    let res = verify(&g.macaroon, ROOT, &[bound], &check, &wrong);
    assert!(!res.ok, "a mismatched discharge key must be rejected");
    assert!(
        res.reason.contains("key mismatch"),
        "reason: {}",
        res.reason
    );
}

#[test]
fn attacker_forged_discharge_without_caveat_key_rejected() {
    // Attacker fabricates a discharge signed with a key they GUESSED (not the real
    // caveat key). The vid commitment still resolves against the real key, but the
    // discharge's own recomputed signature diverges — you cannot forge a discharge
    // without the caveat key the daemon holds.
    let g = std_grant();
    let forged = Macaroon::mint(
        b"guessed-key-32-bytes-padding-pad",
        &g.rent_caveat_id,
        RENT_LOC,
    )
    .add_first_party_caveat(expires_caveat(1_000_000 + DISCHARGE_TTL_MS))
    .unwrap();
    let bound = g.macaroon.prepare_for_request(&forged).unwrap();
    let check = |p: &str| check_caveat(p, &push_ctx());
    let resolve = |id: &str| (id == g.rent_caveat_id).then(|| CKEY.to_vec());
    assert!(
        !verify(&g.macaroon, ROOT, &[bound], &check, &resolve).ok,
        "a discharge forged without the caveat key must not authorize"
    );
}

#[test]
fn discharge_for_a_caveat_never_issued_is_inert() {
    // A macaroon carrying only first-party caveats never consults discharges;
    // presenting a spurious discharge (for a caveat that was never issued) neither
    // helps an attacker nor is mistaken for authority — the grant stands on its own
    // first-party checks. Here the first-party check fails, so the whole thing fails
    // regardless of the injected discharge.
    let m = Macaroon::mint(ROOT, "g", "loc")
        .add_first_party_caveat("op = push")
        .unwrap();
    let spurious = Macaroon::mint(CKEY, "never-issued", RENT_LOC);
    let nope = |_: &str| false; // first-party predicate not satisfied
    let resolve = |_: &str| Some(CKEY.to_vec());
    assert!(
        !verify(&m, ROOT, &[spurious], &nope, &resolve).ok,
        "an unrelated discharge must not paper over a failed first-party caveat"
    );
}

#[test]
fn one_of_two_third_party_discharges_missing_rejected() {
    // Two third-party caveats; the attacker supplies a valid discharge for the first
    // and omits the second (a discharge-substitution/omission attempt). The second
    // caveat is unsatisfiable → refuse.
    let ckey_a = b"caveat-key-a-32-bytes-padding-pad";
    let ckey_b = b"caveat-key-b-32-bytes-padding-pad";
    let m = Macaroon::mint(ROOT, "g", "loc")
        .add_third_party_caveat(ckey_a, "cav-a", RENT_LOC)
        .unwrap()
        .add_third_party_caveat(ckey_b, "cav-b", RENT_LOC)
        .unwrap();
    let da = m
        .prepare_for_request(&Macaroon::mint(ckey_a, "cav-a", RENT_LOC))
        .unwrap();
    let resolve = |id: &str| match id {
        "cav-a" => Some(ckey_a.to_vec()),
        "cav-b" => Some(ckey_b.to_vec()),
        _ => None,
    };
    // Only da present; db withheld.
    assert!(
        !verify(&m, ROOT, &[da], &always, &resolve).ok,
        "omitting one required discharge must refuse the whole grant"
    );
}

// ===========================================================================
// Category 5 — Timing-side-channel intent (behavioral proxy)
// ===========================================================================
//
// macaroon.rs's `ct_eq` is a private fold-XOR over all 32 bytes (no early return).
// It is not callable from an integration test, so we assert the *observable*
// property that follows from a full-width compare: a signature that differs only
// in the FIRST tag byte and one that differs only in the LAST tag byte are both
// rejected with the identical failure mode — the verdict does not depend on WHERE
// the mismatch is. (The direct fold-XOR assertion lives on harbor-card-rs's public
// `constant_time_compare` in that crate's redteam suite.)

#[test]
fn tag_mismatch_verdict_independent_of_mismatch_position() {
    let m = Macaroon::mint(ROOT, "g", "loc");
    let good = m.signature_hex.clone();

    // Differ in the first byte (first two hex chars).
    let mut first_off = m.clone();
    first_off.signature_hex = flip_hex_at(&good, 0);
    // Differ in the last byte (last two hex chars).
    let mut last_off = m.clone();
    last_off.signature_hex = flip_hex_at(&good, good.len() - 1);

    let r1 = verify(&first_off, ROOT, &[], &always, &no_key);
    let r2 = verify(&last_off, ROOT, &[], &always, &no_key);
    assert!(!r1.ok && !r2.ok, "both must reject");
    assert_eq!(
        r1.reason, r2.reason,
        "a mismatch at the first vs last byte must yield the identical verdict (full-width compare)"
    );
}

fn flip_hex_at(hex: &str, idx: usize) -> String {
    let mut chars: Vec<char> = hex.chars().collect();
    chars[idx] = if chars[idx] == 'a' { 'b' } else { 'a' };
    chars.into_iter().collect()
}

// ===========================================================================
// Category 6 — FFI boundary fuzzing (must fail closed, never panic/crash)
// ===========================================================================

const MAX_REQUEST_BYTES: usize = 256 * 1024;

/// Call the C-ABI verify export with RAW bytes (may be non-UTF8 / contain interior
/// NULs), returning the response JSON string, or `None` if the export returned null
/// (documented only for a catastrophic allocation failure). A non-null,
/// well-formed JSON `{ok,reason}` response is the fail-closed contract.
fn ffi_verify_raw(bytes: &[u8]) -> Option<String> {
    let ptr = unsafe { pd_macaroon_verify_json(bytes.as_ptr() as *const c_char, bytes.len()) };
    if ptr.is_null() {
        return None;
    }
    let out = unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned();
    unsafe { pd_string_free(ptr) };
    Some(out)
}

fn assert_fails_closed(bytes: &[u8], label: &str) {
    let out = ffi_verify_raw(bytes)
        .unwrap_or_else(|| panic!("null response for {label} — contract says non-null"));
    let v: serde_json::Value = serde_json::from_str(&out)
        .unwrap_or_else(|e| panic!("response for {label} not JSON: {e}: {out}"));
    assert_eq!(v["ok"], false, "input {label} must fail closed, got: {out}");
}

#[test]
fn ffi_handpicked_malformed_inputs_all_fail_closed() {
    assert_fails_closed(b"", "empty");
    assert_fails_closed(b"not json at all", "garbage");
    assert_fails_closed(b"{", "truncated-object");
    assert_fails_closed(b"{\"macaroon\":", "truncated-mid-key");
    assert_fails_closed(b"[]", "wrong-top-type-array");
    assert_fails_closed(b"{\"macaroon\": 1234}", "wrong-field-type");
    assert_fails_closed(
        b"{\"macaroon\": {}, \"root_key_hex\": \"zzzz\"}",
        "non-hex-root-key",
    );
    // Interior NUL inside otherwise-valid UTF-8.
    assert_fails_closed(b"{\"macaroon\":\0}", "interior-nul");
    // Non-UTF8 byte sequence.
    assert_fails_closed(&[0xff, 0xfe, 0xfd, 0x00, 0x80], "non-utf8");
    // Deeply nested arrays (structural bomb, but well under the size cap).
    let nested = format!("{}{}", "[".repeat(2000), "]".repeat(2000));
    assert_fails_closed(nested.as_bytes(), "deeply-nested");
    // Huge array of numbers, still under the byte cap.
    let huge = format!("{{\"macaroon\":[{}]}}", "1,".repeat(5000));
    assert_fails_closed(huge.as_bytes(), "huge-array");
}

#[test]
fn ffi_null_pointer_fails_closed() {
    let ptr = unsafe { pd_macaroon_verify_json(std::ptr::null(), 0) };
    assert!(
        !ptr.is_null(),
        "null input must still return a sentinel, not null"
    );
    let out = unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned();
    unsafe { pd_string_free(ptr) };
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["ok"], false);
}

#[test]
fn ffi_size_guard_at_and_past_the_boundary() {
    // Exactly at the cap: allowed through the size guard, then fails on parse.
    let at_cap = vec![b'{'; MAX_REQUEST_BYTES];
    assert_fails_closed(&at_cap, "exactly-at-cap");
    // One byte over the cap: rejected fail-fast by the size guard before any parse.
    let over_cap = vec![b'{'; MAX_REQUEST_BYTES + 1];
    let out = ffi_verify_raw(&over_cap).expect("non-null");
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["ok"], false, "oversized input must be rejected");
    assert!(
        out.contains("oversized"),
        "oversize should be reported: {out}"
    );
    // Minimal one-byte input.
    assert_fails_closed(b"x", "one-byte");
}

// ===========================================================================
// Category 6b — Property-based FFI fuzzing (proptest)
// ===========================================================================
//
// A hand-picked list can only cover cases we imagined; property-based fuzzing feeds
// structured-random byte strings and asserts the fail-closed invariant on ALL of
// them: the export never returns null, never panics across the boundary, and always
// yields `{ok:false}` for non-credential input. A random byte string satisfying the
// chained HMAC is cryptographically impossible, so `ok` is invariably false.

use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig { cases: 2048, ..ProptestConfig::default() })]

    #[test]
    fn ffi_verify_never_panics_and_fails_closed_on_random_bytes(bytes in proptest::collection::vec(any::<u8>(), 0..4096)) {
        let out = ffi_verify_raw(&bytes);
        prop_assert!(out.is_some(), "export returned null (should be unreachable) for {:?}", bytes);
        let out = out.unwrap();
        let v: serde_json::Value = serde_json::from_str(&out)
            .map_err(|e| TestCaseError::fail(format!("non-JSON response {out:?}: {e}")))?;
        prop_assert_eq!(&v["ok"], &serde_json::Value::Bool(false));
    }

    #[test]
    fn ffi_verify_random_json_shaped_bytes_fail_closed(s in "\\{.{0,200}\\}") {
        // Random strings that at least start/end like a JSON object — pushes the
        // parser deeper before it fails.
        let out = ffi_verify_raw(s.as_bytes());
        prop_assert!(out.is_some());
        let v: serde_json::Value = serde_json::from_str(&out.unwrap()).unwrap_or(serde_json::json!({"ok": false}));
        prop_assert_eq!(&v["ok"], &serde_json::Value::Bool(false));
    }
}

// ===========================================================================
// Positive control — the legitimate path DOES authorize
// ===========================================================================
//
// A red-team suite that only ever sees `false` could be trivially satisfied by a
// verifier that rejects everything. This asserts the gate still says YES to a valid,
// paid, request-bound grant — so the rejections above are meaningful.

#[test]
fn positive_control_valid_paid_bound_grant_authorizes() {
    let g = std_grant();
    let bound = bound_paid_discharge(&g);
    let check = |p: &str| check_caveat(p, &push_ctx());
    let resolve = |id: &str| (id == g.rent_caveat_id).then(|| CKEY.to_vec());
    let res = verify(&g.macaroon, ROOT, &[bound], &check, &resolve);
    assert!(
        res.ok,
        "a valid paid+bound grant must authorize: {}",
        res.reason
    );
}
