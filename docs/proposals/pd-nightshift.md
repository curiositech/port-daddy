# pd nightshift — autonomous overnight feature dev

**Status:** Proposal · first-cut implementation in this PR
**Branch:** `feat/nightshift-first-cut`
**Author:** nightshift first cut session (2026-05-20)

> **The pitch in one sentence.** Erich is in Claude Code / Codex ~10 hours a day. Port Daddy already wraps spawn, sessions, claims, costs, and bonds. The remaining unsolved piece is a *queue of vague hopes that turn into draft PRs while he sleeps* — bounded by cost, time, and blast-radius, with a `pd morning` review surface.

## Problem

The harness moves at the operator's tempo. The other 14 waking hours have great latent capacity: backlog drainable, design tokens not normalized, blog visuals not Bostock-grade, ADRs unwritten. Today those are "I'll get to it" items that decay.

The simplest possible answer — "leave Claude Code running with `--dangerously-skip-permissions`" — is unsafe in this repo. Coordination Guard, file claims, bonded harbors, daily caps, and per-spawn telemetry assertions exist precisely because *unsupervised agents are dangerous if not bounded*. So we want the bypass, but inside a wrapper that enforces blast-radius bounds operator already trusts.

## What exists already (compose, don't rebuild)

| Primitive | File | Role for nightshift |
|---|---|---|
| `pd spawn` with `claude-cli` and `codex` backends | `lib/spawner.ts` | The CLI invocations we wrap. Already does timeout, telemetry, cost capture, PD auto-coordination. |
| `pd spawn` (DB-of-record for bounded one-shot runs) | `lib/spawner.ts`, `routes/spawn.ts`, legacy `lib/sorties.ts` records | Each nightshift run is a spawned run with budget enforcement, result capture, and transcript evidence. |
| Sessions + file claims + Coordination Guard | `lib/sessions.ts`, `lib/coordination-route-guard.ts` | The nightshift worktree session must pre-commit through guard. |
| Bonds + harbors | `lib/bonds.ts`, `lib/harbors.ts` | Slash-on-misbehavior posture is already wired into spawner. |
| Cost tracker | `lib/cost-tracker.ts` | Per-spawn ceilings are non-negotiable; nightshift sets a hard `--budget` per intent. |
| Fleet engine | `lib/fleet-engine.ts` | Cron `*/N * * * *` and `0 N * * *` patterns. **Caveat:** current `parseCronInterval` is simplified and does NOT correctly schedule absolute times like `0 1 * * *` (1am). It coerces to a 10-min default. PR #137 is generalizing this. |

The PR #137 trigger work and PR #140 transcript-with-scrubbing work are in flight on branches and not yet on `main`. This proposal **composes against `main` only** so it can land independently. Once #137 lands, nightshift gets the proper 1am cron trigger for free.

## CLI surface

```
pd nightshift propose "<intent text>" [--tags a,b] [--budget 5] [--timeout 10800]
pd nightshift queue [--status pending|running|completed|all] [--json]
pd nightshift show <id>
pd nightshift run <id> [--dry-run]            # manual one-shot (testing / cron-less ops)
pd nightshift review <id>                     # surface PR + transcript for operator review
pd nightshift cancel <id>
pd morning [--since <ts>] [--json]            # TUI summary of overnight completions
```

Intent lifecycle:

```
proposed → queued → running → (succeeded | failed | aborted) → reviewed (done | discarded)
```

## Bypass-flag research (confirmed 2026-05-20 on this machine)

### Claude Code

```
$ which claude
/Users/erichowens/.local/bin/claude

$ claude --help | grep -E "dangerous|skip|permission"
  --allow-dangerously-skip-permissions   Enable bypassing all permission checks as an option,
                                          without it being enabled by default. Recommended only
                                          for sandboxes with no internet access.
  --dangerously-skip-permissions          Bypass all permission checks. Recommended only for
                                          sandboxes with no internet access.
  --permission-mode <mode>                Permission mode to use for the session
                                          (choices: "acceptEdits", "auto", "bypassPermissions",
                                          "default", "dontAsk", "plan")
```

**Chosen invocation for nightshift:** `claude --dangerously-skip-permissions -p "<intent>"` with a per-spawn working directory that is *only* the nightshift worktree. The flag is explicitly recommended-only-for-sandboxes — our sandbox is the worktree boundary, plus a wrapper deny-list (see below).

### Codex

The existing `runCodexCli` in `lib/spawner.ts` (lines 532–580 on main) already invokes:

