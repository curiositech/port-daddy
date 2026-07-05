# Changelog — rust-code-testing

## 0.1.0 — 2026-06-27

Initial release. General, expansive Rust testing skill.

- SKILL.md: when-to-use, test taxonomy + tool-selection decision trees (Mermaid),
  8 shibboleth anti-patterns, opt-in advanced-assurance table, reference index.
- `scripts/run_test_matrix.sh`: working fmt→clippy→test→doc→(optional)coverage
  gate runner with per-gate PASS/FAIL and correct exit code. Sets RUST_MIN_STACK.
- references/:
  - `testing-crates.md` — proptest, quickcheck, insta, mockall, rstest,
    test-case, criterion, serial_test, pretty_assertions selection + idioms.
  - `async-and-concurrency.md` — `#[tokio::test]`, timeouts, async traits, loom,
    TSan, flaky-test root-causing.
  - `coverage-ci-and-tooling.md` — nextest, llvm-cov, CI matrix, feature-gated
    runs, RUST_MIN_STACK.
  - `ffi-and-cross-language-parity.md` — FFI guard/sentinel tests, the
    silent-fallback parity trap, shared vectors, napi/PyO3, ABI-mismatch class.
  - `advanced-verification.md` — miri, cargo-fuzz, cargo-mutants, sanitizers.
  - `organization-and-fixtures.md` — test placement, three-states rule,
    builders, pure-core testability, assert-values-not-types.

Shibboleths drawn from real cross-language (Rust↔TS via koffi) FFI parity work,
where "the parity test that secretly tests nothing" and "verify under the real
runtime, not the unit harness" were learned the hard way.
