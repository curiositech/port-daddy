#!/usr/bin/env bash
# skills/federated-harbor-whitehat/scripts/run-fh-whitehats.sh
#
# Drive a white-hat Phase 2 (defense phase) for a named Federated
# Harbor round. Mirrors skills/whitehat-defense/scripts/run-whitehats.sh
# but with the federation persona set.
#
# Usage:
#   run-fh-whitehats.sh <round> [--persona <persona> ...]
#   run-fh-whitehats.sh v0.2 --persona fh-whitehat-tokens --persona fh-proof-completer
#
# Preconditions:
#   - fh-secops:lead has run Gate B (sealed the red attack manifest).
#   - The defense-fleet-key.fh.<round> is in this user's keychain.
#   - You are NOT also a member of federated-harbor-redteam this round.
#
# Behavior:
#   - Sources the FH env (inherits whitehat-defense + redteam-review).
#   - Spawns each persona as a pd agent under federated-harbor-whitehat.
#   - Watches the coordination:audit channel for Gate C; exits clean.

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
    fh-whitehat-trust
    fh-whitehat-tokens
    fh-whitehat-revocation
    fh-whitehat-econ
    fh-proof-completer
  )
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./env.sh
. "$HERE/env.sh"

# Isolation pre-flight (soft check; same as redteam side).
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
node --input-type=module -e "
import { loadFleetKey } from '$REPO_ROOT/lib/coordination-crypto.ts';
const round = { round: 'fh.$ROUND', salt: 'pre-flight-not-used' };
const d = loadFleetKey('federated-harbor-whitehat', round);
const r = loadFleetKey('federated-harbor-redteam', round);
if (!d) { console.error('[run-fh-whitehats] missing federated-harbor-whitehat-fleet-key.fh.$ROUND — has Gate B run?'); process.exit(3); }
if (r)  { console.error('[run-fh-whitehats] WARNING: red key ALSO present; refusing to spawn.'); process.exit(4); }
console.error('[run-fh-whitehats] keychain pre-flight OK for round fh.$ROUND');
" 2>&1 || {
  echo "[run-fh-whitehats] WARN: coordination-crypto.ts pre-flight failed; proceeding without isolation check." >&2
}

for p in "${PERSONAS[@]}"; do
  pd spawn \
    --backend claude-cli \
    --identity "federated-harbor-whitehat:$p:round-$ROUND" \
    --project "federated-harbor-whitehat" \
    --purpose "FH Phase 2 defense — round $ROUND — persona $p" \
    --skill "skills/federated-harbor-whitehat/agents/$p.md" \
    --env "PD_ROUND=fh.$ROUND" \
    --env "PD_PERSONA=$p" \
    --env "PD_FLEET=federated-harbor-whitehat" \
    --detach
done

echo "[run-fh-whitehats] round $ROUND: ${#PERSONAS[@]} persona(s) spawned. Watching for Gate C..."
pd watch coordination:audit \
  --filter '.gate == "C" and .round == "fh.'"$ROUND"'"' \
  --exec 'echo "[run-fh-whitehats] Gate C published for round $PD_MESSAGE_CONTENT — round closed"; exit 0'
