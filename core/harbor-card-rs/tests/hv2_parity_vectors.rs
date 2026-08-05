//! Cross-runtime parity gate for the hv:2 harbor card — **Rust half**.
//!
//! ADR-0120 rule 1: a security primitive gets ONE canonical implementation
//! (Rust), and any surface that cannot reach it over FFI — the Cloudflare
//! Workers can't `dlopen` anything — implements a twin locked to a shared
//! fixture generated from the canonical side. This file is that lock for the
//! harbor card: it asserts `harbor_card_rs` reproduces every vector in
//! `tests/fixtures/harbor-card-hv2-parity-vectors.json`, while
//! `apps/relay/tests/harbor-card-hv2-parity.test.ts` asserts
//! `apps/relay/src/auth.ts` reaches the same verdict on the same bytes.
//!
//! Modelled on `core/kernel/pd-anchor/tests/parity_vectors.rs` (the macaroon
//! fixture), with one addition the macaroon case did not need: the two
//! implementations are **not identical**, and the fixture says so per vector.
//! Each card vector carries an `expected.rust` and an `expected.ts` code. Where
//! they differ the vector is labelled `divergence` with the reason. A fixture
//! that hid a divergence behind a single boolean would be worse than none —
//! it would assert a parity that does not hold.
//!
//! # Regenerating
//!
//! The fixture is GENERATED FROM THIS FILE (Rust is canonical):
//!
//! ```text
//! HV2_FIXTURE_REGENERATE=1 cargo test --test hv2_parity_vectors -- --nocapture
//! ```
//!
//! ADR-0120 rule 4: a fixture diff is a security-relevant diff. Regenerating to
//! make a TS change pass reclassifies a behavior change as expected — reviewers
//! treat it exactly like a change to the verifier.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use harbor_card_rs::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};

// ─── fixture location ────────────────────────────────────────────────────────

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/harbor-card-hv2-parity-vectors.json")
}

fn fixture() -> Value {
    let p = fixture_path();
    serde_json::from_str(&fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {p:?}: {e}")))
        .unwrap_or_else(|e| panic!("parse {p:?}: {e}"))
}

// ─── minting harness (this is what makes Rust the generator, not a consumer) ──

/// The fixture's issuer. A fixed seed, so regenerating the fixture without
/// changing the implementation produces a byte-identical file and an empty diff.
const ISSUER_SEED: [u8; 32] = [0x2a; 32];
/// A second key nobody should be able to pass verification with.
const IMPOSTOR_SEED: [u8; 32] = [0x5b; 32];

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Mint a card exactly as `handleExchange` in `apps/relay/src/handlers.ts` does:
/// Ed25519 over the SHA-256 digest of `header_b64 "." payload_b64`.
fn mint(sk: &SigningKey, header: &Value, payload: &Value) -> String {
    let header_b64 = URL_SAFE_NO_PAD.encode(serde_json::to_vec(header).unwrap());
    let payload_b64 = URL_SAFE_NO_PAD.encode(serde_json::to_vec(payload).unwrap());
    let signing_input = format!("{header_b64}.{payload_b64}");
    let sig = sk.sign(Sha256::digest(signing_input.as_bytes()).as_slice());
    format!(
        "{header_b64}.{payload_b64}.{}",
        URL_SAFE_NO_PAD.encode(sig.to_bytes())
    )
}

/// Mint with the pre-ADR-0120 legacy scheme (signature over the RAW signing
/// input). Used as a negative vector: neither implementation may accept it.
fn mint_legacy_scheme(sk: &SigningKey, header: &Value, payload: &Value) -> String {
    let header_b64 = URL_SAFE_NO_PAD.encode(serde_json::to_vec(header).unwrap());
    let payload_b64 = URL_SAFE_NO_PAD.encode(serde_json::to_vec(payload).unwrap());
    let sig = sk.sign(format!("{header_b64}.{payload_b64}").as_bytes());
    format!(
        "{header_b64}.{payload_b64}.{}",
        URL_SAFE_NO_PAD.encode(sig.to_bytes())
    )
}

fn flip_signature_bit(token: &str) -> String {
    let parts: Vec<&str> = token.split('.').collect();
    let mut sig = URL_SAFE_NO_PAD.decode(parts[2]).unwrap();
    sig[0] ^= 0x01;
    format!("{}.{}.{}", parts[0], parts[1], URL_SAFE_NO_PAD.encode(&sig))
}

/// The refusal code a vector expects from THIS implementation. `"accept"` means
/// the card verifies (including its capability check).
fn rust_code(result: &Result<HarborCardClaims, HarborError>) -> &'static str {
    match result {
        Ok(_) => "accept",
        Err(HarborError::InvalidEncoding) => "InvalidEncoding",
        Err(HarborError::InvalidSignature) => "InvalidSignature",
        Err(HarborError::Expired) => "Expired",
        Err(HarborError::NotYetValid) => "NotYetValid",
        Err(HarborError::WrongVersion { .. }) => "WrongVersion",
        Err(HarborError::Malformed) => "Malformed",
        Err(HarborError::UnsupportedAlgorithm) => "UnsupportedAlgorithm",
        Err(HarborError::IssuedInFuture) => "IssuedInFuture",
        Err(HarborError::InsufficientCapability) => "InsufficientCapability",
        Err(HarborError::JsonError(_)) => "JsonError",
    }
}

