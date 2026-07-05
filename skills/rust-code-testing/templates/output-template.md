# Rust Test Suite Design Template

[One-sentence description of the module/feature under test.]

## Taxonomy decisions

- Unit tests (private internals, `#[cfg(test)] mod tests` in-file): [list]
- Integration tests (public API, `tests/` dir): [list]
- Doc tests (`///` examples): [list]
- Benches (`benches/`, criterion — NOT part of the test gate): [list]

## Tool choices

| Need | Tool chosen | Why |
| --- | --- | --- |
| [specific input -> output] | plain `#[test]` + `assert_eq!` on the value | [reason] |
| [for-all-inputs invariant] | proptest / quickcheck | [reason] |
| [large structured output] | insta snapshot | [reason] |
| [expensive/nondeterministic dep] | inject as param, or mockall only if needed | [reason] |

## Planned test plan (audit this before writing tests)

```json
{
  "tests": [
    {
      "name": "[module::test_name]",
      "kind": "[unit|integration|doc|bench]",
      "assertsValueNotType": true,
      "isAsync": false,
      "usesTokioTestNotTest": false
    }
  ],
  "coverageTheaterRisk": false,
  "testDepsInDevDeps": true,
  "mockEcho": false,
  "fakesDeterminismWithSleeps": false,
  "parityAssertsKernelLoaded": true,
  "writesToTmp": false
}
```

Validate with `node scripts/test_plan_audit.mjs --input <this-json>.json`
before writing a single test — the auditor will catch coverage theater,
`#[test]` on an `async fn`, mock echo, sleep-faked determinism, an unasserted
parity kernel-load, `/tmp` writes, and test-only crates outside
`[dev-dependencies]`.

## Stronger assurance (opt-in)

- [ ] `miri` — needed if this module uses `unsafe`/raw pointers/FFI
- [ ] `cargo-fuzz` — needed if this module parses untrusted input
- [ ] `cargo-mutants` — run once tests exist, to confirm they'd catch a real bug
- [ ] ASan/TSan — needed if this module is `unsafe`/FFI/concurrent

## Gate run (after tests are written)

```bash
scripts/run_test_matrix.sh --manifest [path/to/Cargo.toml]
```

Report status in one line: "fmt clean, clippy clean, N tests green" — not
just "tests pass".
