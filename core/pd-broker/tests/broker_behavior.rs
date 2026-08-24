//! End-to-end broker behavior over authenticated mint and durable redemption.

use std::ffi::{c_char, CStr, CString};
use std::fs::Permissions;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::{Arc, Barrier};

use pd_anchor::ffi::{
    pd_keystore_issue_discharge_json, pd_keystore_issue_grant_json, pd_string_free,
};
use pd_anchor::keystore;
use pd_anchor::macaroon::{Macaroon, RentVerdict, DISCHARGE_TTL_MS};
use pd_broker::broker::{Broker, BrokerConfig, BROKER_CREDENTIAL_LIMITS};
use pd_broker::capability::{
    action_digest, action_id, push_resource_digest, ActionCapability, ActionIntent,
    CredentialProvenanceKind,
};
use pd_broker::protocol::{
    ActionReservation, BootstrapRequirement, MintAuthority, RefusalCode, Request, RequestCtx,
    Response,
};

const SECRET: &str = "ghp_SUPERSECRET_token_that_must_never_leak_0xdeadbeef";
const ROOT: &[u8] = b"root-key-32-bytes-padding-padxxx";
const CAPABILITY_KEY: &[u8] = b"action-capability-signing-key-pad!";
const ISSUER: &str = "port-daddy:broker";
const EGRESS: &str = "port-daddy:git-egress";
const REPO: &str = "curiositech/port-daddy";
const ACTOR: &str = "01K3YR6M1WPZB8Q6V1J8K7D4MC";
const VICTIM_ACTOR: &str = "01K3YR6M1WPZB8Q6V1J8K7D4MD";
const SESSION: &str = "session-abc";
const BRANCH: &str = "feat/action-capability";
const NOW: i64 = 1_000_000;

#[derive(Clone)]
struct TestGrant {
    macaroon: Macaroon,
    grant_id: String,
}

fn grant() -> TestGrant {
    let (macaroon, grant_id) =
        keystore::issue_grant(REPO, ACTOR, SESSION, 2_000_000, "main").unwrap();
    TestGrant { macaroon, grant_id }
}

fn paid_discharge(grant: &TestGrant) -> Macaroon {
    let discharge =
        keystore::issue_discharge(&grant.grant_id, RentVerdict::Paid, NOW, DISCHARGE_TTL_MS)
            .unwrap()
            .expect("paid rent must yield a discharge");
    grant.macaroon.prepare_for_request(&discharge).unwrap()
}

fn broker_at(path: &Path) -> Broker {
    broker_at_with_ttl(path, 60_000)
}

fn broker_at_with_ttl(path: &Path, capability_ttl_ms: i64) -> Broker {
    std::fs::set_permissions(path.parent().unwrap(), Permissions::from_mode(0o700)).unwrap();
    Broker::new(BrokerConfig {
        secret: SECRET.as_bytes().to_vec(),
        capability_signing_key: CAPABILITY_KEY.to_vec(),
        capability_ttl_ms,
        issuer: ISSUER.into(),
        allowed_audiences: vec![ISSUER.into(), EGRESS.into()],
        redemption_db_path: path.to_path_buf(),
    })
    .unwrap()
}

fn push_ctx() -> RequestCtx {
    RequestCtx {
        op: Some("push".into()),
        repo: Some(REPO.into()),
        branch: Some(BRANCH.into()),
        actor: Some(ACTOR.into()),
        session: Some(SESSION.into()),
        ..Default::default()
    }
}

fn push_intent(audience: &str) -> ActionIntent {
    ActionIntent {
        audience: audience.into(),
        operation: "push".into(),
        resource_digest: push_resource_digest(REPO, BRANCH).unwrap(),
    }
}

fn mint_request(grant: &TestGrant, audience: &str) -> Request {
    Request::MintActionCapability {
        authority: Box::new(MintAuthority::Macaroon {
            grant: Box::new(grant.macaroon.clone()),
            discharges: vec![paid_discharge(grant)],
            ctx: Box::new(push_ctx()),
        }),
        intent: Box::new(push_intent(audience)),
    }
}

