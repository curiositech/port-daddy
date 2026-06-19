//! Macaroon discharge gate — the kernel-side capability primitive (ADR-0053).
//!
//! A **macaroon** (Birgisson et al., 2014, "Macaroons: Cookies with Contextual
//! Caveats") is a bearer credential whose authority can only ever *narrow*: the
//! holder appends caveats, each folded into a chained HMAC, so a removed or
//! tampered caveat breaks the signature. The root key that seeds the chain never
//! leaves the daemon, so a holder can present-and-verify but can neither mint nor
//! re-sign.
//!
//! This is the Rust analogue of the TypeScript `lib/macaroon` library, living in
//! the kernel where `pd-anchor` already enforces attenuate-but-never-broaden for
//! Ed25519 capability cards. Cards prove *who you are*; macaroons gate *what a
//! push/API-call may do, only while coordination rent is paid* — the one
//! third-party caveat ("the daemon attests rent-paid for session S") is the
//! compulsion, discharged only when the lease is current.
//!
//! Trust model: the daemon is BOTH the verifier and the key-holder. So a
//! third-party caveat's verification id (`vid`) is a binding HMAC *commitment* to
//! the discharge key (`vid = HMAC(chain_sig, caveat_key)`) rather than an AEAD
//! sealing of it — the verifier already holds the caveat key (keyed by caveat id
//! in its store) and recomputes the commitment to bind it into the chain. This
//! needs only HMAC-SHA256, no AEAD. Verification is **per-hop** (each discharge
//! checked against the key committed at its own caveat, then bound to the root
//! macaroon's signature) rather than a naive final-vs-root comparison.
//!
//! Proof status (honest, per the 2026-06-15 red-team round): the **per-hop
//! discipline** is the macaroon analogue of the card result on
//! `defense/anchor-attenuation-soundness` (`analyses/harbor_card_v6→v7.pv`, where
//! the naive final-vs-root verifier is shown unsound for Ed25519 capability cards
//! — a *different* construction). The **discharge construction this module ships**
//! — the HMAC-commitment `vid`, the discharge macaroon, and the request-binding
//! `HMAC(BIND0, root_sig || discharge_sig)` — is modelled and machine-checked in
//! `analyses/macaroon_discharge_v1.pv`: Q1 (no authorization without a daemon-issued
//! discharge bound to *that* grant; forgery and cross-grant transfer both fail) is
//! `true` under an active attacker. The per-hop-vs-naive *regression* (Q2) is in
//! `analyses/macaroon_discharge_v2_naive_unsound.pv`: a verifier that skips the
//! request-binding check is `false` (attack found) under cross-grant replay — that
//! is what justifies the binding check here. Residual gap (`defense:proofs`):
//! first-party caveat soundness + the MAX_DISCHARGE_DEPTH bound are not yet modelled.
//!
//! Honest scope: this makes the gate **unforgeable** and the audit a verifiable
//! transcript. It does **not** confine a malicious same-UID holder, who can copy
//! a live discharge inside its window — only Layer 3 (separate-UID/VM) does.

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use thiserror::Error;

type HmacSha256 = Hmac<Sha256>;

/// 32 zero bytes — the binding key for prepare-for-request (per libmacaroons).
const BIND_KEY: [u8; 32] = [0u8; 32];

fn hmac(key: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    // HMAC accepts a key of any length, so new_from_slice never errors here.
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts any key length");
    for p in parts {
        mac.update(p);
    }
    mac.finalize().into_bytes().into()
}

