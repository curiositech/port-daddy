//! Line-local syntax highlighting for the Harbor editor's `Block::CodeBuffer`.
//!
//! Deliberately **basic tier**: a per-line lexer classifying keyword / type /
//! string / comment / number spans for the languages the console most often
//! opens (Rust, TS/JS, Python, shell/config), with a plain fallback for
//! everything else. This is lexing a *formal* grammar against spec-defined,
//! finite token sets — not NLP over free text.
//!
//! Honest limits (documented, not hidden): block comments (`/* … */`) are
//! recognized only when they open and close on the same line — a line *inside*
//! a multi-line block comment lexes as code. That is the P1 "basic" contract;
//! a stateful scanner (or the daemon symbol index, Layer B) is the named next
//! step.
//!
//! Output is a run-length vector: consecutive `(byte_len, SyntaxKind)` pairs
//! that exactly cover the line. The GPUI face turns each run into one
//! `TextRun` on a single shaped text element (no per-token divs); the TUI face
//! walks the same runs. Colors resolve in the theme layers (`palette.rs` for
//! GPUI, `theme.rs` tones for the REPL) — never here, never inline hex.

use crate::pane::SyntaxKind;

/// Language family, detected from the file extension. `Plain` disables
/// everything except nothing-at-all (one run of `SyntaxKind::Plain`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Rust,
    /// TypeScript / JavaScript family (ts, tsx, js, jsx, mjs, cjs).
    Ts,
    Json,
    Python,
    /// `#`-commented config/shell family (sh, bash, zsh, toml, yaml, …).
    Shell,
    Plain,
}

impl Lang {
    /// Short, honest label for the always-visible editor status strip.
    pub fn label(self) -> &'static str {
        match self {
            Lang::Rust => "RUST",
            Lang::Ts => "TS/JS",
            Lang::Json => "JSON",
            Lang::Python => "PYTHON",
            Lang::Shell => "SHELL/CONFIG",
            Lang::Plain => "PLAIN TEXT",
        }
    }
}

/// Detect the language family from a path's extension (lowercased).
pub fn lang_for_path(path: &str) -> Lang {
    // Split on both separators — Windows-style `\` paths are handled the same
    // way the editor title's basename split does it.
    let ext = path
        .rsplit(['/', '\\'])
        .next()
        .and_then(|base| base.rsplit_once('.').map(|(_, e)| e))
        .unwrap_or("");
    match ext.to_ascii_lowercase().as_str() {
        "rs" => Lang::Rust,
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" => Lang::Ts,
        "json" | "jsonc" => Lang::Json,
        "py" => Lang::Python,
        "sh" | "bash" | "zsh" | "toml" | "yaml" | "yml" => Lang::Shell,
        _ => Lang::Plain,
    }
}

/// Reserved words per family — finite, spec-defined token sets (sorted for
/// binary search; a debug assertion in tests keeps them sorted).
const RUST_KEYWORDS: &[&str] = &[
    "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern",
    "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub",
    "ref", "return", "self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use",
    "where", "while",
];
const TS_KEYWORDS: &[&str] = &[
    "any",
    "as",
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "from",
    "function",
    "if",
    "implements",
    "import",
    "in",
    "instanceof",
    "interface",
    "let",
    "new",
    "null",
    "of",
    "private",
    "public",
    "readonly",
    "return",
    "static",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "type",
    "typeof",
    "undefined",
    "var",
    "void",
    "while",
    "yield",
];
const PY_KEYWORDS: &[&str] = &[
    "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue",
    "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import",
    "in", "is", "lambda", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
];
const JSON_KEYWORDS: &[&str] = &["false", "null", "true"];
const SHELL_KEYWORDS: &[&str] = &[
    "case", "do", "done", "elif", "else", "esac", "fi", "for", "function", "if", "in", "local",
    "return", "then", "while",
];

