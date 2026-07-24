//! Defensive JSON extraction + text helpers shared by all panes.
//!
//! The daemon's response schemas drift (fields appear, become null, change
//! type between versions). Panes therefore never derive strict Deserialize
//! structs for daemon payloads — they pull fields out of `serde_json::Value`
//! with these helpers, which tolerate missing keys, explicit nulls, and
//! number-vs-string drift. A pane can render stale-but-sane output from any
//! response; it can never hard-fail decoding.

use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

/// String field — "" when missing or null. Numbers stringify.
pub fn s(v: &Value, key: &str) -> String {
    match v.get(key) {
        Some(Value::String(x)) => x.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

/// Integer field — 0 when missing/null. Accepts numeric strings.
pub fn n(v: &Value, key: &str) -> i64 {
    match v.get(key) {
        Some(Value::Number(x)) => x.as_i64().unwrap_or(0),
        Some(Value::String(x)) => x.parse().unwrap_or(0),
        _ => 0,
    }
}

/// Bool field — false when missing/null.
pub fn b(v: &Value, key: &str) -> bool {
    matches!(v.get(key), Some(Value::Bool(true)))
}

/// Array field — empty slice when missing/null/non-array.
pub fn arr<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    static EMPTY: &[Value] = &[];
    match v.get(key) {
        Some(Value::Array(a)) => a.as_slice(),
        _ => EMPTY,
    }
}

/// Char-safe truncation with ellipsis. Byte-slicing (`&s[..40]`) panics on
/// multibyte UTF-8 boundaries; this never does.
pub fn trunc(text: &str, max_chars: usize) -> String {
    let mut it = text.chars();
    let head: String = it.by_ref().take(max_chars).collect();
    if it.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
}

/// Relative age from an epoch-milliseconds timestamp: "now", "3m", "2h", "5d".
/// Returns "—" for zero/garbage. Timezone-free by construction.
pub fn age_short(epoch_ms: i64) -> String {
    if epoch_ms <= 0 {
        return "—".into();
    }
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let delta_s = (now_ms - epoch_ms).max(0) / 1000;
    match delta_s {
        0..=59 => "now".into(),
        60..=3599 => format!("{}m", delta_s / 60),
        3600..=86_399 => format!("{}h", delta_s / 3600),
        _ => format!("{}d", delta_s / 86_400),
    }
}

/// Minimal `block_on` for panes' gated-mutate tests, whose futures never
/// actually yield (the gated paths return before any real IO) — so a full
/// executor (tokio, futures) would be pure overhead just to poll once.
/// Shared here because `board_pane.rs` and `harbor_pane.rs` each defined a
/// byte-identical copy (code review caught the duplication on PR #3657).
#[cfg(test)]
pub(crate) fn block_on<F: std::future::Future>(mut fut: F) -> F::Output {
    use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};
    fn noop(_: *const ()) {}
    fn clone(_: *const ()) -> RawWaker {
        RawWaker::new(std::ptr::null(), &VTABLE)
    }
    static VTABLE: RawWakerVTable = RawWakerVTable::new(clone, noop, noop, noop);
    let waker = unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), &VTABLE)) };
    let mut cx = Context::from_waker(&waker);
    let mut fut = unsafe { std::pin::Pin::new_unchecked(&mut fut) };
    loop {
        if let Poll::Ready(v) = fut.as_mut().poll(&mut cx) {
            return v;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn s_tolerates_null_and_missing() {
        let v = json!({"a": "x", "b": null, "c": 7});
        assert_eq!(s(&v, "a"), "x");
        assert_eq!(s(&v, "b"), "");
        assert_eq!(s(&v, "c"), "7");
        assert_eq!(s(&v, "zzz"), "");
    }

    #[test]
    fn n_accepts_numbers_and_numeric_strings() {
        let v = json!({"a": 42, "b": "17", "c": null});
        assert_eq!(n(&v, "a"), 42);
        assert_eq!(n(&v, "b"), 17);
        assert_eq!(n(&v, "c"), 0);
    }

    #[test]
    fn arr_tolerates_everything() {
        let v = json!({"a": [1, 2], "b": null});
        assert_eq!(arr(&v, "a").len(), 2);
        assert!(arr(&v, "b").is_empty());
        assert!(arr(&v, "zzz").is_empty());
    }

    #[test]
    fn trunc_is_multibyte_safe() {
        assert_eq!(trunc("hello", 10), "hello");
        assert_eq!(trunc("hello world", 5), "hello…");
        // em-dash + accents — byte slicing would panic here
        assert_eq!(trunc("café — résumé", 6), "café —…");
    }

    #[test]
    fn age_short_buckets() {
        assert_eq!(age_short(0), "—");
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        assert_eq!(age_short(now_ms - 30_000), "now");
        assert_eq!(age_short(now_ms - 120_000), "2m");
        assert_eq!(age_short(now_ms - 7_200_000), "2h");
        assert_eq!(age_short(now_ms - 172_800_000), "2d");
    }
}
