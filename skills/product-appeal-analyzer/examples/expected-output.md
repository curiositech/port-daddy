# Example Output: Product Appeal Analysis

**Scenario**: Reviewing a developer-tools landing page ahead of launch, for
two personas — a solo indie hacker and a staff engineer evaluating a team
rollout. Mirrors `examples/sample-input.json`.

## Executive Summary
- Both personas clear every Desirability Triangle vertex above 5/10; trust
  signals are the weakest area for the indie hacker (social proof 6/10).
- The 5-Second Test passes cleanly: category, audience, promise, and CTA are
  all clear within 5 seconds.
- The "I'll do it later" (urgency) objection is the one gap in the objection
  map — nothing on the page creates a reason to act today.

## Desirability Triangle Scores

| Persona | Identity Fit | Problem Urgency | Trust Signals | Overall |
|---------|-------------|------------------|----------------|---------|
| Solo indie hacker | 8.3/10 | 8.7/10 | 7.0/10 | 8.0/10 |
| Staff engineer | 7.3/10 | 7.3/10 | 8.0/10 | 7.6/10 |

## 5-Second Test
- What is this: clear
- Who is it for: clear
- Core promise: clear
- Next action: clear

## Top 3 Objections
1. "Is this legit?" (trust) — addressed via customer logos and a public changelog.
2. "What if it doesn't work?" (risk) — addressed via a 14-day free trial, no card required.
3. "I'll do it later" (urgency) — **unaddressed**; no cost-of-delay framing anywhere on the page.

## Priority Recommendations
- **Immediate**: Add a "why now" line near the CTA (e.g. cost of staying on the current workaround).
- **Medium-term**: Add a second social-proof unit (usage stat or named customer quote) to lift the indie hacker's trust score.
- **Long-term**: Consider a team-rollout case study to further raise the staff engineer's trust signals.

## Appeal Scorecard (verified: `node scripts/appeal_audit.mjs --input examples/sample-input.json`)

```json
{
  "pass": true,
  "findings": [],
  "recommendations": [
    "Spec passes every structural gate. Spot-check that the underlying scores still match the live page before shipping."
  ],
  "scorecard": {
    "personas": [
      {
        "name": "Solo indie hacker shipping nights and weekends",
        "vertexScores": { "identityFit": 8.33, "problemUrgency": 8.67, "trustSignals": 7 },
        "overall": 8.0
      },
      {
        "name": "Staff engineer evaluating tools for a team rollout",
        "vertexScores": { "identityFit": 7.33, "problemUrgency": 7.33, "trustSignals": 8 },
        "overall": 7.56
      }
    ],
    "fiveSecondTest": { "category": true, "forWho": true, "promise": true, "cta": true, "clearCount": 4 },
    "objectionsAddressedCount": 6,
    "objectionsTotal": 7
  }
}
```

`findings` stays empty here because only 1 of 7 objections is unaddressed —
below the "more than half unaddressed" threshold `appeal_audit.mjs` uses for
the `objections-mostly-unaddressed` finding. Only four things flip `pass` to
`false`: a Triangle vertex &lt;5 for any persona, a failed 5-Second Test
(fewer than 3 of 4 clear), a trust-ladder violation, or an
identity-mismatch/feature-soup-headline/screenshot-hero flag. An unaddressed
objection on its own is a recommendation, not a stop-ship defect — see the
low-appeal example below for what a failing spec looks like.

## Failing Example (for contrast)

A spec with weak identity fit and a trust-ladder violation:

```json
{
  "personas": [
    {
      "name": "Generic visitor",
      "identityFit": { "visual": 3, "language": 4, "impliedUser": 3 },
      "problemUrgency": { "painAcknowledged": 6, "emotionalResonance": 5, "solutionClarity": 6 },
      "trustSignals": { "execution": 6, "socialProof": 4, "riskReduction": 5 }
    }
  ],
  "fiveSecondTest": { "category": true, "forWho": false, "promise": true, "cta": true },
  "trustLadderViolation": true
}
```

produces `pass: false` with gating findings `triangle-vertex-below-five`
(identityFit ≈3.3/10) and `trust-ladder-violation`.
