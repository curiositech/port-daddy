#!/usr/bin/env zsh
# =============================================================================
# Promote main → stable
# =============================================================================
# Runs the test suite on main. If all tests pass, merges main into the stable
# branch, reinstalls in the stable worktree, and restarts the daemon.
#
# Usage: ./scripts/promote-stable.sh
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

STABLE_DIR="$HOME/port-daddy-stable"
DEV_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "${CYAN}=== Port Daddy: Promote main → stable ===${NC}"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Verify we're on main
# ---------------------------------------------------------------------------
BRANCH=$(git -C "$DEV_DIR" rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "main" ]]; then
  echo "${RED}ERROR: Must be on main branch (currently on $BRANCH)${NC}"
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 2: Check for uncommitted changes
# ---------------------------------------------------------------------------
if ! git -C "$DEV_DIR" diff --quiet HEAD -- lib/ server.ts mcp/ routes/ bin/ tests/; then
  echo "${RED}ERROR: Uncommitted changes in source files. Commit or stash first.${NC}"
  git -C "$DEV_DIR" diff --stat HEAD -- lib/ server.ts mcp/ routes/ bin/ tests/
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 3: Run tests
# ---------------------------------------------------------------------------
echo "${YELLOW}Running test suite...${NC}"
cd "$DEV_DIR"

TEST_LOG=$(mktemp "${TMPDIR:-/tmp}/port-daddy-promote-tests.XXXXXX")
trap 'rm -f "$TEST_LOG"' EXIT

if ! npm test -- --no-coverage >"$TEST_LOG" 2>&1; then
  FAIL_COUNT=$(grep "Tests:" "$TEST_LOG" | tail -1 | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' || echo "unknown")
  echo "${RED}BLOCKED: test gate failed (${FAIL_COUNT} failed)${NC}"
  echo "${YELLOW}Failure summary:${NC}"
  grep -A12 "^FAIL " "$TEST_LOG" | tail -80 || tail -80 "$TEST_LOG"
  exit 1
fi

PASS_COUNT=$(grep "Tests:" "$TEST_LOG" | tail -1 | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
FAIL_COUNT=$(grep "Tests:" "$TEST_LOG" | tail -1 | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' || echo "0")

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo "${RED}BLOCKED: $FAIL_COUNT test failures${NC}"
  grep "●" "$TEST_LOG" | head -10
  exit 1
fi

echo "${GREEN}Tests passed ($PASS_COUNT passing, 0 failures)${NC}"

# ---------------------------------------------------------------------------
# Step 4: Merge main into stable
# ---------------------------------------------------------------------------
echo "${YELLOW}Merging main → stable...${NC}"

MAIN_SHA=$(git -C "$DEV_DIR" rev-parse --short HEAD)
cd "$STABLE_DIR"
git merge main --no-edit -m "promote: main@$MAIN_SHA → stable"

# ---------------------------------------------------------------------------
# Step 5: Reinstall dependencies (in case package.json changed)
# ---------------------------------------------------------------------------
echo "${YELLOW}Installing dependencies in stable...${NC}"
npm install --production=false 2>&1 | tail -3

# ---------------------------------------------------------------------------
# Step 6: Build native Bosun supervisor
# ---------------------------------------------------------------------------
echo "${YELLOW}Building pd-bosun in stable...${NC}"
npm run build:bosun:dist

# ---------------------------------------------------------------------------
# Step 7: Re-link (in case bin entries changed)
# ---------------------------------------------------------------------------
npm link 2>&1 | tail -1

# ---------------------------------------------------------------------------
# Step 8: Reinstall service plists and restart daemon + Bosun
# ---------------------------------------------------------------------------
echo "${YELLOW}Installing daemon and Bosun services...${NC}"
npm run install-daemon -- install
sleep 4

# ---------------------------------------------------------------------------
# Step 9: Verify authoritative runtime truth
# ---------------------------------------------------------------------------
PORT_FILE="$HOME/.port-daddy/daemon.port"
if [[ ! -f "$PORT_FILE" ]]; then
  echo "${RED}WARNING: Daemon port file missing after restart.${NC}"
  echo "  Expected: $PORT_FILE"
  echo "  Check logs: tail -20 $STABLE_DIR/port-daddy-error.log"
  exit 1
fi

DAEMON_PORT="$(tr -d '[:space:]' < "$PORT_FILE")"
BASE_URL="http://127.0.0.1:${DAEMON_PORT}"

HEALTH_JSON="$(curl -fsS "$BASE_URL/health")" || {
  echo "${RED}WARNING: /health did not respond after restart.${NC}"
  echo "  URL: $BASE_URL/health"
  echo "  Check logs: tail -20 $STABLE_DIR/port-daddy-error.log"
  exit 1
}

VERSION_JSON="$(curl -fsS "$BASE_URL/version")" || {
  echo "${RED}WARNING: /version did not respond after restart.${NC}"
  echo "  URL: $BASE_URL/version"
  exit 1
}

STATUS_JSON="$(curl -fsS "$BASE_URL/status")" || {
  echo "${RED}WARNING: /status did not respond after restart.${NC}"
  echo "  URL: $BASE_URL/status"
  exit 1
}

HEALTH_STATUS="$(printf '%s' "$HEALTH_JSON" | node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(String(data.status || ""));')"
RUNTIME_VERSION="$(printf '%s' "$VERSION_JSON" | node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(String(data.version || ""));')"
RUNTIME_PID="$(printf '%s' "$VERSION_JSON" | node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(String(data.pid || ""));')"
RUNTIME_INSTALL_DIR="$(printf '%s' "$VERSION_JSON" | node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(String(data.installDir || ""));')"
RUNTIME_STATE="$(printf '%s' "$STATUS_JSON" | node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(String(data.runtime?.state || ""));')"

if [[ "$HEALTH_STATUS" != "ok" ]]; then
  echo "${RED}WARNING: /health returned unexpected status: $HEALTH_STATUS${NC}"
  exit 1
fi

if [[ "$RUNTIME_INSTALL_DIR" != "$STABLE_DIR" ]]; then
  echo "${RED}WARNING: Daemon is serving from the wrong checkout.${NC}"
  echo "  Expected installDir: $STABLE_DIR"
  echo "  Actual installDir:   $RUNTIME_INSTALL_DIR"
  exit 1
fi

echo ""
echo "${GREEN}=== Promotion complete ===${NC}"
echo "  Stable:  main@$MAIN_SHA"
echo "  Daemon:  PID $RUNTIME_PID, version $RUNTIME_VERSION"
echo "  URL:     $BASE_URL"
echo "  Runtime: ${RUNTIME_STATE:-unknown}"
echo "  Tests:   $PASS_COUNT passing"
echo ""
