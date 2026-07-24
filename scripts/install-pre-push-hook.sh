#!/usr/bin/env bash
# Install a .git/hooks/pre-push hook that refuses force-pushes to protected
# branches (main, master, release/*) and refuses mass-delete pushes
# (--mirror via push.default config).
#
# This is the second layer of the destructive-git-ban defense. The
# pd-shim (~/.port-daddy/bin/git) is the first (advisory) layer; this hook
# is the enforced layer — it runs from ANY git binary, honors no env flag,
# and cannot be stood down in-band (ADR-0119).
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
# No in-band bypass (ADR-0119): this hook is the binary-agnostic wall — it
# fires from any git binary, so it must NOT honor an env flag. Protected-
# branch force-push/deletion refusal holds regardless of environment.
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
        refused=1
        continue
      fi
      if ! git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null; then
        echo "pd-pre-push: REFUSED — non-fast-forward push to $remote_ref." >&2
        echo "pd-pre-push:   local=$local_sha remote=$remote_sha" >&2
        echo "pd-pre-push:   protected: main|master|release/*" >&2
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
