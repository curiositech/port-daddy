# Product Appeal Analysis Template

[One-sentence description of the product/page being analyzed and who it's for.]

## Executive Summary
- [Key finding 1]
- [Key finding 2]
- [Key finding 3]

## Desirability Triangle Scores

| Persona | Identity Fit | Problem Urgency | Trust Signals | Overall |
|---------|-------------|------------------|----------------|---------|
| [Persona 1] | [/10] | [/10] | [/10] | [/10] |
| [Persona 2] | [/10] | [/10] | [/10] | [/10] |

## 5-Second Test
- What is this: [clear / unclear]
- Who is it for: [clear / unclear]
- Core promise: [clear / unclear]
- Next action: [clear / unclear]

## Top 3 Objections
1. [Objection] — [how it's addressed, or "unaddressed"]
2. [Objection] — [how it's addressed, or "unaddressed"]
3. [Objection] — [how it's addressed, or "unaddressed"]

## Priority Recommendations
- **Immediate**: [fix]
- **Medium-term**: [fix]
- **Long-term**: [fix]

## Structured Appeal-Audit Spec

Fill this in to match `schemas/appeal-spec.schema.json`, then validate with
`node scripts/appeal_audit.mjs --input <this-file-as-json>.json`.

```json
{
  "personas": [
    {
      "name": "[persona name]",
      "identityFit": { "visual": 0, "language": 0, "impliedUser": 0 },
      "problemUrgency": { "painAcknowledged": 0, "emotionalResonance": 0, "solutionClarity": 0 },
      "trustSignals": { "execution": 0, "socialProof": 0, "riskReduction": 0 }
    }
  ],
  "fiveSecondTest": {
    "category": false,
    "forWho": false,
    "promise": false,
    "cta": false
  },
  "objectionsAddressed": {
    "trust": false,
    "skepticism": false,
    "value": false,
    "effort": false,
    "identity": false,
    "risk": false,
    "urgency": false
  },
  "trustLadderViolation": false,
  "identityMismatch": false,
  "featureSoupHeadline": false,
  "screenshotHero": false
}
```

A `pass: true` result means every Triangle vertex scored ≥5 for every
persona, the 5-Second Test cleared 3 of 4 elements, and none of the four
anti-pattern flags were set — not that the underlying numbers are honest.
Spot-check those against the real page before trusting the score.
