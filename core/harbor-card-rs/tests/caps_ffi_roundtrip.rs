//! Integration coverage for the harbor enforcer's C-ABI exports
//! (`harbor_verify_caps_subset_json`, `harbor_constant_time_compare`) under a
//! REALISTIC multi-hop delegation chain and real daemon conditions.
//!
//! This is the one genuinely live production hot path in the repo:
//! `lib/arbiter.ts`'s `checkCapEscalation()` calls `verifyCapsSubset` over koffi
//! on every `LOCK_ACQUIRE` activity event. The in-crate `#[cfg(test)]` tests in
//! `lib.rs` prove single 2-element subset calls; they never model the multi-hop
//! delegation chain the arbiter actually walks, never run the export
//! concurrently (the daemon is multi-request), and never push non-UTF-8 bytes
//! across the boundary. These do.
//!
//! An integration test links the crate as an rlib and calls the
//! `#[no_mangle] pub extern "C"` exports directly, exercising the exact function
//! bodies (JSON parse, `catch_unwind`, null/len/utf8 guards) the cdylib exposes.
//! The real `dlopen`/koffi boundary AND the arbiter's activity-driven hot path
//! are covered on the TypeScript side by `tests/unit/arbiter-ffi-e2e.test.js`.

use harbor_card_rs::{harbor_constant_time_compare, harbor_verify_caps_subset_json};
use std::ffi::c_char;

/// Call `harbor_verify_caps_subset_json` exactly as koffi does: two
/// (ptr, byte-len) JSON-array pairs. Returns whether `sub ⊆ root`.
fn ffi_subset(root: &[&str], sub: &[&str]) -> bool {
    let root_json = serde_json::to_string(root).unwrap();
    let sub_json = serde_json::to_string(sub).unwrap();
    unsafe {
        harbor_verify_caps_subset_json(
            root_json.as_ptr() as *const c_char,
            root_json.len(),
            sub_json.as_ptr() as *const c_char,
            sub_json.len(),
        )
    }
}

/// The pure-Rust ground truth the FFI must reproduce byte-for-byte.
fn pure_subset(root: &[&str], sub: &[&str]) -> bool {
    let root_v: Vec<String> = root.iter().map(|s| s.to_string()).collect();
    let sub_v: Vec<String> = sub.iter().map(|s| s.to_string()).collect();
    harbor_card_rs::HarborCardVerifier::verify_capability_subset(&root_v, &sub_v)
}

#[test]
fn ffi_subset_matches_pure_function_along_a_realistic_delegation_chain() {
    // A 6-hop attenuation chain modelling a real harbor-card delegation: the
    // root operator hands progressively NARROWER capability sets down the chain.
    // Every hop must be a subset of its immediate parent (the I4 invariant).
    let chain: Vec<Vec<&str>> = vec![
        vec![
            "db:write",
            "db:read",
            "fs:critical",
            "spawn:agent",
            "net:egress",
            "presence:write",
        ],
        vec![
            "db:write",
            "db:read",
            "fs:critical",
            "spawn:agent",
            "net:egress",
        ],
        vec!["db:write", "db:read", "fs:critical", "spawn:agent"],
        vec!["db:read", "fs:critical", "spawn:agent"],
        vec!["db:read", "fs:critical"],
        vec!["db:read"],
    ];

    // Per-hop parity: FFI verdict == pure verdict, and a well-formed attenuation
    // chain is all-true.
    for i in 1..chain.len() {
        let parent = &chain[i - 1];
        let child = &chain[i];
        let ffi = ffi_subset(parent, child);
        let pure = pure_subset(parent, child);
        assert_eq!(ffi, pure, "hop {i}: FFI and pure subset must agree");
        assert!(
            ffi,
            "hop {i} of a valid attenuation chain must be a subset of its parent"
        );
    }
}