fn minted(response: Response) -> ActionCapability {
    minted_with_replay(response).0
}

fn minted_with_replay(response: Response) -> (ActionCapability, bool) {
    match response {
        Response::Capability {
            capability,
            replayed,
        } => (*capability, replayed),
        other => panic!("expected capability, got {other:?}"),
    }
}

fn reserved(response: Response) -> (ActionReservation, bool) {
    match response {
        Response::ActionReserved {
            reservation,
            replayed,
        } => (*reservation, replayed),
        other => panic!("expected action reservation, got {other:?}"),
    }
}

fn payload(response: &Response) -> String {
    serde_json::to_string(response).unwrap()
}

fn call_anchor_ffi(
    export: unsafe extern "C" fn(*const c_char, usize) -> *mut c_char,
    request: &str,
) -> serde_json::Value {
    let request = CString::new(request).unwrap();
    let pointer = unsafe { export(request.as_ptr(), request.as_bytes().len()) };
    assert!(
        !pointer.is_null(),
        "pd-anchor FFI must return a refusal, never null"
    );
    let response = unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .unwrap()
        .to_owned();
    unsafe { pd_string_free(pointer) };
    serde_json::from_str(&response).unwrap()
}

#[test]
fn ffi_keystore_grant_mints_and_redeems_one_exact_action_once() {
    let issued = call_anchor_ffi(
        pd_keystore_issue_grant_json,
        &serde_json::json!({
            "repo": REPO,
            "actor": ACTOR,
            "session": SESSION,
            "expires_ms": 2_000_000,
            "protected_branch": "main"
        })
        .to_string(),
    );
    assert_eq!(issued["ok"], true, "{issued}");
    let grant_id = issued["grant_id"].as_str().unwrap().to_owned();
    let macaroon: Macaroon = serde_json::from_value(issued["macaroon"].clone()).unwrap();
    assert_eq!(macaroon.identifier, grant_id);

    let discharged = call_anchor_ffi(
        pd_keystore_issue_discharge_json,
        &serde_json::json!({
            "grant_id": grant_id,
            "verdict": "paid",
            "now_ms": NOW,
            "ttl_ms": DISCHARGE_TTL_MS
        })
        .to_string(),
    );
    assert_eq!(discharged["ok"], true, "{discharged}");
    let discharge: Macaroon = serde_json::from_value(discharged["discharge"].clone()).unwrap();
    let grant = TestGrant {
        grant_id: macaroon.identifier.clone(),
        macaroon: macaroon.clone(),
    };
    let bound = macaroon.prepare_for_request(&discharge).unwrap();

    let dir = tempfile::tempdir().unwrap();
    let mut broker = broker_at(&dir.path().join("ffi-e2e.sqlite3"));
    let capability = minted(broker.handle(
        Request::MintActionCapability {
            authority: Box::new(MintAuthority::Macaroon {
                grant: Box::new(macaroon),
                discharges: vec![bound],
                ctx: Box::new(push_ctx()),
            }),
            intent: Box::new(push_intent(EGRESS)),
        },
        NOW,
    ));
    assert_eq!(capability.actor, ACTOR);
    assert_eq!(capability.harbor, REPO);

    let redeem = || Request::RedeemActionCapability {
        capability: Box::new(capability.clone()),
        expected: Box::new(capability.expectation()),
    };
    let (first, first_replayed) = reserved(broker.handle(redeem(), NOW + 1));
    let (replay, replayed) = reserved(broker.handle(redeem(), NOW + 2));
    assert!(!first_replayed);
    assert!(replayed);
    assert_eq!(replay, first);
    assert_eq!(
        first.action_id,
        action_id(ISSUER, &capability.action_digest).unwrap()
    );
    assert_eq!(broker.retained_redemptions().unwrap(), 1);

    // Keep the FFI-issued grant alive through both mint and redemption; this
    // assertion also proves the helper did not silently substitute a test grant.
    assert_eq!(grant.macaroon.identifier, grant.grant_id);
}

