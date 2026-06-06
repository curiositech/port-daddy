#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WEBSITE_DIR="$ROOT_DIR/website-v2"
RECORDING_DAEMON_DIR="$WEBSITE_DIR/.recording-daemon"
RECORDING_ENV_FILE="$RECORDING_DAEMON_DIR/recording.env"
CAST_DIR="$ROOT_DIR/website-v2/public/casts/agents"
GIF_DIR="$ROOT_DIR/website-v2/public/gifs/agents"

install_pd_shim() {
  export ROOT_DIR
  pd() {
    PD_SHIM_OFF=1 node "$ROOT_DIR/bin/port-daddy-cli.js" "$@"
  }
  export -f pd
}

# Start the isolated recording daemon and seed a deterministic world.
start_recording_daemon() {
  unset PORT_DADDY_URL PORT_DADDY_SOCK PORT_DADDY_IPC PORT_DADDY_PREFIX \
        PORT_DADDY_PROFILE PD_URL PORT_DADDY_PORT_FILE \
        PORT_DADDY_HEARTBEAT_FILE PORT_DADDY_PID_FILE 2>/dev/null || true

  node "$WEBSITE_DIR/scripts/seed-recording-world.mjs" start >&2

  # shellcheck disable=SC1090
  source "$RECORDING_ENV_FILE"
}

# Stop the isolated recording daemon.
stop_recording_daemon() {
  node "$WEBSITE_DIR/scripts/seed-recording-world.mjs" stop >&2 || true
}

ensure_daemon() {
  # Legacy compatibility: in isolated mode ensure_daemon is a no-op.
  :
}

type_cmd() {
  local text="$1"
  local i
  for ((i = 0; i < ${#text}; i += 1)); do
    printf '%s' "${text:$i:1}"
    sleep 0.012
  done
}

run_cmd() {
  local cmd="$1"
  local output
  printf '\n  \033[0;32m$\033[0m '
  type_cmd "$cmd"
  printf '\n'
  output="$(
    bash -lc "$cmd" 2>&1 \
      | sed "s#$ROOT_DIR#.#g" \
      | sed -n '1,18p'
  )"

  if grep -Eq 'Port Daddy is not running|Recorded from real local CLI commands|recorded from real Port Daddy CLI commands|command not found|ERROR:' <<<"$output"; then
    printf '%s\n' "$output" | sed 's/^/  /'
    printf '\nrecording command produced invalid output: %s\n' "$cmd" >&2
    exit 1
  fi

  printf '%s\n' "$output" | sed 's/^/  /'
  sleep 0.45
}

intro() {
  clear || true
  printf '\n'
  sleep 0.2
}

play_section() {
  cd "$ROOT_DIR"
  install_pd_shim
  export NO_COLOR=1
  export FORCE_COLOR=0

  # The recording daemon was started (and seeded) by record_one() before
  # asciinema was invoked.  Source its env vars here to route all pd() calls.
  if [[ -f "$RECORDING_ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$RECORDING_ENV_FILE"
  fi

  case "$1" in
    yaml-and-shipwright)
      intro
      run_cmd "pd fleet validate"
      run_cmd "python3 -c \"from pathlib import Path; [print(line) for line in Path('pd-fleet.yml').read_text().splitlines()[:28]]\""
      ;;
    event-triggers)
      intro
      run_cmd "pd channels ensure git:committed --scope repo --description \"commit trigger event\""
      run_cmd "pd channels describe git:committed"
      run_cmd "pd fleet validate"
      run_cmd "pd fleet status"
      ;;
    virtual-actors)
      intro
      run_cmd "pd actors --project port-daddy --limit 2"
      run_cmd "pd actor navigator --project port-daddy --inbox-stats"
      ;;
    daemon-runtime)
      intro
      run_cmd "pd status"
      run_cmd "pd health"
      ;;
    communication-protocols)
      intro
      run_cmd "pd channels discover git"
      run_cmd "pd channels ensure git:committed --scope repo --description \"commit trigger event\""
      run_cmd "pd channels describe git:committed"
      run_cmd "pd pub docs:agents-recording '{\"surface\":\"agents\",\"section\":\"communication-protocols\"}' --raw-channel"
      ;;
    resurrection)
      intro
      run_cmd "pd salvage --project port-daddy"
      run_cmd "pd notes --limit 5"
      ;;
    coordination)
      intro
      run_cmd "pd guard status"
      run_cmd "pd status"
      run_cmd "pd notes --limit 5"
      ;;
    *)
      printf 'Unknown section: %s\n' "$1" >&2
      exit 2
      ;;
  esac

  sleep 0.35
}

record_one() {
  local id="$1"
  mkdir -p "$CAST_DIR" "$GIF_DIR"

  # Seed a fresh, deterministic world for this recording.
  start_recording_daemon
  trap 'stop_recording_daemon' EXIT INT TERM

  asciinema rec -q --overwrite -c "$0 --play $id" "$CAST_DIR/$id.cast"
  # GIF rendering is optional — skip if agg is not installed.
  if command -v agg >/dev/null 2>&1; then
    agg --theme github-dark --cols 110 --rows 30 --font-size 16 --speed 1.15 --idle-time-limit 1.2 -q "$CAST_DIR/$id.cast" "$GIF_DIR/$id.gif"
  fi

  stop_recording_daemon
  trap - EXIT INT TERM
}

if [[ "${1:-}" == "--play" ]]; then
  play_section "${2:-}"
  exit 0
fi

if [[ "${1:-}" == "--all" || $# -eq 0 ]]; then
  for id in \
    yaml-and-shipwright \
    event-triggers \
    virtual-actors \
    daemon-runtime \
    communication-protocols \
    resurrection \
    coordination; do
    record_one "$id"
  done
  exit 0
fi

record_one "$1"