#[test]
fn ffi_catches_a_non_monotonic_middle_hop_escalation() {
    // The v6 attack: `final ⊆ root`, but a MIDDLE hop briefly grabs `admin`.
    // A per-hop verifier (what the arbiter runs) must catch the escalation at
    // that exact hop — a final-vs-root check would miss it.
    let chain: Vec<Vec<&str>> = vec![
        vec!["db:read", "db:write"],
        vec!["db:read", "db:write", "admin"], // hop 1: ESCALATION
        vec!["db:read"],                      // hop 2: back within root
    ];
    let hop1 = ffi_subset(&chain[0], &chain[1]);
    let hop2 = ffi_subset(&chain[1], &chain[2]);
    assert!(
        !hop1,
        "the escalating middle hop must fail the subset check over the FFI"
    );
    assert!(hop2, "the final hop attenuates its immediate parent");
    // A naive final-vs-root check would wrongly pass — prove the trap is real.
    assert!(
        ffi_subset(&chain[0], &chain[2]),
        "final ⊆ root holds, which is exactly why per-hop checking is required"
    );
    // Parity with the pure function on every one of these decisions.
    assert_eq!(hop1, pure_subset(&chain[0], &chain[1]));
    assert_eq!(hop2, pure_subset(&chain[1], &chain[2]));
}

#[test]
fn ffi_exports_are_thread_safe_under_concurrent_calls() {
    // The daemon calls the enforcer from many requests at once. Both exports are
    // pure + `catch_unwind`-wrapped, so concurrent callers must all agree.
    let mut handles = Vec::new();
    for t in 0..16 {
        handles.push(std::thread::spawn(move || {
            for _ in 0..128 {
                // A valid subset, an escalation, and a constant-time compare —
                // each thread builds its own buffers (no shared pointer).
                assert!(ffi_subset(&["a", "b", "c"], &["a", "c"]));
                assert!(!ffi_subset(&["a", "b"], &["a", "b", "root"]));
                let secret = format!("token-{t}");
                let same = unsafe {
                    harbor_constant_time_compare(
                        secret.as_ptr(),
                        secret.len(),
                        secret.as_ptr(),
                        secret.len(),
                    )
                };
                assert!(same, "identical secrets must compare equal across threads");
                let other = b"different-token";
                let diff = unsafe {
                    harbor_constant_time_compare(
                        secret.as_ptr(),
                        secret.len(),
                        other.as_ptr(),
                        other.len(),
                    )
                };
                assert!(!diff, "distinct secrets must compare unequal");
            }
        }));
    }
    for h in handles {
        h.join()
            .expect("enforcer FFI thread panicked — the exports must be panic-free");
    }
}

#[test]
fn ffi_subset_fails_closed_on_hostile_buffers() {
    // Malformed JSON — parse fails => false (an escalation must not slip through
    // on a garbled payload).
    let sub = b"[\"db:read\"]";
    let bad = b"not json at all";
    assert!(
        !unsafe {
            harbor_verify_caps_subset_json(
                bad.as_ptr() as *const c_char,
                bad.len(),
                sub.as_ptr() as *const c_char,
                sub.len(),
            )
        },
        "malformed root JSON must fail closed"
    );

    // Non-UTF-8 root bytes — the utf8 guard must reject before any parse.
    let non_utf8: [u8; 4] = [0xff, 0xfe, 0x01, 0x80];
    assert!(
        !unsafe {
            harbor_verify_caps_subset_json(
                non_utf8.as_ptr() as *const c_char,
                non_utf8.len(),
                sub.as_ptr() as *const c_char,
                sub.len(),
            )
        },
        "non-UTF-8 root must fail closed"
    );

    // Null pointer / zero length — the "no data" call must be false, not a crash.
    assert!(
        !unsafe {
            harbor_verify_caps_subset_json(
                std::ptr::null(),
                0,
                sub.as_ptr() as *const c_char,
                sub.len(),
            )
        },
        "null root must fail closed"
    );

    // constant-time compare: oversized (> 1024) input is rejected as false
    // (a DoS guard), and null is false.
    let big = vec![0u8; 2048];
    assert!(
        !unsafe { harbor_constant_time_compare(big.as_ptr(), big.len(), big.as_ptr(), big.len()) },
        "oversized constant-time input must be rejected"
    );
    assert!(
        !unsafe { harbor_constant_time_compare(std::ptr::null(), 4, std::ptr::null(), 4) },
        "null constant-time input must be false"
    );
}
