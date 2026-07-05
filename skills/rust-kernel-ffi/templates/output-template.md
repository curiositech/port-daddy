# FFI Export Plan Template

[One-sentence description of the boundary this plan covers, e.g. "verify a
macaroon capability token from the pd-anchor kernel crate."]

```json
{
  "exports": [
    {
      "name": "[extern \"C\" symbol name, e.g. pd_macaroon_verify_json]",
      "hasCatchUnwindOrPanicAbort": false,
      "inputGuards": {
        "null": false,
        "len": false,
        "bound": false,
        "utf8": false,
        "parse": false
      },
      "returnsSentinelOnFailure": false,
      "handsOutString": false,
      "hasMatchingFreeFn": false,
      "passesRustStructAcrossBoundary": false
    }
  ],
  "constantTimeCompareForMacs": false,
  "crateType": ["rlib", "cdylib"],
  "loaderDegradesGracefully": false,
  "testedUnderRealRuntime": false
}
```

Validate with `node scripts/ffi_safety_audit.mjs --input <this-file-as-json>.json`
before treating the boundary as done — the auditor will catch a missing
`catch_unwind`, a missing input guard, a `handsOutString` export with no
matching free fn, a Rust struct/enum crossing the boundary, a non-constant-time
MAC compare, a single-target `crateType`, a hard-failing loader, or a plan
that has never been exercised under the real runtime, and fail the audit
(`pass: false`) with one finding per violated gate.
