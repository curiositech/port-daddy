#!/usr/bin/env zsh
# =============================================================================
# Test Gap Hunter — Coverage creep
# =============================================================================
# Analyzes test coverage, identifies modules below threshold, and spawns
# Claude agents to write tests for the worst gaps.
#
# Usage:
#   ./fleet/test-gap-hunter.sh                              # Run once
#   pd watch git:committed --exec './fleet/test-gap-hunter.sh'  # Auto-trigger
#
# Channels:
#   Subscribes to: git:committed
#   Publishes to: tests:gap-found, tests:gap-filled
# =============================================================================

source "$(dirname "$0")/common.sh"

AGENT_NAME="test-gap-hunter"
COVERAGE_THRESHOLD=50  # Minimum acceptable line coverage %
MAX_GAPS_PER_RUN=3     # Don't overwhelm with too many agents

hunter_run() {
  cd "$PROJECT_DIR" || exit 1

  fleet_log "$AGENT_NAME" "Running coverage analysis..."

  # Run tests with coverage (suppress output, capture JSON)
  local coverage_output=$(npm test -- --coverage --coverageReporters=json-summary 2>&1 | tail -5)
  local coverage_file="$PROJECT_DIR/coverage/coverage-summary.json"

  if [[ ! -f "$coverage_file" ]]; then
    fleet_warn "$AGENT_NAME" "Coverage report not generated — tests may have failed"
    return 1
  fi

  # Parse coverage and find gaps
  local gaps=$(python3 -c "
import json, sys
with open('$coverage_file') as f:
    data = json.load(f)

gaps = []
for path, metrics in data.items():
    if path == 'total': continue
    lines = metrics.get('lines', {})
    pct = lines.get('pct', 100)
    if pct < $COVERAGE_THRESHOLD:
        # Normalize path relative to project
        rel = path.replace('$PROJECT_DIR/', '')
        gaps.append((pct, rel))

gaps.sort()  # lowest coverage first
for pct, path in gaps[:$MAX_GAPS_PER_RUN]:
    print(f'{pct:.0f}% {path}')
" 2>/dev/null)

  if [[ -z "$gaps" ]]; then
    fleet_success "$AGENT_NAME" "All modules above ${COVERAGE_THRESHOLD}% coverage"
    return 0
  fi

  local gap_count=$(echo "$gaps" | wc -l | tr -d ' ')
  fleet_log "$AGENT_NAME" "Found $gap_count modules below ${COVERAGE_THRESHOLD}% coverage"

  # For each gap, spawn a Claude agent to write tests
  echo "$gaps" | head -$MAX_GAPS_PER_RUN | while read pct path; do
    fleet_log "$AGENT_NAME" "Spawning test writer for $path ($pct coverage)"

    local module_name=$(basename "$path" .ts)
    local test_path="tests/unit/${module_name}.test.js"

    local prompt="You are a test writer for Port Daddy. Write meaningful tests for:

Module: $path (currently at ${pct}% line coverage)
Existing test file: $test_path (may or may not exist)

Instructions:
1. Read $path completely to understand what it does
2. If $test_path exists, read it to see what's already tested
3. Identify the UNTESTED code paths — focus on error handling, edge cases, and core behavior
4. Write tests that would actually catch bugs (not trivial/tautological tests)
5. Follow the project pattern: createTestDb() from tests/setup-unit.js, Jest with ESM
6. Run the tests to verify they pass

Do NOT write tests that just check constants equal themselves or test JavaScript builtins.
Every test should exercise a real code path in the module."

    pd_pub "tests:gap-found" "{\"module\":\"$path\",\"coverage\":\"$pct\",\"agent\":\"$AGENT_NAME\",\"timestamp\":$(date +%s)}"

    local result=$(claude_run "$prompt")

    if [[ $? -eq 0 ]]; then
      fleet_success "$AGENT_NAME" "Tests written for $path"
      pd_pub "tests:gap-filled" "{\"module\":\"$path\",\"agent\":\"$AGENT_NAME\",\"timestamp\":$(date +%s)}"
    else
      fleet_warn "$AGENT_NAME" "Failed to write tests for $path"
    fi
  done
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
fleet_register "$AGENT_NAME" "Identify and fill test coverage gaps"
trap 'fleet_shutdown "$AGENT_NAME"; exit 0' INT TERM

hunter_run
fleet_shutdown "$AGENT_NAME"
