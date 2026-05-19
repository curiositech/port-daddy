# 0037. Git Access Control + `pd feature` Verbs in Coordinated Repos

## Status

Proposed (2026-05-19)

## Context

Coordination Guard (`cli/commands/guard.ts`, modes `off | warn | enforce`)
fires on `git commit` via a pre-commit hook. The `pd-shim` already intercepts
a few destructive verbs — we observed it refuse `git checkout -- <path>` in
this very session. But the shim's coverage is patchy and the operator-facing
verb surface for "do work in a repo" is still raw git, with all the
collision hazards that brings.

On 2026-05-19 three sortie agents were dispatched in parallel into the same
working directory. Each one ran `pd begin` and claimed files, but they all
ended up editing the *same* working tree. The agents collided in exactly the
way claims are supposed to prevent — one agent's edits were reverted by
another's `git checkout`, a third stashed defensive snapshots labeled
`wip-not-mine-from-feat-coord-counter-coverage`, and at least one
half-committed work to a branch the operator never intended. The agent that
survived cleanly was the one that thought to create its own worktree.

Claims are advisory. The pre-commit hook is necessary but not sufficient.
The roadmap already names `claim-preserving-git-safety` and
`coordination-guard-extended-enforcement` as known gaps. This ADR pulls
those threads together into one coherent answer:

> In a Port-Daddy-managed repo, raw git should be a fallback path, not the
> default. Coordinated work happens through PD verbs that ensure isolation,
> attribution, and an audit trail. Raw git remains available but is
> shimmed: read-only verbs pass through; mutation verbs require a claim or
> a session; destructive verbs require explicit override.

The pattern the operator has been hitting — "agents thrash when they share
a cwd" — is solved at the architectural level by **making worktree
isolation the path of least resistance**, not by adding more discipline
checks on top of a shared tree.

## Decision

Three composing layers.

### Layer 1 — Extend `pd-shim` for git

The shim already intercepts in PD-managed repos (detected by
`.git/port-daddy/` presence). Expand its verb taxonomy:

| Category | Examples | Behavior in `enforce` mode |
|---|---|---|
| **Read-only** | `status`, `log`, `diff`, `blame`, `show`, `branch --list`, `worktree list` | pass through, no check |
| **Local mutation (claim required)** | `add`, `restore`, `stash push`, `mv`, `rm` | refuse if a target file isn't claimed by the active session; emit "Use `pd add` to claim+stage" |
| **Destructive (session + explicit override)** | `reset --hard`, `clean -f`, `cherry-pick`, `checkout -- <path>`, `revert` | refuse without `PD_SHIM_OFF=1` or `--allow-claim-bypass`; suggest `pd revert <slug>` instead |
| **Branch / worktree (route to pd verbs)** | `checkout -b`, `branch <new>`, `worktree add` | succeed in `warn` mode with a warning; in `enforce` mode bind the new branch/worktree to a PD session automatically |
| **Network (session + done required)** | `push`, `push --force` | refuse if `pd done` was not called for the current session; force-push to `main` always refused regardless of override |

In `warn` mode (the default migration position), every category beyond
read-only emits a one-line suggestion and continues. In `enforce` mode the
suggestions become refusals. Operators can downgrade to `warn` or `off` per
repo via `pd guard set --mode warn`.

The shim writes a one-line entry to the existing `activity_log` table for
every refusal — that becomes the audit trail of operator overrides and the
data feed for "agents who keep tripping the shim" reports.

### Layer 2 — New high-level verbs

Five new PD verbs, all of which assume an active session and a claim
discipline. Each one's mental model is "the git verb you'd reach for, plus
the coordination side-effect you'd otherwise forget."

#### `pd feature <branch-name>` — create worktree + branch + session

```
pd feature <branch-name> [options]
  --from <ref>                  Branch from this ref (default: origin/main)
  --identity <id>               PD identity (required)
  --purpose <text>              Session purpose (required)
  --worktree <path>             Override worktree path
                                (default: ~/coding/tmp/pd-<branch-slug>)
  --symlink-deps                Symlink node_modules from source worktree
                                if package-lock.json hashes match (default)
  --install                     Force `npm install` instead of symlinking
  --json                        Emit { worktree, branch, session_id }
```

Implementation:
1. `git worktree add <path> -b <branch> <ref>`
2. Conditionally symlink `node_modules` (md5 of `package-lock.json` matches
   source worktree) or fall back to `npm install`
3. `pd begin --identity ... --purpose ...` in the new worktree
4. Output the worktree path so the caller can `cd` into it
5. Print a one-line suggestion if the operator forgot to set
   `--symlink-deps` and dependencies are large

