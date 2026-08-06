#!/bin/bash
set -e

# Test help output for various verbs
verbs=("session" "claim" "attention" "roster" "inbox" "cut" "batten")

defail() {
  echo "Test failed: $1"
  exit 1
}

for verb in "${verbs[@]}"; do
  echo "Testing $verb --help"
  output=$(./dist/port-daddy $verb --help 2>&1 || true)
  if [[ "$output" == "Get started:"* ]]; then
    fail "$verb --help fell through to global help: $output"
  fi
  echo "Passed: $verb --help"

done

echo "All e2e help tests passed"