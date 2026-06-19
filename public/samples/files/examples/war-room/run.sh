#!/usr/bin/env bash
# =============================================================================
# War Room Example
# =============================================================================
#
# Simulates 3 agents coordinating to investigate and fix a production bug.
# Each agent registers with Port Daddy, adds notes about their investigation,
# publishes to a shared channel, and one "finds the bug" to share the fix.
#
# Requirements:
#   - port-daddy installed and daemon running (pd start or npm run dev)
#   - pd CLI available on PATH
#
# Usage:
#   chmod +x examples/war-room/run.sh
#   ./examples/war-room/run.sh
#
# =============================================================================

set -euo pipefail

# --- Configuration ---
PROJECT="warroom"
CHANNEL="bridge:${PROJECT}:incident"
AGENT_A="agent-alpha-$$"
AGENT_B="agent-bravo-$$"
AGENT_C="agent-charlie-$$"
SESSION_A=""
SESSION_B=""
SESSION_C=""

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

header() {
  echo ""
  echo -e "${BOLD}${CYAN}=== $1 ===${RESET}"
  echo ""
}

agent_say() {
  local agent="$1" color="$2" msg="$3"
  echo -e "  ${color}${BOLD}[${agent}]${RESET} ${msg}"
}

pause() {
  sleep 1
}

session_id_from_json() {
  node -e "let data=''; process.stdin.on('data', c => data += c); process.stdin.on('end', () => console.log(JSON.parse(data).sessionId));"
}

# --- Cleanup on exit ---
cleanup() {
  echo ""
  header "Cleanup"
  if [[ -n "$SESSION_A" ]]; then
    pd done "War room concluded" --agent "$AGENT_A" --session "$SESSION_A" -q 2>/dev/null || true
  fi
  if [[ -n "$SESSION_B" ]]; then
    pd done "War room concluded" --agent "$AGENT_B" --session "$SESSION_B" -q 2>/dev/null || true
  fi
  if [[ -n "$SESSION_C" ]]; then
    pd done "War room concluded" --agent "$AGENT_C" --session "$SESSION_C" -q 2>/dev/null || true
  fi
  echo -e "  ${DIM}All agents signed off${RESET}"
}
trap cleanup EXIT

# =============================================================================
# Act 1: Agents Join the War Room
# =============================================================================
header "Act 1: Agents Join the War Room"

echo -e "  ${DIM}A production incident has been reported: 500 errors on /api/auth${RESET}"
echo ""
pause

agent_say "$AGENT_A" "$CYAN" "Registering as incident lead..."
SESSION_A="$(pd begin --agent "$AGENT_A" \
  --identity "${PROJECT}:backend:incident-lead" \
  --purpose "Investigate auth 500 errors - lead" \
  --lifecycle durable -j | session_id_from_json)"

agent_say "$AGENT_B" "$YELLOW" "Registering as database investigator..."
SESSION_B="$(pd begin --agent "$AGENT_B" \
  --identity "${PROJECT}:database:investigator" \
  --purpose "Check database connections and query logs" \
  --lifecycle durable -j | session_id_from_json)"

agent_say "$AGENT_C" "$GREEN" "Registering as log analyst..."
SESSION_C="$(pd begin --agent "$AGENT_C" \
  --identity "${PROJECT}:logs:analyst" \
  --purpose "Analyze error logs and stack traces" \
  --lifecycle durable -j | session_id_from_json)"

pause
echo ""
echo -e "  ${DIM}3 agents now active in ${PROJECT}:*${RESET}"

# =============================================================================
# Act 2: Investigation Begins
# =============================================================================
header "Act 2: Investigation Begins"

# Agent A: sets the stage
agent_say "$AGENT_A" "$CYAN" "Publishing initial report to shared channel..."
pd pub "$CHANNEL" "SITREP: /api/auth returning 500 since 14:32 UTC. Affecting ~30% of requests. All hands investigate." --sender "$AGENT_A" -q
pd note "Starting auth incident investigation. Error rate: 30% of /api/auth requests returning 500." --session "$SESSION_A" -q

pause