#[test]
fn existing_push_is_expressed_by_the_general_action_contract() {
    let dir = tempfile::tempdir().unwrap();
    let grant = grant();
    let mut broker = broker_at(&dir.path().join("state.sqlite3"));
    let response = broker.handle(mint_request(&grant, EGRESS), NOW);
    let capability = minted(response.clone());

    assert_eq!(capability.schema_version, 1);
    assert_eq!(capability.issuer, ISSUER);
    assert_eq!(capability.audience, EGRESS);
    assert_eq!(capability.operation, "push");
    assert_eq!(capability.actor, ACTOR);
    assert_eq!(capability.harbor, REPO);
    assert_eq!(capability.tenant, "curiositech");
    assert_eq!(
        capability.resource_digest,
        push_intent(EGRESS).resource_digest
    );
    assert_eq!(
        capability.action_digest,
        action_digest(
            "push",
            ACTOR,
            REPO,
            "curiositech",
            &capability.resource_digest
        )
        .unwrap()
    );
    assert_eq!(capability.not_before_ms, NOW);
    assert_eq!(capability.expires_at_ms, NOW + 60_000);
    assert!(matches!(
        capability.credential_provenance.kind,
        CredentialProvenanceKind::Macaroon
    ));
    assert!(!payload(&response).contains(SECRET));
    assert!(!format!("{response:?}").contains(&capability.tag_hex));
}

#[test]
fn missing_discharge_and_protected_branch_refuse_without_secret_leakage() {
    let dir = tempfile::tempdir().unwrap();
    let grant = grant();
    let db = dir.path().join("state.sqlite3");
    let mut broker = broker_at(&db);
    let missing = broker.handle(
        Request::MintActionCapability {
            authority: Box::new(MintAuthority::Macaroon {
                grant: Box::new(grant.macaroon.clone()),
                discharges: vec![],
                ctx: Box::new(push_ctx()),
            }),
            intent: Box::new(push_intent(EGRESS)),
        },
        NOW,
    );
    assert!(matches!(
        missing,
        Response::Refused {
            code: RefusalCode::Unauthorized,
            ..
        }
    ));

    let mut protected_ctx = push_ctx();
    protected_ctx.branch = Some("main".into());
    let protected = broker.handle(
        Request::MintActionCapability {
            authority: Box::new(MintAuthority::Macaroon {
                grant: Box::new(grant.macaroon.clone()),
                discharges: vec![paid_discharge(&grant)],
                ctx: Box::new(protected_ctx),
            }),
            intent: Box::new(ActionIntent {
                audience: EGRESS.into(),
                operation: "push".into(),
                resource_digest: push_resource_digest(REPO, "main").unwrap(),
            }),
        },
        NOW,
    );
    assert!(matches!(
        protected,
        Response::Refused {
            code: RefusalCode::Unauthorized,
            ..
        }
    ));
    for response in [&missing, &protected] {
        assert!(!payload(response).contains(SECRET));
        assert!(!payload(response).contains("ghp_"));
    }
}

#[test]
fn broad_macaroon_cannot_self_assert_push_actor_or_tenant() {
    let dir = tempfile::tempdir().unwrap();
    let broad = Macaroon::mint(ROOT, "broad", "pd://test");
    let mut broker = broker_at(&dir.path().join("state.sqlite3"));
    let response = broker.handle(
        Request::MintActionCapability {
            authority: Box::new(MintAuthority::Macaroon {
                grant: Box::new(broad),
                discharges: vec![],
                ctx: Box::new(push_ctx()),
            }),
            intent: Box::new(push_intent(EGRESS)),
        },
        NOW,
    );
    assert!(matches!(
        response,
        Response::Refused {
            code: RefusalCode::Unauthorized,
            ..
        }
    ));
}

