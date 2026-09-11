use pd_anchor::ffi::{pd_operator_presence_verify_json, pd_string_free};
use serde_json::{json, Value};
use std::ffi::{CStr, CString};

const PUBLIC_KEY: &str = "04f3385b5cd2dcc139e29e813df7609cdc2eddc16948aeebfcd946d14a32b11cc075fe887e81da93d221b3faa1c0c915cd8d9410d5cffc99714897367cb8f84bff";
const SIGNATURE: &str = "3045022100daa6fe68875717027c47581de53ba12b0f034e42801a0fc7eb0dc7a6e60e9f0502200dafedd299acbb67a7cf21448d47e16754ac51d217c2f84aa19c279000076789";
const MESSAGE_HEX: &str =
    "706f72742d6461646479206f70657261746f722070726573656e636520766563746f72207631";

fn call(request: &str) -> Value {
    let request = CString::new(request).unwrap();
    let pointer =
        unsafe { pd_operator_presence_verify_json(request.as_ptr(), request.as_bytes().len()) };
    assert!(!pointer.is_null());
    let response = unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .unwrap()
        .to_owned();
    unsafe { pd_string_free(pointer) };
    serde_json::from_str(&response).unwrap()
}

fn valid_request() -> Value {
    json!({
        "public_key_x963_hex": PUBLIC_KEY,
        "signature_der_hex": SIGNATURE,
        "challenge_hex": MESSAGE_HEX,
    })
}

#[test]
fn fixed_cryptokit_vector_round_trips_through_c_abi() {
    let response = call(&valid_request().to_string());
    assert_eq!(response["ok"], true);
    assert_eq!(response["code"], "VERIFIED");
}

#[test]
fn wrong_message_wrong_key_and_malformed_der_fail_closed() {
    let mut wrong_message = valid_request();
    wrong_message["challenge_hex"] = json!("00");
    assert_eq!(
        call(&wrong_message.to_string())["code"],
        "INVALID_SIGNATURE"
    );

    let mut wrong_key = valid_request();
    let mut key = hex::decode(PUBLIC_KEY).unwrap();
    key[32] ^= 1;
    wrong_key["public_key_x963_hex"] = json!(hex::encode(key));
    assert_eq!(call(&wrong_key.to_string())["code"], "INVALID_SIGNATURE");

    let mut malformed_signature = valid_request();
    malformed_signature["signature_der_hex"] = json!("010203");
    assert_eq!(
        call(&malformed_signature.to_string())["code"],
        "INVALID_SIGNATURE"
    );
}

#[test]
fn malformed_null_and_oversize_requests_return_error_json() {
    for request in ["", "not json", "{}"] {
        assert_eq!(call(request)["ok"], false);
    }

    let pointer = unsafe { pd_operator_presence_verify_json(std::ptr::null(), 0) };
    assert!(!pointer.is_null());
    let response: Value = unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .map(|raw| serde_json::from_str(raw).unwrap())
        .unwrap();
    unsafe { pd_string_free(pointer) };
    assert_eq!(response["ok"], false);

    let oversized = "x".repeat(256 * 1024 + 1);
    let request = CString::new(oversized).unwrap();
    let pointer =
        unsafe { pd_operator_presence_verify_json(request.as_ptr(), request.as_bytes().len()) };
    assert!(!pointer.is_null());
    let response: Value = unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .map(|raw| serde_json::from_str(raw).unwrap())
        .unwrap();
    unsafe { pd_string_free(pointer) };
    assert_eq!(response["ok"], false);
}
