//! Kernel-held key custody for push grants (ADR-0057 / DOM DADDY enforcement).
//!
//! The root and caveat (discharge) keys for every push grant are generated
//! HERE, inside the kernel, and NEVER cross the FFI boundary. The daemon asks
//! the kernel to *issue a grant*, *issue a discharge* (only when rent is paid),
//! or *authorize a push* — it never receives the forging material. So a
//! compromised daemon, or an agent sharing the daemon's process memory, cannot
//! read a key out of the daemon and mint its own discharge: the only way to get
//! a discharge is to ask the kernel, and the kernel only mints one when the
//! verdict is `Paid`.
//!
//! This is the custody half of the teeth. Two further hardenings are explicit
//! follow-ons (see ADR-0057 enforcement slices):
//!   - the rent **verdict** is still supplied by the (in-process) daemon here;
//!     making it a signed attestation the kernel verifies removes the daemon's
//!     ability to simply assert `Paid`.
//!   - running the kernel as a **separate-UID process** removes the daemon's
//!     ability to be compromised into calling `issue_discharge` at all.
//!
//! Storage is a process-global in-memory map: durable across calls within a
//! daemon lifetime, NOT across a restart. Push grants are short-lived (20 min),
//! so a restart simply forces re-issuance. Persisting the custody store behind a
//! kernel-held master key is a later durability slice.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::macaroon::{
    discharge_rent_paid, mint_push_grant, verify, check_caveat, Macaroon, MacaroonError,
    MintPushGrant, RentVerdict, RequestContext, VerifyOutcome, DISCHARGE_TTL_MS,
};

struct GrantKeys {
    root_key: Vec<u8>,
    caveat_key: Vec<u8>,
    rent_caveat_id: String,
    revoked: bool,
}

/// Process-global custody store. `Mutex<Option<..>>` is const-constructible so it
/// needs no lazy-init crate; the map is created on first use.
static STORE: Mutex<Option<HashMap<String, GrantKeys>>> = Mutex::new(None);

fn with_store<R>(f: impl FnOnce(&mut HashMap<String, GrantKeys>) -> R) -> R {
    // Recover from a poisoned lock rather than panic: the kernel must not unwind
    // (no-panic across the FFI boundary). Recovery is sound here because the
    // guarded value is only a HashMap<String, GrantKeys> — `insert`/`remove` move
    // whole, fully-constructed values, so a panic can't leave a torn entry with a
    // half-written key (safe Rust has no partial struct writes). The worst a poison
    // means is "some prior op panicked"; the key map itself is consistent. (PR #496
    // review finding — contested: into_inner() is the correct no-panic choice.)
    let mut guard = STORE.lock().unwrap_or_else(|p| p.into_inner());
    f(guard.get_or_insert_with(HashMap::new))
}

/// 32 cryptographically-random bytes from the OS CSPRNG.
fn rand_bytes(n: usize) -> Result<Vec<u8>, MacaroonError> {
    let mut b = vec![0u8; n];
    getrandom::getrandom(&mut b).map_err(|e| MacaroonError::Rng(e.to_string()))?;
    Ok(b)
}

/// Issue a push grant. The kernel generates the root + caveat keys, mints the
/// grant, **retains both keys internally**, and returns only the grant macaroon
/// and its grant id. The daemon never sees a key.
pub fn issue_grant(
    repo: &str,
    session: &str,
    expires_ms: i64,
    protected_branch: &str,
) -> Result<(Macaroon, String), MacaroonError> {
    let root_key = rand_bytes(32)?;
    let caveat_key = rand_bytes(32)?;
    let grant_id = hex::encode(rand_bytes(16)?);
    let rent_nonce = hex::encode(rand_bytes(8)?);

    let pg = mint_push_grant(MintPushGrant {
        root_key: &root_key,
        grant_id: &grant_id,
        repo,
        session,
        expires_ms,
        caveat_key: caveat_key.clone(),
        rent_nonce: &rent_nonce,
        protected_branch,
    })?;

    with_store(|m| {
        m.insert(
            grant_id.clone(),
            GrantKeys { root_key, caveat_key, rent_caveat_id: pg.rent_caveat_id, revoked: false },
        )
    });
    Ok((pg.macaroon, grant_id))
}

/// Issue a discharge for a stored grant — ONLY when the verdict is `Paid`. The
/// caveat key is read from the kernel store, never supplied by the caller. An
/// unknown, revoked, or non-`Paid` grant yields `None` (no discharge), which the
/// gate treats as "not authorized".
pub fn issue_discharge(
    grant_id: &str,
    verdict: RentVerdict,
    now_ms: i64,
    ttl_ms: i64,
) -> Result<Option<Macaroon>, MacaroonError> {
    with_store(|m| match m.get(grant_id) {
        Some(keys) if !keys.revoked => {
            discharge_rent_paid(&keys.caveat_key, &keys.rent_caveat_id, verdict, now_ms, ttl_ms)
        }
        _ => Ok(None),
    })
}