/// Constant-time equality for 32-byte MAC tags — no early return on first
/// differing byte, so verification does not leak the tag via timing.
fn ct_eq(a: &[u8; 32], b: &[u8; 32]) -> bool {
    let mut diff = 0u8;
    for i in 0..32 {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

/// One caveat. First-party caveats carry only `cid` (a predicate the verifier
/// checks locally). Third-party caveats additionally carry `vid` (the binding
/// commitment, hex) and `cl` (where to obtain the discharge).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Caveat {
    pub cid: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub vid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cl: Option<String>,
}

impl Caveat {
    fn is_third_party(&self) -> bool {
        self.vid.as_ref().is_some_and(|v| !v.is_empty())
    }

    /// The bytes folded into the chain for this caveat: `cid` for first-party,
    /// `vid || cid` for third-party.
    fn chain_bytes(&self) -> Result<Vec<u8>, MacaroonError> {
        if self.is_third_party() {
            let vid = self.vid.as_ref().expect("third-party caveat has vid");
            let mut bytes = decode_vid(vid)?.to_vec();
            bytes.extend_from_slice(self.cid.as_bytes());
            Ok(bytes)
        } else {
            Ok(self.cid.as_bytes().to_vec())
        }
    }
}

/// A macaroon. `signature_hex` is the running chained HMAC over all caveats.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Macaroon {
    /// Hint: who minted it / who to ask, e.g. `pd://daemon/<repo>`.
    pub location: String,
    /// Opaque grant id; maps to a root key held only by the minter.
    pub identifier: String,
    /// Ordered caveats, each HMAC-chained to the previous signature.
    pub caveats: Vec<Caveat>,
    /// Running signature (hex).
    pub signature_hex: String,
}

impl Macaroon {
    /// Mint a fresh macaroon. `root_key` is a high-entropy secret held only by
    /// the minter; the macaroon carries no copy of it.
    pub fn mint(
        root_key: &[u8],
        identifier: impl Into<String>,
        location: impl Into<String>,
    ) -> Self {
        let identifier = identifier.into();
        let sig = hmac(root_key, &[identifier.as_bytes()]);
        Self {
            location: location.into(),
            identifier,
            caveats: Vec::new(),
            signature_hex: hex::encode(sig),
        }
    }

    fn signature(&self) -> Result<[u8; 32], MacaroonError> {
        decode_sig(&self.signature_hex)
    }

    /// Append a first-party caveat (a predicate checked locally). One-directional:
    /// the chained signature makes adding possible and removal detectable.
    pub fn add_first_party_caveat(
        &self,
        predicate: impl Into<String>,
    ) -> Result<Macaroon, MacaroonError> {
        let predicate = predicate.into();
        let sig = hmac(&self.signature()?, &[predicate.as_bytes()]);
        let mut caveats = self.caveats.clone();
        caveats.push(Caveat {
            cid: predicate,
            vid: None,
            cl: None,
        });
        Ok(Macaroon {
            caveats,
            signature_hex: hex::encode(sig),
            ..self.clone()
        })
    }

    /// Append a third-party caveat. `caveat_key` becomes the root key of the
    /// discharge macaroon the daemon will mint; `caveat_id` is the opaque id the
    /// discharge service resolves. Only the minter calls this (it needs the key
    /// in the clear to compute the binding commitment).
    pub fn add_third_party_caveat(
        &self,
        caveat_key: &[u8],
        caveat_id: impl Into<String>,
        location: impl Into<String>,
    ) -> Result<Macaroon, MacaroonError> {
        let prev_sig = self.signature()?;
        let vid = hmac(&prev_sig, &[caveat_key]);
        let cav = Caveat {
            cid: caveat_id.into(),
            vid: Some(hex::encode(vid)),
            cl: Some(location.into()),
        };
        let sig = hmac(&prev_sig, &[&cav.chain_bytes()?]);
        let mut caveats = self.caveats.clone();
        caveats.push(cav);
        Ok(Macaroon {
            caveats,
            signature_hex: hex::encode(sig),
            ..self.clone()
        })
    }

    /// Bind a discharge macaroon to THIS root macaroon so it cannot be replayed
    /// against a different one. The holder calls this for every discharge before
    /// presenting.
    pub fn prepare_for_request(&self, discharge: &Macaroon) -> Result<Macaroon, MacaroonError> {
        let bound = hmac(&BIND_KEY, &[&self.signature()?, &discharge.signature()?]);
        Ok(Macaroon {
            signature_hex: hex::encode(bound),
            ..discharge.clone()
        })
    }
}

