# Agent Labor Pricing Decision Brief

[One sentence naming the product feature, buyer segment, and pricing decision being made.]

## Chosen Model

- **Model**: [per-seat | metered | credits | hybrid | outcome]
- **Why this model fits**: [one paragraph tying the model to the value metric and buyer sophistication, citing `references/pricing-model-decision-guide.md`]

## Value Metric

- **Name / unit**: [e.g. "completed fleet task" / completed-task]
- **Buyer can predict it before running work?**: [Yes/No — if No, name the replacement metric]
- **Why the buyer would trust this metric**: [what they already track that maps to it]

## Cost Floor

| Component | $ per unit |
| --- | --- |
| Model token cost | [value] |
| Tool/compute cost | [value] |
| Overhead | [value] |
| **Total unit cost floor** | **[sum]** |

## Price Points

| Tier | Base price | Included units | Overage rate |
| --- | --- | --- | --- |
| [tier] | [$] | [units] | [$/unit or "unmetered — see margin-erosion note"] |

## Guardrails

| Guardrail | Status | Notes |
| --- | --- | --- |
| Spend cap | [present/planned/missing] | |
| Budget preview | [present/planned/missing] | |
| Per-task estimate | [present/planned/missing] | |
| Transparent metering | [present/planned/missing] | |

## Persona Stress Test

Run `node scripts/pricing_stress.mjs --input <plan>.json` and paste the result:

```json
[paste the full JSON output here]
```

- **Pass**: [true/false]
- **Bill-shock risk level**: [none/low/medium/high]
- **Findings requiring action before launch**: [list]

## Decision

[Ship / revise — and the specific change required if revising, tied to a finding above.]
