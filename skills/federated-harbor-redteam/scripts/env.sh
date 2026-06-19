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
export FH_PROOFS_ROOT="${FH_PROOFS_ROOT:-$REPO_ROOT/proofs/federated}"
export FH_DIALOGUE_ROOT="${FH_DIALOGUE_ROOT:-$REPO_ROOT/docs/shipwright/federated}"

if [ "${1:-}" = "--verify" ]; then
  echo "FH_PROOFS_ROOT   = $FH_PROOFS_ROOT"
  echo "FH_DIALOGUE_ROOT = $FH_DIALOGUE_ROOT"
  [ -d "$FH_PROOFS_ROOT" ] && echo "  proofs/federated/: present" || echo "  proofs/federated/: MISSING (artifacts will be PENDING)"
  [ -d "$FH_DIALOGUE_ROOT" ] && echo "  docs/shipwright/federated/: present" || echo "  docs/shipwright/federated/: MISSING"
fi
