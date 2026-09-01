#!/usr/bin/env bash
# skills/federated-harbor-author/scripts/new-round.sh
#
# Scaffold the dialogue artifact + section worklist for a new
# Federated Harbor round.
#
# Usage:
#   new-round.sh <from-version> <to-version>
#   new-round.sh v0.1 v0.2
#
# Produces:
#   whitepaper/research/program/rounds/federated-harbor/dialogue-fh-<from>-to-<to>.json
#   whitepaper/research/program/rounds/federated-harbor/dialogue-fh-<from>-to-<to>.md
#
# Both files start populated with the round skeleton. The JSON is
# the source of truth; the MD is the rendered form. After each round
# the secops-lead fills in `exchanges`, `carried`, `paper_changes`,
# and `reputation_deltas` and re-renders the MD from the JSON.

set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: $0 <from-version> <to-version>" >&2
  echo "example: $0 v0.1 v0.2" >&2
  exit 2
fi

FROM="$1"
TO="$2"
TODAY="$(date -u +%Y-%m-%d)"
REPO_ROOT="$(git rev-parse --show-toplevel)"
OUTDIR="$REPO_ROOT/whitepaper/research/program/rounds/federated-harbor"
mkdir -p "$OUTDIR"

JSON="$OUTDIR/dialogue-fh-$FROM-to-$TO.json"
MD="$OUTDIR/dialogue-fh-$FROM-to-$TO.md"

if [ -e "$JSON" ] || [ -e "$MD" ]; then
  echo "refusing to clobber existing artifact: $JSON" >&2
  exit 3
fi

cat > "$JSON" <<EOF
{
  "round_from": "$FROM",
  "round_to": "$TO",
  "kind": "normal",
  "paper": "federated-harbor",
  "sealed_at": "$TODAY",
  "lead": "fh-secops:lead",
  "exchanges": [],
  "carried": [],
  "paper_changes": [],
  "infrastructure_added": [],
  "reputation_deltas": {},
  "cross_paper_resolved": [],
  "cross_paper_unresolved": [],
  "placeholders_pinned": []
}
EOF

cat > "$MD" <<EOF
# Dialogue: Federated Harbor $FROM → $TO

**Round:** $TO
**Sealed at:** $TODAY
**Lead:** fh-secops:lead
**Status:** in-progress

---

## Closed this round

(populated at Gate C)

## Carried to next round

(populated at Gate C)

## Paper changes

(populated at Gate C)

## Infrastructure added

(populated at Gate C)

## Cross-paper dependencies

### Resolved

(populated at Gate C)

### Unresolved (CC'd to Anchor / Bonded leads)

(populated at Gate C)

## Placeholders pinned

(populated at Gate C — one row per placeholder with its committed value)

## Reputation deltas

(populated at Gate C)
EOF

echo "Scaffolded:"
echo "  $JSON"
echo "  $MD"
echo
echo "Next steps:"
echo "  1. fh-secops:lead writes target list under whitepaper/research/program/rounds/federated-harbor/round-$TO-targets.md"
echo "  2. fh-secops:lead sprays round:fh:open:$TO"
echo "  3. red personas claim sections; phase 1 attack begins"
