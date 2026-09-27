# Constructed intake audit examples

These records illustrate the current offline API. They are supplied declarations, not route or runtime evidence.

## Bad record and result

A record selecting `node` with runner-up `node`, `canonicalTarget.callTraceRef: "trace:"`, and a route that declares `writesIndependentState: true` is malformed or incoherent. Its audit result has:

```json
{"pass":false,"declarationValid":false,"eligibleToAdmit":false,"structuralBlocked":false}
```

The reported findings identify the schema trace failure or the distinct-runner-up/independent-write finding. It is not repaired by selecting a higher local score.

## Corrected constructed record

`sample-input.json` supplies one `node`, runner-up `scout`, both required canonical references, and a historical `spawn` route with no independent write. Its result is:

```json
{"pass":true,"declarationValid":true,"eligibleToAdmit":true,"structuralBlocked":false,"findings":[],"scope":"supplied-declaration-consistency-only"}
```

## Valid but held record

Changing only `assignment.authority` to `false` retains a coherent declaration but cannot admit it:

```json
{"pass":true,"declarationValid":true,"eligibleToAdmit":false,"structuralBlocked":true}
```

The same separation applies when required approval is absent. The next action is to satisfy or explicitly change the applicable authority/approval policy, not to treat `pass` as admission.
