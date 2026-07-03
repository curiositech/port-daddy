# Example Output: Test Plan Audit

**Scenario**: Before writing tests for a launchd PATH-resolution fallback (`bin_resolver.rs`)
and a daemon-restart integration test, the plan is described as
`examples/sample-input.json` and run through the auditor first:

```bash
node scripts/test_plan_audit.mjs --input examples/sample-input.json
```

## Output

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "Plan is structurally clean of known shibboleths. Spot-check that each assertsValueNotType:true test really pins a value, not just a shape, once written."
  ]
}
```

## Reading the result

- `pass: true` means no shibboleth was detected in the plan's declared shape —
  no coverage theater, no `#[test]` on an `async fn`, no mock echo, no
  sleep-faked determinism, no unasserted parity kernel-load, no `/tmp` writes,
  and test-only crates are declared under `[dev-dependencies]`.
- `score: 100` is the sum of the per-test budget (40 points, split across all
  planned tests) and the plan-wide flag budget (60 points, 10 per flag).
- The single recommendation is a reminder, not a finding: passing the audit
  proves the *plan* avoids known traps, not that the eventual assertions are
  actually strong. Re-run `cargo-mutants` after the tests are written to
  confirm nothing merely executes without verifying (see
  `references/advanced-verification.md`).

## A failing run, for contrast

A plan with an `async fn` test missing `#[tokio::test]`, a mock-echo
assertion, and a hardcoded `/tmp` path produces `pass: false`, `score: 0`,
and one `critical`-severity finding (`test-attr-on-async-fn`) plus several
`high`/`medium` findings — each with a concrete `recommendations[]` entry
naming the fix (e.g. "Attribute `ffi::parity_check` with `#[tokio::test]`
... not `#[test]`"). `pass` requires zero critical findings, every plan-wide
flag present, and `score >= 80`.
