#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

install_pd_shim() {
  export ROOT_DIR
  pd() {
    node "$ROOT_DIR/bin/port-daddy-cli.js" "$@"
  }
  export -f pd
}

ensure_daemon() {
  if pd status >/dev/null 2>&1; then
    return 0
  fi

  node "$ROOT_DIR/bin/port-daddy-cli.js" start >/dev/null 2>&1 || true
  sleep 1
  pd status >/dev/null 2>&1
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
      | sed "s#$HOME#~#g" \
      | sed -n '1,18p'
  )"

  if grep -Eq 'Port Daddy is not running|Recorded from real local CLI commands|recorded with asciinema|No pd demo script|command not found|ERROR:' <<<"$output"; then
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

current_session_id() {
  if [[ -n "${PD_RECORDING_SESSION_ID:-}" ]]; then
    printf '%s\n' "$PD_RECORDING_SESSION_ID"
    return 0
  fi
  node -e "const fs=require('fs'); const p='.portdaddy/current.json'; if (fs.existsSync(p)) console.log(JSON.parse(fs.readFileSync(p,'utf8')).sessionId || '')"
}

play_recording() {
  cd "$ROOT_DIR"
  install_pd_shim
  export NO_COLOR=1
  export FORCE_COLOR=0
  local id="$1"
  local slug="${id#*/}"

  ensure_daemon

  case "$id" in
    tutorials/pheromone)
      intro
      run_cmd "pd status"
      run_cmd "pd pheromone --help || true"
      run_cmd "pd pheromone files --path website-v2/src/pages/tutorials --depth 1"
      ;;
    tutorials/primitives)
      intro
      run_cmd "pd status"
      run_cmd "pd briefing | sed -n '1,18p'"
      run_cmd "pd guard status"
      ;;
    tutorials/getting-started)
      intro
      run_cmd "pd status"
      run_cmd "pd claim docs-gif:api:main --json"
      run_cmd "pd find docs-gif:api:main"
      run_cmd "pd release docs-gif:api:main"
      ;;
    tutorials/fleet)
      intro
      run_cmd "pd fleet validate"
      run_cmd "pd fleet status"
      ;;
    tutorials/semantic-identities)
      intro
      run_cmd "pd status"
      run_cmd "pd services | sed -n '1,12p'"
      run_cmd "pd find 'port-daddy:*' | sed -n '1,12p'"
      ;;
    tutorials/multi-agent)
      intro
      run_cmd "pd status"
      run_cmd "pd sessions --all-worktrees | sed -n '1,16p'"
      run_cmd "pd notes --limit 5 | sed -n '1,16p'"
      ;;
    tutorials/debugging)
      intro
      run_cmd "pd status"
      run_cmd "pd health"
      run_cmd "pd services | sed -n '1,12p'"
      ;;
    tutorials/inbox)
      intro
      run_cmd "printf 'inbox handoff' | pd tube docs:inbox-recording --send"
      run_cmd "pd tube docs:inbox-recording --once --no-history --limit=1"
      ;;
    tutorials/harbors)
      intro
      run_cmd "pd harbors"
      run_cmd "pd harbor --help || true"
      ;;
    tutorials/pipelines|tutorials/watch|tutorials/always-on)
      intro
      run_cmd "pd watch --help || true"
      run_cmd "pd pub docs:pipeline-recording '{\"status\":\"ready\"}' --raw-channel"
      ;;
    tutorials/pd-spawn)
      intro
      run_cmd "pd spawn --help || true"
      run_cmd "pd spawned"
      ;;
    tutorials/monorepo)
      intro
      run_cmd "pd status"
      run_cmd "pd services | sed -n '1,12p'"
      ;;
    tutorials/tunnel|tutorials/remote-harbors)
      intro
      run_cmd "pd tunnel --help || true"
      run_cmd "pd status"
      ;;
    tutorials/dns)
      intro
      run_cmd "pd dns --help || true"
      run_cmd "pd services | sed -n '1,12p'"
      ;;
    tutorials/session-phases)
      intro
      run_cmd "pd status"
      run_cmd "pd notes --limit 5"
      ;;
    tutorials/sugar)
      intro
      run_cmd "pd begin --help || true"
      run_cmd "pd done --help || true"
      ;;
    tutorials/time-travel)
      intro
      run_cmd "pd notes --limit 5"
      run_cmd "pd activity --limit 5 || true"
      ;;
    examples/pd-tube-button-to-agent)
      intro
      run_cmd "printf 'button clicked' | pd tube docs:example-button --send"
      run_cmd "pd tube docs:example-button --once --no-history --limit=1"
      ;;
    examples/test-failure-to-agent)
      intro
      run_cmd "pd status"
      run_cmd "printf 'test failed' | pd tube docs:test-failed --send"
      run_cmd "pd tube docs:test-failed --once --no-history --limit=1"
      ;;
    examples/editor-lightbulb-to-agent)
      intro
      run_cmd "printf 'explain selected code' | pd tube editor:explain --send"
      run_cmd "pd tube editor:explain --once --no-history --limit=1"
      ;;
    examples/webhook-to-local-agent)
      intro
      run_cmd "printf '{\"event\":\"webhook\"}' | pd tube webhook:local --send"
      run_cmd "pd tube webhook:local --once --no-history --limit=1"
      ;;
    docs/cli-overview)
      intro
      run_cmd "pd status"
      run_cmd "pd pheromone --help"
      run_cmd "printf 'docs cli recording' | pd tube docs:cli-recording --send"
      run_cmd "pd tube docs:cli-recording --once --no-history --limit=1"
      ;;
    docs/pheromone)
      intro
      run_cmd "pd status"
      run_cmd "pd pheromone --help || true"
      run_cmd "pd pheromone files --path website-v2/src --depth 1"
      ;;
    *)
      printf 'Unknown recording id: %s\n' "$1" >&2
      exit 2
      ;;
  esac

  sleep 0.35
}