# Agent B: checks database
agent_say "$AGENT_B" "$YELLOW" "Checking database connection pool..."
pd note "Database connection pool at 47/50 connections. No timeouts in pg_stat_activity. Pool is healthy." --session "$SESSION_B" -q
pd pub "$CHANNEL" "Database pool healthy: 47/50 connections, no timeouts." --sender "$AGENT_B" -q

pause

# Agent C: analyzes logs
agent_say "$AGENT_C" "$GREEN" "Scanning error logs for stack traces..."
pd note "Found repeating stack trace in auth service: TypeError: Cannot read properties of undefined (reading 'exp') at validateToken (auth.ts:142)" --session "$SESSION_C" -q
pd pub "$CHANNEL" "FOUND: Repeating TypeError in auth.ts:142 - token.exp is undefined. Looks like malformed JWT." --sender "$AGENT_C" -q

pause

# =============================================================================
# Act 3: Narrowing Down
# =============================================================================
header "Act 3: Narrowing Down the Bug"

# Agent A: responds to findings
agent_say "$AGENT_A" "$CYAN" "Reading channel messages..."
pd channels describe "$CHANNEL" 2>/dev/null || true
echo ""

agent_say "$AGENT_A" "$CYAN" "Investigating token validation path..."
pd note "auth.ts:142 validates JWT expiration. If token.exp is undefined, it means the JWT was signed without an exp claim. Checking token generation code." --session "$SESSION_A" -q

pause

# Agent B: checks recent deployments
agent_say "$AGENT_B" "$YELLOW" "Checking recent deployments..."
pd note "Found: deploy at 14:28 UTC updated jwt-signer to v3.2.0. Changelog shows breaking change: exp field moved from root to payload.claims.exp" --session "$SESSION_B" -q
pd pub "$CHANNEL" "BREAKTHROUGH: jwt-signer v3.2.0 deployed at 14:28 moved exp to payload.claims.exp. This is the breaking change." --sender "$AGENT_B" -q

pause

# Agent C: confirms
agent_say "$AGENT_C" "$GREEN" "Confirming with token samples..."
pd note "Confirmed: tokens issued after 14:28 have exp nested under claims. Old validation code expects token.exp at root level." --session "$SESSION_C" -q
pd pub "$CHANNEL" "Confirmed. All 500s are from tokens issued after 14:28. Old tokens still work fine." --sender "$AGENT_C" -q

pause

# =============================================================================
# Act 4: Resolution
# =============================================================================
header "Act 4: Resolution"

# Agent A: proposes fix
agent_say "$AGENT_A" "$CYAN" "Proposing fix..."
pd note "Fix: Update validateToken() to check both token.exp and token.claims?.exp for backward compatibility. Then pin jwt-signer to ~3.1.0 in package.json to prevent future surprises." --session "$SESSION_A" -q
pd pub "$CHANNEL" "FIX PROPOSED: Dual-path exp check in validateToken() + pin jwt-signer to ~3.1.0. Deploying hotfix." --sender "$AGENT_A" -q

pause

# All agents sign off with summaries
agent_say "$AGENT_A" "$CYAN" "Signing off with incident report..."
agent_say "$AGENT_B" "$YELLOW" "Signing off with findings..."
agent_say "$AGENT_C" "$GREEN" "Signing off with log analysis..."

# =============================================================================
# Act 5: Summary
# =============================================================================
header "Act 5: War Room Summary"

echo -e "  ${BOLD}Incident:${RESET} /api/auth 500 errors"
echo -e "  ${BOLD}Root Cause:${RESET} jwt-signer v3.2.0 breaking change (exp field relocation)"
echo -e "  ${BOLD}Fix:${RESET} Dual-path exp validation + version pin"
echo -e "  ${BOLD}Duration:${RESET} Simulated multi-agent coordination in seconds"
echo ""
echo -e "  ${DIM}All notes and channel messages are persisted in Port Daddy.${RESET}"
echo -e "  ${DIM}Run 'pd notes --limit 20' to review the investigation trail.${RESET}"
echo ""
echo -e "  ${GREEN}${BOLD}War room concluded successfully.${RESET}"
