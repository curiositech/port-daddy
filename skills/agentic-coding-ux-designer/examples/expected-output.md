# Example Output: Agentic Coding UX Designer

## Flow

Name: summon skeptical reviewer

1. Operator selects a PR or diff and clicks the reviewer icon.
2. Surface preloads repo, branch, touched files, open review comments, CI state, and current Port Daddy session.
3. Operator chooses one of three scopes: security, correctness, or release readiness.
4. Agent starts in a sandboxed worktree and streams status as discrete receipts: context loaded, files claimed, tests selected, findings drafted.
5. Operator sees findings as actionable rows with severity, file link, evidence, and "fix", "defer", or "contest" actions.
6. The final receipt links transcript, diff, tests, PR comment, and rollback checkpoint.

## Magic Progression Score

```json
{
  "flowName": "summon skeptical reviewer",
  "score": 88,
  "pass": true,
  "averageFriction": 1.2,
  "recommendations": []
}
```

## Design Decisions

- Use icon-first invocation only when the selected surface already defines scope.
- Show progress as committed receipts, not freeform "thinking" text.
- Keep rollback visible until the PR is merged or the worktree is discarded.
- Record the agent's work in Port Daddy notes/transcripts so the operator can resume later.

## Artifact Requirements

- Screenshot of the invocation surface.
- Screenshot of progress receipts.
- GIF or short recording of invoke, progress, review, and rollback.
- Test or harness output proving the flow contract.
