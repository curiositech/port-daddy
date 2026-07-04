# Rust Testing Crates — selection & idioms

Consult when choosing a testing dependency or writing tests that need more than
`assert_eq!`. Pick the *least* machinery that proves the property.

## Decision: which crate for which need

| Need | Crate | One-liner |
|------|-------|-----------|
| Generative / invariant testing | `proptest` | Strategy-based shrinking; best for "for all inputs, X holds" |
| Generative, simpler API | `quickcheck` | `Arbitrary`-based; less control, less boilerplate |
| Snapshot / golden output | `insta` | `assert_snapshot!`; review with `cargo insta review` |
| Mocking traits | `mockall` | `#[automock]` generates a mock impl of a trait |
| Parameterized cases | `rstest` | `#[case(..)]` fixtures + parametrization |
| Table-driven cases | `test-case` | `#[test_case(2, 3 => 5)]` one attr per row |
| Readable diff on failure | `pretty_assertions` | drop-in `assert_eq!` with colored diffs |
| Serialize order-dependent tests | `serial_test` | `#[serial]` — for tests sharing a global resource |
| Benchmarks (stable) | `criterion` | statistical benches; replaces unstable `#[bench]` |
| Async test runtime | `tokio` (`macros`,`rt`) | `#[tokio::test]` — see async reference |
| Temp dirs/files | `tempfile` | `tempdir()` auto-cleaned; never hand-roll `/tmp` paths |
| HTTP mocking | `wiremock` / `mockito` | stub external HTTP without a real server |

Put these under `[dev-dependencies]`, never `[dependencies]` — test-only crates
must not ship in the release binary.

## proptest — the workhorse for invariants

```rust
use proptest::prelude::*;

proptest! {
    // For ALL non-empty inputs, round-trip encode→decode is identity.
    #[test]
    fn encode_decode_roundtrips(s in ".{1,512}") {
        prop_assert_eq!(decode(&encode(&s)), s);
    }

    // Bound expensive cases; default is 256 runs.
    #![proptest_config(ProptestConfig { cases: 64, ..ProptestConfig::default() })]
    #[test]
    fn never_panics(v in prop::collection::vec(any::<i32>(), 0..1000)) {
        let _ = summarize(&v); // must not panic for any vector
    }
}
```

- **Shrinking is the value.** On failure proptest minimizes the input to the
  smallest case that still fails — report that, not the random seed.
- A failing case is written to `proptest-regressions/`. **Commit that file** —
  it pins the regression so the exact input is retried forever.
- Use `prop_assert!`/`prop_assert_eq!` inside `proptest!` (not `assert!`) so
  shrinking sees the failure instead of a panic unwinding out.

## insta — snapshot testing

```rust
#[test]
fn renders_report() {
    let report = build_report(&fixture());
    insta::assert_snapshot!(report);          // text
    insta::assert_json_snapshot!(report);     // serde value, stable key order
}
```

- First run writes `.snap.new`; `cargo insta review` accepts/rejects. CI runs
  with `INSTA_UPDATE=no` (the default) so an un-reviewed snapshot fails the build.
- **Redact volatile fields** (timestamps, uuids, pids) or every run is a diff:
  `assert_json_snapshot!(v, { ".createdAt" => "[ts]", ".id" => "[uuid]" })`.
- Snapshot tests are for *output shape*, not logic — pair them with unit tests
  that assert specific values, or you get coverage theater (a snapshot passes by
  matching whatever the code currently emits, including a bug).

## mockall — mocking traits (use sparingly)

```rust
#[cfg_attr(test, mockall::automock)]
trait Clock { fn now_ms(&self) -> u64; }

#[test]
fn expires_after_ttl() {
    let mut clock = MockClock::new();
    clock.expect_now_ms().times(1).returning(|| 1_000);
    assert!(is_expired(&clock, /*written_at*/ 0, /*ttl*/ 500));
}
```

**Prefer dependency injection of a real trivial impl over a mock.** A mock that
returns hardcoded values which the test then asserts is a *mock echo* — it tests
the mock, not the code. Reach for mockall only when the real impl is expensive or
non-deterministic (network, clock, RNG). For a clock, an injected `u64 now`
parameter (see the pure-core pattern in the main SKILL) is simpler and truer.

## criterion — benchmarks

```rust
// benches/throughput.rs
use criterion::{criterion_group, criterion_main, Criterion, black_box};

fn bench_parse(c: &mut Criterion) {
    let input = std::fs::read_to_string("benches/fixture.json").unwrap();
    c.bench_function("parse_json", |b| b.iter(|| parse(black_box(&input))));
}
criterion_group!(benches, bench_parse);
criterion_main!(benches);
```

- `black_box` defeats the optimizer eliding the work you're timing — forget it
  and you benchmark `nop`.
- Criterion stores baselines under `target/criterion/`; `cargo bench -- --baseline main`
  compares against a saved run. Benches are not correctness tests — keep them out
  of the `cargo test` gate (they're slow and noisy on shared CI runners).

## rstest — fixtures + parametrization

```rust
use rstest::*;

#[fixture] fn repo() -> InMemoryRepo { InMemoryRepo::seeded() }

#[rstest]
#[case(0, false)]
#[case(1, true)]
#[case(100, true)]
fn has_items(#[case] n: usize, #[case] expected: bool, repo: InMemoryRepo) {
    assert_eq!(repo.with_n(n).has_items(), expected);
}
```

Cleaner than a hand-rolled loop because each case is a *separate* test — one
failing case doesn't hide the others, and the runner names them individually.
