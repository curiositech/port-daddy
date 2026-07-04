# Palette Arrangement Recommendation Template

[One-sentence description of the photo collection or target palette this
recommendation covers.]

```json
{
  "colorSpace": "lab",
  "deltaEMethod": "[ciede2000|de94|euclidean]",
  "selection": {
    "lambda": 0.0,
    "algo": "[mmr|dpp|emd|flat]"
  },
  "maxPairwiseEmd": 0.0,
  "chromaStdDev": 0.0,
  "hueCoverageDegrees": 0.0,
  "maxAdjacentTempDeltaB": 0.0,
  "sinkhorn": {
    "iterations": 0,
    "relError": 0.0
  },
  "blendRatio": 0.0
}
```

## Recommendation

- **Selected photos/colors (ordered):** [list with LAB triples, e.g. `(65, -8, -25)`]
- **Arrangement pattern:** [hue-sorted gradient | warm/cool alternation | neutral-with-accent | temperature-balanced grid]
- **Why this pattern:** [tie the choice back to the Arrangement Pattern Decision tree in SKILL.md]
- **Why these selections:** [tie back to the harmony/diversity trade-off actually used]

## Diagnostics

- **Diversity:** maxPairwiseEmd = [value] ([above/below] the 0.3 collapse threshold)
- **Saturation spread:** chromaStdDev = [value] ([above/below] the 15 monotony threshold)
- **Temperature coherence:** maxAdjacentTempDeltaB = [value] ([above/below] the 40 incoherence threshold)
- **Optimization convergence:** Sinkhorn iterations = [value], relError = [value]
- **Authenticity:** blendRatio = [value] ([above/below] the 0.4 cap)

Validate the plan above with
`node scripts/palette_audit.mjs --input <this-plan-as-json>.json` before
trusting `pass: true` — the auditor catches a plan that only looks diverse
(e.g. RGB distance masquerading as harmony, or λ tuned so high that
diversity collapses) even if the recommendation text reads well.
