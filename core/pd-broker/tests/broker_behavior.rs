//! Behavioral tests for the credential broker (ADR-0087 Phase 4).
//!
//! These assert the load-bearing invariant: an authorized request yields a
//! scoped ticket with NO raw secret in the payload; an unauthorized / expired /
//! revoked request yields a refusal and no usable credential; the raw secret
//! string never appears in ANY serialized response, success or failure.

use std::collections::HashMap;

use pd_anchor::macaroon::{
    discharge_rent_paid, mint_push_grant, Macaroon, MintPushGrant, PushGrant, RentVerdict,
    DISCHARGE_TTL_MS,
};
use pd_broker::broker::{Broker, BrokerConfig};
use pd_broker::protocol::{Request, RequestCtx, Response};

const SECRET: &str = "ghp_SUPERSECRET_token_that_must_never_leak_0xdeadbeef";
const ROOT: &[u8] = b"root-key-32-bytes-padding-padxxx";
const CKEY: &[u8] = b"caveat-key-32-bytes-padding-padx";
const TICKET_KEY: &[u8] = b"ticket-signing-key-32-bytes-pad!";

const REPO: &str = "curiositech/port-daddy";
const SESSION: &str = "session-abc";
const PROTECTED: &str = "main";

/// A grant whose hard expiry is at unix-ms 2_000_000 (so we can test before/after).
fn grant() -> PushGrant {
    mint_push_grant(MintPushGrant {
        root_key: ROOT,
        grant_id: "grant-1",
        repo: REPO,
        session: SESSION,
        expires_ms: 2_000_000,
        caveat_key: CKEY.to_vec(),
        rent_nonce: "nonce-1",
        protected_branch: PROTECTED,
    })
    .unwrap()
}

/// A broker whose discharge-key store knows the grant's rent caveat key.
fn broker_for(grant: &PushGrant, ttl_ms: i64) -> Broker {
    let mut caveat_keys = HashMap::new();
    caveat_keys.insert(grant.rent_caveat_id.clone(), CKEY.to_vec());
    Broker::new(BrokerConfig {
        secret: SECRET.as_bytes().to_vec(),
        macaroon_root_key: ROOT.to_vec(),
        ticket_signing_key: TICKET_KEY.to_vec(),
        caveat_keys,
        ticket_ttl_ms: ttl_ms,
    })
    .unwrap()
}

fn push_ctx() -> RequestCtx {
    RequestCtx {
        op: Some("push".into()),
        repo: Some(REPO.into()),
        branch: Some("feat/dom-daddy-x".into()),
        session: Some(SESSION.into()),
        ..Default::default()
    }
}

/// Build a paid-rent, request-bound discharge for a grant at mint time `t`.
fn paid_discharge(g: &PushGrant) -> Macaroon {
    let discharge = discharge_rent_paid(
        &g.caveat_key,
        &g.rent_caveat_id,
        RentVerdict::Paid,
        1_000_000,
        DISCHARGE_TTL_MS,
    )
    .unwrap()
    .expect("paid rent yields a discharge");
    g.macaroon.prepare_for_request(&discharge).unwrap()
}

fn payload(resp: &Response) -> String {
    serde_json::to_string(resp).unwrap()
}

// ---------------------------------------------------------------------------
// 1. authorized -> ticket, and the raw secret is NOT in the payload
// ---------------------------------------------------------------------------
#[test]
fn authorized_request_yields_ticket_without_raw_secret() {
    let g = grant();
    let mut broker = broker_for(&g, DISCHARGE_TTL_MS);
    let req = Request::BrokerCredential {
        grant: Box::new(g.macaroon.clone()),
        discharges: vec![paid_discharge(&g)],
        ctx: Box::new(push_ctx()),
    };
    // now within the grant window and the discharge window
    let resp = broker.handle(req, 1_000_000);

    match &resp {
        Response::Ticket { ticket } => {
            assert_eq!(ticket.scope.op, "push");
            assert_eq!(ticket.scope.repo, REPO);
            assert_eq!(ticket.scope.branch, "feat/dom-daddy-x");
            assert_eq!(ticket.scope.session, SESSION);
            assert!(ticket.is_live(1_000_000));
            assert_eq!(ticket.expires_at_ms, 1_000_000 + DISCHARGE_TTL_MS);
        }
        other => panic!("expected Ticket, got {other:?}"),
    }

    // THE INVARIANT: the raw secret never appears in the authorized payload.
    assert!(
        !payload(&resp).contains(SECRET),
        "raw secret leaked in authorized response"
    );
}

// ---------------------------------------------------------------------------
// 2. unauthorized (no discharge) -> refusal, no ticket
// ---------------------------------------------------------------------------
#[test]
fn missing_discharge_yields_refusal_not_ticket() {
    let g = grant();
    let mut broker = broker_for(&g, DISCHARGE_TTL_MS);
    let req = Request::BrokerCredential {
        grant: Box::new(g.macaroon.clone()),
        discharges: vec![], // agent has NOT paid rent
        ctx: Box::new(push_ctx()),
    };
    let resp = broker.handle(req, 1_000_000);
    match &resp {
        Response::Refused { reason } => assert!(reason.contains("no discharge")),
        other => panic!("expected Refused, got {other:?}"),
    }
    assert!(!payload(&resp).contains(SECRET));
}