record_one() {
  local id="$1"
  local output_group="${id%%/*}"
  local slug="${id#*/}"
  local cast_dir="$ROOT_DIR/website-v2/public/casts/$output_group"
  local gif_dir="$ROOT_DIR/website-v2/public/gifs/$output_group"
  mkdir -p "$cast_dir" "$gif_dir"
  export PD_RECORDING_SESSION_ID
  PD_RECORDING_SESSION_ID="$(current_session_id)"
  asciinema rec -q --overwrite -c "$0 --play $id" "$cast_dir/$slug.cast"
  agg --theme github-dark --cols 110 --rows 30 --font-size 16 --speed 1.15 --idle-time-limit 1.2 -q "$cast_dir/$slug.cast" "$gif_dir/$slug.gif"
}

if [[ "${1:-}" == "--play" ]]; then
  play_recording "${2:-}"
  exit 0
fi

if [[ "${1:-}" == "--all" || $# -eq 0 ]]; then
  for id in \
    tutorials/harbors \
    tutorials/pheromone \
    tutorials/primitives \
    tutorials/getting-started \
    tutorials/semantic-identities \
    tutorials/multi-agent \
    tutorials/monorepo \
    tutorials/debugging \
    tutorials/tunnel \
    tutorials/dns \
    tutorials/session-phases \
    tutorials/inbox \
    tutorials/sugar \
    tutorials/always-on \
    tutorials/pd-spawn \
    tutorials/time-travel \
    tutorials/pipelines \
    tutorials/watch \
    tutorials/remote-harbors \
    tutorials/fleet \
    examples/pd-tube-button-to-agent \
    examples/test-failure-to-agent \
    examples/editor-lightbulb-to-agent \
    examples/webhook-to-local-agent \
    docs/cli-overview \
    docs/pheromone; do
    record_one "$id"
  done
  exit 0
fi

record_one "$1"