// ─── fixture construction ────────────────────────────────────────────────────

/// A base payload at a fixed wall clock, so every vector reads as a real card
/// rather than a pile of epoch-zero timestamps.
const NOW: i64 = 1_767_225_600; // 2026-01-01T00:00:00Z

fn build_fixture() -> Value {
    let issuer = SigningKey::from_bytes(&ISSUER_SEED);
    let impostor = SigningKey::from_bytes(&IMPOSTOR_SEED);
    let issuer_pk = hex(issuer.verifying_key().as_bytes());
    let impostor_pk = hex(impostor.verifying_key().as_bytes());
    let harbor_fp = "ab".repeat(32);
    let daemon_fp = "cd".repeat(32);
    let header = json!({"alg": "EdDSA", "kid": harbor_fp});

    // The claim set every vector varies from.
    let base = |cap: Value, exp: i64, iat: i64| {
        json!({
            "hv": 2,
            "sub": daemon_fp,
            "iss": harbor_fp,
            "aud": harbor_fp,
            "exp": exp,
            "iat": iat,
            "jti": "jti-parity-0001",
            "cap": cap,
        })
    };
    let sub_logs = json!([{"op": "sub", "channel": "logs.*"}]);

    let mut vectors: Vec<Value> = Vec::new();

    let mut push = |name: &str,
                    note: &str,
                    token: String,
                    now_ts: i64,
                    op: &str,
                    channel: &str,
                    pubkey: &str,
                    rust: &str,
                    ts: &str,
                    divergence: Option<&str>| {
        let mut v = json!({
            "name": name,
            "note": note,
            "token": token,
            "now_ts": now_ts,
            "required_op": op,
            "required_channel": channel,
            "issuer_public_key_hex": pubkey,
            "expected": { "rust": rust, "ts": ts },
        });
        if let Some(d) = divergence {
            v["divergence"] = json!(d);
        }
        vectors.push(v);
    };

    // ── positive vectors ─────────────────────────────────────────────────────
    push(
        "valid-sub-card",
        "The ordinary case: a live card granting sub on a channel glob.",
        mint(&issuer, &header, &base(sub_logs.clone(), NOW + 3600, NOW)),
        NOW,
        "sub",
        "logs.app",
        &issuer_pk,
        "accept",
        "accept",
        None,
    );
    push(
        "valid-card-with-nbf-and-ceilings",
        "nbf already passed; rate/byte ceilings present and carried through.",
        mint(&issuer, &header, &{
            let mut p = base(
                json!([{"op": "pub", "channel": "alerts", "rate_per_min": 60, "max_payload_bytes": 4096}]),
                NOW + 3600,
                NOW - 10,
            );
            p["nbf"] = json!(NOW - 5);
            p
        }),
        NOW,
        "pub",
        "alerts",
        &issuer_pk,
        "accept",
        "accept",
        None,
    );
    push(
        "valid-admin-op-is-an-op-wildcard",
        "op:admin satisfies a required pub on the channels it names.",
        mint(
            &issuer,
            &header,
            &base(
                json!([{"op": "admin", "channel": "ops.*"}]),
                NOW + 3600,
                NOW,
            ),
        ),
        NOW,
        "pub",
        "ops.deploy",
        &issuer_pk,
        "accept",
        "accept",
        None,
    );
    push(
        "valid-star-channel-matches-everything",
        "channel '*' is the channel wildcard.",
        mint(
            &issuer,
            &header,
            &base(json!([{"op": "pub", "channel": "*"}]), NOW + 3600, NOW),
        ),
        NOW,
        "pub",
        "anything.at.all",
        &issuer_pk,
        "accept",
        "accept",
        None,
    );
    push(
        "valid-at-exactly-exp",
        "Both verifiers refuse on now > exp, so now == exp is still inside the window.",
        mint(&issuer, &header, &base(sub_logs.clone(), NOW, NOW - 60)),
        NOW,
        "sub",
        "logs.app",
        &issuer_pk,
        "accept",
        "accept",
        None,
    );

    // ── negative vectors ─────────────────────────────────────────────────────
    push(
        "reject-tampered-signature",
        "One bit flipped in the signature.",
        flip_signature_bit(&mint(
            &issuer,
            &header,
            &base(sub_logs.clone(), NOW + 3600, NOW),
        )),
        NOW,
        "sub",
        "logs.app",
        &issuer_pk,
        "InvalidSignature",
        "BAD_SIG",
        None,
    );
    push(
        "reject-wrong-issuer-key",
        "Correctly formed card signed by a key the verifier does not trust.",
        mint(&impostor, &header, &base(sub_logs.clone(), NOW + 3600, NOW)),
        NOW,
        "sub",
        "logs.app",
        &issuer_pk,
        "InvalidSignature",
        "BAD_SIG",
        None,
    );
    push(
        "reject-legacy-signing-scheme",
        "Signed over the RAW signing input (the pre-ADR-0120 legacy scheme) instead of its SHA-256 digest. Neither implementation may accept it — this vector is why the port existed.",
        mint_legacy_scheme(&issuer, &header, &base(sub_logs.clone(), NOW + 3600, NOW)),
        NOW,
        "sub",
        "logs.app",
        &issuer_pk,
        "InvalidSignature",
        "BAD_SIG",
        None,
    );
    push(
        "reject-expired",
        "exp one second before now.",
        mint(
            &issuer,
            &header,
            &base(sub_logs.clone(), NOW - 1, NOW - 3600),
        ),
        NOW,
        "sub",
        "logs.app",
        &issuer_pk,
        "Expired",
        "EXPIRED",
        None,
    );
    push(
        "reject-not-yet-valid",
        "nbf one hour in the future.",
        mint(&issuer, &header, &{
            let mut p = base(sub_logs.clone(), NOW + 7200, NOW - 60);
            p["nbf"] = json!(NOW + 3600);
            p
        }),
        NOW,
        "sub",
        "logs.app",
        &issuer_pk,
        "NotYetValid",
        "NOT_YET_VALID",
        None,
    );
    push(
        "reject-wrong-hv",
        "hv:3 — an unknown version is refused, never best-effort parsed.",
        mint(&issuer, &header, &{
            let mut p = base(sub_logs.clone(), NOW + 3600, NOW);
            p["hv"] = json!(3);
            p
        }),
        NOW,
        "sub",
        "logs.app",
        &issuer_pk,
        "WrongVersion",
        "WRONG_VERSION",
        None,
    );
    push(
        "reject-wrong-alg",
        "Header declares HS256 while the card is genuinely Ed25519-signed: alg confusion must fail closed.",
        mint(
            &issuer,
            &json!({"alg": "HS256", "kid": harbor_fp}),
            &base(sub_logs.clone(), NOW + 3600, NOW),
        ),
        NOW,
        "sub",
        "logs.app",
        &issuer_pk,
        "UnsupportedAlgorithm",
        "WRONG_ALG",
        None,
    );
    push(
        "reject-capability-not-a-subset-wrong-op",
        "Card grants sub on logs.*; a pub on the same channel is not a subset of that authority.",
        mint(&issuer, &header, &base(sub_logs.clone(), NOW + 3600, NOW)),
        NOW,
        "pub",
        "logs.app",
        &issuer_pk,
        "InsufficientCapability",
        "INSUFFICIENT_CAP",
        None,
    );
    push(
        "reject-capability-not-a-subset-outside-glob",
        "logs.* does not reach ops.deploy, and (the boundary case) does not reach logsx either.",
        mint(&issuer, &header, &base(sub_logs.clone(), NOW + 3600, NOW)),
        NOW,
        "sub",
        "ops.deploy",
        &issuer_pk,
        "InsufficientCapability",
        "INSUFFICIENT_CAP",
        None,
    );
    push(
        "reject-malformed-two-part-token",
        "Structurally not a card.",
        "aGVhZGVy.cGF5bG9hZA".to_string(),
        NOW,
        "sub",
        "logs.app",
        &issuer_pk,
        "Malformed",
        "MALFORMED",
        None,
    );

    // ── declared divergences (the honest half of the fixture) ────────────────
    push(
        "divergence-future-dated-iat",
        "iat one hour into the future, well past MAX_CLOCK_SKEW_SECS.",
        mint(
            &issuer,
            &header,
            &base(sub_logs.clone(), NOW + 7200, NOW + 3600),
        ),
        NOW,
        "sub",
        "logs.app",
        &issuer_pk,
        "IssuedInFuture",
        "accept",
        Some("auth.ts ignores `iat` entirely; the Rust verifier rejects a card dated beyond MAX_CLOCK_SKEW_SECS into the future. Rust is strictly stricter here. Closing the gap means adding an iat check to auth.ts — a relay behavior change, not a port — so it is declared, not silently reconciled."),
    );
    push(
        "divergence-iat-after-exp",
        "Incoherent card: issued after it expires, evaluated after both.",
        mint(&issuer, &header, &base(sub_logs.clone(), NOW - 100, NOW - 50)),
        NOW,
        "sub",
        "logs.app",
        &issuer_pk,
        "Malformed",
        "EXPIRED",
        Some("Both refuse; only the code differs. Rust checks iat/exp coherence before expiry, so it reports Malformed where auth.ts reports EXPIRED. Verdict parity holds, code parity does not."),
    );

    // ── capability grammar vectors (matchCapability ⇄ capability_matches) ─────
    let capability_vectors = json!([
        {"name": "exact-channel-hit", "cap": [{"op": "pub", "channel": "alerts"}], "required_op": "pub", "required_channel": "alerts", "expected_match": true},
        {"name": "exact-channel-miss", "cap": [{"op": "pub", "channel": "alerts"}], "required_op": "pub", "required_channel": "alerts.x", "expected_match": false},
        {"name": "star-matches-everything", "cap": [{"op": "sub", "channel": "*"}], "required_op": "sub", "required_channel": "anything/at.all", "expected_match": true},
        {"name": "prefix-glob-hit", "cap": [{"op": "sub", "channel": "logs.*"}], "required_op": "sub", "required_channel": "logs.app", "expected_match": true},
        {"name": "prefix-glob-boundary-miss", "cap": [{"op": "sub", "channel": "logs.*"}], "required_op": "sub", "required_channel": "logsx", "expected_match": false},
        {"name": "prefix-glob-shorter-prefix-hit", "cap": [{"op": "sub", "channel": "log*"}], "required_op": "sub", "required_channel": "logsx", "expected_match": true},
        {"name": "no-star-is-not-a-prefix", "cap": [{"op": "sub", "channel": "logs."}], "required_op": "sub", "required_channel": "logs.app", "expected_match": false},
        {"name": "admin-op-covers-pub", "cap": [{"op": "admin", "channel": "ops.*"}], "required_op": "pub", "required_channel": "ops.deploy", "expected_match": true},
        {"name": "admin-op-covers-sub", "cap": [{"op": "admin", "channel": "ops.*"}], "required_op": "sub", "required_channel": "ops.deploy", "expected_match": true},
        {"name": "admin-is-not-a-channel-wildcard", "cap": [{"op": "admin", "channel": "ops.*"}], "required_op": "pub", "required_channel": "logs.app", "expected_match": false},
        {"name": "op-mismatch-refused", "cap": [{"op": "sub", "channel": "*"}], "required_op": "pub", "required_channel": "anything", "expected_match": false},
        {"name": "unrecognised-op-is-skipped-not-fatal", "cap": [{"op": "delete", "channel": "*"}, {"op": "pub", "channel": "alerts"}], "required_op": "pub", "required_channel": "alerts", "expected_match": true},
        {"name": "empty-cap-grants-nothing", "cap": [], "required_op": "sub", "required_channel": "anything", "expected_match": false},
        {"name": "literal-star-channel-matched-by-equality", "cap": [{"op": "pub", "channel": "a*"}], "required_op": "pub", "required_channel": "a*", "expected_match": true}
    ]);

    // ── Rust-only structured attenuation vectors ─────────────────────────────
    let structured_subset_vectors = json!([
        {"name": "narrowing-op-and-channel", "root": [{"op": "admin", "channel": "logs.*"}], "sub": [{"op": "pub", "channel": "logs.app"}], "expected_subset": true},
        {"name": "identical-is-a-subset", "root": [{"op": "pub", "channel": "logs.*"}], "sub": [{"op": "pub", "channel": "logs.*"}], "expected_subset": true},
        {"name": "empty-sub-is-vacuously-a-subset", "root": [{"op": "pub", "channel": "*"}], "sub": [], "expected_subset": true},
        {"name": "empty-root-grants-nothing", "root": [], "sub": [{"op": "pub", "channel": "x"}], "expected_subset": false},
        {"name": "channel-escalation", "root": [{"op": "pub", "channel": "logs.*"}], "sub": [{"op": "pub", "channel": "metrics.app"}], "expected_subset": false},
        {"name": "glob-widening-under-a-literal-root", "root": [{"op": "pub", "channel": "logs.app"}], "sub": [{"op": "pub", "channel": "logs.app*"}], "expected_subset": false},
        {"name": "star-widening", "root": [{"op": "sub", "channel": "logs.*"}], "sub": [{"op": "sub", "channel": "*"}], "expected_subset": false},
        {"name": "op-escalation-to-admin", "root": [{"op": "sub", "channel": "*"}], "sub": [{"op": "admin", "channel": "*"}], "expected_subset": false},
        {"name": "dropping-a-rate-ceiling", "root": [{"op": "pub", "channel": "*", "rate_per_min": 60}], "sub": [{"op": "pub", "channel": "*"}], "expected_subset": false},
        {"name": "raising-a-payload-ceiling", "root": [{"op": "pub", "channel": "*", "max_payload_bytes": 1024}], "sub": [{"op": "pub", "channel": "*", "max_payload_bytes": 4096}], "expected_subset": false},
        {"name": "tightening-a-rate-ceiling", "root": [{"op": "pub", "channel": "*", "rate_per_min": 60}], "sub": [{"op": "pub", "channel": "*", "rate_per_min": 10}], "expected_subset": true}
    ]);

    json!({
        "_comment": "Canonical hv:2 harbor-card parity vectors, GENERATED FROM the canonical Rust impl (core/harbor-card-rs/src/lib.rs) by core/harbor-card-rs/tests/hv2_parity_vectors.rs. The Rust test and the TS test (apps/relay/tests/harbor-card-hv2-parity.test.ts) each assert that THEIR verifier reaches the recorded verdict on the same bytes. hv:2 is the live wire format (ADR-0049/0120): an Ed25519 JWT-shaped token whose signature covers the SHA-256 digest of `headerB64.payloadB64`, NOT the signing input itself, so a stock JWT library will not verify it. The two implementations are not identical: every vector records expected.rust AND expected.ts, and any vector where they differ carries a `divergence` field explaining why — a fixture that collapsed both columns into one boolean would assert a parity that does not hold. If you change the format in either language, regenerate this file FROM RUST (HV2_FIXTURE_REGENERATE=1 cargo test --test hv2_parity_vectors) and make both suites pass. ADR-0120 rule 4: reviewers treat a diff here exactly like a diff to the verifier.",
        "signing_scheme": "sig = Ed25519(issuer_sk, SHA-256(ascii(headerB64) || '.' || ascii(payloadB64))); the signed message is the raw 32 digest bytes",
        "revocation_boundary": "Neither column covers JTI revocation. apps/relay/src/auth.ts also refuses a card whose jti is in the D1 revocations table; that is stateful relay policy and deliberately stays out of the kernel crate (ADR-0120: keep the TCB small). The TS half stubs the revocation lookup to 'not revoked' so this fixture measures format verification only.",
        "issuer_seed_hex": hex(&ISSUER_SEED),
        "issuer_public_key_hex": issuer_pk,
        "impostor_public_key_hex": impostor_pk,
        "card_vectors": vectors,
        "capability_vectors": capability_vectors,
        "structured_subset_vectors_rust_only": {
            "_comment": "verify_capability_subset_structured has NO counterpart in apps/relay/src/auth.ts — the relay only ever asks 'does this card grant the concrete channel in front of me' (matchCapability). These vectors are asserted by the Rust suite alone, and the TS suite must NOT pretend to implement them.",
            "vectors": structured_subset_vectors
        }
    })
}

