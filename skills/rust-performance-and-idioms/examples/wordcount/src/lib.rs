//! Word-frequency counting: a naive version and an allocation-disciplined one.
//!
//! The two functions return the *same* answer; only their allocation behavior
//! differs. The benchmark (`benches/wordcount.rs`) measures the gap. This is the
//! worked example referenced by the `rust-performance-and-idioms` skill:
//! the smell is "allocate a `String` per word and a `Vec` per intermediate
//! step"; the fix is "borrow `&str` slices and reuse the map".

use std::collections::HashMap;

/// NAIVE: the version a profiler will light up.
///
/// Smells, one per line:
///  - `.to_lowercase()` allocates a fresh `String` for the *entire* text.
///  - `.split_whitespace().map(|w| w.to_string())` heap-allocates every word.
///  - `.collect::<Vec<_>>()` materializes an intermediate `Vec<String>` we
///    only iterate once.
///  - the map is keyed by owned `String`, so every *first* sighting of a word
///    clones it into the map, and every lookup hashes an owned key.
pub fn word_counts_naive(text: &str) -> HashMap<String, usize> {
    let lowered = text.to_lowercase();
    let words: Vec<String> = lowered
        .split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_string())
        .filter(|w| !w.is_empty())
        .collect();

    let mut counts: HashMap<String, usize> = HashMap::new();
    for w in words {
        *counts.entry(w).or_insert(0) += 1;
    }
    counts
}

/// DISCIPLINED: same answer, far fewer allocations.
///
/// The ONLY thing we change vs. naive is per-word allocation, so the benchmark
/// isolates that variable. Both versions lowercase the whole corpus exactly
/// once (`to_lowercase` is one allocation; it can change byte length, so we
/// cannot borrow the original). The wins:
///  - no intermediate `Vec<String>`: iterate the split lazily.
///  - no `String` per word: key the map by `&str` borrowed from `lowered`.
///    Only the genuinely-new words (the 20-word lexicon, not the 50k tokens)
///    ever become owned `String`s, via the borrowed-probe pattern below.
pub fn word_counts_disciplined(text: &str) -> HashMap<String, usize> {
    // One allocation for the whole lowercased corpus — same as naive.
    let lowered = text.to_lowercase();

    let mut counts: HashMap<String, usize> = HashMap::new();
    for raw in lowered.split_whitespace() {
        let w = raw.trim_matches(|c: char| !c.is_alphanumeric());
        if w.is_empty() {
            continue;
        }
        // Borrowed probe: hash/compare against the existing owned keys with a
        // &str; only allocate a String when the word is seen for the first time.
        if let Some(n) = counts.get_mut(w) {
            *n += 1;
        } else {
            counts.insert(w.to_string(), 1);
        }
    }
    counts
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "The quick brown fox. The QUICK fox jumps; the fox-fox runs!";

    #[test]
    fn both_agree() {
        let a = word_counts_naive(SAMPLE);
        let b = word_counts_disciplined(SAMPLE);
        assert_eq!(a, b, "optimized version must return identical counts");
    }

    #[test]
    fn counts_are_correct() {
        let c = word_counts_disciplined(SAMPLE);
        assert_eq!(c.get("the"), Some(&3));
        assert_eq!(c.get("quick"), Some(&2));
        // "fox." "fox" "fox-fox" -> "fox","fox","fox-fox" after trim of edges;
        // interior hyphen is kept, so "fox" appears for the first two only.
        assert_eq!(c.get("fox"), Some(&2));
        assert_eq!(c.get("fox-fox"), Some(&1));
    }
}
