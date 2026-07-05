# Example Output: Agent Labor Pricing Function

Scenario: unblocking Port Daddy's stalled Phase 2 pricing lane for the background Fleet feature — pricing a hybrid seat-plus-overage plan for agents that run background tasks (code fixes, PR review replies, test repair) to completion.

## Chosen Model

- **Model**: hybrid
- **Why this model fits**: Fleet usage has a predictable core (most teams run a steady number of background tasks per month) plus occasional bursts (a migration, a big refactor, an incident response sprint). A pure per-seat price would leave heavy-burst months unpriced; pure metering would expose light users to raw per-task billing they can't forecast. A seat-anchored base with a defined overage rate covers both, per `references/pricing-model-decision-guide.md`.

## Value Metric

- **Name / unit**: completed fleet task / completed-task
- **Buyer can predict it before running work?**: Yes — a completed fleet task is a terminal state (merged PR, closed ticket, or explicit human accept/reject), not a raw token or tool-call count. Buyers already track "how many background tasks did we run this month" informally; this metric makes that number billable.

## Cost Floor

| Component | $ per unit |
| --- | --- |
| Model token cost | 0.18 |
| Tool/compute cost | 0.06 |
| Overhead | 0.03 |
| **Total unit cost floor** | **0.27** |

## Price Points — First Draft (failed stress test)

| Tier | Base price | Included units | Overage rate |
| --- | --- | --- | --- |
| starter | $29 | 100 | $0.35 |
| team | $149 | 600 | $0.30 |
| enterprise | $999 | 5,000 | $0.22 |

Guardrails on the first draft: spend cap present, budget preview present, **per-task estimate missing**, transparent metering present.

### Stress test result (draft)

```json
{
  "pass": false,
  "model": "hybrid",
  "valueMetric": { "name": "completed fleet task", "unit": "completed-task", "buyerCanPredict": true },
  "unitCostFloor": { "modelTokenCost": 0.18, "toolCompute": 0.06, "overhead": 0.03, "totalUnitCost": 0.27 },
  "marginByPersona": {
    "solo-founder": { "tier": "starter", "monthlyUnits": 60, "overageUnits": 0, "revenue": 29, "cost": 16.2, "margin": 12.8, "marginPct": 44.1, "status": "healthy" },
    "staff-engineer": { "tier": "team", "monthlyUnits": 900, "overageUnits": 300, "revenue": 239, "cost": 243, "margin": -4, "marginPct": -1.7, "status": "negative" },
    "enterprise-admin": { "tier": "enterprise", "monthlyUnits": 3200, "overageUnits": 0, "revenue": 999, "cost": 864, "margin": 135, "marginPct": 13.5, "status": "thin" }
  },
  "billShockRisk": { "level": "high", "riskPoints": 5, "missingGuardrails": ["perTaskEstimate"] },
  "findings": [
    "Missing guardrail \"perTaskEstimate\" on a hybrid plan — usage-sensitive pricing without it risks bill shock.",
    "staff-engineer: NEGATIVE margin ($-4) on tier \"team\" at 900 completed-task/mo — cost ($243) exceeds revenue ($239).",
    "enterprise-admin: thin margin (13.5%) on tier \"enterprise\", below the 30% target."
  ],
  "recommendations": [
    "Emit a per-task cost estimate at submission time, not only in the monthly rollup.",
    "Raise the price floor or add per-unit overage billing on tier \"team\" — staff-engineer costs more than it pays."
  ]
}
```

The draft fails for two distinct reasons that read identically as "the pricing is wrong" but require different fixes: the `team` tier's overage rate doesn't clear the cost floor for a bursty staff-engineer persona, and the `enterprise` tier's base price undervalues its own included allotment even with zero overage.

## Price Points — Revised (passing)

| Tier | Base price | Included units | Overage rate |
| --- | --- | --- | --- |
| starter | $29 | 100 | $0.35 |
| team | $219 | 600 | $0.45 |
| enterprise | $1,299 | 5,000 | $0.22 |

Guardrails on the revision: spend cap present, budget preview present, per-task estimate **added**, transparent metering present.

### Stress test result (revised)

```json
{
  "pass": true,
  "billShockRisk": { "level": "none", "riskPoints": 0, "missingGuardrails": [] },
  "marginByPersona": {
    "solo-founder": { "tier": "starter", "monthlyUnits": 60, "revenue": 29, "cost": 16.2, "margin": 12.8, "marginPct": 44.1, "status": "healthy" },
    "staff-engineer": { "tier": "team", "monthlyUnits": 900, "overageUnits": 300, "revenue": 354, "cost": 243, "margin": 111, "marginPct": 31.4, "status": "healthy" },
    "enterprise-admin": { "tier": "enterprise", "monthlyUnits": 3200, "revenue": 1299, "cost": 864, "margin": 435, "marginPct": 33.5, "status": "healthy" }
  },
  "findings": [],
  "recommendations": [
    "Plan clears the cost floor and guardrail bar for the modeled personas — recheck when unit costs or personas change."
  ]
}
```

## Decision

Ship the revised plan. The team tier's overage rate and base price both moved to clear the 0.27/unit cost floor at a 30%+ margin target for a realistic burst persona, the enterprise tier's base price now covers its own included allotment, and the missing per-task-estimate guardrail is added so the hybrid model's overage exposure is previewed, not discovered on the invoice.
