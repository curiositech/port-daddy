//! C ABI for the macaroon gate (ADR-0054 — the kernel is canonical, called over
//! FFI). The TypeScript daemon loads `libpd_anchor.{dylib,so}` via koffi and calls
//! these instead of re-deriving the macaroon construction in TS (the deprecated
//! `lib/macaroon` is a byte-parity fallback for when this dylib is absent).
//!
//! Conventions (mirroring `core/harbor-card-rs/src/lib.rs`): JSON in over a
//! `*const c_char` + length; JSON out as a heap `*mut c_char` the caller frees with
//! `pd_string_free`. Every export is wrapped in `catch_unwind` and guards
//! null/length/utf8/parse — a panic must never unwind across the boundary (UB), and
//! malformed input returns a clean error JSON, never a crash. Fail closed.

use crate::macaroon::{check_caveat, verify, Macaroon, RequestContext};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::{c_char, CString};
use std::panic::catch_unwind;

/// Generous bound on a verify request — a real one is a few KB; reject pathological
/// sizes fail-fast before any allocation/parse.
const MAX_REQUEST_BYTES: usize = 256 * 1024;

#[derive(Deserialize)]
struct FfiCtx {
    op: Option<String>,
    repo: Option<String>,
    branch: Option<String>,
    host: Option<String>,
    spend_usd: Option<f64>,
    session: Option<String>,
    now_ms: i64,
}

#[derive(Deserialize)]
struct FfiVerifyRequest {
    macaroon: Macaroon,
    root_key_hex: String,
    #[serde(default)]
    discharges: Vec<Macaroon>,
    ctx: FfiCtx,
    /// caveat id -> discharge key (hex). The verifier holds these (HMAC-commitment).
    #[serde(default)]
    caveat_keys: HashMap<String, String>,
}

#[derive(Serialize)]
struct FfiVerifyResponse {
    ok: bool,
    reason: String,
}

