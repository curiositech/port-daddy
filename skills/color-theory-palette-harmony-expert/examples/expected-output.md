# Example Output: Palette Arrangement Recommendation

Scenario: 50 monochromatic beach photos (all blues/whites), 12 selected for
a collage (mirrors "Example 1: Monochromatic Beach Photo Set" in
`SKILL.md`). This is the recommendation and plan a downstream consumer
(collage-layout tooling, a design review) would see — not a narrated
description of the selection process.

```json
{
  "colorSpace": "lab",
  "deltaEMethod": "ciede2000",
  "selection": {
    "lambda": 0.6,
    "algo": "mmr"
  },
  "maxPairwiseEmd": 0.42,
  "chromaStdDev": 21.5,
  "hueCoverageDegrees": 168,
  "maxAdjacentTempDeltaB": 18,
  "sinkhorn": {
    "iterations": 34,
    "relError": 0.004
  },
  "blendRatio": 0.25
}
```

## Recommendation

- **Selected photos (ordered):** Photo_001 `(65, -8, -25)`, Photo_007 `(58, 4, -18)`, Photo_023 `(70, -12, -30)`, ... (12 total)
- **Arrangement pattern:** Hue-sorted gradient with MMR-driven diversity (λ=0.6) rather than pure harmony ranking.
- **Why this pattern:** All 50 candidates are dominant blues (H≈210-240°); a pure-harmony selection would pick 12 near-identical skies. MMR with λ=0.6 trades a small harmony loss for photos that are visually distinguishable (e.g. Photo_007 over a higher-harmony but near-duplicate Photo_023 first, per the MMR score comparison in `SKILL.md`).
- **Why these selections:** Chosen to keep maxPairwiseEmd above the 0.3 collapse threshold while staying within 120° of the beach hue cluster.

## Diagnostics

- **Diversity:** maxPairwiseEmd = 0.42 (above the 0.3 collapse threshold — pass)
- **Saturation spread:** chromaStdDev = 21.5 (above the 15 monotony threshold — pass)
- **Temperature coherence:** maxAdjacentTempDeltaB = 18 (well below the 40 incoherence threshold — pass)
- **Optimization convergence:** Sinkhorn iterations = 34, relError = 0.004 (both within bounds — pass)
- **Authenticity:** blendRatio = 0.25 (below the 0.4 cap — pass)

Running the plan through the auditor confirms it is genuinely diverse and
perceptually valid, not just harmonious-looking:

```
$ node scripts/palette_audit.mjs --input examples/sample-input.json
{
  "pass": true,
  "findings": [],
  "recommendations": [
    "Plan passes all documented failure-mode checks. Spot-check a rendered preview against the target palette before trusting the score."
  ]
}
```

What makes this a *good* plan, in reviewer terms: it works in LAB space
with CIEDE2000 (no Perceptual Mismatch risk), its diversity and saturation
diagnostics both clear their thresholds (no Diversity Collapse or
Saturation Monotony), its Sinkhorn solver actually converged (34 iterations,
relError 0.004 — no silent EMD Optimization Failure), and the color-grading
blend ratio stayed low enough to preserve photo authenticity.

For contrast, a plan built the naive way — comparing photos in raw RGB,
selecting purely by harmony (λ=0.9), on a nearly-monochromatic set — fails
every one of those checks at once:

```
$ node scripts/palette_audit.mjs --input weak-plan.json
{
  "pass": false,
  "findings": [
    { "id": "perceptual-mismatch", "severity": "critical", "message": "colorSpace is 'rgb', not 'lab'. ..." },
    { "id": "diversity-collapse", "severity": "high", "message": "Diversity Collapse risk (\"all blue skies\"): maxPairwiseEmd=0.15 < 0.3 and selection.lambda=0.9 > 0.8." },
    { "id": "saturation-monotony", "severity": "medium", "message": "chromaStdDev=5 < 15: ..." },
    { "id": "temperature-incoherence", "severity": "high", "message": "maxAdjacentTempDeltaB=55 exceeds 40 LAB b-units: ..." },
    { "id": "sinkhorn-non-convergence", "severity": "high", "message": "EMD Optimization Failure: sinkhorn.iterations=80 > 50 and sinkhorn.relError=0.02 > 0.01." },
    { "id": "authenticity-loss", "severity": "medium", "message": "blendRatio=0.6 exceeds 0.4: ..." }
  ],
  "recommendations": [ "..." ]
}
```
