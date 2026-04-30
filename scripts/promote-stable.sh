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
# Step 3: Enforce daemon version bump
# ---------------------------------------------------------------------------
DEV_VERSION="$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$DEV_DIR/package.json")"
STABLE_VERSION=""
if [[ -f "$STABLE_DIR/package.json" ]]; then
  STABLE_VERSION="$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$STABLE_DIR/package.json")"
fi

if [[ -n "$STABLE_VERSION" ]]; then
  if ! node - "$DEV_VERSION" "$STABLE_VERSION" <<'NODE'
const [dev, stable] = process.argv.slice(2);
const parse = (v) => String(v).split('.').map((part) => Number(part.replace(/\D.*$/, '')) || 0);
const a = parse(dev);
const b = parse(stable);
for (let i = 0; i < 3; i++) {
  if ((a[i] ?? 0) > (b[i] ?? 0)) process.exit(0);
  if ((a[i] ?? 0) < (b[i] ?? 0)) process.exit(1);
}
process.exit(1);
NODE
  then
    echo "${RED}ERROR: Daemon promotion requires a version bump.${NC}"
    echo "  Stable package.json: $STABLE_VERSION"
    echo "  Main package.json:   $DEV_VERSION"
    echo "  Philosophy: patch for daemon/runtime-only changes, minor for user-visible capabilities, major only for v4-scale breaks."
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Step 4: Run tests
# ---------------------------------------------------------------------------
echo "${YELLOW}Running test suite...${NC}"
cd "$DEV_DIR"

TEST_LOG=$(mktemp "${TMPDIR:-/tmp}/port-daddy-promote-tests.XXXXXX")
trap 'rm -f "$TEST_LOG"' EXIT

if ! npm test -- --no-coverage --runInBand >"$TEST_LOG" 2>&1; then
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
# Step 5: Emit promotion-time release-surface review
# ---------------------------------------------------------------------------
MAIN_SHA=$(git -C "$DEV_DIR" rev-parse --short HEAD)
STABLE_SHA="$(git -C "$STABLE_DIR" rev-parse --short HEAD 2>/dev/null || true)"

echo "${YELLOW}Emitting release-surface review trigger...${NC}"
REVIEW_ARGS=(
  "$DEV_DIR/scripts/emit-promotion-release-review.mjs"
  --dev-dir "$DEV_DIR"
  --stable-dir "$STABLE_DIR"
  --source-sha "$MAIN_SHA"
)
if [[ -n "$STABLE_SHA" ]]; then
  REVIEW_ARGS+=(--stable-sha "$STABLE_SHA")
fi

if [[ "${PORT_DADDY_PROMOTION_REVIEW_REQUIRED:-0}" == "1" ]]; then
  node "${REVIEW_ARGS[@]}"
else
  if ! node "${REVIEW_ARGS[@]}" --best-effort; then
    echo "${YELLOW}WARNING: release-surface review trigger failed; continuing because PORT_DADDY_PROMOTION_REVIEW_REQUIRED is not set.${NC}"
  fi
fi

if [[ "${PORT_DADDY_PROMOTION_REVIEW_ONLY:-0}" == "1" ]]; then
  echo "${YELLOW}PORT_DADDY_PROMOTION_REVIEW_ONLY=1; stopping before stable merge so release-surface agents can work.${NC}"
  exit 2
fi

# ---------------------------------------------------------------------------
# Step 6: Merge main into stable
# ---------------------------------------------------------------------------
echo "${YELLOW}Merging main → stable...${NC}"

cd "$STABLE_DIR"
git merge main --no-edit -m "promote: main@$MAIN_SHA → stable"

# ---------------------------------------------------------------------------
# Step 7: Reinstall dependencies (in case package.json changed)
# ---------------------------------------------------------------------------
echo "${YELLOW}Installing dependencies in stable...${NC}"
npm install --production=false 2>&1 | tail -3

# ---------------------------------------------------------------------------
# Step 8: Build native Rust enforcement core
# ---------------------------------------------------------------------------
echo "${YELLOW}Building Rust FFI core in stable...${NC}"
npm run build:core:dist

# ---------------------------------------------------------------------------
# Step 9: Build native Bosun supervisor
# ---------------------------------------------------------------------------
echo "${YELLOW}Building pd-bosun in stable...${NC}"
npm run build:bosun:dist

# ---------------------------------------------------------------------------
# Step 10: Re-link (in case bin entries changed)
# ---------------------------------------------------------------------------
if ! LINK_LOG="$(npm link 2>&1)"; then
  echo "${YELLOW}WARNING: npm link failed; continuing with direct stable daemon paths.${NC}"
  printf '%s\n' "$LINK_LOG" | tail -8
else
  printf '%s\n' "$LINK_LOG" | tail -1
fi

# ---------------------------------------------------------------------------
# Step 11: Reinstall service plists and restart daemon + Bosun
# ---------------------------------------------------------------------------
echo "${YELLOW}Installing daemon and Bosun services...${NC}"
npm run install-daemon -- install

print_runtime_diagnostics() {
  echo "  Daemon log: tail -20 $STABLE_DIR/port-daddy.log"
  echo "  Error log:  tail -20 $STABLE_DIR/port-daddy-error.log"
  echo ""
  echo "${YELLOW}Recent daemon errors:${NC}"
  tail -20 "$STABLE_DIR/port-daddy-error.log" 2>/dev/null || true
}

wait_for_file() {
  local path="$1"
  local timeout_seconds="$2"
  local waited=0

  while (( waited < timeout_seconds )); do
    if [[ -s "$path" ]]; then
      return 0
    fi

    /bin/sleep 1
    waited=$((waited + 1))
  done

  return 1
}

fetch_json_with_retry() {
  local url="$1"
  local timeout_seconds="$2"
  local waited=0
  local body=""

  while (( waited < timeout_seconds )); do
    if body="$(curl -fsS --max-time 3 "$url" 2>/dev/null)"; then
      printf '%s' "$body"
      return 0
    fi

    /bin/sleep 2
    waited=$((waited + 2))
  done

  return 1
}

# ---------------------------------------------------------------------------
# Step 12: Verify authoritative runtime truth
# ---------------------------------------------------------------------------
PORT_FILE="$HOME/.port-daddy/daemon.port"
if ! wait_for_file "$PORT_FILE" 60; then
  echo "${RED}WARNING: Daemon port file missing after restart.${NC}"
  echo "  Expected: $PORT_FILE"
  print_runtime_diagnostics
  exit 1
fi

DAEMON_PORT="$(tr -d '[:space:]' < "$PORT_FILE")"
BASE_URL="http://127.0.0.1:${DAEMON_PORT}"

HEALTH_JSON="$(fetch_json_with_retry "$BASE_URL/health" 90)" || {
  echo "${RED}WARNING: /health did not respond after restart.${NC}"
  echo "  URL: $BASE_URL/health"
  print_runtime_diagnostics
  exit 1
}

VERSION_JSON="$(fetch_json_with_retry "$BASE_URL/version" 30)" || {
  echo "${RED}WARNING: /version did not respond after restart.${NC}"
  echo "  URL: $BASE_URL/version"
  print_runtime_diagnostics
  exit 1
}

STATUS_JSON="$(fetch_json_with_retry "$BASE_URL/status" 30)" || {
  echo "${RED}WARNING: /status did not respond after restart.${NC}"
  echo "  URL: $BASE_URL/status"
  print_runtime_diagnostics
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
