# Example Output: Constructed Agent-Labor Pricing Review

This walkthrough uses made-up buyer names, prices, costs, and outcomes. It is a worked procedure, not a customer study, product quote, or launch proposal.

## Draft and diagnosis

A team proposes a hybrid plan for a `verified completed case` unit. Its declared cost floor is $0.20 per case. `team` is $100/month including 100 cases and $1 per excess case. The plan deliberately sets `perTaskEstimate: false` while the other guardrails are true.

The static checker reports `status: "blocked"`, even though a 100-case persona has $80 contribution. The concrete reason is the required guardrail: a hybrid plan exposes use, and a monthly forecast is not a substitute for an estimate at task submission. The portable regression suite independently clears each required guardrail and confirms a blocked report.

## Revision

Set `perTaskEstimate: true`, retain the cap, preview, and receipt, and rerun:

```json
{
  "status": "pass",
  "pass": true,
  "unitCostFloor": {"modelTokenCost": 0.1, "toolCompute": 0.05, "overhead": 0.05, "totalUnitCost": 0.2, "display": {"totalUnitCostUsd": "$0.200000"}},
  "marginByPersona": [{"name": "healthy-user", "status": "healthy"}],
  "policyBlocks": {"predictableValueMetric": false, "requiredGuardrails": false, "marginFloor": false, "explicitExcessTreatment": false, "outcomeSettlement": false},
  "billShockRisk": {"level": "none", "riskPoints": 0, "requiredGuardrails": ["spendCap", "budgetPreview", "perTaskEstimate", "transparentMetering"], "missingGuardrails": []}
}
```

This says the declared one-persona model clears the checker. It does not show that a cap exists in a deployed system or that the market accepts $100.

## Outcome-priced contrast

For an outcome model, use a verifier and unknown-result policy:

```json
{
  "model": "outcome",
  "outcomeSettlement": {"verifier": "named acceptance test", "unknownResult": "hold-for-review"}
}
```

If the verifier times out, the state is `Unknown`, then `Held`; it must not be silently billed as completed. A reviewer either confirms the billable outcome and emits a receipt or rejects it and records `NoCharge`.
