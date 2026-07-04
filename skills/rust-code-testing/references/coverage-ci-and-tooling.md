# Coverage, runners & CI for Rust tests

Consult when measuring coverage, speeding up the suite, or wiring tests into CI.

## Test runner: prefer `cargo nextest`

`cargo test` is fine, but `cargo nextest run` is the better default for any
non-trivial suite:

- Runs tests in parallel processes (true isolation — a panic/abort in one test
  can't poison another's state the way same-process threads can).
- Per-test timeouts (`slow-timeout`, `leak-timeout`) — essential for async suites
  where a hung future would otherwise wedge the whole run.
- Retries + flaky detection (`--retries 2` reports which tests only pass on retry
  — surfaces flakiness instead of hiding it).
- Much better output: a clean summary, failures grouped at the end.

Caveat: nextest does **not** run doc tests. Run them separately:
`cargo test --doc` (the matrix script does both).

```bash
cargo install cargo-nextest --locked
cargo nextest run --workspace
cargo test --doc --workspace      # doc tests, separately
```

## Coverage: `cargo llvm-cov` (source-based, accurate)

```bash
cargo install cargo-llvm-cov --locked
cargo llvm-cov --workspace --summary-only          # quick %
cargo llvm-cov --workspace --html                  # browsable report
cargo llvm-cov --workspace --lcov --output-path lcov.info   # for Codecov/CI
cargo llvm-cov nextest                              # coverage via nextest
```

- `llvm-cov` uses LLVM source-based coverage — far more accurate than the old
  `cargo-tarpaulin` (ptrace line counting, Linux-only, over/under-counts). Use
  tarpaulin only if you're stuck on a platform llvm-cov can't target.
- **Don't chase 100%.** Coverage measures lines *executed*, not behavior
  *verified*. A test that calls a function with zero assertions raises coverage
  and proves nothing (coverage theater). Target high coverage on domain/logic
  modules; accept lower on glue and `main`.
- Coverage cannot see what you didn't write a case for. The bug is usually in the
  branch you forgot, which by definition shows as uncovered — read the *red*, not
  the percentage.

## CI matrix essentials

```yaml
# GitHub Actions sketch
jobs:
  test:
    strategy:
      matrix:
        rust: [stable, beta]      # beta catches regressions before they ship
    steps:
      - uses: dtolnay/rust-toolchain@stable
        with: { components: rustfmt, clippy }
      - run: cargo fmt --all -- --check
      - run: cargo clippy --all-targets --all-features -- -D warnings
      - run: cargo nextest run --workspace --all-features
      - run: cargo test --doc --workspace        # nextest skips doc tests
```

- **Run `--all-features` AND default features.** Feature-gated code (e.g. an
  `ffi` feature that adds serde + C exports) is invisible to a default-feature
  test run. A crate that's `["rlib","cdylib"]` with optional deps needs both a
  `--no-default-features` build check and a `--features ffi` test run.
- **Cache `~/.cargo` and `target/`** (Swatinem/rust-cache) or CI is 5× slower.
- **`-D warnings` in CI, not locally.** Denying warnings on every local build
  fights you mid-refactor; denying in CI enforces the zero-warning norm at the
  gate.

## `RUST_MIN_STACK` for proc-macro-heavy crates

Test builds of crates with deep proc-macro expansion (GPUI, big `derive` trees,
large `serde` enums) can overflow rustc's default thread stack and fail with a
cryptic SIGSEGV during compilation — *not* a test failure, a compiler crash.

```bash
export RUST_MIN_STACK=16777216   # 16 MB
```

Set it in CI and in the matrix script. The symptom (compiler segfault only in
`--lib`/test mode, fine in normal build) is the tell.

## Determinism knobs

- `cargo test -- --test-threads=1` forces serial execution — a debugging tool to
  confirm a failure is a cross-test race, not a real bug. Don't leave it on; it
  hides the race and slows the suite. Fix the shared state instead (see
  async-and-concurrency.md).
- `--nocapture` shows `println!`/`dbg!` output from passing tests (captured by
  default). `cargo test -- --nocapture`.
- `cargo test <substring>` filters by test name; `--exact` for an exact match.
