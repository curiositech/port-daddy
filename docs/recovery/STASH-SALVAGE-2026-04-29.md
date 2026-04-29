# Stash Salvage Ledger - 2026-04-29

Owner: `session-2c767e35-3831-4b26-bb2b-b9f0a44ad24b` (`agent-2a1e4f38`)

This ledger exists so the April 29 stash stack is recoverable without treating old
stash entries as invisible chat residue. The original stash stack is still intact
and should not be dropped until the exact branches below are reviewed or merged.

## Forward-Integrated

- `codex/integrate-stash0-stable-tests`
  - Commit: `7273c9c Integrate recovered stable route tests`
  - Source stash: `stash@{0}` / `codex/stash-exact-20260429-00-stable-dirty`
  - Integrated files:
    - `tests/unit/backend-readiness.test.js`
    - `tests/unit/info-routes.test.js`
    - `tests/unit/keychain.test.js`
    - `tests/unit/projects-routes.test.js`
    - `tests/unit/secret-env.test.js`
  - Validation:
    - `npm test -- --no-coverage tests/unit/backend-readiness.test.js tests/unit/info-routes.test.js tests/unit/projects-routes.test.js tests/unit/keychain.test.js tests/unit/secret-env.test.js`
    - `npm run typecheck`
    - `npm test -- --no-coverage` before rebasing onto the latest `origin/main`: 163 suites passed, 5,249 tests passed, 1 skipped
    - Post-rebase focused recovered-test suite and typecheck still passed

## Exact Recovery Branches

Each branch is a one-commit exact recovery of the corresponding stash entry, pushed
to `origin`. These branches intentionally preserve the raw stash state, including
some stale or generated residue, so review the status notes before replaying them.

| Stash | Branch | Commit | Status |
| --- | --- | --- | --- |
| 0 | `codex/stash-exact-20260429-00-stable-dirty` | `ae646b4` | Tests forward-integrated; roadmap docs preserved only |
| 1 | `codex/stash-exact-20260429-01-promotion-hold-port-daddy-agent-skill-mirrors-2026-04-29` | `4a0b70c` | Superseded by richer agent-skill mirrors already on `origin/main` |
| 2 | `codex/stash-exact-20260429-02-promotion-hold-readable-id-wip-2026-04-29` | `7dd6563` | Mixed readable-ID and website WIP; preserve exact branch, do not replay wholesale |
| 3 | `codex/stash-exact-20260429-03-promotion-blocking-cli-test-2026-04-29` | `586ece6` | CLI test slice plus unrelated website generated assets; review selectively |
| 4 | `codex/stash-exact-20260429-04-promotion-blocking-sugar-test-2026-04-29` | `5c03ef3` | Sugar test slice plus unrelated website generated assets; review selectively |
| 5 | `codex/stash-exact-20260429-05-promotion-blocking-readable-session-test-2026-04-29` | `31f34f9` | Session test slice plus unrelated website generated assets; review selectively |
| 6 | `codex/stash-exact-20260429-06-promotion-blocking-readable-id-tests-2026-04-29` | `763307c` | Readable-ID tests plus unrelated website generated assets; review selectively |
| 7 | `codex/stash-exact-20260429-07-promotion-blocking-source-2026-04-29` | `6b8a79c` | Cartographer tuple feedback source is already present on `origin/main`; replay would regress newer UI API/types |
| 8 | `codex/stash-exact-20260429-08-scratch-pngs-before-closing-pd-tube-branch` | `78baf67` | Scratch screenshots only; preserved, not promotable as-is |
| 9 | `codex/stash-exact-20260429-09-auto-stash-other-agents-wip-while-committing-hashscroll-` | `7e611c3` | Mixed runtime and website WIP; needs feature-level review before replay |
| 10 | `codex/stash-exact-20260429-10-pre-main-catchup-active-session-wip` | `651fdd1` | Small skill/style WIP; preserve and review against current site tokens |
| 11 | `codex/stash-exact-20260429-11-pre-main-catchup-examples-page-wip` | `3db0851` | Examples page WIP; preserve and compare to current website branch |
| 12 | `codex/stash-exact-20260429-12-salvage-stable-roadmap-docs-before-promotion-2026-04-29` | `0ce1b6d` | Older roadmap docs; preserved because live Cartographer state has moved |
| 13 | `codex/stash-exact-20260429-13-pr5-tube-pki-docs-demo-wip-before-main-pull` | `d83d58f` | PR5 tube/PKI docs demo WIP; preserve for website/docs review |
| 14 | `codex/stash-exact-20260429-14-pre-promote-1b-3-stash` | `2c61a62` | Superseded region-claim/client work; replay would delete newer SDK/MCP surface |
| 15 | `codex/stash-exact-20260429-15-pre-promote-track1b-stashed-info-routes` | `725e2ac` | Contains legacy Barnacle path; do not replay wholesale |
| 16 | `codex/stash-exact-20260429-16-temporary-dirty-tree-before-pushing-verified-release` | `bc38786` | Large historical release-surface capture; preserved only, review feature-by-feature |
| 17 | `codex/stash-exact-20260429-17-stable-package-lock-before-3-9-0-promotion` | `6b07146` | Old package-lock state; preserved, do not replay without dependency audit |
| 18 | `codex/stash-exact-20260429-18-pre-promote-stash-20260404` | `d85fa9f` | Pre-3.9 historical stable residue; preserved only |

## Next Review Order

1. Inspect stash 3-6 test deltas against `origin/main`; recover only assertions
   that still cover live behavior and are not already represented by current tests.
2. Inspect stash 9, 11, and 13 in a website worktree with the current dirty
   website branch in mind; do not replay screenshots or generated assets blindly.
3. Treat stash 14, 15, 17, and 18 as archaeology unless a current bug points back
   to a specific hunk.
