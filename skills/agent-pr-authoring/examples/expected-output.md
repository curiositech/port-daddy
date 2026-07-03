# Example Output: Agent PR Authoring

Scenario: an agent finishes a daemon fix and a batch of unrelated skill-doc edits in one session, opens one PR for everything, force-pushes over a review, and admin-merges past a failing lint check while a Cloudflare Pages preview build is also red. This is the "bad PR" `pr_readiness.mjs` is designed to catch.

## Bad PR — input

```json
{
  "title": "big cleanup",
  "body": { "hasSummary": true, "hasTestPlan": true, "testPlanHasEvidence": false },
  "diff": { "filesChanged": 43, "linesChanged": 2100, "mixedConcerns": true },
  "checks": [
    { "name": "lint", "required": true, "status": "failure", "external": false },
    { "name": "cloudflare-pages", "required": true, "status": "failure", "external": true }
  ],
  "reviewThreads": [
    { "severity": "critical", "resolved": false },
    { "severity": "high", "resolved": false }
  ],
  "mergeMethod": "squash",
  "usedAdminBypass": true,
  "forcePushed": true,
  "rebasedOnLatestBase": false
}
```

## Bad PR — audit result

```json
{
  "pass": false,
  "score": 4,
  "findings": [
    { "severity": "critical", "id": "test-plan-not-evidence-backed", "message": "Test Plan exists but carries no command output, exit code, or artifact — a claim, not proof." },
    { "severity": "high", "id": "oversized-diff", "message": "Diff touches 43 files / 2100 lines, over the reviewable thresholds (25 files / 600 lines)." },
    { "severity": "high", "id": "mixed-concerns", "message": "Diff is flagged as mixing unrelated concerns (e.g. refactor + feature + dependency bump)." },
    { "severity": "critical", "id": "required-check-failing", "message": "Required, repo-owned check \"lint\" is failing." },
    { "severity": "medium", "id": "external-check-marked-required", "message": "Check \"cloudflare-pages\" is marked both required and external — that's a contradiction that invites gate confusion." },
    { "severity": "medium", "id": "external-gate-treated-as-blocker", "message": "External check \"cloudflare-pages\" is failing and is (mis)configured as required — do not block the merge on it." },
    { "severity": "critical", "id": "unresolved-high-review-threads", "message": "2 unresolved high/critical review thread(s) remain." },
    { "severity": "critical", "id": "admin-bypass-used", "message": "PR was (or would be) merged with an admin override that bypasses branch protection." },
    { "severity": "critical", "id": "force-pushed", "message": "Branch was force-pushed after review or CI ran against it." },
    { "severity": "high", "id": "stale-base", "message": "Branch has not been rebased onto the latest base branch; mergeability can flip once another PR lands." },
    { "severity": "medium", "id": "bypassed-merge-queue", "message": "Merge method was explicitly set to \"squash\" instead of letting the merge queue choose its configured strategy." }
  ],
  "recommendations": [
    "Rewrite the Test Plan to paste real command output (or link a captured artifact) for every claim.",
    "Split the change into separate PRs by concern, or justify the size explicitly in the Summary.",
    "Split into one PR per concern so each is independently reviewable and revertable.",
    "Fix the root cause of \"lint\" — do not merge past a real required gate.",
    "Confirm branch protection's actual required-context list for \"cloudflare-pages\"; external checks (e.g. Cloudflare Pages preview builds) should never be required contexts.",
    "Reclassify \"cloudflare-pages\" as non-blocking (it is an external deploy preview, not repo CI) and proceed once real required checks are green.",
    "Address every high/critical finding as a named fixup commit, or reply with a contested-because rationale, before landing.",
    "Never use --admin on an agent PR to skip a real required gate; fix the gate or escalate to a human.",
    "Never force-push a PR branch; push additional named commits instead so review history stays intact.",
    "Fetch and rebase onto the latest base branch, then re-check mergeability before enqueueing.",
    "Enqueue the PR (e.g. gh pr merge <n> --auto) and let the merge queue apply its configured strategy rather than forcing --squash/--merge/--delete-branch by hand."
  ]
}
```

## What fixing it actually looked like

1. **Split the diff.** The daemon fix and the unrelated skill-doc edits became two PRs. The daemon fix alone: 4 files, 148 lines, one concern.
2. **Rewrote the Test Plan** with the real commands and pasted output (`npm test -- --testPathPattern=symbol-index`, exit code 0, plus the specific assertion that used to fail).
3. **Fixed the lint finding** at its root cause (an unused import flagged by the real, required `lint` check) instead of arguing with it.
4. **Reclassified `cloudflare-pages`** as non-blocking after confirming via `gh api repos/<owner>/<repo>/branches/main/protection` that it was never actually in the required-contexts list — the earlier PR had just misread a red X as a blocker. Left a one-line note with the proof.
5. **Answered both review threads**: the critical one with a named fixup commit, the high one by pushing a second fixup and replying with the commit SHA.
6. **Rebased onto `origin/main`**, reconfirmed `mergeable: MERGEABLE`, and enqueued with `gh pr merge <n> --auto` — no `--squash`, no `--admin`, no force-push.

## Fixed PR — input

This is `examples/sample-input.json`, unmodified:

```json
{
  "title": "fix(daemon): close symbol-index fd leak on watcher restart",
  "body": { "hasSummary": true, "hasTestPlan": true, "testPlanHasEvidence": true },
  "diff": { "filesChanged": 4, "linesChanged": 148, "mixedConcerns": false },
  "checks": [
    { "name": "lint", "required": true, "status": "success", "external": false },
    { "name": "unit-tests", "required": true, "status": "success", "external": false },
    { "name": "typecheck", "required": true, "status": "success", "external": false },
    { "name": "roadmap-link", "required": true, "status": "success", "external": false },
    { "name": "pr-requirements-guard", "required": true, "status": "success", "external": false },
    { "name": "cloudflare-pages", "required": false, "status": "failure", "external": true }
  ],
  "reviewThreads": [
    { "severity": "high", "resolved": true },
    { "severity": "low", "resolved": false }
  ],
  "mergeMethod": "queue",
  "usedAdminBypass": false,
  "forcePushed": false,
  "rebasedOnLatestBase": true
}
```

## Fixed PR — audit result

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "PR meets the readiness bar: scoped diff, evidence-backed narrative, real gates green, no bypasses. Enqueue it."
  ]
}
```

Note the remaining `cloudflare-pages` failure and the one unresolved `low`-severity thread: neither blocks `pass:true`. External checks never gate the merge, and only unresolved `high`/`critical` review threads are treated as blocking.
