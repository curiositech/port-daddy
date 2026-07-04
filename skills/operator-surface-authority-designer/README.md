# Operator Surface Authority Designer

Decide which of the three operator surfaces — Scout, FleetBar, pd-console —
owns a capability, by distance-from-work, and audit the placement
deterministically before it ships.

Use this skill when placing a new capability on Scout, FleetBar, or
pd-console, or when auditing an existing operator-surface spec for authority
spread, an unenforceable control, evidence overflow into FleetBar, a
bus-subscription mismatch, or a surface that owns its own runtime state.

## Quick Start

1. Read `SKILL.md` for the distance-based decision model and the three
   anti-patterns.
2. Skim `references/distance-based-authority-model.md` before assigning any
   capability to a surface — it is the canonical intake/ambient/deep mapping.
3. Skim `references/hot-bus-cool-bus-subscription-contract.md` before
   picking a `busSubscription` value, especially for `intake`/`deep`
   capabilities.
4. Fill in `templates/output-template.md` for the capabilities at hand, or
   write a spec matching `schemas/surface-authority-spec.schema.json`
   directly.
5. Run the audit:

```bash
node scripts/surface_authority_audit.mjs --input <your-spec>.json
```

6. Compare against `examples/expected-output.md` to see a bad spec audited,
   then the same spec fixed and passing.

A spec that scores `pass: true` should mean a reviewer can trust that every
capability has exactly one rightful owner, every rendered control is
something the daemon can actually back, and no surface has quietly become a
second source of truth.
