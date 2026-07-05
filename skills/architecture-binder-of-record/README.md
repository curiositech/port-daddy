# Architecture Binder Of Record

Own whether a multi-document product-architecture binder is internally consistent, complete against its stated coverage universe, and honest about what has been absorbed, superseded, deferred, contradicted, orphaned, or rejected from the product's older ambitions.

Use this skill when running a Harbor Architect of Record pass, before an implementation chain cites a binder chapter as ready, or when auditing a proposed binder-coverage snapshot.

## Quick Start

1. Read `SKILL.md` for the reconcile-loop process and the three anti-patterns.
2. Skim `references/raci-authority-and-escalation.md` before deciding who is Accountable for a finding or which escalation tier it belongs to.
3. Skim `references/ambition-archaeology-classification.md` before classifying any entry in the older ambition corpus.
4. Fill in `templates/output-template.md` for the actual run output (contradiction list, coverage matrix update, ambition table, ledger entry).
5. Build a binder-coverage-spec JSON matching `schemas/binder-coverage-spec.schema.json` and audit it:

```bash
node scripts/binder_coverage_audit.mjs --input <your-binder-spec>.json
```

6. Compare against `examples/expected-output.md` to see an incomplete binder audited, then the same binder fixed and passing.
