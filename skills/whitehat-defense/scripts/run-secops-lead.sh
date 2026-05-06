#!/usr/bin/env bash
# skills/whitehat-defense/scripts/run-secops-lead.sh
#
# Drive sec-eng-lead through the three gates of a single round.
#
# Usage:
#   run-secops-lead.sh <command> <round> [args]
#   run-secops-lead.sh open     v2.1                            # Gate A
#   run-secops-lead.sh seal     v2.1                            # Gate B
#   run-secops-lead.sh publish  v2.1 --carry smell:vuln:x:0017  # Gate C
#
# Preconditions:
#   - sec-eng-lead has root + signing key in keychain (one-time setup
#     via setup-secops-lead.sh).
#   - For seal: the redteam-review project has a non-empty stream of
#     envelope-encrypted notes from Phase 1.
#   - For publish: Gate B has been called for the same round, and
#     whitehat-defense has a non-empty stream of envelope-encrypted
#     notes from Phase 2.
#
# Behavior:
#   - Each gate calls into lib/coordination-gates.ts via a thin Node
#     driver. The cleartext bundle never touches disk; only the
#     re-encrypted envelope is persisted.
#   - The audit event is written to coordination:audit, signed by the
#     lead key.

set -euo pipefail

CMD="${1:-}"
ROUND="${2:-}"

if [[ -z "$CMD" || -z "$ROUND" ]]; then
  sed -n '2,30p' "$0"; exit 2
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"

run_node() {
  cd "$REPO_ROOT"
  NODE_OPTIONS="--experimental-vm-modules" node \
    --experimental-loader=@swc-node/register/esm \
    --input-type=module \
    -e "$1"
}

case "$CMD" in
  open)
    SALT="$(openssl rand -base64 32)"
    run_node "
      import { openRound } from './lib/coordination-gates.ts';
      const r = openRound({ round: '$ROUND', salt: '$SALT' });
      console.log(JSON.stringify({ ok: true, gate: 'A', ...r }, null, 2));
    "
    ;;

  seal)
    # Read all envelope-encrypted red Phase-1 notes from the daemon,
    # plus the verify-keys for red personas. The driver below assumes
    # a small JSON staging file at /tmp/redteam-stream-$ROUND.json
    # produced by the lead's note-collector (out of scope here).
    STAGING="/tmp/redteam-stream-$ROUND.json"
    if [[ ! -f "$STAGING" ]]; then
      echo "[seal] expected red stream at $STAGING — run the collector first" >&2
      exit 3
    fi
    run_node "
      import { sealAttackManifest } from './lib/coordination-gates.ts';
      import { readFileSync, writeFileSync } from 'node:fs';
      const stream = JSON.parse(readFileSync('$STAGING', 'utf8'));
      // stream.envelopes :: EnvelopePayload[]
      // stream.verifyKeys :: Record<persona, base64-pubkey>
      const verify = Object.fromEntries(Object.entries(stream.verifyKeys).map(([k,v]) => [k, Buffer.from(v, 'base64')]));
      const out = sealAttackManifest({ round: '$ROUND', salt: stream.salt }, stream.envelopes, verify);
      writeFileSync('/tmp/sealed-$ROUND.json', JSON.stringify(out, null, 2));
      console.log('[seal] manifest_hash=' + out.manifest.manifest_hash);
    "
    ;;

  publish)
    SEALED="/tmp/sealed-$ROUND.json"
    DEFENSE_STAGING="/tmp/defense-stream-$ROUND.json"
    if [[ ! -f "$SEALED" || ! -f "$DEFENSE_STAGING" ]]; then
      echo "[publish] expected $SEALED and $DEFENSE_STAGING" >&2
      exit 3
    fi
    run_node "
      import { publishDialogue } from './lib/coordination-gates.ts';
      import { readFileSync, writeFileSync } from 'node:fs';
      const sealed = JSON.parse(readFileSync('$SEALED', 'utf8'));
      const defense = JSON.parse(readFileSync('$DEFENSE_STAGING', 'utf8'));
      const verifyD = Object.fromEntries(Object.entries(defense.verifyKeys).map(([k,v]) => [k, Buffer.from(v, 'base64')]));
      const verifyManifest = { 'secops:lead': Buffer.from(defense.leadVerifyKey, 'base64') };
      const out = publishDialogue(
        { round: '$ROUND', salt: sealed.salt },
        sealed.manifest,
        verifyManifest,
        defense.envelopes,
        verifyD,
        defense.carriedReasons || {},
      );
      writeFileSync('docs/shipwright/dialogue-' + out.dialogue.round_from + '-to-' + out.dialogue.round_to + '.json', JSON.stringify(out.dialogue, null, 2));
      console.log('[publish] dialogue v(' + out.dialogue.round_from + ') -> v(' + out.dialogue.round_to + ') with ' + out.dialogue.exchanges.length + ' exchanges, ' + out.dialogue.carried.length + ' carried');
    "
    ;;

  *)
    echo "unknown command: $CMD (expected: open | seal | publish)" >&2; exit 2 ;;
esac
