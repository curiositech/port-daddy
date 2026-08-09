use crate::berths::{choose_default, STABLE_PORT, Berth};

#[test]
fn test_choose_default_stable_reachable() {
    let berths = vec![];
    let result = choose_default(true, &berths);
    assert_eq!(result, format!("http://127.0.0.1:{STABLE_PORT}"));
}

#[test]
fn test_choose_default_fallback_to_dev() {
    let berths = vec![Berth { canonical: false, port: 9886 }];
    let result = choose_default(false, &berths);
    assert_eq!(result, "http://127.0.0.1:9886");
}

#[test]
fn test_choose_default_no_dev() {
    let berths = vec![];
    let result = choose_default(false, &berths);
    assert_eq!(result, format!("http://127.0.0.1:{STABLE_PORT}"));
}