#!/usr/bin/env bash
# Record an honest Fleet reaction from a disposable linked worktree.

set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$DEMO_DIR")"
RECORDING_DIR="$DEMO_DIR/recordings"
DEMO_WORKTREE="${PORT_DADDY_DEMO_WORKTREE:-$HOME/coding/tmp/port-daddy-fleet-demo-$$}"

mkdir -p "$RECORDING_DIR" "$HOME/coding/tmp"

if [[ -z "${PORT_DADDY_URL:-}" ]]; then
  eval "$(pd use stable)"
fi
DAEMON_URL="${PORT_DADDY_URL%/}"
: "${DAEMON_URL:?select stable or a named feature daemon with pd use}"

if ! curl -fsS "$DAEMON_URL/health" >/dev/null; then
  echo "Selected daemon is unreachable: $DAEMON_URL" >&2
  echo "Use FleetBar to repair stable, or rebuild and select a named pd dev daemon." >&2
  exit 1
fi

cleanup() {
  (cd "$DEMO_WORKTREE" && pd done "Fleet recording complete" >/dev/null 2>&1) || true
  git -C "$PROJECT_DIR" worktree remove --force "$DEMO_WORKTREE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git -C "$PROJECT_DIR" worktree add --detach "$DEMO_WORKTREE" HEAD >/dev/null
(cd "$DEMO_WORKTREE" && pd begin --identity port-daddy:demo:fleet-recording --lifecycle durable >/dev/null)

FLEET_RUNNING="$(curl -fsS "$DAEMON_URL/fleet" | python3 -c \
  'import json,sys; print(str(bool(json.load(sys.stdin).get("running"))).lower())')"
if [[ "$FLEET_RUNNING" != "true" ]]; then
  pd fleet up
fi

open "$DAEMON_URL" &

osascript - "$DEMO_WORKTREE" "$DAEMON_URL" <<'APPLESCRIPT'
on run argv
  set demoWorktree to item 1 of argv
  set daemonURL to item 2 of argv
  tell application "Terminal"
    activate
    do script "cd " & quoted form of demoWorktree & " && clear && printf '\n  pd-fleet.yml — The Fleet Configuration\n\n' && cat pd-fleet.yml"
    set bounds of front window to {0, 80, 900, 900}
    delay 0.5
    do script "cd " & quoted form of demoWorktree & " && clear && printf '\n  Ready to commit — watching Fleet\n\n' && pd status && printf '\n── Fleet status ──\n' && curl -fsS " & quoted form of (daemonURL & "/fleet") & " | python3 -m json.tool | head -20"
    set bounds of front window to {920, 80, 1800, 900}
  end tell
end run
APPLESCRIPT

printf '\nScene ready. Open FleetBar, start screen recording, then press Enter.\n'
read -r

cat >"$DEMO_WORKTREE/.demo-fleet-trigger.md" <<EOF
# Fleet Demo Trigger

Real linked-worktree commit recorded at $(date -u +%Y-%m-%dT%H:%M:%SZ).
EOF
(cd "$DEMO_WORKTREE" && \
  pd note "scope: one isolated Fleet demo trigger commit" >/dev/null && \
  pd session files add .demo-fleet-trigger.md >/dev/null)

osascript - "$DEMO_WORKTREE" "$DAEMON_URL" <<'APPLESCRIPT'
on run argv
  set demoWorktree to item 1 of argv
  set daemonURL to item 2 of argv
  tell application "Terminal"
    activate
    do script "cd " & quoted form of demoWorktree & " && clear && printf '\nStaging one isolated demo change…\n\n' && git add .demo-fleet-trigger.md && git commit -m 'demo: trigger fleet agents' && printf '\nCommit recorded. Reading Fleet from the selected daemon…\n\n' && sleep 3 && curl -fsS " & quoted form of (daemonURL & "/fleet") & " | python3 -m json.tool | head -40" in front window
  end tell
end run
APPLESCRIPT

sleep 12
printf '\nDemo complete. Stop the recording. The disposable worktree will now be removed.\n'
