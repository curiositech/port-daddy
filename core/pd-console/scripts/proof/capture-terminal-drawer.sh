#!/usr/bin/env bash
# Capture the pd-console terminal drawer as an exact-window, interaction-backed proof.
#
# This is deliberately feature-specific. It launches one proof-owned console,
# fills the real PTY, verifies the native row count before and after a GPUI drag,
# drives primary-screen scrollback, and captures only that exact CGWindowID.
# It never falls back to a display-wide screenshot.
set -euo pipefail

PD_PROOF_CRATE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PD_PROOF_REPO="$(cd "$PD_PROOF_CRATE/../.." && pwd)"
PD_PROOF_CORE="$(cd "$PD_PROOF_CRATE/.." && pwd)"
PD_PROOF_OUT="${1:-$PD_PROOF_REPO/docs/artifacts/gpui/terminal-drawer-20260829}"
PD_PROOF_SCRATCH="$(mktemp -d "${HOME}/coding/tmp/pd-console-terminal-proof.XXXXXX")"
PD_PROOF_BIN="$PD_PROOF_CORE/target/release/pd-console"
PD_PROOF_WINDOW_FINDER="$PD_PROOF_SCRATCH/windowid"
PD_PROOF_GESTURE="$PD_PROOF_SCRATCH/terminal-drawer-gesture"
PD_PROOF_RECORDER="$PD_PROOF_SCRATCH/recorder"
PD_PROOF_APP_PID=""
PD_PROOF_RECORDER_PID=""

cleanup() {
  if [[ -n "$PD_PROOF_RECORDER_PID" ]]; then
    kill "$PD_PROOF_RECORDER_PID" 2>/dev/null || true
    wait "$PD_PROOF_RECORDER_PID" 2>/dev/null || true
  fi
  if [[ -n "$PD_PROOF_APP_PID" ]]; then
    kill "$PD_PROOF_APP_PID" 2>/dev/null || true
    wait "$PD_PROOF_APP_PID" 2>/dev/null || true
  fi
  case "$PD_PROOF_SCRATCH" in
    "${HOME}/coding/tmp/"*) rm -rf -- "$PD_PROOF_SCRATCH" ;;
  esac
}
trap cleanup EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "terminal drawer proof needs '$1'" >&2
    exit 2
  }
}

write_intervention() {
  local reason="$1"
  local next_action="${2:-Inspect the functional witness, fix the named failure, and rerun this repository-owned proof script.}"
  mkdir -p "$PD_PROOF_OUT"
  {
    echo "# pd-console terminal drawer proof intervention"
    echo
    echo "Exact-window capture stopped: $reason"
    echo
    echo "No full-screen capture was attempted. The functional witness completed"
    echo "before capture remains the proof-owned PTY row transition recorded below."
    echo
    echo "- process: \`$PD_PROOF_APP_PID\`"
    echo "- window: \`${PD_PROOF_WINDOW_ID:-not-found}\`"
    echo "- initial PTY: \`${PD_PROOF_INITIAL_ROWS:-unknown}x${PD_PROOF_INITIAL_COLS:-unknown}\`"
    echo "- shrunk PTY: \`${PD_PROOF_SHRUNK_ROWS:-unknown}x${PD_PROOF_SHRUNK_COLS:-unknown}\`"
    echo "- restored PTY: \`${PD_PROOF_RESTORED_ROWS:-unknown}x${PD_PROOF_RESTORED_COLS:-unknown}\`"
    echo "- grown PTY: \`${PD_PROOF_GROWN_ROWS:-unknown}x${PD_PROOF_GROWN_COLS:-unknown}\`"
    echo "- reclaimed PTY: \`${PD_PROOF_RECLAIMED_ROWS:-unknown}x${PD_PROOF_RECLAIMED_COLS:-unknown}\`"
    echo
    echo "$next_action"
  } > "$PD_PROOF_OUT/OPERATOR-INTERVENTION.md"
}

