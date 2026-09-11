#!/usr/bin/env bash
# Drives the S2 design of PROTOCOL.md S2.4 through harness/run.py, one cell
# (corpus, substrate, N, temperament, seed) per invocation. Idempotent and
# resumable: any cell whose CSV already exists under results/ is skipped, so
# re-running this script after an interruption picks up where it left off.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

PY=python3
OUT="results"

# S2.2/S2.4: substrate levels. S2.4's prose says "substrate (6 levels)" but
# S2.2's own table names 7 distinct substrate/p combinations (U; B(0),
# B(0.05), B(0.2); C; D; CR) — see CHANGELOG.md. All 7 are run here rather
# than silently dropping one.
SUBSTRATES=(U B0 B005 B02 C D CR)
AGENT_COUNTS=(2 4 8 16)
CORPORA=(ts-service py-library docs-heavy)
TEMPERAMENTS=(cooperative impatient)
SEEDS=$(seq 1 20)
FULL_TASKS=600

cell_csv_path() {
  local corpus=$1 substrate=$2 agents=$3 temperament=$4 seed=$5
  echo "$OUT/$corpus/${substrate}-N${agents}-${temperament}-s${seed}.csv"
}

run_cell() {
  local corpus=$1 substrate=$2 agents=$3 temperament=$4 seed=$5 tasks=$6
  local csv
  csv=$(cell_csv_path "$corpus" "$substrate" "$agents" "$temperament" "$seed")
  if [[ -f "$csv" ]]; then
    echo "skip  $csv (exists)"
    return 0
  fi
  echo "run   $csv"
  "$PY" -m harness.run --corpus "$corpus" --substrate "$substrate" \
    --agents "$agents" --temperament "$temperament" --seed "$seed" \
    --tasks "$tasks" --out "$OUT"
}

usage() {
  cat <<'EOF'
Usage:
  run.sh                 Run the full S2.4 design (resumable; skips cells
                          whose CSV already exists under results/).
  run.sh --pilot         Run the pilot: py-library, all substrates,
                          N in {2,4,8}, both temperaments, seeds 1-2,
                          200 tasks. (Cut from 3 seeds to 2; see CHANGELOG.md.)
  run.sh --replicate C   Regenerate exactly one cell. C is either a path
                          under results/ (e.g.
                          results/py-library/C-N4-cooperative-s3.csv) or the
                          bare spec corpus/substrate-N<agents>-<temperament>-s<seed>.
  run.sh --check         Delegates to `make check` (the H1 self-check smoke).
EOF
}

parse_cell_spec() {
  # Accepts either a results/... path or a bare "corpus/SUB-N#-temp-s#" spec.
  local spec=$1
  spec=${spec#"$OUT/"}
  spec=${spec%.csv}
  local corpus=${spec%%/*}
  local rest=${spec#*/}
  if [[ "$rest" == "$spec" ]]; then
    echo "cannot parse cell spec: $1" >&2
    exit 2
  fi
  # rest = SUBSTRATE-N<agents>-<temperament>-s<seed>
  if [[ "$rest" =~ ^([A-Za-z0-9]+)-N([0-9]+)-([a-z]+)-s([0-9]+)$ ]]; then
    echo "$corpus" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[4]}"
  else
    echo "cannot parse cell spec: $1" >&2
    exit 2
  fi
}

case "${1:-}" in
  -h|--help)
    usage
    ;;
  --check)
    exec make check
    ;;
  --pilot)
    PILOT_CORPUS=py-library
    PILOT_NS=(2 4 8)
    PILOT_SEEDS=(1 2)   # cut from 3 to 2 seeds; see CHANGELOG.md
    PILOT_TASKS=200
    for substrate in "${SUBSTRATES[@]}"; do
      for agents in "${PILOT_NS[@]}"; do
        for temperament in "${TEMPERAMENTS[@]}"; do
          for seed in "${PILOT_SEEDS[@]}"; do
            run_cell "$PILOT_CORPUS" "$substrate" "$agents" "$temperament" "$seed" "$PILOT_TASKS"
          done
        done
      done
    done
    ;;
  --replicate)
    if [[ $# -lt 2 ]]; then
      echo "usage: run.sh --replicate <cell>" >&2
      exit 2
    fi
    read -r corpus substrate agents temperament seed <<<"$(parse_cell_spec "$2")"
    csv=$(cell_csv_path "$corpus" "$substrate" "$agents" "$temperament" "$seed")
    rm -f "$csv" "${csv%.csv}.events.csv"
    run_cell "$corpus" "$substrate" "$agents" "$temperament" "$seed" "$FULL_TASKS"
    ;;
  "")
    for corpus in "${CORPORA[@]}"; do
      for substrate in "${SUBSTRATES[@]}"; do
        for agents in "${AGENT_COUNTS[@]}"; do
          for temperament in "${TEMPERAMENTS[@]}"; do
            for seed in $SEEDS; do
              run_cell "$corpus" "$substrate" "$agents" "$temperament" "$seed" "$FULL_TASKS"
            done
          done
        done
      done
    done
    ;;
  *)
    usage
    exit 2
    ;;
esac