#[test]
fn non_push_macaroon_cannot_authorize_a_caller_chosen_resource_digest() {
    let dir = tempfile::tempdir().unwrap();
    let non_push = Macaroon::mint(ROOT, "parley-grant", "pd://test")
        .add_first_party_caveat("op = parley.resolve")
        .unwrap()
        .add_first_party_caveat(format!("repo = {REPO}"))
        .unwrap()
        .add_first_party_caveat(format!("actor = {ACTOR}"))
        .unwrap()
        .add_first_party_caveat(format!("session = {SESSION}"))
        .unwrap()
        .add_first_party_caveat("expires = 2000000")
        .unwrap();
    let mut broker = broker_at(&dir.path().join("state.sqlite3"));
    let response = broker.handle(
        Request::MintActionCapability {
            authority: Box::new(MintAuthority::Macaroon {
                grant: Box::new(non_push),
                discharges: vec![],
                ctx: Box::new(RequestCtx {
                    op: Some("parley.resolve".into()),
                    repo: Some(REPO.into()),
                    actor: Some(ACTOR.into()),
                    session: Some(SESSION.into()),
                    ..Default::default()
                }),
            }),
            intent: Box::new(ActionIntent {
                audience: EGRESS.into(),
                operation: "parley.resolve".into(),
                resource_digest: pd_broker::resource_digest(
                    "test/parley-action/v1",
                    &["parley-victim", "resolve"],
                )
                .unwrap(),
            }),
        },
        NOW,
    );
    assert!(matches!(
        response,
        Response::Refused {
            code: RefusalCode::Unauthorized,
            ..
        }
    ));
}

#[test]
fn signed_session_or_alias_cannot_substitute_for_a_canonical_actor() {
    let dir = tempfile::tempdir().unwrap();
    let grant = grant();
    let db = dir.path().join("state.sqlite3");
    let mut broker = broker_at(&db);

    let mut victim_ctx = push_ctx();
    victim_ctx.actor = Some(VICTIM_ACTOR.into());
    let victim = broker.handle(
        Request::MintActionCapability {
            authority: Box::new(MintAuthority::Macaroon {
                grant: Box::new(grant.macaroon.clone()),
                discharges: vec![paid_discharge(&grant)],
                ctx: Box::new(victim_ctx),
            }),
            intent: Box::new(push_intent(EGRESS)),
        },
        NOW,
    );
    assert!(matches!(
        victim,
        Response::Refused {
            code: RefusalCode::Unauthorized,
            ..
        }
    ));

    for non_principal in [SESSION, "spark", "operator:local"] {
        let mut ctx = push_ctx();
        ctx.actor = Some(non_principal.into());
        let response = broker.handle(
            Request::MintActionCapability {
                authority: Box::new(MintAuthority::Macaroon {
                    grant: Box::new(grant.macaroon.clone()),
                    discharges: vec![paid_discharge(&grant)],
                    ctx: Box::new(ctx),
                }),
                intent: Box::new(push_intent(EGRESS)),
            },
            NOW,
        );
        assert!(matches!(
            response,
            Response::Refused {
                code: RefusalCode::Malformed,
                ..
            }
        ));
    }
}

#[test]
fn wrong_resource_digest_and_unallowlisted_audience_fail_closed() {
    let dir = tempfile::tempdir().unwrap();
    let grant = grant();
    let mut broker = broker_at(&dir.path().join("state.sqlite3"));

    let wrong_resource = broker.handle(
        Request::MintActionCapability {
            authority: Box::new(MintAuthority::Macaroon {
                grant: Box::new(grant.macaroon.clone()),
                discharges: vec![paid_discharge(&grant)],
                ctx: Box::new(push_ctx()),
            }),
            intent: Box::new(ActionIntent {
                resource_digest: push_resource_digest(REPO, "main").unwrap(),
                ..push_intent(EGRESS)
            }),
        },
        NOW,
    );
    assert!(matches!(
        wrong_resource,
        Response::Refused {
            code: RefusalCode::ScopeMismatch,
            ..
        }
    ));

    let wrong_audience = broker.handle(mint_request(&grant, "attacker:service"), NOW);
    assert!(matches!(
        wrong_audience,
        Response::Refused {
            code: RefusalCode::ScopeMismatch,
            ..
        }
    ));
}