This is the verb every sortie should run *first*. It eliminates the entire
"three agents in one cwd" failure class by construction.

#### `pd add <files...>` — claim + stage

```
pd add <files...> [--claim-if-needed]
```

1. Verify session is active
2. For each file: verify it's claimed by the active session, OR
   `--claim-if-needed` auto-claims it
3. Refuse if any file is claimed by a different active session, with the
   conflicting session ID + agent in the error message
4. Run `git add <files>` for the claimable set

#### `pd commit -m "..."` — guard + commit + note

```
pd commit -m "<msg>"          # or -F <file>
pd commit --amend             # session-bound; refuses if last commit was another session's
```

1. Verify session active + all staged files claimed by this session
2. Run `pd guard check --staged`
3. Run `git commit ...`
4. Emit a `pd note` summarizing the commit (slug + sha + line count)
5. Record a cost event tied to the session (work span)

#### `pd push` — fetch-rebase-push with `done` gate

```
pd push [--push-without-done]
pd push --force                # refused on main/master always
```

1. Verify `pd done` was called for the active session, OR
   `--push-without-done` is passed
2. `git fetch origin`
3. If branch is behind: rebase onto upstream (or refuse, with
   `--no-rebase` for explicit no-op)
4. Refuse force-push to `main`/`master`/`stable` regardless of flags
5. `git push`
6. Emit `pd note "pushed <branch> @ <sha>"`
7. Auto-open PR if `--pr` flag present and `gh` is configured

#### `pd prune` — clean abandoned worktrees + branches

```
pd prune [--dry-run] [--worktrees] [--branches] [--all]
         [--idle-since <duration>]   # default 14d
```

1. List PD-managed worktrees whose sessions have no heartbeat for
   `--idle-since`
