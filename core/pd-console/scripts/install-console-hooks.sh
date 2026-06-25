#!/usr/bin/env bash
# install-console-hooks.sh — wire the pd-console git hooks (idempotent, safe to re-run).
#
# Installs the post-merge hook that keeps pd-console-latest.app current when main
# advances (see core/pd-console/scripts/hooks/post-merge). If a foreign post-merge
# hook already exists, we CHAIN (append a call) rather than clobber it.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"          # core/pd-console/scripts
HOOK_SRC="$HERE/hooks/post-merge"
[ -f "$HOOK_SRC" ] || { echo "✗ hook source missing: $HOOK_SRC" >&2; exit 1; }
GIT_COMMON="$(git -C "$HERE" rev-parse --git-common-dir)"
case "$GIT_COMMON" in /*) ;; *) GIT_COMMON="$(cd "$HERE" && cd "$GIT_COMMON" && pwd)";; esac
HOOK_DST="$GIT_COMMON/hooks/post-merge"
mkdir -p "$GIT_COMMON/hooks"; chmod +x "$HOOK_SRC"

if [ ! -e "$HOOK_DST" ]; then
  ln -sf "$HOOK_SRC" "$HOOK_DST" 2>/dev/null || cp "$HOOK_SRC" "$HOOK_DST"
  echo "✓ installed post-merge hook → $HOOK_DST"
elif grep -q "pd-console post-merge hook" "$HOOK_DST" 2>/dev/null; then
  echo "✓ pd-console post-merge hook already installed → $HOOK_DST"
else
  printf '\n# pd-console: keep -latest.app current when main advances\nbash "%s" "$@" || true\n' "$HOOK_SRC" >> "$HOOK_DST"
  echo "✓ chained pd-console rebuild onto existing post-merge hook → $HOOK_DST"
fi
chmod +x "$HOOK_DST" 2>/dev/null || true
