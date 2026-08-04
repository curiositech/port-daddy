#!/usr/bin/env bash
# Install a .git/hooks/pre-push hook that refuses force-pushes to protected
# branches (main, master, release/*) and refuses mass-delete pushes
# (--mirror via push.default config).
#
# This is the second layer of the destructive-git-ban defense. The
# pd-shim (~/.port-daddy/bin/git) is the first, in-band advisory layer; this
# hook is the binary-agnostic WALL — git always runs pre-push hooks regardless
# of which binary called it, and (per ADR-0053) the wall must NOT stand down on
# an in-band environment variable. It therefore does NOT honor PD_SHIM_OFF: the
# only skip is git's own `--no-verify`, a deliberate, visible, non-agent-mintable
# flag. Setting PD_SHIM_OFF=1 bypasses the *shim*; this hook still fires.
#
# Usage:
#   bash scripts/install-pre-push-hook.sh           # current repo
#   bash scripts/install-pre-push-hook.sh /path/to/repo
#
# Already-installed hooks are backed up with a .pd-bak.<timestamp> suffix.

set -euo pipefail

REPO="${1:-$(pwd)}"
if [ ! -d "$REPO/.git" ]; then
  echo "install-pre-push-hook: $REPO is not a git repository" >&2
  exit 1
fi

HOOK="$REPO/.git/hooks/pre-push"
TS="$(date -u +%Y%m%d%H%M%S)"

if [ -e "$HOOK" ]; then
  BACKUP="$HOOK.pd-bak.$TS"
  cp "$HOOK" "$BACKUP"
  echo "install-pre-push-hook: backed up existing hook to $BACKUP" >&2
fi

cat > "$HOOK" <<'HOOK_EOF'
#!/usr/bin/env bash
# Port Daddy pre-push hook — refuses destructive pushes to protected branches.
#
# Reads stdin: one line per ref being pushed:
#   <local_ref> <local_sha> <remote_ref> <remote_sha>
#
# For each line:
#   - If <remote_ref> is refs/heads/main, refs/heads/master, or
#     refs/heads/release/*, AND <local_sha> is NOT a fast-forward of
#     <remote_sha>, refuse.
#   - If <local_sha> is all-zeros (deletion push), refuse on protected.
#
# Binary-agnostic wall (ADR-0053): this hook does NOT honor PD_SHIM_OFF or any
# other in-band env var. A guardrail that stands down on a flag the agent's own
# shell can set is not a wall. git's `--no-verify` remains the sole, universal,
# non-mintable skip.
set -euo pipefail

ZERO="0000000000000000000000000000000000000000"
refused=0

while IFS=' ' read -r local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/main|refs/heads/master|refs/heads/release/*)
      if [ "$local_sha" = "$ZERO" ]; then
        echo "pd-pre-push: REFUSED — deletion of $remote_ref. Protected branch." >&2
        refused=1
        continue
      fi
      if [ "$remote_sha" = "$ZERO" ]; then
        # Pushing into a non-existent remote protected ref from a feature
        # branch — effectively creating main from arbitrary local content.
        # Refuse: GitHub's branch-protection-on-create is the only honest
        # path for spinning up a new protected branch.
        echo "pd-pre-push: REFUSED — creating $remote_ref from local ref. Protected branch." >&2
        echo "pd-pre-push:   protected: main|master|release/*" >&2
        echo "pd-pre-push:   open a PR from a feature branch; new protected refs go through GitHub." >&2
        refused=1
        continue
      fi
      if ! git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null; then
        echo "pd-pre-push: REFUSED — non-fast-forward push to $remote_ref." >&2
        echo "pd-pre-push:   local=$local_sha remote=$remote_sha" >&2
        echo "pd-pre-push:   protected: main|master|release/*" >&2
        echo "pd-pre-push:   rebase onto the remote head and open a PR; do not force-push protected refs." >&2
        refused=1
      fi
      ;;
  esac
done

if [ "$refused" -ne 0 ]; then
  exit 1
fi
exit 0
HOOK_EOF

chmod +x "$HOOK"
echo "install-pre-push-hook: wrote $HOOK"