2. List branches with no upstream + no commits in the window
3. For each candidate: salvage uncommitted work to a PD-managed stash
   record (so it's recoverable via `pd salvage`)
4. Confirm before destructive removal in interactive mode; `--all` skips
   confirms (CI use)
5. `git worktree remove` + `git branch -D`

### Layer 3 — Per-worktree session lock

Per-worktree state at `<worktree>/.git/port-daddy/active-session.json`:

```json
{
  "session_id": "session-...",
  "agent_id": "agent-...",
  "identity": "port-daddy:whois-impl",
  "session_kind": "operator" | "sortie",
  "claimed_at": 1779000000000,
  "heartbeat_at": 1779000180000
}
```

#### Lock semantics differ by session kind

| Session kind | Created by | Heartbeat-gated release? | Auto-release after |
|---|---|---|---|
| **operator** | `pd begin` directly (identity NOT prefixed `sortie:`) | **No** | Never on heartbeat alone; only on explicit `pd done`, `pd unlock --force`, or `pd prune` finding the worktree itself abandoned (default 14 days, gated by file-mtime not heartbeat). |
| **sortie** | `pd sortie run`, `pd spawn`, or identity prefixed `sortie:` | **Yes** | 10 min of no heartbeat. Sortie sessions are ephemeral by design; if the agent died, salvage should claim the work. |

This asymmetry exists because the failure modes differ. A sortie that
heartbeat-fails is almost certainly dead and its lock should release so
salvage can take over. An operator who walked away for 10 hours is almost
certainly coming back to the same worktree and expects it untouched.

#### Mandatory auto-stash before any takeover

When a lock is force-released — for either kind — uncommitted WIP is
stashed to a `port-daddy/<session-id>` stash ref before the new session
gets the lock. The stash carries a metadata blob describing who held the
lock, when it was released, and why. Recoverable via `pd salvage` and
`git stash list`. **No takeover, ever, without first preserving the prior
session's WIP.** This is the safety valve that makes the heartbeat-gated
path for sortie sessions acceptable.

#### Other rules

- Lock acquired by `pd begin` (and by `pd feature` indirectly)
- Heartbeat refreshed every 30s while the session is live
- The shim refuses local-mutation and destructive git verbs if
  `active-session.json` exists, its `session_id` differs from the caller's
  current session, and either (a) it's an operator session OR (b) the
  heartbeat is fresh (< 10 min old) for a sortie session
- `pd done` releases the lock immediately and removes
  `active-session.json`
- `pd unlock --force --reason "<why>"` releases any lock; writes a
  `coordination:inconsistency` tuple naming the displaced session; runs
  the auto-stash first
- `pd prune` is the only mechanism that reaps abandoned operator worktrees;
  it gates on file mtime (default 14 days idle) AND auto-stashes any WIP
  before removing the worktree

The worktree is the unit of mutual exclusion; isolation is achieved by
creating more worktrees (cheap, via `pd feature`).

### Sortie auto-create-worktree

`pd sortie run` and `pd spawn` create the worktree before the child agent
starts:

```
pd sortie run "<goal>" --backend ... --budget ...
  + implicit: pd feature sortie/<slug> --identity sortie:<id> --purpose <goal>
  + child agent's cwd is the new worktree path (passed via env or arg)
  + on completion: pd done + (optional) auto-push
```

This eliminates the failure mode the operator triggered on 2026-05-19. A
sortie *cannot* land in the parent's cwd by accident.

## Consequences

### Wins

- The "agents thrashing in shared cwd" failure class disappears. Worktree
  isolation is the default, not a discipline check.
- The git mental model carries over (`pd add` ≈ `git add`,
  `pd commit` ≈ `git commit`), so the learning curve is small.
- Every coordinated repo gets a real audit trail of git verb activity, not
  just commit-time checks.
- Force-push to `main` becomes structurally impossible without
  `PD_SHIM_OFF=1`, which is itself an audited override.
- Sorties that don't follow the new model can be flagged trivially via
  activity-log inspection.

### Tradeoffs

- The shim adds a small per-call overhead. Mitigated by the read-only fast
  path (no daemon round-trip for `git status` / `git log`).
- The first time an operator runs into a refusal, they will be annoyed.
  Mitigated by `warn`-mode default, clear error messages with the suggested
  PD verb, and `PD_SHIM_OFF=1` as a documented escape hatch.
- Symlinked `node_modules` will fail when package-lock.json drifts. Mitigated
  by the hash check; falls back to `npm install` automatically.
- Agents that have memorized git verbs need to be re-trained on `pd
  add`/`pd commit`. Mitigated by updating CLAUDE.md, AGENTS.md, the
  port-daddy-agent skill, and the spawn-time system prompt.

### Migration

**Phase 1 (within 1 week):**
- Ship `pd feature` end-to-end (most leverage per LOC)
- Extend shim's verb taxonomy to the categories above; default `warn` mode
- Internal fleet scripts migrate to `pd feature` first

**Phase 2 (within 2 weeks):**
- Ship `pd add`, `pd commit`, `pd push`
- Add worktree-auto-create to `pd sortie run` and `pd spawn`
- Bump enforce mode for destructive verbs (reset --hard, clean -f, etc.)

**Phase 3 (within a month):**
- Ship `pd prune` and the per-worktree session lock
- Enforce mode for branch verbs (checkout -b, branch <new>)
- Update CLAUDE.md / AGENTS.md / the port-daddy-agent skill
- Update spawn-time system prompts to teach `pd feature` as the default

**Phase 4 (within two months):**
- Retire `--allow-main-worktree` for normal sessions
- Force-push to `main` always refused regardless of override
- Document `PD_SHIM_OFF=1` as the emergency-only escape with required note

### Resolved during draft review (2026-05-19)

- **`pd feature` dependency strategy:** symlink `node_modules` from source
  worktree if `package-lock.json` md5 matches; fall back to `npm install`
  on hash mismatch. Confirmed by operator.
- **Heartbeat-gated lock release safety:** operator sessions are *not*
  heartbeat-released; only sortie sessions are. Mandatory auto-stash to
  `port-daddy/<session-id>` ref before any takeover. Confirmed by
  operator after raising the "leave for 10 hours" scenario.

### Open questions

1. **Should `pd commit` accept inline `--amend`?** Lean yes for the
   single-author case (operator amending their own commit), refused if the
   last commit is from a different session.
2. **Worktree path convention:** `~/coding/tmp/pd-<slug>` by default. Some
   operators want them under the repo's `.claude/worktrees/`. Lean:
   configurable via `pd config set worktree.root <path>`; default keeps
   them outside the source repo to avoid recursive worktree nesting.
3. **Should `pd feature` auto-set tracking branch?** If `--from origin/main`
   is the default, the branch should track origin once pushed. Lean yes;
   the first `pd push` writes upstream automatically.
4. **What about `gh` (GitHub CLI)?** Not shimmed; out of scope. PRs are
   typically read-only on the operator side and tracked by GitHub itself.

### Related ADRs and slugs

- ADR-0033 — Roadmap Pop atomic claim (same "claim before action" pattern)
- ADR-0028 — Actor / Fleet / Agent / Session three layers (provides the
  identity model the lock builds on)
- ROADMAP § 8 slug `coordination-guard-extended-enforcement` — Phase 1 of
  this ADR's Layer 1
- ROADMAP § 8 slug `claim-preserving-git-safety` — Layer 1 enforcement of
  destructive verbs
- ROADMAP § 8 slug `session-context-cwd-reset` — informs the worktree-bound
  session lock design (cwd as identity is fragile; worktree as identity is
  durable)