/// Outcome of a verification attempt.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifyOutcome {
    pub ok: bool,
    pub reason: String,
}

fn ok() -> VerifyOutcome {
    VerifyOutcome {
        ok: true,
        reason: "verified".into(),
    }
}
fn fail(reason: impl Into<String>) -> VerifyOutcome {
    VerifyOutcome {
        ok: false,
        reason: reason.into(),
    }
}

/// Verify a macaroon. Recomputes the chained signature from `root_key` hop by
/// hop; at each first-party caveat it calls `check_first_party(predicate)`; at
/// each third-party caveat it resolves the committed discharge key via
/// `resolve_caveat_key(caveat_id)`, confirms the binding commitment, finds the
/// matching discharge macaroon, and verifies it recursively — requiring the
/// discharge's signature to equal the request-bound value.
///
/// Both callbacks are supplied by the daemon: the caveat grammar
/// (`check_caveat`) and the discharge-key store, so this core stays agnostic.
pub fn verify(
    macaroon: &Macaroon,
    root_key: &[u8],
    discharges: &[Macaroon],
    check_first_party: &dyn Fn(&str) -> bool,
    resolve_caveat_key: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> VerifyOutcome {
    let root_bound_sig = match macaroon.signature() {
        Ok(s) => s,
        Err(_) => return fail("malformed root signature"),
    };
    verify_inner(
        macaroon,
        root_key,
        discharges,
        check_first_party,
        resolve_caveat_key,
        &root_bound_sig,
        0,
        true,
    )
}

/// Bound on discharge-chain recursion. Real chains are one level deep (a grant
/// with a single third-party rent caveat); this is a backstop so a malicious or
/// cyclic discharge set cannot drive unbounded recursion. A simple depth limit
/// (not a visited-set) avoids false "cycle" rejections when a legitimate chain
/// references the same discharge from sibling positions.
const MAX_DISCHARGE_DEPTH: usize = 16;

#[allow(clippy::too_many_arguments)]
fn verify_inner(
    macaroon: &Macaroon,
    root_key: &[u8],
    discharges: &[Macaroon],
    check_first_party: &dyn Fn(&str) -> bool,
    resolve_caveat_key: &dyn Fn(&str) -> Option<Vec<u8>>,
    root_bound_sig: &[u8; 32],
    depth: usize,
    is_root: bool,
) -> VerifyOutcome {
    if depth > MAX_DISCHARGE_DEPTH {
        return fail("discharge chain too deep (possible cycle)");
    }

    let presented = match macaroon.signature() {
        Ok(s) => s,
        Err(_) => return fail("malformed macaroon signature"),
    };

    let mut sig = hmac(root_key, &[macaroon.identifier.as_bytes()]);
    for cav in &macaroon.caveats {
        if cav.is_third_party() {
            let caveat_key = match resolve_caveat_key(&cav.cid) {
                Some(k) => k,
                None => return fail(format!("no discharge key for caveat \"{}\"", cav.cid)),
            };
            // Confirm the binding commitment ties this caveat key to the chain.
            let expected_vid = hmac(&sig, &[&caveat_key]);
            let vid = match cav.vid.as_ref().and_then(|v| decode_vid(v).ok()) {
                Some(v) => v,
                None => return fail(format!("malformed third-party vid for \"{}\"", cav.cid)),
            };
            if !ct_eq(&expected_vid, &vid) {
                return fail(format!(
                    "third-party caveat key mismatch for \"{}\"",
                    cav.cid
                ));
            }
            let discharge = match discharges.iter().find(|d| d.identifier == cav.cid) {
                Some(d) => d,
                None => return fail(format!("no discharge macaroon for caveat \"{}\"", cav.cid)),
            };
            let sub = verify_inner(
                discharge,
                &caveat_key,
                discharges,
                check_first_party,
                resolve_caveat_key,
                root_bound_sig,
                depth + 1,
                false,
            );
            if !sub.ok {
                return sub;
            }
            let bytes = match cav.chain_bytes() {
                Ok(b) => b,
                Err(_) => return fail("malformed caveat"),
            };
            sig = hmac(&sig, &[&bytes]);
        } else {
            if !check_first_party(&cav.cid) {
                return fail(format!("first-party caveat not satisfied: \"{}\"", cav.cid));
            }
            sig = hmac(&sig, &[cav.cid.as_bytes()]);
        }
    }

    // The root is checked against its own signature; a discharge against the
    // request-bound value (binding it to this exact root).
    let expected = if is_root {
        sig
    } else {
        hmac(&BIND_KEY, &[root_bound_sig, &sig])
    };
    if !ct_eq(&expected, &presented) {
        return fail(format!("signature mismatch on \"{}\"", macaroon.identifier));
    }
    ok()
}

fn decode_sig(hex_str: &str) -> Result<[u8; 32], MacaroonError> {
    decode_32(hex_str)
}
fn decode_vid(hex_str: &str) -> Result<[u8; 32], MacaroonError> {
    decode_32(hex_str)
}
fn decode_32(hex_str: &str) -> Result<[u8; 32], MacaroonError> {
    // Bound the length fail-fast: a 32-byte tag is 64 hex chars. Rejecting
    // oversize input early keeps a hostile macaroon from forcing a large decode.
    if hex_str.len() != 64 {
        return Err(MacaroonError::Malformed);
    }
    hex::decode(hex_str)?
        .try_into()
        .map_err(|_| MacaroonError::Malformed)
}

#[derive(Debug, Error)]
pub enum MacaroonError {
    #[error("malformed macaroon")]
    Malformed,
    #[error(transparent)]
    Hex(#[from] hex::FromHexError),
}

// ===========================================================================
// Appendix A §A.2 — the first-party caveat grammar
// ===========================================================================
//
// Caveats are predicates `<field> <op> <value>` over a small, fixed, daemon-
// controlled field set — a structured grammar, not free-text. Verification is
// conjunctive (every caveat must hold), which is what makes authority
// one-directional: appending `spend_usd <= 100` over an existing `<= 2` cannot
// broaden anything, because both must hold and the tighter bound wins.

/// The concrete facts of the request being authorized. A caveat predicate
/// either holds for this context or it does not.
#[derive(Clone, Debug, Default)]
pub struct RequestContext {
    pub op: Option<String>,
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub host: Option<String>,
    pub spend_usd: Option<f64>,
    pub session: Option<String>,
    /// Verification clock (unix ms) — injected, never read from the system clock
    /// inside the checker, so verification is deterministic and testable. MUST be
    /// set to a real time: `Default` leaves it 0, which the `expires` check
    /// treats as "no clock" and fails closed (an expired grant is rejected, never
    /// accidentally accepted).
    pub now_ms: i64,
}

// Caveat builders (the daemon mints the non-negotiable ones; the holder may
// attenuate further).
pub fn op_caveat(op: &str) -> String {
    format!("op = {op}")
}
pub fn repo_caveat(repo: &str) -> String {
    format!("repo = {repo}")
}
pub fn branch_caveat(glob: &str) -> String {
    format!("branch = {glob}")
}
pub fn deny_branch_caveat(name: &str) -> String {
    format!("branch != {name}")
}
pub fn host_caveat(fqdn: &str) -> String {
    format!("host = {fqdn}")
}
pub fn spend_ceiling_caveat(usd: f64) -> String {
    format!("spend_usd <= {usd:.2}")
}
pub fn expires_caveat(unix_ms: i64) -> String {
    format!("expires = {unix_ms}")
}
pub fn session_caveat(session: &str) -> String {
    format!("session = {session}")
}

/// Minimal glob matcher: only `*` is special (matches any run of characters).
/// Two-pointer with backtracking — no regex dependency.
fn glob_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0usize, 0usize);
    let (mut star, mut mark) = (None, 0usize);
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '*') {
            star = Some(pi);
            mark = ti;
            pi += 1;
        } else if pi < p.len() && p[pi] == t[ti] {
            pi += 1;
            ti += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

/// Evaluate a single caveat against a request context. Fail-closed: an
/// unparseable caveat, or one whose required context field is absent, is false.
pub fn check_caveat(predicate: &str, ctx: &RequestContext) -> bool {
    let mut it = predicate.split_whitespace();
    let field = match it.next() {
        Some(f) => f,
        None => return false,
    };
    let op = match it.next() {
        Some(o) => o,
        None => return false,
    };
    let value = it.collect::<Vec<_>>().join(" ");
    if value.is_empty() {
        return false;
    }
    match (field, op) {
        ("op", "=") => ctx.op.as_deref() == Some(value.as_str()),
        ("repo", "=") => ctx.repo.as_deref() == Some(value.as_str()),
        ("branch", "=") => ctx.branch.as_deref().is_some_and(|b| glob_match(&value, b)),
        ("branch", "!=") => ctx
            .branch
            .as_deref()
            .is_some_and(|b| !glob_match(&value, b)),
        ("host", "=") => ctx.host.as_deref() == Some(value.as_str()),
        ("spend_usd", "<=") => match (ctx.spend_usd, value.parse::<f64>()) {
            (Some(s), Ok(ceiling)) => s <= ceiling,
            _ => false,
        },
        // Fail closed when the clock is unset: now_ms <= 0 (e.g. a caller who
        // built RequestContext::default() and forgot to set it) makes every
        // `expires` caveat fail, so an expired grant is rejected rather than
        // accidentally accepted.
        ("expires", "=") => {
            ctx.now_ms > 0
                && value
                    .parse::<i64>()
                    .map(|e| ctx.now_ms <= e)
                    .unwrap_or(false)
        }
        ("session", "=") => ctx.session.as_deref() == Some(value.as_str()),
        _ => false,
    }
}

// ===========================================================================
// Appendix A §A.3 — the rent-paid third-party caveat & discharge
// ===========================================================================

/// Where a lease stands on its coordination rent — mirrors the verdict from
/// `lib/coast-guard/compulsion.ts` (`evaluateLeaseRent`). The kernel discharge
/// gate mints a discharge ONLY for `Paid`; wiring the actual evaluation (a Rust
/// port, or a call into the daemon) is the next integration step.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RentVerdict {
    Paid,
    RentDue,
    Idle,
    Stale,
}

