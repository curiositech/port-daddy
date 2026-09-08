//! Integration coverage for the planner scheduler's C-ABI export
//! (`pd_schedule_dag_json`) under REALISTIC production shapes and real daemon
//! conditions (ADR-0086 / ADR-0054).
//!
//! Why this exists on top of the in-crate `#[cfg(test)]` tests in `ffi.rs`:
//! those call the export in-process on 2–3 node toy chains where every node is
//! on the critical path (slack 0 everywhere), so a bug that scrambled the
//! `slack`/`critical`/`latestStart` fields during the JSON marshal would sail
//! straight through. The daemon does not schedule 3-node chains — it schedules
//! fan-out/fan-in DAGs with real parallelism and real slack. These tests drive
//! a 12-node DAG through the FULL `schedule() -> FFI JSON marshal -> unmarshal`
//! round trip and assert byte-identity against the pure function, then hammer
//! the export from many threads (the daemon is multi-request) and feed it the
//! corrupted / truncated / non-UTF-8 / oversized buffers a real FFI caller can
//! produce — proving it fails CLOSED across the boundary rather than crashing.
//!
//! An integration test (`tests/*.rs`) links the crate as an rlib and calls the
//! `#[no_mangle] pub extern "C"` exports directly. This exercises the exact
//! function bodies (marshaling, `catch_unwind`, the null/len/utf8/parse guards)
//! that the cdylib exposes; the real `dlopen`/koffi boundary is covered on the
//! TypeScript side by `tests/unit/planner-schedule-ffi-roundtrip.test.js`.

use pd_anchor::ffi::{pd_schedule_dag_json, pd_string_free};
use pd_anchor::schedule::{schedule, SchedEdge, SchedNode};
use serde_json::{json, Value};
use std::ffi::{c_char, CStr, CString};

/// Call the C-ABI export exactly as a foreign caller would: hand it a
/// NUL-terminated buffer + byte length, decode the heap string it returns, and
/// free it with the library's own `pd_string_free`. Returns the parsed JSON.
fn call_schedule(req: &str) -> Value {
    let c = CString::new(req).expect("request has no interior NUL");
    let ptr = unsafe { pd_schedule_dag_json(c.as_ptr(), req.len()) };
    assert!(!ptr.is_null(), "encodable request must never return null");
    let out = unsafe { CStr::from_ptr(ptr) }
        .to_str()
        .expect("response is valid UTF-8")
        .to_string();
    unsafe { pd_string_free(ptr) };
    serde_json::from_str(&out).expect("response is valid JSON")
}

fn n(id: &str, est: i64) -> SchedNode {
    SchedNode {
        id: id.into(),
        estimate: Some(est),
    }
}

fn e(from: &str, to: &str) -> SchedEdge {
    SchedEdge {
        from: from.into(),
        to: to.into(),
    }
}

/// A realistic 12-node build/release DAG: a root fanning out into three
/// parallel branches that fan back in through a diamond, plus a deliberately
/// short side branch (`g -> h`) that carries POSITIVE slack, so the marshaled
/// per-node `slack`/`critical` fields are actually load-bearing (unlike a
/// linear chain where everything is critical). Estimates are chosen so the
/// critical path is unambiguous and at least one node is genuinely slack.
fn realistic_dag() -> (Vec<SchedNode>, Vec<SchedEdge>) {
    let nodes = vec![
        n("root", 1),
        n("compile_a", 5),
        n("compile_b", 2),
        n("compile_c", 1),
        n("link_ab", 4), // fan-in of compile_a + compile_b
        n("link_bc", 2), // fan-in of compile_b + compile_c
        n("test_heavy", 6),
        n("test_light", 1), // short side branch — should have slack
        n("bundle", 3),
        n("sign", 1),
        n("side_probe", 1), // hangs off compile_c, low-effort => slack
        n("release", 2),
    ];
    let edges = vec![
        e("root", "compile_a"),
        e("root", "compile_b"),
        e("root", "compile_c"),
        e("compile_a", "link_ab"),
        e("compile_b", "link_ab"),
        e("compile_b", "link_bc"),
        e("compile_c", "link_bc"),
        e("link_ab", "test_heavy"),
        e("link_bc", "test_light"),
        e("compile_c", "side_probe"),
        e("test_heavy", "bundle"),
        e("test_light", "bundle"),
        e("side_probe", "bundle"),
        e("bundle", "sign"),
        e("sign", "release"),
        e("test_heavy", "release"),
    ];
    (nodes, edges)
}

#[test]
fn ffi_roundtrip_matches_pure_function_on_a_realistic_fanout_dag() {
    let (nodes, edges) = realistic_dag();

    // Ground truth: the pure function, serialized the same way the FFI does.
    let expected = serde_json::to_value(schedule(&nodes, &edges)).unwrap();

    // Marshal the request exactly as the koffi caller does.
    let req = json!({ "nodes": nodes_json(&nodes), "edges": edges_json(&edges) }).to_string();
    let got = call_schedule(&req);

    assert_eq!(
        got, expected,
        "FFI round trip must be byte-identical to the pure scheduler across EVERY field \
         (ok/cyclic/makespan/order/nodes[slack,critical,earliest*,latest*]/criticalPath)"
    );

    // The DAG is only a meaningful test if it actually has the rich shape we
    // claim — a linear chain (all-critical, zero-slack) would silently pass a
    // broken slack marshal. Assert the shape is non-degenerate.
    assert_eq!(got["ok"], true);
    assert_eq!(got["cyclic"], false);
    let sched_nodes = got["nodes"].as_array().unwrap();
    assert_eq!(sched_nodes.len(), 12, "all 12 nodes survive the boundary");
    let with_slack = sched_nodes
        .iter()
        .filter(|nd| nd["slack"].as_i64().unwrap() > 0)
        .count();
    let critical = sched_nodes
        .iter()
        .filter(|nd| nd["critical"].as_bool().unwrap())
        .count();
    assert!(
        with_slack >= 1,
        "the DAG must exercise a non-zero-slack node, else it can't catch a slack-marshal bug"
    );
    assert!(
        critical >= 3,
        "critical path must be a real chain, not a single node"
    );
    assert!(
        got["criticalPath"].as_array().unwrap().len() >= 3,
        "criticalPath must be a genuine multi-hop chain"
    );
}

