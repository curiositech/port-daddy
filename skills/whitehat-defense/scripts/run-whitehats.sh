#!/usr/bin/env bash
# skills/whitehat-defense/scripts/run-whitehats.sh
#
# Drive a white-hat Phase 2 (defense phase) for a named round.
#
# Usage:
#   run-whitehats.sh <round> [--persona <persona> ...]
#   run-whitehats.sh v2.1 --persona defense-crypto --persona proof-completer
#
# Preconditions:
#   - sec-eng-lead has run Gate A (openRound) AND Gate B (sealAttackManifest)
#     for <round>. The whitehat-fleet-key.<round> is in this user's keychain
#     and the sealed manifest has been delivered to the defense:lead inbox.
#   - You are NOT also a member of redteam-review for this round.
#
# Behavior:
#   - Sources the formal-methods env (ProVerif, TLA+, Apalache, Kani, Z3,
#     EasyCrypt) so each persona has its tool kit on PATH.
#   - Spawns each persona as a pd agent under the `whitehat-defense` project.
#   - Watches `coordination:audit` for Gate C; exits when published.
#
# Strict-isolation enforcement:
#   - Personas never read redteam:* or smell:vuln:* / smell:proof-gap:*
#     tuple keys.
#   - Notes/messages encrypted via the route guard.
#   - The script verifies the keychain state before spawning.

set -euo pipefail

ROUND=""
PERSONAS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --persona) PERSONAS+=("$2"); shift 2 ;;
    --help|-h)
      sed -n '2,30p' "$0"; exit 0 ;;
    *)
      if [[ -z "$ROUND" ]]; then ROUND="$1"; shift; else
        echo "unknown arg: $1" >&2; exit 2; fi ;;
  esac
done

if [[ -z "$ROUND" ]]; then
  echo "usage: $0 <round> [--persona <name> ...]" >&2; exit 2
fi
if [[ ${#PERSONAS[@]} -eq 0 ]]; then
  # sec-eng-lead is NOT spawned by this script — the lead is a different
  # operator with the lead root keychain entry, run via run-secops-lead.sh.
  PERSONAS=(defense-crypto defense-econ defense-coord defense-recovery proof-completer)
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
# Mirror the redteam env script (TLA+, Apalache, Kani, etc).
# shellcheck source=../../redteam-review/scripts/env.sh
source "$HERE/../../redteam-review/scripts/env.sh"

node --input-type=module -e "
import { loadFleetKey } from '$HERE/../../../lib/coordination-crypto.ts';
const round = { round: '$ROUND', salt: 'pre-flight-not-used' };
const d = loadFleetKey('whitehat-defense', round);
const r = loadFleetKey('redteam-review', round);
if (!d) { console.error('[run-whitehats] missing whitehat-defense-fleet-key.$ROUND — has Gate A run?'); process.exit(3); }
if (r)  { console.error('[run-whitehats] WARNING: red key ALSO present on this machine; isolation breached at the operator. Refusing to spawn.'); process.exit(4); }
console.error('[run-whitehats] keychain pre-flight OK for round $ROUND');
" 2>&1

for p in "${PERSONAS[@]}"; do
  pd spawn \
    --backend claude-cli \
    --identity "whitehat-defense:$p:round-$ROUND" \
    --project "whitehat-defense" \
    --purpose "Phase 2 defense — round $ROUND — persona $p" \
    --skill "skills/whitehat-defense/agents/$p.md" \
    --env "PD_ROUND=$ROUND" \
    --env "PD_PERSONA=$p" \
    --env "PD_FLEET=whitehat-defense" \
    --detach
done

echo "[run-whitehats] $ROUND: ${#PERSONAS[@]} persona(s) spawned. Watching for Gate C..."
pd watch coordination:audit \
  --filter '.gate == "C" and .round == "'"$ROUND"'"' \
  --exec 'echo "[run-whitehats] Gate C published — winding down"; exit 0'
