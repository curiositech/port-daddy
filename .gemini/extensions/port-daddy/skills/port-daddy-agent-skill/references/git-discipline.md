# Git Discipline for Multi-Agent Repos

This page is the load-bearing rule set behind the SKILL.md "Git Discipline"
section. It is a faithful summary of ADR 0001 from external-skill-catalog, with the
post-mortem that triggered it.

## The triggering incident — external-skill-catalog `bb34efa` (2026-05-03)

Two agents were operating in the same repo. The foreground agent had eight
files staged for a v2.10.0 release commit. A background skill-creator
finished writing a new skill, ran `git add -A` followed by `git commit` to
record its single skill, and swept up all eight staged files into the same
commit. Its message — "skills: cdn-cache-control-headers (wave-4 grounded)" —
described one new directory but the diff covered 1,386 insertions across
ten unrelated files. The agent then pushed.

Origin/main now carries a misleading commit message. Force-pushing to
amend was disallowed (it rewrites public history; the user had explicitly
forbidden it without authorization). The release tag annotation calls out
the mismatch as the only audit trail.

Cost was bounded this time. Next collision could ship half-finished
foreground work, or push a skill the user did not approve. The root cause
is **`git add -A` (and `git add .`) in agents that share a working tree.**

## The five rules

In priority order — earlier rules supersede later ones.

### Rule 1 — Long-running background work runs in a git worktree

Any agent that takes more than ~10 seconds between "start work" and
"commit" MUST do its work in a separate git worktree:

```bash
wt="../$(basename "$PWD")-$AGENT_NAME-$(date +%s)"
git worktree add "$wt"
cd "$wt"
# ... work, validate, commit here ...
```

This makes the work physically incapable of colliding with concurrent
foreground edits because the working trees are disjoint. The agent commits
inside its worktree, optionally pushes a feature branch, and a human (or a
coordinator) merges back to main. **Prefer this whenever feasible.**

### Rule 2 — `git add -A` and `git add .` are forbidden in agents

Agents editing files in a shared working tree (CI runners, fleet bots,
skill-creators, audit jobs) MUST stage by explicit path:

```bash
git add path/to/file1 path/to/file2 path/to/dir/file3
```

Pattern-based staging (`git add -A`, `git add .`, `git add -u`,
`git add ':(glob)**'`) is forbidden because it cannot distinguish "files
the agent wrote" from "files a different agent staged five seconds ago."

If an agent does not know what paths to stage, that is a symptom — the
agent should have tracked its own writes and is missing instrumentation,
not entitled to sweep the working tree.

### Rule 3 — Pre-commit dirty-tree check

Before committing, an agent MUST run `git status --porcelain` and verify
that every modified-but-unstaged file (`?? ` and ` M ` lines) is one the
agent itself produced. If an unfamiliar file appears, the agent MUST abort
with a clear message naming the unfamiliar paths. The user (or a
coordinator) decides whether the foreign file is in-scope.

A default-on `pre-commit` hook that runs this check belongs in any repo
with multiple agents writing to it. `pd guard install --mode enforce`
provides the reference.

### Rule 4 — Coordination lock for shared trees

When two agents share a working tree by design (rare; almost always Rule 1
is the better answer), they MUST serialize through a lock keyed on
`<repo>:git:write`. Port Daddy's `acquire_lock` is the reference. The lock
holder owns the staging area + commit + push for the duration of the lock;
everyone else queues. Locks expire after 5 minutes by default — long-running
work belongs in a worktree, not under a long-held lock.

### Rule 5 — Push only what you tagged

If a release tag points to a specific tree, the push command MUST be
`git push origin <tag>` and not `git push --follow-tags` or
`git push origin <branch>` from an agent that did not generate the branch
state. Branches are shared mutable state across agents; tags are
content-addressed and safe.

## Implementation hooks for fleet agents

If you are writing a `pd-fleet.yml` agent that touches git, encode these
as preconditions and postconditions:

```yaml
agents:
  test-gardener:
    workspace: worktree                  # Rule 1 — disjoint working tree
    git:
      stage: explicit-paths              # Rule 2 — never -A / .
      pre_commit_check: dirty-tree-strict # Rule 3 — abort on foreign files
      push: tags-only                    # Rule 5 — never push branches
    coordination:
      lock_required: false               # Rule 1 obviates Rule 4
```

A fleet agent that violates Rules 1–5 should fail loudly at config-load
time, not silently at commit time.

## What this is *not*

The rules apply specifically to **background and long-running agent work**.
A user pasting `git add .` into an interactive terminal is fine — the user
knows what they staged. The rules only kick in when an *autonomous agent*
is doing the staging, because autonomy without instrumentation is how
foreign files end up in someone else's commit.

## The pd-shim: destructive git verbs are guarded, not blocked

When Port Daddy is installed, `~/.port-daddy/bin/git` is on PATH ahead of
the real git binary. It is a transparent wrapper that intercepts the
verbs most likely to cause cross-agent damage and consults the
coordination guard before letting them through:

| Verb              | Why it's guarded                                                   |
|-------------------|--------------------------------------------------------------------|
| `reset --hard`    | Stomps uncommitted work across the tree (yours and other agents'). |
| `checkout -- .`   | Same blast radius as `reset --hard` for unstaged paths.            |
| `clean -fd`       | Removes untracked files agents may be mid-authoring.               |
| `add -A` / `add .`| Stages foreign files; the rule that produced this discipline.      |
| `stash push/save` | Hides other agents' WIP under a name nobody else knows.            |
| `cherry-pick`     | Replays commits that touch files outside your claim set.           |
| `rebase`          | Same as cherry-pick, with branch-history rewrite as a bonus.       |

The shim flow:

```
git rebase origin/main
  → pd-shim calls `pd guard check --git-verb rebase --hook`
  → guard inspects: file claims, dirty tree, foreign WIP, dead-session salvage
  → guard says go        → real git runs
  → guard says no        → shim prints the refusal + suggests `pd guard status`
```

A refusal is not a bug. **The right response to a shim refusal is to
coordinate, not to bypass.** Read the refusal — it lists the specific
files held by which other sessions. Then:

1. **Salvage if the holders are dead.** `pd sessions --all-worktrees` and
   inspect the note content (a "usage limit exceeded" note from days ago
   is a corpse). `pd salvage --project <p>` cleans dead claims.
2. **Wait if the holders are live.** Live sessions own their surface
   until they release. Working *around* a live claim is the failure
   mode this discipline exists to prevent.
3. **Coordinate if the work is co-located.** `pd inbox send <agent>` the
   claim holder, or post in the project channel. Resolve by file
   partition, symbol partition, or merge order — never by force.

Agents have no self-authorized in-band escape. If the shim is wrong about
your situation, fix the guard input (claim more files, release a stale
claim, or explain the exception with a `pd note`). If the refusal remains
factually wrong, publish exact evidence to `coordination:inconsistency` and
surface the blocker to the operator; do not disable or route around the shim.

## See also

- `~/coding/external-skill-catalog/docs/adr/0001-background-agent-git-discipline.md` — the full ADR with alternatives considered and migration notes.
- `pd guard install --mode enforce` — install the staging-time enforcement hook.
- `pd guard check --git-verb <verb>` — manually invoke the shim's guard
  check; useful to see exactly what claims are blocking a destructive op
  before you try to run it.
- The `port-daddy-internal-dev` skill carries the matching contributor-side
  rules (release process, mirror sync, distribution).
