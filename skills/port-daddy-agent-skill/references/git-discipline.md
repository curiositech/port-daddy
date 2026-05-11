# Git Discipline for Multi-Agent Repos

This page is the load-bearing rule set behind the SKILL.md "Git Discipline"
section. It is a faithful summary of ADR 0001 from windags-skills, with the
post-mortem that triggered it.

## The triggering incident — windags-skills `bb34efa` (2026-05-03)

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

## See also

- `~/coding/windags-skills/docs/adr/0001-background-agent-git-discipline.md` — the full ADR with alternatives considered and migration notes.
- `pd guard install --mode enforce` — install the staging-time enforcement hook.
- The `port-daddy-internal-dev` skill carries the matching contributor-side
  rules (release process, mirror sync, distribution).
