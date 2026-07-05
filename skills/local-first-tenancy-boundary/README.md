# Local-First Tenancy Boundary

Audit a product's local-first account/tenancy model: every identity-gated feature keeps a real local-only
path, every scope-tier crossing (private -> repo -> team -> public) shows an explicit data-boundary consent
screen, the "local-only mode uploads nothing" claim is runtime-testable, export/delete controls exist per
tier, and the scope ladder is declared as one ordered source of truth.

Use this skill when designing or reviewing account/tenancy/data-boundary features for a local-first product.

## Quick Start

1. Read `SKILL.md` for the decision model and the three anti-patterns.
2. Skim `references/local-only-and-consent-boundary.md` before shipping an identity-gated feature or a
   tier-crossing consent screen.
3. Skim `references/scope-ladder-and-tenancy-roles.md` before wiring roles or export/delete controls on top
   of the private/repo/team/public ladder.
4. Fill in `templates/output-template.md` for the actual design doc (feature inventory, consent screens,
   export/delete matrix, scope ladder declaration).
5. Build a tenancy-boundary spec JSON matching `schemas/tenancy-boundary.schema.json` and audit it:

```bash
node scripts/tenancy_boundary_audit.mjs --input <your-spec>.json
```

6. Compare against `examples/expected-output.md` to see a bad spec audited, then the same spec fixed and
   passing.
