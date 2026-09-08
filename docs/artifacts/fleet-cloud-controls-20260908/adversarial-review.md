# PR 10115: adversarial review record

Erich explicitly requested subagent reviews on September 8, 2026. Three
read-only subagents inspected head `1e77bc12b559c6f113433b766181413a244691de`
against base `02a10b2848a1d8c53f39e42f652c0bc2595617b4`. Codex authored the
fixes. Reviewers did not edit files, invoke Port Daddy, start services, call
paid models, publish GitHub comments or create further agents.

| Reviewer | Demonstrated defect | Fix and regression |
| --- | --- | --- |
| `review_fleet_auth` | P2: unrelated organization membership 404 hides owned installation controls | Deny that organization only; retain owned stop form, reject its unauthorized writes |
| `review_fleet_rollout` | P2: failed page read claims a durable global stop | Show unverified/work may continue; prove a later executor read can still allow work |
| `review_fleet_rollout` | P2: stale POST instructs a reload that repeats the stale form | Explicit GET recovery link; retrieve current revision, then successfully write |
| `review_fleet_enforcement` | P1: sandbox starts later commands/grants after stop | Required guard before each command/process/grant; stop at clone/setup/grant/process and retain cleanup |
| `review_fleet_enforcement` | P1: AI circuit converts terminal stop into a model failure | Preserve typed stop and retain it for the invocation; transient read recovery cannot revive model work |
| `review_fleet_enforcement` | P1: normal initial check creation misses stop | Guard initial creation after configuration/check lookup; no check POST after stop |
| `review_fleet_enforcement` | P1: stop read becomes stale during metadata lookup | Recheck after witness/intent awaits; no mutation after unchanged metadata returns with stop committed |
| `review_fleet_enforcement` | P1: merge-group/DLQ completion retry misses stop | Guard every PATCH attempt; first 503 commits stop and no second PATCH occurs |
| `review_fleet_enforcement` | P1: mediator checks/convening ignore stop | Required I/O and retry guards; delayed channel publication refuses before advancing chain |
| `review_fleet_enforcement`, second pass | P1: cache miss can mint credentials after stop | Required guard after signing immediately before token POST; real synthetic RSA tests for PR, merge-group and DLQ paths issue no requests |

The account and UI reviewers rechecked their fixes with no remaining actionable
finding. The enforcement reviewer rechecked the first six fixes, then identified
the token-cache race in a second pass. Final re-review confirmed all seven
enforcement findings closed, with no remaining actionable finding. Exact
published commit and review disposition are recorded in the PR body.

CI also caught a shared-module type error: ambient `D1Database` was unavailable
in the repository-root typecheck graph. A minimal structural primary-session
interface fixes it without adding Worker globals to the Node graph.

Validation: Relay 1,455 tests; executor 1,041 tests, all synthetic. Root, Relay
and executor typechecks; offline Worker bundles; migration chain; refreshed
32 layout configurations and 16 doubled-text-size checks. Final published CI
status must be read from the PR, not inferred from these local results.

Residual deployment risks are explicit: independent release order, old workers
that do not obey these controls, and automatic deployment filters that omit
shared-only edits. No cloud rollout or operational stop is claimed here.
