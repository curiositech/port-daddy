#!/usr/bin/env bash
# skills/redteam-review/scripts/run-redteam.sh
#
# Drive a red-team Phase 1 (attack phase) for a named round.
#
# Usage:
#   run-redteam.sh <round> [--persona <persona> ...]
#   run-redteam.sh v2.1 --persona redteam-crypto --persona redteam-econ
#
# Preconditions:
#   - sec-eng-lead has run Gate A (openRound) for <round>; the
#     redteam-fleet-key.<round> is in this user's keychain.
#   - You are NOT also a member of whitehat-defense for this round.
#     This script will refuse to run if it can also load defense-fleet-key.
#
# Behavior:
#   - Sources the formal-methods env so each persona has ProVerif/TLA+/Kani
#     on PATH.
#   - Spawns each persona as a pd agent under the `redteam-review` project,
#     with file claims scoped to the persona's target sections.
#   - Watches the `coordination:audit` channel for Gate B; exits cleanly
#     when the seal event is observed.
#
# Strict-isolation enforcement:
#   - Personas never read defense:* or fix:* / proof:* tuple keys.
#   - Notes are written via pd note --encrypt-as <key_id>; the route guard
#     refuses plaintext writes.
#   - The script verifies the keychain state before spawning anything.

set -euo pipefail

# ── arg parsing ────────────────────────────────────────────────────────────
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
  PERSONAS=(redteam-crypto redteam-econ redteam-coord redteam-recovery proof-gap-auditor)
fi

# ── isolation pre-flight ──────────────────────────────────────────────────
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./env.sh
source "$HERE/env.sh"

# Ensure we cannot also load the defense key. This is a soft check; the
# real defense is the AD-binding inside coordination-crypto.ts. But a
# misconfigured operator keychain SHOULD fail loudly.
node --input-type=module -e "
import { loadFleetKey } from '$HERE/../../../lib/coordination-crypto.ts';
const round = { round: '$ROUND', salt: 'pre-flight-not-used' };
const r = loadFleetKey('redteam-review', round);
const d = loadFleetKey('whitehat-defense', round);
if (!r) { console.error('[run-redteam] missing redteam-review-fleet-key.$ROUND in keychain — has Gate A run?'); process.exit(3); }
if (d)  { console.error('[run-redteam] WARNING: defense key ALSO present on this machine; isolation breached at the operator. Refusing to spawn.'); process.exit(4); }
console.error('[run-redteam] keychain pre-flight OK for round $ROUND');
" 2>&1

# ── spawn personas under pd ────────────────────────────────────────────────
# Each persona becomes its own pd session in the redteam-review project.
# pd spawn with --backend claude-cli wires PD coordination silently.

for p in "${PERSONAS[@]}"; do
  pd spawn \
    --backend claude-cli \
    --identity "redteam-review:$p:round-$ROUND" \
    --project "redteam-review" \
    --purpose "Phase 1 attack — round $ROUND — persona $p" \
    --skill "skills/redteam-review/agents/$p.md" \
    --env "PD_ROUND=$ROUND" \
    --env "PD_PERSONA=$p" \
    --env "PD_FLEET=redteam-review" \
    --detach
done

# ── watch for Gate B ──────────────────────────────────────────────────────
echo "[run-redteam] $ROUND: ${#PERSONAS[@]} persona(s) spawned. Watching for Gate B..."
pd watch coordination:audit \
  --filter '.gate == "B" and .round == "'"$ROUND"'"' \
  --exec 'echo "[run-redteam] Gate B sealed for round $PD_MESSAGE_CONTENT — winding down"; exit 0'
