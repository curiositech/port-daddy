//! Input constructors shared by Kani and an exhaustive native grammar test.
//! These functions generate inputs; they are not policy implementations.

pub(super) fn operation(selector: u8) -> String {
    let mut result = String::with_capacity(5);
    match selector % 4 {
        0 => {
            result.push('p');
            result.push('u');
            result.push('b');
        }
        1 => {
            result.push('s');
            result.push('u');
            result.push('b');
        }
        2 => {
            result.push('a');
            result.push('d');
            result.push('m');
            result.push('i');
            result.push('n');
        }
        _ => {
            result.push('o');
            result.push('t');
            result.push('h');
            result.push('e');
            result.push('r');
        }
    }
    result
}

/// Ten channel patterns. Selectors 0-7 are literals and single-`*` globs;
/// 8 and 9 are `**` and `a**`, globs whose prefix itself contains `*`. Those
/// two are what separate the pattern-cover rule from the one it replaced
/// (`**` covering `*`, `a**` covering `a*`); see the native test
/// `the_kani_pattern_domain_separates_the_replaced_rule` in lib.rs.
pub(super) fn pattern(selector: u8) -> String {
    let id = selector % 10;
    // Kani 0.67's symbolic literal-to-owned construction produced a prefix
    // transitivity counterexample that did not replay in native Rust. The
    // equivalent explicit-write construction passes the isolated check.
    // Avoid that observed copy-model path without stubbing policy or assuming
    // any ordering property. The test below checks every selector's bytes.
    let mut result = String::with_capacity(3);
    if matches!(id, 1 | 2 | 5 | 6 | 9) {
        result.push('a');
    }
    if matches!(id, 2 | 3 | 6 | 7) {
        result.push('b');
    }
    if id >= 4 {
        result.push('*');
    }
    if id >= 8 {
        result.push('*');
    }
    result
}

/// Eight concrete channels. `*` and `a*` are ordinary channel names here, so
/// the `**` and `a**` patterns above match something in the domain.
pub(super) fn channel(selector: u8) -> &'static str {
    match selector % 8 {
        0 => "",
        1 => "a",
        2 => "ab",
        3 => "aba",
        4 => "b",
        5 => "ba",
        6 => "*",
        _ => "a*",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_selector_constructs_the_documented_grammar() {
        let operations = ["pub", "sub", "admin", "other"];
        let patterns = ["", "a", "ab", "b", "*", "a*", "ab*", "b*", "**", "a**"];
        let channels = ["", "a", "ab", "aba", "b", "ba", "*", "a*"];
        for selector in 0..=u8::MAX {
            assert_eq!(operation(selector), operations[(selector % 4) as usize]);
            assert_eq!(pattern(selector), patterns[(selector % 10) as usize]);
            assert_eq!(channel(selector), channels[(selector % 8) as usize]);
        }
    }
}
