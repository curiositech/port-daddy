#!/usr/bin/env bash
# skills/federated-harbor-redteam/scripts/verify-probe.sh
#
# Sanity-check a probe JSON file before committing.
# Validates against scripts/probe-template.json and enforces
# the federation-specific rules: §fh-N section keys (not bare §N),
# persona/class consistency, and observable/impact non-empty.
#
# Usage:
#   verify-probe.sh <probe.json>
#
# Exit codes:
#   0  probe valid
#   1  schema violation (missing required field, wrong type)
#   2  semantic violation (§fh- mismatch, persona/class mismatch)
#   3  file not found / not JSON

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <probe.json>" >&2
  exit 3
fi

PROBE="$1"
if [ ! -f "$PROBE" ]; then
  echo "no such file: $PROBE" >&2
  exit 3
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
SCHEMA="$HERE/probe-template.json"

# Minimal jq-based validation (full JSONSchema would need ajv-cli).
# Check required fields by name.
REQUIRED=(id class section persona target tool hypothesis construction observable impact)
FAIL=0
for f in "${REQUIRED[@]}"; do
  VAL=$(jq -r ".$f // empty" "$PROBE" 2>/dev/null || true)
  if [ -z "$VAL" ] || [ "$VAL" = "null" ]; then
    echo "MISSING required field: $f" >&2
    FAIL=1
  fi
done

if [ "$FAIL" -ne 0 ]; then
  echo "verify-probe: $PROBE FAILS schema (missing fields)" >&2
  exit 1
fi

# Semantic: section must be §fh-N form.
SECTION=$(jq -r '.section' "$PROBE")
if ! [[ "$SECTION" =~ ^§fh-[0-9]+(\.[0-9]+)*$ ]]; then
  echo "SEMANTIC: section must match §fh-N (got: $SECTION)" >&2
  echo "  bare §N is for Anchor/Bonded; federation uses §fh-N to disambiguate." >&2
  exit 2
fi

# Semantic: id prefix must match class.
ID=$(jq -r '.id' "$PROBE")
CLASS=$(jq -r '.class' "$PROBE")
case "$CLASS" in
  trust)       EXPECTED_PREFIX="smell:fh:trust:" ;;
  tokens)      EXPECTED_PREFIX="smell:fh:tokens:" ;;
  revocation)  EXPECTED_PREFIX="smell:fh:revocation:" ;;
  econ)        EXPECTED_PREFIX="smell:fh:econ:" ;;
  proof-gap)   EXPECTED_PREFIX="smell:fh:proof-gap:" ;;
  *)
    echo "SEMANTIC: unknown class $CLASS" >&2
    exit 2
    ;;
esac

if ! [[ "$ID" == "$EXPECTED_PREFIX"* ]]; then
  echo "SEMANTIC: id must start with $EXPECTED_PREFIX for class $CLASS (got: $ID)" >&2
  exit 2
fi

# Semantic: persona must own the class.
PERSONA=$(jq -r '.persona' "$PROBE")
case "$PERSONA:$CLASS" in
  fh-redteam-trust:trust)             ;;
  fh-redteam-tokens:tokens)           ;;
  fh-redteam-revocation:revocation)   ;;
  fh-redteam-econ:econ)               ;;
  fh-proof-gap-auditor:proof-gap)     ;;
  *)
    echo "SEMANTIC: persona $PERSONA cannot file class $CLASS (1:1 mapping)" >&2
    exit 2
    ;;
esac

# Semantic: observable + impact non-empty (already caught by required
# check, but enforce minimum quality length).
OBS=$(jq -r '.observable' "$PROBE")
IMP=$(jq -r '.impact' "$PROBE")
if [ "${#OBS}" -lt 20 ] || [ "${#IMP}" -lt 20 ]; then
  echo "SEMANTIC: observable and impact must each be ≥ 20 chars (the SKILL.md anti-pattern: 'theatrical findings lacking a concrete observation')" >&2
  exit 2
fi

# Semantic: econ class requires metric.
if [ "$CLASS" = "econ" ]; then
  METRIC_NAME=$(jq -r '.metric.name // empty' "$PROBE")
  if [ -z "$METRIC_NAME" ]; then
    echo "SEMANTIC: econ-class probes require a quantitative metric" >&2
    exit 2
  fi
fi

echo "PROBE OK: $PROBE"
echo "  id:      $ID"
echo "  section: $SECTION"
echo "  persona: $PERSONA"
echo "  class:   $CLASS"
exit 0
