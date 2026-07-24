//! The C ABI of the security kernel — the one place `pd-anchor`'s Rust logic is
//! reachable from outside the address space that compiled it (ADR-0054: the kernel
//! is canonical and is *called over FFI*, never re-derived in the daemon).
//!
//! # Why this boundary exists
//!
//! The TypeScript daemon loads `libpd_anchor.{dylib,so}` via koffi and calls these
//! `extern "C"` exports instead of re-implementing the macaroon construction and the
//! critical-path scheduler in TS. The deprecated `lib/macaroon` and
//! `lib/planner-schedule.ts` remain as *byte-parity fallbacks* for source installs
//! and CI, where the dylib is not built (shared test vectors lock the two impls to
//! identical output, so the FFI is a performance/trust upgrade, never a behavior
//! change). The koffi loaders live in `lib/macaroon-ffi.ts` and
//! `lib/planner-schedule.ts`; both degrade gracefully to the TS path when
//! `koffi.load` throws.
//!
//! # The wire convention (mirrors `core/harbor-card-rs/src/lib.rs`)
//!
//! Structured data crosses as **JSON, never as a Rust struct** (Rust's `repr` is not
//! a stable ABI). Every export has the same shape:
//! `fn(req: *const c_char, len: usize) -> *mut c_char`. The request is `len` bytes of
//! UTF-8 JSON borrowed from the caller; the response is a **heap-owned** C string this
//! library allocates and hands back, which the caller must return with
//! [`pd_string_free`] exactly once (see that function for the leak-not-crash contract).
//!
//! # The five-guard fail-closed discipline (read this before touching an export)
//!
//! A Rust panic that unwinds across an `extern "C"` frame is **undefined behavior** —
//! it can corrupt the host process, not merely error. So every export body is a total
//! function of its raw inputs: it converts *every* way the input can be malformed into
//! a clean error response, and it wraps the whole thing in `catch_unwind` so even an
//! unforeseen panic becomes a sentinel rather than UB. The guards, in order, are:
//!
//! 1. **null pointer** (`req.is_null()`) → error JSON. koffi can hand us null.
//! 2. **empty or oversized** (`len == 0 || len > MAX_REQUEST_BYTES`) → error JSON.
//!    The upper bound fails a pathological length fast, before any allocation.
//! 3. **not UTF-8** (`std::str::from_utf8`) → error JSON. Raw bytes need not be text.
//! 4. **not parseable** (`serde_json::from_str`) → error JSON carrying the parse error.
//! 5. **panic anywhere inside** (`catch_unwind`) → the outermost sentinel error JSON.
//!
//! "Fail closed" is literal here: on *any* malformed input the answer is a valid
//! `{"ok":false,...}` document (a denied authorization / a failed schedule), never a
//! crash and never a silent success. The only way to get null back is a catastrophic
//! allocation failure while encoding the response — the `respond` family is written
//! so that even an interior-NUL in the body degrades to a NUL-free static string, so in
//! practice null is unreachable and the koffi loaders treat a null return as a
//! kernel bug worth logging, not a routine "denied".
//!
//! # Two families of export
//!
//! - **Key-taking (byte-parity fallback):** [`pd_macaroon_verify_json`] and
//!   [`pd_schedule_dag_json`] are stateless — every key or graph they need arrives in
//!   the request. These mirror the TS fallbacks 1:1 and exist so the daemon can prefer
//!   Rust without moving key custody.
//! - **Key-custody (ADR-0057, the teeth):** [`pd_keystore_issue_grant_json`],
//!   [`pd_keystore_issue_discharge_json`], and [`pd_keystore_authorize_json`] route
//!   through [`crate::keystore`], where the root and caveat keys are generated and
//!   retained. **No forging material ever appears in a request or response** on this
//!   family — the daemon asks the kernel to issue/authorize and never sees the keys.

use crate::keystore;
use crate::macaroon::{check_caveat, verify, Macaroon, RentVerdict, RequestContext, DISCHARGE_TTL_MS};
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