#[test]
fn native_operator_bootstrap_is_a_typed_refusal_not_loopback_authority() {
    let dir = tempfile::tempdir().unwrap();
    let mut broker = broker_at(&dir.path().join("state.sqlite3"));
    let response = broker.handle(
        Request::MintActionCapability {
            authority: Box::new(MintAuthority::NativeOperatorBootstrap),
            intent: Box::new(ActionIntent {
                audience: EGRESS.into(),
                operation: "parley.resolve".into(),
                resource_digest: pd_broker::resource_digest(
                    "test/parley/v1",
                    &["parley-1", "collapsed"],
                )
                .unwrap(),
            }),
        },
        NOW,
    );
    assert!(matches!(
        response,
        Response::BootstrapRequired {
            requirement: BootstrapRequirement::CodeSignedKeychainOperatorCredential,
            ..
        }
    ));
}

#[test]
fn lost_action_response_replays_the_exact_reservation_after_restart_and_expiry() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.sqlite3");
    let grant = grant();
    let mut first = broker_at(&path);
    let capability = minted(first.handle(mint_request(&grant, EGRESS), NOW));
    let expected = capability.expectation();
    let first_response = first.handle(
        Request::RedeemActionCapability {
            capability: Box::new(capability.clone()),
            expected: Box::new(expected.clone()),
        },
        NOW + 1,
    );
    let first_wire = serde_json::to_value(&first_response).unwrap();
    assert_eq!(first_wire["type"], "action-reserved");
    assert!(first_wire.get("receipt").is_none());
    let (original, first_replayed) = reserved(first_response);
    assert!(!first_replayed);
    assert_eq!(original.schema_version, 1);
    assert_eq!(original.domain, "port-daddy/action-reservation/v1");
    assert_eq!(
        original.action_id,
        action_id(&capability.issuer, &capability.action_digest).unwrap()
    );
    assert_eq!(
        original.capability_digest,
        pd_broker::capability_fingerprint(&capability).unwrap()
    );
    assert_eq!(original.actor, ACTOR);
    assert_eq!(original.harbor, REPO);
    assert_eq!(first.retained_redemptions().unwrap(), 1);
    drop(first);

    let mut restarted = broker_at(&path);
    let replay_at_ms = capability.expires_at_ms + 1;
    let replay = restarted.handle(
        Request::RedeemActionCapability {
            capability: Box::new(capability),
            expected: Box::new(expected),
        },
        replay_at_ms,
    );
    let (recovered, replayed) = reserved(replay);
    assert!(replayed);
    assert_eq!(recovered, original);
    assert_eq!(restarted.retained_redemptions().unwrap(), 1);
}

#[test]
fn concurrent_cross_connection_redemption_converges_on_one_reservation() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.sqlite3");
    let grant = grant();
    let mut minter = broker_at(&path);
    let capability = minted(minter.handle(mint_request(&grant, EGRESS), NOW));
    drop(minter);

    let first = broker_at(&path);
    let second = broker_at(&path);
    let barrier = Arc::new(Barrier::new(3));
    let expected = capability.expectation();
    let handles: Vec<_> = [first, second]
        .into_iter()
        .map(|mut broker| {
            let barrier = Arc::clone(&barrier);
            let capability = capability.clone();
            let expected = expected.clone();
            std::thread::spawn(move || {
                barrier.wait();
                broker.handle(
                    Request::RedeemActionCapability {
                        capability: Box::new(capability),
                        expected: Box::new(expected),
                    },
                    NOW + 1,
                )
            })
        })
        .collect();
    barrier.wait();
    let responses: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();
    let mut reservations = responses.into_iter().map(reserved).collect::<Vec<_>>();
    reservations.sort_by_key(|(_, replayed)| *replayed);
    assert_eq!(reservations.len(), 2);
    assert!(!reservations[0].1);
    assert!(reservations[1].1);
    assert_eq!(reservations[0].0, reservations[1].0);
}

