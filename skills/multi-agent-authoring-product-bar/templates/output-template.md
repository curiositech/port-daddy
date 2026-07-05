# Multi-Agent Authoring Product Bar Self-Assessment

[One-sentence description of the product/version being assessed and why now.]

```json
{
  "product": "[product name and version, e.g. 'Port Daddy Agent Harbor v0.x']",
  "tableStakes": {
    "singleAgentLoop": "[below-par|par|above-par — rate vs the incumbent used today]",
    "latency": "[below-par|par|above-par]",
    "contextAttach": "[below-par|par|above-par]",
    "recoverableEdits": "[below-par|par|above-par]"
  },
  "differentiatorThreshold": 3,
  "differentiators": {
    "isolationClaims": { "present": false, "hasRealBehavior": false, "leavesReceipt": false },
    "swarmVisibility": { "present": false, "hasRealBehavior": false, "leavesReceipt": false },
    "transcriptsSalvage": { "present": false, "hasRealBehavior": false, "leavesReceipt": false },
    "receipts": { "present": false, "hasRealBehavior": false, "leavesReceipt": false },
    "spendVisibility": { "present": false, "hasRealBehavior": false, "leavesReceipt": false }
  },
  "stickiness": {
    "comebackTriggers": [],
    "usesOverIncumbentForRealWork": false
  },
  "metricsHonest": false
}
```

Fill every `differentiators.*` object honestly and independently: a button
that exists but does nothing real is `present: true, hasRealBehavior: false`.
A real behavior with no durable artifact afterward is `leavesReceipt: false`.
Only mark `usesOverIncumbentForRealWork: true` and add a
`comebackTriggers` entry if you can name the specific task and person.

Validate with `node scripts/dogfood_bar.mjs --input <this-file-as-json>.json`
before treating `pass: true` as earned — the script will gate on any
below-par table-stakes axis regardless of how strong the differentiators
look, and will flag any differentiator claimed without real behavior or a
receipt behind it.