/// Primitive/builtin type names per family (capitalized identifiers are typed
/// heuristically regardless of this list).
const RUST_TYPES: &[&str] = &[
    "bool", "char", "f32", "f64", "i128", "i16", "i32", "i64", "i8", "isize", "str", "u128", "u16",
    "u32", "u64", "u8", "usize",
];
const TS_TYPES: &[&str] = &[
    "bigint", "boolean", "never", "number", "object", "string", "symbol", "unknown",
];
const PY_TYPES: &[&str] = &[
    "bool", "bytes", "dict", "float", "int", "list", "set", "str", "tuple",
];

fn keywords(lang: Lang) -> &'static [&'static str] {
    match lang {
        Lang::Rust => RUST_KEYWORDS,
        Lang::Ts => TS_KEYWORDS,
        Lang::Json => JSON_KEYWORDS,
        Lang::Python => PY_KEYWORDS,
        Lang::Shell => SHELL_KEYWORDS,
        Lang::Plain => &[],
    }
}

fn types(lang: Lang) -> &'static [&'static str] {
    match lang {
        Lang::Rust => RUST_TYPES,
        Lang::Ts => TS_TYPES,
        Lang::Python => PY_TYPES,
        Lang::Json | Lang::Shell | Lang::Plain => &[],
    }
}

/// Does `lang` use `//` line comments (and same-line `/* … */`)?
fn slash_comments(lang: Lang) -> bool {
    matches!(lang, Lang::Rust | Lang::Ts | Lang::Json)
}

/// Does `lang` use `#` line comments?
fn hash_comments(lang: Lang) -> bool {
    matches!(lang, Lang::Python | Lang::Shell)
}

/// Classify one identifier word.
fn classify_word(word: &str, lang: Lang) -> SyntaxKind {
    if keywords(lang).binary_search(&word).is_ok() {
        return SyntaxKind::Keyword;
    }
    if types(lang).binary_search(&word).is_ok() {
        return SyntaxKind::Type;
    }
    // Heuristic: a capitalized identifier reads as a type name in every
    // family we highlight (PascalCase types are the convention, not the law).
    if lang != Lang::Plain && word.chars().next().is_some_and(|c| c.is_ascii_uppercase()) {
        return SyntaxKind::Type;
    }
    SyntaxKind::Plain
}

