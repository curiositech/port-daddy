#!/usr/bin/env bash
# skills/federated-harbor-whitehat/scripts/new-round.sh
#
# Scaffold the dialogue artifact + defense target list for a new
# Federated Harbor round, from the whitehat side. Mirrors the
# author and redteam scripts; this one writes the defense-targets
# file specifically for fh-secops:lead Gate A.
#
# Usage:
#   new-round.sh <from-version> <to-version>

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
TARGETS="$OUTDIR/round-$TO-whitehat-targets.md"

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

if [ -e "$TARGETS" ]; then
  echo "refusing to clobber existing $TARGETS" >&2
  exit 3
fi

cat > "$TARGETS" <<EOF
# Federated Harbor Whitehat Targets — Round $TO

**Round:** $TO
**Opened:** $TODAY
**Lead:** fh-secops:lead

## Standing defense classes (one per round, all sections covered)

| Class | Section(s)        | Persona                  | Artifact(s) targeted (see references/mechanization-targets.md)     |
|-------|-------------------|--------------------------|--------------------------------------------------------------------|
| 1     | §fh-3, §fh-5      | fh-whitehat-trust        | whitepaper/formal/proverif/federated-harbor/trust/non-transitive-pact.pv                       |
| 2     | §fh-3             | fh-whitehat-tokens       | whitepaper/formal/proverif/federated-harbor/tokens/cross-harbor-issuance.pv                    |
| 3     | §fh-7             | fh-whitehat-revocation   | whitepaper/formal/tla/federated-harbor/revocation/propagation.tla                         |
| 4     | §fh-4 (Sybil sub) | fh-whitehat-econ         | whitepaper/research/program/simulations/federated-harbor/sybil/join-cost.py                                 |
| 5     | §fh-6             | fh-whitehat-econ         | whitepaper/formal/tla/federated-harbor/settlement/no-double-extract.tla                   |
| 6     | §fh-4             | fh-whitehat-tokens       | whitepaper/formal/proverif/federated-harbor/equivocation/witness-cross-check.pv                 |
| 7     | §fh-7             | fh-whitehat-econ         | whitepaper/research/program/simulations/federated-harbor/econ/bond-drain.py                                  |
| 8     | §fh-8             | fh-whitehat-econ         | whitepaper/research/program/simulations/federated-harbor/cold-start/extraction-bound.py                     |
| 9     | §fh-8             | fh-whitehat-econ         | whitepaper/research/program/rounds/federated-harbor/planned/operator-sybil/binding.md |

## Smells delivered at Gate B

(Populated by fh-secops:lead at Gate B with the sealed bundle hash
and a per-class delivery to each defender's inbox.)

## Carry-overs from $FROM

(Populated from previous round's \`carried\` field.)

## Placeholders to pin this round

(Populated from \`whitepaper/research/program/rounds/federated-harbor/dialogue-fh-$FROM-*.json\`
where placeholders survived one round of grace.)

## Cross-paper dependencies (UNRESOLVED)

(Populated from references/cross-paper-dependencies.md; CC the
prior-paper sec-eng-lead for each row.)

## Deadlines

- Gate A (round open): $TODAY
- Gate B (red seal): $TODAY + 7 days
- Phase 2 (defense) deadline: $TODAY + 14 days
- Gate C (publish): $TODAY + 14 days
EOF

echo "scaffolded $TARGETS"
echo
echo "Next: fh-secops:lead populates carry-overs + placeholder list before Gate A spray."
