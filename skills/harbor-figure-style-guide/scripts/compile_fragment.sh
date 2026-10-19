#!/usr/bin/env bash
# compile_fragment.sh -- Standalone compilation wrapper for harbor-figure-style-guide.
# Delegates to the repository's authoritative compile_fragment.sh script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

AUTHORITATIVE_COMPILER="${REPO_ROOT}/skills/harbor-chartwork/scripts/compile_fragment.sh"

if [[ ! -x "${AUTHORITATIVE_COMPILER}" ]]; then
  echo "Error: Authoritative compiler not found at ${AUTHORITATIVE_COMPILER}" >&2
  exit 2
fi

exec "${AUTHORITATIVE_COMPILER}" "$@"