// ---------------------------------------------------------------------------
// 3. rent-due verdict -> agent never even gets a discharge -> refusal
// ---------------------------------------------------------------------------
#[test]
fn rent_due_means_no_discharge_means_refusal() {
    let g = grant();
    // The daemon would refuse to mint a discharge for an unpaid lease.
    let d = discharge_rent_paid(
        &g.caveat_key,
        &g.rent_caveat_id,
        RentVerdict::RentDue,
        1_000_000,
        DISCHARGE_TTL_MS,
    )
    .unwrap();
    assert!(d.is_none(), "rent-due must not yield a discharge");

    let mut broker = broker_for(&g, DISCHARGE_TTL_MS);
    let resp = broker.handle(
        Request::BrokerCredential {
            grant: Box::new(g.macaroon.clone()),
            discharges: vec![],
            ctx: Box::new(push_ctx()),
        },
        1_000_000,
    );
    assert!(matches!(resp, Response::Refused { .. }));
}

// ---------------------------------------------------------------------------
// 4. expired grant -> refusal even with a valid discharge
// ---------------------------------------------------------------------------
#[test]
fn expired_grant_yields_refusal() {
    let g = grant();
    let mut broker = broker_for(&g, DISCHARGE_TTL_MS);
    let req = Request::BrokerCredential {
        grant: Box::new(g.macaroon.clone()),
        discharges: vec![paid_discharge(&g)],
        ctx: Box::new(push_ctx()),
    };
    // now past the grant's hard expiry (2_000_000)
    let resp = broker.handle(req, 3_000_000);
    assert!(
        matches!(resp, Response::Refused { .. }),
        "expired grant must refuse"
    );
    assert!(!payload(&resp).contains(SECRET));
}

// ---------------------------------------------------------------------------
// 5. protected-branch push -> refusal (the deny-branch caveat bites)
// ---------------------------------------------------------------------------
#[test]
fn protected_branch_push_yields_refusal() {
    let g = grant();
    let mut broker = broker_for(&g, DISCHARGE_TTL_MS);
    let ctx = RequestCtx {
        branch: Some("main".into()),
        ..push_ctx()
    };
    let resp = broker.handle(
        Request::BrokerCredential {
            grant: Box::new(g.macaroon.clone()),
            discharges: vec![paid_discharge(&g)],
            ctx: Box::new(ctx),
        },
        1_000_000,
    );
    match &resp {
        Response::Refused { reason } => assert!(reason.contains("branch != main")),
        other => panic!("expected Refused, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// 6. THE raw-secret-never-leaks invariant across every outcome
// ---------------------------------------------------------------------------
#[test]
fn raw_secret_never_appears_in_any_response() {
    let g = grant();

    // (a) authorized
    let mut b1 = broker_for(&g, DISCHARGE_TTL_MS);
    let ok = b1.handle(
        Request::BrokerCredential {
            grant: Box::new(g.macaroon.clone()),
            discharges: vec![paid_discharge(&g)],
            ctx: Box::new(push_ctx()),
        },
        1_000_000,
    );

    // (b) unauthorized
    let mut b2 = broker_for(&g, DISCHARGE_TTL_MS);
    let refused = b2.handle(
        Request::BrokerCredential {
            grant: Box::new(g.macaroon.clone()),
            discharges: vec![],
            ctx: Box::new(push_ctx()),
        },
        1_000_000,
    );

    // (c) expired
    let mut b3 = broker_for(&g, DISCHARGE_TTL_MS);
    let expired = b3.handle(
        Request::BrokerCredential {
            grant: Box::new(g.macaroon.clone()),
            discharges: vec![paid_discharge(&g)],
            ctx: Box::new(push_ctx()),
        },
        9_000_000,
    );

    // (d) ping
    let mut b4 = broker_for(&g, DISCHARGE_TTL_MS);
    let pong = b4.handle(Request::Ping, 1_000_000);

    for resp in [&ok, &refused, &expired, &pong] {
        let p = payload(resp);
        assert!(!p.contains(SECRET), "secret leaked in {resp:?}: {p}");
        // also assert the secret's distinctive token fragment never appears
        assert!(!p.contains("ghp_"), "credential prefix leaked: {p}");
    }

    // sanity: the authorized one really did mint a ticket
    assert!(matches!(ok, Response::Ticket { .. }));
}

// ---------------------------------------------------------------------------
// 7. revoked discharge key (broker store doesn't know it) -> refusal
// ---------------------------------------------------------------------------
#[test]
fn unknown_caveat_key_revokes_authorization() {
    let g = grant();
    // Broker with an EMPTY caveat-key store: the rent caveat cannot be resolved,
    // simulating a revoked / unknown discharge key.
    let mut broker = Broker::new(BrokerConfig {
        secret: SECRET.as_bytes().to_vec(),
        macaroon_root_key: ROOT.to_vec(),
        ticket_signing_key: TICKET_KEY.to_vec(),
        caveat_keys: HashMap::new(),
        ticket_ttl_ms: DISCHARGE_TTL_MS,
    })
    .unwrap();
    let resp = broker.handle(
        Request::BrokerCredential {
            grant: Box::new(g.macaroon.clone()),
            discharges: vec![paid_discharge(&g)],
            ctx: Box::new(push_ctx()),
        },
        1_000_000,
    );
    match &resp {
        Response::Refused { reason } => assert!(reason.contains("no discharge key")),
        other => panic!("expected Refused, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// 8. empty secret / empty keys are rejected at construction (fail closed)
// ---------------------------------------------------------------------------
#[test]
fn empty_secret_is_rejected() {
    let err = Broker::new(BrokerConfig {
        secret: vec![],
        macaroon_root_key: ROOT.to_vec(),
        ticket_signing_key: TICKET_KEY.to_vec(),
        caveat_keys: HashMap::new(),
        ticket_ttl_ms: DISCHARGE_TTL_MS,
    });
    assert!(err.is_err());
}