// ─── regeneration (Rust is the generator; ADR-0054/0120 make it canonical) ────

/// Rewrite the shared fixture from this implementation.
///
/// Skipped unless `HV2_FIXTURE_REGENERATE=1`, so a normal `cargo test` can never
/// "fix" a parity failure by moving the goalposts — the failure has to be read
/// and understood.
#[test]
fn regenerate_fixture_when_asked() {
    if std::env::var("HV2_FIXTURE_REGENERATE").as_deref() != Ok("1") {
        return;
    }
    let path = fixture_path();
    let body = serde_json::to_string_pretty(&build_fixture()).unwrap();
    fs::write(&path, format!("{body}\n")).unwrap_or_else(|e| panic!("write {path:?}: {e}"));
    println!("regenerated {path:?}");
}

// ─── the gate ────────────────────────────────────────────────────────────────

#[test]
fn fixture_is_present_and_non_trivial() {
    let f = fixture();
    let cards = f["card_vectors"].as_array().unwrap();
    let caps = f["capability_vectors"].as_array().unwrap();
    assert!(
        cards.len() >= 15,
        "card vectors thinned out to {} — negative coverage is the point of this fixture",
        cards.len()
    );
    assert!(caps.len() >= 10);
    // The named negative classes ADR-0120's gate requires.
    let names: Vec<&str> = cards
        .iter()
        .map(|v| v["name"].as_str().unwrap())
        .collect::<Vec<_>>();
    for required in [
        "reject-tampered-signature",
        "reject-expired",
        "reject-not-yet-valid",
        "reject-wrong-hv",
        "reject-capability-not-a-subset-wrong-op",
        "reject-legacy-signing-scheme",
    ] {
        assert!(
            names.contains(&required),
            "missing negative vector {required}"
        );
    }
}

