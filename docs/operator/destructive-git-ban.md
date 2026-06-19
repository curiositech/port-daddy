# Destructive Git Operations — Refused By Default

Port Daddy refuses a list of git operations that would, on a bad day, lose
work, rewrite public history, or quietly delete remote branches. Refusing
them at the wrapper layer is cheap; resurrecting commits from somebody's
reflog at midnight is not.

## What is refused

**Working-tree destructive (since v1+v2):**

- `reset --hard`
- `checkout -- <path>` / `switch -- <path>` / `restore -- <path>`
- `clean -fd` / `-df` / `--force`
- `add -A` / `add --all`
- `stash` / `stash push` / `stash save`
- `cherry-pick` (except `--continue` / `--abort` / `--quit` / `--skip`)
- `rebase` (except mid-flow controls)

**Public-history destructive (v3):**

- `push --force` / `push -f` / `push --force-with-lease` — any branch
- `push --mirror` / `push --all` / `push --prune` — mass remote ref deletion
- `push <remote> main|master|release/*` — direct push to a protected branch
- `filter-branch` / `filter-repo` — history rewrite
- `update-ref refs/heads/main|master|release/*` — direct ref rewrite
- `branch -D main|master|release/*` — protected branch deletion

## How it is enforced

Three layers:

1. **pd-shim** at `~/.port-daddy/bin/git` — bash wrapper fronting real git
2. **`.git/hooks/pre-push`** — installed per-repo by
   `bash scripts/install-pre-push-hook.sh`. Runs even if pd-shim is bypassed
3. **GitHub branch protection** — remote, server-side, survives every local bypass

The autonomous-spawn case (`pd nightshift`) gets a fourth layer via the
`git-nightshift` wrapper in PR `feat/nightshift-safety-net`.

## How to bypass

`PD_SHIM_OFF=1`:

```sh
PD_SHIM_OFF=1 git push --force origin some-feature-branch
```

Appends to `~/.port-daddy/destructive-ops.log` with timestamp + argv. Loud, not silent.

## Pending

- Wire `pd guard install` to install the pre-push hook automatically
- `pd guard destructive-log` CLI for pretty-printed bypass audit
- Detect `git commit --amend` on commits reachable from `origin/<branch>`
