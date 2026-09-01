#!/usr/bin/env bash
# Source this before running any tool from the federated-harbor-redteam
# or federated-harbor-whitehat fleets. Inherits from
# skills/redteam-review/scripts/env.sh (same formal-methods toolchain).
#
# Usage: . skills/federated-harbor-redteam/scripts/env.sh

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"

# Inherit the redteam-review env (TLA+, Apalache, OPAM/ProVerif, etc.).
if [ -f "$REPO_ROOT/skills/redteam-review/scripts/env.sh" ]; then
  # shellcheck source=/dev/null
  . "$REPO_ROOT/skills/redteam-review/scripts/env.sh" "${1:-}"
else
  echo "[fh-redteam env] warn: $REPO_ROOT/skills/redteam-review/scripts/env.sh not found; tools may be missing" >&2
fi

# Federated-Harbor-specific paths.
export FH_FORMAL_ROOT="${FH_FORMAL_ROOT:-$REPO_ROOT/whitepaper/formal}"
export FH_DIALOGUE_ROOT="${FH_DIALOGUE_ROOT:-$REPO_ROOT/whitepaper/research/program/rounds/federated-harbor}"

if [ "${1:-}" = "--verify" ]; then
  echo "FH_FORMAL_ROOT   = $FH_FORMAL_ROOT"
  echo "FH_DIALOGUE_ROOT = $FH_DIALOGUE_ROOT"
  [ -d "$FH_FORMAL_ROOT" ] && echo "  whitepaper/formal/: present" || echo "  whitepaper/formal/: MISSING"
  [ -d "$FH_DIALOGUE_ROOT" ] && echo "  whitepaper/research/program/rounds/federated-harbor/: present" || echo "  whitepaper/research/program/rounds/federated-harbor/: MISSING"
fi
