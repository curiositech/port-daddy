# Control profile specification worksheet

This worksheet creates a static declaration. Completing it or receiving a declaration pass does not prove runtime support or authorize enabling a control.

1. Copy `examples/sample-input.json` to a versioned contract file.
2. Set `profile.id`, `profile.name`, and `profile.basis` to the exact product scope.
3. Edit `profile.requiredVerbs`; include only controls the named profile promises.
4. Declare each verb, backend, positive supported-verb list, and exactly one matrix row per pair.
5. Bind authorization fields to implementation-owned values. Do not fill them with wishful labels; source names and boolean declarations are checked only for internal shape.
6. Run `node scripts/control_contract_audit.mjs --input <contract>.json` and preserve stdout/exit code. A failed declaration exits nonzero.
7. Link separate runtime tests for policy deny, expiry, stale authority epoch, delivery, effect observation, unknown outcome, and control UI gating.

The profile must declare these minimum distinctions for supported pairs: `requested`, `policy-denied`, `delivered`, `acknowledged`, `effect-observed`, `failed`, `expired-before-delivery`, and `outcome-unknown`. `queued` may be added where the contract has an asynchronous queue. Unsupported pairs need `unsupported` and must not claim delivery/effect.

```json
{
  "$schema": "../schemas/control-contract.schema.json",
  "profile": {
    "id": "replace-with-versioned-id",
    "name": "Replace with scoped profile name",
    "basis": "Name the first-party product requirement or operator flow that sets this verb scope.",
    "requiredVerbs": ["replace"],
    "requiredLifecycleStates": ["requested", "policy-denied", "delivered", "acknowledged", "effect-observed", "failed", "expired-before-delivery", "outcome-unknown"]
  },
  "verbs": [
    { "name": "replace", "intent": "Describe the operation without implying its effect." }
  ],
  "backends": [
    { "name": "adapter-id", "description": "Versioned implementation name, not a capability proof.", "supportedVerbs": ["replace"] }
  ],
  "authorization": {
    "source": "lease-store",
    "checkedAtAdmission": true,
    "bindings": {
      "principal": "principal attribute field",
      "target": "resource or run field",
      "scope": "operation and resource scope field",
      "policyRevision": "policy revision field",
      "expiresAt": "expiry field",
      "fencingEpoch": "authority epoch field"
    },
    "checks": { "principal": true, "target": true, "scope": true, "currentPolicy": true, "notExpired": true, "fencingEpoch": true }
  },
  "matrix": [
    { "verb": "replace", "backend": "adapter-id", "support": "supported", "lifecycleStates": ["requested", "policy-denied", "delivered", "acknowledged", "effect-observed", "failed", "expired-before-delivery", "outcome-unknown"] }
  ]
}
```

## Implementation evidence checklist

- [ ] The PDP/decision function evaluates the exact principal, target, operation scope, current policy, expiry, and fencing/authority epoch.
- [ ] The effect boundary enforces that decision; a stale projection or UI row cannot authorize dispatch.
- [ ] Denial exits before dispatch and is distinct from unsupported capability.
- [ ] Delivery acknowledgement is recorded separately from independent effect read-back.
- [ ] Expiry before proven delivery is distinct from a possibly delivered command with unknown effect.
- [ ] Duplicate ID, replay, restart, policy change, revocation and lower-epoch cases are tested.
- [ ] For every enabled UI affordance, the exact runtime and observer evidence is linked; this static audit alone can never enable it.
