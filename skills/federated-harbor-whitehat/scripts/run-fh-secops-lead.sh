#!/usr/bin/env bash
# skills/federated-harbor-whitehat/scripts/run-fh-secops-lead.sh
#
# Drive the fh-secops:lead role across the three gates of an FH round.
# Wraps the canonical gate-signing protocol from the agent spec.
#
# Usage:
#   run-fh-secops-lead.sh gate-a <round>  # open round
#   run-fh-secops-lead.sh gate-b <round>  # seal red manifest, deliver to defense
#   run-fh-secops-lead.sh gate-c <round>  # publish dialogue, bump version, close
#
# Preconditions:
#   - You hold the fh-secops:lead signing key (out-of-band, Keychain).
#   - You are the ONLY persona that holds both fleet keys, and only at gate moments.

set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: $0 gate-a|gate-b|gate-c <round>" >&2
  exit 2
fi

GATE="$1"
ROUND="$2"
TODAY="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

REPO_ROOT="$(git rev-parse --show-toplevel)"
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./env.sh
. "$HERE/env.sh"

case "$GATE" in
  gate-a)
    # Open the round.
    "$HERE/new-round.sh" "${ROUND_FROM:-}" "$ROUND" || {
      echo "[gate-a] dialogue scaffolding failed (perhaps already exists)" >&2
    }
    pd tuple put "round:fh:open:$ROUND" "$TODAY"
    # Sign the Gate A event.
    PAYLOAD_HASH=$(sha256sum "$REPO_ROOT/whitepaper/research/program/rounds/federated-harbor/round-$ROUND-whitehat-targets.md" 2>/dev/null | awk '{print $1}')
    echo "{\"gate\":\"A\",\"round\":\"fh.$ROUND\",\"ts\":\"$TODAY\",\"payload_hash\":\"sha256:$PAYLOAD_HASH\",\"signed_by\":\"fh-secops:lead\"}" \
      | pd msg send coordination:audit -
    echo "[gate-a] Round $ROUND opened; both fleets notified."
    ;;
  gate-b)
    # Seal red attack manifest.
    BUNDLE_DIR="$REPO_ROOT/.scratch/fh-$ROUND-red-bundle"
    mkdir -p "$BUNDLE_DIR"
    pd tuple list --prefix "smell:fh:" > "$BUNDLE_DIR/smells.txt"
    BUNDLE_HASH=$(sha256sum "$BUNDLE_DIR/smells.txt" | awk '{print $1}')
    # Deliver to each defender inbox.
    for inbox in fh-defense:trust fh-defense:tokens fh-defense:revocation fh-defense:econ fh-defense:proofs; do
      pd msg send "$inbox" "$(cat "$BUNDLE_DIR/smells.txt")"
    done
    # Sign Gate B.
    echo "{\"gate\":\"B\",\"round\":\"fh.$ROUND\",\"ts\":\"$TODAY\",\"payload_hash\":\"sha256:$BUNDLE_HASH\",\"signed_by\":\"fh-secops:lead\"}" \
      | pd msg send coordination:audit -
    echo "[gate-b] Red manifest sealed and delivered to defense fleet."
    ;;
  gate-c)
    # Publish dialogue. Assumes defense phase ended; pulls fix:fh:*, proof:fh:landed:*,
    # placeholder:fh:pinned:*.
    DIALOGUE_JSON="$FH_DIALOGUE_ROOT/dialogue-fh-${ROUND_FROM:-}-to-$ROUND.json"
    if [ ! -f "$DIALOGUE_JSON" ]; then
      echo "[gate-c] dialogue artifact $DIALOGUE_JSON missing; cannot close" >&2
      exit 3
    fi
    # The actual JSON assembly is done by the fh-secops:lead agent in-process; this
    # script just signs Gate C once the agent has committed the final dialogue.
    DIALOGUE_HASH=$(sha256sum "$DIALOGUE_JSON" | awk '{print $1}')
    echo "{\"gate\":\"C\",\"round\":\"fh.$ROUND\",\"ts\":\"$TODAY\",\"payload_hash\":\"sha256:$DIALOGUE_HASH\",\"signed_by\":\"fh-secops:lead\"}" \
      | pd msg send coordination:audit -
    pd tuple put "version:fh:fh.$ROUND" "$TODAY"
    echo "[gate-c] Dialogue published; round closed."
    ;;
  *)
    echo "unknown gate: $GATE (use gate-a | gate-b | gate-c)" >&2
    exit 2
    ;;
esac
