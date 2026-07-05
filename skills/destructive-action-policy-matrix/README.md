# Destructive Action Policy Matrix

Classify every destructive/gated action an agent body can attempt into block/approve/allow tiers, then audit whether the pre-tool and post-tool governance behind that classification is real: blocked actions proven zero-side-effect, denials backed by a receipt and transcript event, block-tier denials paired with a safe alternative, and no unmanaged or same-UID body ever marked "contained."

Use this skill when building or reviewing Agent Harbor's C5 governance gate (destructive git blocker, approval request/result, denial receipts), gating a new tool surface, or auditing an existing "we block destructive actions" claim for real evidence.

## Quick Start

1. Read `SKILL.md` for the inventory-classify-gate-prove-audit process and the three anti-patterns.
2. Skim `references/destructive-action-taxonomy.md` before classifying any action — get the category and tier right first.
3. Skim `references/denial-receipt-and-transcript-envelope.md` before wiring the actual pre-tool/post-tool events, human gate payload, or denial receipt.
4. Fill in `templates/output-template.md` for the actual policy matrix.
5. Build a policy-matrix JSON matching `schemas/policy-matrix.schema.json` and audit it:

```bash
node scripts/policy_matrix_audit.mjs --input <your-policy-matrix>.json
```

6. Compare against `examples/expected-output.md` to see a weak matrix audited, then the same matrix fixed and passing.
