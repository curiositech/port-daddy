# Product Reality Reviewer

Use this skill when a product plan needs a skeptical pass before build work starts.

Run:

```bash
node skills/product-reality-reviewer/scripts/reality_check.mjs --input product.json
```

The checker is deliberately biased toward first-run blockers: signup, empty state, missing provider fallback, trust,
support, pricing, and recovery.
