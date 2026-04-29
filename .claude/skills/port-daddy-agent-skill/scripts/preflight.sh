#!/usr/bin/env bash
# preflight.sh — confirm PD daemon is up and ready before any session work.
# Exits 0 if ready, non-zero with a directive on what to do next.
#
# Usage:
#   preflight.sh                   # silent on success
#   preflight.sh --verbose         # always print summary
#
# Designed for an agent's session-start hook.

set -euo pipefail

verbose=0
[[ "${1:-}" == "--verbose" ]] && verbose=1

say() { (( verbose )) && echo "[preflight] $*" || true; }
fail() { echo "[preflight] FAIL: $*" >&2; exit 1; }
direct() { echo "[preflight] NEXT: $*" >&2; exit 2; }

# 1. Daemon up?
status=$(pd status 2>&1 || true)
case "$status" in
  *running*) say "daemon: running" ;;
  *"not running"*) direct "pd start    # daemon is installed but stopped" ;;
  *"not installed"*) direct "pd install # one-time install + auto-start" ;;
  *)
    if [[ -S "$HOME/.port-daddy/daemon.sock" ]]; then
      fail "daemon socket exists but pd status returned: $status"
    else
      direct "pd start  (status returned: $status)"
    fi
    ;;
esac

# 2. Master key sane?
key="$HOME/.port-daddy/master.key"
if [[ -f "$key" ]]; then
  perm=$(stat -f '%Mp%Lp' "$key" 2>/dev/null || stat -c '%a' "$key")
  [[ "$perm" == "600" ]] || fail "master.key has perms $perm; expected 600. chmod 600 $key"
  say "master.key: 600"
fi

# 3. SQLite locked / corrupted?
db=""
for candidate in "$PWD/port-registry.db" "$HOME/.port-daddy/port-registry.db"; do
  [[ -f "$candidate" ]] && { db="$candidate"; break; }
done
if [[ -n "$db" ]]; then
  if ! sqlite3 "$db" "PRAGMA integrity_check;" 2>/dev/null | grep -q '^ok$'; then
    fail "$db failed integrity_check. Restore from backup."
  fi
  say "db: $db ok"
fi

# 4. Salvage queue for current project?
project="$(basename "$(pwd)")"
pending=$(pd salvage --project "$project" --json 2>/dev/null | jq 'length' 2>/dev/null || echo 0)
if [[ "$pending" -gt 0 ]]; then
  echo "[preflight] NOTE: $pending dead agent(s) in $project — see examples/03-salvage-dead-agent.md" >&2
fi

(( verbose )) && echo "[preflight] OK — daemon ready, project=$project"
exit 0
