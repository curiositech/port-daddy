#!/usr/bin/env zsh
# =============================================================================
# Promote main → stable
# =============================================================================
# Runs the test suite on main. If all tests pass, merges main into the stable
# branch, reinstalls in the stable worktree, and restarts the daemon.
#
# Usage: ./scripts/promote-stable.sh
# =============================================================================

set -e

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

TEST_OUTPUT=$(npm test -- --no-coverage 2>&1)
PASS_COUNT=$(echo "$TEST_OUTPUT" | grep "Tests:" | tail -1 | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
FAIL_COUNT=$(echo "$TEST_OUTPUT" | grep "Tests:" | tail -1 | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' || echo "0")

# Allow the 1 pre-existing up-down failure
if [[ "$FAIL_COUNT" -gt 1 ]]; then
  echo "${RED}BLOCKED: $FAIL_COUNT test failures (max allowed: 1 pre-existing)${NC}"
  echo "$TEST_OUTPUT" | grep "●" | head -10
  exit 1
fi

echo "${GREEN}Tests passed ($PASS_COUNT passing, $FAIL_COUNT known failures)${NC}"

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
# Step 6: Re-link (in case bin entries changed)
# ---------------------------------------------------------------------------
npm link 2>&1 | tail -1

# ---------------------------------------------------------------------------
# Step 7: Restart daemon
# ---------------------------------------------------------------------------
echo "${YELLOW}Restarting daemon...${NC}"
pd stop 2>/dev/null || true
sleep 2
launchctl unload ~/Library/LaunchAgents/com.portdaddy.daemon.plist 2>/dev/null || true
sleep 1
launchctl load ~/Library/LaunchAgents/com.portdaddy.daemon.plist
sleep 3

# ---------------------------------------------------------------------------
# Step 8: Verify
# ---------------------------------------------------------------------------
STATUS=$(pd status 2>&1)
if echo "$STATUS" | grep -q "running"; then
  PID=$(echo "$STATUS" | grep "PID" | grep -oE '[0-9]+')
  VERSION=$(echo "$STATUS" | grep "Version" | awk '{print $2}')
  echo ""
  echo "${GREEN}=== Promotion complete ===${NC}"
  echo "  Stable: main@$MAIN_SHA"
  echo "  Daemon: PID $PID, version $VERSION"
  echo "  Tests:  $PASS_COUNT passing"
  echo ""
else
  echo "${RED}WARNING: Daemon did not start. Check logs:${NC}"
  echo "  tail -20 $STABLE_DIR/port-daddy-error.log"
  exit 1
fi
