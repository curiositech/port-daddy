# Release-wave recovery inventory

Owner: Codex task `01a0522b-0b59-73a1-be3b-bc792feb6e34`.
Verified September 10, 2026 (America/Los_Angeles). This is a preservation
receipt and task list, not a new roadmap or a claim that anything is deployed.

Port Daddy remains halted. No CLI, MCP, daemon, application, paid agent,
release workflow, or integration test server was started during this recovery.
All Git writes disabled hooks. The operator's main checkout was not changed.

## Recovered work

Paths below are under `/Users/erichowens/coding/tmp/`.

| Work | Worktree / branch | Preserved head | Publication and readiness |
|---|---|---|---|
| Same-owner recovery | `port-daddy-pr10010-runtime-integration-20260905` / `codex/pr10010-runtime-integration-20260905` | `361d6296a` over `aa796d3fd` | Newly committed integration fixtures. Recovery security findings below remain open. |
| Release-candidate E2E suite | `port-daddy-release-candidate-e2e-20260905` / `codex/release-candidate-e2e-20260905` | `bcd0139a2` over `a04cab7c0` | Already committed; exact-branch GitHub PR lookup returned no PR. Artifact gate is not green. |
| Bounded counter maintenance | `port-daddy-counter-compaction-batches-20260905` / `codex/counter-compaction-batches` | `78c2bbea9` over `afa6b87cc` | Already committed; exact-branch GitHub PR lookup returned no PR. Latest fixes need independent validation. Unrelated `.scratch/.DS_Store` left untouched. |
| General App publisher | `port-daddy-fleetbot-pr-publisher-20260905` / `codex/fleetbot-pr-publisher` | `cd6485bbb` over `1499d0702` and `333e46d45` | Newly committed 1,315-line implementation and lookup hardening. Exact-branch lookup returned no PR. WIP, not wired or deployed. Historical author metadata preserved. |
| Shared App key parser | `port-daddy-shared-github-app-parser-20260905` / `codex/shared-github-app-key-parser` | `f6fd8695a` | Existing [PR #10049](https://github.com/curiositech/port-daddy/pull/10049) is closed. Do not open a duplicate. Closure alone is not a merge receipt. |
| This task's original history design | `.codex/worktrees/22436a9b-b7f4-426e-965a-d720990844f8/port-daddy` / `codex/design-agent-history-search-stack` | `8578d8af8` | Existing [PR #9997](https://github.com/curiositech/port-daddy/pull/9997) is closed. Original branch preserved. |

The two new recovery commits use `Codex Recovery Agent` attribution and reference
this task. They are preservation checkpoints, not authenticated PD actor receipts
or independent reviews. No historical human-authored commit was rewritten.

## Work still owed

- [x] Verify that this task is in a linked worktree, not the main checkout.
- [x] Read the five known release-worker worktrees without running PD.
- [x] Commit the loose recovery integration-test edits.
- [x] Commit the loose general publisher implementation.
- [x] Verify existing E2E and counter commits still exist.
- [x] Query exact E2E, counter, and publisher branch PR matches.
- [x] Operator explicitly allowed PR publication regardless of automatic reviewer cost on September 10, 2026. This does not lift the Port Daddy runtime halt.
- [ ] Publish the four recovered implementation branches as appropriately scoped PRs based on main, without overwriting existing branches or disguising WIP as merge-ready.
- [ ] Reconcile recovery's dependency on #10010 with current main; do not bulk-retarget or blindly rebase preserved work.
- [ ] Fix recovery response-loss idempotency, retired authority-field immutability, and credential-file custody.
- [ ] Revalidate the counter follow-up against full-scan and partial-hour query findings, including HTTP error mapping.
- [ ] Diagnose E2E compiled-artifact startup failure without claiming zero executed cases as a pass. Runtime execution remains prohibited during the halt.
- [ ] Finish publisher wiring, tests, identity provenance and ambiguous-outcome handling.
- [ ] Complete the wider task census: Chartroom #9989, Porthole, research/ADRs, product packaging, docs/skills, and earlier recovered artifacts. This five-worktree inventory is not that complete census.
- [ ] Follow each published PR through review and merge only when validated; no automatic release or installation is authorized by this inventory.

## Validation in this recovery

- `node --check tests/integration/cli.test.js`: passed before the recovery commit.
- `git diff --cached --check` for the recovery fixtures: passed.
- `git diff --check` for the publisher's tracked change: passed.
- `node --check` for both E2E runner modules: passed; this parses code without running the suite.
- No runtime or integration test was rerun; previous worker reports are historical
  evidence, not current validation. Full publisher typechecking is not claimed.

## Publication boundary

Read-only GitHub inspection found Actions enabled. Claude Code Review and Claude
Adversarial Review were disabled, but Copilot code review remained active.
Repository webhook listing returned no entries; that does not prove installed
GitHub Apps have no webhooks. The current credential cannot list user App
installations (HTTP 403).

The discussion on [PR #10109](https://github.com/curiositech/port-daddy/pull/10109)
specifically reports that external Fleet processes draft `pull_request:opened`
events. Thus draft status, a docs-only diff, disabled review workflows, and an
empty repository-webhook list are not proof of paid-agent containment. That PR
is still open. Do not spend money merely to learn whether the warning is stale.

Publishing is explicitly authorized even if automatic reviewers run. Reviewer
cost is no longer a publication gate for this recovery wave. This narrow change
does not authorize Port Daddy, Fleet, services, releases, deployments, or local
application launches, and it does not turn historical validation into current
proof.