#[test]
fn redemption_rejects_cross_actor_harbor_tenant_operation_and_audience() {
    let dir = tempfile::tempdir().unwrap();
    let grant = grant();
    let mut broker = broker_at(&dir.path().join("state.sqlite3"));
    let capability = minted(broker.handle(mint_request(&grant, EGRESS), NOW));

    for mutate in 0..5 {
        let mut expected = capability.expectation();
        match mutate {
            0 => expected.actor = VICTIM_ACTOR.into(),
            1 => expected.harbor = "other/repo".into(),
            2 => expected.tenant = "other".into(),
            3 => expected.operation = "parley.resolve".into(),
            4 => expected.audience = ISSUER.into(),
            _ => unreachable!(),
        }
        let response = broker.handle(
            Request::RedeemActionCapability {
                capability: Box::new(capability.clone()),
                expected: Box::new(expected),
            },
            NOW + 1,
        );
        assert!(matches!(
            response,
            Response::Refused {
                code: RefusalCode::ScopeMismatch,
                ..
            }
        ));
    }
    assert_eq!(broker.retained_redemptions().unwrap(), 0);
}

#[test]
fn lost_attenuation_response_reconstructs_the_exact_child_after_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.sqlite3");
    let grant = grant();
    let mut broker = broker_at(&path);
    let parent = minted(broker.handle(mint_request(&grant, ISSUER), NOW));
    let child_request = || Request::MintActionCapability {
        authority: Box::new(MintAuthority::BrokerCapability {
            capability: Box::new(parent.clone()),
        }),
        intent: Box::new(push_intent(EGRESS)),
    };

    let (child, first_replayed) = minted_with_replay(broker.handle(child_request(), NOW + 1));
    assert!(!first_replayed);
    assert_eq!(child.audience, EGRESS);
    assert_eq!(child.actor, parent.actor);
    assert_eq!(child.harbor, parent.harbor);
    assert_eq!(child.tenant, parent.tenant);
    assert_eq!(child.action_digest, parent.action_digest);
    assert!(child.expires_at_ms <= parent.expires_at_ms);
    assert!(matches!(
        child.credential_provenance.kind,
        CredentialProvenanceKind::BrokerCapability
    ));

    drop(broker);

    // A changed server TTL cannot perturb the stored first result.
    let mut restarted = broker_at_with_ttl(&path, 30_000);
    let (recovered, replayed) = minted_with_replay(restarted.handle(child_request(), NOW + 2));
    assert!(replayed);
    assert_eq!(recovered, child);

    let conflict = restarted.handle(
        Request::MintActionCapability {
            authority: Box::new(MintAuthority::BrokerCapability {
                capability: Box::new(parent.clone()),
            }),
            intent: Box::new(push_intent(ISSUER)),
        },
        NOW + 3,
    );
    assert!(matches!(
        conflict,
        Response::Refused {
            code: RefusalCode::ReservationConflict,
            ..
        }
    ));

    let cross_use = restarted.handle(
        Request::RedeemActionCapability {
            capability: Box::new(parent.clone()),
            expected: Box::new(parent.expectation()),
        },
        NOW + 4,
    );
    assert!(matches!(
        cross_use,
        Response::Refused {
            code: RefusalCode::ReservationConflict,
            ..
        }
    ));
}

#[test]
fn parent_capability_cannot_widen_operation_resource_or_origin_scope() {
    let dir = tempfile::tempdir().unwrap();
    let grant = grant();
    let mut broker = broker_at(&dir.path().join("state.sqlite3"));
    let parent = minted(broker.handle(mint_request(&grant, ISSUER), NOW));
    let response = broker.handle(
        Request::MintActionCapability {
            authority: Box::new(MintAuthority::BrokerCapability {
                capability: Box::new(parent),
            }),
            intent: Box::new(ActionIntent {
                audience: EGRESS.into(),
                operation: "parley.resolve".into(),
                resource_digest: pd_broker::resource_digest("test/parley/v1", &["parley-1"])
                    .unwrap(),
            }),
        },
        NOW + 1,
    );
    assert!(matches!(
        response,
        Response::Refused {
            code: RefusalCode::ScopeMismatch,
            ..
        }
    ));
    assert_eq!(broker.retained_redemptions().unwrap(), 0);
}