```
codex exec --skip-git-repo-check --full-auto --sandbox workspace-write \
           -C <workspace> --output-last-message <tmp> --model <model> --json <task>
```

The `--full-auto` + `--sandbox workspace-write` pair is codex's analog of `--dangerously-skip-permissions`: it approves edits within `workspace-write` automatically without prompting. This is the right bypass for nightshift; we reuse the existing `runCodexCli` invocation as-is and just feed it the intent text.

**Critical caveat:** the existing `tempDir = mkdtempSync(join(tmpdir(), 'port-daddy-codex-'))` writes to `os.tmpdir()` which on macOS is `/var/folders/.../T/` (a private user-scoped temp). It is **not** the global `/tmp` and is not the user-banned `/tmp`. We leave it as-is for codex's `--output-last-message`; the user-level ban is specifically against `/tmp` and `/private/tmp`. **Action item for follow-up:** confirm with operator whether `os.tmpdir()` use is acceptable for codex's last-message file, since it is technically not `~/coding/tmp/`. (Belt-and-suspenders: future PR could redirect via TMPDIR override to `~/coding/tmp/nightshift/<id>/`.)

## Sandbox / blast-radius policy

This is the part that has to be right.

1. **Each nightshift run gets a fresh git worktree** under `~/coding/tmp/nightshift/<id>/`.
   - Created with `git worktree add ~/coding/tmp/nightshift/<id> -b night-shift/<id> origin/main`.
   - The agent only sees its own worktree as `cwd`. It cannot `cd` out via shell semantics in the spawner because spawner doesn't shell-exec the prompt.
2. **Hard deny-list, enforced via wrapper or git hook in the worktree:**
   - `git push origin main` — **forbidden**. Wrapper pre-receive blocks pushes to anything not matching `night-shift/<id>`.
   - `gh pr merge` — forbidden via wrapper. The agent may *open* a draft PR, not merge one.
   - `npm publish`, `gh release create`, `gh workflow run release*` — forbidden.
   - `brew bump-formula-pr`, anything touching `~/coding/homebrew-tap` — forbidden (separate repo).
   - Writing outside the worktree — bounded by `--sandbox workspace-write` for codex; for claude, by the wrapper monitoring its file ops via the pre-tool-use hook (deferred: see "stubbed" below).
3. **Hard time cap** — default 3h per spawn (`spec.timeout = 10_800_000`). The spawner already handles timeout + SIGKILL.
4. **Hard cost cap** — default $5/spawn (`bondUsd` or `budgetUsd`). The bonded spawn API already slashes on misbehavior.
5. **Coordination Guard** — the nightshift session uses purpose pattern `nightshift:<intent-slug>:<id>` so other agents reading `pd sessions` can see what's running. The agent inside the worktree inherits the session and must claim files through the same guard.
6. **One at a time, until trust grows.** v1 ships `max_concurrent_nightshifts = 1`. Even if the queue has 10 items, the cron tick picks 1.

## The cron path

Until PR #137 lands the full cron trigger, two paths exist:

