# Focus Receipt & Proof Gate

Audit whether a "current product focus receipt" and the work order it gates state a real decision with real entry/exit criteria, a daemon-testable acceptance gate, and a launchable work order — or whether they are planning-placeholder prose that sounds like an assignment but can't be tested.

Use this skill when deciding whether to launch an agent chain against a milestone or a stated "focus," when a work order lacks explicit input/output/owner/proof-gate, or when an acceptance gate only proves a cached UI state instead of daemon truth.

## Quick Start

1. Read `SKILL.md` for the receipt-draft, entry/exit-criteria, acceptance-gate, work-order, audit, re-audit process and the three anti-patterns.
2. Skim `references/focus-receipt-schema.md` before drafting or reviewing a focus receipt — it walks the full field-by-field contract from binder chapter 18.
3. Skim `references/proof-gate-vs-cached-state.md` before writing or trusting any acceptance gate — it covers the daemon-truth-vs-cached-UI distinction and what a real input/output/owner/proofGate work order looks like.
4. Fill in `templates/output-template.md` for the actual focus receipt and work order.
5. Build a focus-receipt JSON matching `schemas/focus-receipt.schema.json` and audit it:

```bash
node scripts/focus_receipt_audit.mjs --input <your-focus-receipt>.json
```

6. Compare against `examples/expected-output.md` to see a placeholder-dressed-as-a-decision audited, then the same receipt fixed and passing.