/// Tokenize one line into consecutive `(byte_len, kind)` runs that exactly
/// cover `text`. Never panics on any input; a pathological line degrades to
/// `Plain` runs. Runs with equal adjacent kinds are merged, so the output is
/// minimal for the renderer (fewest `TextRun`s per line).
pub fn highlight_line(text: &str, lang: Lang) -> Vec<(u32, SyntaxKind)> {
    let bytes = text.as_bytes();
    let mut runs: Vec<(u32, SyntaxKind)> = Vec::new();
    let push = |len: usize, kind: SyntaxKind, runs: &mut Vec<(u32, SyntaxKind)>| {
        if len == 0 {
            return;
        }
        if let Some(last) = runs.last_mut() {
            if last.1 == kind {
                last.0 += len as u32;
                return;
            }
        }
        runs.push((len as u32, kind));
    };

    if lang == Lang::Plain {
        push(bytes.len(), SyntaxKind::Plain, &mut runs);
        return runs;
    }

    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        // Line comment: rest of the line, one run.
        if (hash_comments(lang) && b == b'#')
            || (slash_comments(lang) && b == b'/' && bytes.get(i + 1) == Some(&b'/'))
        {
            push(bytes.len() - i, SyntaxKind::Comment, &mut runs);
            break;
        }
        // Same-line block comment `/* … */` (unclosed ⇒ rest of line).
        if slash_comments(lang) && b == b'/' && bytes.get(i + 1) == Some(&b'*') {
            let close = text[i + 2..]
                .find("*/")
                .map(|p| i + 2 + p + 2)
                .unwrap_or(bytes.len());
            push(close - i, SyntaxKind::Comment, &mut runs);
            i = close;
            continue;
        }
        // String literal: `"`, `'`, or backtick, escape-aware, unterminated ⇒
        // rest of line. (Rust lifetimes `'a` are a single quote NOT followed by
        // a closing quote nearby — treat a `'x'`-style char literal as a string
        // and a lone `'` as plain.)
        if b == b'"' || b == b'`' || b == b'\'' {
            // In RUST a single-quoted span must LOOK like a char literal, or
            // the tick is a lifetime and stays plain (two lifetimes on one
            // line would otherwise pair into a phantom string). Every other
            // family single-quotes ordinary strings ('hello'), so no gate.
            let rust_lifetime_guard = b == b'\'' && lang == Lang::Rust;
            match scan_string(bytes, i) {
                Some(end) if !rust_lifetime_guard || plausible_char_literal(bytes, i, end) => {
                    push(end - i, SyntaxKind::Str, &mut runs);
                    i = end;
                    continue;
                }
                _ => {
                    push(1, SyntaxKind::Plain, &mut runs);
                    i += 1;
                    continue;
                }
            }
        }
        // Number: digit-led (also `0x…`, `1_000`, `3.14`).
        if b.is_ascii_digit() {
            let mut j = i + 1;
            while j < bytes.len()
                && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_' || bytes[j] == b'.')
            {
                j += 1;
            }
            push(j - i, SyntaxKind::Number, &mut runs);
            i = j;
            continue;
        }
        // Identifier / word.
        if b.is_ascii_alphabetic() || b == b'_' {
            let mut j = i + 1;
            while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_') {
                j += 1;
            }
            push(j - i, classify_word(&text[i..j], lang), &mut runs);
            i = j;
            continue;
        }
        // Anything else (whitespace, punctuation, multi-byte UTF-8): advance
        // one whole char as Plain — never split a UTF-8 sequence.
        let ch_len = text[i..].chars().next().map(char::len_utf8).unwrap_or(1);
        push(ch_len, SyntaxKind::Plain, &mut runs);
        i += ch_len;
    }
    runs
}

/// Scan a string literal starting at `start` (an opening quote). Returns the
/// byte index one past the closing quote, or `bytes.len()` for unterminated
/// double/backtick quotes. A lone `'` with no close within the line returns
/// `None` (so Rust lifetimes stay plain instead of swallowing the line).
fn scan_string(bytes: &[u8], start: usize) -> Option<usize> {
    let quote = bytes[start];
    let mut i = start + 1;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            i += 2;
            continue;
        }
        if bytes[i] == quote {
            return Some(i + 1);
        }
        i += 1;
    }
    if quote == b'\'' {
        None
    } else {
        Some(bytes.len())
    }
}