- **Manual / OS cron fallback.** Operator (or system crontab) runs `pd nightshift run --next` at 1am. This is the path the first-cut tests support today.
- **Fleet cron (post #137).** A ship called `nightshift-runner` in `pd-fleet.yml` triggers on `schedule: "0 1 * * *"`, picks `next()` from the queue, runs it. The fleet engine's `parseCronInterval` is being generalized to honor absolute hour values; once that lands, nightshift gets it.

This proposal ships the manual path and adds a **commented** `pd-fleet.yml` entry so the operator can opt in when ready.

## Operator review flow (`pd morning`)

Print a Bostock-density summary at the start of the day:

```
PD MORNING — 2026-05-21, 7:42am · since 2026-05-20 22:00
─────────────────────────────────────────────────────────
  ✓ design-tokens-normalize           47 min  $1.23  PR #214  transcript
  ✓ landing-bostock-viz-prototype     2h 12m  $4.81  PR #215  transcript
  ✗ blog-visuals-batch                 3h 00m  $5.00  TIMEOUT  transcript
  ⏵ runtime-conformance-replay         in progress · 28 min elapsed · $0.41 so far

3 completed · 1 in flight · 1 timed out · $11.45 spent overnight (cap: $20.00)
Review:  pd nightshift review <id>
Approve: gh pr ready <num>     Discard: gh pr close <num> && git push origin --delete night-shift/<id>
```

## What's wired vs stubbed in this PR

**Wired (works end-to-end):**

- `nightshift_intents` SQL table on the existing `port-registry.db`
- `lib/nightshift/queue.ts` — full CRUD with status transitions, slug derivation, dedupe of identical intent text <!-- cite-exempt -->
- `pd nightshift propose / queue / show / cancel` — fully functional
- Tests: queue CRUD, slug derivation, `next()` picker semantics

**Wired but only against the local DB (no daemon route yet):**

- `lib/nightshift/runner.ts` — picks intent, **prints the worktree-creation + spawn command it would run, but does not invoke `claude` or `codex` in this PR.** This is the deliberate "don't actually run autonomous agents during a Claude Code session" guard. Operator-flipped flag `--really-run` is wired and documented but not exercised by tests. <!-- cite-exempt -->

**Stubbed (deliberately):**

- The pre-tool-use hook that denies `git push origin main` etc. for the claude backend — this needs Claude Code 1.x hook support and a settings.json override in the nightshift worktree. Codex's `--sandbox workspace-write` covers codex but not claude. **Operator decision needed before turning the cron on.**
- The `pd morning` TUI uses a plain table fallback, not blessed/ink. The Bostock-density variant is a follow-up.
- Cost ceiling enforcement: today's first cut sets `timeout` and reads `bondUsd` from the intent, but does not yet hard-cap mid-run. The spawner's existing bond-slash path handles this once we wire the intent into the canonical `pd spawn` admission path. Wiring intent→spawn is the post-merge follow-up.

## Two design decisions that need operator input before turning the cron on

1. **Default backend.** Codex's `--full-auto --sandbox workspace-write` is the *better* bypass primitive for unsupervised work because the sandbox flag is enforced by codex itself, not by a wrapper deny-list. Claude is more capable on long-context refactors but the deny-list path is wrapper-trust, not OS-trust. **Recommendation: default to codex; allow `--backend claude-cli` per-intent for jobs where claude is materially better.** Awaiting operator nod.

2. **What gets pushed.** Two flavors:
   - **(a)** Agent opens a draft PR as it goes; operator reviews in the morning.
   - **(b)** Agent commits to `night-shift/<id>` branch only, does NOT push; `pd morning` is where the operator (or `pd nightshift review`) pushes + opens PR.
   
   (a) is the "wake up to PRs" UX. (b) is safer because the operator's eyes confirm before anything reaches `origin`. **Default in this PR is (b) — opt into (a) per-intent.** Operator can flip the default.

## Out of scope for first cut (named so future-me knows)

- Multi-agent nightshift orchestration (one operator-style planner agent decomposing intents into sub-tasks across a spawned-run graph).
- Self-driven backlog scanning — for now, the operator types the intent. Auto-promotion from `feedback:dropped(severity=high)` is a future loop.
- The "Bostock-quality visualizations" reviewer — that's a downstream `pd nightshift review --critic` mode that runs a follow-up agent to score the work.
- Real-time monitoring of the running spawn from `pd morning` (needs SSE wiring to the spawn pipe).

## Risks called out, not hand-waved

- **Wedged commits on `night-shift/<id>` if the agent makes things worse.** Mitigation: branches are throwaway; operator decides which ones land.
- **Cost runaway via repeated retries.** Mitigation: `daily_cap_usd` at the fleet level; per-intent `bondUsd`; one-at-a-time gate.
- **Coordination Guard bypass.** The agent inside the worktree is configured to honor guard — but with `--dangerously-skip-permissions` a misbehaving prompt could force-push or rewrite history. Mitigation: pre-receive hook in nightshift worktrees that hard-blocks any ref-update to `refs/heads/main`. *This hook is not in the first cut.* It is the highest-priority follow-up before the cron flips on.
- **A nightshift sees secrets in `.env.local`.** Spawner already strips `ANTHROPIC_API_KEY` for claude-cli. Nightshift inherits that. Future hardening: a stricter env allowlist for nightshift spawns (don't inherit `.env.local` at all).

## File index

- `lib/nightshift/queue.ts` — SQLite-backed intent queue <!-- cite-exempt -->
- `lib/nightshift/runner.ts` — Picks intent, prepares worktree, prints (or runs) spawn command <!-- cite-exempt -->
- `cli/commands/nightshift.ts` — `pd nightshift propose/queue/show/run/review/cancel`
- `cli/commands/morning.ts` — `pd morning` summary
- `tests/unit/nightshift-queue.test.js` — queue CRUD <!-- cite-exempt -->
- `tests/unit/nightshift-slug.test.js` — slug + next-picker <!-- cite-exempt -->
- `pd-fleet.yml` — commented `nightshift-runner` ship entry
