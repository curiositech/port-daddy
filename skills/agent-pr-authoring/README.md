# Agent PR Authoring

Author a pull request an AI coding agent can actually get merged: a scoped diff, an evidence-backed narrative, correct real-vs-external gate triage, and a clean landing through a merge queue.

Use this skill when opening, updating, triaging red CI on, or landing an agent-authored GitHub PR.

## Quick Start

1. Read `SKILL.md` for the scope-draft-triage-review-land process and the three anti-patterns.
2. Skim `references/gate-taxonomy.md` before reacting to any red check — classify it required-vs-external first.
3. Skim `references/review-and-merge-mechanics.md` before responding to review or landing.
4. Fill in `templates/output-template.md` for the actual PR body (Summary + Test Plan).
5. Build a PR-plan JSON matching `schemas/pr-plan.schema.json` and audit it:

```bash
node scripts/pr_readiness.mjs --input <your-pr-plan>.json
```

6. Compare against `examples/expected-output.md` to see a bad PR audited, then the same PR fixed and passing.