#[test]
fn ffi_is_thread_safe_under_concurrent_calls() {
    // The daemon services many requests at once; the export holds no shared
    // mutable state and wraps each call in catch_unwind, so N threads calling it
    // in parallel must each get the one true answer, with no torn output.
    let (nodes, edges) = realistic_dag();
    let reference = call_schedule(
        &json!({ "nodes": nodes_json(&nodes), "edges": edges_json(&edges) }).to_string(),
    );

    let req = json!({ "nodes": nodes_json(&nodes), "edges": edges_json(&edges) }).to_string();
    let mut handles = Vec::new();
    for _ in 0..16 {
        // Each thread owns its own request buffer — no pointer is shared.
        let req = req.clone();
        let expected = reference.clone();
        handles.push(std::thread::spawn(move || {
            for _ in 0..64 {
                let got = call_schedule(&req);
                assert_eq!(
                    got, expected,
                    "concurrent FFI call produced a divergent/torn result"
                );
            }
        }));
    }
    for h in handles {
        h.join().expect("scheduler FFI thread panicked — a panic crossed no boundary but the export must be panic-free");
    }
}

#[test]
fn ffi_fails_closed_on_corrupted_and_hostile_buffers() {
    // A truncated length (claim fewer bytes than the JSON needs) — the parse
    // must fail cleanly, not read past the buffer or crash.
    let full = json!({ "nodes": [{"id":"a","estimate":1}], "edges": [] }).to_string();
    let c = CString::new(full.clone()).unwrap();
    let truncated_len = full.len() / 2;
    let ptr = unsafe { pd_schedule_dag_json(c.as_ptr(), truncated_len) };
    assert!(!ptr.is_null());
    let out = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap().to_string();
    unsafe { pd_string_free(ptr) };
    let resp: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(
        resp["ok"], false,
        "a truncated buffer must fail closed, not crash"
    );

    // Non-UTF-8 bytes with a valid length — the utf8 guard must catch it.
    // 0xff,0xfe,0x01,0x80 is invalid UTF-8 and contains no interior NUL, so
    // CString accepts it and hands the export a genuinely non-UTF-8 buffer.
    let raw: [u8; 4] = [0xff, 0xfe, 0x01, 0x80];
    let cbad = CString::new(&raw[..]).unwrap();
    let ptr = unsafe { pd_schedule_dag_json(cbad.as_ptr() as *const c_char, raw.len()) };
    assert!(!ptr.is_null());
    let out = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap().to_string();
    unsafe { pd_string_free(ptr) };
    let resp: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(resp["ok"], false, "non-UTF-8 input must fail closed");

    // Oversized request (> MAX_REQUEST_BYTES = 256 KiB) — rejected fail-fast
    // before any allocation/parse.
    let huge = "x".repeat(300 * 1024);
    let chuge = CString::new(huge.clone()).unwrap();
    let ptr = unsafe { pd_schedule_dag_json(chuge.as_ptr(), huge.len()) };
    assert!(!ptr.is_null());
    let out = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap().to_string();
    unsafe { pd_string_free(ptr) };
    let resp: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(
        resp["ok"], false,
        "oversized input must be rejected fail-closed"
    );

    // Null pointer with zero length — the classic "no data" call.
    let ptr = unsafe { pd_schedule_dag_json(std::ptr::null(), 0) };
    assert!(
        !ptr.is_null(),
        "even a null request yields a response, never a null return"
    );
    unsafe { pd_string_free(ptr) };
}

#[test]
fn ffi_cycle_over_the_boundary_matches_pure_function() {
    // A realistic-sized graph that happens to contain a back-edge must be
    // rejected as cyclic identically whether computed purely or over the FFI.
    let (mut nodes, mut edges) = realistic_dag();
    nodes.push(n("loop_node", 1));
    // Introduce a cycle: release -> loop_node -> root (back to the top).
    edges.push(e("release", "loop_node"));
    edges.push(e("loop_node", "root"));

    let expected = serde_json::to_value(schedule(&nodes, &edges)).unwrap();
    let got = call_schedule(
        &json!({ "nodes": nodes_json(&nodes), "edges": edges_json(&edges) }).to_string(),
    );
    assert_eq!(got, expected);
    assert_eq!(got["ok"], false);
    assert_eq!(
        got["cyclic"], true,
        "the cycle must be reported cyclic across the boundary"
    );
}

// ── request-marshaling helpers (mirror the koffi request shape) ──────────────

fn nodes_json(nodes: &[SchedNode]) -> Value {
    Value::Array(
        nodes
            .iter()
            .map(|nd| json!({ "id": nd.id, "estimate": nd.estimate }))
            .collect(),
    )
}

fn edges_json(edges: &[SchedEdge]) -> Value {
    Value::Array(
        edges
            .iter()
            .map(|ed| json!({ "from": ed.from, "to": ed.to }))
            .collect(),
    )
}