proof_window_id() {
  local attempt
  for attempt in {1..40}; do
    if "$PD_PROOF_WINDOW_FINDER" --pid "$PD_PROOF_APP_PID" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

proof_tty() {
  local attempt tty
  for attempt in {1..40}; do
    tty="$(ps -axo ppid=,tty= | awk -v parent="$PD_PROOF_APP_PID" '$1 == parent && $2 != "??" { print $2; exit }')"
    if [[ -n "$tty" && -e "/dev/$tty" ]]; then
      printf '%s\n' "$tty"
      return 0
    fi
    sleep 0.25
  done
  return 1
}

read_pty_size() {
  stty -f "/dev/$1" size
}

wait_for_rendered_pty_size() {
  local tty="$1"
  local attempt rows cols
  for attempt in {1..40}; do
    read -r rows cols < <(read_pty_size "$tty")
    # ShellTerminal starts at 24x120. The first GPUI render replaces both with
    # the actual drawer geometry; never mistake that startup resize for input.
    if [[ "$rows $cols" != "24 120" ]]; then
      printf '%s %s\n' "$rows" "$cols"
      return 0
    fi
    sleep 0.1
  done
  return 1
}

require_command cargo
require_command ffmpeg
require_command screencapture
require_command shasum
require_command xcrun
mkdir -p "$PD_PROOF_OUT"

echo "Building the current-source GPUI console…"
(cd "$PD_PROOF_CORE" && cargo build --release --features gpui --bin pd-console)
xcrun swiftc -O "$PD_PROOF_CRATE/scripts/proof/windowid.swift" -o "$PD_PROOF_WINDOW_FINDER"
xcrun swiftc -O "$PD_PROOF_CRATE/scripts/proof/terminal-drawer-gesture.swift" -o "$PD_PROOF_GESTURE"
xcrun swiftc -O "$PD_PROOF_CRATE/scripts/proof/recorder.swift" -o "$PD_PROOF_RECORDER"

PD_PROOF_BOOT_COMMAND='for i in {1..90}; do printf "PD terminal history line %03d\n" "$i"; done; printf "LIVE PROMPT READY\n"'
PD_CONSOLE_OPEN_CLI=1 \
PD_CONSOLE_NO_SPLASH=1 \
PD_CONSOLE_CLI_BOOT_COMMAND="$PD_PROOF_BOOT_COMMAND" \
  "$PD_PROOF_BIN" > "$PD_PROOF_SCRATCH/console.log" 2>&1 &
PD_PROOF_APP_PID=$!

PD_PROOF_WINDOW_ID="$(proof_window_id)" || {
  write_intervention "the proof-owned native window never became discoverable"
  exit 3
}
PD_PROOF_TTY="$(proof_tty)" || {
  write_intervention "the proof-owned login shell exposed no PTY"
  exit 4
}
read -r PD_PROOF_INITIAL_ROWS PD_PROOF_INITIAL_COLS < <(wait_for_rendered_pty_size "$PD_PROOF_TTY") || {
  write_intervention "the first GPUI frame never projected drawer geometry into the PTY"
  exit 5
}

# Prove the operator-reported failure before asking ScreenCaptureKit for a
# pixel. A physical downward drag must reduce the native PTY row count, then an
# upward drag from the moved edge must restore it. This witness survives an
# honest TCC denial in OPERATOR-INTERVENTION.md.
if ! "$PD_PROOF_GESTURE" --window-id "$PD_PROOF_WINDOW_ID" drag-down 120; then
  write_intervention \
    "Accessibility denied the proof-owned resize gesture" \
    "Grant Accessibility to the invoking app in macOS Privacy & Security, then rerun this repository-owned proof script."
  exit 76
fi
sleep 0.2
read -r PD_PROOF_SHRUNK_ROWS PD_PROOF_SHRUNK_COLS < <(read_pty_size "$PD_PROOF_TTY")
if (( PD_PROOF_SHRUNK_ROWS >= PD_PROOF_INITIAL_ROWS )); then
  write_intervention "a downward drag did not reduce the native PTY row count"
  exit 5
fi

"$PD_PROOF_GESTURE" \
  --window-id "$PD_PROOF_WINDOW_ID" \
  --drawer-height 240 \
  drag-up 120
sleep 0.2
read -r PD_PROOF_RESTORED_ROWS PD_PROOF_RESTORED_COLS < <(read_pty_size "$PD_PROOF_TTY")
if (( PD_PROOF_RESTORED_ROWS <= PD_PROOF_SHRUNK_ROWS )); then
  write_intervention "the reverse drag did not restore native PTY rows"
  exit 6
fi

# Fail closed before pixel capture: a denied still means neither
# ScreenCaptureKit nor a frame-loop fallback may widen scope to the operator's
# whole display. The PTY resize witness above remains available either way.
if ! screencapture -x -o -l"$PD_PROOF_WINDOW_ID" "$PD_PROOF_SCRATCH/capture-permission.png"; then
  write_intervention \
    "macOS denied exact-window Screen Recording permission" \
    "Grant Screen Recording to the invoking app in macOS Privacy & Security, then rerun this repository-owned proof script."
  exit 77
fi

"$PD_PROOF_RECORDER" \
  --window-id "$PD_PROOF_WINDOW_ID" \
  --out "$PD_PROOF_SCRATCH/terminal-drawer.mov" \
  --duration 6 \
  --fps 20 > "$PD_PROOF_SCRATCH/recorder.log" 2>&1 &
PD_PROOF_RECORDER_PID=$!
sleep 0.8

"$PD_PROOF_GESTURE" --window-id "$PD_PROOF_WINDOW_ID" drag-up 140
sleep 0.35
read -r PD_PROOF_GROWN_ROWS PD_PROOF_GROWN_COLS < <(read_pty_size "$PD_PROOF_TTY")
if (( PD_PROOF_GROWN_ROWS <= PD_PROOF_RESTORED_ROWS )); then
  write_intervention "the authored drag did not increase the native PTY row count"
  exit 7
fi
screencapture -x -o -l"$PD_PROOF_WINDOW_ID" "$PD_PROOF_OUT/terminal-drawer-resized.png"

"$PD_PROOF_GESTURE" \
  --window-id "$PD_PROOF_WINDOW_ID" \
  --drawer-height 500 \
  drag-down 140
sleep 0.25
read -r PD_PROOF_RECLAIMED_ROWS PD_PROOF_RECLAIMED_COLS < <(read_pty_size "$PD_PROOF_TTY")
if (( PD_PROOF_RECLAIMED_ROWS >= PD_PROOF_GROWN_ROWS )); then
  write_intervention "the recorded downward drag did not reclaim terminal height"
  exit 8
fi

"$PD_PROOF_GESTURE" --window-id "$PD_PROOF_WINDOW_ID" scroll-up 12
sleep 0.5
screencapture -x -o -l"$PD_PROOF_WINDOW_ID" "$PD_PROOF_OUT/terminal-drawer-history.png"

if ! wait "$PD_PROOF_RECORDER_PID"; then
  write_intervention "ScreenCaptureKit could not record the proof-owned window; see recorder.log in the transient run"
  exit 78
fi
ffmpeg -y -loglevel error \
  -i "$PD_PROOF_SCRATCH/terminal-drawer.mov" \
  -vf "fps=8,scale=960:-1:flags=lanczos" \
  "$PD_PROOF_OUT/terminal-drawer.gif"

PD_PROOF_COMMIT="$(git -C "$PD_PROOF_REPO" rev-parse HEAD)"
PD_PROOF_BINARY_SHA="$(shasum -a 256 "$PD_PROOF_BIN" | awk '{print $1}')"
{
  echo "# pd-console terminal drawer proof receipt"
  echo
  echo "- Source commit: \`$PD_PROOF_COMMIT\`"
  echo "- Release binary SHA-256: \`$PD_PROOF_BINARY_SHA\`"
  echo "- Proof-owned process/window: \`pid=$PD_PROOF_APP_PID window=$PD_PROOF_WINDOW_ID\`"
  echo "- Native PTY before drag: \`${PD_PROOF_INITIAL_ROWS}x${PD_PROOF_INITIAL_COLS}\`"
  echo "- Native PTY after 120px downward drag: \`${PD_PROOF_SHRUNK_ROWS}x${PD_PROOF_SHRUNK_COLS}\`"
  echo "- Native PTY after reverse restore: \`${PD_PROOF_RESTORED_ROWS}x${PD_PROOF_RESTORED_COLS}\`"
  echo "- Native PTY after recorded 140px upward drag: \`${PD_PROOF_GROWN_ROWS}x${PD_PROOF_GROWN_COLS}\`"
  echo "- Native PTY after recorded downward reclaim: \`${PD_PROOF_RECLAIMED_ROWS}x${PD_PROOF_RECLAIMED_COLS}\`"
  echo "- History gesture: \`12\` upward rows over the terminal output region"
  echo "- Capture scope: exact CGWindowID only; no display-wide fallback"
  echo
  echo "## Artifacts"
  echo
  echo "- \`terminal-drawer-resized.png\`"
  echo "- \`terminal-drawer-history.png\`"
  echo "- \`terminal-drawer.gif\`"
  echo
  echo "## Reproduce"
  echo
  echo "\`core/pd-console/scripts/proof/capture-terminal-drawer.sh\`"
} > "$PD_PROOF_OUT/RECEIPT.md"
rm -f -- "$PD_PROOF_OUT/OPERATOR-INTERVENTION.md"

echo "Terminal drawer proof captured in $PD_PROOF_OUT"
