//! Bounded verification of the production post-decoding policy and capability
//! predicates. No cryptographic, base64, JSON, or policy-function stubs are used.
//! All cover properties are required to be SATISFIED by CI, not merely printed.

use super::*;

fn claims(hv: i64, iat: i64, exp: i64, nbf: Option<i64>) -> HarborCardClaims {
    HarborCardClaims {
        hv,
        sub: String::new(),
        iss: String::new(),
        aud: String::new(),
        exp,
        nbf,
        iat,
        jti: String::new(),
        cap: Vec::new(),
    }
}

/// Every i64 version/timestamp, including clock-skew saturation at i64::MAX.
/// The oracle uses widened arithmetic, not the implementation's saturating add.
#[kani::proof]
fn proof_decoded_claims_policy() {
    let (hv, iat, exp, now): (i64, i64, i64, i64) = kani::any();
    let nbf: Option<i64> = kani::any();
    let c = claims(hv, iat, exp, nbf);
    let actual = validate_decoded_claims(&c, now);
    let expected = hv == 2
        && iat <= exp
        && (iat as i128) <= (now as i128) + 60
        && now <= exp
        && nbf.map_or(true, |t| t == 0 || t <= now);
    assert_eq!(
        actual.is_ok(),
        expected,
        "decoded policy matches temporal contract"
    );
    kani::cover!(actual.is_ok(), "decoded claims accepted");
    kani::cover!(
        matches!(actual, Err(HarborError::WrongVersion { .. })),
        "wrong version rejected"
    );
    kani::cover!(
        matches!(actual, Err(HarborError::Malformed)),
        "incoherent lifetime rejected"
    );
    kani::cover!(
        matches!(actual, Err(HarborError::IssuedInFuture)),
        "future issue rejected"
    );
    kani::cover!(
        matches!(actual, Err(HarborError::Expired)),
        "expired claims rejected"
    );
    kani::cover!(
        matches!(actual, Err(HarborError::NotYetValid)),
        "not-before rejected"
    );
    kani::cover!(
        actual.is_ok() && now == i64::MAX,
        "saturating clock boundary accepted"
    );
}

fn cap() -> CapabilityEntry {
    CapabilityEntry {
        op: kani_claims_domain::operation(kani::any()),
        channel: kani_claims_domain::pattern(kani::any()),
        rate_per_min: kani::any(),
        max_payload_bytes: kani::any(),
    }
}

/// One decoded grant, the finite grammar above, arbitrary u64/absent ceilings,
/// and arbitrary i64 timestamps. Acceptance is conditional on authentication;
/// the requested operation is pub or sub and the channel is a concrete name
/// from `kani_claims_domain::channel` (which includes `*` and `a*` as names).
#[kani::proof]
#[kani::unwind(16)]
fn proof_decoded_channel_authority() {
    let (iat, exp, now): (i64, i64, i64) = kani::any();
    let mut c = claims(2, iat, exp, None);
    c.cap.push(cap());
    let requested_op = if kani::any() { "pub" } else { "sub" };
    let channel = kani_claims_domain::channel(kani::any());
    let policy_ok = validate_decoded_claims(&c, now).is_ok();
    let grant = capability_matches(&c.cap, requested_op, channel);
    // Enumerated by hand over the eight channels, independently of the matcher.
    let channel_ok = match c.cap[0].channel.as_str() {
        "*" => true,
        "a*" => matches!(channel, "a" | "ab" | "aba" | "a*"),
        "ab*" => matches!(channel, "ab" | "aba"),
        "b*" => matches!(channel, "b" | "ba"),
        "**" => channel == "*",
        "a**" => channel == "a*",
        literal => literal == channel,
    };
    let expected = (c.cap[0].op == "admin" || c.cap[0].op == requested_op) && channel_ok;
    assert_eq!(grant.is_some(), expected);
    if let Some(selected) = grant {
        assert_eq!(selected, &c.cap[0]);
    }
    kani::cover!(policy_ok && grant.is_some(), "decoded channel accepted");
    kani::cover!(
        policy_ok && grant.is_none(),
        "unauthorised channel rejected"
    );
    kani::cover!(
        !policy_ok && grant.is_some(),
        "capability cannot rescue invalid lifetime"
    );
}