/// Is the single-quoted span `start..end` (quotes inclusive) a plausible CHAR
/// literal — one char (1–4 UTF-8 bytes) or one escape sequence — rather than a
/// pair of Rust lifetimes (`<'a>(x: &'a str)`) whose ticks happen to pair up?
fn plausible_char_literal(bytes: &[u8], start: usize, end: usize) -> bool {
    let content = end.saturating_sub(start + 2); // bytes between the quotes
    match bytes.get(start + 1) {
        Some(b'\\') => content <= 10, // '\n', '\u{1F600}' — escape-led
        _ => (1..=4).contains(&content),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(text: &str, lang: Lang) -> Vec<(String, SyntaxKind)> {
        let mut out = Vec::new();
        let mut i = 0;
        for (len, kind) in highlight_line(text, lang) {
            out.push((text[i..i + len as usize].to_string(), kind));
            i += len as usize;
        }
        assert_eq!(i, text.len(), "runs must exactly cover the line");
        out
    }

    #[test]
    fn keyword_tables_are_sorted_for_binary_search() {
        for table in [
            RUST_KEYWORDS,
            TS_KEYWORDS,
            PY_KEYWORDS,
            SHELL_KEYWORDS,
            RUST_TYPES,
            TS_TYPES,
            PY_TYPES,
        ] {
            assert!(
                table.windows(2).all(|w| w[0] < w[1]),
                "table not sorted: {table:?}"
            );
        }
    }

    #[test]
    fn rust_line_classifies_keyword_type_string_comment_number() {
        let got = kinds("pub fn go(n: u32) -> String { \"hi\" } // done", Lang::Rust);
        let find = |t: &str| got.iter().find(|(s, _)| s == t).map(|(_, k)| *k);
        assert_eq!(find("pub"), Some(SyntaxKind::Keyword));
        assert_eq!(find("fn"), Some(SyntaxKind::Keyword));
        assert_eq!(find("u32"), Some(SyntaxKind::Type));
        assert_eq!(find("String"), Some(SyntaxKind::Type));
        assert_eq!(find("\"hi\""), Some(SyntaxKind::Str));
        assert_eq!(find("// done"), Some(SyntaxKind::Comment));
    }

    #[test]
    fn numbers_and_hash_comments_python() {
        let got = kinds("x = 0xff + 1_000  # note", Lang::Python);
        let find = |t: &str| got.iter().find(|(s, _)| s == t).map(|(_, k)| *k);
        assert_eq!(find("0xff"), Some(SyntaxKind::Number));
        assert_eq!(find("1_000"), Some(SyntaxKind::Number));
        assert_eq!(find("# note"), Some(SyntaxKind::Comment));
    }

    /// The Rust lifetime guard must NOT leak into other languages: ordinary
    /// single-quoted strings in Python/TS/shell highlight as strings.
    #[test]
    fn single_quoted_strings_highlight_outside_rust() {
        for lang in [Lang::Python, Lang::Ts, Lang::Shell] {
            let got = kinds("x = 'hello world'", lang);
            assert!(
                got.iter()
                    .any(|(s, k)| s == "'hello world'" && *k == SyntaxKind::Str),
                "single-quoted string must be a Str in {lang:?}: {got:?}"
            );
        }
    }

    #[test]
    fn unterminated_string_swallows_rest_of_line_but_lifetime_does_not() {
        let got = kinds("let s = \"open", Lang::Rust);
        assert_eq!(
            got.last().unwrap(),
            &("\"open".to_string(), SyntaxKind::Str)
        );
        // A lifetime tick stays plain (no close quote on the line).
        let got = kinds("fn f<'a>(x: &'a str)", Lang::Rust);
        assert!(got
            .iter()
            .any(|(s, k)| s == "str" && *k == SyntaxKind::Type));
        assert!(!got.iter().any(|(_, k)| *k == SyntaxKind::Str));
    }

    #[test]
    fn plain_lang_is_one_plain_run_and_utf8_is_never_split() {
        assert_eq!(highlight_line("héllo — ok", Lang::Plain).len(), 1);
        // Multi-byte chars inside a highlighted language also stay intact.
        let got = kinds("let s = \"héllo\"; // ✓", Lang::Rust);
        assert!(got.iter().any(|(s, _)| s == "\"héllo\""));
    }

    #[test]
    fn adjacent_same_kind_runs_merge() {
        let runs = highlight_line("...", Lang::Rust);
        assert_eq!(
            runs.len(),
            1,
            "punctuation coalesces into one Plain run: {runs:?}"
        );
    }

    #[test]
    fn lang_detection_by_extension() {
        assert_eq!(lang_for_path("core/pd-console/src/app.rs"), Lang::Rust);
        assert_eq!(lang_for_path("web/index.tsx"), Lang::Ts);
        assert_eq!(lang_for_path("fixtures/package.json"), Lang::Json);
        assert_eq!(lang_for_path("scripts/run.py"), Lang::Python);
        assert_eq!(lang_for_path("conf/settings.yaml"), Lang::Shell);
        assert_eq!(lang_for_path("README"), Lang::Plain);
    }

    #[test]
    fn labels_detected_language_for_editor_status() {
        assert_eq!(Lang::Rust.label(), "RUST");
        assert_eq!(Lang::Json.label(), "JSON");
        assert_eq!(Lang::Plain.label(), "PLAIN TEXT");
    }
}
