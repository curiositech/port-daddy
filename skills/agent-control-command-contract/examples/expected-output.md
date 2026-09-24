# Expected declaration-audit output

These outputs come from the local static declaration checker and constructed fixtures. They are not runtime probes. A passing declaration explicitly remains unsafe to treat as proof for clickable UI.

## Complete sample declaration

Command:

```bash
node scripts/control_contract_audit.mjs --input examples/sample-input.json
```

Expected key output:

```json
{
  "declarationPass": true,
  "scope": "static declaration completeness only; runtime evidence not assessed",
  "safeToRenderControls": false,
  "findings": [],
  "recommendations": [
    "Declaration is internally complete. Collect adapter, authority-boundary, effect-observation, and UI evidence before enabling controls."
  ]
}
```

This pass says the profile lists its two required verbs, contains one complete row for every pair, and its declared authorization bindings/lifecycle distinctions are internally consistent. It does not establish that `adapter-example` exists, that it supports either command, or that a lease was checked at the effect boundary.

## Missing cell: CLI fails closed

`tests/fixtures/cli-missing-matrix-cell.json` is structurally valid but has no matrix row. Running the CLI returns status 1 and a JSON body containing:

```json
{
  "declarationPass": false,
  "safeToRenderControls": false,
  "findings": [
    {
      "severity": "critical",
      "code": "matrix-pair-missing",
      "message": "Matrix is missing the declared pair interrupt/adapter-test."
    }
  ]
}
```

## Required negative cases

`node --test tests/control_contract_audit.test.mjs` covers these contracts:

| Repro | Expected result |
| --- | --- |
| One supported pair missing | `declarationPass: false`; missing pair finding; CLI status 1. |
| Three matrix pairs missing | `declarationPass: false` regardless of how many remain. |
| Duplicate pair with a contradictory support/state row | `declarationPass: false`; duplicate and contradiction findings. |
| Unknown backend in matrix or undeclared supported verb | `declarationPass: false` with cross-reference findings. |
| Numeric supported verb | rejected as malformed input; CLI status 1. |
| Duplicate verb/backend names, supported-list entries, or pairs | rejected or failed; no map overwrite can hide the duplicate. |
| Missing required profile verb | `declarationPass: false`; no fixed global four-verb rule. |
| Unsupported pair claims delivery/effect | `declarationPass: false`; unsupported remains distinct from denial. |
| Missing binding, stale source label, or absent fencing check | malformed or declaration-fail result; not implied valid by the source name. |
| Schema/runtime vocabulary drift | test fails if property names or lifecycle-state sets diverge. |

These are static-input regressions. Adapter effects, fresh authority resolution, runtime races and control rendering still require separate implementation tests.
