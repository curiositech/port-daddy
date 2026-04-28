# Machine Salvage Tasks

Last updated: 2026-04-28
Owner: `port-daddy:machine-salvage-orchestration`

Purpose: track salvageable dead-agent and non-standard worktree residue across
this machine. Port Daddy `pd salvage` is the first signal, but it is not enough:
work also appears in repo-local `.claude/worktrees`, `~/.claude-worktrees`,
`~/.cursor/worktrees`, `.21st/worktrees`, and ad hoc sibling worktrees.

## Listener State

- Cartographer resolves to the durable Navigator actor.
- Current state: `RECOVERABLE`, not attached to a live body.
- Navigator inbox has 9 unread messages. Actor messages are durable handoff
  evidence, not proof that Cartographer has acted.

## Active Salvage Board

| ID | Project / Worktree | Status | Evidence | Next Action |
|---|---|---|---|---|
| MS-001 | `/Users/erichowens/coding/port-daddy` | Finished by subagent Sagan | Website Mac app / cold-start slice no longer breaks `website-v2`: orphaned duplicate `product.ts` tail removed; fake screenshot references replaced with asset-free `APP_SURFACES`; `MacAppShowcase` renders cards; `ColdStartSection` preserved unwired. Validation: `website-v2` build, lint, and 87 tests pass. | Ready for a narrow website commit: `product.ts`, `MacAppShowcase.tsx`, `ColdStartSection.tsx`. Leave sections unwired until real screenshots/assets exist. |
| MS-002 | `/Users/erichowens/coding/port-daddy-pr5` | Finished locally by subagent Laplace | Local commit `716181e` on `codex/pr-5-pki-deliberation` covers PR #5 PKI deliberation plus spawner harbor bond admission; worktree is clean. Validation: typecheck passed, focused spawner tests `99/99`, PKI skill validation/selftest/score passed, `git diff --check` clean. Current live main still fails `pd fleet run cartographer` with `harbor-required` until this class of fix lands/promotes. | Push/update PR #5; run full `npm test -- --no-coverage` if broad proof is needed before review or merge. |
| MS-003 | `/Users/erichowens/coding/expungement-guide` plus worktrees | Classified by subagent Linnaeus | Main checkout is a high-risk mixed dirty tree; `worktrees/state-data` has 5 tracked FL/NY/PA state-data edits with 4,862 insertions and passes lint/typecheck/diff-check, but needs legal-truth/source review; `worktrees/wizard` is only `.CLAUDE_LOCK` residue; multiple clean ahead article/product branches need review. | Do not salvage wholesale. Treat `state-data` as the first candidate after legal/source review; clean `.CLAUDE_LOCK` only after confirming no live wizard owner; review clean ahead branches as PR/rebase candidates. |
| MS-004 | `/Users/erichowens/coding/jbuds4life` plus Claude worktrees | Partly finished by subagent Bohr | Main checkout is broad mixed dirt and includes a hardcoded API key in `experiments/blog-image-styles/scripts/gen-character-sheets-v4.py`; onboarding worktree was committed locally as `3a3e8bf9` (`fix(onboarding): update geocoder user agent`) after `git diff --check` and focused ESLint passed with one existing hook warning. Admin/user-facing token migration worktrees need rebase/screenshots; worker companion path is high risk and overlaps main Kit/AI Search work. | First priority: remove/rotate the hardcoded secret in jbuds4life main. Then review/merge onboarding commit; rebase/screenshot token migration slices; reconcile worker/API path with main direction before tests/commit. |
| MS-005 | `/Users/erichowens/coding/workgroup-ai` plus Claude worktrees | Partly finished by subagent Huygens | Main checkout has 2,860 dirty paths and must not be bulk-committed. Safe executor slice in `.claude/worktrees/agent-aa6fba4b` was committed locally as `5be42942` (`Extract node prompt builder`) after focused core tests `89` passed, `pnpm --filter @workgroup-ai/core typecheck` passed, and `git diff --check` passed. `madi-fresh` and `madi-prototype` remain dirty marketing slices with build artifacts/generated data. | Rebase/review/push `agent-aa6fba4b` separately. For marketing, compare `madi-fresh` vs `madi-prototype`, drop `tsconfig.tsbuildinfo`, and validate build/visuals before commit. Leave main dirty tree split by generated skill corpus vs real source. |
| MS-006 | `/Users/erichowens/coding/ai_tutor` plus Cursor worktrees | Classified by subagent Turing | Four dirty Cursor worktrees (`9Lsjf`, `lqRg7`, `tN7lR`, `vPV1u`) are byte-identical at HEAD `c6bc12b`; main only has local metadata dirt; `nmZTT`/`qTTEL` are clean duplicates and `hBsAk` is clean behind upstream. | Keep `/Users/erichowens/.cursor/worktrees/ai_tutor/9Lsjf` as canonical salvage source; ignore/prune duplicate Cursor worktrees later after preserving it. |
| MS-007 | Port Daddy salvage queue cleanup | Pending | `pd salvage --project port-daddy` shows 76 pending entries, many completed/promoted or no-note residue. | After active source work is handled, cluster completed/no-evidence rows and dismiss or document. |
| MS-008 | `/Users/erichowens/coding/jbuds4life` secret cleanup | Finished locally by subagent Hypatia | Committed `60d231e3` in `jbuds4life`: `gen-character-sheets-v4.py` now reads `IDEOGRAM_API_KEY`, fails closed when missing, and no longer contains the hardcoded key. Validation: `py_compile`, missing-env dry-run, missing-env normal run, and token-shaped literal scan on target script. | Rotate the exposed Ideogram key immediately and configure only the replacement as `IDEOGRAM_API_KEY`. |
| MS-009 | `/Users/erichowens/coding/port-daddy` Cartographer listener unblock | Finished locally by subagent Mill | Committed `a33fbd6` in main: spawner creates/enters the project fleet harbor before bond escrow, passes `harborName`, injects `harbors`, and adds harbor admission/order/cleanup tests. Validation: typecheck passed, focused spawner tests `90` passed, source dry proof completed/refunded/cleaned harbor membership, and `pd guard check --staged` passed. | Cartographer is unblocked in source. Relaunch/promote the daemon before expecting live `pd fleet run cartographer` or scheduled Cartographer to listen. |
| MS-010 | `/Users/erichowens/coding/jbuds4life` credential sweep | Pending | MS-008 found sibling scripts with Ideogram-looking hardcoded keys. | Run a scoped credential sweep over jbuds4life scripts, remove remaining hardcoded keys, and rotate any exposed values. |

## Known Non-Worktree Residue

- `/private/tmp/port-daddy-header-fix`: registered Git worktree entry is
  prunable and points to a missing path.
- `/private/tmp/port-daddy-pr5-daemon`: runtime DB/socket/heartbeat residue,
  not a Git worktree.
- `/private/tmp/claude-501/-Users-erichowens-coding-port-daddy`: task-output
  residue, not a Git worktree.