/// Authorize a push: verify the presented grant + discharges using the kernel's
/// retained root and caveat keys (looked up by the grant's own identifier). The
/// daemon supplies only the request context (op/repo/branch/session/clock) — not
/// the keys.
pub fn authorize(
    grant: &Macaroon,
    discharges: &[Macaroon],
    ctx: &RequestContext,
) -> VerifyOutcome {
    with_store(|m| match m.get(&grant.identifier) {
        Some(keys) if !keys.revoked => {
            // Clone what the verify closures need so we don't hold the lock guard
            // inside the recursive verifier longer than necessary.
            let root = keys.root_key.clone();
            let ckey = keys.caveat_key.clone();
            let rent_id = keys.rent_caveat_id.clone();
            verify(
                grant,
                &root,
                discharges,
                &|p| check_caveat(p, ctx),
                &|cid| if cid == rent_id { Some(ckey.clone()) } else { None },
            )
        }
        Some(_) => VerifyOutcome { ok: false, reason: "grant has been revoked".into() },
        None => VerifyOutcome { ok: false, reason: "unknown grant".into() },
    })
}

/// Hard revocation: drop a grant's keys. Every macaroon under it instantly fails
/// to authorize (the root key is gone), and no further discharge can be issued.
pub fn revoke(grant_id: &str) -> bool {
    with_store(|m| m.remove(grant_id).is_some())
}

/// Default discharge lifetime, re-exported for callers/FFI.
pub const DEFAULT_DISCHARGE_TTL_MS: i64 = DISCHARGE_TTL_MS;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::macaroon::RequestContext;

    fn ctx(branch: &str, session: &str, now_ms: i64) -> RequestContext {
        RequestContext {
            op: Some("push".into()),
            repo: Some("acme/api".into()),
            branch: Some(branch.into()),
            host: None,
            spend_usd: None,
            session: Some(session.into()),
            now_ms,
        }
    }

    #[test]
    fn paid_rent_authorizes_a_push() {
        let now = 1_000_000;
        let (grant, id) =
            issue_grant("acme/api", "sess-1", now + 60_000, "main").unwrap();
        let discharge = issue_discharge(&id, RentVerdict::Paid, now, DISCHARGE_TTL_MS)
            .unwrap()
            .expect("paid rent must yield a discharge");
        let bound = grant.prepare_for_request(&discharge).unwrap();
        let out = authorize(&grant, &[bound], &ctx("feat/x", "sess-1", now));
        assert!(out.ok, "paid + bound discharge must authorize: {}", out.reason);
    }

    #[test]
    fn unpaid_rent_yields_no_discharge_so_push_is_refused() {
        let now = 1_000_000;
        let (grant, id) =
            issue_grant("acme/api", "sess-2", now + 60_000, "main").unwrap();
        // Rent due → no discharge at all.
        assert!(issue_discharge(&id, RentVerdict::RentDue, now, DISCHARGE_TTL_MS)
            .unwrap()
            .is_none());
        // With no discharge, the third-party rent caveat can't be satisfied.
        let out = authorize(&grant, &[], &ctx("feat/x", "sess-2", now));
        assert!(!out.ok, "no discharge must refuse the push");
    }

    #[test]
    fn protected_branch_is_refused_even_when_paid() {
        let now = 1_000_000;
        let (grant, id) =
            issue_grant("acme/api", "sess-3", now + 60_000, "main").unwrap();
        let discharge =
            issue_discharge(&id, RentVerdict::Paid, now, DISCHARGE_TTL_MS).unwrap().unwrap();
        let bound = grant.prepare_for_request(&discharge).unwrap();
        let out = authorize(&grant, &[bound], &ctx("main", "sess-3", now));
        assert!(!out.ok, "push to the protected branch must be refused");
    }

    #[test]
    fn keys_never_leave_the_kernel_and_revoke_kills_the_grant() {
        let now = 1_000_000;
        let (grant, id) =
            issue_grant("acme/api", "sess-4", now + 60_000, "main").unwrap();
        let discharge =
            issue_discharge(&id, RentVerdict::Paid, now, DISCHARGE_TTL_MS).unwrap().unwrap();
        let bound = grant.prepare_for_request(&discharge).unwrap();
        assert!(authorize(&grant, &[bound.clone()], &ctx("feat/x", "sess-4", now)).ok);
        assert!(revoke(&id));
        // After revocation the root key is gone — the same grant no longer authorizes.
        let out = authorize(&grant, &[bound], &ctx("feat/x", "sess-4", now));
        assert!(!out.ok, "revoked grant must not authorize");
        assert!(issue_discharge(&id, RentVerdict::Paid, now, DISCHARGE_TTL_MS).unwrap().is_none());
    }
}
