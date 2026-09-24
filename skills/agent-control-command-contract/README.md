# Agent Control Command Contract

Use this bundle to define a local operator-control profile and audit whether its verb/backend matrix and lifecycle declarations are complete. The included example is constructed; it does not report a measured backend capability.

## Quick start

1. Read `SKILL.md` for the declaration workflow and evidence boundary.
2. Choose a product-specific `profile.requiredVerbs` set. The audit has no built-in four-verb requirement; a small profile may require only the controls it actually offers.
3. Fill `examples/sample-input.json`, including exactly one row for every declared verb × backend pair.
4. Run the declaration audit:

```bash
node scripts/control_contract_audit.mjs --input examples/sample-input.json
```

5. `declarationPass: true` means only that the declarations are internally complete. It never proves that authority is current, an adapter works, an effect occurred, or a button is safe to enable.
6. Read `references/verb-state-machine.md` for the difference between request, delivery, acknowledgement, observed effect, denial, unsupported capability, and unknown outcome.
7. Read `references/authorization-sources.md` and `references/evidence-scope.md` before drawing security conclusions.
8. Walk `references/admission-and-effect-evidence.md` for the constructed positive/negative authorization and effect-observation fixture.
9. Run the dependency-free negative tests:

```bash
node --test tests/control_contract_audit.test.mjs
```

The auditor is a first-party declaration checker, not a runtime monitor. Use independent adapter, policy-boundary, effect-observation, restart, and UI-gating tests for the claims that actually ship.