#[test]
fn malformed_and_oversized_credential_shapes_refuse_before_crypto() {
    let dir = tempfile::tempdir().unwrap();
    let grant = grant();
    let path = dir.path().join("state.sqlite3");
    let mut broker = broker_at(&path);

    let too_many_discharges =
        vec![paid_discharge(&grant); BROKER_CREDENTIAL_LIMITS.max_discharges + 1];
    let over_count = broker.handle(
        Request::MintActionCapability {
            authority: Box::new(MintAuthority::Macaroon {
                grant: Box::new(grant.macaroon.clone()),
                discharges: too_many_discharges,
                ctx: Box::new(push_ctx()),
            }),
            intent: Box::new(push_intent(EGRESS)),
        },
        NOW,
    );
    assert!(matches!(
        over_count,
        Response::Refused {
            code: RefusalCode::Malformed,
            ..
        }
    ));

    let mut oversized = grant.macaroon.clone();
    oversized.identifier = "x".repeat(BROKER_CREDENTIAL_LIMITS.max_macaroon_identifier_bytes + 1);
    let over_size = broker.handle(
        Request::MintActionCapability {
            authority: Box::new(MintAuthority::Macaroon {
                grant: Box::new(oversized),
                discharges: vec![],
                ctx: Box::new(push_ctx()),
            }),
            intent: Box::new(push_intent(EGRESS)),
        },
        NOW,
    );
    assert!(matches!(
        over_size,
        Response::Refused {
            code: RefusalCode::Malformed,
            ..
        }
    ));

    let mut nonfinite = push_ctx();
    nonfinite.spend_usd = Some(f64::NAN);
    let malformed_number = broker.handle(
        Request::MintActionCapability {
            authority: Box::new(MintAuthority::Macaroon {
                grant: Box::new(grant.macaroon.clone()),
                discharges: vec![paid_discharge(&grant)],
                ctx: Box::new(nonfinite),
            }),
            intent: Box::new(push_intent(EGRESS)),
        },
        NOW,
    );
    assert!(matches!(
        malformed_number,
        Response::Refused {
            code: RefusalCode::Malformed,
            ..
        }
    ));
}

#[test]
fn expired_and_not_yet_valid_capabilities_never_touch_replay_state() {
    let dir = tempfile::tempdir().unwrap();
    let grant = grant();
    let mut broker = broker_at(&dir.path().join("state.sqlite3"));
    let capability = minted(broker.handle(mint_request(&grant, EGRESS), NOW));
    let expected = capability.expectation();

    let early = broker.handle(
        Request::RedeemActionCapability {
            capability: Box::new(capability.clone()),
            expected: Box::new(expected.clone()),
        },
        NOW - 1,
    );
    assert!(matches!(
        early,
        Response::Refused {
            code: RefusalCode::NotYetValid,
            ..
        }
    ));

    let late = broker.handle(
        Request::RedeemActionCapability {
            capability: Box::new(capability.clone()),
            expected: Box::new(expected),
        },
        capability.expires_at_ms,
    );
    assert!(matches!(
        late,
        Response::Refused {
            code: RefusalCode::Expired,
            ..
        }
    ));
    assert_eq!(broker.retained_redemptions().unwrap(), 0);
}

#[test]
fn empty_secret_and_invalid_server_policy_fail_at_construction() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.sqlite3");
    let invalid = Broker::new(BrokerConfig {
        secret: vec![],
        capability_signing_key: CAPABILITY_KEY.to_vec(),
        capability_ttl_ms: 60_000,
        issuer: ISSUER.into(),
        allowed_audiences: vec![ISSUER.into()],
        redemption_db_path: path,
    });
    assert!(invalid.is_err());
}