/// Verify a macaroon push grant against a caller-supplied root key.
///
/// This is the **key-taking** verifier — the byte-parity fallback path. The TS side
/// that invokes it is `verifyPushGrantPreferKernel` in `lib/macaroon-ffi.ts`, which
/// loads the dylib, calls this export, and (only if the dylib is absent) falls back to
/// the deprecated pure-TS verifier in `lib/macaroon`. Because the caller passes the
/// root key here, this export moves no custody into the kernel; the custody family
/// below ([`pd_keystore_authorize_json`]) is the version where the keys never leave.
///
/// # Wire contract
///
/// Input JSON:
/// ```json
/// {
///   "macaroon":     { /* the grant Macaroon */ },
///   "root_key_hex": "<hex of the 32-byte root key>",
///   "discharges":   [ /* zero or more discharge Macaroons, request-bound */ ],
///   "ctx": { "op": "push", "repo": "acme/api", "branch": "feat/x",
///            "host": null, "spend_usd": null, "session": "sess-1", "now_ms": 1500000 },
///   "caveat_keys": { "<caveat-id>": "<hex discharge key>" }
/// }
/// ```
/// Output JSON: `{ "ok": <bool>, "reason": "<human string>" }`. A null return means a
/// catastrophic response-encoding failure and nothing else; `lib/macaroon-ffi.ts` logs
/// null as a kernel bug rather than treating it as a denial.
///
/// # Worked example
///
/// Request (a paid, request-bound grant pushing to a non-protected branch):
/// ```json
/// { "macaroon": { "identifier": "g-1", "location": "pd://push", "caveats": [...], "signature_hex": "…" },
///   "root_key_hex": "70642d63616e6f6e6963616c2d726f6f742d6b65792d30303030303030303031",
///   "discharges": [ { "identifier": "rent:g-1", "caveats": [...], "signature_hex": "…" } ],
///   "ctx": { "op": "push", "repo": "curiositech/port-daddy", "branch": "feat/x", "session": "s1", "now_ms": 1500000 },
///   "caveat_keys": { "rent:g-1": "70642d63616e6f6e6963616c2d63617665…" } }
/// ```
/// Response: `{"ok":true,"reason":"verified"}`. Point `ctx.branch` at the protected
/// branch (`"main"`) and the same request returns `{"ok":false,"reason":"…deny branch…"}` —
/// a denial, not a crash.
///
/// # Fail-closed
///
/// Fails closed on every malformed input: null/empty/oversized request, non-UTF-8
/// bytes, unparseable JSON, non-hex `root_key_hex`, and any panic inside the verifier
/// all return `{"ok":false,...}` (see the module header's five-guard discipline). A bad
/// hex value inside `caveat_keys` silently drops that one key, so the third-party caveat
/// it would have resolved fails to discharge — again, closed.
///
/// # Wrapped pure logic
///
/// The actual signature recomputation lives in [`crate::macaroon::verify`], a pure Rust
/// function with no FFI in its signature; that is where the per-hop discharge discipline
/// and the request-binding check are unit-tested (see that module's tests). This export
/// is only the JSON/pointer marshalling shell around it.
///
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

use crate::schedule::{schedule, ScheduleResult, SchedEdge, SchedNode};

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

