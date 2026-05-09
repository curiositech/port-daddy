#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PD=(./node_modules/.bin/tsx bin/port-daddy-cli.ts)
CHANNEL="${PD_TUBE_DEMO_CHANNEL:-port-daddy:demo:tube}"

cd "$ROOT"

echo "# PD Tube: real daemon-backed conversation"
echo "# channel: $CHANNEL"
echo

echo "$ printf 'Coordination should be visible.' | pd tube $CHANNEL --send --sender demo-writer --json"
first_json="$(printf 'Coordination should be visible.' | "${PD[@]}" tube "$CHANNEL" --send --sender demo-writer --json)"
echo "$first_json"
first_id="$(node -e "const j=JSON.parse(process.argv[1]); console.log(j.id)" "$first_json")"
echo

echo "$ printf 'Replying with proof from the same channel.' | pd tube $CHANNEL --reply-to=$first_id --sender demo-reviewer --json"
reply_json="$(printf 'Replying with proof from the same channel.' | "${PD[@]}" tube "$CHANNEL" --reply-to="$first_id" --sender demo-reviewer --json)"
echo "$reply_json"
echo

echo "$ pd tube $CHANNEL --since=$((first_id - 1)) --once --json --no-history --limit=5"
"${PD[@]}" tube "$CHANNEL" --since="$((first_id - 1))" --once --json --no-history --limit=5
echo

echo "# Done: both messages came from live Port Daddy channel history."
