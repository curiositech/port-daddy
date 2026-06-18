#!/usr/bin/env bash
# Port Daddy integration signals.
#
# Demonstrates current CLI integration channels:
#   - one agent declares a need
#   - another agent declares readiness
#   - the shared project signal list shows both
#
# Run:
#   bash examples/integration/ready-needs.sh

set -euo pipefail

PROJECT="${PROJECT:-examples-integration}"
AGENT_A="examples-api-$$"
AGENT_B="examples-web-$$"

cleanup() {
  pd session done "integration example cleanup" --agent "$AGENT_A" -q >/dev/null 2>&1 || true
  pd session done "integration example cleanup" --agent "$AGENT_B" -q >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Integration signals"
echo "-------------------"

SESSION_A="$(pd session start "Build API endpoints" --agent "$AGENT_A" -q)"

SESSION_B="$(pd session start "Build frontend against API" --agent "$AGENT_B" -q)"

echo "Frontend declares a need:"
pd note "Waiting for API routes and response shape" --session "$SESSION_B" --type blocker -q
pd integration needs "$PROJECT:web" "Waiting for API routes and response shape"

echo ""
echo "API declares readiness:"
pd note "API endpoints complete and contract smoke test is passing" --session "$SESSION_A" --type progress -q
pd integration ready "$PROJECT:api" "API routes ready for frontend integration"

echo ""
echo "Recent project integration signals:"
pd integration list --project "$PROJECT"

pd session done "API side ready signal sent" --agent "$AGENT_A" -q
pd session done "Frontend need signal recorded" --agent "$AGENT_B" -q

echo "Done."
