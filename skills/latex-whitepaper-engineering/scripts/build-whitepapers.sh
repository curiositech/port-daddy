#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Run this helper from inside a Port Daddy repository checkout." >&2
  exit 2
}

build_script="$repo_root/scripts/build-whitepapers.sh"
if [[ ! -x "$build_script" ]]; then
  echo "Missing executable repository build script: $build_script" >&2
  exit 2
fi

exec "$build_script" "$@"
