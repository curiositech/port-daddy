# Rust Code Testing

Write Rust tests that catch real bugs, run fast, and stay honest — and choose
the right tool from the broad Rust testing ecosystem instead of reaching for
`assert_eq!` and a mock every time.

Use this skill when writing, organizing, debugging, or speeding up Rust
tests; choosing a testing crate (proptest, insta, mockall, rstest, criterion,
...); testing async/FFI code; or wiring a test CI matrix.

## Quick Start

1. Read `SKILL.md` — test taxonomy, tool-selection decision trees, and the
   eight shibboleth anti-patterns.
2. Run `scripts/run_test_matrix.sh` against real code for the fmt → clippy →
   test → doc-test → (optional) coverage gate matrix.
3. Before writing tests for a risky module, describe the plan as JSON
   matching `schemas/test-plan.schema.json` and audit it:
   `node scripts/test_plan_audit.mjs --input <plan>.json`.
4. Lazy-load the relevant `references/*.md` file for the crate or technique
   in play (async, FFI parity, coverage/CI, advanced verification,
   organization/fixtures, or crate selection).
5. Fill `templates/output-template.md` for the task at hand when a written
   test-suite design deliverable is needed alongside the code.

A plan that scores `pass: true` from `test_plan_audit.mjs` should mean the
eventual tests avoid the traps in SKILL.md's anti-patterns section — not that
every assertion is automatically strong. Re-verify with `cargo-mutants` once
the tests exist.
