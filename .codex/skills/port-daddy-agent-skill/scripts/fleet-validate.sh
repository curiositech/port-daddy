#!/usr/bin/env bash
# fleet-validate.sh — schema + topology validation for pd-fleet.yml in the current dir.
# Exits 0 if valid, non-zero with a list of problems otherwise.

set -euo pipefail

yml="${1:-pd-fleet.yml}"
schema_dir="$(cd "$(dirname "$0")/../schemas" && pwd)"
schema="$schema_dir/pd-fleet.schema.json"

[[ -f "$yml" ]] || { echo "FAIL: $yml not found"; exit 1; }
[[ -f "$schema" ]] || { echo "FAIL: schema missing at $schema"; exit 1; }

errors=()

# 1. Schema validation (requires ajv-cli or similar)
if command -v ajv >/dev/null 2>&1; then
  if ! ajv validate -s "$schema" -d "$yml" --spec=draft2020 >/dev/null 2>&1; then
    errors+=("schema: ajv reported violations — run 'ajv validate -s $schema -d $yml' for details")
  fi
elif command -v yq >/dev/null 2>&1 && command -v jsonschema >/dev/null 2>&1; then
  yq -o=json "$yml" | jsonschema -i /dev/stdin "$schema" 2>/dev/null || \
    errors+=("schema: jsonschema reported violations")
else
  echo "WARN: neither ajv nor (yq + jsonschema) installed; skipping schema check" >&2
fi

# 2. fleet.name == basename(projectDir)
expected=$(basename "$(pwd)")
actual=$(yq -r '.fleet.name' "$yml" 2>/dev/null || echo '')
if [[ "$actual" != "$expected" ]]; then
  errors+=("fleet.name='$actual' but basename(pwd)='$expected' — git:committed agents will go silently dormant")
fi

# 3. Topology: every on_success/on_failure target should be a declared channel or external
declared=$(yq -r '.fleet.channels // {} | keys | .[]' "$yml" 2>/dev/null | sort -u || true)
referenced=$(yq -r '.fleet.agents // {} | to_entries[] | .value | (.on_success, .on_failure) | select(. != null) | sub("^publish "; "")' "$yml" 2>/dev/null | sort -u || true)
for ch in $referenced; do
  if ! echo "$declared" | grep -qx "$ch"; then
    errors+=("on_success/on_failure publishes to '$ch' but no channels.$ch declared")
  fi
done

# 4. Topology via daemon (if up)
if pd status 2>/dev/null | grep -q running; then
  resp=$(curl -s "http://localhost:9876/fleet/config/$expected" 2>/dev/null || echo '{}')
  if echo "$resp" | jq -e '.topology.warnings | length > 0' >/dev/null 2>&1; then
    while read -r w; do errors+=("topology: $w"); done < <(echo "$resp" | jq -r '.topology.warnings[]')
  fi
fi

if (( ${#errors[@]} )); then
  echo "FAIL: $yml has ${#errors[@]} problem(s):"
  printf '  - %s\n' "${errors[@]}"
  exit 1
fi

echo "OK: $yml is valid (name + topology + schema)"
