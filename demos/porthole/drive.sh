#!/usr/bin/env bash
# Honest demo driver: typing is simulated, every byte of output is a real
# command running against the real installed daemon. No filtering, no truncation.
set -uo pipefail

PROMPT_DIR="~/coding/port-daddy"
type_cmd() {
  local text="$1" i
  printf '\033[1;36m%s\033[0m \033[1;32m❯\033[0m ' "$PROMPT_DIR"
  sleep 0.6
  for ((i = 0; i < ${#text}; i += 1)); do
    printf '%s' "${text:$i:1}"
    sleep 0.028
  done
  sleep 0.35
  printf '\n'
}

run() {
  type_cmd "$1"
  bash -c "$1" 2>&1
  printf '\n'
  sleep 0.9
}

sleep 0.4
for cmd in "$@"; do
  run "$cmd"
done
sleep 1.2
