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
  bash -lc "$cmd" 2>&1 \
    | sed "s#$ROOT_DIR#.#g" \
    | sed "s#$HOME#~#g" \
    | sed -n '1,18p' \
    | sed 's/^/  /'
  sleep 0.45
}

intro() {
  local section="$1"
  local title="$2"
  clear || true
  printf '\n'
  printf '  \033[1;36mPort Daddy %s\033[0m — %s\n' "$section" "$title"
  printf '  Recorded from real local CLI commands. No pd demo script.\n'
  printf '\n'
  sleep 0.5
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

  case "$id" in
    tutorials/pheromone)
      intro "Tutorial" "Pheromone trails"
      run_cmd "pd status"
      run_cmd "pd pheromone --help || true"
      run_cmd "pd pheromone files --path website-v2/src/pages/tutorials --depth 1"
      ;;
    tutorials/primitives)
      intro "Tutorial" "Product primitives"
      run_cmd "pd status"
      run_cmd "pd briefing | sed -n '1,18p'"
      run_cmd "pd guard status"
      ;;
    tutorials/getting-started)
      intro "Tutorial" "Getting started"
      run_cmd "pd status"
      run_cmd "pd claim docs-gif:api:main --json"
      run_cmd "pd find docs-gif:api:main"
      run_cmd "pd release docs-gif:api:main"
      ;;
    tutorials/fleet)
      intro "Tutorial" "Fleet agents"
      run_cmd "pd fleet validate"
      run_cmd "pd fleet status"
      ;;
    tutorials/semantic-identities)
      intro "Tutorial" "Semantic identities"
      run_cmd "pd status"
      run_cmd "pd services | sed -n '1,12p'"
      ;;
    tutorials/multi-agent)
      intro "Tutorial" "Multi-agent coordination"
      run_cmd "pd status"
      run_cmd "pd pub docs:multi-agent-recording '{\"surface\":\"tutorial\",\"event\":\"handoff\"}' --raw-channel"
      run_cmd "pd tube docs:multi-agent-recording --once --no-history --limit=1"
      ;;
    tutorials/debugging)
      intro "Tutorial" "Debugging"
      run_cmd "pd status"
      run_cmd "pd health"
      run_cmd "pd services | sed -n '1,12p'"
      ;;
    tutorials/inbox)
      intro "Tutorial" "Inbox and channels"
      run_cmd "printf 'inbox handoff' | pd tube docs:inbox-recording --send"
      run_cmd "pd tube docs:inbox-recording --once --no-history --limit=1"
      ;;
    tutorials/harbors)
      intro "Tutorial" "Harbors"
      run_cmd "pd harbors"
      run_cmd "pd harbor --help || true"
      ;;
    tutorials/pipelines|tutorials/watch|tutorials/always-on)
      intro "Tutorial" "$slug"
      run_cmd "pd watch --help || true"
      run_cmd "pd pub docs:pipeline-recording '{\"status\":\"ready\"}' --raw-channel"
      ;;
    tutorials/pd-spawn)
      intro "Tutorial" "pd spawn"
      run_cmd "pd spawn --help || true"
      run_cmd "pd spawned"
      ;;
    tutorials/monorepo)
      intro "Tutorial" "Monorepo"
      run_cmd "pd status"
      run_cmd "pd services | sed -n '1,12p'"
      ;;
    tutorials/tunnel|tutorials/remote-harbors)
      intro "Tutorial" "$slug"
      run_cmd "pd tunnel --help || true"
      run_cmd "pd status"
      ;;
    tutorials/dns)
      intro "Tutorial" "DNS"
      run_cmd "pd dns --help || true"
      run_cmd "pd services | sed -n '1,12p'"
      ;;
    tutorials/session-phases)
      intro "Tutorial" "Session phases"
      run_cmd "pd status"
      run_cmd "pd notes --limit 5"
      ;;
    tutorials/sugar)
      intro "Tutorial" "Sugar commands"
      run_cmd "pd begin --help || true"
      run_cmd "pd done --help || true"
      ;;
    tutorials/time-travel)
      intro "Tutorial" "Activity inspection"
      run_cmd "pd notes --limit 5"
      run_cmd "pd activity --limit 5 || true"
      ;;
    examples/pd-tube-button-to-agent)
      intro "Example" "PD Tube button to agent"
      run_cmd "printf 'button clicked' | pd tube docs:example-button --send"
      run_cmd "pd tube docs:example-button --once --no-history --limit=1"
      ;;
    examples/test-failure-to-agent)
      intro "Example" "Test failure to agent"
      run_cmd "pd status"
      run_cmd "printf 'test failed' | pd tube docs:test-failed --send"
      run_cmd "pd tube docs:test-failed --once --no-history --limit=1"
      ;;
    examples/editor-lightbulb-to-agent)
      intro "Example" "Editor lightbulb to agent"
      run_cmd "printf 'explain selected code' | pd tube editor:explain --send"
      run_cmd "pd tube editor:explain --once --no-history --limit=1"
      ;;
    examples/webhook-to-local-agent)
      intro "Example" "Webhook to local agent"
      run_cmd "printf '{\"event\":\"webhook\"}' | pd tube webhook:local --send"
      run_cmd "pd tube webhook:local --once --no-history --limit=1"
      ;;
    docs/cli-overview)
      intro "Docs" "CLI command surface"
      run_cmd "pd status"
      run_cmd "pd pheromone --help"
      run_cmd "printf 'docs cli recording' | pd tube docs:cli-recording --send"
      run_cmd "pd tube docs:cli-recording --once --no-history --limit=1"
      ;;
    docs/pheromone)
      intro "Docs" "Pheromone feature reference"
      run_cmd "pd status"
      run_cmd "pd pheromone --help || true"
      run_cmd "pd pheromone files --path website-v2/src --depth 1"
      ;;
    *)
      printf 'Unknown recording id: %s\n' "$1" >&2
      exit 2
      ;;
  esac

  printf '\n  \033[0;90mrecorded with asciinema + agg from this checkout\033[0m\n'
  sleep 1
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
