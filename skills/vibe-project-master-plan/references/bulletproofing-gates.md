# Bulletproofing Gates

Use this when reviewing whether a plan is ready for implementation.

## Gates

| Gate | Pass Condition | Common Failure |
| --- | --- | --- |
| Cold start | A new user can see value before perfect setup. | Empty screen, token wall, or "read docs first." |
| Account path | Signup, signin, invite, recovery, and deletion are named. | Auth is deferred until after features. |
| Provider fallback | Missing paid AI plan has demo/mock/local/routed-provider fallback. | Assumes the builder's personal account. |
| Trust boundary | Secrets, permissions, data retention, and audit logs are explicit. | Agent can touch everything after one click. |
| Surface fit | GUI/CLI/SDK/MCP/API choices match audience and frequency. | Everything is a CLI command or everything is a button. |
| Agent receipt | Agent work leaves progress, transcript, diff, test, and rollback evidence. | "Agent complete" with no proof. |
| Build slices | Milestones are independently reviewable and reversible. | One giant "build the app" phase. |
| Launch | Docs, telemetry, support, pricing, and incident response are included. | Shipping stops at deploy. |

## Planning Review Ritual

1. Read the plan once as a first-time user.
2. Read it again as support handling a failed first run.
3. Read it again as an agent that must implement slice 1 without hidden context.
4. Mark every unanswered question as either `must-fix-before-build`, `can-build-with-risk`, or `intentionally-out-of-scope`.
