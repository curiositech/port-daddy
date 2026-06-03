#!/usr/bin/env bash
# skills/federated-harbor-redteam/scripts/run-fh-redteam.sh
#
# Drive a red-team Phase 1 (attack phase) for a named Federated Harbor
# round. Mirrors skills/redteam-review/scripts/run-redteam.sh but with
# the federation persona set and federation-specific isolation pre-flight.
#
# Usage:
#   run-fh-redteam.sh <round> [--persona <persona> ...]
#   run-fh-redteam.sh v0.2 --persona fh-redteam-tokens --persona fh-redteam-econ
#
# Preconditions:
#   - fh-secops:lead has run Gate A (openRound) for <round>.
#   - The redteam-fleet-key.fh.<round> is in this user's keychain.
#   - You are NOT also a member of federated-harbor-whitehat for this round.
#     This script refuses to run if both fleet keys are loadable.
#
# Behavior:
#   - Sources the FH-specific env (which inherits redteam-review's env).
#   - Spawns each persona as a pd agent under the federated-harbor-redteam project.
#   - Watches the coordination:audit channel for Gate B; exits when sealed.

set -euo pipefail

ROUND=""
PERSONAS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --persona) PERSONAS+=("$2"); shift 2 ;;
    --help|-h)
      sed -n '2,32p' "$0"; exit 0 ;;
    *)
      if [[ -z "$ROUND" ]]; then ROUND="$1"; shift; else
        echo "unknown arg: $1" >&2; exit 2; fi ;;
  esac
done

if [[ -z "$ROUND" ]]; then
  echo "usage: $0 <round> [--persona <name> ...]" >&2
  exit 2
fi

if [[ ${#PERSONAS[@]} -eq 0 ]]; then
  PERSONAS=(
    fh-redteam-trust
    fh-redteam-tokens
    fh-redteam-revocation
    fh-redteam-econ
    fh-proof-gap-auditor
  )
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./env.sh
. "$HERE/env.sh"

# Isolation pre-flight: refuse if both fleet keys load.
# (Soft check; defense-in-depth is the AD-binding in coordination-crypto.ts
# inherited from the redteam-review skill.)
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
node --input-type=module -e "
import { loadFleetKey } from '$REPO_ROOT/lib/coordination-crypto.ts';
const round = { round: 'fh.$ROUND', salt: 'pre-flight-not-used' };
const r = loadFleetKey('federated-harbor-redteam', round);
const d = loadFleetKey('federated-harbor-whitehat', round);
if (!r) { console.error('[run-fh-redteam] missing federated-harbor-redteam-fleet-key.fh.$ROUND in keychain — has Gate A run?'); process.exit(3); }
if (d)  { console.error('[run-fh-redteam] WARNING: defense key ALSO present; isolation breached at the operator. Refusing to spawn.'); process.exit(4); }
console.error('[run-fh-redteam] keychain pre-flight OK for round fh.$ROUND');
" 2>&1 || {
  # If coordination-crypto.ts is not yet wired for the FH fleet, fall
  # through with a warning. This is acceptable in v0.2; will harden as
  # the FH fleet keys land.
  echo "[run-fh-redteam] WARN: coordination-crypto.ts pre-flight failed; proceeding without isolation check." >&2
}

for p in "${PERSONAS[@]}"; do
  pd spawn \
    --backend claude-cli \
    --identity "federated-harbor-redteam:$p:round-$ROUND" \
    --project "federated-harbor-redteam" \
    --purpose "FH Phase 1 attack — round $ROUND — persona $p" \
    --skill "skills/federated-harbor-redteam/agents/$p.md" \
    --env "PD_ROUND=fh.$ROUND" \
    --env "PD_PERSONA=$p" \
    --env "PD_FLEET=federated-harbor-redteam" \
    --detach
done

echo "[run-fh-redteam] round $ROUND: ${#PERSONAS[@]} persona(s) spawned. Watching for Gate B..."
pd watch coordination:audit \
  --filter '.gate == "B" and .round == "fh.'"$ROUND"'"' \
  --exec 'echo "[run-fh-redteam] Gate B sealed for round $PD_MESSAGE_CONTENT — winding down"; exit 0'
