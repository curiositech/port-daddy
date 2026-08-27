#!/usr/bin/env bash
# Records one honest Porthole demo cast: real `pd` CLI, real local daemon,
# zero output filtering. Capture doctrine (demos/porthole/PLAN.md §A): fixed
# 100x28 window (so no resize events ever corrupt replay), typing simulated,
# every byte of output real, input keystrokes never captured (no `-I`).
#
# Usage: record-porthole-cast.sh <slug> <command1> [command2 ...]
# Writes website-v2/public/casts/porthole/<slug>.cast
#
# A generated one-shot driver script (not an inline `-c "..."` string) is
# used deliberately: asciinema's `-c` re-tokenizes its argument through a
# shell, so a driven command list containing its own quotes/pipes/&&
# (exactly what real `pd` invocations look like) would need error-prone
# nested escaping. A real file sidesteps that entirely.
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$ROOT_DIR/website-v2/public/casts/porthole"
mkdir -p "$OUT_DIR"

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <slug> <command1> [command2 ...]" >&2
  exit 1
fi

if ! command -v asciinema >/dev/null 2>&1; then
  echo "record-porthole-cast: asciinema is required to record a Porthole cast" >&2
  exit 127
fi

SLUG="$1"
shift

SCRATCH_ROOT="${PORT_DADDY_SCRATCH_ROOT:-$HOME/coding/tmp}"
mkdir -p "$SCRATCH_ROOT"
DRIVER="$(mktemp "$SCRATCH_ROOT/porthole-drive-XXXXXX.sh")"
trap 'rm -f "$DRIVER"' EXIT

{
  echo '#!/usr/bin/env bash'
  echo 'set -uo pipefail'
  echo "ROOT_DIR=$(printf '%q' "$ROOT_DIR")"
  echo 'cd "$ROOT_DIR"'
  echo 'pd() { node "$ROOT_DIR/bin/port-daddy-cli.js" "$@"; }'
  echo 'type_cmd() {'
  echo '  local text="$1" i'
  echo "  printf '\\033[1;36m~/coding/port-daddy\\033[0m \\033[1;32m❯\\033[0m '"
  echo '  sleep 0.5'
  echo '  for ((i = 0; i < ${#text}; i += 1)); do printf "%s" "${text:$i:1}"; sleep 0.026; done'
  echo '  sleep 0.3; printf "\n"'
  echo '}'
  echo 'sleep 0.3'
  for cmd in "$@"; do
    echo "type_cmd $(printf '%q' "$cmd")"
    if [[ "$cmd" == \#* ]]; then
      # Typed for narration but never executed — honestly inert, not a
      # fake command with fabricated output.
      echo 'printf "\n"'
    else
      echo "$cmd"' 2>&1'
      echo 'printf "\n"'
    fi
    echo 'sleep 0.8'
  done
  echo 'sleep 1.0'
} > "$DRIVER"
chmod +x "$DRIVER"

CAST_PATH="$OUT_DIR/$SLUG.cast"
(
  # Keep the recording metadata public-safe too: asciinema records the
  # command string verbatim, so execute a relative driver name from its
  # durable scratch directory instead of embedding a local home path.
  cd "$(dirname "$DRIVER")"
  asciinema record \
    --window-size 100x28 \
    --headless \
    --return \
    --overwrite \
    --quiet \
    --command "./$(basename "$DRIVER")" \
    "$CAST_PATH"
)

echo "wrote $CAST_PATH"
