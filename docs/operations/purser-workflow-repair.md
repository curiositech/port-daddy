# Purser workflow repair

Status: first safety wave implemented locally, not published or deployed.
Port Daddy remains halted. This document is a handoff, not restart authority.

Scope: Fleet Executor's Purser authoring, source inspection, sandbox validation,
and test-branch publication. No daemon/app starts, paid agents, model calls, or
deployment are authorized by this implementation exercise. Provider, GitHub,
and sandbox boundaries are mocked in local tests.

## Plan

- [x] Pin readable source and the import tree to the reviewed head; expose
  bounded, provider-neutral file inspection before authoring.
- [x] Connect executed harness failures to bounded repair with actual source
  evidence; preserve genuine assertion failures as review evidence.
- [x] Implement test publication above the reviewed implementation, without retargeting its
  PR; prohibit publication without trustworthy execution evidence.
- [x] Verify credential isolation, exact-head movement, source/path limits,
  repair exhaustion, and publication ordering with offline regression tests.
- [x] Update contributor guidance and prepare an attributable publication
  handoff without reactivating halted infrastructure.

## Acceptance boundaries

Source inspection is not permission to execute repository instructions.
Runner policy must come from a trusted base while imports/source come from the
reviewed head. Never invent exports, flatten all language suites into Jest, or
call a missing runner a clean review. File reads, repair rounds and test runs
must be bounded and receipted. The model does not receive GitHub credentials,
coordination credentials, or an unrestricted operator-host shell.

Tests and the implementation must be evaluated in the same tree that is
published. A Purser-authored harness failure is Purser's failure, not evidence
against the implementation. A real assertion failure is retained, not repaired
away to manufacture green. Existing human test edits must not be silently
discarded.

## Implemented contract

- Exact-head preparation happens before fresh inference; reused tests also get
  an owned disposable sandbox. Live review identity guards remain in place.
- Every Purser provider call offers the same bounded read-only protocol:
  two additional inspection rounds total, four files per read, 200-line/4-KiB
  excerpts, 64-KiB source budget, and 16 read operations. No arbitrary shell,
  MCP catalogue, full skill catalogue, or credentials go to the model.
- The PR description limit is 8 KiB with explicit omission/partial-coverage
  reporting. Bounded excerpts never claim whole-file coverage.
- The runner fetches using a temporary credential environment, then checks out,
  installs and runs tests in separate credential-free commands. Default setup
  uses `npm ci --ignore-scripts`; the approved Jest binary is invoked directly
  against authored paths. Commands have explicit execution timeouts.
- A zero exit without a consistent, positive structured test report is not a
  pass. Loader/zero-test failures are Purser machinery failures. At most one
  execution repair can change import locations; AST comparison preserves all
  other test semantics. Actual assertion failures remain red evidence.
- Sandbox cleanup must succeed before fresh publication. New test commits
  parent the tested head, and the test PR targets its branch. Original PR bases
  never change. Existing test branches are not force-updated by Purser; until
  explicit ownership receipts exist, replacement is held for attention.
- Missing sandbox, unsupported native/host language, exhausted source access,
  invalid execution, publication authority, or branch ownership leaves visible
  diagnostics and uses the existing interruption path. Notification delivery
  itself still depends on configured interruption bindings.

## Work still required before a complete rollout

1. Add approved package-local Vitest/Jest and native toolchain adapters, with
   package cwd, discovery, dependencies and runner-specific result receipts.
   The current adapter is root Jest; known native/host-script changes hold
   before model/sandbox spend. This does not implement native testing.
2. Add immutable ownership receipts and a guarded replacement protocol for
   existing Purser test branches. Current behavior preserves them and holds;
   it does not automatically recover or merge existing open test PRs.
3. Enforce fail-closed runner selection for arbitrary nested packages and
   audit generated-test side effects. A syntactically valid test can still test
   the wrong thing; syntax/import checks are not semantic correctness proof.
4. After the operator authorizes the specific services again, prove the actual
   deployed sandbox, resource cleanup and authenticated HITL delivery with an
   explicitly budgeted, disposable test repository. Do not use live pd-console
   or launch scripts as test fixtures.
5. Publish through the authorized repository-scoped App path only after
   confirming that doing so will not reactivate prohibited paid automation.
   Review the new exact-head CI result before any merge or deployment.

## Offline validation

The fleet-executor Vitest suite uses fake GitHub, provider and sandbox boundaries.
It executes production orchestration code but does not create real cloud
containers, call models, change GitHub, or start Port Daddy. TypeScript checking
and PR-body guard checks run separately. Exact commands and final results are
recorded in the prepared PR body at delivery.

## Delivery

Worktree: `/Users/erichowens/coding/tmp/pd-purser-workflow-20260908`.
Branch: `codex/purser-workflow-20260908`.
Starting main: `02a10b2848a1d8c53f39e42f652c0bc2595617b4`.
The earlier CI repair worktree is separate and unchanged.
