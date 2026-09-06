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

use crate::keystore;
use crate::macaroon::{
    check_caveat, verify, Macaroon, RentVerdict, RequestContext, DISCHARGE_TTL_MS,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
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
    // Never null on an encodable response: an interior NUL in `body` (which our JSON
    // never contains) falls back to a static error string that has none, so the
    // documented contract "null is unreachable" actually holds.
    CString::new(body)
        .or_else(|_| CString::new("{\"ok\":false,\"reason\":\"response encoding error\"}"))
        .map(|c| c.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

/// Verify a macaroon push grant. Input JSON:
/// `{ macaroon, root_key_hex, discharges, ctx:{op,repo,branch,host,spend_usd,session,now_ms}, caveat_keys:{<id>:<hex>} }`.
/// Output JSON: `{ ok, reason }`. Returns null only on a catastrophic allocation
/// failure; every other path returns a `{ok:false,...}` JSON (fail closed).
/// # Safety
/// `req` must be null or a valid pointer to `len` readable bytes (the C-ABI
/// contract koffi upholds). The null/len/utf8/parse guards below enforce the rest;
/// the body never panics across the boundary (catch_unwind).
#[no_mangle]
pub unsafe extern "C" fn pd_macaroon_verify_json(req: *const c_char, len: usize) -> *mut c_char {
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

// ─── Planner scheduler (ADR-0086) ────────────────────────────────────────────

use crate::schedule::{schedule, SchedEdge, SchedNode, ScheduleResult};

#[derive(Deserialize)]
struct FfiScheduleRequest {
    #[serde(default)]
    nodes: Vec<SchedNode>,
    #[serde(default)]
    edges: Vec<SchedEdge>,
}

/// Serialize any value to a heap C string (caller frees with `pd_string_free`).
/// Mirrors `respond`'s NUL/encoding safety so null is unreachable on encodable input.
fn respond_json<T: Serialize>(v: &T) -> *mut c_char {
    let body = serde_json::to_string(v)
        .unwrap_or_else(|_| "{\"ok\":false,\"reason\":\"serialize error\"}".to_string());
    CString::new(body)
        .or_else(|_| CString::new("{\"ok\":false,\"reason\":\"response encoding error\"}"))
        .map(|c| c.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

fn schedule_error(reason: impl Into<String>) -> ScheduleResult {
    ScheduleResult {
        ok: false,
        reason: reason.into(),
        cyclic: false,
        makespan: 0,
        order: Vec::new(),
        nodes: Vec::new(),
        critical_path: Vec::new(),
    }
}

/// Schedule a dependency DAG (Critical Path Method). Input JSON:
/// `{ nodes:[{id,estimate?}], edges:[{from,to}] }` (an edge means `from` finishes before `to`
/// starts). Output JSON is the full `ScheduleResult` (ok/cyclic/makespan/order/nodes/criticalPath).
/// Returns null only on catastrophic allocation failure; every other path returns a JSON result
/// (fail closed — malformed input yields `ok:false`).
/// # Safety
/// `req` must be null or a valid pointer to `len` readable bytes (the C-ABI contract koffi
/// upholds). The guards below enforce the rest; the body never panics across the boundary.
#[no_mangle]
pub unsafe extern "C" fn pd_schedule_dag_json(req: *const c_char, len: usize) -> *mut c_char {
    let result = catch_unwind(|| {
        if req.is_null() || len == 0 || len > MAX_REQUEST_BYTES {
            return respond_json(&schedule_error("malformed request (null/empty/oversized)"));
        }
        let bytes = unsafe { std::slice::from_raw_parts(req as *const u8, len) };
        let s = match std::str::from_utf8(bytes) {
            Ok(s) => s,
            Err(_) => return respond_json(&schedule_error("request is not valid UTF-8")),
        };
        let parsed: FfiScheduleRequest = match serde_json::from_str(s) {
            Ok(p) => p,
            Err(e) => return respond_json(&schedule_error(format!("request parse error: {e}"))),
        };
        respond_json(&schedule(&parsed.nodes, &parsed.edges))
    });
    result.unwrap_or_else(|_| respond_json(&schedule_error("internal error")))
}

// ===========================================================================
// Key-custody surface (ADR-0057 enforcement slice 1). UNLIKE
// `pd_macaroon_verify_json` above — which takes caller-supplied keys and exists
// for the byte-parity fallback — these route through `crate::keystore`, where
// the root + caveat keys live. NO key ever appears in a request or response
// here: the daemon asks the kernel to issue/authorize and never sees the
// forging material. (Slice 2 migrates the daemon onto these and deprecates the
// key-taking verify path.)
// ===========================================================================

/// Serialize any JSON value into a heap C string, fail-closed on encode error.
fn respond_value(v: serde_json::Value) -> *mut c_char {
    let body = serde_json::to_string(&v)
        .unwrap_or_else(|_| "{\"ok\":false,\"reason\":\"serialize error\"}".to_string());
    CString::new(body)
        .or_else(|_| CString::new("{\"ok\":false,\"reason\":\"response encoding error\"}"))
        .map(|c| c.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

fn read_request(req: *const c_char, len: usize) -> Result<String, *mut c_char> {
    if req.is_null() || len == 0 || len > MAX_REQUEST_BYTES {
        return Err(respond(false, "malformed request (null/empty/oversized)"));
    }
    let bytes = unsafe { std::slice::from_raw_parts(req as *const u8, len) };
    std::str::from_utf8(bytes)
        .map(|s| s.to_string())
        .map_err(|_| respond(false, "request is not valid UTF-8"))
}

fn parse_verdict(s: &str) -> Option<RentVerdict> {
    match s {
        "paid" => Some(RentVerdict::Paid),
        "rent-due" | "rent_due" => Some(RentVerdict::RentDue),
        "idle" => Some(RentVerdict::Idle),
        "stale" => Some(RentVerdict::Stale),
        _ => None,
    }
}

#[derive(Deserialize)]
struct FfiIssueGrant {
    repo: String,
    session: String,
    expires_ms: i64,
    protected_branch: String,
}

/// Issue a push grant. In: `{repo, session, expires_ms, protected_branch}`.
/// Out: `{ok, grant_id, macaroon}` — the keys stay in the kernel store.
/// # Safety
/// `req` must be null or point to `len` readable bytes (the koffi C-ABI contract).
#[no_mangle]
pub unsafe extern "C" fn pd_keystore_issue_grant_json(
    req: *const c_char,
    len: usize,
) -> *mut c_char {
    catch_unwind(|| {
        let s = match read_request(req, len) {
            Ok(s) => s,
            Err(p) => return p,
        };
        let r: FfiIssueGrant = match serde_json::from_str(&s) {
            Ok(r) => r,
            Err(e) => return respond(false, format!("request parse error: {e}")),
        };
        match keystore::issue_grant(&r.repo, &r.session, r.expires_ms, &r.protected_branch) {
            Ok((m, grant_id)) => {
                respond_value(json!({"ok": true, "grant_id": grant_id, "macaroon": m}))
            }
            Err(e) => respond(false, format!("issue_grant failed: {e}")),
        }
    })
    .unwrap_or_else(|_| respond(false, "internal error"))
}

#[derive(Deserialize)]
struct FfiIssueDischarge {
    grant_id: String,
    verdict: String,
    now_ms: i64,
    ttl_ms: Option<i64>,
}

/// Issue a discharge for a stored grant — only when verdict == "paid". In:
/// `{grant_id, verdict, now_ms, ttl_ms?}`. Out: `{ok, discharge|null, reason}`.
/// # Safety
/// `req` must be null or point to `len` readable bytes (the koffi C-ABI contract).
#[no_mangle]
pub unsafe extern "C" fn pd_keystore_issue_discharge_json(
    req: *const c_char,
    len: usize,
) -> *mut c_char {
    catch_unwind(|| {
        let s = match read_request(req, len) {
            Ok(s) => s,
            Err(p) => return p,
        };
        let r: FfiIssueDischarge = match serde_json::from_str(&s) {
            Ok(r) => r,
            Err(e) => return respond(false, format!("request parse error: {e}")),
        };
        let Some(verdict) = parse_verdict(&r.verdict) else {
            return respond(false, "unknown rent verdict");
        };
        match keystore::issue_discharge(&r.grant_id, verdict, r.now_ms, r.ttl_ms.unwrap_or(DISCHARGE_TTL_MS)) {
            Ok(Some(d)) => respond_value(json!({"ok": true, "discharge": d, "reason": "discharged"})),
            Ok(None) => respond_value(json!({"ok": false, "discharge": serde_json::Value::Null, "reason": "no discharge (rent not paid, or unknown/revoked grant)"})),
            Err(e) => respond(false, format!("issue_discharge failed: {e}")),
        }
    })
    .unwrap_or_else(|_| respond(false, "internal error"))
}

#[derive(Deserialize)]
struct FfiAuthorize {
    macaroon: Macaroon,
    #[serde(default)]
    discharges: Vec<Macaroon>,
    ctx: FfiCtx,
}

/// Authorize a push using the kernel-held keys (looked up by the grant's own
/// identifier). In: `{macaroon, discharges, ctx}` — NO keys. Out: `{ok, reason}`.
/// # Safety
/// `req` must be null or point to `len` readable bytes (the koffi C-ABI contract).
#[no_mangle]
pub unsafe extern "C" fn pd_keystore_authorize_json(req: *const c_char, len: usize) -> *mut c_char {
    catch_unwind(|| {
        let s = match read_request(req, len) {
            Ok(s) => s,
            Err(p) => return p,
        };
        let r: FfiAuthorize = match serde_json::from_str(&s) {
            Ok(r) => r,
            Err(e) => return respond(false, format!("request parse error: {e}")),
        };
        let ctx = RequestContext {
            op: r.ctx.op,
            repo: r.ctx.repo,
            branch: r.ctx.branch,
            host: r.ctx.host,
            spend_usd: r.ctx.spend_usd,
            session: r.ctx.session,
            now_ms: r.ctx.now_ms,
        };
        let out = keystore::authorize(&r.macaroon, &r.discharges, &ctx);
        respond(out.ok, out.reason)
    })
    .unwrap_or_else(|_| respond(false, "internal error"))
}

#[derive(Deserialize)]
struct FfiPruneExpired {
    now_ms: i64,
}

/// Garbage-collect grants past their hard expiry (revoked tombstones and merely
/// aged-out entries alike) from the kernel custody store. In: `{now_ms}`. Out:
/// `{ok, pruned}` — the count reclaimed. The daemon owns the cadence; the clock is
/// supplied so the sweep is deterministic and never reads wall time itself.
/// # Safety
/// `req` must be null or point to `len` readable bytes (the koffi C-ABI contract).
#[no_mangle]
pub unsafe extern "C" fn pd_keystore_prune_expired_json(
    req: *const c_char,
    len: usize,
) -> *mut c_char {
    catch_unwind(|| {
        let s = match read_request(req, len) {
            Ok(s) => s,
            Err(p) => return p,
        };
        let r: FfiPruneExpired = match serde_json::from_str(&s) {
            Ok(r) => r,
            Err(e) => return respond(false, format!("request parse error: {e}")),
        };
        let pruned = keystore::prune_expired(r.now_ms);
        respond_value(json!({"ok": true, "pruned": pruned}))
    })
    .unwrap_or_else(|_| respond(false, "internal error"))
}

/// Reclaim a string returned by this library. The caller MUST call this exactly
/// once for every non-null pointer received.
/// # Safety
/// `ptr` must be null or a pointer previously returned by this library and not
/// yet freed; it must not be used again after this call.
#[no_mangle]
pub unsafe extern "C" fn pd_string_free(ptr: *mut c_char) {
    if !ptr.is_null() {
        unsafe { drop(CString::from_raw(ptr)) };
    }
}

// In-process helper so the FFI surface is also exercised by Rust tests without a
// real dlopen. Takes/returns owned JSON strings.
#[cfg(test)]
fn verify_via_ffi(req_json: &str) -> String {
    let c = CString::new(req_json).unwrap();
    let ptr = unsafe { pd_macaroon_verify_json(c.as_ptr(), req_json.len()) };
    assert!(!ptr.is_null());
    let out = unsafe { std::ffi::CStr::from_ptr(ptr) }
        .to_str()
        .unwrap()
        .to_string();
    unsafe { pd_string_free(ptr) };
    out
}

// Call any of the JSON-in/JSON-out exports in-process (no dlopen).
#[cfg(test)]
fn call_export(f: unsafe extern "C" fn(*const c_char, usize) -> *mut c_char, req: &str) -> String {
    let c = CString::new(req).unwrap();
    let ptr = unsafe { f(c.as_ptr(), req.len()) };
    assert!(!ptr.is_null());
    let out = unsafe { std::ffi::CStr::from_ptr(ptr) }
        .to_str()
        .unwrap()
        .to_string();
    unsafe { pd_string_free(ptr) };
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::macaroon::*;
    use serde_json::json;

    // The custody surface proves itself end-to-end WITHOUT any key in any payload:
    // issue a grant, discharge it (rent paid), bind, authorize — all over the FFI,
    // and assert no "root_key"/"caveat_key" ever crosses the boundary.
    #[test]
    fn keystore_custody_roundtrip_carries_no_keys() {
        let now = 2_000_000i64;
        let issue_req =
            json!({"repo":"acme/api","session":"sess-ffi","expires_ms": now+60_000,"protected_branch":"main"})
                .to_string();
        assert!(
            !issue_req.contains("key"),
            "issue request must carry no key"
        );
        let issued: serde_json::Value =
            serde_json::from_str(&call_export(pd_keystore_issue_grant_json, &issue_req)).unwrap();
        assert_eq!(issued["ok"], true);
        let grant_id = issued["grant_id"].as_str().unwrap().to_string();
        let grant: Macaroon = serde_json::from_value(issued["macaroon"].clone()).unwrap();

        let disc_req = json!({"grant_id": grant_id, "verdict":"paid", "now_ms": now}).to_string();
        let discharged: serde_json::Value =
            serde_json::from_str(&call_export(pd_keystore_issue_discharge_json, &disc_req))
                .unwrap();
        assert_eq!(discharged["ok"], true);
        let discharge: Macaroon = serde_json::from_value(discharged["discharge"].clone()).unwrap();

        let bound = grant.prepare_for_request(&discharge).unwrap();
        let auth_req = json!({
            "macaroon": grant,
            "discharges": [bound],
            "ctx": {"op":"push","repo":"acme/api","branch":"feat/x","session":"sess-ffi","now_ms": now}
        })
        .to_string();
        assert!(
            !auth_req.contains("root_key") && !auth_req.contains("caveat_key"),
            "authorize request must carry NO keys"
        );
        let authorized: serde_json::Value =
            serde_json::from_str(&call_export(pd_keystore_authorize_json, &auth_req)).unwrap();
        assert_eq!(
            authorized["ok"], true,
            "paid+bound must authorize: {}",
            authorized["reason"]
        );
    }

    // Rent not paid → the discharge export returns no discharge → push refused.
    #[test]
    fn keystore_unpaid_yields_no_discharge_over_ffi() {
        let now = 2_000_000i64;
        let issued: serde_json::Value = serde_json::from_str(&call_export(
            pd_keystore_issue_grant_json,
            &json!({"repo":"acme/api","session":"s2","expires_ms": now+60_000,"protected_branch":"main"}).to_string(),
        )).unwrap();
        let grant_id = issued["grant_id"].as_str().unwrap();
        let discharged: serde_json::Value = serde_json::from_str(&call_export(
            pd_keystore_issue_discharge_json,
            &json!({"grant_id": grant_id, "verdict":"rent-due", "now_ms": now}).to_string(),
        ))
        .unwrap();
        assert_eq!(discharged["ok"], false);
        assert!(
            discharged["discharge"].is_null(),
            "rent-due must yield no discharge"
        );
    }

    // The prune export round-trips its JSON contract. Called with now_ms:0 so it
    // sweeps nothing (every issued grant expires after 0) — this keeps the assertion
    // stable and never disturbs another parallel test's grant in the shared store.
    #[test]
    fn keystore_prune_expired_over_ffi_round_trips() {
        let resp: serde_json::Value = serde_json::from_str(&call_export(
            pd_keystore_prune_expired_json,
            &json!({"now_ms": 0}).to_string(),
        ))
        .unwrap();
        assert_eq!(resp["ok"], true);
        assert_eq!(resp["pruned"], 0, "nothing expires at or before epoch 0");

        // Malformed input fails closed (no panic across the boundary).
        let bad: serde_json::Value =
            serde_json::from_str(&call_export(pd_keystore_prune_expired_json, "not json")).unwrap();
        assert_eq!(bad["ok"], false);
    }

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
            let ptr = unsafe { pd_macaroon_verify_json(c.as_ptr(), bad.len()) };
            assert!(!ptr.is_null());
            let out = unsafe { std::ffi::CStr::from_ptr(ptr) }
                .to_str()
                .unwrap()
                .to_string();
            unsafe { pd_string_free(ptr) };
            let resp: serde_json::Value = serde_json::from_str(&out).unwrap();
            assert_eq!(resp["ok"], false, "input {bad:?} should fail closed");
        }
        // null pointer
        let ptr = unsafe { pd_macaroon_verify_json(std::ptr::null(), 0) };
        assert!(!ptr.is_null());
        unsafe { pd_string_free(ptr) };
    }

    // `pd_schedule_dag_json` had zero coverage through the actual C-ABI
    // marshaling before this — `schedule.rs`'s own tests call the pure
    // function directly, never crossing the FFI boundary this export exists
    // to prove. These use `call_export` like the keystore tests above.
    #[test]
    fn ffi_schedule_linear_chain_matches_pure_function() {
        let req = json!({
            "nodes": [{"id":"a","estimate":2},{"id":"b","estimate":3},{"id":"c","estimate":1}],
            "edges": [{"from":"a","to":"b"},{"from":"b","to":"c"}]
        })
        .to_string();
        let resp: serde_json::Value =
            serde_json::from_str(&call_export(pd_schedule_dag_json, &req)).unwrap();
        assert_eq!(resp["ok"], true);
        assert_eq!(resp["makespan"], 6);
        assert_eq!(resp["criticalPath"], serde_json::json!(["a", "b", "c"]));
    }

    #[test]
    fn ffi_schedule_cycle_fails_closed_over_the_boundary() {
        let req = json!({
            "nodes": [{"id":"a","estimate":1},{"id":"b","estimate":1}],
            "edges": [{"from":"a","to":"b"},{"from":"b","to":"a"}]
        })
        .to_string();
        let resp: serde_json::Value =
            serde_json::from_str(&call_export(pd_schedule_dag_json, &req)).unwrap();
        assert_eq!(resp["ok"], false);
        assert_eq!(resp["cyclic"], true);
    }

    #[test]
    fn ffi_schedule_malformed_input_fails_closed_not_panics() {
        for bad in ["", "not json", "{\"nodes\":1}"] {
            let c = CString::new(bad).unwrap();
            let ptr = unsafe { pd_schedule_dag_json(c.as_ptr(), bad.len()) };
            assert!(
                !ptr.is_null(),
                "input {bad:?} should still yield a response, not null"
            );
            let out = unsafe { std::ffi::CStr::from_ptr(ptr) }
                .to_str()
                .unwrap()
                .to_string();
            unsafe { pd_string_free(ptr) };
            let resp: serde_json::Value = serde_json::from_str(&out).unwrap();
            assert_eq!(resp["ok"], false, "input {bad:?} should fail closed");
        }
        let ptr = unsafe { pd_schedule_dag_json(std::ptr::null(), 0) };
        assert!(!ptr.is_null());
        unsafe { pd_string_free(ptr) };
    }
}