/// Schedule a dependency DAG by the Critical Path Method (ADR-0086).
///
/// The TS caller is the `scheduleViaFfi`/`schedule` path in `lib/planner-schedule.ts`,
/// which prefers this export and falls back to its own byte-parity TS scheduler when the
/// dylib is absent; pd-console (the Rust GPUI Gantt) calls the underlying pure
/// [`crate::schedule::schedule`] natively. All three produce identical output because the
/// traversal is id-ordered and deterministic (see `schedule.rs`).
///
/// # Wire contract
///
/// Input JSON: `{ "nodes": [ { "id": "a", "estimate": 2 }, … ], "edges": [ { "from": "a", "to": "b" }, … ] }`.
/// An edge `{from,to}` means `from` must finish before `to` starts (`from` is the
/// predecessor); a missing or non-positive `estimate` is treated as duration 0. Output
/// JSON is the full `ScheduleResult`:
/// `{ ok, reason, cyclic, makespan, order, nodes:[{id,earliestStart,earliestFinish,latestStart,latestFinish,slack,critical}], criticalPath }`
/// (camelCase — the struct is `#[serde(rename_all = "camelCase")]`). Null return means only
/// a catastrophic response-encoding failure.
///
/// # Worked example
///
/// Request: `{"nodes":[{"id":"a","estimate":2},{"id":"b","estimate":3},{"id":"c","estimate":1}],`
/// `"edges":[{"from":"a","to":"b"},{"from":"b","to":"c"}]}` — a linear chain.
/// Response (abridged): `{"ok":true,"cyclic":false,"makespan":6,"order":["a","b","c"],`
/// `"criticalPath":["a","b","c"], "nodes":[…]}` — every node is on the critical path and the
/// makespan is `2+3+1`.
///
/// # Fail-closed
///
/// Malformed input yields `ok:false`, never a crash: null/empty/oversized request,
/// non-UTF-8, or unparseable JSON return an error `ScheduleResult`; and the scheduler
/// itself fails closed on duplicate node ids, edges to unknown nodes, and cycles (a cycle
/// additionally sets `cyclic:true`). See the doctest on [`crate::schedule::schedule`] for
/// the pure-Rust version of these guarantees.
///
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

