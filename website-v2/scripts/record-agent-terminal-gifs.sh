#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CAST_DIR="$ROOT_DIR/website-v2/public/casts/agents"
GIF_DIR="$ROOT_DIR/website-v2/public/gifs/agents"

install_pd_shim() {
  export ROOT_DIR
  pd() {
    node "$ROOT_DIR/bin/port-daddy-cli.js" "$@"
  }
  export -f pd
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
  printf '\n  \033[0;32m$\033[0m '
  type_cmd "$cmd"
  printf '\n'
  bash -lc "$cmd" 2>&1 | sed "s#$ROOT_DIR#.#g" | sed -n '1,18p' | sed 's/^/  /'
  sleep 0.45
}

intro() {
  local title="$1"
  local subtitle="$2"
  clear || true
  printf '\n'
  printf '  \033[1;36mPort Daddy Agents\033[0m — %s\n' "$title"
  printf '  %s\n' "$subtitle"
  printf '\n'
  sleep 0.5
}

play_section() {
  cd "$ROOT_DIR"
  install_pd_shim
  export NO_COLOR=1
  export FORCE_COLOR=0

  case "$1" in
    yaml-and-shipwright)
      intro "YAML + Shipwright" "Validate the repo fleet before any agent starts."
      run_cmd "pd fleet validate"
      run_cmd "python3 -c \"from pathlib import Path; [print(line) for line in Path('pd-fleet.yml').read_text().splitlines()[:28]]\""
      ;;
    event-triggers)
      intro "Event triggers" "Resolve the logical channel and inspect the fleet trigger graph."
      run_cmd "pd channels describe git:committed"
      run_cmd "pd fleet validate"
      run_cmd "pd fleet status"
      ;;
    virtual-actors)
      intro "Virtual actors" "List durable actor roles and live evidence from this project."
      run_cmd "pd actors --project port-daddy --limit 2"
      run_cmd "pd actor navigator --project port-daddy --inbox-stats"
      ;;
    daemon-runtime)
      intro "Daemon runtime" "Check the actual local daemon before trusting any page."
      run_cmd "pd status"
      run_cmd "pd health"
      ;;
    communication-protocols)
      intro "Communication protocols" "Use real channels and discovery, not a pretend demo command."
      run_cmd "pd channels discover git"
      run_cmd "pd channels describe git:committed"
      run_cmd "pd pub docs:agents-recording '{\"surface\":\"agents\",\"section\":\"communication-protocols\"}' --raw-channel"
      ;;
    resurrection)
      intro "Resurrection" "Inspect salvageable work left by interrupted agents."
      run_cmd "pd salvage --project port-daddy"
      run_cmd "pd notes --limit 5"
      ;;
    coordination)
      intro "Coordination" "Show the guard and current session boundary before edits."
      run_cmd "pd guard status"
      run_cmd "pd status"
      run_cmd "pd notes --limit 5"
      ;;
    *)
      printf 'Unknown section: %s\n' "$1" >&2
      exit 2
      ;;
  esac

  printf '\n  \033[0;90mrecorded from real Port Daddy CLI commands\033[0m\n'
  sleep 1
}

record_one() {
  local id="$1"
  mkdir -p "$CAST_DIR" "$GIF_DIR"
  asciinema rec -q --overwrite -c "$0 --play $id" "$CAST_DIR/$id.cast"
  agg --theme github-dark --cols 110 --rows 30 --font-size 16 --speed 1.15 --idle-time-limit 1.2 -q "$CAST_DIR/$id.cast" "$GIF_DIR/$id.gif"
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