fn respond(ok: bool, reason: impl Into<String>) -> *mut c_char {
    let body = serde_json::to_string(&FfiVerifyResponse {
        ok,
        reason: reason.into(),
    })
    .unwrap_or_else(|_| "{\"ok\":false,\"reason\":\"serialize error\"}".to_string());
    match CString::new(body) {
        Ok(c) => c.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Verify a macaroon push grant. Input JSON:
/// `{ macaroon, root_key_hex, discharges, ctx:{op,repo,branch,host,spend_usd,session,now_ms}, caveat_keys:{<id>:<hex>} }`.
/// Output JSON: `{ ok, reason }`. Returns null only on a catastrophic allocation
/// failure; every other path returns a `{ok:false,...}` JSON (fail closed).
// SAFETY: this is a C ABI entry point — the caller (koffi) guarantees `req` is a
// valid pointer to `len` bytes (or null, which we guard). C callers cannot express
// Rust's `unsafe`, so we keep the fn safe-signatured and allow the lint, with the
// contract documented here and the null/len guards enforced below.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
#[no_mangle]
pub extern "C" fn pd_macaroon_verify_json(req: *const c_char, len: usize) -> *mut c_char {
    let result = catch_unwind(|| {
        if req.is_null() || len == 0 || len > MAX_REQUEST_BYTES {
            return respond(false, "malformed request (null/empty/oversized)");
        }
        let bytes = unsafe { std::slice::from_raw_parts(req as *const u8, len) };
        let s = match std::str::from_utf8(bytes) {
            Ok(s) => s,
            Err(_) => return respond(false, "request is not valid UTF-8"),
        };
        let parsed: FfiVerifyRequest = match serde_json::from_str(s) {
            Ok(p) => p,
            Err(e) => return respond(false, format!("request parse error: {e}")),
        };
        let root_key = match hex::decode(&parsed.root_key_hex) {
            Ok(k) => k,
            Err(_) => return respond(false, "root_key_hex is not valid hex"),
        };
        // Decode the caveat-key store; a bad hex value drops that key (→ that
        // third-party caveat will fail to resolve, fail closed).
        let keys: HashMap<String, Vec<u8>> = parsed
            .caveat_keys
            .iter()
            .filter_map(|(k, v)| hex::decode(v).ok().map(|b| (k.clone(), b)))
            .collect();
        let ctx = RequestContext {
            op: parsed.ctx.op,
            repo: parsed.ctx.repo,
            branch: parsed.ctx.branch,
            host: parsed.ctx.host,
            spend_usd: parsed.ctx.spend_usd,
            session: parsed.ctx.session,
            now_ms: parsed.ctx.now_ms,
        };
        let check = |p: &str| check_caveat(p, &ctx);
        let resolve = |id: &str| keys.get(id).cloned();
        let out = verify(
            &parsed.macaroon,
            &root_key,
            &parsed.discharges,
            &check,
            &resolve,
        );
        respond(out.ok, out.reason)
    });
    result.unwrap_or_else(|_| respond(false, "internal error"))
}

/// Reclaim a string returned by this library. The caller MUST call this exactly
/// once for every non-null pointer received.
// SAFETY: `ptr` must be a pointer previously returned by this library (or null).
#[allow(clippy::not_unsafe_ptr_arg_deref)]
#[no_mangle]
pub extern "C" fn pd_string_free(ptr: *mut c_char) {
    if !ptr.is_null() {
        unsafe { drop(CString::from_raw(ptr)) };
    }
}

// In-process helper so the FFI surface is also exercised by Rust tests without a
// real dlopen. Takes/returns owned JSON strings.
#[cfg(test)]
fn verify_via_ffi(req_json: &str) -> String {
    let c = CString::new(req_json).unwrap();
    let ptr = pd_macaroon_verify_json(c.as_ptr(), req_json.len());
    assert!(!ptr.is_null());
    let out = unsafe { std::ffi::CStr::from_ptr(ptr) }
        .to_str()
        .unwrap()
        .to_string();
    pd_string_free(ptr);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::macaroon::*;
    use serde_json::json;

    const ROOT: &[u8] = b"pd-canonical-root-key-0000000001";
    const CKEY: &[u8] = b"pd-canonical-caveat-key-00000001";

    fn grant() -> PushGrant {
        mint_push_grant(MintPushGrant {
            root_key: ROOT,
            grant_id: "g-ffi",
            repo: "curiositech/port-daddy",
            session: "session-ffi",
            expires_ms: 2_000_000,
            caveat_key: CKEY.to_vec(),
            rent_nonce: "nonce-ffi",
            protected_branch: "main",
        })
        .unwrap()
    }

    #[test]
    fn ffi_verify_authorizes_a_valid_grant() {
        let g = grant();
        let d = discharge_rent_paid(
            CKEY,
            &g.rent_caveat_id,
            RentVerdict::Paid,
            1_000_000,
            DISCHARGE_TTL_MS,
        )
        .unwrap()
        .unwrap();
        let bound = g.macaroon.prepare_for_request(&d).unwrap();
        let req = json!({
            "macaroon": g.macaroon,
            "root_key_hex": hex::encode(ROOT),
            "discharges": [bound],
            "ctx": { "op": "push", "repo": "curiositech/port-daddy", "branch": "feat/x", "session": "session-ffi", "now_ms": 1_500_000 },
            "caveat_keys": { g.rent_caveat_id.clone(): hex::encode(CKEY) }
        });
        let resp: serde_json::Value =
            serde_json::from_str(&verify_via_ffi(&req.to_string())).unwrap();
        assert_eq!(resp["ok"], true, "{resp}");
    }

    #[test]
    fn ffi_verify_rejects_protected_branch() {
        let g = grant();
        let d = discharge_rent_paid(
            CKEY,
            &g.rent_caveat_id,
            RentVerdict::Paid,
            1_000_000,
            DISCHARGE_TTL_MS,
        )
        .unwrap()
        .unwrap();
        let bound = g.macaroon.prepare_for_request(&d).unwrap();
        let req = json!({
            "macaroon": g.macaroon, "root_key_hex": hex::encode(ROOT), "discharges": [bound],
            "ctx": { "op": "push", "repo": "curiositech/port-daddy", "branch": "main", "session": "session-ffi", "now_ms": 1_500_000 },
            "caveat_keys": { g.rent_caveat_id.clone(): hex::encode(CKEY) }
        });
        let resp: serde_json::Value =
            serde_json::from_str(&verify_via_ffi(&req.to_string())).unwrap();
        assert_eq!(resp["ok"], false);
    }

    #[test]
    fn ffi_malformed_input_fails_closed_not_panics() {
        for bad in ["", "not json", "{}", "{\"macaroon\":1}"] {
            let c = CString::new(bad).unwrap();
            let ptr = pd_macaroon_verify_json(c.as_ptr(), bad.len());
            assert!(!ptr.is_null());
            let out = unsafe { std::ffi::CStr::from_ptr(ptr) }
                .to_str()
                .unwrap()
                .to_string();
            pd_string_free(ptr);
            let resp: serde_json::Value = serde_json::from_str(&out).unwrap();
            assert_eq!(resp["ok"], false, "input {bad:?} should fail closed");
        }
        // null pointer
        let ptr = pd_macaroon_verify_json(std::ptr::null(), 0);
        assert!(!ptr.is_null());
        pd_string_free(ptr);
    }
}
