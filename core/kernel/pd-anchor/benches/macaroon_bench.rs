//! Criterion baseline for the macaroon verify chain — the kernel capability
//! gate. Benchmarks the realistic rent/discharge path (a minted push grant with
//! five first-party caveats plus one third-party rent caveat, discharged and
//! request-bound), a longer 10-caveat first-party chain, plus the two leaf
//! primitives (`check_caveat`, `ct_eq` via a public proxy is not exposed so we
//! bench the caveat grammar which exercises the parse+glob path).
//!
//! The point is to see how much of verify() is HMAC (irreducible crypto) versus
//! allocation/marshalling we could cut. Run:
//! `cargo bench -p pd-anchor --bench macaroon_bench`

use criterion::{criterion_group, criterion_main, Criterion};
use pd_anchor::macaroon::{
    check_caveat, discharge_rent_paid, mint_push_grant, verify, branch_caveat, deny_branch_caveat,
    expires_caveat, op_caveat, spend_ceiling_caveat, Macaroon, MintPushGrant, RentVerdict,
    RequestContext, DISCHARGE_TTL_MS,
};
use std::hint::black_box;

const ROOT: &[u8] = b"root-key-32-bytes-padding-padxxx";
const CKEY: &[u8] = b"caveat-key-32-bytes-padding-padx";

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

/// The realistic production shape: a full push grant + its rent discharge,
/// request-bound, verified end to end (recomputes 6 HMACs on the root chain plus
/// the discharge sub-chain and the binding HMAC).
fn bench_verify_rent_chain(c: &mut Criterion) {
    let g = mint_push_grant(MintPushGrant {
        root_key: ROOT,
        grant_id: "grant-1",
        repo: "curiositech/port-daddy",
        session: "session-abc",
        expires_ms: 2_000_000,
        caveat_key: CKEY.to_vec(),
        rent_nonce: "nonce-1",
        protected_branch: "main",
    })
    .unwrap();
    // CKEY is the caveat_key we handed mint_push_grant (the struct field is
    // pub(crate) — key custody stays inside the crate — so the bench reuses the
    // known value rather than reading it back out).
    let discharge = discharge_rent_paid(CKEY, &g.rent_caveat_id, RentVerdict::Paid, 1_000_000, DISCHARGE_TTL_MS)
        .unwrap()
        .unwrap();
    let bound = g.macaroon.prepare_for_request(&discharge).unwrap();
    let ctx = push_ctx();
    let rent_id = g.rent_caveat_id.clone();
    let discharges = vec![bound];

    c.bench_function("verify_rent_chain_6cav", |b| {
        b.iter(|| {
            let check = |p: &str| check_caveat(p, &ctx);
            let resolve = |id: &str| (id == rent_id).then(|| CKEY.to_vec());
            verify(black_box(&g.macaroon), ROOT, black_box(&discharges), &check, &resolve)
        });
    });
}

/// A 10-caveat first-party-only chain — the "long attenuation" case. All
/// first-party, so this isolates the HMAC-per-caveat cost with no discharge
/// recursion and no per-caveat Vec allocation (first-party uses `as_bytes()`).
fn bench_verify_long_firstparty(c: &mut Criterion) {
    let mut m = Macaroon::mint(ROOT, "g", "loc");
    let preds = [
        op_caveat("push"),
        branch_caveat("feat/*"),
        deny_branch_caveat("main"),
        deny_branch_caveat("release"),
        expires_caveat(9_000_000),
        spend_ceiling_caveat(100.0),
        "session = s".into(),
        "host = a.example".into(),
        "repo = curiositech/port-daddy".into(),
        "op = push".into(),
    ];
    for p in &preds {
        m = m.add_first_party_caveat(p.clone()).unwrap();
    }
    c.bench_function("verify_long_firstparty_10cav", |b| {
        b.iter(|| verify(black_box(&m), ROOT, &[], &|_| true, &|_| None));
    });
}

/// The caveat grammar leaf — parsed and evaluated on every first-party hop of
/// every verify. Bench the glob path (most work) and a plain equality path.
fn bench_check_caveat(c: &mut Criterion) {
    let ctx = push_ctx();
    let glob = branch_caveat("feat/dom-*-x");
    let eq = op_caveat("push");
    c.bench_function("check_caveat_glob", |b| {
        b.iter(|| check_caveat(black_box(&glob), black_box(&ctx)));
    });
    c.bench_function("check_caveat_eq", |b| {
        b.iter(|| check_caveat(black_box(&eq), black_box(&ctx)));
    });
}

criterion_group!(benches, bench_verify_rent_chain, bench_verify_long_firstparty, bench_check_caveat);
criterion_main!(benches);