/// Parse the daemon's rent verdict string into a [`RentVerdict`], accepting either the
/// hyphen or underscore spelling of `rent-due`. Returns `None` for anything unrecognized —
/// and [`pd_keystore_issue_discharge_json`] turns that `None` into a fail-closed error, so a
/// typo or an attacker-chosen string can never be mistaken for `Paid`.
///
/// This is a small, total, pure helper — no FFI, no I/O — so it is the one piece of this
/// module that carries a real runnable doctest (`cargo test --doc`). The `extern "C"` exports
/// cannot: their raw-pointer signatures need `unsafe` and a live C string, so they are
/// documented with worked JSON examples in prose instead.
///
/// # Examples
///
/// ```
/// use pd_anchor::ffi::parse_verdict;
/// use pd_anchor::macaroon::RentVerdict;
///
/// // Both spellings of the "rent due" verdict are accepted.
/// assert_eq!(parse_verdict("rent-due"), Some(RentVerdict::RentDue));
/// assert_eq!(parse_verdict("rent_due"), Some(RentVerdict::RentDue));
/// assert_eq!(parse_verdict("paid"), Some(RentVerdict::Paid));
///
/// // Only "paid" ever unlocks a discharge; every other known verdict is a non-Paid state.
/// assert_eq!(parse_verdict("idle"), Some(RentVerdict::Idle));
/// assert_eq!(parse_verdict("stale"), Some(RentVerdict::Stale));
///
/// // Anything unrecognized fails closed (the caller rejects it, never defaults to Paid).
/// assert_eq!(parse_verdict("Paid"), None);           // case-sensitive on purpose
/// assert_eq!(parse_verdict("definitely-paid"), None);
/// assert_eq!(parse_verdict(""), None);
/// ```
pub fn parse_verdict(s: &str) -> Option<RentVerdict> {
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

/// Issue a push grant whose keys the kernel mints and keeps (ADR-0057, custody family).
///
/// The kernel generates the root key and the caveat (discharge) key, mints the grant, stores
/// both keys in [`crate::keystore`] keyed by a fresh `grant_id`, and returns only the grant
/// macaroon and that id. **No key is ever in the response** — that is the whole point of this
/// family versus [`pd_macaroon_verify_json`]. This export is the FFI shell over
/// [`crate::keystore::issue_grant`]. It is wired for ADR-0057 enforcement slice 1; the daemon
/// migrates onto it (and off the key-taking verify path) in slice 2, so there is not yet a
/// koffi caller in `lib/` — the in-process Rust tests below exercise it end-to-end.
///
/// # Wire contract
///
/// Input JSON: `{ "repo": "acme/api", "session": "sess-1", "expires_ms": 2000060000, "protected_branch": "main" }`.
/// Output JSON: `{ "ok": true, "grant_id": "<hex>", "macaroon": { … } }` on success, or
/// `{ "ok": false, "reason": "<why>" }` on failure.
///
/// # Worked example
///
/// Request: `{"repo":"acme/api","session":"sess-ffi","expires_ms":2060000,"protected_branch":"main"}`.
/// Response: `{"ok":true,"grant_id":"9f3c…","macaroon":{"identifier":"9f3c…","location":"pd://push","caveats":[…],"signature_hex":"…"}}`.
/// Feed that `grant_id` to [`pd_keystore_issue_discharge_json`] to obtain a discharge once rent
/// is paid.
///
/// # Fail-closed
///
/// Null/empty/oversized/non-UTF-8/unparseable requests return `{"ok":false,...}`; a keystore
/// error (e.g. RNG failure while generating keys) also returns `{"ok":false,...}`; a panic is
/// caught and returned as `internal error`. Never a crash.
///
/// # Safety
/// `req` must be null or point to `len` readable bytes (the koffi C-ABI contract).
#[no_mangle]
pub unsafe extern "C" fn pd_keystore_issue_grant_json(req: *const c_char, len: usize) -> *mut c_char {
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
            Ok((m, grant_id)) => respond_value(json!({"ok": true, "grant_id": grant_id, "macaroon": m})),
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

/// Mint a discharge for a stored grant — and ONLY when rent is `Paid` (ADR-0057).
///
/// This is where custody earns its keep: the caveat key is read from the kernel store, never
/// supplied by the caller, and a discharge is minted only if the verdict parses to
/// [`RentVerdict::Paid`]. Any other verdict — or an unknown/revoked grant — yields no discharge,
/// which the gate reads as "not authorized". The verdict string is parsed by [`parse_verdict`]
/// (see its doctest); the discharge itself is minted by [`crate::keystore::issue_discharge`].
/// Like the rest of this family it has no koffi caller yet (slice 2 wiring); the tests below
/// drive it in-process.
///
/// # Wire contract
///
/// Input JSON: `{ "grant_id": "<hex>", "verdict": "paid"|"rent-due"|"idle"|"stale", "now_ms": 2000000, "ttl_ms": 1200000 }`
/// (`ttl_ms` is optional and defaults to [`crate::macaroon::DISCHARGE_TTL_MS`]). Output JSON:
/// `{ "ok": <bool>, "discharge": <Macaroon>|null, "reason": "<string>" }`.
///
/// # Worked example
///
/// Paid — request `{"grant_id":"9f3c…","verdict":"paid","now_ms":2000000}` →
/// `{"ok":true,"discharge":{"identifier":"rent:9f3c…","caveats":[…],"signature_hex":"…"},"reason":"discharged"}`.
///
/// Not paid — request `{"grant_id":"9f3c…","verdict":"rent-due","now_ms":2000000}` →
/// `{"ok":false,"discharge":null,"reason":"no discharge (rent not paid, or unknown/revoked grant)"}`.
/// The push that would have used this discharge is therefore refused.
///
/// # Fail-closed
///
/// Malformed request, unknown verdict string, unknown/revoked grant, or a non-`Paid` verdict all
/// produce a no-discharge response; a panic is caught and returned as `internal error`. The
/// keystore never mints a discharge from a verdict it did not recognize.
///
/// # Safety
/// `req` must be null or point to `len` readable bytes (the koffi C-ABI contract).
#[no_mangle]
pub unsafe extern "C" fn pd_keystore_issue_discharge_json(req: *const c_char, len: usize) -> *mut c_char {
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

/// Authorize a push using the kernel-held keys, looked up by the grant's own identifier (ADR-0057).
///
/// The custody-family counterpart to [`pd_macaroon_verify_json`]: the daemon presents the grant,
/// its request-bound discharges, and the request context — but **no keys**. The kernel looks the
/// root and caveat keys up in [`crate::keystore`] by `macaroon.identifier` and runs the same
/// per-hop verification via [`crate::keystore::authorize`]. So a compromised daemon cannot forge
/// authorization: it never holds the material to mint or re-sign. No koffi caller yet (slice 2);
/// the `keystore_custody_roundtrip_carries_no_keys` test below proves the whole issue → discharge
/// → authorize loop over the FFI with no key in any payload.
///
/// # Wire contract
///
/// Input JSON: `{ "macaroon": { … }, "discharges": [ … ], "ctx": { "op", "repo", "branch", "host",
/// "spend_usd", "session", "now_ms" } }`. Output JSON: `{ "ok": <bool>, "reason": "<string>" }`.
///
/// # Worked example
///
/// Request: `{"macaroon":{"identifier":"9f3c…",…},"discharges":[{…request-bound…}],`
/// `"ctx":{"op":"push","repo":"acme/api","branch":"feat/x","session":"sess-ffi","now_ms":2000000}}`.
/// Response: `{"ok":true,"reason":"verified"}` when the grant is known, unrevoked, rent-discharged,
/// and the context satisfies every caveat. An unknown grant returns `{"ok":false,"reason":"unknown grant"}`;
/// a revoked one, `{"ok":false,"reason":"grant has been revoked"}`.
///
/// # Fail-closed
///
/// Malformed request, unknown/revoked grant, missing/invalid discharge, or any caveat violation
/// all return `{"ok":false,...}`; a panic is caught and returned as `internal error`. Never a crash.
///
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

/// Reclaim a string this library handed out. **The caller MUST call this exactly once for
/// every non-null pointer any export returned — no more, no less.**
///
/// Every JSON-out export allocates its response with `CString::into_raw`, which *leaks* the
/// allocation on purpose so the pointer can safely cross into C/TS. Ownership is now the
/// caller's, and the only way to give it back to Rust's allocator is to pass the pointer here:
/// this reconstitutes the `CString` with `from_raw` and drops it. The koffi loaders in
/// `lib/macaroon-ffi.ts` and `lib/planner-schedule.ts` do this in a `finally` so the string is
/// freed even when JSON parsing of the response throws.
///
/// Contract and consequences:
/// - **Forget to call it** → the response allocation leaks. RSS grows one string per call; the
///   host process keeps running (a leak, **not** a crash). This is the failure the `finally`
///   guards against.
/// - **Call it twice on the same pointer** → double free: undefined behavior. Don't.
/// - **Passing null is fine** and is a no-op, so callers need not null-check first.
///
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
    let out = unsafe { std::ffi::CStr::from_ptr(ptr) }.to_str().unwrap().to_string();
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
        assert!(!issue_req.contains("key"), "issue request must carry no key");
        let issued: serde_json::Value =
            serde_json::from_str(&call_export(pd_keystore_issue_grant_json, &issue_req)).unwrap();
        assert_eq!(issued["ok"], true);
        let grant_id = issued["grant_id"].as_str().unwrap().to_string();
        let grant: Macaroon = serde_json::from_value(issued["macaroon"].clone()).unwrap();

        let disc_req = json!({"grant_id": grant_id, "verdict":"paid", "now_ms": now}).to_string();
        let discharged: serde_json::Value =
            serde_json::from_str(&call_export(pd_keystore_issue_discharge_json, &disc_req)).unwrap();
        assert_eq!(discharged["ok"], true);
        let discharge: Macaroon = serde_json::from_value(discharged["discharge"].clone()).unwrap();

        let bound = grant.prepare_for_request(&discharge).unwrap();
        let auth_req = json!({
            "macaroon": grant,
            "discharges": [bound],
            "ctx": {"op":"push","repo":"acme/api","branch":"feat/x","session":"sess-ffi","now_ms": now}
        })
        .to_string();
        assert!(!auth_req.contains("root_key") && !auth_req.contains("caveat_key"),
            "authorize request must carry NO keys");
        let authorized: serde_json::Value =
            serde_json::from_str(&call_export(pd_keystore_authorize_json, &auth_req)).unwrap();
        assert_eq!(authorized["ok"], true, "paid+bound must authorize: {}", authorized["reason"]);
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
        )).unwrap();
        assert_eq!(discharged["ok"], false);
        assert!(discharged["discharge"].is_null(), "rent-due must yield no discharge");
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
}
