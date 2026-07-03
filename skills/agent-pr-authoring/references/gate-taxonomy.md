# Gate Taxonomy: Required vs External

Use this when you need to decide whether a red or pending check should block a merge, or whether it's noise you should note and move past.

## The core split

Every check on a PR falls into exactly one of two buckets. Confusing them is the single most common agent PR-authoring failure.

| Bucket | Definition | Reaction to red |
| --- | --- | --- |
| **Required, repo-owned** | Runs the repo's own CI (lint, typecheck, unit/integration tests, `pr-requirements-guard`, `roadmap-link`, security scan) and is listed as a required context in branch protection. | Stop. Fix the root cause. Never merge, never `--admin` past it. |
| **External, advisory** | Runs outside repo CI — a deploy-preview pipeline, a third-party bot's informational comment, a docs-site build. | Note it in the PR (or a `pd note`) with evidence it isn't your regression, then proceed. It is not a merge blocker regardless of its status. |

The failure mode isn't "the agent doesn't know the difference" in the abstract — it's that the two buckets *look identical in the PR checks UI*. A red X is a red X until you check its provenance.

## How to tell which bucket a check is in

1. **Ask branch protection, not the checks list.** `gh api repos/<owner>/<repo>/branches/<base>/protection` (or the repo settings UI) lists the actual required-status-checks contexts. If a check's context string isn't in that list, it cannot block the merge queue no matter how red it looks.
2. **Ask `gh pr checks <n> --json name,state,bucket,workflow`** or `gh pr view <n> --json statusCheckRollup` to see each check's reported state and which workflow/app produced it.
3. **Cross-reference the app/workflow name against the known-external list** below before assuming a red check is yours to fix.

## Known-external checks (never merge blockers, by design)

| Check | Why it's external | Typical failure mode |
| --- | --- | --- |
| **Cloudflare Pages** (preview build) | Runs Cloudflare's own build pipeline against the PR's branch, outside repo CI, often without production secrets/env scoping. | Fails on nearly every PR touching the site — missing env var, preview-only build quirk, or a transient Pages platform issue. This is expected steady-state noise, not a regression signal. |
| **CodeQL / third-party security scanners (informational mode)** | Often configured as advisory-only in smaller repos; check whether it's actually in the required-contexts list before assuming it blocks. | Long scan queue, false-positive alert on unchanged code. |
| **Review bots (Copilot, Claude review) as a "check"** | Their PR *comments* are real review findings you must answer (see `review-and-merge-mechanics.md`), but the check-run status itself is informational, not a branch-protection gate. | "Pending" while the bot is still generating review; not a blocker. |

Do not extend this list by assumption — verify with branch protection every time you inherit an unfamiliar repo. The list above is common practice, not universal law.

## Known-required checks (real gates, fix the root cause)

| Check | What it enforces |
| --- | --- |
| `lint` / `typecheck` | Code compiles and matches style; a red result usually points at exactly one file. |
| `unit-tests` / `integration-tests` | Behavior didn't regress. A flaky-looking failure still needs a root cause, not a retry-until-green loop. |
| `pr-requirements-guard` | The PR body has a non-boilerplate `## Summary` and `## Test Plan` (and, for UI diffs, visual artifacts). Fails on an empty or templated section. |
| `roadmap-link` | Wants a `Roadmap-Item: <slug>` trailer in the PR body/commit, or an explicit opt-out: `Roadmap-Item: none — <reason>`. A missing trailer with no opt-out is a real failure, not a formality to route around. |

## Proving an external check "isn't your regression"

Before writing off any red check as external, do the two-line proof — don't just assert it:

1. Confirm the check's context string is genuinely absent from the required-contexts list (branch protection API/UI), not just "it's usually external."
2. If it's a build/deploy check, diff its failure against the same check's status on the base branch's latest commit (or another recent unrelated PR). If the base is also red on the identical step, it predates your change.

Record both in the PR (a one-line note plus the command/output) so the next reviewer doesn't have to redo the proof.
