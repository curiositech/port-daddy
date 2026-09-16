//! Cross-runtime byte-parity: assert the canonical Rust impl reproduces the shared
//! vectors in tests/fixtures/macaroon-parity-vectors.json. The TS suite asserts the
//! SAME fixture (tests/unit/macaroon-parity.test.js). Together they make ADR-0054 I11
//! (runtime parity) enforceable: a construction change in either language that breaks
//! byte-parity fails CI. Regenerate the fixture from THIS impl (it is canonical).
use pd_anchor::macaroon::*;
use serde_json::Value;
use std::{fs, path::PathBuf};

fn vectors() -> Value {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/fixtures/macaroon-parity-vectors.json");
    serde_json::from_str(&fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {p:?}: {e}")))
        .unwrap()
}

#[test]
fn first_party_matches_canonical_vector() {
    let v = vectors();
    let root = v["root_key_utf8"].as_str().unwrap().as_bytes();
    let fp = &v["first_party"];
    let mut m = Macaroon::mint(
        root,
        fp["identifier"].as_str().unwrap(),
        fp["location"].as_str().unwrap(),
    );
    for c in fp["caveats"].as_array().unwrap() {
        m = m.add_first_party_caveat(c.as_str().unwrap()).unwrap();
    }
    assert_eq!(
        m.signature_hex,
        fp["expected_signature_hex"].as_str().unwrap()
    );
}

#[test]
fn all_caveat_types_match_canonical_vector() {
    // Locks the chain encoding of EVERY first-party caveat kind (op/repo/branch-
    // glob/host/spend_usd/expires/session) — the red-team coverage gap.
    let v = vectors();
    let root = v["root_key_utf8"].as_str().unwrap().as_bytes();
    let ac = &v["all_caveat_types"];
    let mut m = Macaroon::mint(
        root,
        ac["identifier"].as_str().unwrap(),
        ac["location"].as_str().unwrap(),
    );
    for c in ac["caveats"].as_array().unwrap() {
        m = m.add_first_party_caveat(c.as_str().unwrap()).unwrap();
    }
    assert_eq!(
        m.signature_hex,
        ac["expected_signature_hex"].as_str().unwrap()
    );
}

#[test]
fn third_party_grant_and_discharge_match_canonical_vector() {
    let v = vectors();
    let root = v["root_key_utf8"].as_str().unwrap().as_bytes();
    let ckey = v["caveat_key_utf8"].as_str().unwrap().as_bytes();
    let tp = &v["third_party_grant"];
    let g = mint_actor_bound_push_grant(MintActorBoundPushGrant {
        root_key: root,
        grant_id: tp["grant_id"].as_str().unwrap(),
        repo: tp["repo"].as_str().unwrap(),
        actor: tp["actor"].as_str().unwrap(),
        session: tp["session"].as_str().unwrap(),
        expires_ms: tp["expires_ms"].as_i64().unwrap(),
        caveat_key: ckey.to_vec(),
        rent_nonce: tp["rent_nonce"].as_str().unwrap(),
        protected_branch: tp["protected_branch"].as_str().unwrap(),
    })
    .unwrap();
    assert_eq!(
        g.macaroon.identifier,
        tp["expected_identifier"].as_str().unwrap()
    );
    assert_eq!(g.rent_caveat_id, tp["rent_caveat_id"].as_str().unwrap());
    assert_eq!(
        g.macaroon.caveats.last().unwrap().vid.clone().unwrap(),
        tp["expected_vid_hex"].as_str().unwrap()
    );
    assert_eq!(
        g.macaroon.signature_hex,
        tp["expected_signature_hex"].as_str().unwrap()
    );

    let db = &v["discharge_bound"];
    let d = discharge_rent_paid(
        ckey,
        &g.rent_caveat_id,
        RentVerdict::Paid,
        db["discharge_now_ms"].as_i64().unwrap(),
        db["discharge_ttl_ms"].as_i64().unwrap(),
    )
    .unwrap()
    .unwrap();
    let bound = g.macaroon.prepare_for_request(&d).unwrap();
    assert_eq!(
        bound.signature_hex,
        db["expected_signature_hex"].as_str().unwrap()
    );
}