#[test]
fn fixture_matches_freshly_generated_output() {
    // The fixture must be exactly what this implementation generates today. If
    // this fails, either the verifier changed (regenerate deliberately, and
    // review it as a security diff) or the file was hand-edited (don't).
    let on_disk = fixture();
    let generated = build_fixture();
    assert_eq!(
        on_disk, generated,
        "tests/fixtures/harbor-card-hv2-parity-vectors.json is out of date with the canonical Rust impl; \
         regenerate with HV2_FIXTURE_REGENERATE=1 cargo test --test hv2_parity_vectors"
    );
}

#[test]
fn rust_verifier_reproduces_every_card_vector() {
    let f = fixture();
    for v in f["card_vectors"].as_array().unwrap() {
        let name = v["name"].as_str().unwrap();
        let verifier = HarborCardVerifier::from_hex(v["issuer_public_key_hex"].as_str().unwrap())
            .unwrap_or_else(|e| panic!("{name}: bad issuer key: {e}"));
        let result = verifier.verify_for_channel(
            v["token"].as_str().unwrap(),
            v["now_ts"].as_i64().unwrap(),
            v["required_op"].as_str().unwrap(),
            v["required_channel"].as_str().unwrap(),
        );
        assert_eq!(
            rust_code(&result),
            v["expected"]["rust"].as_str().unwrap(),
            "vector {name}: {}",
            v["note"].as_str().unwrap_or("")
        );
    }
}

