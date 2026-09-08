use pd_anchor::ffi::{pd_fleetbar_process_trust_json, pd_string_free};
use pd_anchor::process_trust::FLEETBAR_DESIGNATED_REQUIREMENT;
use serde_json::Value;
use std::ffi::CStr;

fn call(pid: i32) -> Value {
    let pointer = pd_fleetbar_process_trust_json(pid);
    assert!(!pointer.is_null());
    let response = unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .unwrap()
        .to_owned();
    unsafe { pd_string_free(pointer) };
    serde_json::from_str(&response).unwrap()
}

#[test]
fn requirement_is_exact_and_not_caller_controlled() {
    assert!(FLEETBAR_DESIGNATED_REQUIREMENT.contains("identifier \"ai.portdaddy.FleetBar\""));
    assert!(FLEETBAR_DESIGNATED_REQUIREMENT.contains("subject.OU] = \"P5H9P59X2M\""));
    assert!(FLEETBAR_DESIGNATED_REQUIREMENT.contains("1.2.840.113635.100.6.1.13"));
}

#[test]
fn invalid_pid_fails_closed() {
    let response = call(-1);
    assert_eq!(response["ok"], false);
    assert_eq!(response["code"], "INVALID_PID");
    assert!(response["trust"].is_null());
}

#[cfg(target_os = "macos")]
#[test]
fn exited_pid_and_unsigned_test_runner_fail_closed() {
    let exited = call(i32::MAX);
    assert_eq!(exited["ok"], false);
    assert_eq!(exited["code"], "PROCESS_UNAVAILABLE");
    assert!(exited["trust"].is_null());

    let runner = call(std::process::id() as i32);
    assert_eq!(runner["ok"], false);
    assert!(runner["trust"].is_null());
}

#[cfg(not(target_os = "macos"))]
#[test]
fn non_macos_is_typed_unsupported() {
    let response = call(std::process::id() as i32);
    assert_eq!(response["ok"], false);
    assert_eq!(response["code"], "UNSUPPORTED_PLATFORM");
    assert!(response["trust"].is_null());
}

/// Release-packaging witness only. The harness must launch an exact signed,
/// notarized, hardened FleetBar helper and pass its live PID. Unit tests never
/// fake a production-positive trust verdict.
#[cfg(target_os = "macos")]
#[test]
#[ignore = "requires a live Developer-ID-signed and notarized FleetBar helper"]
fn signed_release_helper_satisfies_live_process_policy() {
    let pid: i32 = std::env::var("PD_RELEASE_SIGNED_FLEETBAR_PID")
        .expect("set PD_RELEASE_SIGNED_FLEETBAR_PID from the release harness")
        .parse()
        .expect("release helper PID must be an i32");
    let response = call(pid);
    assert_eq!(response["ok"], true, "{response}");
    assert_eq!(response["code"], "VERIFIED");
    assert_eq!(response["trust"]["pid"], pid);
    assert_eq!(response["trust"]["notarized"], true);
    assert_eq!(response["trust"]["hardened_runtime"], true);
    assert_eq!(response["trust"]["debug_privileges"], false);
    assert_eq!(response["trust"]["unsafe_dyld_environment"], false);
}