/// Default discharge lifetime — matches the rent TTL in Appendix A §A.4.
pub const DISCHARGE_TTL_MS: i64 = 20 * 60 * 1000;

const RENT_LOCATION: &str = "pd://daemon/rent";

/// A minted push grant. `caveat_key` is the discharge root key the daemon must
/// store (keyed by `rent_caveat_id`) — it never goes into the macaroon.
pub struct PushGrant {
    pub macaroon: Macaroon,
    pub rent_caveat_id: String,
    pub caveat_key: Vec<u8>,
}

/// Options for minting a push grant.
pub struct MintPushGrant<'a> {
    pub root_key: &'a [u8],
    pub grant_id: &'a str,
    pub repo: &'a str,
    pub session: &'a str,
    pub expires_ms: i64,
    /// Discharge root key — caller supplies it (the daemon stores it).
    pub caveat_key: Vec<u8>,
    /// Nonce making the rent caveat id unique per grant.
    pub rent_nonce: &'a str,
    /// Protected branch the grant must never push to.
    pub protected_branch: &'a str,
}

/// Mint a push grant: the non-negotiable first-party caveats the root daemon
/// always appends (op=push, repo, deny protected branch, hard expiry, session)
/// plus the single third-party rent-paid caveat.
pub fn mint_push_grant(opts: MintPushGrant) -> Result<PushGrant, MacaroonError> {
    let rent_caveat_id = format!("rent-paid:{}:{}", opts.session, opts.rent_nonce);
    let location = format!("pd://daemon/{}", opts.repo);
    let m = Macaroon::mint(opts.root_key, opts.grant_id, location)
        .add_first_party_caveat(op_caveat("push"))?
        .add_first_party_caveat(repo_caveat(opts.repo))?
        .add_first_party_caveat(deny_branch_caveat(opts.protected_branch))?
        .add_first_party_caveat(expires_caveat(opts.expires_ms))?
        .add_first_party_caveat(session_caveat(opts.session))?
        .add_third_party_caveat(&opts.caveat_key, &rent_caveat_id, RENT_LOCATION)?;
    Ok(PushGrant {
        macaroon: m,
        rent_caveat_id,
        caveat_key: opts.caveat_key,
    })
}

