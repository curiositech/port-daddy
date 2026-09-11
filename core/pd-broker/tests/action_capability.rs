//! Public wire-contract tests for the generalized action capability.

use pd_broker::capability::{
    action_digest, push_resource_digest, resource_digest, ActionCapability, ActionIntent,
    CredentialProvenance, CredentialProvenanceKind, ACTION_CAPABILITY_DOMAIN,
    ACTION_CAPABILITY_LIMITS, ACTION_CAPABILITY_SCHEMA_VERSION,
};

fn structural_capability() -> ActionCapability {
    let resource = push_resource_digest("curiositech/port-daddy", "feat/capability").unwrap();
    ActionCapability {
        schema_version: ACTION_CAPABILITY_SCHEMA_VERSION,
        domain: ACTION_CAPABILITY_DOMAIN.into(),
        issuer: "port-daddy:broker".into(),
        audience: "port-daddy:git-egress".into(),
        operation: "push".into(),
        actor: "01K3YR6M1WPZB8Q6V1J8K7D4MC".into(),
        harbor: "curiositech/port-daddy".into(),
        tenant: "curiositech".into(),
        action_digest: action_digest(
            "push",
            "01K3YR6M1WPZB8Q6V1J8K7D4MC",
            "curiositech/port-daddy",
            "curiositech",
            &resource,
        )
        .unwrap(),
        resource_digest: resource,
        not_before_ms: 1_000,
        expires_at_ms: 2_000,
        nonce: "ab".repeat(32),
        credential_provenance: CredentialProvenance {
            kind: CredentialProvenanceKind::Macaroon,
            credential_digest: resource_digest("test/credential/v1", &["grant-1"]).unwrap(),
        },
        tag_hex: "cd".repeat(32),
    }
}

#[test]
fn wire_contract_carries_every_bound_claim_and_no_legacy_scope() {
    let serialized = serde_json::to_value(structural_capability()).unwrap();
    for field in [
        "schema_version",
        "domain",
        "issuer",
        "audience",
        "operation",
        "actor",
        "harbor",
        "tenant",
        "resource_digest",
        "action_digest",
        "not_before_ms",
        "expires_at_ms",
        "nonce",
        "credential_provenance",
        "tag_hex",
    ] {
        assert!(serialized.get(field).is_some(), "missing {field}");
    }
    for stale in ["scope", "op", "repo", "branch", "session"] {
        assert!(
            serialized.get(stale).is_none(),
            "legacy field survived: {stale}"
        );
    }
}

#[test]
fn capability_and_intent_reject_unknown_compatibility_fields() {
    let mut value = serde_json::to_value(structural_capability()).unwrap();
    value
        .as_object_mut()
        .unwrap()
        .insert("ticket_scope".into(), serde_json::json!({"repo":"other"}));
    assert!(serde_json::from_value::<ActionCapability>(value).is_err());

    let intent = serde_json::json!({
        "audience": "port-daddy:git-egress",
        "operation": "push",
        "resource_digest": push_resource_digest("a/b", "feat/x").unwrap(),
        "actor": "self-asserted"
    });
    assert!(serde_json::from_value::<ActionIntent>(intent).is_err());
}

#[test]
fn public_debug_never_renders_bearer_or_provenance_material() {
    let capability = structural_capability();
    let tag = capability.tag_hex.clone();
    let provenance = capability.credential_provenance.credential_digest.clone();
    let debug = format!("{capability:?}");
    assert!(!debug.contains(&tag));
    assert!(!debug.contains(&provenance));
    assert!(debug.contains("<redacted>"));
}

#[test]
fn digest_domains_and_field_order_are_non_interchangeable() {
    let push = push_resource_digest("a/b", "feat/x").unwrap();
    let reversed = resource_digest(
        pd_broker::capability::PUSH_RESOURCE_DIGEST_DOMAIN,
        &["feat/x", "a/b"],
    )
    .unwrap();
    let foreign_domain = resource_digest("other/protocol/v1", &["a/b", "feat/x"]).unwrap();
    assert_ne!(push, reversed);
    assert_ne!(push, foreign_domain);
}

#[test]
fn limits_are_fixed_and_inspectable() {
    assert_eq!(ACTION_CAPABILITY_LIMITS.nonce_hex_bytes, 64);
    assert_eq!(ACTION_CAPABILITY_LIMITS.tag_hex_bytes, 64);
    assert_eq!(ACTION_CAPABILITY_LIMITS.max_resource_fields, 16);
    assert_eq!(ACTION_CAPABILITY_LIMITS.max_identity_bytes, 256);
}
