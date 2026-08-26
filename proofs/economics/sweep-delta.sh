#!/usr/bin/env bash
# sweep-delta.sh
#
# Sweep the TLA+ claim-signaling model across discount factors
# delta ∈ {0.30, 0.31, ..., 0.40} and print the crossover point.
#
# Usage:
#   ./sweep-delta.sh                        # uses tlc (default)
#   TLA_CHECKER=apalache ./sweep-delta.sh   # use apalache-mc
#   TLA_CHECKER=tlc      ./sweep-delta.sh   # explicit tlc
#
# To use the JAR directly (no `tlc` wrapper on PATH), set
#   TLA_TOOLS_JAR=/path/to/tla2tools.jar
# We will invoke it as
#   java -cp $TLA_TOOLS_JAR tlc2.TLC -config <cfg> claim_signaling.tla
#
# Expected output: a table of (delta, status) rows. The crossover row is
# the smallest delta for which NoUnilateralDeviationPositive holds; that
# value should land at delta ≈ 0.35 (the integer-grid rounding of the
# closed-form root delta* ≈ 0.3425 proved by delta-threshold.z3).
#
# Exit code:
#   0 — the crossover matched [0.34, 0.35]
#   1 — the crossover landed outside the expected interval, OR a tool
#       was missing, OR a check produced an unexpected status

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CHECKER="${TLA_CHECKER:-tlc}"
SWEEP_DIR="$SCRIPT_DIR/.sweep"
mkdir -p "$SWEEP_DIR"

# Resolve the TLC / Apalache invocation.
case "$CHECKER" in
  tlc)
    if command -v tlc >/dev/null 2>&1; then
      RUN_TLC=(tlc)
    elif command -v tlc2 >/dev/null 2>&1; then
      RUN_TLC=(tlc2)
    elif [[ -n "${TLA_TOOLS_JAR:-}" ]] && [[ -f "$TLA_TOOLS_JAR" ]]; then
      RUN_TLC=(java -cp "$TLA_TOOLS_JAR" tlc2.TLC)
    elif [[ -f "$SCRIPT_DIR/../../tools/tla2tools.jar" ]]; then
      RUN_TLC=(java -cp "$SCRIPT_DIR/../../tools/tla2tools.jar" tlc2.TLC)
    else
      echo "ERROR: tlc not found. Install via brew (brew install tla-tools) or set TLA_TOOLS_JAR." >&2
      exit 1
    fi
    ;;
  apalache)
    if command -v apalache-mc >/dev/null 2>&1; then
      RUN_TLC=(apalache-mc)
    elif [[ -f "$SCRIPT_DIR/../../tools/apalache/bin/apalache-mc" ]]; then
      RUN_TLC=("$SCRIPT_DIR/../../tools/apalache/bin/apalache-mc")
    else
      echo "ERROR: apalache-mc not found. See https://apalache.informal.systems/docs/apalache/installation/jvm.html" >&2
      exit 1
    fi
    ;;
  *)
    echo "ERROR: TLA_CHECKER must be 'tlc' or 'apalache' (got: $CHECKER)" >&2
    exit 1
    ;;
esac

printf 'sweep-delta.sh — sweeping delta over {0.30, 0.31, ..., 0.40}\n'
printf 'checker      = %s\n' "$CHECKER"
printf 'horizon      = 4 rounds (minimal IC-exercising horizon)\n'
printf 'punishment   = 3 rounds (graduated trigger)\n'
printf -- '----\n'
printf 'delta   status\n'

CROSSOVER=""

for n in 30 31 32 33 34 35 36 37 38 39 40; do
  delta_pretty="0.$(printf '%02d' "$n")"
  cfg_file="$SWEEP_DIR/sweep-${n}.cfg"
  log_file="$SWEEP_DIR/sweep-${n}.log"

  # Generate a per-delta cfg overriding DeltaNum.
  cat > "$cfg_file" <<EOF
SPECIFICATION Spec
CHECK_DEADLOCK FALSE
CONSTANTS
  DeltaNum = $n
  DeltaDen = 100
  Horizon = 4
  PunishmentRounds = 3
INVARIANTS
  NoUnilateralDeviationPositive
EOF

  if [[ "$CHECKER" == "tlc" ]]; then
    if "${RUN_TLC[@]}" -config "$cfg_file" claim_signaling.tla > "$log_file" 2>&1; then
      if grep -q "No error has been found" "$log_file"; then
        status="HOLDS"
      else
        status="UNEXPECTED"
      fi
    else
      if grep -q "Invariant.*is violated" "$log_file"; then
        status="VIOLATED"
      else
        status="ERROR (see $log_file)"
      fi
    fi
  else
    # apalache-mc
    if "${RUN_TLC[@]}" check --inv=NoUnilateralDeviationPositive \
         --config="$cfg_file" claim_signaling.tla > "$log_file" 2>&1; then
      status="HOLDS"
    else
      if grep -qi "counterexample\|violation\|EXITCODE: ERROR" "$log_file"; then
        status="VIOLATED"
      else
        status="ERROR (see $log_file)"
      fi
    fi
  fi

  printf '%s   %s\n' "$delta_pretty" "$status"

  if [[ -z "$CROSSOVER" ]] && [[ "$status" == "HOLDS" ]]; then
    CROSSOVER="$delta_pretty"
  fi
done

printf -- '----\n'
if [[ -n "$CROSSOVER" ]]; then
  printf 'crossover (smallest delta where invariant HOLDS) = %s\n' "$CROSSOVER"
  printf 'closed-form root (delta-threshold.z3)            = 0.3425\n'

  # Crossover should land in [0.34, 0.35]
  if [[ "$CROSSOVER" == "0.34" ]] || [[ "$CROSSOVER" == "0.35" ]]; then
    printf 'PASS: crossover matches closed-form within integer-grid rounding.\n'
    exit 0
  else
    printf 'FAIL: crossover %s outside expected [0.34, 0.35].\n' "$CROSSOVER"
    exit 1
  fi
else
  printf 'FAIL: no delta in the sweep range produced HOLDS.\n'
  exit 1
fi
