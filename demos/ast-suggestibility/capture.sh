#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="ci"
if [[ "${1:-}" == "--native" ]]; then
  MODE="native"
  shift
elif [[ "${1:-}" == "--ci" ]]; then
  shift
fi

exec node "$ROOT/demos/ast-suggestibility/run-voyage.mjs" --mode "$MODE" "$@"
