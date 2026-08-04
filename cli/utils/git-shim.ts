/**
 * Git shim installer + content for the `~/.port-daddy/bin/git` wrapper.
 *
 * The shim intercepts destructive git verbs that have no native git
 * pre-hook (`reset --hard`, `checkout -- <path>`, `clean -fd`, `add -A`)
 * before they touch the working tree. For each detected verb the shim
 * calls `pd guard check --git-verb <verb> [--paths <paths>]` and refuses
 * to invoke the underlying git when the guard is in enforce mode and
 * affected files are claimed by other sessions.
 *
 * Why a shim instead of a hook: git ships hooks for `pre-commit`,
 * `post-commit`, `pre-push`, etc., but offers no `pre-reset` or
 * `pre-clean`. The shim is the only place to intervene before the
 * destruction happens.
 *
 * Why a separate file (not inline in guard.ts): keeps the shell script
 * payload as a single readable artifact and lets us version it.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const SHIM_BIN_DIR = join(homedir(), '.port-daddy', 'bin');
export const SHIM_GIT_PATH = join(SHIM_BIN_DIR, 'git');
export const SHIM_VERSION = '4';

export const GIT_SHIM_CONTENT = `#!/usr/bin/env bash
# Port Daddy git shim v${SHIM_VERSION}
# Intercepts destructive git verbs and consults the Port Daddy coordination
# guard before letting the underlying git touch the working tree or the
# public history.
#
# Working-tree destructive (v1+v2):
#   reset --hard, checkout -- <path>, clean -fd, add -A,
#   stash push/save, cherry-pick, rebase
# Public-history destructive (v3 — NEW):
#   push --force / -f / --force-with-lease   (any branch)
#   push --mirror / --all / --prune          (mass remote ref deletion)
#   push <remote> main|master|release/*      (direct push to protected)
#   filter-branch, filter-repo               (history rewrite)
#   update-ref refs/heads/main|master|release/*  (direct ref rewrite)
#   branch -D main|master|release/*          (protected branch deletion)
#
# There is NO in-band escape (see ADR-0119). A refused verb is refused;
# coordinate through the daemon and retry. The shim is advisory working-tree
# hygiene — the protected-branch wall is the binary-agnostic pre-push hook,
# and the real enforcement of record is off-box (branch protection).
#
# Activate by prepending ~/.port-daddy/bin to PATH.
set -euo pipefail

# Find the real git binary, skipping ourselves. We can't trust 'which git'
# alone because PATH may include this directory. Walk PATH manually and
# pick the first git that is *not* this script.
SELF="\${BASH_SOURCE[0]:-$0}"
SELF_REAL=$(cd "$(dirname "$SELF")" && pwd)/$(basename "$SELF")
real_git=""
IFS=':' read -ra parts <<< "\${PATH:-}"
for p in "\${parts[@]}"; do
  if [ -z "$p" ]; then continue; fi
  candidate="$p/git"
  if [ -x "$candidate" ]; then
    candidate_real=$(cd "$(dirname "$candidate")" && pwd)/$(basename "$candidate")
    if [ "$candidate_real" != "$SELF_REAL" ]; then
      real_git="$candidate"
      break
    fi
  fi
done
if [ -z "$real_git" ]; then
  echo "pd-shim: cannot find a real git binary on PATH" >&2
  exit 127
fi

# No in-band escape (ADR-0119): the shim never stands down on an env flag.
# An agent-settable env var was a hole through both this layer and the
# pre-push hook, taught to agents in the skill docs — removed.

# Detect destructive verbs. We use cheap argv pattern matching, not a full
# git arg parser — false positives just consult the daemon, false negatives
# are the failure mode the operator will report.
verb=""
case "\${1:-}" in
  reset)
    for arg in "$@"; do
      if [ "$arg" = "--hard" ]; then verb="reset-hard"; break; fi
    done
    ;;
  checkout|switch|restore)
    for arg in "$@"; do
      if [ "$arg" = "--" ]; then verb="checkout-paths"; break; fi
    done
    ;;
  clean)
    for arg in "$@"; do
      case "$arg" in
        -f*d*|-d*f*|-fd|-df|--force) verb="clean-force"; break ;;
      esac
    done
    ;;
  add)
    for arg in "$@"; do
      if [ "$arg" = "-A" ] || [ "$arg" = "--all" ]; then verb="add-all"; break; fi
    done
    ;;
  stash)
    # 'git stash' (default = push) and explicit 'git stash push|save' both
    # capture+wipe the working tree and were the mechanism behind the
    # 2026-04-28 auto-stash anti-pattern. pop/apply/drop/show/list/clear/
    # store/create/branch are not WT-destructive (or are restorative) and
    # pass through.
    if [ $# -eq 1 ]; then
      verb="stash-push"
    else
      case "\${2:-}" in
        push|save|"") verb="stash-push" ;;
        pop|apply|drop|list|show|clear|store|create|branch) ;;
        -*) verb="stash-push" ;;  # 'git stash -m msg', 'git stash -u' etc. default to push
      esac
    fi
    ;;
  cherry-pick)
    # cherry-pick rewrites the working tree to introduce arbitrary commits.
    # --continue/--abort/--quit/--skip are mid-flow controls and pass through.
    flow_only=""
    for arg in "$@"; do
      case "$arg" in
        --continue|--abort|--quit|--skip) flow_only="1" ;;
      esac
    done
    if [ -z "$flow_only" ]; then verb="cherry-pick"; fi
    ;;
  rebase)
    # rebase rewrites local history and replays commits over a new base,
    # touching every file in every replayed commit. --continue/--abort/etc.
    # are mid-flow controls.
    flow_only=""
    for arg in "$@"; do
      case "$arg" in
        --continue|--abort|--quit|--skip|--edit-todo|--show-current-patch) flow_only="1" ;;
      esac
    done
    if [ -z "$flow_only" ]; then verb="rebase"; fi
    ;;
  push)
    # v3: public-history destructive forms of push.
    # --force / -f are refused on ANY branch (plain force-push is unsafe even
    # on feature branches — silently overwrites concurrent work).
    # --force-with-lease is refused only on protected branches (main/master/
    # release/*); on feature branches it's the standard race-safe force.
    # --mirror / --all / --prune can mass-delete remote branches.
    # push <remote> main|master|release/* without force is also refused
    # (operators should PR instead).

    # First pass: classify the force/mass intent, and capture the remote ref.
    saw_plain_force=""
    saw_lease_force=""
    saw_mass=""
    for arg in "$@"; do
      case "$arg" in
        --force|-f)
          saw_plain_force="1" ;;
        --force-with-lease|--force-with-lease=*)
          saw_lease_force="1" ;;
        --mirror|--all|--prune)
          saw_mass="1" ;;
      esac
    done

    # Detect the remote ref: 'push <remote> <branch>' or 'push <remote> <local>:<remote-branch>'.
    target=""
    saw_remote=""
    for arg in "$@"; do
      case "$arg" in
        --*|-*) continue ;;
        push) continue ;;
      esac
      if [ -z "$saw_remote" ]; then
        saw_remote="1"
        continue
      fi
      target="$arg"
      break
    done
    is_protected=""
    if [ -n "$target" ]; then
      remote_ref="\${target##*:}"
      case "$remote_ref" in
        main|master|refs/heads/main|refs/heads/master) is_protected="1" ;;
        release/*|refs/heads/release/*) is_protected="1" ;;
      esac
    fi

    # Verb resolution.
    if [ -n "$saw_mass" ]; then
      verb="push-mass"
    elif [ -n "$saw_plain_force" ]; then
      # plain --force / -f refused on any branch
      verb="push-force"
    elif [ -n "$saw_lease_force" ] && [ -n "$is_protected" ]; then
      # --force-with-lease refused only on protected branches
      verb="push-force-lease-protected"
    elif [ -z "$saw_lease_force" ] && [ -n "$is_protected" ]; then
      # direct (non-force) push to protected branch — refused (use a PR)
      verb="push-protected"
    fi
    # --force-with-lease on a feature branch falls through cleanly.
    ;;
  filter-branch|filter-repo)
    # History rewrite. Refused outright.
    verb="history-rewrite"
    ;;
  update-ref)
    # Direct ref rewrite. Refuse only on protected branches.
    for arg in "$@"; do
      case "$arg" in
        refs/heads/main|refs/heads/master) verb="update-ref-protected"; break ;;
        refs/heads/release/*) verb="update-ref-protected"; break ;;
      esac
    done
    ;;
  branch)
    # branch -D / --delete --force on a protected branch.
    saw_force_delete=""
    target=""
    for arg in "$@"; do
      case "$arg" in
        -D|--delete) saw_force_delete="1" ;;
        -*) continue ;;
        branch) continue ;;
        *) if [ -n "$saw_force_delete" ] && [ -z "$target" ]; then target="$arg"; fi ;;
      esac
    done
    if [ -n "$saw_force_delete" ] && [ -n "$target" ]; then
      case "$target" in
        main|master) verb="branch-delete-protected" ;;
        release/*) verb="branch-delete-protected" ;;
      esac
    fi
    ;;
esac

if [ -n "$verb" ]; then
  if command -v pd >/dev/null 2>&1; then
    if ! pd guard check --git-verb "$verb" --hook >/dev/null 2>&1; then
      echo "pd-shim: $verb refused by Port Daddy coordination guard." >&2
      echo "pd-shim: coordinate first — 'pd begin', claim the files, then retry." >&2
      echo "pd-shim: see 'pd guard status' for current mode." >&2
      exit 1
    fi
  fi
fi

exec "$real_git" "$@"
`;

export interface ShimInstallResult {
  path: string;
  alreadyInstalled: boolean;
  pathHint: string;
}

export function installGitShim(): ShimInstallResult {
  mkdirSync(SHIM_BIN_DIR, { recursive: true });
  const existing = existsSync(SHIM_GIT_PATH) ? readFileSync(SHIM_GIT_PATH, 'utf8') : '';
  const alreadyInstalled = existing === GIT_SHIM_CONTENT;
  if (!alreadyInstalled) {
    writeFileSync(SHIM_GIT_PATH, GIT_SHIM_CONTENT);
    chmodSync(SHIM_GIT_PATH, 0o755);
  }
  return {
    path: SHIM_GIT_PATH,
    alreadyInstalled,
    pathHint: `Add to your shell rc:  export PATH="${SHIM_BIN_DIR}:$PATH"`,
  };
}

export function uninstallGitShim(): { removed: boolean; path: string } {
  if (!existsSync(SHIM_GIT_PATH)) return { removed: false, path: SHIM_GIT_PATH };
  // Remove the shim file. Keep the directory in case other shims live there.
  try {
    unlinkSync(SHIM_GIT_PATH);
  } catch {
    // Ignore — best effort.
  }
  return { removed: true, path: SHIM_GIT_PATH };
}