#[test]
fn rust_capability_matching_reproduces_every_grammar_vector() {
    let f = fixture();
    for v in f["capability_vectors"].as_array().unwrap() {
        let name = v["name"].as_str().unwrap();
        let caps: Vec<CapabilityEntry> = serde_json::from_value(v["cap"].clone()).unwrap();
        let matched = capability_matches(
            &caps,
            v["required_op"].as_str().unwrap(),
            v["required_channel"].as_str().unwrap(),
        )
        .is_some();
        assert_eq!(
            matched,
            v["expected_match"].as_bool().unwrap(),
            "capability vector {name}"
        );
    }
}

#[test]
fn rust_structured_attenuation_reproduces_every_rust_only_vector() {
    let f = fixture();
    for v in f["structured_subset_vectors_rust_only"]["vectors"]
        .as_array()
        .unwrap()
    {
        let name = v["name"].as_str().unwrap();
        let root: Vec<CapabilityEntry> = serde_json::from_value(v["root"].clone()).unwrap();
        let sub: Vec<CapabilityEntry> = serde_json::from_value(v["sub"].clone()).unwrap();
        assert_eq!(
            verify_capability_subset_structured(&root, &sub),
            v["expected_subset"].as_bool().unwrap(),
            "structured subset vector {name}"
        );
    }
}

#[test]
fn every_divergent_vector_explains_itself() {
    // The point of two expectation columns is that a divergence is stated. A
    // vector whose columns differ without a reason is an undocumented behavior
    // split — exactly what this fixture exists to prevent.
    for v in fixture()["card_vectors"].as_array().unwrap() {
        let rust = v["expected"]["rust"].as_str().unwrap();
        let ts = v["expected"]["ts"].as_str().unwrap();
        let same_verdict = (rust == "accept") == (ts == "accept");
        let same_code = matches!(
            (rust, ts),
            ("accept", "accept")
                | ("InvalidSignature", "BAD_SIG")
                | ("Expired", "EXPIRED")
                | ("NotYetValid", "NOT_YET_VALID")
                | ("WrongVersion", "WRONG_VERSION")
                | ("UnsupportedAlgorithm", "WRONG_ALG")
                | ("Malformed", "MALFORMED")
                | ("InsufficientCapability", "INSUFFICIENT_CAP")
        );
        if !same_verdict || !same_code {
            assert!(
                v.get("divergence").and_then(Value::as_str).is_some(),
                "vector {} diverges (rust={rust}, ts={ts}) with no `divergence` explanation",
                v["name"]
            );
        }
    }
}
