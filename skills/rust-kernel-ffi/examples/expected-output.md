# Example Output: FFI Safety Audit

Scenario: a `pd_macaroon_verify_json` export (JSON-in/JSON-out over `*const
c_char` + a matching `pd_string_free`) has just been implemented following
the worked example in `SKILL.md`. Before shipping, the export plan is run
through `scripts/ffi_safety_audit.mjs` to confirm every quality gate holds —
this is `examples/sample-input.json` verbatim.

```json
{
  "exports": [
    {
      "name": "pd_macaroon_verify_json",
      "hasCatchUnwindOrPanicAbort": true,
      "inputGuards": {
        "null": true,
        "len": true,
        "bound": true,
        "utf8": true,
        "parse": true
      },
      "returnsSentinelOnFailure": true,
      "handsOutString": true,
      "hasMatchingFreeFn": true,
      "passesRustStructAcrossBoundary": false
    },
    {
      "name": "pd_string_free",
      "hasCatchUnwindOrPanicAbort": true,
      "inputGuards": {
        "null": true,
        "len": true,
        "bound": true,
        "utf8": true,
        "parse": true
      },
      "returnsSentinelOnFailure": true,
      "handsOutString": false,
      "hasMatchingFreeFn": false,
      "passesRustStructAcrossBoundary": false
    }
  ],
  "constantTimeCompareForMacs": true,
  "crateType": ["rlib", "cdylib"],
  "loaderDegradesGracefully": true,
  "testedUnderRealRuntime": true
}
```

Running it through the auditor confirms this is a genuinely safe FFI
boundary, not just code that happens to compile:

```
$ node scripts/ffi_safety_audit.mjs --input examples/sample-input.json
{
  "pass": true,
  "findings": [],
  "recommendations": [
    "Plan passes every deterministic gate. Still verify by hand under the real runtime and with `nm -gU` that exported symbol names match the koffi signatures byte-for-byte."
  ],
  "score": 100
}
```

What makes this a *good* plan, in reviewer terms: both exports declare
`catch_unwind` coverage so a malformed request cannot crash the host; the
JSON-in export carries all five input guards (null/len/bound/utf8/parse)
before any logic runs; the string it hands out has a matching free fn the TS
side calls in a `finally`; no Rust struct crosses the boundary; the crate
ships as both an `rlib` (unit-tested) and a `cdylib` (shipped); the TS loader
degrades to a fallback instead of hard-failing when the dylib is absent; and
the whole path has been exercised under the real bun daemon, not just jest.

Contrast with a plan missing `catch_unwind`, guards, or a free fn — the
auditor returns `pass: false` with one `critical` or `high` finding per
violated gate and a matching, fix-it recommendation (see
`skills/rust-kernel-ffi/scripts/ffi_safety_audit.mjs` for the full rule set).