/// Does every (op, channel) request `child` grants also succeed against `parent`?
fn grants_within(
    parent: &[CapabilityEntry],
    child: &[CapabilityEntry],
    op: &str,
    channel: &str,
) -> bool {
    capability_matches(child, op, channel).is_none()
        || capability_matches(parent, op, channel).is_some()
}

/// Two delegations, one structured grant at each hop, the finite operation and
/// pattern grammar above, and arbitrary u64/absent ceilings. The proof checks
/// transitivity of the existing structured subset predicate, and that every
/// subset it accepts grants no request its parent refuses, for any operation
/// and any channel in the domain. It is not a deployed signed-chain verifier
/// (the crate does not implement one).
#[kani::proof]
#[kani::unwind(16)]
fn proof_decoded_delegation_two_hops() {
    let root = [cap()];
    let child = [cap()];
    let leaf = [cap()];
    let first = verify_capability_subset_structured(&root, &child);
    let second = verify_capability_subset_structured(&child, &leaf);
    let direct = verify_capability_subset_structured(&root, &leaf);
    assert!(!(first && second) || direct);
    let requested_op = kani_claims_domain::operation(kani::any());
    let channel = kani_claims_domain::channel(kani::any());
    assert!(
        !first || grants_within(&root, &child, &requested_op, channel),
        "attenuated grant stays inside its parent"
    );
    assert!(
        !second || grants_within(&child, &leaf, &requested_op, channel),
        "attenuated grant stays inside its parent"
    );
    assert!(
        !direct || grants_within(&root, &leaf, &requested_op, channel),
        "attenuated grant stays inside its parent"
    );
    if first && second {
        if let Some(ceiling) = root[0].rate_per_min {
            assert!(
                leaf[0].rate_per_min.is_some_and(|value| value <= ceiling),
                "rate ceiling preserved"
            );
        }
        if let Some(ceiling) = root[0].max_payload_bytes {
            assert!(leaf[0]
                .max_payload_bytes
                .is_some_and(|value| value <= ceiling));
        }
    }
    kani::cover!(first && second, "two attenuating hops accepted");
    kani::cover!(first && !second, "second-hop escalation rejected");
    kani::cover!(
        first && direct && !second,
        "root-only check misses re-escalation"
    );
    kani::cover!(
        first && second && root[0].rate_per_min.is_some(),
        "bounded rate survives both hops"
    );
    kani::cover!(
        first && second && root[0].max_payload_bytes.is_some(),
        "bounded payload survives both hops"
    );
}

/// The flat-string FFI contract: up to two entries on either side, over four
/// one-byte opaque rights. Duplicates and empty lists are included. This is
/// independent of the structured hv:2 grammar.
#[kani::proof]
#[kani::unwind(8)]
fn proof_capability_attenuation() {
    let ids: [u8; 4] = kani::any();
    let names: [String; 4] = ids.map(|id| String::from_utf8(vec![b'a' + (id & 3)]).unwrap());
    let root_len = (kani::any::<u8>() % 3) as usize;
    let child_len = (kani::any::<u8>() % 3) as usize;
    let root = &names[..root_len];
    let child = &names[2..2 + child_len];
    let mut root_mask = 0u8;
    let mut child_mask = 0u8;
    for i in 0..root_len {
        root_mask |= 1 << (ids[i] & 3);
    }
    for i in 0..child_len {
        child_mask |= 1 << (ids[i + 2] & 3);
    }
    let actual = HarborCardVerifier::verify_capability_subset(root, child);
    assert_eq!(actual, child_mask & !root_mask == 0);
    kani::cover!(
        actual && !child.is_empty(),
        "nonempty flat attenuation accepted"
    );
    kani::cover!(!actual, "flat escalation rejected");
}
