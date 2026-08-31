#!/usr/bin/env bash
# skills/federated-harbor-redteam/scripts/new-round.sh
#
# Scaffold the dialogue artifact + target list for a new
# Federated Harbor round, from the redteam side. Mirrors the
# author skill's new-round.sh but also writes a target-list
# specifically for the redteam probe set.
#
# Usage:
#   new-round.sh <from-version> <to-version>
#   new-round.sh v0.1 v0.2
#
# Produces (if missing):
#   whitepaper/research/program/rounds/federated-harbor/dialogue-fh-<from>-to-<to>.json
#   whitepaper/research/program/rounds/federated-harbor/dialogue-fh-<from>-to-<to>.md
#   whitepaper/research/program/rounds/federated-harbor/round-<to>-redteam-targets.md
#
# If the dialogue artifact already exists (author skill scaffolded
# it first), this script only adds the redteam-targets file.

set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: $0 <from-version> <to-version>" >&2
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
TARGETS="$OUTDIR/round-$TO-redteam-targets.md"

# Only scaffold dialogue if absent (author skill's new-round.sh may
# have already done it).
if [ ! -e "$JSON" ]; then
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
  echo "scaffolded $JSON"
fi

if [ ! -e "$MD" ]; then
  cat > "$MD" <<EOF
# Dialogue: Federated Harbor $FROM → $TO

**Round:** $TO
**Sealed at:** $TODAY
**Lead:** fh-secops:lead
**Status:** in-progress

(populated at Gate C)
EOF
  echo "scaffolded $MD"
fi

# Redteam targets file. Pulled from cross-paper UNRESOLVED rows +
# new sections marked ready-for-redteam.
if [ -e "$TARGETS" ]; then
  echo "refusing to clobber existing $TARGETS" >&2
  exit 3
fi

cat > "$TARGETS" <<EOF
# Federated Harbor Redteam Targets — Round $TO

**Round:** $TO
**Opened:** $TODAY
**Lead:** fh-secops:lead

## Prime targets (UNRESOLVED cross-paper rows)

(Populate from references/cross-paper-dependencies.md; rows tagged
**UNRESOLVED — prime probe target**.)

- [ ] §fh-7 / Bonded §[BONDED-§-REVOKE] — partition model
- [ ] §fh-8 / Bonded §sec:youle — Pareto cross-harbor
- [ ] §fh-9 / Bonded §[BONDED-§-CONSERVATION] — settlement reversal

## New sections ready-for-redteam

(Populate from \`pd tuple list --prefix ready-for-redteam:fh:\` at
round-open.)

## Carry-overs from $FROM

(Populate from previous round's \`carried\` field in dialogue JSON.)

## Probe persona assignments

| Persona                  | Target                                      | Tool      |
|--------------------------|---------------------------------------------|-----------|
| fh-redteam-trust         | §fh-2, §fh-5                                | ProVerif  |
| fh-redteam-tokens        | §fh-3, §fh-4                                | ProVerif/Tamarin |
| fh-redteam-revocation    | §fh-7                                       | Apalache  |
| fh-redteam-econ          | §fh-4 (Sybil), §fh-6, §fh-7, §fh-8          | Mesa      |
| fh-proof-gap-auditor     | all sections                                | grep + artifact index |

## Deadlines

- Gate A (round open): $TODAY
- Phase 1 (attack) deadline: $TODAY + 7 days
- Gate B (seal): $TODAY + 7 days
- Gate C (publish): $TODAY + 14 days
EOF

echo "scaffolded $TARGETS"
echo
echo "Next steps:"
echo "  1. Populate prime targets from cross-paper-dependencies.md"
echo "  2. Populate new sections from pd tuple list --prefix ready-for-redteam:fh:"
echo "  3. fh-secops:lead sprays round:fh:open:$TO"
echo "  4. Personas claim sections; phase 1 begins"
