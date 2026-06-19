#!/usr/bin/env bash
# Port Daddy build verification hook
# Runs after Claude edits TypeScript files. Catches type errors that would
# break the build before they get committed.
#
# Checks:
#   1. tsc --noEmit on daemon code (lib/, routes/, server.ts, mcp/)
#   2. If website-v2 files changed, runs vite build (esbuild catches JSX errors tsc misses)
#
# Exit 0 = pass (tool call proceeds)
# Exit 1 = fail (tool call blocked with error message)

set -euo pipefail

CHANGED_FILE="${CLAUDE_FILE_PATH:-}"
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Only check TypeScript files
case "$CHANGED_FILE" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

cd "$PROJECT_ROOT"

# Determine which codebase was touched
IS_WEBSITE=false
IS_DAEMON=false

case "$CHANGED_FILE" in
  *website-v2*) IS_WEBSITE=true ;;
  *) IS_DAEMON=true ;;
esac

ERRORS=""

# Check daemon TypeScript
if $IS_DAEMON; then
  if ! npx tsc --noEmit --pretty 2>/tmp/pd-typecheck.log; then
    # Filter to only errors in the changed file (not pre-existing errors in other files)
    RELEVANT=$(grep -i "$(basename "$CHANGED_FILE")" /tmp/pd-typecheck.log 2>/dev/null || true)
    if [ -n "$RELEVANT" ]; then
      ERRORS="TypeScript errors in $CHANGED_FILE:\n$RELEVANT"
    fi
  fi
fi

# Check website build (vite/esbuild catches JSX errors tsc misses)
if $IS_WEBSITE; then
  if ! (cd website-v2 && npx vite build --logLevel error 2>/tmp/pd-vite.log); then
    ERRORS="Vite build failed after editing $CHANGED_FILE:\n$(cat /tmp/pd-vite.log | tail -20)"
  fi
fi

if [ -n "$ERRORS" ]; then
  echo -e "$ERRORS"
  exit 1
fi

exit 0
