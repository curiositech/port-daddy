# Gate Taxonomy: Required vs External

Use this when you need to decide whether a red or pending check should block a merge, or whether it's noise you should note and move past.

## The core split

Every check on a PR falls into exactly one of two buckets. Confusing them is the single most common agent PR-authoring failure.

| Bucket | Definition | Reaction to red |
| --- | --- | --- |
| **Required** | Its exact context is listed by the live branch ruleset, regardless of which workflow or App produced it. | Stop. Fix the root cause. Never merge, never `--admin` past it. |
| **Advisory** | Its exact context is absent from the live branch ruleset. It may be repo-owned or external and may still reveal a real bug. | Inspect and record material findings, but do not hold the merge merely for its status. |

The failure mode isn't "the agent doesn't know the difference" in the abstract — it's that the two buckets *look identical in the PR checks UI*. A red X is a red X until you check its provenance.

## How to tell which bucket a check is in

1. **Ask branch protection, not the checks list.** `gh api repos/<owner>/<repo>/branches/<base>/protection` (or the repo settings UI) lists the actual required-status-checks contexts. If a check's context string isn't in that list, it cannot block the merge queue no matter how red it looks.
2. **Ask `gh pr checks <n> --json name,state,bucket,workflow`** or `gh pr view <n> --json statusCheckRollup` to see each check's reported state and which workflow/app produced it.
3. **Cross-reference the app/workflow name against the known-external list** below before assuming a red check is yours to fix.

## Common advisory checks (verify against the live ruleset)

| Check | Why it's external | Typical failure mode |
| --- | --- | --- |
| **Cloudflare Pages** (preview build) | Runs Cloudflare's own build pipeline against the PR's branch, outside repo CI, often without production secrets/env scoping. | Fails on nearly every PR touching the site — missing env var, preview-only build quirk, or a transient Pages platform issue. This is expected steady-state noise, not a regression signal. |
| **CodeQL / third-party security scanners (informational mode)** | Often configured as advisory-only in smaller repos; check whether it's actually in the required-contexts list before assuming it blocks. | Long scan queue, false-positive alert on unchanged code. |
| **Review bots (Copilot, Claude review) as a "check"** | Their PR *comments* are real review findings you must answer (see `review-and-merge-mechanics.md`), but the check-run status itself is informational, not a branch-protection gate. | "Pending" while the bot is still generating review; not a blocker. |

Do not extend this list by assumption — verify with branch protection every time you inherit an unfamiliar repo. A repo-owned workflow is not automatically required, and an external App is not automatically advisory.

## Port Daddy repository custom

The `main merge queue` ruleset is the authority. Its 18 contexts are recorded in
`docs/operator/branch-protection-ruleset.md`; fourteen corresponding CI job IDs
feed `.github/workflows/ci.yml`'s `ci-gate`, while `roadmap-link`,
`pr-requirements-guard`, and `Port Daddy Fleet` report from separate workflows.
Do not add an advisory job to `ci-gate` merely because it exists in `ci.yml`.
The roadmap gate validates the PR's declaration only; versioned roadmap snapshot
freshness and membership are Chartroom reconciliation concerns and cannot freeze
unrelated merges.

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
