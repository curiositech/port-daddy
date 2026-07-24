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

/// The custody record for one push grant: the two secrets the kernel keeps and
/// never surrenders, plus the caveat id they discharge.
///
/// Kept deliberately private — nothing outside this module can name the type, so
/// the only way to touch a key is through the four `pub fn`s below, which is the
/// whole point of custody. `revoked` supports a soft "revoked but still present"
/// state, though [`revoke`] currently prefers hard removal (dropping the whole
/// entry) as the stronger guarantee.
struct GrantKeys {
    /// Root key seeding the grant macaroon's HMAC chain. Whoever holds it can mint
    /// or re-sign, so it lives only here.
    root_key: Vec<u8>,
    /// Discharge root key for the grant's third-party rent caveat. Used by
    /// [`issue_discharge`] to mint discharges; never returned to a caller.
    caveat_key: Vec<u8>,
    /// The rent caveat's id, so the verifier's resolver can match the caveat to
    /// its key during [`authorize`].
    rent_caveat_id: String,
    /// Soft-revocation marker checked by [`issue_discharge`] and [`authorize`].
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

/// 32 (or `n`) cryptographically-random bytes drawn from the OS CSPRNG.
///
/// Every key and identifier the kernel mints starts here. We go through
/// [`getrandom`] rather than a userspace PRNG so entropy comes straight from the
/// operating system (`getrandom(2)` / `/dev/urandom` / `arc4random`) — there is
/// no seed for a compromised daemon to guess or replay. On the rare event the OS
/// source is unavailable this returns [`MacaroonError::Rng`] rather than falling
/// back to weak randomness: a key we could not generate securely is one we refuse
/// to generate at all (fail closed).
fn rand_bytes(n: usize) -> Result<Vec<u8>, MacaroonError> {
    let mut b = vec![0u8; n];
    getrandom::getrandom(&mut b).map_err(|e| MacaroonError::Rng(e.to_string()))?;
    Ok(b)
}

/// Issue a push grant, retaining its keys inside the kernel.
///
/// The kernel generates fresh root and caveat (discharge) keys, mints the grant
/// macaroon over them via [`mint_push_grant`], stores **both keys** in the
/// process-global custody map keyed by a random `grant_id`, and returns only the
/// grant macaroon plus that id. The forging material never crosses back to the
/// caller.
///
/// # Why it exists
///
/// This is the custody half of the DOM DADDY teeth (ADR-0057). Because the daemon
/// receives a macaroon but never a key, a compromised daemon — or an agent
/// sharing its process memory — cannot mint its own rent discharge: the only path
/// to a discharge is [`issue_discharge`], and that mints one only on a `Paid`
/// verdict. The grant carries five non-negotiable first-party caveats
/// (`op=push`, `repo`, deny-`protected_branch`, hard `expires`, `session`) plus a
/// single third-party rent caveat, all baked in by [`mint_push_grant`].
///
/// # Failure contract
///
/// Fails closed. Returns [`MacaroonError`] only if the OS CSPRNG is unavailable
/// (see the private `rand_bytes`) or minting fails; on error no entry is stored, so there is
/// no half-created grant to leak. Never panics. Grants live only in memory, so a
/// daemon restart drops every grant and forces re-issuance — acceptable because
/// grants are short-lived (typically 20 minutes).
///
/// # Example
///
/// ```
/// use pd_anchor::keystore::{issue_grant, issue_discharge, authorize, DEFAULT_DISCHARGE_TTL_MS};
/// use pd_anchor::macaroon::{RentVerdict, RequestContext};
///
/// // A synthetic verification clock (unix ms). Real callers pass wall-clock time.
/// let now = 1_000_000;
/// let (grant, grant_id) = issue_grant("acme/api", "sess-1", now + 60_000, "main").unwrap();
///
/// // The daemon holds `grant` and `grant_id`, but no key — it must ASK the kernel
/// // for a discharge, which is only granted when rent is Paid.
/// let discharge = issue_discharge(&grant_id, RentVerdict::Paid, now, DEFAULT_DISCHARGE_TTL_MS)
///     .unwrap()
///     .expect("paid rent yields a discharge");
/// let bound = grant.prepare_for_request(&discharge).unwrap();
///
/// let ctx = RequestContext {
///     op: Some("push".into()),
///     repo: Some("acme/api".into()),
///     branch: Some("feat/x".into()),   // NOT the protected `main`
///     session: Some("sess-1".into()),
///     now_ms: now,
///     ..Default::default()
/// };
/// assert!(authorize(&grant, &[bound], &ctx).ok);
/// ```
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

/// Mint a rent discharge for a stored grant — but ONLY when the verdict is `Paid`.
///
/// Looks up the grant by id, reads its caveat key **from the kernel store** (never
/// from the caller), and delegates to [`discharge_rent_paid`], which mints a
/// short-lived discharge macaroon only on [`RentVerdict::Paid`]. Any other verdict
/// — or an unknown or revoked grant — yields `Ok(None)`, i.e. no discharge, which
/// the push gate treats as "not authorized".
///
/// # Why it exists
///
/// This is the single choke point where a *policy verdict* becomes *cryptographic
/// authority*. The daemon cannot mint a discharge itself (it has no key), so the
/// question "is this session's coordination rent paid?" is answered exactly once,
/// here, and only a `Paid` answer produces a credential. That is what makes
/// unpaid-rent bypass impossible rather than merely discouraged.
///
/// # Failure contract
///
/// Fails closed on every axis: unknown grant → `None`, revoked grant → `None`,
/// non-`Paid` verdict → `None`. The returned discharge itself carries an `expires`
/// caveat `ttl_ms` in the future, so even a leaked discharge dies at the TTL. Never
/// panics; an `Err` is only propagated from the underlying mint.
///
/// # Example
///
/// ```
/// use pd_anchor::keystore::{issue_grant, issue_discharge, DEFAULT_DISCHARGE_TTL_MS};
/// use pd_anchor::macaroon::RentVerdict;
///
/// let now = 1_000_000;
/// let (_grant, id) = issue_grant("acme/api", "sess-2", now + 60_000, "main").unwrap();
///
/// // Rent Paid → a discharge is minted.
/// assert!(issue_discharge(&id, RentVerdict::Paid, now, DEFAULT_DISCHARGE_TTL_MS)
///     .unwrap()
///     .is_some());
///
/// // Rent due → no discharge at all, so no push can be authorized.
/// assert!(issue_discharge(&id, RentVerdict::RentDue, now, DEFAULT_DISCHARGE_TTL_MS)
///     .unwrap()
///     .is_none());
///
/// // Unknown grant id → also None (fail closed).
/// assert!(issue_discharge("no-such-grant", RentVerdict::Paid, now, DEFAULT_DISCHARGE_TTL_MS)
///     .unwrap()
///     .is_none());
/// ```
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

/// Authorize a push against a stored grant, using the kernel's retained keys.
///
/// Looks the grant up by `grant.identifier`, then calls [`verify`] with the
/// kernel-held root key and a caveat-key resolver closed over the kernel-held
/// caveat key. The caller supplies only the presented discharges and the
/// [`RequestContext`] (op / repo / branch / session / clock) — never a key. The
/// keys are cloned out of the lock before the recursive verifier runs so the
/// custody mutex is not held across verification.
///
/// # Why it exists
///
/// Verification must happen where the keys live. If the daemon held the root key it
/// could forge or re-sign; because the root key is here and never leaves,
/// authorization is the only operation that can consult it. An unknown grant, or a
/// grant whose keys were dropped by [`revoke`], returns a non-`ok` outcome — the
/// root key is simply gone, so nothing can be verified against it.
///
/// # Failure contract
///
/// Returns a [`VerifyOutcome`], never a `Result`, and never panics: a failed check
/// is data (`ok: false` with a `reason`), not an error. Fails closed for an unknown
/// grant (`"unknown grant"`), a revoked grant (`"grant has been revoked"`), a
/// missing/stale/unbound discharge, an expired grant, or a push to the protected
/// branch. Only an exact match on every caveat — including a live, request-bound
/// rent discharge — yields `ok: true`.
///
/// # Example
///
/// See [`issue_grant`] for a full issue → discharge → authorize round trip.
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

/// Hard revocation: drop a grant's keys from the custody store.
///
/// Removes the grant's entry — root key, caveat key, and all. Returns `true` if a
/// grant was removed, `false` if the id was unknown (idempotent: revoking twice is
/// safe and simply returns `false` the second time).
///
/// # Why it exists
///
/// Revocation here is *deletion of the secret*, not a flag on a still-usable key.
/// Once the root key is gone there is nothing left to verify a presented macaroon
/// against, so every outstanding grant macaroon and every discharge under it
/// instantly stops authorizing (see [`authorize`], which returns `"unknown grant"`
/// after removal), and no future discharge can be minted (see [`issue_discharge`]).
/// This is strictly stronger than a revocation list: there is no window in which a
/// leaked-but-revoked key still works.
///
/// # Failure contract
///
/// Never fails and never panics. Purely local to this daemon's in-memory store.
///
/// # Example
///
/// ```
/// use pd_anchor::keystore::{issue_grant, revoke, authorize};
/// use pd_anchor::macaroon::RequestContext;
///
/// let (grant, id) = issue_grant("acme/api", "sess-3", 2_000_000, "main").unwrap();
/// assert!(revoke(&id));   // keys dropped
/// assert!(!revoke(&id));  // idempotent: already gone
///
/// // With the root key gone, the same grant no longer authorizes.
/// let ctx = RequestContext { now_ms: 1_000_000, ..Default::default() };
/// assert!(!authorize(&grant, &[], &ctx).ok);
/// ```
pub fn revoke(grant_id: &str) -> bool {
    with_store(|m| m.remove(grant_id).is_some())
}

/// Default discharge lifetime (20 minutes), re-exported from [`crate::macaroon`] so
/// callers and the FFI layer can reference one canonical TTL without reaching into
/// the `macaroon` module. See [`DISCHARGE_TTL_MS`] for the source constant.
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