/// Discharge a rent caveat: mint a short-lived discharge macaroon ONLY when the
/// verdict is `Paid`. Any other verdict returns `None` — the agent learns it
/// must coordinate (publish a note, rebase) from the daemon's separate refusal,
/// never a bypass.
pub fn discharge_rent_paid(
    caveat_key: &[u8],
    rent_caveat_id: &str,
    verdict: RentVerdict,
    now_ms: i64,
    ttl_ms: i64,
) -> Result<Option<Macaroon>, MacaroonError> {
    if verdict != RentVerdict::Paid {
        return Ok(None);
    }
    let discharge = Macaroon::mint(caveat_key, rent_caveat_id, RENT_LOCATION)
        .add_first_party_caveat(expires_caveat(now_ms + ttl_ms))?;
    Ok(Some(discharge))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROOT: &[u8] = b"root-key-32-bytes-padding-padxxx";
    const CKEY: &[u8] = b"caveat-key-32-bytes-padding-padx";

    fn always(_: &str) -> bool {
        true
    }
    fn no_key(_: &str) -> Option<Vec<u8>> {
        None
    }

    #[test]
    fn minted_macaroon_verifies() {
        let m = Macaroon::mint(ROOT, "g", "loc");
        assert!(verify(&m, ROOT, &[], &always, &no_key).ok);
    }

    #[test]
    fn wrong_root_key_fails() {
        let m = Macaroon::mint(ROOT, "g", "loc");
        let res = verify(
            &m,
            b"different-key-32-bytes-pad-xxxxx",
            &[],
            &always,
            &no_key,
        );
        assert!(!res.ok);
        assert!(res.reason.contains("signature mismatch"));
    }

    #[test]
    fn first_party_caveat_enforced() {
        let m = Macaroon::mint(ROOT, "g", "loc")
            .add_first_party_caveat("op = push")
            .unwrap();
        let pass = |p: &str| p == "op = push";
        let nope = |_: &str| false;
        assert!(verify(&m, ROOT, &[], &pass, &no_key).ok);
        assert!(!verify(&m, ROOT, &[], &nope, &no_key).ok);
    }

    #[test]
    fn removing_a_caveat_breaks_the_signature() {
        let m = Macaroon::mint(ROOT, "g", "loc")
            .add_first_party_caveat("op = push")
            .unwrap()
            .add_first_party_caveat("branch = feat/x")
            .unwrap();
        let mut forged = m.clone();
        forged.caveats.pop(); // strip last caveat, keep stale signature
        assert!(!verify(&forged, ROOT, &[], &always, &no_key).ok);
    }

    fn grant() -> PushGrant {
        mint_push_grant(MintPushGrant {
            root_key: ROOT,
            grant_id: "grant-1",
            repo: "curiositech/port-daddy",
            session: "session-abc",
            expires_ms: 2_000_000,
            caveat_key: CKEY.to_vec(),
            rent_nonce: "nonce-1",
            protected_branch: "main",
        })
        .unwrap()
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

    #[test]
    fn paid_rent_discharges_and_authorizes() {
        let g = grant();
        let discharge = discharge_rent_paid(
            &g.caveat_key,
            &g.rent_caveat_id,
            RentVerdict::Paid,
            1_000_000,
            DISCHARGE_TTL_MS,
        )
        .unwrap()
        .expect("paid rent yields a discharge");
        let bound = g.macaroon.prepare_for_request(&discharge).unwrap();
        let ctx = push_ctx();
        let check = |p: &str| check_caveat(p, &ctx);
        let resolve = |id: &str| (id == g.rent_caveat_id).then(|| CKEY.to_vec());
        assert!(verify(&g.macaroon, ROOT, &[bound], &check, &resolve).ok);
    }

    #[test]
    fn rent_due_yields_no_discharge() {
        let g = grant();
        let d = discharge_rent_paid(
            &g.caveat_key,
            &g.rent_caveat_id,
            RentVerdict::RentDue,
            1_000_000,
            DISCHARGE_TTL_MS,
        )
        .unwrap();
        assert!(d.is_none());
    }

    #[test]
    fn missing_discharge_is_rejected() {
        let g = grant();
        let ctx = push_ctx();
        let check = |p: &str| check_caveat(p, &ctx);
        let resolve = |id: &str| (id == g.rent_caveat_id).then(|| CKEY.to_vec());
        let res = verify(&g.macaroon, ROOT, &[], &check, &resolve);
        assert!(!res.ok);
        assert!(res.reason.contains("no discharge macaroon"));
    }

    #[test]
    fn unbound_discharge_is_rejected() {
        let g = grant();
        let discharge = discharge_rent_paid(
            &g.caveat_key,
            &g.rent_caveat_id,
            RentVerdict::Paid,
            1_000_000,
            DISCHARGE_TTL_MS,
        )
        .unwrap()
        .unwrap();
        // present the discharge WITHOUT prepare_for_request
        let ctx = push_ctx();
        let check = |p: &str| check_caveat(p, &ctx);
        let resolve = |id: &str| (id == g.rent_caveat_id).then(|| CKEY.to_vec());
        assert!(!verify(&g.macaroon, ROOT, &[discharge], &check, &resolve).ok);
    }

    #[test]
    fn protected_branch_push_is_rejected() {
        let g = grant();
        let discharge = discharge_rent_paid(
            &g.caveat_key,
            &g.rent_caveat_id,
            RentVerdict::Paid,
            1_000_000,
            DISCHARGE_TTL_MS,
        )
        .unwrap()
        .unwrap();
        let bound = g.macaroon.prepare_for_request(&discharge).unwrap();
        let ctx = RequestContext {
            branch: Some("main".into()),
            ..push_ctx()
        };
        let check = |p: &str| check_caveat(p, &ctx);
        let resolve = |id: &str| (id == g.rent_caveat_id).then(|| CKEY.to_vec());
        let res = verify(&g.macaroon, ROOT, &[bound], &check, &resolve);
        assert!(!res.ok);
        assert!(res.reason.contains("branch != main"));
    }

    #[test]
    fn expired_grant_is_rejected() {
        let g = grant();
        let discharge = discharge_rent_paid(
            &g.caveat_key,
            &g.rent_caveat_id,
            RentVerdict::Paid,
            1_000_000,
            DISCHARGE_TTL_MS,
        )
        .unwrap()
        .unwrap();
        let bound = g.macaroon.prepare_for_request(&discharge).unwrap();
        // now_ms past the grant's hard expiry (2_000_000)
        let ctx = RequestContext {
            now_ms: 3_000_000,
            ..push_ctx()
        };
        let check = |p: &str| check_caveat(p, &ctx);
        let resolve = |id: &str| (id == g.rent_caveat_id).then(|| CKEY.to_vec());
        assert!(!verify(&g.macaroon, ROOT, &[bound], &check, &resolve).ok);
    }

    #[test]
    fn stale_discharge_fails_after_ttl() {
        let g = grant();
        // discharge minted at t=1_000_000 with 20-min TTL
        let discharge = discharge_rent_paid(
            &g.caveat_key,
            &g.rent_caveat_id,
            RentVerdict::Paid,
            1_000_000,
            DISCHARGE_TTL_MS,
        )
        .unwrap()
        .unwrap();
        let bound = g.macaroon.prepare_for_request(&discharge).unwrap();
        // request 25 min later, still inside the 2_000_000 grant expiry
        let ctx = RequestContext {
            now_ms: 1_000_000 + 25 * 60 * 1000,
            ..push_ctx()
        };
        let check = |p: &str| check_caveat(p, &ctx);
        let resolve = |id: &str| (id == g.rent_caveat_id).then(|| CKEY.to_vec());
        assert!(!verify(&g.macaroon, ROOT, &[bound], &check, &resolve).ok);
    }

    #[test]
    fn caveat_grammar_matches_appendix_a() {
        let ctx = push_ctx();
        assert!(check_caveat(&op_caveat("push"), &ctx));
        assert!(!check_caveat(&op_caveat("api-call"), &ctx));
        assert!(check_caveat(&branch_caveat("feat/dom-daddy-*"), &ctx));
        assert!(!check_caveat(&branch_caveat("release/*"), &ctx));
        assert!(check_caveat(&deny_branch_caveat("main"), &ctx));
        let spendy = RequestContext {
            spend_usd: Some(1.5),
            ..ctx.clone()
        };
        assert!(check_caveat(&spend_ceiling_caveat(2.0), &spendy));
        assert!(!check_caveat(&spend_ceiling_caveat(1.0), &spendy));
        assert!(check_caveat(&expires_caveat(1_000_001), &ctx));
        assert!(!check_caveat(&expires_caveat(999_999), &ctx));
    }

    #[test]
    fn malformed_signature_fails_closed_not_panics() {
        let mut m = Macaroon::mint(ROOT, "g", "loc");
        m.signature_hex = "zz".into();
        let res = verify(&m, ROOT, &[], &always, &no_key);
        assert!(!res.ok);
    }
    #[test]
    fn two_third_party_caveats_both_discharge_no_false_cycle() {
        // The old recursion guard (a never-popped "seen" set) would mis-flag the
        // second discharge. A grant with TWO third-party caveats, each discharged,
        // must verify.
        let ckey_a = b"caveat-key-a-32-bytes-padding-pad";
        let ckey_b = b"caveat-key-b-32-bytes-padding-pad";
        let m = Macaroon::mint(ROOT, "g", "loc")
            .add_third_party_caveat(ckey_a, "cav-a", RENT_LOCATION)
            .unwrap()
            .add_third_party_caveat(ckey_b, "cav-b", RENT_LOCATION)
            .unwrap();
        let da = m
            .prepare_for_request(&Macaroon::mint(ckey_a, "cav-a", RENT_LOCATION))
            .unwrap();
        let db = m
            .prepare_for_request(&Macaroon::mint(ckey_b, "cav-b", RENT_LOCATION))
            .unwrap();
        let resolve = |id: &str| match id {
            "cav-a" => Some(ckey_a.to_vec()),
            "cav-b" => Some(ckey_b.to_vec()),
            _ => None,
        };
        assert!(verify(&m, ROOT, &[da, db], &always, &resolve).ok);
    }

    #[test]
    fn expires_fails_closed_when_clock_unset() {
        // RequestContext::default() leaves now_ms = 0. An `expires` caveat must
        // then FAIL (fail-closed), so a forgotten clock never accepts an expired
        // grant.
        let unset = RequestContext::default();
        assert!(!check_caveat(&expires_caveat(2_000_000), &unset));
        // With a real clock before expiry it passes.
        let clocked = RequestContext {
            now_ms: 1_000_000,
            ..Default::default()
        };
        assert!(check_caveat(&expires_caveat(2_000_000), &clocked));
    }
}
