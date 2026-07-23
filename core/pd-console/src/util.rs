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

/// Format an already-computed *duration in seconds* as a compact human span:
/// "now", "45s", "8m", "3h", "5d". Unlike [`age_short`], the input is a DURATION
/// (an elapsed count), NOT an absolute epoch timestamp — so it must never be run
/// through the `now - t` subtraction that `age_short` does. Passing a relay
/// `lastRunAgeSec` (e.g. 467) here yields "7m"; passing it to `age_short` would
/// treat 467 000ms as a 1970 timestamp and print a ~20000-day age. Negative /
/// garbage clamps to "—".
pub fn fmt_duration_secs(secs: i64) -> String {
    if secs < 0 {
        return "—".into();
    }
    match secs {
        0..=59 => {
            if secs == 0 {
                "now".into()
            } else {
                format!("{secs}s")
            }
        }
        60..=3599 => format!("{}m", secs / 60),
        3600..=86_399 => format!("{}h", secs / 3600),
        _ => format!("{}d", secs / 86_400),
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

    #[test]
    fn fmt_duration_secs_buckets() {
        // Sub-minute keeps seconds resolution (the "8 min ago" heartbeat case).
        assert_eq!(fmt_duration_secs(0), "now");
        assert_eq!(fmt_duration_secs(45), "45s");
        assert_eq!(fmt_duration_secs(59), "59s");
        assert_eq!(fmt_duration_secs(60), "1m");
        // The exact bug reproduction: relay lastRunAgeSec=467 → "7m", NOT 20657d.
        assert_eq!(fmt_duration_secs(467), "7m");
        assert_eq!(fmt_duration_secs(3599), "59m");
        assert_eq!(fmt_duration_secs(3600), "1h");
        assert_eq!(fmt_duration_secs(86_399), "23h");
        assert_eq!(fmt_duration_secs(86_400), "1d");
        assert_eq!(fmt_duration_secs(172_800), "2d");
        // Garbage clamps rather than printing a bogus span.
        assert_eq!(fmt_duration_secs(-5), "—");
    }
}
