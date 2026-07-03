# Vibe Project Master Plan

Use this skill to turn a loose July 2026 vibe-coded project idea into a buildable, reviewable plan.

Run the scorer against a JSON manifest:

```bash
node skills/vibe-project-master-plan/scripts/plan_score.mjs --input plan.json
```

The skill is intentionally product-heavy: it forces cold start, account creation, provider readiness, proof artifacts,
rollback, and launch readiness into the plan before implementation starts.
