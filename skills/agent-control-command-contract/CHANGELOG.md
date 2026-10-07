# Agent Control Command Contract — Changelog

## v1.0.0 (2026-07-03)

- Initial skill creation
- Core process defined: enumerate verbs, assign terminal states, build backend matrix, declare authorization source, audit
- Reference files and deterministic control_contract_audit script added

## Offline draft repair (2026-09-24)

- Recast the auditor as static declaration-completeness checking; it never proves runtime behavior or authorizes clickable UI.
- Replaced fixed four-core-verb and universal backend assumptions with an explicit profile required-verb list.
- Replaced `terminalStates` with `lifecycleStates`; separated policy denial, unsupported, receiver acknowledgement, effect observation, pre-delivery expiry, and unknown outcome after possible delivery.
- Required an exact verb × backend matrix, unique names and pairs, known cross-references, lifecycle coverage, and explicit principal/target/scope/policy/expiry/fencing admission checks.
- Added dependency-free negative tests for the reproduced missing-cell, duplicate, unknown/numeric verb, lifecycle, authorization and CLI-exit defects.
- Corrected inherited unsupported claims and described NIST SP 800-162 only within its ABAC method and caching/freshness scope.

- Reject unknown properties and retired state fields, match nonblank strings across schema/checker, preserve exact tuple identities, and provide a complete one-verb worksheet example.
